import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import multer from "multer";
import { imageSize } from "image-size";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import Redis from "ioredis";
import dotenv from "dotenv";
import {
  type Country,
  type EventCategory,
  type EventLogEntry,
  type EventPriority,
  type EventVisibility,
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
const resourceIconsDir = resolve(uploadsRoot, "resource-icons");
mkdirSync(flagsDir, { recursive: true });
mkdirSync(crestsDir, { recursive: true });
mkdirSync(resourceIconsDir, { recursive: true });

const resourceIconFields = new Set(["culture", "science", "religion", "colonization", "ducats", "gold"]);

const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    if (resourceIconFields.has(file.fieldname)) {
      cb(null, resourceIconsDir);
      return;
    }
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
const adm1GeojsonPath = resolve(__dirname, "../data/adm1.geojson");
const adm1Geojson = JSON.parse(readFileSync(adm1GeojsonPath, "utf8")) as {
  type: "FeatureCollection";
  features: Array<{ properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } | null }>;
};
const EARTH_RADIUS_METERS = 6_378_137;

function ringAreaOnSphereSqMeters(ring: Array<[number, number]>): number {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % ring.length];
    if (!p1 || !p2) continue;
    const lon1 = (p1[0] * Math.PI) / 180;
    const lon2 = (p2[0] * Math.PI) / 180;
    const lat1 = (p1[1] * Math.PI) / 180;
    const lat2 = (p2[1] * Math.PI) / 180;
    total += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs(total * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS * 0.5);
}

function polygonAreaSqMeters(coords: unknown): number {
  if (!Array.isArray(coords) || coords.length === 0) return 0;
  const rings = coords as Array<Array<[number, number]>>;
  let area = 0;
  for (let i = 0; i < rings.length; i += 1) {
    const ringArea = ringAreaOnSphereSqMeters(rings[i] ?? []);
    area += i === 0 ? ringArea : -ringArea;
  }
  return Math.max(0, area);
}

function geometryAreaKm2(geometry: { type?: string; coordinates?: unknown } | null | undefined): number {
  if (!geometry?.type) return 0;
  if (geometry.type === "Polygon") {
    return polygonAreaSqMeters(geometry.coordinates) / 1_000_000;
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.reduce((sum, polygon) => sum + polygonAreaSqMeters(polygon) / 1_000_000, 0);
  }
  return 0;
}
const adm1ProvinceIndex = (() => {
  const byId = new Map<string, { id: string; name: string; areaKm2: number }>();
  for (const feature of adm1Geojson.features) {
    const properties = feature.properties as Record<string, unknown> | undefined;
    const id = readProvinceId(properties);
    if (!id) continue;
    const areaKm2 = geometryAreaKm2(feature.geometry);
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, { id, name: readProvinceName(properties), areaKm2 });
      continue;
    }
    existing.areaKm2 += areaKm2;
  }
  return [...byId.values()]
    .map((province) => ({ ...province, areaKm2: Math.max(0, Math.round(province.areaKm2)) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id));
})();
const adm1ProvinceAreaById = new Map(adm1ProvinceIndex.map((province) => [province.id, province.areaKm2] as const));

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
  isLocked: true,
  blockedUntilTurn: true,
  blockedUntilAt: true,
  ignoreUntilTurn: true,
  eventLogRetentionTurns: true,
} as const;

let turnId = 1;
const onlinePlayers = new Set<string>();
const ordersByTurn = new Map<number, Map<string, Order[]>>();
const resolveReadyByTurn = new Map<number, Set<string>>();
const DEFAULT_MAX_ACTIVE_COLONIZATIONS = 3;
const DEFAULT_COLONIZATION_POINTS_PER_TURN = 30;
const COLONIZATION_GOAL = 100;
const DEFAULT_PROVINCE_COLONIZATION_COST = 100;
const SETTINGS_MAX_NUMBER = 1_000_000_000_000;

type GameSettings = {
  economy: {
    baseDucatsPerTurn: number;
    baseGoldPerTurn: number;
  };
  colonization: {
    maxActiveColonizations: number;
    pointsPerTurn: number;
    pointsCostPer1000Km2: number;
    ducatsCostPer1000Km2: number;
  };
  customization: {
    renameDucats: number;
    recolorDucats: number;
    flagDucats: number;
    crestDucats: number;
  };
  eventLog: {
    retentionTurns: number;
  };
  turnTimer: {
    enabled: boolean;
    secondsPerTurn: number;
  };
  map: {
    showAntarctica: boolean;
  };
  resourceIcons: {
    culture: string | null;
    science: string | null;
    religion: string | null;
    colonization: string | null;
    ducats: string | null;
    gold: string | null;
  };
};

const defaultGameSettings = (): GameSettings => ({
  economy: {
    baseDucatsPerTurn: 5,
    baseGoldPerTurn: 10,
  },
  colonization: {
    maxActiveColonizations: DEFAULT_MAX_ACTIVE_COLONIZATIONS,
    pointsPerTurn: DEFAULT_COLONIZATION_POINTS_PER_TURN,
    pointsCostPer1000Km2: 5,
    ducatsCostPer1000Km2: 5,
  },
  customization: {
    renameDucats: 20,
    recolorDucats: 10,
    flagDucats: 15,
    crestDucats: 15,
  },
  eventLog: {
    retentionTurns: 3,
  },
  turnTimer: {
    enabled: true,
    secondsPerTurn: 86_400,
  },
  map: {
    showAntarctica: false,
  },
  resourceIcons: {
    culture: null,
    science: null,
    religion: null,
    colonization: null,
    ducats: null,
    gold: null,
  },
});

function defaultWorldBase(currentTurnId: number): WorldBase {
  return {
    turnId: currentTurnId,
    resourcesByCountry: {
      ARC: { culture: 12, science: 9, religion: 6, colonization: DEFAULT_COLONIZATION_POINTS_PER_TURN, ducats: 35, gold: 120 },
      VAL: { culture: 8, science: 12, religion: 7, colonization: DEFAULT_COLONIZATION_POINTS_PER_TURN, ducats: 28, gold: 110 },
    },
    provinceOwner: {
      "p-north": "ARC",
      "p-south": "ARC",
      "p-east": "VAL",
    },
    colonyProgressByProvince: {},
    provinceColonizationByProvince: {},
  };
}

let gameSettings: GameSettings = defaultGameSettings();
let worldBase: WorldBase = defaultWorldBase(turnId);
let currentTurnStartedAtMs = Date.now();
let isResolvingTurnNow = false;

const persistedStatePath = resolve(__dirname, "../data/game-state.json");
const GAME_STATE_ROW_ID = "primary";

function serializeOrdersByTurn(): Array<{ turnId: number; players: Array<{ playerId: string; orders: Order[] }> }> {
  return [...ordersByTurn.entries()].map(([savedTurnId, players]) => ({
    turnId: savedTurnId,
    players: [...players.entries()].map(([playerId, orders]) => ({ playerId, orders })),
  }));
}

function serializeResolveReadyByTurn(): Array<{ turnId: number; countryIds: string[] }> {
  return [...resolveReadyByTurn.entries()].map(([savedTurnId, readySet]) => ({
    turnId: savedTurnId,
    countryIds: [...readySet],
  }));
}

function parseAndApplyPersistentState(input: unknown): boolean {
  if (!input || typeof input !== "object") {
    return false;
  }

  const parsed = input as Partial<{
    turnId: unknown;
    gameSettings: unknown;
    worldBase: unknown;
    ordersByTurn: unknown;
    resolveReadyByTurn: unknown;
  }>;

  if (typeof parsed.turnId === "number" && Number.isFinite(parsed.turnId) && parsed.turnId >= 1) {
    turnId = Math.floor(parsed.turnId);
  }

  if (parsed.gameSettings && typeof parsed.gameSettings === "object") {
    const next = parsed.gameSettings as Partial<GameSettings>;
    const defaults = defaultGameSettings();
    gameSettings = {
      economy: {
        baseDucatsPerTurn:
          typeof next.economy?.baseDucatsPerTurn === "number"
            ? Math.max(0, Math.floor(next.economy.baseDucatsPerTurn))
            : defaults.economy.baseDucatsPerTurn,
        baseGoldPerTurn:
          typeof next.economy?.baseGoldPerTurn === "number"
            ? Math.max(0, Math.floor(next.economy.baseGoldPerTurn))
            : defaults.economy.baseGoldPerTurn,
      },
      colonization: {
        maxActiveColonizations:
          typeof next.colonization?.maxActiveColonizations === "number"
            ? Math.max(1, Math.floor(next.colonization.maxActiveColonizations))
            : defaults.colonization.maxActiveColonizations,
        pointsPerTurn:
          typeof next.colonization?.pointsPerTurn === "number"
            ? Math.max(0, Math.floor(next.colonization.pointsPerTurn))
            : defaults.colonization.pointsPerTurn,
        pointsCostPer1000Km2:
          typeof next.colonization?.pointsCostPer1000Km2 === "number"
            ? Math.max(1, Math.floor(next.colonization.pointsCostPer1000Km2))
            : defaults.colonization.pointsCostPer1000Km2,
        ducatsCostPer1000Km2:
          typeof next.colonization?.ducatsCostPer1000Km2 === "number"
            ? Math.max(0, Math.floor(next.colonization.ducatsCostPer1000Km2))
            : defaults.colonization.ducatsCostPer1000Km2,
      },
      customization: {
        renameDucats:
          typeof next.customization?.renameDucats === "number"
            ? Math.max(0, Math.floor(next.customization.renameDucats))
            : defaults.customization.renameDucats,
        recolorDucats:
          typeof next.customization?.recolorDucats === "number"
            ? Math.max(0, Math.floor(next.customization.recolorDucats))
            : defaults.customization.recolorDucats,
        flagDucats:
          typeof next.customization?.flagDucats === "number"
            ? Math.max(0, Math.floor(next.customization.flagDucats))
            : defaults.customization.flagDucats,
        crestDucats:
          typeof next.customization?.crestDucats === "number"
            ? Math.max(0, Math.floor(next.customization.crestDucats))
            : defaults.customization.crestDucats,
      },
      eventLog: {
        retentionTurns:
          typeof next.eventLog?.retentionTurns === "number"
            ? Math.max(1, Math.floor(next.eventLog.retentionTurns))
            : defaults.eventLog.retentionTurns,
      },
      turnTimer: {
        enabled:
          typeof (next as Partial<{ turnTimer?: { enabled?: unknown } }>).turnTimer?.enabled === "boolean"
            ? Boolean((next as Partial<{ turnTimer?: { enabled?: boolean } }>).turnTimer?.enabled)
            : defaults.turnTimer.enabled,
        secondsPerTurn:
          typeof (next as Partial<{ turnTimer?: { secondsPerTurn?: unknown } }>).turnTimer?.secondsPerTurn === "number"
            ? Math.max(10, Math.floor((next as Partial<{ turnTimer?: { secondsPerTurn?: number } }>).turnTimer?.secondsPerTurn ?? defaults.turnTimer.secondsPerTurn))
            : defaults.turnTimer.secondsPerTurn,
      },
      map: {
        showAntarctica:
          typeof next.map?.showAntarctica === "boolean" ? next.map.showAntarctica : defaults.map.showAntarctica,
      },
      resourceIcons: {
        culture: typeof next.resourceIcons?.culture === "string" || next.resourceIcons?.culture === null ? (next.resourceIcons?.culture ?? null) : defaults.resourceIcons.culture,
        science: typeof next.resourceIcons?.science === "string" || next.resourceIcons?.science === null ? (next.resourceIcons?.science ?? null) : defaults.resourceIcons.science,
        religion: typeof next.resourceIcons?.religion === "string" || next.resourceIcons?.religion === null ? (next.resourceIcons?.religion ?? null) : defaults.resourceIcons.religion,
        colonization:
          typeof next.resourceIcons?.colonization === "string" || next.resourceIcons?.colonization === null
            ? (next.resourceIcons?.colonization ?? null)
            : defaults.resourceIcons.colonization,
        ducats: typeof next.resourceIcons?.ducats === "string" || next.resourceIcons?.ducats === null ? (next.resourceIcons?.ducats ?? null) : defaults.resourceIcons.ducats,
        gold: typeof next.resourceIcons?.gold === "string" || next.resourceIcons?.gold === null ? (next.resourceIcons?.gold ?? null) : defaults.resourceIcons.gold,
      },
    };
  }

  if (parsed.worldBase && typeof parsed.worldBase === "object") {
    const candidate = parsed.worldBase as Partial<WorldBase>;
    if (
      candidate.resourcesByCountry &&
      typeof candidate.resourcesByCountry === "object" &&
      candidate.provinceOwner &&
      typeof candidate.provinceOwner === "object" &&
      candidate.colonyProgressByProvince &&
      typeof candidate.colonyProgressByProvince === "object"
    ) {
      worldBase = {
        turnId,
        resourcesByCountry: candidate.resourcesByCountry,
        provinceOwner: candidate.provinceOwner,
        colonyProgressByProvince: candidate.colonyProgressByProvince,
        provinceColonizationByProvince: normalizeProvinceColonizationMap(
          (candidate as Partial<WorldBase> & { provinceColonizationByProvince?: unknown }).provinceColonizationByProvince,
        ),
      };
    } else {
      worldBase = defaultWorldBase(turnId);
    }
  } else {
    worldBase = defaultWorldBase(turnId);
  }

  ordersByTurn.clear();
  if (Array.isArray(parsed.ordersByTurn)) {
    for (const turnEntry of parsed.ordersByTurn) {
      if (!turnEntry || typeof turnEntry !== "object") {
        continue;
      }
      const savedTurn = (turnEntry as { turnId?: unknown }).turnId;
      const players = (turnEntry as { players?: unknown }).players;
      if (typeof savedTurn !== "number" || !Number.isFinite(savedTurn) || !Array.isArray(players)) {
        continue;
      }

      const playerMap = new Map<string, Order[]>();
      for (const playerEntry of players) {
        if (!playerEntry || typeof playerEntry !== "object") {
          continue;
        }
        const savedPlayerId = (playerEntry as { playerId?: unknown }).playerId;
        const savedOrders = (playerEntry as { orders?: unknown }).orders;
        if (typeof savedPlayerId !== "string" || !Array.isArray(savedOrders)) {
          continue;
        }
        playerMap.set(savedPlayerId, savedOrders as Order[]);
      }
      if (playerMap.size > 0) {
        ordersByTurn.set(Math.floor(savedTurn), playerMap);
      }
    }
  }

  resolveReadyByTurn.clear();
  if (Array.isArray(parsed.resolveReadyByTurn)) {
    for (const turnEntry of parsed.resolveReadyByTurn) {
      if (!turnEntry || typeof turnEntry !== "object") {
        continue;
      }
      const savedTurn = (turnEntry as { turnId?: unknown }).turnId;
      const countryIds = (turnEntry as { countryIds?: unknown }).countryIds;
      if (typeof savedTurn !== "number" || !Number.isFinite(savedTurn) || !Array.isArray(countryIds)) {
        continue;
      }
      const ids = countryIds.filter((id): id is string => typeof id === "string");
      if (ids.length > 0) {
        resolveReadyByTurn.set(Math.floor(savedTurn), new Set(ids));
      }
    }
  }

  return true;
}

async function persistStateToDb(): Promise<void> {
  const payload = {
    turnId,
    gameSettings,
    worldBase: {
      ...worldBase,
      turnId,
    },
    ordersByTurn: serializeOrdersByTurn(),
    resolveReadyByTurn: serializeResolveReadyByTurn(),
  };

  await prisma.gameState.upsert({
    where: { id: GAME_STATE_ROW_ID },
    create: {
      id: GAME_STATE_ROW_ID,
      turnId,
      gameSettingsJson: payload.gameSettings as unknown as Prisma.InputJsonValue,
      worldBaseJson: payload.worldBase as unknown as Prisma.InputJsonValue,
      ordersByTurnJson: payload.ordersByTurn as unknown as Prisma.InputJsonValue,
      resolveReadyByTurnJson: payload.resolveReadyByTurn as unknown as Prisma.InputJsonValue,
    },
    update: {
      turnId,
      gameSettingsJson: payload.gameSettings as unknown as Prisma.InputJsonValue,
      worldBaseJson: payload.worldBase as unknown as Prisma.InputJsonValue,
      ordersByTurnJson: payload.ordersByTurn as unknown as Prisma.InputJsonValue,
      resolveReadyByTurnJson: payload.resolveReadyByTurn as unknown as Prisma.InputJsonValue,
    },
  });
}

let persistStateQueue: Promise<void> = Promise.resolve();

function savePersistentState(): void {
  persistStateQueue = persistStateQueue
    .then(async () => {
      await persistStateToDb();
    })
    .catch((error) => {
      console.error("[state] Failed to save game state to DB:", error);
    });
}

async function tryImportPersistentStateFromFile(): Promise<boolean> {
  if (!existsSync(persistedStatePath)) {
    return false;
  }

  try {
    const raw = readFileSync(persistedStatePath, "utf8");
    const fileState = JSON.parse(raw) as unknown;
    const ok = parseAndApplyPersistentState(fileState);
    if (!ok) {
      return false;
    }
    const migratedManualFlags = migrateProvinceManualCostFlags();
    const migratedLegacyCosts = migrateLegacyProvinceColonizationCosts();
    if (migratedManualFlags > 0 || migratedLegacyCosts > 0) {
      console.log(
        `[state] Migrated province colonization metadata from JSON import: manualFlags=${migratedManualFlags}, legacyCosts=${migratedLegacyCosts}`,
      );
    }
    await persistStateToDb();
    console.log("[state] Imported persistent game state from JSON file into database");
    return true;
  } catch (error) {
    console.error("[state] Failed to import persisted game state from file:", error);
    return false;
  }
}

async function loadPersistentState(): Promise<void> {
  try {
    const row = await prisma.gameState.findUnique({ where: { id: GAME_STATE_ROW_ID } });
    if (row) {
      parseAndApplyPersistentState({
        turnId: row.turnId,
        gameSettings: row.gameSettingsJson,
        worldBase: row.worldBaseJson,
        ordersByTurn: row.ordersByTurnJson,
        resolveReadyByTurn: row.resolveReadyByTurnJson,
      });
      const migratedManualFlags = migrateProvinceManualCostFlags();
      const migratedLegacyCosts = migrateLegacyProvinceColonizationCosts();
      if (migratedManualFlags > 0 || migratedLegacyCosts > 0) {
        console.log(
          `[state] Migrated province colonization metadata from DB state: manualFlags=${migratedManualFlags}, legacyCosts=${migratedLegacyCosts}`,
        );
        await persistStateToDb();
      }
      return;
    }

    await tryImportPersistentStateFromFile();
  } catch (error) {
    console.error("[state] Failed to load persisted game state from DB, using defaults:", error);
  }
}

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

function ensureCountryInWorldBase(countryId: string): void {
  if (!worldBase.resourcesByCountry[countryId]) {
    worldBase.resourcesByCountry[countryId] = {
      culture: 5,
      science: 5,
      religion: 5,
      colonization: gameSettings.colonization.pointsPerTurn,
      ducats: 20,
      gold: 80,
    };
    savePersistentState();
  }
}

function getProvinceAreaKm2(provinceId: string): number {
  return Math.max(1, adm1ProvinceAreaById.get(provinceId) ?? 1_000);
}

function getProvinceDerivedColonizationCosts(
  provinceId: string,
  rates?: { pointsCostPer1000Km2: number; ducatsCostPer1000Km2: number },
): { pointsCost: number; ducatsCost: number } {
  const areaKm2 = getProvinceAreaKm2(provinceId);
  const areaFactor = Math.max(0.001, areaKm2 / 1000);
  const pointsRate = rates?.pointsCostPer1000Km2 ?? gameSettings.colonization.pointsCostPer1000Km2;
  const ducatsRate = rates?.ducatsCostPer1000Km2 ?? gameSettings.colonization.ducatsCostPer1000Km2;
  return {
    pointsCost: Math.max(1, Math.round(pointsRate * areaFactor)),
    ducatsCost: Math.max(0, Math.round(ducatsRate * areaFactor)),
  };
}

function getProvinceColonizationConfig(provinceId: string): { cost: number; disabled: boolean; manualCost: boolean } {
  const existing = worldBase.provinceColonizationByProvince[provinceId];
  if (existing && typeof existing.cost === "number" && Number.isFinite(existing.cost)) {
    const looksLikeLegacyAutoDefault = !existing.disabled && Math.floor(existing.cost) === DEFAULT_PROVINCE_COLONIZATION_COST;
    if (looksLikeLegacyAutoDefault) {
      const derived = getProvinceDerivedColonizationCosts(provinceId);
      return { cost: derived.pointsCost, disabled: false, manualCost: false };
    }
    return {
      cost: Math.max(1, Math.floor(existing.cost)),
      disabled: Boolean(existing.disabled),
      manualCost: Boolean((existing as { manualCost?: unknown }).manualCost),
    };
  }
  const derived = getProvinceDerivedColonizationCosts(provinceId);
  return { cost: derived.pointsCost, disabled: false, manualCost: false };
}

function migrateLegacyProvinceColonizationCosts(): number {
  let migrated = 0;
  for (const [provinceId, cfg] of Object.entries(worldBase.provinceColonizationByProvince ?? {})) {
    if (!cfg || typeof cfg !== "object") continue;
    const normalizedCost = Number(cfg.cost);
    const isLegacyDefault =
      Number.isFinite(normalizedCost) &&
      Math.floor(normalizedCost) === DEFAULT_PROVINCE_COLONIZATION_COST &&
      !cfg.disabled;
    if (!isLegacyDefault) continue;
    const derived = getProvinceDerivedColonizationCosts(provinceId);
    worldBase.provinceColonizationByProvince[provinceId] = {
      cost: derived.pointsCost,
      disabled: false,
      manualCost: false,
    };
    migrated += 1;
  }
  return migrated;
}

function recalculateAllProvinceColonizationCosts(previousRates?: {
  pointsCostPer1000Km2: number;
  ducatsCostPer1000Km2: number;
}): number {
  let updated = 0;
  for (const province of adm1ProvinceIndex) {
    const current = worldBase.provinceColonizationByProvince[province.id];
    const derived = getProvinceDerivedColonizationCosts(province.id);
    const nextCost = derived.pointsCost;
    const nextDisabled = Boolean(current?.disabled);
    const nextManualCost = Boolean((current as { manualCost?: unknown } | undefined)?.manualCost);
    const prevCost = current && typeof current.cost === "number" && Number.isFinite(current.cost) ? Math.max(1, Math.floor(current.cost)) : null;
    const previousDerivedCost = previousRates
      ? getProvinceDerivedColonizationCosts(province.id, previousRates).pointsCost
      : null;
    const isLegacyAutoDefault =
      current != null &&
      prevCost != null &&
      prevCost === DEFAULT_PROVINCE_COLONIZATION_COST &&
      !Boolean(current.disabled);
    const shouldPreserveManualCost =
      current != null &&
      prevCost != null &&
      previousDerivedCost != null &&
      prevCost !== previousDerivedCost &&
      !isLegacyAutoDefault;
    if (shouldPreserveManualCost) {
      if (!current || Boolean(current.disabled) === nextDisabled) {
        continue;
      }
      worldBase.provinceColonizationByProvince[province.id] = {
        cost: prevCost,
        disabled: nextDisabled,
        manualCost: nextManualCost,
      };
      continue;
    }
    if (prevCost === nextCost && Boolean(current?.disabled) === nextDisabled && nextManualCost === false) {
      continue;
    }
    worldBase.provinceColonizationByProvince[province.id] = {
      cost: nextCost,
      disabled: nextDisabled,
      manualCost: false,
    };
    updated += 1;
  }
  return updated;
}

function normalizeProvinceColonizationMap(
  input: unknown,
): Record<string, { cost: number; disabled: boolean; manualCost?: boolean }> {
  const normalized: Record<string, { cost: number; disabled: boolean; manualCost?: boolean }> = {};
  if (!input || typeof input !== "object") {
    return normalized;
  }

  for (const [provinceId, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const costRaw = (raw as { cost?: unknown }).cost;
    const disabledRaw = (raw as { disabled?: unknown }).disabled;
    const manualCostRaw = (raw as { manualCost?: unknown }).manualCost;
    normalized[provinceId] = {
      cost:
        typeof costRaw === "number" && Number.isFinite(costRaw)
          ? Math.max(1, Math.floor(costRaw))
          : DEFAULT_PROVINCE_COLONIZATION_COST,
      disabled: Boolean(disabledRaw),
      manualCost: typeof manualCostRaw === "boolean" ? manualCostRaw : undefined,
    };
  }

  return normalized;
}

function migrateProvinceManualCostFlags(): number {
  let migrated = 0;
  for (const [provinceId, cfg] of Object.entries(worldBase.provinceColonizationByProvince ?? {})) {
    if (!cfg || typeof cfg !== "object") continue;
    if (typeof (cfg as { manualCost?: unknown }).manualCost === "boolean") continue;
    const normalizedCost = Math.max(1, Math.floor(Number(cfg.cost ?? DEFAULT_PROVINCE_COLONIZATION_COST)));
    const derived = getProvinceDerivedColonizationCosts(provinceId).pointsCost;
    const isLegacyAutoDefault = !cfg.disabled && normalizedCost === DEFAULT_PROVINCE_COLONIZATION_COST;
    worldBase.provinceColonizationByProvince[provinceId] = {
      cost: normalizedCost,
      disabled: Boolean(cfg.disabled),
      manualCost: isLegacyAutoDefault ? false : normalizedCost !== derived,
    };
    migrated += 1;
  }
  return migrated;
}

function cleanupProvinceColonizationProgress(provinceId: string): void {
  delete worldBase.colonyProgressByProvince[provinceId];
  const turnOrders = ordersByTurn.get(turnId);
  if (!turnOrders) {
    return;
  }
  for (const [playerId, orders] of turnOrders.entries()) {
    const nextOrders = orders.filter((order) => !(order.type === "COLONIZE" && order.provinceId === provinceId));
    if (nextOrders.length !== orders.length) {
      if (nextOrders.length > 0) {
        turnOrders.set(playerId, nextOrders);
      } else {
        turnOrders.delete(playerId);
      }
    }
  }
  if (turnOrders.size === 0) {
    ordersByTurn.delete(turnId);
  }
}

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

function countryFromDb(row: { id: string; name: string; color: string; flagUrl: string | null; crestUrl: string | null; isAdmin: boolean; isLocked: boolean; blockedUntilTurn: number | null; blockedUntilAt: Date | null; ignoreUntilTurn: number | null; eventLogRetentionTurns?: number | null }): Country {
  return {
    ...row,
    blockedUntilAt: row.blockedUntilAt ? row.blockedUntilAt.toISOString() : null,
  };
}

function broadcastWorldBaseSync(wss: WebSocketServer): void {
  broadcast(wss, {
    type: "WORLD_BASE_SYNC",
    worldBase: {
      ...worldBase,
      turnId,
    },
    turnId,
  });
}

function getCountrySkipInfo(country: { ignoreUntilTurn: number | null }, currentTurn: number): { ignored: boolean; ignoreUntilTurn: number | null } {
  if (country.ignoreUntilTurn != null && currentTurn <= country.ignoreUntilTurn) {
    return { ignored: true, ignoreUntilTurn: country.ignoreUntilTurn };
  }
  return { ignored: false, ignoreUntilTurn: null };
}

function getCountryBlockInfo(
  country: { isLocked: boolean; blockedUntilTurn: number | null; blockedUntilAt: Date | null },
  currentTurn: number,
  now: Date,
): { blocked: boolean; reason: "PERMANENT" | "TURN" | "TIME" | null; blockedUntilTurn: number | null; blockedUntilAt: Date | null } {
  if (country.isLocked) {
    return { blocked: true, reason: "PERMANENT", blockedUntilTurn: null, blockedUntilAt: null };
  }

  if (country.blockedUntilTurn != null && currentTurn <= country.blockedUntilTurn) {
    return { blocked: true, reason: "TURN", blockedUntilTurn: country.blockedUntilTurn, blockedUntilAt: null };
  }

  if (country.blockedUntilAt != null && country.blockedUntilAt > now) {
    return { blocked: true, reason: "TIME", blockedUntilTurn: null, blockedUntilAt: country.blockedUntilAt };
  }

  return { blocked: false, reason: null, blockedUntilTurn: null, blockedUntilAt: null };
}

async function cleanupExpiredPunishments(currentTurn: number, now: Date): Promise<void> {
  await prisma.country.updateMany({
    where: {
      isLocked: false,
      blockedUntilTurn: { lt: currentTurn },
    },
    data: { blockedUntilTurn: null },
  });

  await prisma.country.updateMany({
    where: {
      isLocked: false,
      blockedUntilAt: { lt: now },
    },
    data: { blockedUntilAt: null },
  });
}
function validateImageDimensions(file: Express.Multer.File, maxSize = 256): boolean {
  const dimensions = imageSize(readFileSync(file.path));
  const width = dimensions.width ?? 0;
  const height = dimensions.height ?? 0;
  return width > 0 && height > 0 && width <= maxSize && height <= maxSize;
}

function readProvinceId(properties: Record<string, unknown> | undefined) {
  const raw = properties?.id ?? properties?.ID_1 ?? properties?.adm1_code ?? properties?.name;
  return raw == null ? "" : String(raw);
}

function readProvinceName(properties: Record<string, unknown> | undefined) {
  const raw = properties?.name ?? properties?.NAME_1 ?? properties?.gn_name ?? properties?.id;
  return raw == null ? "Провинция" : String(raw);
}

function removeUploadedFile(file?: Express.Multer.File): void {
  if (!file) {
    return;
  }

  try {
    unlinkSync(file.path);
  } catch {
    // Ignore cleanup errors
  }
}

function removeUploadedByUrl(url?: string | null): void {
  if (!url || !url.startsWith("/uploads/")) {
    return;
  }

  const rel = url.replace(/^\/uploads\//, "");
  const absolute = resolve(uploadsRoot, rel);
  try {
    unlinkSync(absolute);
  } catch {
    // Ignore cleanup errors
  }
}

function getReadySetForTurn(turn: number): Set<string> {
  let readySet = resolveReadyByTurn.get(turn);
  if (!readySet) {
    readySet = new Set<string>();
    resolveReadyByTurn.set(turn, readySet);
  }
  return readySet;
}

function resetTurnTimerAnchor(): void {
  currentTurnStartedAtMs = Date.now();
}

function resolveTurn(): { patch: WorldPatch; news: EventLogEntry[] } {
  const currentOrders = ordersByTurn.get(turnId) ?? new Map<string, Order[]>();
  const rejectedOrders: WorldPatch["rejectedOrders"] = [];
  const claimed = new Set<string>();
  const news: EventLogEntry[] = [];

  const colonizeTargetsByCountry = new Map<string, Set<string>>();

  for (const [provinceId, progressByCountry] of Object.entries(worldBase.colonyProgressByProvince)) {
    const provinceConfig = getProvinceColonizationConfig(provinceId);
    if (worldBase.provinceOwner[provinceId] || provinceConfig.disabled) {
      continue;
    }
    for (const countryId of Object.keys(progressByCountry)) {
      const byCountry = colonizeTargetsByCountry.get(countryId) ?? new Set<string>();
      byCountry.add(provinceId);
      colonizeTargetsByCountry.set(countryId, byCountry);
    }
  }

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

      if (order.type === "COLONIZE") {
        const provinceConfig = getProvinceColonizationConfig(order.provinceId);
        if (worldBase.provinceOwner[order.provinceId] || provinceConfig.disabled) {
          rejectedOrders.push({ playerId, reason: "PROVINCE_NOT_NEUTRAL", tempOrderId: order.id });
          continue;
        }

        const byCountry = colonizeTargetsByCountry.get(order.countryId) ?? new Set<string>();
        byCountry.add(order.provinceId);
        colonizeTargetsByCountry.set(order.countryId, byCountry);
      }
    }
  });

  for (const [countryId, targets] of colonizeTargetsByCountry.entries()) {
    const provinces = [...targets];
    if (provinces.length === 0) {
      continue;
    }

    const countryResource = worldBase.resourcesByCountry[countryId];
    const countryColonizationPoints = countryResource?.colonization ?? gameSettings.colonization.pointsPerTurn;
    let remainingCountrySupportDucats = Math.max(0, countryResource?.ducats ?? 0);
    if (countryColonizationPoints <= 0) {
      continue;
    }
    const gain = countryColonizationPoints / provinces.length;
    let spentColonizationPoints = 0;
    let spentSupportDucats = 0;
    for (const provinceId of provinces) {
      if (worldBase.provinceOwner[provinceId]) {
        continue;
      }
      const provinceConfig = getProvinceColonizationConfig(provinceId);
      if (provinceConfig.disabled) {
        continue;
      }
      const byCountry = worldBase.colonyProgressByProvince[provinceId] ?? {};
      const currentProgress = byCountry[countryId] ?? 0;
      const provinceCost = provinceConfig.cost || COLONIZATION_GOAL;
      const derivedCosts = getProvinceDerivedColonizationCosts(provinceId);
      const ducatRatio = provinceCost > 0 ? derivedCosts.ducatsCost / provinceCost : 0;
      const remainingToCapture = Math.max(0, provinceCost - currentProgress);
      if (remainingToCapture <= 0) {
        continue;
      }
      const spentDucatsForCurrentProgress = currentProgress * ducatRatio;
      const remainingProvinceDucats = Math.max(0, derivedCosts.ducatsCost - spentDucatsForCurrentProgress);
      const maxGainByCountryDucats = ducatRatio > 0 ? remainingCountrySupportDucats / ducatRatio : Number.POSITIVE_INFINITY;
      const maxGainByProvinceDucats = ducatRatio > 0 ? remainingProvinceDucats / ducatRatio : Number.POSITIVE_INFINITY;
      const appliedGain = Math.min(gain, remainingToCapture, maxGainByCountryDucats, maxGainByProvinceDucats);
      if (appliedGain <= 0) {
        continue;
      }
      const appliedDucats = ducatRatio > 0 ? Math.min(remainingProvinceDucats, appliedGain * ducatRatio, remainingCountrySupportDucats) : 0;
      byCountry[countryId] = currentProgress + appliedGain;
      spentColonizationPoints += appliedGain;
      spentSupportDucats += appliedDucats;
      remainingCountrySupportDucats = Math.max(0, remainingCountrySupportDucats - appliedDucats);
      worldBase.colonyProgressByProvince[provinceId] = byCountry;
    }
    if (countryResource) {
      countryResource.colonization = Math.max(0, countryResource.colonization - spentColonizationPoints);
      countryResource.ducats = Math.max(0, countryResource.ducats - spentSupportDucats);
    }

  }
  for (const [provinceId, progressByCountry] of Object.entries(worldBase.colonyProgressByProvince)) {
    if (worldBase.provinceOwner[provinceId]) {
      delete worldBase.colonyProgressByProvince[provinceId];
      continue;
    }
    if (getProvinceColonizationConfig(provinceId).disabled) {
      delete worldBase.colonyProgressByProvince[provinceId];
      continue;
    }

    const provinceCost = getProvinceColonizationConfig(provinceId).cost || COLONIZATION_GOAL;
    const candidates = Object.entries(progressByCountry).filter(([, value]) => value >= provinceCost);
    if (candidates.length === 0) {
      continue;
    }

    candidates.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const winnerCountryId = candidates[0][0];
    const previousOwnerId = worldBase.provinceOwner[provinceId] ?? null;
    worldBase.provinceOwner[provinceId] = winnerCountryId;
    delete worldBase.colonyProgressByProvince[provinceId];
    news.push(
      makeOfficialNews({
        turn: turnId,
        category: "colonization",
        title: "Успешная колонизация",
        message:
          previousOwnerId && previousOwnerId !== winnerCountryId
            ? `Провинция ${provinceId} перешла от ${previousOwnerId} к ${winnerCountryId}`
            : `Провинция ${provinceId} закреплена за ${winnerCountryId}`,
        countryId: winnerCountryId,
        priority: "medium",
        visibility: "public",
      }),
    );
  }

  for (const resource of Object.values(worldBase.resourcesByCountry)) {
    resource.colonization += gameSettings.colonization.pointsPerTurn;
    resource.ducats += gameSettings.economy.baseDucatsPerTurn;
    resource.gold += gameSettings.economy.baseGoldPerTurn;
  }

  turnId += 1;
  worldBase = {
    ...worldBase,
    turnId,
  };
  resetTurnTimerAnchor();

  ordersByTurn.delete(turnId - 1);
  resolveReadyByTurn.delete(turnId - 1);
  savePersistentState();

  return {
    patch: {
      type: "WORLD_PATCH",
      turnId,
      worldBase,
      rejectedOrders,
    },
    news,
  };
}

function resolveAndBroadcastCurrentTurn(wsServer: WebSocketServer): boolean {
  if (isResolvingTurnNow) {
    return false;
  }
  isResolvingTurnNow = true;
  try {
    const { patch, news } = resolveTurn();
    broadcast(wsServer, patch);
    for (const event of news) {
      broadcast(wsServer, { type: "NEWS_EVENT", event });
    }
    return true;
  } finally {
    isResolvingTurnNow = false;
  }
}

function broadcastTurnResolveStarted(wsServer: WebSocketServer, reason: "manual" | "admin" | "auto"): void {
  broadcast(wsServer, { type: "TURN_RESOLVE_STARTED", turnId, reason });
}

app.get("/health", async (_req, res) => {
  res.json({ status: env.serverStatus, turnId, serverTime: new Date().toISOString() });
});

app.get("/countries", async (_req, res) => {
  await cleanupExpiredPunishments(turnId, new Date());
  const countries = await prisma.country.findMany({ select: countrySelect, orderBy: { createdAt: "asc" } });
  res.json(countries.map(countryFromDb));
});

app.get("/turn/status", async (_req, res) => {
  const now = new Date();
  await cleanupExpiredPunishments(turnId, now);
  const countries = await prisma.country.findMany({
    select: {
      id: true,
      name: true,
      color: true,
      flagUrl: true,
      isLocked: true,
      blockedUntilTurn: true,
      blockedUntilAt: true,
      ignoreUntilTurn: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const readySet = getReadySetForTurn(turnId);

  const items = countries.map((country) => {
    const block = getCountryBlockInfo(country, turnId, now);
    const skip = getCountrySkipInfo(country, turnId);
    const ready = !block.blocked && !skip.ignored && readySet.has(country.id);
    const status = block.blocked ? "blocked" : skip.ignored ? "ignored" : ready ? "ready" : "waiting";

    return {
      id: country.id,
      name: country.name,
      color: country.color,
      flagUrl: country.flagUrl,
      status,
      blockedReason: block.reason,
      blockedUntilTurn: block.blockedUntilTurn,
      blockedUntilAt: block.blockedUntilAt ? block.blockedUntilAt.toISOString() : null,
      ignoreUntilTurn: skip.ignoreUntilTurn,
    };
  });

  const requiredCount = items.filter((item) => item.status !== "blocked" && item.status !== "ignored").length;
  const readyCount = items.filter((item) => item.status === "ready").length;

  res.json({ turnId, readyCount, requiredCount, countries: items });
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

async function isAdminCountry(countryId: string): Promise<boolean> {
  const country = await prisma.country.findUnique({
    where: { id: countryId },
    select: { isAdmin: true },
  });
  return Boolean(country?.isAdmin);
}

const gameSettingsSchema = z.object({
  economy: z
    .object({
      baseDucatsPerTurn: z.coerce.number().int().min(0).max(SETTINGS_MAX_NUMBER).optional(),
      baseGoldPerTurn: z.coerce.number().int().min(0).max(SETTINGS_MAX_NUMBER).optional(),
    })
    .optional(),
  colonization: z
    .object({
      maxActiveColonizations: z.coerce.number().int().min(1).max(1000).optional(),
      pointsPerTurn: z.coerce.number().int().min(0).max(SETTINGS_MAX_NUMBER).optional(),
      pointsCostPer1000Km2: z.coerce.number().int().min(1).max(SETTINGS_MAX_NUMBER).optional(),
      ducatsCostPer1000Km2: z.coerce.number().int().min(0).max(SETTINGS_MAX_NUMBER).optional(),
    })
    .optional(),
  customization: z
    .object({
      renameDucats: z.coerce.number().int().min(0).max(SETTINGS_MAX_NUMBER).optional(),
      recolorDucats: z.coerce.number().int().min(0).max(SETTINGS_MAX_NUMBER).optional(),
      flagDucats: z.coerce.number().int().min(0).max(SETTINGS_MAX_NUMBER).optional(),
      crestDucats: z.coerce.number().int().min(0).max(SETTINGS_MAX_NUMBER).optional(),
    })
    .optional(),
  eventLog: z
    .object({
      retentionTurns: z.coerce.number().int().min(1).max(100).optional(),
    })
    .optional(),
  turnTimer: z
    .object({
      enabled: z.boolean().optional(),
      secondsPerTurn: z.coerce.number().int().min(10).max(86_400).optional(),
    })
    .optional(),
  map: z
    .object({
      showAntarctica: z.boolean().optional(),
    })
    .optional(),
});

app.get("/game-settings/public", (_req, res) => {
  return res.json({
    economy: gameSettings.economy,
    colonization: gameSettings.colonization,
    customization: gameSettings.customization,
    eventLog: gameSettings.eventLog,
    turnTimer: {
      ...gameSettings.turnTimer,
      currentTurnStartedAtMs,
    },
    map: gameSettings.map,
    resourceIcons: gameSettings.resourceIcons,
  });
});

app.patch(
  "/admin/resource-icons",
  upload.fields([
    { name: "culture", maxCount: 1 },
    { name: "science", maxCount: 1 },
    { name: "religion", maxCount: 1 },
    { name: "colonization", maxCount: 1 },
    { name: "ducats", maxCount: 1 },
    { name: "gold", maxCount: 1 },
  ]),
  async (req, res) => {
    const auth = parseAuthHeader(req);
    if (!auth || !(await isAdminCountry(auth.countryId))) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const files = req.files as Record<string, Express.Multer.File[] | undefined> | undefined;
    const nextFiles: Partial<Record<keyof GameSettings["resourceIcons"], Express.Multer.File>> = {
      culture: files?.culture?.[0],
      science: files?.science?.[0],
      religion: files?.religion?.[0],
      colonization: files?.colonization?.[0],
      ducats: files?.ducats?.[0],
      gold: files?.gold?.[0],
    };

    const uploaded = Object.values(nextFiles).filter(Boolean) as Express.Multer.File[];
    if (uploaded.length === 0) {
      return res.status(400).json({ error: "NO_FILES" });
    }

    for (const [key, file] of Object.entries(nextFiles)) {
      if (!file) continue;
      if (!validateImageDimensions(file, 64)) {
        for (const uploadedFile of uploaded) {
          removeUploadedFile(uploadedFile);
        }
        return res.status(400).json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", field: key, max: "64x64" });
      }
    }

    for (const [key, file] of Object.entries(nextFiles) as Array<[keyof GameSettings["resourceIcons"], Express.Multer.File | undefined]>) {
      if (!file) continue;
      const previousUrl = gameSettings.resourceIcons[key];
      gameSettings.resourceIcons[key] = `/uploads/resource-icons/${file.filename}`;
      if (previousUrl) {
        removeUploadedByUrl(previousUrl);
      }
    }

    savePersistentState();
    broadcast(wss, {
      type: "NEWS_EVENT",
      event: makeOfficialNews({
        turn: turnId,
        category: "system",
        title: "Иконки ресурсов обновлены",
        message: "Администратор обновил иконки очков/ресурсов в интерфейсе",
        countryId: auth.countryId,
        priority: "low",
        visibility: "public",
      }),
    });

    return res.json({ resourceIcons: gameSettings.resourceIcons });
  },
);

app.get("/admin/game-settings", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }

  return res.json(gameSettings);
});

app.patch("/admin/game-settings", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }

  const parsed = gameSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  const nextEconomy = parsed.data.economy;
  if (nextEconomy) {
    if (typeof nextEconomy.baseDucatsPerTurn === "number") {
      gameSettings.economy.baseDucatsPerTurn = nextEconomy.baseDucatsPerTurn;
    }
    if (typeof nextEconomy.baseGoldPerTurn === "number") {
      gameSettings.economy.baseGoldPerTurn = nextEconomy.baseGoldPerTurn;
    }
  }

  const nextColonization = parsed.data.colonization;
  let provinceColonizationCostsRecalculated = 0;
  if (nextColonization) {
    const prevPointsCostPer1000Km2 = gameSettings.colonization.pointsCostPer1000Km2;
    const prevDucatsCostPer1000Km2 = gameSettings.colonization.ducatsCostPer1000Km2;
    if (typeof nextColonization.maxActiveColonizations === "number") {
      gameSettings.colonization.maxActiveColonizations = nextColonization.maxActiveColonizations;
    }
    if (typeof nextColonization.pointsPerTurn === "number") {
      gameSettings.colonization.pointsPerTurn = nextColonization.pointsPerTurn;
    }
    if (typeof nextColonization.pointsCostPer1000Km2 === "number") {
      gameSettings.colonization.pointsCostPer1000Km2 = nextColonization.pointsCostPer1000Km2;
    }
    if (typeof nextColonization.ducatsCostPer1000Km2 === "number") {
      gameSettings.colonization.ducatsCostPer1000Km2 = nextColonization.ducatsCostPer1000Km2;
    }
    const colonizationPriceFormulaChanged =
      prevPointsCostPer1000Km2 !== gameSettings.colonization.pointsCostPer1000Km2 ||
      prevDucatsCostPer1000Km2 !== gameSettings.colonization.ducatsCostPer1000Km2;
    if (colonizationPriceFormulaChanged) {
      provinceColonizationCostsRecalculated = recalculateAllProvinceColonizationCosts({
        pointsCostPer1000Km2: prevPointsCostPer1000Km2,
        ducatsCostPer1000Km2: prevDucatsCostPer1000Km2,
      });
    }
  }

  const nextCustomization = parsed.data.customization;
  if (nextCustomization) {
    if (typeof nextCustomization.renameDucats === "number") {
      gameSettings.customization.renameDucats = nextCustomization.renameDucats;
    }
    if (typeof nextCustomization.recolorDucats === "number") {
      gameSettings.customization.recolorDucats = nextCustomization.recolorDucats;
    }
    if (typeof nextCustomization.flagDucats === "number") {
      gameSettings.customization.flagDucats = nextCustomization.flagDucats;
    }
    if (typeof nextCustomization.crestDucats === "number") {
      gameSettings.customization.crestDucats = nextCustomization.crestDucats;
    }
  }

  const nextEventLog = parsed.data.eventLog;
  if (nextEventLog) {
    if (typeof nextEventLog.retentionTurns === "number") {
      gameSettings.eventLog.retentionTurns = nextEventLog.retentionTurns;
    }
  }

  const nextTurnTimer = parsed.data.turnTimer;
  let turnTimerConfigChanged = false;
  if (nextTurnTimer) {
    if (typeof nextTurnTimer.enabled === "boolean") {
      if (gameSettings.turnTimer.enabled !== nextTurnTimer.enabled) {
        turnTimerConfigChanged = true;
      }
      gameSettings.turnTimer.enabled = nextTurnTimer.enabled;
    }
    if (typeof nextTurnTimer.secondsPerTurn === "number") {
      const nextSeconds = Math.max(10, Math.floor(nextTurnTimer.secondsPerTurn));
      if (gameSettings.turnTimer.secondsPerTurn !== nextSeconds) {
        turnTimerConfigChanged = true;
      }
      gameSettings.turnTimer.secondsPerTurn = nextSeconds;
    }
    if (turnTimerConfigChanged) {
      resetTurnTimerAnchor();
    }
  }

  const nextMap = parsed.data.map;
  if (nextMap) {
    if (typeof nextMap.showAntarctica === "boolean") {
      gameSettings.map.showAntarctica = nextMap.showAntarctica;
    }
  }

  const changedSections = [
    parsed.data.economy ? "экономика" : null,
    parsed.data.colonization ? "колонизация" : null,
    parsed.data.customization ? "кастомизация" : null,
    parsed.data.eventLog ? "журнал событий" : null,
    parsed.data.turnTimer ? "таймер хода" : null,
    parsed.data.map ? "карта" : null,
  ].filter((v): v is string => Boolean(v));

  savePersistentState();
  if (provinceColonizationCostsRecalculated > 0) {
    broadcastWorldBaseSync(wss);
  }
  if (changedSections.length > 0) {
    broadcast(wss, {
      type: "NEWS_EVENT",
      event: makeOfficialNews({
        turn: turnId,
        category: "system",
        title: "Настройки игры изменены",
        message:
          `Администратор обновил разделы: ${changedSections.join(", ")}` +
          (provinceColonizationCostsRecalculated > 0 ? `; пересчитаны цены провинций: ${provinceColonizationCostsRecalculated}` : ""),
        countryId: auth.countryId,
        priority: "medium",
        visibility: "public",
      }),
    });
  }
  return res.json(gameSettings);
});

const colonizationActionSchema = z.object({
  provinceId: z.string().min(1),
});

app.post("/country/colonization/start", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  const parsed = colonizationActionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  const { provinceId } = parsed.data;
  const provinceConfig = getProvinceColonizationConfig(provinceId);

  if (worldBase.provinceOwner[provinceId]) {
    return res.status(400).json({ error: "PROVINCE_NOT_NEUTRAL" });
  }
  if (provinceConfig.disabled) {
    return res.status(400).json({ error: "COLONIZATION_DISABLED" });
  }

  ensureCountryInWorldBase(auth.countryId);
  const resources = worldBase.resourcesByCountry[auth.countryId];
  if (!resources) {
    return res.status(500).json({ error: "NO_RESOURCES" });
  }

  const existing = worldBase.colonyProgressByProvince[provinceId] ?? {};
  if (existing[auth.countryId] != null) {
    return res.status(400).json({ error: "ALREADY_COLONIZING" });
  }

  const activeColonizeTargets = new Set<string>();
  for (const [pid, progressByCountry] of Object.entries(worldBase.colonyProgressByProvince)) {
    if (!worldBase.provinceOwner[pid] && !getProvinceColonizationConfig(pid).disabled && progressByCountry[auth.countryId] != null) {
      activeColonizeTargets.add(pid);
    }
  }
  const turnOrders = ordersByTurn.get(turnId);
  if (turnOrders) {
    for (const list of turnOrders.values()) {
      for (const order of list) {
        if (order.type === "COLONIZE" && order.countryId === auth.countryId) {
          activeColonizeTargets.add(order.provinceId);
        }
      }
    }
  }

  if (activeColonizeTargets.size >= gameSettings.colonization.maxActiveColonizations) {
    return res.status(400).json({
      error: "COLONIZE_LIMIT",
      current: activeColonizeTargets.size,
      limit: gameSettings.colonization.maxActiveColonizations,
    });
  }

  worldBase.colonyProgressByProvince[provinceId] = {
    ...existing,
    [auth.countryId]: 0,
  };

  savePersistentState();
  broadcastWorldBaseSync(wss);
  broadcast(wss, {
    type: "NEWS_EVENT",
    event: makeOfficialNews({
      turn: turnId,
      category: "colonization",
      title: "Начало колонизации",
      message: `${auth.countryId} начал колонизацию провинции ${provinceId}`,
      countryId: auth.countryId,
      priority: "low",
      visibility: "public",
    }),
  });

  return res.json({ ok: true, worldBase, turnId, chargedDucats: 0 });
});

app.post("/country/colonization/cancel", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  const parsed = colonizationActionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  const { provinceId } = parsed.data;
  const progress = worldBase.colonyProgressByProvince[provinceId];
  if (!progress || progress[auth.countryId] == null) {
    return res.status(404).json({ error: "COLONIZATION_NOT_FOUND" });
  }

  delete progress[auth.countryId];
  if (Object.keys(progress).length === 0) {
    delete worldBase.colonyProgressByProvince[provinceId];
  } else {
    worldBase.colonyProgressByProvince[provinceId] = progress;
  }

  const turnOrders = ordersByTurn.get(turnId);
  if (turnOrders) {
    for (const [playerId, orders] of turnOrders.entries()) {
      const filtered = orders.filter((order) => !(order.type === "COLONIZE" && order.countryId === auth.countryId && order.provinceId === provinceId));
      if (filtered.length !== orders.length) {
        if (filtered.length > 0) {
          turnOrders.set(playerId, filtered);
        } else {
          turnOrders.delete(playerId);
        }
      }
    }
    if (turnOrders.size === 0) {
      ordersByTurn.delete(turnId);
    }
  }

  savePersistentState();
  broadcastWorldBaseSync(wss);
  broadcast(wss, {
    type: "NEWS_EVENT",
    event: makeOfficialNews({
      turn: turnId,
      category: "colonization",
      title: "Отмена колонизации",
      message: `${auth.countryId} отменил колонизацию провинции ${provinceId}`,
      countryId: auth.countryId,
      priority: "low",
      visibility: "public",
    }),
  });

  return res.json({ ok: true, worldBase, turnId });
});

const adminProvinceColonizationSchema = z.object({
  colonizationCost: z.coerce.number().int().min(1).max(SETTINGS_MAX_NUMBER).optional(),
  colonizationDisabled: z.boolean().optional(),
  ownerCountryId: z.string().min(1).nullable().optional(),
  resetColonizationCostToAuto: z.boolean().optional(),
});

app.get("/admin/provinces", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }

  const searchQuery = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const source = searchQuery
    ? adm1ProvinceIndex.filter((province) => province.name.toLowerCase().includes(searchQuery) || province.id.toLowerCase().includes(searchQuery))
    : adm1ProvinceIndex;

  const provinces = source.map((province) => {
    const provinceId = province.id;
    const provinceName = province.name;
    const cfg = getProvinceColonizationConfig(provinceId);
    return {
      id: provinceId,
      name: provinceName,
      areaKm2: province.areaKm2,
      ownerCountryId: worldBase.provinceOwner[provinceId] ?? null,
      colonizationCost: cfg.cost,
      colonizationDisabled: cfg.disabled,
      manualCost: cfg.manualCost,
      colonyProgressByCountry: worldBase.colonyProgressByProvince[provinceId] ?? {},
    };
  });

  return res.json({ provinces });
});

app.get("/provinces/index", async (_req, res) => {
  return res.json({
    provinces: adm1ProvinceIndex.map((province) => ({
      id: province.id,
      name: province.name,
      areaKm2: province.areaKm2,
    })),
  });
});

app.patch("/admin/provinces/:provinceId", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }

  const parsed = adminProvinceColonizationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  const provinceId = String(req.params.provinceId);
  const provinceIndexEntry = adm1ProvinceIndex.find((f) => f.id === provinceId);
  if (!provinceIndexEntry) {
    return res.status(404).json({ error: "PROVINCE_NOT_FOUND" });
  }

  const cfg = getProvinceColonizationConfig(provinceId);
  let clearedProgress = false;

  if (parsed.data.resetColonizationCostToAuto) {
    const derived = getProvinceDerivedColonizationCosts(provinceId);
    cfg.cost = derived.pointsCost;
    cfg.manualCost = false;
  } else if (typeof parsed.data.colonizationCost === "number") {
    cfg.cost = Math.max(1, Math.floor(parsed.data.colonizationCost));
    cfg.manualCost = true;
  }
  if (typeof parsed.data.colonizationDisabled === "boolean") {
    cfg.disabled = parsed.data.colonizationDisabled;
    if (cfg.disabled) {
      cleanupProvinceColonizationProgress(provinceId);
      clearedProgress = true;
    }
  }
  worldBase.provinceColonizationByProvince[provinceId] = cfg;

  if (parsed.data.ownerCountryId !== undefined) {
    const nextOwner = parsed.data.ownerCountryId;
    if (nextOwner) {
      const ownerExists = await prisma.country.findUnique({ where: { id: nextOwner }, select: { id: true } });
      if (!ownerExists) {
        return res.status(404).json({ error: "COUNTRY_NOT_FOUND" });
      }
      ensureCountryInWorldBase(nextOwner);
      worldBase.provinceOwner[provinceId] = nextOwner;
    } else {
      delete worldBase.provinceOwner[provinceId];
    }
    cleanupProvinceColonizationProgress(provinceId);
    clearedProgress = true;
  }

  savePersistentState();
  broadcastWorldBaseSync(wss);
  if (parsed.data.colonizationDisabled !== undefined || parsed.data.colonizationCost !== undefined || parsed.data.ownerCountryId !== undefined) {
    broadcast(wss, {
      type: "NEWS_EVENT",
      event: makeOfficialNews({
        turn: turnId,
        category: "colonization",
        title: "Провинция обновлена",
        message: `Администратор обновил колонизационные параметры провинции ${provinceId}${clearedProgress ? " (прогресс очищен)" : ""}`,
        countryId: auth.countryId,
        priority: "low",
        visibility: "public",
      }),
    });
  }

  return res.json({
    province: {
      id: provinceId,
      name: provinceIndexEntry.name,
      areaKm2: provinceIndexEntry.areaKm2,
      ownerCountryId: worldBase.provinceOwner[provinceId] ?? null,
      colonizationCost: cfg.cost,
      colonizationDisabled: cfg.disabled,
      manualCost: cfg.manualCost,
      colonyProgressByCountry: worldBase.colonyProgressByProvince[provinceId] ?? {},
    },
  });
});

app.post("/admin/provinces/recalculate-auto-costs", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const updatedCount = recalculateAllProvinceColonizationCosts();
  savePersistentState();
  if (updatedCount > 0) {
    broadcastWorldBaseSync(wss);
    broadcast(wss, {
      type: "NEWS_EVENT",
      event: makeOfficialNews({
        turn: turnId,
        category: "colonization",
        title: "Пересчёт цен провинций",
        message: `Администратор пересчитал авто-цены колонизации для ${updatedCount} провинций`,
        countryId: auth.countryId,
        priority: "low",
        visibility: "public",
      }),
    });
  }
  return res.json({ ok: true, updatedCount });
});

app.patch("/admin/countries/:countryId/admin", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
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

const adminCountryUpdateSchema = z.object({
  countryName: z.string().min(2).max(32).optional(),
  countryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isAdmin: z
    .string()
    .optional()
    .transform((v) => (v == null ? undefined : v === "true")),
  ignoreUntilTurn: z
    .string()
    .optional()
    .transform((v) => {
      if (v == null || v.trim() === "") {
        return undefined;
      }
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : undefined;
    }),
});

app.patch("/admin/countries/:countryId", upload.fields([{ name: "flag", maxCount: 1 }, { name: "crest", maxCount: 1 }]), async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }

  const parsed = adminCountryUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  const countryIdParam = String(req.params.countryId);
  const target = await prisma.country.findUnique({ where: { id: countryIdParam } });
  if (!target) {
    return res.status(404).json({ error: "COUNTRY_NOT_FOUND" });
  }

  const files = req.files as { flag?: Express.Multer.File[]; crest?: Express.Multer.File[] } | undefined;
  const flagFile = files?.flag?.[0];
  const crestFile = files?.crest?.[0];

  if (flagFile && !validateImageDimensions(flagFile)) {
    removeUploadedFile(flagFile);
    removeUploadedFile(crestFile);
    return res.status(400).json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", field: "flag", max: "256x256" });
  }

  if (crestFile && !validateImageDimensions(crestFile)) {
    removeUploadedFile(flagFile);
    removeUploadedFile(crestFile);
    return res.status(400).json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", field: "crest", max: "256x256" });
  }

  const data: { name?: string; color?: string; isAdmin?: boolean; ignoreUntilTurn?: number | null; flagUrl?: string | null; crestUrl?: string | null } = {};
  if (parsed.data.countryName) {
    data.name = parsed.data.countryName;
  }
  if (parsed.data.countryColor) {
    data.color = parsed.data.countryColor;
  }
  if (parsed.data.isAdmin !== undefined) {
    data.isAdmin = parsed.data.isAdmin;
  }
  if (parsed.data.ignoreUntilTurn !== undefined) {
    data.ignoreUntilTurn = parsed.data.ignoreUntilTurn === 0 ? null : parsed.data.ignoreUntilTurn;
  }
  if (flagFile) {
    data.flagUrl = `/uploads/flags/${flagFile.filename}`;
  }
  if (crestFile) {
    data.crestUrl = `/uploads/crests/${crestFile.filename}`;
  }

  try {
    const updated = await prisma.country.update({
      where: { id: target.id },
      data,
      select: countrySelect,
    });

    if (flagFile) {
      removeUploadedByUrl(target.flagUrl);
    }
    if (crestFile) {
      removeUploadedByUrl(target.crestUrl);
    }

    return res.json(countryFromDb(updated));
  } catch {
    removeUploadedFile(flagFile);
    removeUploadedFile(crestFile);
    return res.status(409).json({ error: "COUNTRY_UPDATE_FAILED" });
  }
});

app.delete("/admin/countries/:countryId", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }

  const countryIdParam = String(req.params.countryId);

  if (auth.countryId === countryIdParam) {
    return res.status(400).json({ error: "CANNOT_DELETE_SELF" });
  }

  const target = await prisma.country.findUnique({ where: { id: countryIdParam } });
  if (!target) {
    return res.status(404).json({ error: "COUNTRY_NOT_FOUND" });
  }

  await prisma.country.delete({ where: { id: countryIdParam } });

  removeUploadedByUrl(target.flagUrl);
  removeUploadedByUrl(target.crestUrl);

  delete worldBase.resourcesByCountry[countryIdParam];
  for (const [provinceId, ownerId] of Object.entries(worldBase.provinceOwner)) {
    if (ownerId === countryIdParam) {
      delete worldBase.provinceOwner[provinceId];
    }
  }
  for (const progress of Object.values(worldBase.colonyProgressByProvince)) {
    delete progress[countryIdParam];
  }
  for (const [provinceId, progress] of Object.entries(worldBase.colonyProgressByProvince)) {
    if (Object.keys(progress).length === 0) {
      delete worldBase.colonyProgressByProvince[provinceId];
    }
  }

  savePersistentState();
  broadcastWorldBaseSync(wss);
  broadcast(wss, {
    type: "NEWS_EVENT",
    event: makeOfficialNews({
      turn: turnId,
      category: "politics",
      title: "Страна удалена",
      message: `Администратор удалил страну ${target.name}`,
      countryId: countryIdParam,
      priority: "high",
      visibility: "public",
    }),
  });
  return res.json({ ok: true });
});

const selfCountryCustomizationSchema = z.object({
  countryName: z.string().min(2).max(32).optional(),
  countryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const clientSettingsSchema = z.object({
  eventLogRetentionTurns: z.coerce.number().int().min(1).max(100).optional(),
});

app.patch("/country/client-settings", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  const parsed = clientSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  return res.status(400).json({ error: "CLIENT_SETTING_MOVED_TO_ADMIN_GAME_SETTINGS" });
});

app.patch("/country/customization", upload.fields([{ name: "flag", maxCount: 1 }, { name: "crest", maxCount: 1 }]), async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  const parsed = selfCountryCustomizationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  const target = await prisma.country.findUnique({ where: { id: auth.countryId } });
  if (!target) {
    return res.status(404).json({ error: "COUNTRY_NOT_FOUND" });
  }

  const files = req.files as { flag?: Express.Multer.File[]; crest?: Express.Multer.File[] } | undefined;
  const flagFile = files?.flag?.[0];
  const crestFile = files?.crest?.[0];

  if (flagFile && !validateImageDimensions(flagFile)) {
    removeUploadedFile(flagFile);
    removeUploadedFile(crestFile);
    return res.status(400).json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", field: "flag", max: "256x256" });
  }

  if (crestFile && !validateImageDimensions(crestFile)) {
    removeUploadedFile(flagFile);
    removeUploadedFile(crestFile);
    return res.status(400).json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", field: "crest", max: "256x256" });
  }

  const normalizedName = parsed.data.countryName?.trim();
  const normalizedColor = parsed.data.countryColor?.toLowerCase();

  const nameChanged = typeof normalizedName === "string" && normalizedName.length > 0 && normalizedName !== target.name;
  const colorChanged = typeof normalizedColor === "string" && normalizedColor !== target.color.toLowerCase();
  const flagChanged = Boolean(flagFile);
  const crestChanged = Boolean(crestFile);

  if (!nameChanged && !colorChanged && !flagChanged && !crestChanged) {
    removeUploadedFile(flagFile);
    removeUploadedFile(crestFile);
    return res.status(400).json({ error: "NO_CHANGES" });
  }

  const costBreakdown = {
    rename: nameChanged ? gameSettings.customization.renameDucats : 0,
    recolor: colorChanged ? gameSettings.customization.recolorDucats : 0,
    flag: flagChanged ? gameSettings.customization.flagDucats : 0,
    crest: crestChanged ? gameSettings.customization.crestDucats : 0,
  };
  const totalCost =
    costBreakdown.rename +
    costBreakdown.recolor +
    costBreakdown.flag +
    costBreakdown.crest;

  ensureCountryInWorldBase(auth.countryId);
  const countryResource = worldBase.resourcesByCountry[auth.countryId];
  if (!countryResource) {
    removeUploadedFile(flagFile);
    removeUploadedFile(crestFile);
    return res.status(500).json({ error: "NO_RESOURCES" });
  }
  if (countryResource.ducats < totalCost) {
    removeUploadedFile(flagFile);
    removeUploadedFile(crestFile);
    return res.status(400).json({
      error: "INSUFFICIENT_DUCATS",
      required: totalCost,
      available: countryResource.ducats,
      costBreakdown,
    });
  }

  const data: { name?: string; color?: string; flagUrl?: string | null; crestUrl?: string | null } = {};
  if (nameChanged) {
    data.name = normalizedName;
  }
  if (colorChanged) {
    data.color = normalizedColor;
  }
  if (flagFile) {
    data.flagUrl = `/uploads/flags/${flagFile.filename}`;
  }
  if (crestFile) {
    data.crestUrl = `/uploads/crests/${crestFile.filename}`;
  }

  try {
    const updated = await prisma.country.update({
      where: { id: auth.countryId },
      data,
      select: countrySelect,
    });

    if (flagFile) {
      removeUploadedByUrl(target.flagUrl);
    }
    if (crestFile) {
      removeUploadedByUrl(target.crestUrl);
    }

    countryResource.ducats = Math.max(0, countryResource.ducats - totalCost);
    savePersistentState();

    return res.json({
      country: countryFromDb(updated),
      chargedDucats: totalCost,
      costBreakdown,
      resources: worldBase.resourcesByCountry[auth.countryId],
    });
  } catch {
    removeUploadedFile(flagFile);
    removeUploadedFile(crestFile);
    return res.status(409).json({ error: "COUNTRY_UPDATE_FAILED" });
  }
});

const punishSchema = z
  .object({
    action: z.enum(["unlock", "permanent", "turns", "time"]),
    turns: z.coerce.number().int().min(1).max(5000).optional(),
    blockedUntilAt: z.string().datetime().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.action === "turns" && !val.turns) {
      ctx.addIssue({ code: "custom", path: ["turns"], message: "turns_required" });
    }
    if (val.action === "time" && !val.blockedUntilAt) {
      ctx.addIssue({ code: "custom", path: ["blockedUntilAt"], message: "time_required" });
    }
  });

app.patch("/admin/countries/:countryId/punishments", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }

  const countryIdParam = String(req.params.countryId);
  const target = await prisma.country.findUnique({ where: { id: countryIdParam } });
  if (!target) {
    return res.status(404).json({ error: "COUNTRY_NOT_FOUND" });
  }

  const parsed = punishSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  const input = parsed.data;
  let data: { isLocked?: boolean; blockedUntilTurn?: number | null; blockedUntilAt?: Date | null } = {};

  if (input.action === "unlock") {
    data = { isLocked: false, blockedUntilTurn: null, blockedUntilAt: null };
  }

  if (input.action === "permanent") {
    data = { isLocked: true, blockedUntilTurn: null, blockedUntilAt: null };
  }

  if (input.action === "turns") {
    data = { isLocked: false, blockedUntilTurn: turnId + (input.turns ?? 0), blockedUntilAt: null };
  }

  if (input.action === "time") {
    const until = new Date(input.blockedUntilAt ?? "");
    if (Number.isNaN(until.getTime()) || until <= new Date()) {
      return res.status(400).json({ error: "INVALID_TIME" });
    }
    data = { isLocked: false, blockedUntilTurn: null, blockedUntilAt: until };
  }

  const updated = await prisma.country.update({ where: { id: countryIdParam }, data, select: countrySelect });
  const punishmentNewsMessage =
    input.action === "unlock"
      ? `С страны ${updated.name} сняты ограничения`
      : input.action === "permanent"
        ? `Страна ${updated.name} заблокирована бессрочно`
        : input.action === "turns"
          ? `Страна ${updated.name} заблокирована до хода #${data.blockedUntilTurn ?? turnId}`
          : `Страна ${updated.name} заблокирована по времени`;
  broadcast(wss, {
    type: "NEWS_EVENT",
    event: makeOfficialNews({
      turn: turnId,
      category: "politics",
      title: "Изменение ограничений страны",
      message: punishmentNewsMessage,
      countryId: updated.id,
      priority: input.action === "unlock" ? "medium" : "high",
      visibility: "public",
    }),
  });
  return res.json(countryFromDb(updated));
});

app.post("/auth/register", upload.fields([{ name: "flag", maxCount: 1 }, { name: "crest", maxCount: 1 }]), async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  const files = req.files as { flag?: Express.Multer.File[]; crest?: Express.Multer.File[] } | undefined;
  const flagFile = files?.flag?.[0];
  const crestFile = files?.crest?.[0];

  if (flagFile && !validateImageDimensions(flagFile)) {
    removeUploadedFile(flagFile);
    removeUploadedFile(crestFile);
    return res.status(400).json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", field: "flag", max: "256x256" });
  }

  if (crestFile && !validateImageDimensions(crestFile)) {
    removeUploadedFile(flagFile);
    removeUploadedFile(crestFile);
    return res.status(400).json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", field: "crest", max: "256x256" });
  }

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
      worldBase.resourcesByCountry[country.id] = {
        culture: 5,
        science: 5,
        religion: 5,
        colonization: gameSettings.colonization.pointsPerTurn,
        ducats: 20,
        gold: 80,
      };
    }

    savePersistentState();
    broadcast(wss, {
      type: "NEWS_EVENT",
      event: makeOfficialNews({
        turn: turnId,
        category: "politics",
        title: "Новая страна",
        message: `Зарегистрирована страна ${country.name}`,
        countryId: country.id,
        priority: "medium",
        visibility: "public",
      }),
    });
    return res.status(201).json(countryFromDb(country));
  } catch {
    removeUploadedFile(flagFile);
    removeUploadedFile(crestFile);
    return res.status(409).json({ error: "COUNTRY_EXISTS" });
  }
});

app.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body satisfies LoginPayload);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  const { countryId, password, rememberMe } = parsed.data;
  const now = new Date();
  await cleanupExpiredPunishments(turnId, now);
  const country = await prisma.country.findUnique({ where: { id: countryId } });

  if (!country) {
    return res.status(404).json({ error: "COUNTRY_NOT_FOUND" });
  }

  const block = getCountryBlockInfo(country, turnId, now);

  if (block.blocked) {
    if (block.reason === "PERMANENT") {
      return res.status(403).json({ error: "ACCOUNT_LOCKED", reason: "PERMANENT" });
    }

    if (block.reason === "TURN") {
      return res.status(403).json({
        error: "ACCOUNT_LOCKED",
        reason: "TURN",
        blockedUntilTurn: block.blockedUntilTurn,
        currentTurn: turnId,
      });
    }

    return res.status(403).json({
      error: "ACCOUNT_LOCKED",
      reason: "TIME",
      blockedUntilAt: block.blockedUntilAt?.toISOString() ?? null,
    });
  }

  const ok = await bcrypt.compare(password, country.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "INVALID_PASSWORD" });
  }

  ensureCountryInWorldBase(country.id);
  const token = createToken({ id: `player-${country.id}`, countryId: country.id, isAdmin: country.isAdmin }, rememberMe);
  return res.json({
    token,
    playerId: `player-${country.id}`,
    countryId: country.id,
    isAdmin: country.isAdmin,
    worldBase,
    turnId,
    clientSettings: { eventLogRetentionTurns: gameSettings.eventLog.retentionTurns },
  });
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
  let playerCountryId: string | null = null;
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
        playerCountryId = payload.countryId;
        const country = await prisma.country.findUnique({
          where: { id: payload.countryId },
          select: { id: true, isAdmin: true, eventLogRetentionTurns: true },
        });
        if (!country) {
          send({ type: "ERROR", code: "UNAUTHORIZED", message: "Country not found" });
          return;
        }
        isAdmin = Boolean(country.isAdmin);
        onlinePlayers.add(payload.id);
        ensureCountryInWorldBase(payload.countryId);
        send({
          type: "AUTH_OK",
          playerId: payload.id,
          countryId: payload.countryId,
          isAdmin,
          worldBase,
          turnId,
          clientSettings: { eventLogRetentionTurns: gameSettings.eventLog.retentionTurns },
        });
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

      if (!playerCountryId || delta.order.playerId !== playerId || delta.order.countryId !== playerCountryId) {
        send({ type: "ERROR", code: "FORBIDDEN", message: "Order does not match authenticated country" });
        return;
      }

      if (delta.order.turnId !== turnId) {
        send({ type: "ERROR", code: "TURN_MISMATCH", message: "Order for stale turn" });
        return;
      }

      ensureCountryInWorldBase(delta.order.countryId);
      const countryResource = worldBase.resourcesByCountry[delta.order.countryId];
      if (!countryResource) {
        send({ type: "ERROR", code: "NO_RESOURCES", message: "Ресурсы страны не инициализированы" });
        return;
      }

      if (delta.order.type !== "COLONIZE" && countryResource.ducats <= 0) {
        send({ type: "ERROR", code: "NO_RESOURCES", message: "Недостаточно дукатов для приказа" });
        return;
      }

      const order: Order = {
        ...delta.order,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };

      const turnOrders = ordersByTurn.get(turnId) ?? new Map<string, Order[]>();
      const playerOrders = turnOrders.get(playerId) ?? [];

      if (delta.order.type === "COLONIZE") {
        const provinceConfig = getProvinceColonizationConfig(delta.order.provinceId);
        if (worldBase.provinceOwner[delta.order.provinceId]) {
          send({ type: "ERROR", code: "PROVINCE_NOT_NEUTRAL", message: "Province is not neutral" });
          return;
        }
        if (provinceConfig.disabled) {
          send({ type: "ERROR", code: "COLONIZATION_DISABLED", message: "Колонизация этой провинции запрещена" });
          return;
        }

        if ((worldBase.colonyProgressByProvince[delta.order.provinceId] ?? {})[delta.order.countryId] != null) {
          send({ type: "ERROR", code: "ALREADY_COLONIZING", message: "This province is already in your colonization process" });
          return;
        }

        const activeColonizeTargets = new Set<string>();

        for (const [provinceId, progressByCountry] of Object.entries(worldBase.colonyProgressByProvince)) {
          if (!worldBase.provinceOwner[provinceId] && !getProvinceColonizationConfig(provinceId).disabled && progressByCountry[delta.order.countryId] != null) {
            activeColonizeTargets.add(provinceId);
          }
        }

        for (const list of turnOrders.values()) {
          for (const queued of list) {
            if (queued.type === "COLONIZE" && queued.countryId === delta.order.countryId) {
              activeColonizeTargets.add(queued.provinceId);
            }
          }
        }

        if (activeColonizeTargets.has(delta.order.provinceId)) {
          send({ type: "ERROR", code: "DUPLICATE_COLONIZE", message: "Province is already in your colonization queue" });
          return;
        }

        if (activeColonizeTargets.size >= gameSettings.colonization.maxActiveColonizations) {
          send({
            type: "ERROR",
            code: "COLONIZE_LIMIT",
            message: `Достигнут лимит одновременной колонизации: ${activeColonizeTargets.size}/${gameSettings.colonization.maxActiveColonizations}`,
          });
          return;
        }

      }

      if (playerOrders.length >= 8) {
        send({ type: "ERROR", code: "RATE_LIMIT", message: "Too many orders this turn" });
        return;
      }

      playerOrders.push(order);
      turnOrders.set(playerId, playerOrders);
      ordersByTurn.set(turnId, turnOrders);
      savePersistentState();

      broadcast(wss, { type: "ORDER_BROADCAST", order });
      return;
    }

    if (msg.type === "ADMIN_FORCE_RESOLVE") {
      if (!isAdmin) {
        send({ type: "ERROR", code: "FORBIDDEN", message: "Admin only" });
        return;
      }
      broadcastTurnResolveStarted(wss, "admin");
      resolveAndBroadcastCurrentTurn(wss);
      return;
    }

    if (msg.type === "REQUEST_RESOLVE") {
      if (!playerCountryId) {
        send({ type: "ERROR", code: "UNAUTHORIZED", message: "Country is not resolved from token" });
        return;
      }

      const now = new Date();
      await cleanupExpiredPunishments(turnId, now);
      const countries = await prisma.country.findMany({
        select: {
          id: true,
          isLocked: true,
          blockedUntilTurn: true,
          blockedUntilAt: true,
          ignoreUntilTurn: true,
        },
      });
      const activeCountryIds = new Set(
        countries
          .filter((country) => {
            const blocked = getCountryBlockInfo(country, turnId, now).blocked;
            const ignored = getCountrySkipInfo(country, turnId).ignored;
            return !blocked && !ignored;
          })
          .map((country) => country.id),
      );

      const readySet = getReadySetForTurn(turnId);
      const readySizeBefore = readySet.size;
      if (activeCountryIds.has(playerCountryId)) {
        readySet.add(playerCountryId);
      }
      if (readySet.size !== readySizeBefore) {
        savePersistentState();
      }

      const readyCount = [...readySet].filter((countryId) => activeCountryIds.has(countryId)).length;
      const totalCount = activeCountryIds.size;

      if (readyCount < totalCount) {
        send({
          type: "ERROR",
          code: "WAITING_FOR_PLAYERS",
          message: `Ожидание подтверждения хода: ${readyCount}/${totalCount}`,
        });
        return;
      }

      broadcastTurnResolveStarted(wss, "manual");
      resolveAndBroadcastCurrentTurn(wss);
    }

  });

  socket.on("close", () => {
    if (playerId) {
      onlinePlayers.delete(playerId);
      broadcast(wss, { type: "PRESENCE", onlinePlayerIds: [...onlinePlayers] });
    }
  });
});

async function startServer(): Promise<void> {
  await loadPersistentState();
  resetTurnTimerAnchor();
  setInterval(() => {
    try {
      if (!gameSettings.turnTimer.enabled) return;
      const seconds = Math.max(10, Math.floor(gameSettings.turnTimer.secondsPerTurn || 0));
      if (seconds <= 0) return;
      const elapsedMs = Date.now() - currentTurnStartedAtMs;
      if (elapsedMs < seconds * 1000) return;
      broadcastTurnResolveStarted(wss, "auto");
      const resolved = resolveAndBroadcastCurrentTurn(wss);
      if (resolved) {
        broadcast(wss, {
          type: "NEWS_EVENT",
          event: makeOfficialNews({
            turn: turnId,
            category: "system",
            title: "Авто-переход хода",
            message: `Ход автоматически завершён по таймеру (${seconds} сек.)`,
            priority: "medium",
            visibility: "public",
          }),
        });
      }
    } catch (error) {
      console.error("[turn-timer] Auto resolve failed:", error);
    }
  }, 1000);
  server.listen(env.port, () => {
    console.log(`Arcanorum server running on http://localhost:${env.port}`);
  });
}

function makeOfficialNews(params: {
  turn: number;
  category: EventCategory;
  title?: string;
  message: string;
  countryId?: string | null;
  priority?: EventPriority;
  visibility?: EventVisibility;
}): EventLogEntry {
  return {
    id: randomUUID(),
    turn: params.turn,
    timestamp: new Date().toISOString(),
    category: params.category,
    priority: params.priority ?? "medium",
    visibility: params.visibility ?? "public",
    title: params.title ?? null,
    message: params.message,
    countryId: params.countryId ?? null,
  };
}

startServer().catch((error) => {
  console.error("[startup] Failed to initialize server:", error);
  process.exit(1);
});


































