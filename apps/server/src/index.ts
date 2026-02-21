import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import multer from "multer";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import Redis from "ioredis";
import dotenv from "dotenv";
import {
  type Country,
  type LoginPayload,
  type Order,
  type OrderDelta,
  type ResourceTotals,
  type ServerStatus,
  type WorldBase,
  type WorldPatch,
  type WsInMessage,
  type WsOutMessage,
} from "@arcanorum/shared";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../.env") });

const prisma = new PrismaClient();

const env = {
  port: Number(process.env.PORT ?? 3001),
  jwtSecret: process.env.JWT_SECRET ?? "dev_secret_change_me",
  serverStatus: (process.env.SERVER_STATUS as ServerStatus) ?? "online",
  redisUrl: process.env.REDIS_URL,
};

const uploadsRoot = resolve(__dirname, "../uploads");
const flagsDir = resolve(uploadsRoot, "flags");
const crestsDir = resolve(uploadsRoot, "crests");
mkdirSync(flagsDir, { recursive: true });
mkdirSync(crestsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    if (file.fieldname === "flag") {
      cb(null, flagsDir);
      return;
    }
    cb(null, crestsDir);
  },
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname) || ".png";
    cb(null, `${randomUUID()}${ext.toLowerCase()}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 4 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
      return;
    }
    cb(new Error("ONLY_IMAGES"));
  },
});

const prebuiltTileRoot = resolve(__dirname, "../data/tiles/adm1");
if (!existsSync(prebuiltTileRoot)) {
  throw new Error(`[map] MVT root not found: ${prebuiltTileRoot}. Expected tiles at {z}/{x}/{y}.mvt`);
}

const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(uploadsRoot));

const countrySelect = {
  id: true,
  name: true,
  color: true,
  flagUrl: true,
  crestUrl: true,
  isAdmin: true,
} as const;

let turnId = 1;
const onlinePlayers = new Set<string>();
const ordersByTurn = new Map<number, Map<string, Order[]>>();

let worldBase: WorldBase = {
  turnId,
  resourcesByCountry: {
    ARC: { culture: 12, science: 9, religion: 6, ducats: 35, gold: 120 },
    VAL: { culture: 8, science: 12, religion: 7, ducats: 28, gold: 110 },
  },
  provinceOwner: {
    "p-north": "ARC",
    "p-south": "ARC",
    "p-east": "VAL",
  },
};

const redis = env.redisUrl ? new Redis(env.redisUrl, { lazyConnect: true }) : null;
if (redis) {
  redis.connect().catch(() => {
    // Redis is optional acceleration layer and can be unavailable in local setup.
  });
}

const registerSchema = z.object({
  countryName: z.string().min(2).max(32),
  countryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  password: z.string().min(8),
});

const loginSchema = z.object({
  countryId: z.string().min(1),
  password: z.string().min(1),
  rememberMe: z.boolean(),
});

function createToken(player: { id: string; countryId: string; isAdmin: boolean }, rememberMe: boolean): string {
  const expiresIn = rememberMe ? "30d" : "8h";
  return jwt.sign(player, env.jwtSecret, { expiresIn });
}

function broadcast(wss: WebSocketServer, message: WsOutMessage): void {
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function countryFromDb(row: { id: string; name: string; color: string; flagUrl: string | null; crestUrl: string | null; isAdmin: boolean }): Country {
  return row;
}

function resolveTurn(): WorldPatch {
  const currentOrders = ordersByTurn.get(turnId) ?? new Map<string, Order[]>();
  const rejectedOrders: WorldPatch["rejectedOrders"] = [];
  const claimed = new Set<string>();

  currentOrders.forEach((orders, playerId) => {
    for (const order of orders) {
      if (order.type === "BUILD") {
        const owner = worldBase.provinceOwner[order.provinceId];
        if (!owner || owner !== order.countryId || claimed.has(order.provinceId)) {
          rejectedOrders.push({ playerId, reason: "BUILD_CONFLICT", tempOrderId: order.id });
          continue;
        }
        claimed.add(order.provinceId);
        const resource = worldBase.resourcesByCountry[order.countryId] as ResourceTotals | undefined;
        if (resource) {
          resource.ducats = Math.max(0, resource.ducats - 2);
          resource.gold = Math.max(0, resource.gold - 5);
        }
      }
    }
  });

  turnId += 1;
  worldBase = {
    ...worldBase,
    turnId,
  };

  ordersByTurn.delete(turnId - 1);

  return {
    type: "WORLD_PATCH",
    turnId,
    worldBase,
    rejectedOrders,
  };
}

app.get("/health", async (_req, res) => {
  res.json({ status: env.serverStatus, turnId, serverTime: new Date().toISOString() });
});

app.get("/countries", async (_req, res) => {
  const countries = await prisma.country.findMany({ select: countrySelect, orderBy: { createdAt: "asc" } });
  res.json(countries.map(countryFromDb));
});

function parseAuthHeader(req: express.Request): { id: string; countryId: string; isAdmin: boolean } | null {
  const header = req.header("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }

  try {
    return jwt.verify(header.slice("Bearer ".length), env.jwtSecret) as { id: string; countryId: string; isAdmin: boolean };
  } catch {
    return null;
  }
}

app.patch("/admin/countries/:countryId/admin", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !auth.isAdmin) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }

  const nextIsAdmin = Boolean(req.body?.isAdmin);

  try {
    const updated = await prisma.country.update({
      where: { id: req.params.countryId },
      data: { isAdmin: nextIsAdmin },
      select: countrySelect,
    });

    return res.json(countryFromDb(updated));
  } catch {
    return res.status(404).json({ error: "COUNTRY_NOT_FOUND" });
  }
});

app.post("/auth/register", upload.fields([{ name: "flag", maxCount: 1 }, { name: "crest", maxCount: 1 }]), async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  const files = req.files as { flag?: Express.Multer.File[]; crest?: Express.Multer.File[] } | undefined;
  const flagFile = files?.flag?.[0];
  const crestFile = files?.crest?.[0];

  const { countryName, countryColor, password } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const hasAnyAdmin = (await prisma.country.count({ where: { isAdmin: true } })) > 0;
    const country = await prisma.country.create({
      data: {
        name: countryName,
        color: countryColor,
        flagUrl: flagFile ? `/uploads/flags/${flagFile.filename}` : null,
        crestUrl: crestFile ? `/uploads/crests/${crestFile.filename}` : null,
        passwordHash,
        isAdmin: !hasAnyAdmin,
      },
      select: countrySelect,
    });

    if (!worldBase.resourcesByCountry[country.id]) {
      worldBase.resourcesByCountry[country.id] = { culture: 5, science: 5, religion: 5, ducats: 20, gold: 80 };
    }

    return res.status(201).json(countryFromDb(country));
  } catch {
    return res.status(409).json({ error: "COUNTRY_EXISTS" });
  }
});

app.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body satisfies LoginPayload);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  const { countryId, password, rememberMe } = parsed.data;
  const country = await prisma.country.findUnique({ where: { id: countryId } });

  if (!country) {
    return res.status(404).json({ error: "COUNTRY_NOT_FOUND" });
  }

  if (country.isLocked) {
    return res.status(403).json({ error: "ACCOUNT_LOCKED" });
  }

  const ok = await bcrypt.compare(password, country.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "INVALID_PASSWORD" });
  }

  const token = createToken({ id: `player-${country.id}`, countryId: country.id, isAdmin: country.isAdmin }, rememberMe);
  return res.json({ token, playerId: `player-${country.id}`, countryId: country.id, isAdmin: country.isAdmin, worldBase, turnId });
});

app.get("/tiles/adm1/:z/:x/:y.mvt", (req, res) => {
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);

  const prebuiltPath = resolve(prebuiltTileRoot, String(z), String(x), `${y}.mvt`);
  if (!existsSync(prebuiltPath)) {
    return res.status(204).end();
  }

  const file = readFileSync(prebuiltPath);
  res.setHeader("Content-Type", "application/x-protobuf");
  res.send(file);
});


app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!err) {
    next();
    return;
  }

  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({ error: "FILE_TOO_LARGE" });
    return;
  }

  if (err instanceof Error && err.message === "ONLY_IMAGES") {
    res.status(400).json({ error: "ONLY_IMAGES" });
    return;
  }

  next(err);
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
  let playerId: string | null = null;
  let isAdmin = false;

  const send = (message: WsOutMessage) => {
    socket.send(JSON.stringify(message));
  };

  send({ type: "CONNECTED", serverTime: new Date().toISOString() });

  socket.on("message", async (raw) => {
    let msg: WsInMessage;
    try {
      msg = JSON.parse(raw.toString()) as WsInMessage;
    } catch {
      send({ type: "ERROR", code: "BAD_JSON", message: "Invalid message payload" });
      return;
    }

    if (msg.type === "PING") {
      send({ type: "PONG" });
      return;
    }

    if (msg.type === "AUTH") {
      try {
        const payload = jwt.verify(msg.token, env.jwtSecret) as { id: string; countryId: string; isAdmin?: boolean };
        playerId = payload.id;
        isAdmin = Boolean(payload.isAdmin);
        onlinePlayers.add(payload.id);
        send({ type: "AUTH_OK", playerId: payload.id, countryId: payload.countryId, isAdmin, worldBase, turnId });
        broadcast(wss, { type: "PRESENCE", onlinePlayerIds: [...onlinePlayers] });
      } catch {
        send({ type: "ERROR", code: "UNAUTHORIZED", message: "Token invalid" });
      }
      return;
    }

    if (!playerId) {
      send({ type: "ERROR", code: "UNAUTHORIZED", message: "Please authenticate first" });
      return;
    }

    if (msg.type === "ORDER_DELTA") {
      const delta = msg as OrderDelta;

      if (delta.order.turnId !== turnId) {
        send({ type: "ERROR", code: "TURN_MISMATCH", message: "Order for stale turn" });
        return;
      }

      const countryResource = worldBase.resourcesByCountry[delta.order.countryId];
      if (!countryResource || countryResource.ducats <= 0) {
        send({ type: "ERROR", code: "NO_RESOURCES", message: "Not enough planning resources" });
        return;
      }

      const order: Order = {
        ...delta.order,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };

      const turnOrders = ordersByTurn.get(turnId) ?? new Map<string, Order[]>();
      const playerOrders = turnOrders.get(playerId) ?? [];

      if (playerOrders.length >= 8) {
        send({ type: "ERROR", code: "RATE_LIMIT", message: "Too many orders this turn" });
        return;
      }

      playerOrders.push(order);
      turnOrders.set(playerId, playerOrders);
      ordersByTurn.set(turnId, turnOrders);

      broadcast(wss, { type: "ORDER_BROADCAST", order });
      return;
    }

    if (msg.type === "ADMIN_FORCE_RESOLVE") {
      if (!isAdmin) {
        send({ type: "ERROR", code: "FORBIDDEN", message: "Admin only" });
        return;
      }
      const patch = resolveTurn();
      broadcast(wss, patch);
      return;
    }

    if (msg.type === "REQUEST_RESOLVE") {
      const patch = resolveTurn();
      broadcast(wss, patch);
    }
  });

  socket.on("close", () => {
    if (playerId) {
      onlinePlayers.delete(playerId);
      broadcast(wss, { type: "PRESENCE", onlinePlayerIds: [...onlinePlayers] });
    }
  });
});

server.listen(env.port, () => {
  console.log(`Arcanorum server running on http://localhost:${env.port}`);
});
