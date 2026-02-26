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
  type PopGroup,
  type PopulationState,
  type PopStrata,
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
const uiBackgroundsDir = resolve(uploadsRoot, "ui-backgrounds");
const civilopediaImagesDir = resolve(uploadsRoot, "civilopedia");
const culturesDir = resolve(uploadsRoot, "cultures");
mkdirSync(flagsDir, { recursive: true });
mkdirSync(crestsDir, { recursive: true });
mkdirSync(resourceIconsDir, { recursive: true });
mkdirSync(uiBackgroundsDir, { recursive: true });
mkdirSync(civilopediaImagesDir, { recursive: true });
mkdirSync(culturesDir, { recursive: true });

const resourceIconFields = new Set(["culture", "science", "religion", "colonization", "ducats", "gold"]);

const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    if (file.fieldname === "civilopediaImage") {
      cb(null, civilopediaImagesDir);
      return;
    }
    if (resourceIconFields.has(file.fieldname)) {
      cb(null, resourceIconsDir);
      return;
    }
    if (file.fieldname === "uiBackground") {
      cb(null, uiBackgroundsDir);
      return;
    }
    if (file.fieldname === "cultureLogo" || file.fieldname === "racePortrait") {
      cb(null, culturesDir);
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
  lockReason: true,
  ignoreUntilTurn: true,
  eventLogRetentionTurns: true,
  isRegistrationApproved: true,
} as const;

let turnId = 1;
const onlinePlayers = new Set<string>();
const lastLoginAtByCountryId = new Map<string, string>();
const MAX_UI_NOTIFICATION_QUEUE = 500;
type QueuedUiNotification = {
  audience: "all" | "admins";
  notification: Extract<WsOutMessage, { type: "UI_NOTIFY" }>["notification"];
  viewedByCountryIds: Set<string>;
};
const uiNotificationQueue: QueuedUiNotification[] = [];
const ordersByTurn = new Map<number, Map<string, Order[]>>();
const resolveReadyByTurn = new Map<number, Set<string>>();
const DEFAULT_MAX_ACTIVE_COLONIZATIONS = 3;
const DEFAULT_COLONIZATION_POINTS_PER_TURN = 30;
const COLONIZATION_GOAL = 100;
const DEFAULT_PROVINCE_COLONIZATION_COST = 100;
const SETTINGS_MAX_NUMBER = 1_000_000_000_000;

type GameSettings = {
  content: {
    races: Array<{
      id: string;
      name: string;
      description: string;
      color: string;
      logoUrl: string | null;
      malePortraitUrl?: string | null;
      femalePortraitUrl?: string | null;
    }>;
    religions: Array<{
      id: string;
      name: string;
      description: string;
      color: string;
      logoUrl: string | null;
      malePortraitUrl?: string | null;
      femalePortraitUrl?: string | null;
    }>;
    professions: Array<{
      id: string;
      name: string;
      description: string;
      color: string;
      logoUrl: string | null;
      malePortraitUrl?: string | null;
      femalePortraitUrl?: string | null;
    }>;
    ideologies: Array<{
      id: string;
      name: string;
      description: string;
      color: string;
      logoUrl: string | null;
      malePortraitUrl?: string | null;
      femalePortraitUrl?: string | null;
    }>;
    technologies: Array<{
      id: string;
      name: string;
      description: string;
      color: string;
      logoUrl: string | null;
      malePortraitUrl?: string | null;
      femalePortraitUrl?: string | null;
    }>;
    cultures: Array<{
      id: string;
      name: string;
      description: string;
      color: string;
      logoUrl: string | null;
      malePortraitUrl?: string | null;
      femalePortraitUrl?: string | null;
    }>;
  };
  civilopedia: {
    categories: string[];
    entries: Array<{
      id: string;
      category: string;
      title: string;
      summary: string;
      keywords: string[];
      imageUrl: string | null;
      relatedEntryIds: string[];
      sections: Array<{ title: string; paragraphs: string[] }>;
    }>;
  };
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
    provinceRenameDucats: number;
  };
  registration: {
    requireAdminApproval: boolean;
  };
  eventLog: {
    retentionTurns: number;
  };
  turnTimer: {
    enabled: boolean;
    secondsPerTurn: number;
  };
  population: {
    birthRateShiftPermille: number;
    deathRateShiftPermille: number;
    mergeBuckets: {
      wealthX100: number;
      loyalty: number;
      radicalism: number;
      employment: number;
      migrationDesire: number;
      birthRatePermille: number;
      deathRatePermille: number;
    };
  };
  map: {
    showAntarctica: boolean;
    backgroundImageUrl: string | null;
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

function normalizeContentCultures(input: unknown): GameSettings["content"]["cultures"] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const items: GameSettings["content"]["cultures"] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Partial<{
      id: unknown;
      name: unknown;
      description: unknown;
      color: unknown;
      logoUrl: unknown;
      malePortraitUrl: unknown;
      femalePortraitUrl: unknown;
    }>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const description = typeof row.description === "string" ? row.description.trim() : "";
    const color = typeof row.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(row.color.trim()) ? row.color.trim() : "#4ade80";
    const logoUrl = typeof row.logoUrl === "string" || row.logoUrl === null ? (row.logoUrl ?? null) : null;
    const malePortraitUrl =
      typeof row.malePortraitUrl === "string" || row.malePortraitUrl === null ? (row.malePortraitUrl ?? null) : null;
    const femalePortraitUrl =
      typeof row.femalePortraitUrl === "string" || row.femalePortraitUrl === null ? (row.femalePortraitUrl ?? null) : null;
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      name: name.slice(0, 80),
      description: description.slice(0, 5000),
      color,
      logoUrl,
      malePortraitUrl,
      femalePortraitUrl,
    });
  }
  return items;
}

const POP_CLAMP_MAX = 1000;
const DEFAULT_POP_BUCKETS = {
  wealthX100: 1000, // 10.00
  loyalty: 100,
  radicalism: 100,
  employment: 100,
  migrationDesire: 100,
  birthRatePermille: 5,
  deathRatePermille: 5,
} as const;
const MIN_POP_GROUP_SIZE_FOR_MICRO_MERGE = 50;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function weightedAvg(sumWeighted: number, totalWeight: number): number {
  if (totalWeight <= 0) return 0;
  return Math.round(sumWeighted / totalWeight);
}

function normalizePopulationMergeBuckets(input: unknown): GameSettings["population"]["mergeBuckets"] {
  const src = input && typeof input === "object" ? (input as Partial<GameSettings["population"]["mergeBuckets"]>) : {};
  return {
    wealthX100: clampInt(Number(src.wealthX100 ?? DEFAULT_POP_BUCKETS.wealthX100), 1, 100_000),
    loyalty: clampInt(Number(src.loyalty ?? DEFAULT_POP_BUCKETS.loyalty), 1, 1000),
    radicalism: clampInt(Number(src.radicalism ?? DEFAULT_POP_BUCKETS.radicalism), 1, 1000),
    employment: clampInt(Number(src.employment ?? DEFAULT_POP_BUCKETS.employment), 1, 1000),
    migrationDesire: clampInt(Number(src.migrationDesire ?? DEFAULT_POP_BUCKETS.migrationDesire), 1, 1000),
    birthRatePermille: clampInt(Number(src.birthRatePermille ?? DEFAULT_POP_BUCKETS.birthRatePermille), 1, 200),
    deathRatePermille: clampInt(Number(src.deathRatePermille ?? DEFAULT_POP_BUCKETS.deathRatePermille), 1, 200),
  };
}

function populationContentFingerprint(): string {
  const pick = (kind: keyof GameSettings["content"]) =>
    gameSettings.content[kind]
      .map((row) => `${row.id}:${row.name}:${row.logoUrl ?? ""}:${row.malePortraitUrl ?? ""}:${row.femalePortraitUrl ?? ""}`)
      .join(",");
  return [
    `r:${pick("races")}`,
    `c:${pick("cultures")}`,
    `rel:${pick("religions")}`,
    `p:${pick("professions")}`,
    `i:${pick("ideologies")}`,
  ].join("|");
}

function provinceOwnerFingerprint(owner: Record<string, string>): string {
  return Object.entries(owner)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([provinceId, countryId]) => `${provinceId}:${countryId}`)
    .join("|");
}

function comparePopGroupsForTop(a: PopGroup, b: PopGroup): number {
  return b.size - a.size || b.radicalism - a.radicalism || a.id.localeCompare(b.id);
}

function isPopGroupBetterForTop(a: PopGroup, b: PopGroup): boolean {
  if (a.size !== b.size) return a.size > b.size;
  if (a.radicalism !== b.radicalism) return a.radicalism > b.radicalism;
  return a.id < b.id;
}

function pickTopPopGroups(groups: PopGroup[], limit: number): PopGroup[] {
  if (limit <= 0 || groups.length === 0) return [];
  const top: PopGroup[] = [];
  for (const g of groups) {
    if (top.length < limit) {
      top.push(g);
      continue;
    }
    let worstIndex = 0;
    for (let i = 1; i < top.length; i += 1) {
      if (isPopGroupBetterForTop(top[worstIndex], top[i])) {
        worstIndex = i;
      }
    }
    if (isPopGroupBetterForTop(g, top[worstIndex])) {
      top[worstIndex] = g;
    }
  }
  return top.sort(comparePopGroupsForTop);
}

function summarizePopulationByProvince(popGroups: PopGroup[]): Record<string, PopulationState["provinceSummaries"][string]> {
  const byProvince = new Map<
    string,
    {
      totalPopulation: number;
      employedPopulation: number;
      wealthWeighted: number;
      loyaltyWeighted: number;
      radicalismWeighted: number;
      migrationWeighted: number;
    }
  >();

  for (const pop of popGroups) {
    const acc = byProvince.get(pop.provinceId) ?? {
      totalPopulation: 0,
      employedPopulation: 0,
      wealthWeighted: 0,
      loyaltyWeighted: 0,
      radicalismWeighted: 0,
      migrationWeighted: 0,
    };
    acc.totalPopulation += pop.size;
    acc.employedPopulation += Math.floor((pop.size * pop.employment) / 1000);
    acc.wealthWeighted += pop.wealthX100 * pop.size;
    acc.loyaltyWeighted += pop.loyalty * pop.size;
    acc.radicalismWeighted += pop.radicalism * pop.size;
    acc.migrationWeighted += pop.migrationDesire * pop.size;
    byProvince.set(pop.provinceId, acc);
  }

  const result: Record<string, PopulationState["provinceSummaries"][string]> = {};
  for (const [provinceId, acc] of byProvince.entries()) {
    const unemploymentPermille =
      acc.totalPopulation > 0
        ? clampInt(((acc.totalPopulation - acc.employedPopulation) * 1000) / acc.totalPopulation, 0, 1000)
        : 0;
    result[provinceId] = {
      provinceId,
      totalPopulation: acc.totalPopulation,
      employedPopulation: acc.employedPopulation,
      unemploymentPermille,
      avgWealthX100: weightedAvg(acc.wealthWeighted, acc.totalPopulation),
      avgLoyalty: weightedAvg(acc.loyaltyWeighted, acc.totalPopulation),
      avgRadicalism: weightedAvg(acc.radicalismWeighted, acc.totalPopulation),
      avgMigrationDesire: weightedAvg(acc.migrationWeighted, acc.totalPopulation),
    };
  }
  return result;
}

function summarizePopulationByCountry(
  popGroups: PopGroup[],
  provinceOwner: Record<string, string>,
): Record<string, PopulationState["countrySummaries"][string]> {
  const byCountry = new Map<
    string,
    {
      totalPopulation: number;
      employedPopulation: number;
      wealthWeighted: number;
      loyaltyWeighted: number;
      radicalismWeighted: number;
      migrationWeighted: number;
    }
  >();
  for (const pop of popGroups) {
    const countryId = provinceOwner[pop.provinceId];
    if (!countryId) continue;
    const acc = byCountry.get(countryId) ?? {
      totalPopulation: 0,
      employedPopulation: 0,
      wealthWeighted: 0,
      loyaltyWeighted: 0,
      radicalismWeighted: 0,
      migrationWeighted: 0,
    };
    acc.totalPopulation += pop.size;
    acc.employedPopulation += Math.floor((pop.size * pop.employment) / 1000);
    acc.wealthWeighted += pop.wealthX100 * pop.size;
    acc.loyaltyWeighted += pop.loyalty * pop.size;
    acc.radicalismWeighted += pop.radicalism * pop.size;
    acc.migrationWeighted += pop.migrationDesire * pop.size;
    byCountry.set(countryId, acc);
  }
  const result: Record<string, PopulationState["countrySummaries"][string]> = {};
  for (const [countryId, acc] of byCountry.entries()) {
    const unemploymentPermille =
      acc.totalPopulation > 0
        ? clampInt(((acc.totalPopulation - acc.employedPopulation) * 1000) / acc.totalPopulation, 0, 1000)
        : 0;
    result[countryId] = {
      countryId,
      totalPopulation: acc.totalPopulation,
      employedPopulation: acc.employedPopulation,
      unemploymentPermille,
      avgWealthX100: weightedAvg(acc.wealthWeighted, acc.totalPopulation),
      avgLoyalty: weightedAvg(acc.loyaltyWeighted, acc.totalPopulation),
      avgRadicalism: weightedAvg(acc.radicalismWeighted, acc.totalPopulation),
      avgMigrationDesire: weightedAvg(acc.migrationWeighted, acc.totalPopulation),
    };
  }
  return result;
}

function appendPopulationHistorySnapshot(
  history: PopulationState["history"],
  popGroups: PopGroup[],
  provinceOwner: Record<string, string>,
  turnIdForSnapshot: number,
): PopulationState["history"] {
  if (turnIdForSnapshot <= 0) return history;
  const worldTotalPopulation = popGroups.reduce((sum, g) => sum + g.size, 0);
  const countryTotals: Record<string, number> = {};
  for (const g of popGroups) {
    const ownerId = provinceOwner[g.provinceId];
    if (!ownerId) continue;
    countryTotals[ownerId] = (countryTotals[ownerId] ?? 0) + g.size;
  }
  const next = [...history];
  const idx = next.findIndex((h) => h.turnId === turnIdForSnapshot);
  const snapshot = { turnId: turnIdForSnapshot, worldTotalPopulation, countryTotals };
  if (idx >= 0) next[idx] = snapshot;
  else next.push(snapshot);
  next.sort((a, b) => a.turnId - b.turnId);
  return next.slice(-100);
}

function makePopulationState(
  popGroups: PopGroup[],
  provinceOwner: Record<string, string>,
  opts?: { history?: PopulationState["history"]; turnId?: number },
): PopulationState {
  const provinceSummaries = summarizePopulationByProvince(popGroups);
  const countrySummaries = summarizePopulationByCountry(popGroups, provinceOwner);
  const history = appendPopulationHistorySnapshot(
    Array.isArray(opts?.history) ? opts!.history : [],
    popGroups,
    provinceOwner,
    typeof opts?.turnId === "number" ? opts.turnId : 0,
  );
  return { popGroups, provinceSummaries, countrySummaries, history };
}

function normalizePopStrata(value: unknown): PopStrata {
  if (value === "lower" || value === "middle" || value === "upper") return value;
  return "lower";
}

function normalizePopulationState(
  input: unknown,
  provinceOwner: Record<string, string>,
  currentTurnId: number,
): PopulationState {
  if (!input || typeof input !== "object") {
    return makePopulationState(defaultPopGroups(provinceOwner, currentTurnId), provinceOwner, { turnId: currentTurnId });
  }
  const state = input as Partial<{ popGroups?: unknown; provinceSummaries?: unknown; countrySummaries?: unknown; history?: unknown }>;
  const rawGroups = Array.isArray(state.popGroups) ? state.popGroups : [];
  const rawHistory = Array.isArray(state.history) ? state.history : [];
  const groups: PopGroup[] = [];
  for (const raw of rawGroups) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Partial<Record<keyof PopGroup, unknown>>;
    const provinceId = typeof p.provinceId === "string" ? p.provinceId.trim() : "";
    if (!provinceId) continue;
    const size = clampInt(Number(p.size ?? 0), 0, 100_000_000);
    if (size <= 0) continue;
    groups.push({
      id: typeof p.id === "string" && p.id.trim() ? p.id : randomUUID(),
      provinceId,
      raceId: typeof p.raceId === "string" && p.raceId.trim() ? p.raceId : "sys-race-unknown",
      cultureId: typeof p.cultureId === "string" && p.cultureId.trim() ? p.cultureId : "sys-culture-unknown",
      religionId: typeof p.religionId === "string" && p.religionId.trim() ? p.religionId : "sys-religion-unknown",
      professionId: typeof p.professionId === "string" && p.professionId.trim() ? p.professionId : "sys-profession-unknown",
      ideologyId: typeof p.ideologyId === "string" && p.ideologyId.trim() ? p.ideologyId : "sys-ideology-neutral",
      strata: normalizePopStrata(p.strata),
      size,
      wealthX100: clampInt(Number(p.wealthX100 ?? 1000), 0, 1_000_000),
      loyalty: clampInt(Number(p.loyalty ?? 500), 0, POP_CLAMP_MAX),
      radicalism: clampInt(Number(p.radicalism ?? 150), 0, POP_CLAMP_MAX),
      employment: clampInt(Number(p.employment ?? 850), 0, POP_CLAMP_MAX),
      migrationDesire: clampInt(Number(p.migrationDesire ?? 100), 0, POP_CLAMP_MAX),
      birthRatePermille: clampInt(Number(p.birthRatePermille ?? 18), 0, 200),
      deathRatePermille: clampInt(Number(p.deathRatePermille ?? 10), 0, 200),
    });
  }
  if (groups.length === 0) {
    return makePopulationState(defaultPopGroups(provinceOwner, currentTurnId), provinceOwner, { turnId: currentTurnId });
  }
  const history = rawHistory
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      const row = raw as Partial<{ turnId: unknown; worldTotalPopulation: unknown; countryTotals: unknown }>;
      if (typeof row.turnId !== "number" || !Number.isFinite(row.turnId)) return null;
      const countryTotalsRaw = row.countryTotals && typeof row.countryTotals === "object" ? (row.countryTotals as Record<string, unknown>) : {};
      const countryTotals: Record<string, number> = {};
      for (const [k, v] of Object.entries(countryTotalsRaw)) {
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        countryTotals[k] = Math.max(0, Math.floor(v));
      }
      return {
        turnId: Math.max(1, Math.floor(row.turnId)),
        worldTotalPopulation:
          typeof row.worldTotalPopulation === "number" && Number.isFinite(row.worldTotalPopulation)
            ? Math.max(0, Math.floor(row.worldTotalPopulation))
            : 0,
        countryTotals,
      };
    })
    .filter((v): v is PopulationState["history"][number] => Boolean(v))
    .slice(-100);
  return makePopulationState(groups, provinceOwner, { history, turnId: currentTurnId });
}

function defaultPopGroups(provinceOwner: Record<string, string>, _currentTurnId: number): PopGroup[] {
  const provinceIds = new Set<string>([
    ...Object.keys(provinceOwner),
    "p-north",
    "p-south",
    "p-east",
  ]);
  const groups: PopGroup[] = [];
  for (const provinceId of provinceIds) {
    const owner = provinceOwner[provinceId] ?? null;
    const baseSize = owner ? 40_000 : 20_000;
    const lowerSize = Math.floor(baseSize * 0.78);
    const middleSize = Math.floor(baseSize * 0.18);
    const upperSize = Math.max(1, baseSize - lowerSize - middleSize);
    const rows: Array<{ strata: PopStrata; size: number; wealthX100: number; employment: number; professionId: string }> = [
      { strata: "lower", size: lowerSize, wealthX100: 700, employment: 820, professionId: "sys-profession-workers" },
      { strata: "middle", size: middleSize, wealthX100: 1500, employment: 900, professionId: "sys-profession-clerks" },
      { strata: "upper", size: upperSize, wealthX100: 3800, employment: 950, professionId: "sys-profession-elites" },
    ];
    for (const row of rows) {
      groups.push({
        id: randomUUID(),
        provinceId,
        raceId: "sys-race-unknown",
        cultureId: "sys-culture-unknown",
        religionId: "sys-religion-unknown",
        professionId: row.professionId,
        ideologyId: "sys-ideology-neutral",
        strata: row.strata,
        size: row.size,
        wealthX100: row.wealthX100,
        loyalty: 550,
        radicalism: 120,
        employment: row.employment,
        migrationDesire: 90,
        birthRatePermille: row.strata === "lower" ? 19 : row.strata === "middle" ? 15 : 11,
        deathRatePermille: row.strata === "lower" ? 12 : row.strata === "middle" ? 10 : 9,
      });
    }
  }
  return groups;
}

function popMergeBucketKey(pop: PopGroup): string {
  const bucket = (value: number, step: number) => Math.round(value / step);
  const buckets = gameSettings.population.mergeBuckets ?? normalizePopulationMergeBuckets(undefined);
  if (pop.size < MIN_POP_GROUP_SIZE_FOR_MICRO_MERGE) {
    return [
      "micro",
      pop.provinceId,
      pop.raceId,
      pop.cultureId,
      pop.religionId,
      pop.professionId,
      pop.ideologyId,
      pop.strata,
    ].join("|");
  }
  return [
    pop.provinceId,
    pop.raceId,
    pop.cultureId,
    pop.religionId,
    pop.professionId,
    pop.ideologyId,
    pop.strata,
    bucket(pop.wealthX100, Math.max(1, buckets.wealthX100)),
    bucket(pop.loyalty, Math.max(1, buckets.loyalty)),
    bucket(pop.radicalism, Math.max(1, buckets.radicalism)),
    bucket(pop.employment, Math.max(1, buckets.employment)),
    bucket(pop.migrationDesire, Math.max(1, buckets.migrationDesire)),
    bucket(pop.birthRatePermille, Math.max(1, buckets.birthRatePermille)),
    bucket(pop.deathRatePermille, Math.max(1, buckets.deathRatePermille)),
  ].join("|");
}

function mergePopGroups(groups: PopGroup[]): PopGroup[] {
  const merged = new Map<
    string,
    {
      seed: PopGroup;
      size: number;
      wealthWeighted: number;
      loyaltyWeighted: number;
      radicalismWeighted: number;
      employmentWeighted: number;
      migrationWeighted: number;
      birthWeighted: number;
      deathWeighted: number;
    }
  >();
  for (const pop of groups) {
    if (pop.size <= 0) continue;
    const key = popMergeBucketKey(pop);
    const acc = merged.get(key);
    if (!acc) {
      merged.set(key, {
        seed: pop,
        size: pop.size,
        wealthWeighted: pop.wealthX100 * pop.size,
        loyaltyWeighted: pop.loyalty * pop.size,
        radicalismWeighted: pop.radicalism * pop.size,
        employmentWeighted: pop.employment * pop.size,
        migrationWeighted: pop.migrationDesire * pop.size,
        birthWeighted: pop.birthRatePermille * pop.size,
        deathWeighted: pop.deathRatePermille * pop.size,
      });
      continue;
    }
    acc.size += pop.size;
    acc.wealthWeighted += pop.wealthX100 * pop.size;
    acc.loyaltyWeighted += pop.loyalty * pop.size;
    acc.radicalismWeighted += pop.radicalism * pop.size;
    acc.employmentWeighted += pop.employment * pop.size;
    acc.migrationWeighted += pop.migrationDesire * pop.size;
    acc.birthWeighted += pop.birthRatePermille * pop.size;
    acc.deathWeighted += pop.deathRatePermille * pop.size;
  }

  return [...merged.values()].map((acc) => ({
    ...acc.seed,
    id: randomUUID(),
    size: acc.size,
    wealthX100: weightedAvg(acc.wealthWeighted, acc.size),
    loyalty: clampInt(weightedAvg(acc.loyaltyWeighted, acc.size), 0, 1000),
    radicalism: clampInt(weightedAvg(acc.radicalismWeighted, acc.size), 0, 1000),
    employment: clampInt(weightedAvg(acc.employmentWeighted, acc.size), 0, 1000),
    migrationDesire: clampInt(weightedAvg(acc.migrationWeighted, acc.size), 0, 1000),
    birthRatePermille: clampInt(weightedAvg(acc.birthWeighted, acc.size), 0, 200),
    deathRatePermille: clampInt(weightedAvg(acc.deathWeighted, acc.size), 0, 200),
  }));
}

function ensureContentFallbackEntry(
  kind: "races" | "cultures" | "religions" | "professions" | "ideologies",
  fallback: { id: string; name: string; color: string; description: string },
): string {
  const list = gameSettings.content[kind];
  const existing = list.find((entry) => entry.id === fallback.id);
  if (existing) return existing.id;
  list.unshift({
    id: fallback.id,
    name: fallback.name,
    color: fallback.color,
    description: fallback.description,
    logoUrl: null,
    malePortraitUrl: null,
    femalePortraitUrl: null,
  });
  return fallback.id;
}

function ensurePopulationContentFallbacks(): {
  raceId: string;
  cultureId: string;
  religionId: string;
  professionId: string;
  ideologyId: string;
} {
  return {
    raceId: ensureContentFallbackEntry("races", {
      id: "sys-race-unknown",
      name: "Неопределённая раса",
      color: "#94a3b8",
      description: "Системная fallback-раса для POP",
    }),
    cultureId: ensureContentFallbackEntry("cultures", {
      id: "sys-culture-unknown",
      name: "Неопределённая культура",
      color: "#94a3b8",
      description: "Системная fallback-культура для POP",
    }),
    religionId: ensureContentFallbackEntry("religions", {
      id: "sys-religion-unknown",
      name: "Неопределённая религия",
      color: "#94a3b8",
      description: "Системная fallback-религия для POP",
    }),
    professionId: ensureContentFallbackEntry("professions", {
      id: "sys-profession-unassigned",
      name: "Без профессии",
      color: "#94a3b8",
      description: "Системная fallback-профессия для POP",
    }),
    ideologyId: ensureContentFallbackEntry("ideologies", {
      id: "sys-ideology-neutral",
      name: "Нейтральная идеология",
      color: "#94a3b8",
      description: "Системная fallback-идеология для POP",
    }),
  };
}

function sanitizePopulationContentReferences(base: WorldBase): boolean {
  const fingerprint = populationContentFingerprint();
  if (lastPopulationSanitizeRef === base.population && lastPopulationSanitizeFingerprint === fingerprint) {
    return false;
  }
  const fallback = ensurePopulationContentFallbacks();
  const races = new Set(gameSettings.content.races.map((v) => v.id));
  const cultures = new Set(gameSettings.content.cultures.map((v) => v.id));
  const religions = new Set(gameSettings.content.religions.map((v) => v.id));
  const professions = new Set(gameSettings.content.professions.map((v) => v.id));
  const ideologies = new Set(gameSettings.content.ideologies.map((v) => v.id));
  let changed = false;

  const sanitized = base.population.popGroups.map((pop) => {
    let next = pop;
    if (!races.has(pop.raceId)) {
      next = { ...next, raceId: fallback.raceId };
      changed = true;
    }
    if (!cultures.has(next.cultureId)) {
      next = next === pop ? { ...next } : next;
      next.cultureId = fallback.cultureId;
      changed = true;
    }
    if (!religions.has(next.religionId)) {
      next = next === pop ? { ...next } : next;
      next.religionId = fallback.religionId;
      changed = true;
    }
    if (!professions.has(next.professionId)) {
      next = next === pop ? { ...next } : next;
      next.professionId = fallback.professionId;
      changed = true;
    }
    if (!ideologies.has(next.ideologyId)) {
      next = next === pop ? { ...next } : next;
      next.ideologyId = fallback.ideologyId;
      changed = true;
    }
    return next;
  });

  if (changed) {
    base.population = makePopulationState(mergePopGroups(sanitized), base.provinceOwner, {
      history: base.population.history,
      turnId: base.turnId,
    });
  }
  lastPopulationSanitizeRef = base.population;
  lastPopulationSanitizeFingerprint = fingerprint;
  return changed;
}

function applyPopulationTurnStep(base: WorldBase): void {
  sanitizePopulationContentReferences(base);
  const birthShiftPermille = clampInt(gameSettings.population.birthRateShiftPermille ?? 0, -200, 200);
  const deathShiftPermille = clampInt(gameSettings.population.deathRateShiftPermille ?? 0, -200, 200);
  const nextGroups: PopGroup[] = [];
  for (const pop of base.population.popGroups) {
    if (pop.size <= 0) continue;
    const effectiveBirthRatePermille = clampInt(pop.birthRatePermille + birthShiftPermille, 0, 200);
    const effectiveDeathRatePermille = clampInt(pop.deathRatePermille + deathShiftPermille, 0, 200);
    const births = Math.floor((pop.size * effectiveBirthRatePermille) / 1000);
    const deaths = Math.floor((pop.size * effectiveDeathRatePermille) / 1000);
    const nextSize = Math.max(0, pop.size + births - deaths);
    if (nextSize <= 0) continue;

    const unemployment = 1000 - pop.employment;
    const nextWealthX100 = Math.max(
      0,
      pop.wealthX100 + Math.round((pop.employment - 700) * 0.8) - Math.round(unemployment * 0.35) - Math.round(pop.radicalism * 0.1),
    );
    const nextRadicalism = clampInt(
      pop.radicalism + Math.round((unemployment - 180) / 10) + (nextWealthX100 < 700 ? 12 : -4),
      0,
      1000,
    );
    const nextLoyalty = clampInt(pop.loyalty + Math.round((500 - nextRadicalism) / 30) + (nextWealthX100 > 1200 ? 4 : -2), 0, 1000);
    const nextMigrationDesire = clampInt(
      Math.round((nextRadicalism * 0.55) + (unemployment * 0.35) + (nextWealthX100 < 900 ? 120 : 20)),
      0,
      1000,
    );

    nextGroups.push({
      ...pop,
      size: nextSize,
      wealthX100: nextWealthX100,
      radicalism: nextRadicalism,
      loyalty: nextLoyalty,
      migrationDesire: nextMigrationDesire,
    });
  }

  const merged = mergePopGroups(nextGroups);
  base.population = makePopulationState(merged, base.provinceOwner, {
    history: base.population.history,
    turnId: base.turnId + 1,
  });
}

type PopulationBreakdownRow = {
  id: string;
  label: string;
  logoUrl?: string | null;
  color?: string | null;
  malePortraitUrl?: string | null;
  femalePortraitUrl?: string | null;
  size: number;
  sharePermille: number;
  avgWealthX100: number;
  avgLoyalty: number;
  avgRadicalism: number;
  avgEmployment: number;
  avgMigrationDesire: number;
};

type PopulationBreakdowns = {
  strata: PopulationBreakdownRow[];
  races: PopulationBreakdownRow[];
  cultures: PopulationBreakdownRow[];
  religions: PopulationBreakdownRow[];
  professions: PopulationBreakdownRow[];
  ideologies: PopulationBreakdownRow[];
};

function buildContentMetaMaps() {
  return {
    races: new Map(
      gameSettings.content.races.map((v) => [
        v.id,
        {
          name: v.name,
          logoUrl: v.logoUrl ?? null,
          color: v.color ?? null,
          malePortraitUrl: v.malePortraitUrl ?? null,
          femalePortraitUrl: v.femalePortraitUrl ?? null,
        },
      ]),
    ),
    cultures: new Map(gameSettings.content.cultures.map((v) => [v.id, { name: v.name, logoUrl: v.logoUrl ?? null, color: v.color ?? null }])),
    religions: new Map(gameSettings.content.religions.map((v) => [v.id, { name: v.name, logoUrl: v.logoUrl ?? null, color: v.color ?? null }])),
    professions: new Map(gameSettings.content.professions.map((v) => [v.id, { name: v.name, logoUrl: v.logoUrl ?? null, color: v.color ?? null }])),
    ideologies: new Map(gameSettings.content.ideologies.map((v) => [v.id, { name: v.name, logoUrl: v.logoUrl ?? null, color: v.color ?? null }])),
  };
}

function aggregatePopulationBreakdown(
  groups: PopGroup[],
  keySelector: (group: PopGroup) => string,
  labelSelector: (id: string) => string,
  metaSelector?: (id: string) => { logoUrl?: string | null; color?: string | null; malePortraitUrl?: string | null; femalePortraitUrl?: string | null } | null,
): PopulationBreakdownRow[] {
  const totalPopulation = groups.reduce((sum, g) => sum + g.size, 0);
  const byKey = new Map<
    string,
    {
      size: number;
      wealthWeighted: number;
      loyaltyWeighted: number;
      radicalismWeighted: number;
      employmentWeighted: number;
      migrationWeighted: number;
    }
  >();
  for (const g of groups) {
    const key = keySelector(g);
    const acc = byKey.get(key) ?? {
      size: 0,
      wealthWeighted: 0,
      loyaltyWeighted: 0,
      radicalismWeighted: 0,
      employmentWeighted: 0,
      migrationWeighted: 0,
    };
    acc.size += g.size;
    acc.wealthWeighted += g.wealthX100 * g.size;
    acc.loyaltyWeighted += g.loyalty * g.size;
    acc.radicalismWeighted += g.radicalism * g.size;
    acc.employmentWeighted += g.employment * g.size;
    acc.migrationWeighted += g.migrationDesire * g.size;
    byKey.set(key, acc);
  }
  return [...byKey.entries()]
    .map(([id, acc]) => ({
      ...(metaSelector?.(id) ?? {}),
      id,
      label: labelSelector(id),
      size: acc.size,
      sharePermille: totalPopulation > 0 ? clampInt((acc.size * 1000) / totalPopulation, 0, 1000) : 0,
      avgWealthX100: weightedAvg(acc.wealthWeighted, acc.size),
      avgLoyalty: weightedAvg(acc.loyaltyWeighted, acc.size),
      avgRadicalism: weightedAvg(acc.radicalismWeighted, acc.size),
      avgEmployment: weightedAvg(acc.employmentWeighted, acc.size),
      avgMigrationDesire: weightedAvg(acc.migrationWeighted, acc.size),
    }))
    .sort((a, b) => b.size - a.size || a.label.localeCompare(b.label));
}

function buildPopulationBreakdowns(groups: PopGroup[]): PopulationBreakdowns {
  const meta = buildContentMetaMaps();
  return {
    strata: aggregatePopulationBreakdown(
      groups,
      (g) => g.strata,
      (id) => (id === "lower" ? "Низший" : id === "middle" ? "Средний" : "Высший"),
    ),
    races: aggregatePopulationBreakdown(
      groups,
      (g) => g.raceId,
      (id) => meta.races.get(id)?.name ?? id,
      (id) => meta.races.get(id) ?? null,
    ),
    cultures: aggregatePopulationBreakdown(
      groups,
      (g) => g.cultureId,
      (id) => meta.cultures.get(id)?.name ?? id,
      (id) => meta.cultures.get(id) ?? null,
    ),
    religions: aggregatePopulationBreakdown(
      groups,
      (g) => g.religionId,
      (id) => meta.religions.get(id)?.name ?? id,
      (id) => meta.religions.get(id) ?? null,
    ),
    professions: aggregatePopulationBreakdown(
      groups,
      (g) => g.professionId,
      (id) => meta.professions.get(id)?.name ?? id,
      (id) => meta.professions.get(id) ?? null,
    ),
    ideologies: aggregatePopulationBreakdown(
      groups,
      (g) => g.ideologyId,
      (id) => meta.ideologies.get(id)?.name ?? id,
      (id) => meta.ideologies.get(id) ?? null,
    ),
  };
}

function ensurePopulationEndpointCacheFresh() {
  const fingerprint = populationContentFingerprint();
  const ownerFingerprint = provinceOwnerFingerprint(worldBase.provinceOwner);
  const samePopulationRef = populationEndpointCache.populationRef === worldBase.population;
  const sameProvinceOwnerRef = populationEndpointCache.provinceOwnerRef === worldBase.provinceOwner;
  const sameProvinceOwnerFingerprint = populationEndpointCache.provinceOwnerFingerprint === ownerFingerprint;
  const sameFingerprint = populationEndpointCache.contentFingerprint === fingerprint;
  if (samePopulationRef && sameProvinceOwnerRef && sameProvinceOwnerFingerprint && sameFingerprint) {
    return populationEndpointCache;
  }

  const groupsByCountry = new Map<string, PopGroup[]>();
  for (const group of worldBase.population.popGroups) {
    const ownerId = worldBase.provinceOwner[group.provinceId];
    if (!ownerId) continue;
    const list = groupsByCountry.get(ownerId);
    if (list) list.push(group);
    else groupsByCountry.set(ownerId, [group]);
  }

  populationEndpointCache.populationRef = worldBase.population;
  populationEndpointCache.provinceOwnerRef = worldBase.provinceOwner;
  populationEndpointCache.provinceOwnerFingerprint = ownerFingerprint;
  populationEndpointCache.contentFingerprint = fingerprint;
  populationEndpointCache.groupsByCountry = groupsByCountry;
  populationEndpointCache.worldResponse = null;
  populationEndpointCache.countryResponses = new Map();
  return populationEndpointCache;
}

function buildPopulationWorldSummaryResponseCached() {
  const cache = ensurePopulationEndpointCacheFresh();
  if (cache.worldResponse) {
    return cache.worldResponse;
  }
  const groups = worldBase.population.popGroups;
  const totalPopulation = groups.reduce((sum, g) => sum + g.size, 0);
  const totalEmployed = groups.reduce((sum, g) => sum + Math.floor((g.size * g.employment) / 1000), 0);
  cache.worldResponse = {
    summary: {
      scope: "world" as const,
      totalPopulation,
      employedPopulation: totalEmployed,
      unemploymentPermille: totalPopulation > 0 ? clampInt(((totalPopulation - totalEmployed) * 1000) / totalPopulation, 0, 1000) : 0,
      avgWealthX100: totalPopulation > 0 ? weightedAvg(groups.reduce((sum, g) => sum + g.wealthX100 * g.size, 0), totalPopulation) : 0,
      avgLoyalty: totalPopulation > 0 ? weightedAvg(groups.reduce((sum, g) => sum + g.loyalty * g.size, 0), totalPopulation) : 0,
      avgRadicalism: totalPopulation > 0 ? weightedAvg(groups.reduce((sum, g) => sum + g.radicalism * g.size, 0), totalPopulation) : 0,
      avgMigrationDesire: totalPopulation > 0 ? weightedAvg(groups.reduce((sum, g) => sum + g.migrationDesire * g.size, 0), totalPopulation) : 0,
      popGroupCount: groups.length,
    },
    breakdowns: buildPopulationBreakdowns(groups),
    countries: Object.values(worldBase.population.countrySummaries).sort((a, b) => b.totalPopulation - a.totalPopulation),
    history: worldBase.population.history.map((h) => ({
      turnId: h.turnId,
      totalPopulation: h.worldTotalPopulation,
    })),
  };
  return cache.worldResponse;
}

function buildPopulationCountrySummaryResponseCached(countryId: string) {
  const cache = ensurePopulationEndpointCacheFresh();
  const cached = cache.countryResponses.get(countryId);
  if (cached) {
    return cached;
  }
  const groups = cache.groupsByCountry.get(countryId) ?? [];
  const summary = worldBase.population.countrySummaries[countryId] ?? {
    countryId,
    totalPopulation: 0,
    employedPopulation: 0,
    unemploymentPermille: 0,
    avgWealthX100: 0,
    avgLoyalty: 0,
    avgRadicalism: 0,
    avgMigrationDesire: 0,
  };
  const response = {
    summary: { ...summary, scope: "country" as const, popGroupCount: groups.length },
    breakdowns: buildPopulationBreakdowns(groups),
    provinces: aggregatePopulationBreakdown(groups, (g) => g.provinceId, (id) => id),
    history: worldBase.population.history.map((h) => ({
      turnId: h.turnId,
      totalPopulation: h.countryTotals[countryId] ?? 0,
    })),
  };
  cache.countryResponses.set(countryId, response);
  return response;
}

function getAllProvinceIdsFromAdm1(): string[] {
  return adm1ProvinceIndex.map((province) => province.id);
}

function defaultCivilopediaEntries(): GameSettings["civilopedia"]["entries"] {
  return [
    {
      id: "basics-getting-started",
      category: "basics",
      title: "Как начать игру",
      summary: "Авторизация, обзор карты, приказы и завершение хода.",
      keywords: ["старт", "вход", "приказы", "ход"],
      imageUrl: null,
      relatedEntryIds: ["turn-timer", "map-modes", "economy-resources"],
      sections: [
        {
          title: "Первые шаги",
          paragraphs: [
            "После входа дождитесь загрузки данных и войдите в игру через экран подтверждения.",
            "Осмотрите карту, выберите слой и изучите текущие ресурсы в верхней панели.",
            "Отправьте приказы и завершите ход кнопкой следующего хода либо дождитесь авто-перехода по таймеру.",
          ],
        },
      ],
    },
    {
      id: "colonization-race",
      category: "colonization",
      title: "Колонизация провинций",
      summary: "Гонка стран за свободные провинции с прогрессом, стоимостью и поддержкой.",
      keywords: ["колонизация", "провинции", "прогресс", "гонка"],
      imageUrl: null,
      relatedEntryIds: ["map-modes", "economy-resources"],
      sections: [
        {
          title: "Механика",
          paragraphs: [
            "Несколько стран могут одновременно колонизировать одну провинцию. Прогресс хранится отдельно по каждой стране.",
            "Стоимость колонизации зависит от площади провинции и глобальных ставок за 1000 км², если не задана ручная цена.",
            "На поддержку колоний тратятся очки колонизации и дукаты; списывается только реально применяемое количество.",
          ],
        },
      ],
    },
    {
      id: "map-modes",
      category: "map",
      title: "Слои карты и легенды",
      summary: "Политическая карта, слой колонизации, легенды и фильтры отображения.",
      keywords: ["карта", "слои", "легенда", "границы"],
      imageUrl: null,
      relatedEntryIds: ["colonization-race"],
      sections: [
        {
          title: "Слои и легенды",
          paragraphs: [
            "Слои карты переключаются кнопками снизу. Для некоторых слоёв доступна легенда с компактным режимом.",
            "Отдельная кнопка включает/отключает границы провинций.",
          ],
        },
      ],
    },
    {
      id: "turn-timer",
      category: "turns",
      title: "Ходы и таймер",
      summary: "Ручной и автоматический переход хода, готовность стран и обработка хода.",
      keywords: ["таймер", "ход", "готовность", "автоход"],
      imageUrl: null,
      relatedEntryIds: ["basics-getting-started", "event-log"],
      sections: [
        {
          title: "Резолв хода",
          paragraphs: [
            "Ход может завершаться после готовности всех активных стран или автоматически по таймеру.",
            "Во время обработки показывается блокирующий экран с индикатором загрузки и временем обработки после завершения.",
          ],
        },
      ],
    },
    {
      id: "event-log",
      category: "journal",
      title: "Журнал событий",
      summary: "Официальные новости, системные сообщения и фильтры событий.",
      keywords: ["журнал", "события", "новости", "фильтры"],
      imageUrl: null,
      relatedEntryIds: ["turn-timer"],
      sections: [
        {
          title: "Использование",
          paragraphs: [
            "Журнал справа показывает публичные и приватные события, поддерживает категории, сортировку и фильтр по стране.",
            "Официальные новости приходят с сервера и помогают отслеживать ключевые изменения в партии.",
          ],
        },
      ],
    },
    {
      id: "economy-resources",
      category: "economy",
      title: "Ресурсы и экономика",
      summary: "Плашки ресурсов, прирост, расходы и чистый итог за ход.",
      keywords: ["ресурсы", "дукаты", "золото", "расходы", "экономика"],
      imageUrl: null,
      relatedEntryIds: ["colonization-race"],
      sections: [
        {
          title: "Верхняя панель",
          paragraphs: [
            "В TopBar отображается текущее значение ресурса и чистый итог за ход. Подробности открываются при наведении.",
            "Расходы включают приказы, поддержку колоний и другие действия, например кастомизацию страны за дукаты.",
          ],
        },
      ],
    },
  ];
}

function defaultCivilopediaCategories(): string[] {
  return ["basics", "colonization", "map", "turns", "journal", "economy"];
}

function normalizeCivilopediaEntries(input: unknown): GameSettings["civilopedia"]["entries"] {
  const fallback = defaultCivilopediaEntries();
  if (!Array.isArray(input)) return fallback;
  const next: GameSettings["civilopedia"]["entries"] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : "";
    const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : "";
    if (!id || !title) continue;
    const sectionsRaw = Array.isArray(item.sections) ? item.sections : [];
    const sections = sectionsRaw
      .map((s) => {
        if (!s || typeof s !== "object") return null;
        const section = s as Record<string, unknown>;
        const sectionTitle = typeof section.title === "string" && section.title.trim() ? section.title.trim() : "Раздел";
        const paragraphs = Array.isArray(section.paragraphs)
          ? section.paragraphs.filter((p): p is string => typeof p === "string").map((p) => p.trim()).filter(Boolean)
          : [];
        return { title: sectionTitle, paragraphs };
      })
      .filter((v): v is { title: string; paragraphs: string[] } => Boolean(v))
      .filter((v) => v.paragraphs.length > 0);
    next.push({
      id,
      category: typeof item.category === "string" && item.category.trim() ? item.category.trim() : "basics",
      title,
      summary: typeof item.summary === "string" ? item.summary.trim() : "",
      keywords: Array.isArray(item.keywords)
        ? item.keywords.filter((k): k is string => typeof k === "string").map((k) => k.trim()).filter(Boolean).slice(0, 30)
        : [],
      imageUrl:
        typeof item.imageUrl === "string"
          ? item.imageUrl
          : item.imageUrl === null
            ? null
            : null,
      relatedEntryIds: Array.isArray(item.relatedEntryIds)
        ? item.relatedEntryIds.filter((k): k is string => typeof k === "string").map((k) => k.trim()).filter(Boolean).slice(0, 20)
        : [],
      sections: sections.length > 0 ? sections : [{ title: "Содержание", paragraphs: ["Описание отсутствует."] }],
    });
  }
  return next.length > 0 ? next : fallback;
}

function normalizeCivilopediaCategories(input: unknown, entries: GameSettings["civilopedia"]["entries"]): string[] {
  const base = new Set<string>(defaultCivilopediaCategories());
  if (Array.isArray(input)) {
    for (const raw of input) {
      if (typeof raw !== "string") continue;
      const value = raw.trim();
      if (!value) continue;
      base.add(value);
    }
  }
  for (const entry of entries) {
    if (entry.category.trim()) base.add(entry.category.trim());
  }
  return [...base];
}

const defaultGameSettings = (): GameSettings => ({
  content: {
    races: [],
    religions: [],
    professions: [],
    ideologies: [],
    technologies: [],
    cultures: [],
  },
  civilopedia: {
    categories: defaultCivilopediaCategories(),
    entries: defaultCivilopediaEntries(),
  },
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
    provinceRenameDucats: 25,
  },
  registration: {
    requireAdminApproval: false,
  },
  eventLog: {
    retentionTurns: 3,
  },
  turnTimer: {
    enabled: true,
    secondsPerTurn: 86_400,
  },
  population: {
    birthRateShiftPermille: 0,
    deathRateShiftPermille: 0,
    mergeBuckets: normalizePopulationMergeBuckets(undefined),
  },
  map: {
    showAntarctica: false,
    backgroundImageUrl: null,
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
  const base: WorldBase = {
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
    provinceNameById: {},
    colonyProgressByProvince: {},
    provinceColonizationByProvince: {},
    population: { popGroups: [], provinceSummaries: {}, countrySummaries: {}, history: [] },
  };
  base.population = makePopulationState(defaultPopGroups(base.provinceOwner, currentTurnId), base.provinceOwner, {
    turnId: currentTurnId,
  });
  return base;
}

let gameSettings: GameSettings = defaultGameSettings();
let worldBase: WorldBase = defaultWorldBase(turnId);
let currentTurnStartedAtMs = Date.now();
let isResolvingTurnNow = false;
let lastPopulationSanitizeFingerprint = "";
let lastPopulationSanitizeRef: WorldBase["population"] | null = null;

type PopulationEndpointCache = {
  populationRef: WorldBase["population"] | null;
  provinceOwnerRef: WorldBase["provinceOwner"] | null;
  provinceOwnerFingerprint: string;
  contentFingerprint: string;
  groupsByCountry: Map<string, PopGroup[]>;
  worldResponse: null | {
    summary: {
      scope: "world";
      totalPopulation: number;
      employedPopulation: number;
      unemploymentPermille: number;
      avgWealthX100: number;
      avgLoyalty: number;
      avgRadicalism: number;
      avgMigrationDesire: number;
      popGroupCount: number;
    };
    breakdowns: PopulationBreakdowns;
    countries: Array<PopulationState["countrySummaries"][string]>;
    history: Array<{ turnId: number; totalPopulation: number }>;
  };
  countryResponses: Map<
    string,
    {
      summary: PopulationState["countrySummaries"][string] & { scope: "country"; popGroupCount: number };
      breakdowns: PopulationBreakdowns;
      provinces: PopulationBreakdownRow[];
      history: Array<{ turnId: number; totalPopulation: number }>;
    }
  >;
};

const populationEndpointCache: PopulationEndpointCache = {
  populationRef: null,
  provinceOwnerRef: null,
  provinceOwnerFingerprint: "",
  contentFingerprint: "",
  groupsByCountry: new Map(),
  worldResponse: null,
  countryResponses: new Map(),
};

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
    const civilopediaEntries = normalizeCivilopediaEntries((next as Partial<{ civilopedia?: { entries?: unknown } }>).civilopedia?.entries);
    gameSettings = {
      content: {
        races: normalizeContentCultures((next as Partial<{ content?: { races?: unknown } }>).content?.races),
        religions: normalizeContentCultures((next as Partial<{ content?: { religions?: unknown } }>).content?.religions),
        professions: normalizeContentCultures((next as Partial<{ content?: { professions?: unknown } }>).content?.professions),
        ideologies: normalizeContentCultures((next as Partial<{ content?: { ideologies?: unknown } }>).content?.ideologies),
        technologies: normalizeContentCultures((next as Partial<{ content?: { technologies?: unknown } }>).content?.technologies),
        cultures: normalizeContentCultures((next as Partial<{ content?: { cultures?: unknown } }>).content?.cultures),
      },
      civilopedia: {
        categories: normalizeCivilopediaCategories((next as Partial<{ civilopedia?: { categories?: unknown } }>).civilopedia?.categories, civilopediaEntries),
        entries: civilopediaEntries,
      },
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
        provinceRenameDucats:
          typeof next.customization?.provinceRenameDucats === "number"
            ? Math.max(0, Math.floor(next.customization.provinceRenameDucats))
            : defaults.customization.provinceRenameDucats,
      },
      registration: {
        requireAdminApproval:
          typeof (next as Partial<{ registration?: { requireAdminApproval?: unknown } }>).registration?.requireAdminApproval === "boolean"
            ? Boolean((next as Partial<{ registration?: { requireAdminApproval?: boolean } }>).registration?.requireAdminApproval)
            : defaults.registration.requireAdminApproval,
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
      population: {
        birthRateShiftPermille:
          typeof (next as Partial<{ population?: { birthRateShiftPermille?: unknown } }>).population?.birthRateShiftPermille === "number"
            ? clampInt(
                Number((next as Partial<{ population?: { birthRateShiftPermille?: number } }>).population?.birthRateShiftPermille ?? 0),
                -200,
                200,
              )
            : defaults.population.birthRateShiftPermille,
        deathRateShiftPermille:
          typeof (next as Partial<{ population?: { deathRateShiftPermille?: unknown } }>).population?.deathRateShiftPermille === "number"
            ? clampInt(
                Number((next as Partial<{ population?: { deathRateShiftPermille?: number } }>).population?.deathRateShiftPermille ?? 0),
                -200,
                200,
              )
            : defaults.population.deathRateShiftPermille,
        mergeBuckets: normalizePopulationMergeBuckets(
          (next as Partial<{ population?: { mergeBuckets?: unknown } }>).population?.mergeBuckets,
        ),
      },
      map: {
        showAntarctica:
          typeof next.map?.showAntarctica === "boolean" ? next.map.showAntarctica : defaults.map.showAntarctica,
        backgroundImageUrl:
          typeof next.map?.backgroundImageUrl === "string" || next.map?.backgroundImageUrl === null
            ? (next.map?.backgroundImageUrl ?? null)
            : defaults.map.backgroundImageUrl,
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
        provinceNameById:
          candidate.provinceNameById && typeof candidate.provinceNameById === "object"
            ? (candidate.provinceNameById as Record<string, string>)
            : {},
        colonyProgressByProvince: candidate.colonyProgressByProvince,
        provinceColonizationByProvince: normalizeProvinceColonizationMap(
          (candidate as Partial<WorldBase> & { provinceColonizationByProvince?: unknown }).provinceColonizationByProvince,
        ),
        population: normalizePopulationState(
          (candidate as Partial<WorldBase> & { population?: unknown }).population,
          candidate.provinceOwner as Record<string, string>,
          turnId,
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

function countryFromDb(row: { id: string; name: string; color: string; flagUrl: string | null; crestUrl: string | null; isAdmin: boolean; isLocked: boolean; blockedUntilTurn: number | null; blockedUntilAt: Date | null; lockReason?: string | null; ignoreUntilTurn: number | null; eventLogRetentionTurns?: number | null }): Country {
  return {
    ...row,
    blockedUntilAt: row.blockedUntilAt ? row.blockedUntilAt.toISOString() : null,
    lockReason: row.lockReason ?? null,
  };
}

function makeRegistrationApprovalUiNotification(country: {
  id: string;
  name: string;
  color: string;
  flagUrl: string | null;
  crestUrl: string | null;
  createdAt?: Date | null;
}): Extract<WsOutMessage, { type: "UI_NOTIFY" }>["notification"] {
  return {
    id: `registration-approval:${country.id}`,
    category: "registration",
    createdAt: (country.createdAt ?? new Date()).toISOString(),
    action: {
      type: "registration-approval",
      country: {
        id: country.id,
        name: country.name,
        color: country.color,
        flagUrl: country.flagUrl,
        crestUrl: country.crestUrl,
      },
    },
  };
}

function sendUiNotificationToSocket(
  socket: WebSocket,
  notification: Extract<WsOutMessage, { type: "UI_NOTIFY" }>["notification"],
): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "UI_NOTIFY", notification } satisfies WsOutMessage));
}

function enqueueUiNotification(
  notification: Extract<WsOutMessage, { type: "UI_NOTIFY" }>["notification"],
  audience: "all" | "admins",
): void {
  const existingIndex = uiNotificationQueue.findIndex((item) => item.notification.id === notification.id);
  if (existingIndex >= 0) {
    uiNotificationQueue[existingIndex] = {
      ...uiNotificationQueue[existingIndex],
      audience,
      notification,
    };
    return;
  }
  uiNotificationQueue.unshift({
    audience,
    notification,
    viewedByCountryIds: new Set<string>(),
  });
  if (uiNotificationQueue.length > MAX_UI_NOTIFICATION_QUEUE) {
    uiNotificationQueue.length = MAX_UI_NOTIFICATION_QUEUE;
  }
}

function removeQueuedUiNotification(notificationId: string): void {
  const idx = uiNotificationQueue.findIndex((item) => item.notification.id === notificationId);
  if (idx >= 0) {
    uiNotificationQueue.splice(idx, 1);
  }
}

function sendUiNotificationToAdmins(
  wsServer: WebSocketServer,
  notification: Extract<WsOutMessage, { type: "UI_NOTIFY" }>["notification"],
): void {
  enqueueUiNotification(notification, "admins");
  wsServer.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    const meta = client as WebSocket & { __arcIsAdmin?: boolean };
    if (!meta.__arcIsAdmin) return;
    sendUiNotificationToSocket(client, notification);
  });
}

function broadcastUiNotification(
  wsServer: WebSocketServer,
  notification: Extract<WsOutMessage, { type: "UI_NOTIFY" }>["notification"],
): void {
  enqueueUiNotification(notification, "all");
  broadcast(wsServer, { type: "UI_NOTIFY", notification });
}

async function sendPendingRegistrationNotificationsToAdminSocket(socket: WebSocket, adminCountryId: string): Promise<void> {
  const pending = await prisma.country.findMany({
    where: { isRegistrationApproved: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      color: true,
      flagUrl: true,
      crestUrl: true,
      createdAt: true,
    },
  });
  for (const country of pending) {
    const notification = makeRegistrationApprovalUiNotification(country);
    enqueueUiNotification(notification, "admins");
    const queued = uiNotificationQueue.find((item) => item.notification.id === notification.id);
    if (queued?.viewedByCountryIds.has(adminCountryId)) continue;
    sendUiNotificationToSocket(socket, notification);
  }
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

  applyPopulationTurnStep(worldBase);

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

function getOnlineCountryIdsFromSockets(wsServer: WebSocketServer): Set<string> {
  const ids = new Set<string>();
  wsServer.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    const meta = client as WebSocket & { __arcCountryId?: string };
    if (meta.__arcCountryId) ids.add(meta.__arcCountryId);
  });
  return ids;
}

function getPendingUiNotificationsForCountry(params: { countryId: string; isAdmin: boolean }) {
  return uiNotificationQueue
    .filter((item) => (item.audience === "all" || params.isAdmin) && !item.viewedByCountryIds.has(params.countryId))
    .map((item) => item.notification);
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
  const onlineCountryIds = getOnlineCountryIdsFromSockets(wss);

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
      online: onlineCountryIds.has(country.id),
      lastLoginAt: lastLoginAtByCountryId.get(country.id) ?? null,
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

app.get("/notifications/ui/pending", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const isAdmin = await isAdminCountry(auth.countryId);
  const notifications = getPendingUiNotificationsForCountry({ countryId: auth.countryId, isAdmin });
  return res.json({ notifications });
});

app.patch("/notifications/ui/:id/viewed", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const notificationId = String(req.params.id);
  const target = uiNotificationQueue.find((item) => item.notification.id === notificationId);
  if (!target) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  const isAdmin = await isAdminCountry(auth.countryId);
  if (target.audience === "admins" && !isAdmin) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  target.viewedByCountryIds.add(auth.countryId);
  return res.json({ ok: true });
});

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
      provinceRenameDucats: z.coerce.number().int().min(0).max(SETTINGS_MAX_NUMBER).optional(),
    })
    .optional(),
  registration: z
    .object({
      requireAdminApproval: z.boolean().optional(),
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
      secondsPerTurn: z.coerce.number().int().min(10).max(2_592_000).optional(),
    })
    .optional(),
  population: z
    .object({
      birthRateShiftPermille: z.coerce.number().int().min(-200).max(200).optional(),
      deathRateShiftPermille: z.coerce.number().int().min(-200).max(200).optional(),
      mergeBuckets: z
        .object({
          wealthX100: z.coerce.number().int().min(1).max(100_000).optional(),
          loyalty: z.coerce.number().int().min(1).max(1000).optional(),
          radicalism: z.coerce.number().int().min(1).max(1000).optional(),
          employment: z.coerce.number().int().min(1).max(1000).optional(),
          migrationDesire: z.coerce.number().int().min(1).max(1000).optional(),
          birthRatePermille: z.coerce.number().int().min(1).max(200).optional(),
          deathRatePermille: z.coerce.number().int().min(1).max(200).optional(),
        })
        .optional(),
    })
    .optional(),
  map: z
    .object({
      showAntarctica: z.boolean().optional(),
      backgroundImageUrl: z.string().max(400).nullable().optional(),
    })
    .optional(),
});

app.get("/game-settings/public", (_req, res) => {
  return res.json({
    civilopedia: gameSettings.civilopedia,
    economy: gameSettings.economy,
    colonization: gameSettings.colonization,
    customization: gameSettings.customization,
    registration: gameSettings.registration,
    eventLog: gameSettings.eventLog,
    turnTimer: {
      ...gameSettings.turnTimer,
      currentTurnStartedAtMs,
    },
    map: gameSettings.map,
    resourceIcons: gameSettings.resourceIcons,
  });
});

app.get("/civilopedia", (_req, res) => {
  return res.json({ civilopedia: gameSettings.civilopedia });
});

app.get("/admin/civilopedia", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  return res.json({ civilopedia: gameSettings.civilopedia });
});

app.get("/admin/population/tuning", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  return res.json({
    birthRateShiftPermille: gameSettings.population.birthRateShiftPermille,
    deathRateShiftPermille: gameSettings.population.deathRateShiftPermille,
    mergeBuckets: gameSettings.population.mergeBuckets,
  });
});

const populationTuningSchema = z.object({
  birthRateShiftPermille: z.coerce.number().int().min(-200).max(200),
  deathRateShiftPermille: z.coerce.number().int().min(-200).max(200),
  mergeBuckets: z.object({
    wealthX100: z.coerce.number().int().min(1).max(100_000),
    loyalty: z.coerce.number().int().min(1).max(1000),
    radicalism: z.coerce.number().int().min(1).max(1000),
    employment: z.coerce.number().int().min(1).max(1000),
    migrationDesire: z.coerce.number().int().min(1).max(1000),
    birthRatePermille: z.coerce.number().int().min(1).max(200),
    deathRatePermille: z.coerce.number().int().min(1).max(200),
  }),
});

app.patch("/admin/population/tuning", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const parsed = populationTuningSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_BODY", issues: parsed.error.flatten() });
  }
  gameSettings.population.birthRateShiftPermille = clampInt(parsed.data.birthRateShiftPermille, -200, 200);
  gameSettings.population.deathRateShiftPermille = clampInt(parsed.data.deathRateShiftPermille, -200, 200);
  gameSettings.population.mergeBuckets = normalizePopulationMergeBuckets(parsed.data.mergeBuckets);
  savePersistentState();
  return res.json({
    ok: true,
    tuning: {
      birthRateShiftPermille: gameSettings.population.birthRateShiftPermille,
      deathRateShiftPermille: gameSettings.population.deathRateShiftPermille,
      mergeBuckets: gameSettings.population.mergeBuckets,
    },
  });
});

const civilopediaUpdateSchema = z.object({
  categories: z.array(z.string().min(1).max(60)).max(200).optional(),
  entries: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        category: z.string().min(1).max(60),
        title: z.string().min(1).max(200),
        summary: z.string().max(5000).default(""),
        keywords: z.array(z.string().min(1).max(80)).max(30).default([]),
        imageUrl: z.string().max(400).nullable().default(null),
        relatedEntryIds: z.array(z.string().min(1).max(120)).max(20).default([]),
        sections: z
          .array(
            z.object({
              title: z.string().min(1).max(200),
              paragraphs: z.array(z.string().min(1).max(8000)).max(40),
            }),
          )
          .max(40),
      }),
    )
    .max(500),
});

app.patch("/admin/civilopedia", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const parsed = civilopediaUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }
  gameSettings.civilopedia.entries = normalizeCivilopediaEntries(parsed.data.entries);
  gameSettings.civilopedia.categories = normalizeCivilopediaCategories(
    parsed.data.categories,
    gameSettings.civilopedia.entries,
  );
  savePersistentState();
  broadcast(wss, {
    type: "NEWS_EVENT",
    event: makeOfficialNews({
      turn: turnId,
      category: "system",
      title: "Цивилопедия обновлена",
      message: "Администратор обновил статьи Цивилопедии",
      countryId: auth.countryId,
      priority: "low",
      visibility: "public",
    }),
  });
  return res.json({ civilopedia: gameSettings.civilopedia });
});

app.patch("/admin/civilopedia/image", upload.single("civilopediaImage"), async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    removeUploadedFile(req.file as Express.Multer.File | undefined);
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const file = req.file as Express.Multer.File | undefined;
  if (!file) {
    return res.status(400).json({ error: "NO_FILE" });
  }
  if (!validateImageDimensions(file, 1024)) {
    removeUploadedFile(file);
    return res.status(400).json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", max: "1024x1024" });
  }
  return res.json({ imageUrl: `/uploads/civilopedia/${file.filename}` });
});

app.patch("/admin/civilopedia/inline-image", upload.single("civilopediaImage"), async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    removeUploadedFile(req.file as Express.Multer.File | undefined);
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const file = req.file as Express.Multer.File | undefined;
  if (!file) {
    return res.status(400).json({ error: "NO_FILE" });
  }
  if (!validateImageDimensions(file, 64)) {
    removeUploadedFile(file);
    return res.status(400).json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", max: "64x64" });
  }
  return res.json({ imageUrl: `/uploads/civilopedia/${file.filename}` });
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

app.patch("/admin/ui-background", upload.single("uiBackground"), async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    removeUploadedFile(req.file as Express.Multer.File | undefined);
    return res.status(403).json({ error: "FORBIDDEN" });
  }

  const file = req.file as Express.Multer.File | undefined;
  if (!file) {
    return res.status(400).json({ error: "NO_FILE" });
  }

  if (!validateImageDimensions(file, 4096)) {
    removeUploadedFile(file);
    return res.status(400).json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", max: "4096x4096" });
  }

  const previousUrl = gameSettings.map.backgroundImageUrl;
  gameSettings.map.backgroundImageUrl = `/uploads/ui-backgrounds/${file.filename}`;
  if (previousUrl) {
    removeUploadedByUrl(previousUrl);
  }

  savePersistentState();
  broadcast(wss, {
    type: "NEWS_EVENT",
    event: makeOfficialNews({
      turn: turnId,
      category: "system",
      title: "Фон интерфейса обновлён",
      message: "Администратор изменил фоновое изображение интерфейса",
      countryId: auth.countryId,
      priority: "low",
      visibility: "public",
    }),
  });

  return res.json({ map: gameSettings.map });
});

const culturePayloadSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(5000).optional().default(""),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});
const populationBaselineGenerateSchema = z.object({
  raceId: z.string().trim().min(1).max(200),
  cultureId: z.string().trim().min(1).max(200),
  religionId: z.string().trim().min(1).max(200),
  professionId: z.string().trim().min(1).max(200),
  ideologyId: z.string().trim().min(1).max(200),
  populationPerProvince: z.coerce.number().int().min(1).max(100_000_000),
  lowerSharePercent: z.coerce.number().int().min(0).max(100).default(78),
  middleSharePercent: z.coerce.number().int().min(0).max(100).default(18),
  upperSharePercent: z.coerce.number().int().min(0).max(100).default(4),
  provinceScope: z.enum(["all", "ownedOnly"]).default("all"),
  replaceExisting: z.boolean().default(true),
});

const contentEntryKindSchema = z.enum(["cultures", "races", "religions", "professions", "ideologies"]);
type ContentEntryKind = z.infer<typeof contentEntryKindSchema>;

function getContentEntriesByKind(kind: ContentEntryKind) {
  return gameSettings.content[kind];
}

function contentNameExists(kind: ContentEntryKind, name: string, excludeId?: string): boolean {
  return getContentEntriesByKind(kind).some(
    (entry) => entry.id !== excludeId && entry.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
}

function getContentDuplicateNameError(kind: ContentEntryKind): string {
  if (kind === "cultures") return "CULTURE_NAME_EXISTS";
  return "CONTENT_NAME_EXISTS";
}

app.get("/content/cultures", (_req, res) => {
  return res.json({ cultures: gameSettings.content.cultures });
});

app.get("/admin/content/cultures", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  return res.json({ cultures: gameSettings.content.cultures });
});

app.post("/admin/content/cultures", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const parsed = culturePayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }
  const normalizedName = parsed.data.name.trim();
  if (gameSettings.content.cultures.some((c) => c.name.trim().toLowerCase() === normalizedName.toLowerCase())) {
    return res.status(409).json({ error: "CULTURE_NAME_EXISTS" });
  }
  const culture = {
    id: randomUUID(),
    name: normalizedName,
    description: (parsed.data.description ?? "").trim(),
    color: parsed.data.color,
    logoUrl: null as string | null,
  };
  gameSettings.content.cultures.unshift(culture);
  savePersistentState();
  return res.json({ culture, cultures: gameSettings.content.cultures });
});

app.patch("/admin/content/cultures/:cultureId", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const parsed = culturePayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }
  const cultureId = String(req.params.cultureId);
  const index = gameSettings.content.cultures.findIndex((c) => c.id === cultureId);
  if (index < 0) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  const normalizedName = parsed.data.name.trim();
  if (
    gameSettings.content.cultures.some(
      (c) => c.id !== cultureId && c.name.trim().toLowerCase() === normalizedName.toLowerCase(),
    )
  ) {
    return res.status(409).json({ error: "CULTURE_NAME_EXISTS" });
  }
  gameSettings.content.cultures[index] = {
    ...gameSettings.content.cultures[index],
    name: normalizedName,
    description: (parsed.data.description ?? "").trim(),
    color: parsed.data.color,
  };
  savePersistentState();
  return res.json({ culture: gameSettings.content.cultures[index], cultures: gameSettings.content.cultures });
});

app.patch("/admin/content/cultures/:cultureId/logo", upload.single("cultureLogo"), async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    removeUploadedFile(req.file as Express.Multer.File | undefined);
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const cultureId = String(req.params.cultureId);
  const index = gameSettings.content.cultures.findIndex((c) => c.id === cultureId);
  if (index < 0) {
    removeUploadedFile(req.file as Express.Multer.File | undefined);
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  const file = req.file as Express.Multer.File | undefined;
  if (!file) {
    return res.status(400).json({ error: "NO_FILE" });
  }
  if (!validateImageDimensions(file, 64)) {
    removeUploadedFile(file);
    return res.status(400).json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", max: "64x64" });
  }
  const previousUrl = gameSettings.content.cultures[index].logoUrl;
  gameSettings.content.cultures[index] = {
    ...gameSettings.content.cultures[index],
    logoUrl: `/uploads/cultures/${file.filename}`,
  };
  if (previousUrl) {
    removeUploadedByUrl(previousUrl);
  }
  savePersistentState();
  return res.json({ culture: gameSettings.content.cultures[index], cultures: gameSettings.content.cultures });
});

app.delete("/admin/content/cultures/:cultureId/logo", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const cultureId = String(req.params.cultureId);
  const index = gameSettings.content.cultures.findIndex((c) => c.id === cultureId);
  if (index < 0) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  const previousUrl = gameSettings.content.cultures[index].logoUrl;
  gameSettings.content.cultures[index] = { ...gameSettings.content.cultures[index], logoUrl: null };
  if (previousUrl) {
    removeUploadedByUrl(previousUrl);
  }
  savePersistentState();
  return res.json({ culture: gameSettings.content.cultures[index], cultures: gameSettings.content.cultures });
});

app.delete("/admin/content/cultures/:cultureId", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const cultureId = String(req.params.cultureId);
  const index = gameSettings.content.cultures.findIndex((c) => c.id === cultureId);
  if (index < 0) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  const [removed] = gameSettings.content.cultures.splice(index, 1);
  if (removed?.logoUrl) {
    removeUploadedByUrl(removed.logoUrl);
  }
  savePersistentState();
  return res.json({ ok: true, cultures: gameSettings.content.cultures });
});

app.get("/content/entries/:kind", (req, res) => {
  const parsedKind = contentEntryKindSchema.safeParse(String(req.params.kind));
  if (!parsedKind.success) {
    return res.status(400).json({ error: "INVALID_CONTENT_KIND" });
  }
  return res.json({ items: getContentEntriesByKind(parsedKind.data) });
});

app.get("/admin/content/entries/:kind", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const parsedKind = contentEntryKindSchema.safeParse(String(req.params.kind));
  if (!parsedKind.success) {
    return res.status(400).json({ error: "INVALID_CONTENT_KIND" });
  }
  return res.json({ items: getContentEntriesByKind(parsedKind.data) });
});

app.post("/admin/content/entries/:kind", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const parsedKind = contentEntryKindSchema.safeParse(String(req.params.kind));
  if (!parsedKind.success) {
    return res.status(400).json({ error: "INVALID_CONTENT_KIND" });
  }
  const parsed = culturePayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }
  const kind = parsedKind.data;
  const normalizedName = parsed.data.name.trim();
  if (contentNameExists(kind, normalizedName)) {
    return res.status(409).json({ error: getContentDuplicateNameError(kind) });
  }
  const item = {
    id: randomUUID(),
    name: normalizedName,
    description: (parsed.data.description ?? "").trim(),
    color: parsed.data.color,
    logoUrl: null as string | null,
    malePortraitUrl: null as string | null,
    femalePortraitUrl: null as string | null,
  };
  getContentEntriesByKind(kind).unshift(item);
  savePersistentState();
  return res.json({ item, items: getContentEntriesByKind(kind) });
});

app.patch("/admin/content/entries/:kind/:entryId", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const parsedKind = contentEntryKindSchema.safeParse(String(req.params.kind));
  if (!parsedKind.success) {
    return res.status(400).json({ error: "INVALID_CONTENT_KIND" });
  }
  const parsed = culturePayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }
  const kind = parsedKind.data;
  const entryId = String(req.params.entryId);
  const items = getContentEntriesByKind(kind);
  const index = items.findIndex((entry) => entry.id === entryId);
  if (index < 0) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  const normalizedName = parsed.data.name.trim();
  if (contentNameExists(kind, normalizedName, entryId)) {
    return res.status(409).json({ error: getContentDuplicateNameError(kind) });
  }
  items[index] = {
    ...items[index],
    name: normalizedName,
    description: (parsed.data.description ?? "").trim(),
    color: parsed.data.color,
  };
  savePersistentState();
  return res.json({ item: items[index], items });
});

app.patch("/admin/content/entries/:kind/:entryId/logo", upload.single("cultureLogo"), async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    removeUploadedFile(req.file as Express.Multer.File | undefined);
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const parsedKind = contentEntryKindSchema.safeParse(String(req.params.kind));
  if (!parsedKind.success) {
    removeUploadedFile(req.file as Express.Multer.File | undefined);
    return res.status(400).json({ error: "INVALID_CONTENT_KIND" });
  }
  const kind = parsedKind.data;
  const entryId = String(req.params.entryId);
  const items = getContentEntriesByKind(kind);
  const index = items.findIndex((entry) => entry.id === entryId);
  if (index < 0) {
    removeUploadedFile(req.file as Express.Multer.File | undefined);
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  const file = req.file as Express.Multer.File | undefined;
  if (!file) {
    return res.status(400).json({ error: "NO_FILE" });
  }
  if (!validateImageDimensions(file, 64)) {
    removeUploadedFile(file);
    return res.status(400).json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", max: "64x64" });
  }
  const previousUrl = items[index].logoUrl;
  items[index] = {
    ...items[index],
    logoUrl: `/uploads/cultures/${file.filename}`,
  };
  if (previousUrl) {
    removeUploadedByUrl(previousUrl);
  }
  savePersistentState();
  return res.json({ item: items[index], items });
});

app.delete("/admin/content/entries/:kind/:entryId/logo", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const parsedKind = contentEntryKindSchema.safeParse(String(req.params.kind));
  if (!parsedKind.success) {
    return res.status(400).json({ error: "INVALID_CONTENT_KIND" });
  }
  const kind = parsedKind.data;
  const entryId = String(req.params.entryId);
  const items = getContentEntriesByKind(kind);
  const index = items.findIndex((entry) => entry.id === entryId);
  if (index < 0) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  const previousUrl = items[index].logoUrl;
  items[index] = { ...items[index], logoUrl: null };
  if (previousUrl) {
    removeUploadedByUrl(previousUrl);
  }
  savePersistentState();
  return res.json({ item: items[index], items });
});

app.delete("/admin/content/entries/:kind/:entryId", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const parsedKind = contentEntryKindSchema.safeParse(String(req.params.kind));
  if (!parsedKind.success) {
    return res.status(400).json({ error: "INVALID_CONTENT_KIND" });
  }
  const kind = parsedKind.data;
  const entryId = String(req.params.entryId);
  const items = getContentEntriesByKind(kind);
  const index = items.findIndex((entry) => entry.id === entryId);
  if (index < 0) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  const [removed] = items.splice(index, 1);
  if (removed?.logoUrl) {
    removeUploadedByUrl(removed.logoUrl);
  }
  if (removed?.malePortraitUrl) {
    removeUploadedByUrl(removed.malePortraitUrl);
  }
  if (removed?.femalePortraitUrl) {
    removeUploadedByUrl(removed.femalePortraitUrl);
  }
  savePersistentState();
  return res.json({ ok: true, items });
});

const racePortraitSlotSchema = z.enum(["male", "female"]);

app.patch("/admin/content/entries/races/:entryId/portraits/:slot", upload.single("racePortrait"), async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    removeUploadedFile(req.file as Express.Multer.File | undefined);
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const slotParsed = racePortraitSlotSchema.safeParse(String(req.params.slot));
  if (!slotParsed.success) {
    removeUploadedFile(req.file as Express.Multer.File | undefined);
    return res.status(400).json({ error: "INVALID_RACE_PORTRAIT_SLOT" });
  }
  const entryId = String(req.params.entryId);
  const items = gameSettings.content.races;
  const index = items.findIndex((entry) => entry.id === entryId);
  if (index < 0) {
    removeUploadedFile(req.file as Express.Multer.File | undefined);
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  const file = req.file as Express.Multer.File | undefined;
  if (!file) {
    return res.status(400).json({ error: "NO_FILE" });
  }
  if (!validateImageDimensions(file, 100)) {
    removeUploadedFile(file);
    return res.status(400).json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", max: "89x100" });
  }
  try {
    const image = imageSize(readFileSync(file.path));
    const width = Number(image.width ?? 0);
    const height = Number(image.height ?? 0);
    if (width > 89 || height > 100) {
      removeUploadedFile(file);
      return res.status(400).json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", max: "89x100" });
    }
  } catch {
    removeUploadedFile(file);
    return res.status(400).json({ error: "IMAGE_INVALID" });
  }
  const key = slotParsed.data === "male" ? "malePortraitUrl" : "femalePortraitUrl";
  const previousUrl = items[index][key] ?? null;
  items[index] = {
    ...items[index],
    [key]: `/uploads/cultures/${file.filename}`,
  };
  if (previousUrl) {
    removeUploadedByUrl(previousUrl);
  }
  savePersistentState();
  return res.json({ item: items[index], items });
});

app.delete("/admin/content/entries/races/:entryId/portraits/:slot", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const slotParsed = racePortraitSlotSchema.safeParse(String(req.params.slot));
  if (!slotParsed.success) {
    return res.status(400).json({ error: "INVALID_RACE_PORTRAIT_SLOT" });
  }
  const entryId = String(req.params.entryId);
  const items = gameSettings.content.races;
  const index = items.findIndex((entry) => entry.id === entryId);
  if (index < 0) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  const key = slotParsed.data === "male" ? "malePortraitUrl" : "femalePortraitUrl";
  const previousUrl = items[index][key] ?? null;
  items[index] = {
    ...items[index],
    [key]: null,
  };
  if (previousUrl) {
    removeUploadedByUrl(previousUrl);
  }
  savePersistentState();
  return res.json({ item: items[index], items });
});

app.get("/population/summary/world", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  sanitizePopulationContentReferences(worldBase);
  return res.json(buildPopulationWorldSummaryResponseCached());
});

app.get("/population/summary/country/:countryId", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const countryId = String(req.params.countryId);
  if (auth.countryId !== countryId && !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  sanitizePopulationContentReferences(worldBase);
  return res.json(buildPopulationCountrySummaryResponseCached(countryId));
});

app.post("/admin/population/generate-baseline", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const parsed = populationBaselineGenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }
  const data = parsed.data;
  const shareSum = data.lowerSharePercent + data.middleSharePercent + data.upperSharePercent;
  if (shareSum <= 0) {
    return res.status(400).json({ error: "INVALID_STRATA_SHARES" });
  }

  const races = new Set(gameSettings.content.races.map((v) => v.id));
  const cultures = new Set(gameSettings.content.cultures.map((v) => v.id));
  const religions = new Set(gameSettings.content.religions.map((v) => v.id));
  const professions = new Set(gameSettings.content.professions.map((v) => v.id));
  const ideologies = new Set(gameSettings.content.ideologies.map((v) => v.id));
  if (!races.has(data.raceId)) return res.status(400).json({ error: "INVALID_RACE_ID" });
  if (!cultures.has(data.cultureId)) return res.status(400).json({ error: "INVALID_CULTURE_ID" });
  if (!religions.has(data.religionId)) return res.status(400).json({ error: "INVALID_RELIGION_ID" });
  if (!professions.has(data.professionId)) return res.status(400).json({ error: "INVALID_PROFESSION_ID" });
  if (!ideologies.has(data.ideologyId)) return res.status(400).json({ error: "INVALID_IDEOLOGY_ID" });

  const allProvinceIds = getAllProvinceIdsFromAdm1();
  const targetProvinceIds = allProvinceIds.filter((provinceId) =>
    data.provinceScope === "ownedOnly" ? Boolean(worldBase.provinceOwner[provinceId]) : true,
  );

  const nextGroups: PopGroup[] = data.replaceExisting
    ? worldBase.population.popGroups.filter((g) => !targetProvinceIds.includes(g.provinceId))
    : [...worldBase.population.popGroups];

  const normalizedPopulationPerProvince = Math.max(1, data.populationPerProvince);
  for (const provinceId of targetProvinceIds) {
    const lowerSize = Math.floor((normalizedPopulationPerProvince * data.lowerSharePercent) / shareSum);
    const middleSize = Math.floor((normalizedPopulationPerProvince * data.middleSharePercent) / shareSum);
    const upperSize = Math.max(0, normalizedPopulationPerProvince - lowerSize - middleSize);
    const rows: Array<{ strata: PopStrata; size: number; wealthX100: number; employment: number; birthRatePermille: number; deathRatePermille: number }> = [
      { strata: "lower", size: lowerSize, wealthX100: 700, employment: 820, birthRatePermille: 19, deathRatePermille: 12 },
      { strata: "middle", size: middleSize, wealthX100: 1500, employment: 900, birthRatePermille: 15, deathRatePermille: 10 },
      { strata: "upper", size: upperSize, wealthX100: 3800, employment: 950, birthRatePermille: 11, deathRatePermille: 9 },
    ];
    for (const row of rows) {
      if (row.size <= 0) continue;
      nextGroups.push({
        id: randomUUID(),
        provinceId,
        raceId: data.raceId,
        cultureId: data.cultureId,
        religionId: data.religionId,
        professionId: data.professionId,
        ideologyId: data.ideologyId,
        strata: row.strata,
        size: row.size,
        wealthX100: row.wealthX100,
        loyalty: 550,
        radicalism: 120,
        employment: row.employment,
        migrationDesire: 90,
        birthRatePermille: row.birthRatePermille,
        deathRatePermille: row.deathRatePermille,
      });
    }
  }

  worldBase.population = makePopulationState(mergePopGroups(nextGroups), worldBase.provinceOwner, {
    history: worldBase.population.history,
    turnId: worldBase.turnId,
  });
  savePersistentState();
  return res.json({
    ok: true,
    provincesAffected: targetProvinceIds.length,
    popGroupCount: worldBase.population.popGroups.length,
    totalPopulation: Object.values(worldBase.population.countrySummaries).reduce((sum, c) => sum + c.totalPopulation, 0),
  });
});

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
    if (typeof nextCustomization.provinceRenameDucats === "number") {
      gameSettings.customization.provinceRenameDucats = nextCustomization.provinceRenameDucats;
    }
  }

  const nextRegistration = parsed.data.registration;
  if (nextRegistration) {
    if (typeof nextRegistration.requireAdminApproval === "boolean") {
      gameSettings.registration.requireAdminApproval = nextRegistration.requireAdminApproval;
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

  const nextPopulation = parsed.data.population;
  if (nextPopulation) {
    if (typeof nextPopulation.birthRateShiftPermille === "number") {
      gameSettings.population.birthRateShiftPermille = clampInt(nextPopulation.birthRateShiftPermille, -200, 200);
    }
    if (typeof nextPopulation.deathRateShiftPermille === "number") {
      gameSettings.population.deathRateShiftPermille = clampInt(nextPopulation.deathRateShiftPermille, -200, 200);
    }
    if (nextPopulation.mergeBuckets) {
      gameSettings.population.mergeBuckets = normalizePopulationMergeBuckets(nextPopulation.mergeBuckets);
    }
  }

  const nextMap = parsed.data.map;
  if (nextMap) {
    if (typeof nextMap.showAntarctica === "boolean") {
      gameSettings.map.showAntarctica = nextMap.showAntarctica;
    }
    if (nextMap.backgroundImageUrl === null) {
      const previousUrl = gameSettings.map.backgroundImageUrl;
      gameSettings.map.backgroundImageUrl = null;
      if (previousUrl) {
        removeUploadedByUrl(previousUrl);
      }
    } else if (typeof nextMap.backgroundImageUrl === "string") {
      gameSettings.map.backgroundImageUrl = nextMap.backgroundImageUrl;
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

const provinceRenameSchema = z.object({
  provinceId: z.string().min(1),
  provinceName: z.string().trim().min(1).max(64),
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

app.patch("/country/province-rename", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  const parsed = provinceRenameSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  const { provinceId, provinceName } = parsed.data;
  const ownerCountryId = worldBase.provinceOwner[provinceId] ?? null;
  if (!ownerCountryId || ownerCountryId !== auth.countryId) {
    return res.status(403).json({ error: "NOT_PROVINCE_OWNER" });
  }

  if (!adm1ProvinceIndex.some((p) => p.id === provinceId)) {
    return res.status(404).json({ error: "PROVINCE_NOT_FOUND" });
  }

  ensureCountryInWorldBase(auth.countryId);
  const resources = worldBase.resourcesByCountry[auth.countryId];
  if (!resources) {
    return res.status(500).json({ error: "NO_RESOURCES" });
  }
  const provinceRenameDucatsCost = Math.max(0, Math.floor(gameSettings.customization.provinceRenameDucats ?? 25));
  if (resources.ducats < provinceRenameDucatsCost) {
    return res.status(400).json({
      error: "INSUFFICIENT_DUCATS",
      required: provinceRenameDucatsCost,
      available: resources.ducats,
    });
  }

  resources.ducats = Math.max(0, resources.ducats - provinceRenameDucatsCost);
  worldBase.provinceNameById[provinceId] = provinceName;

  savePersistentState();
  broadcastWorldBaseSync(wss);
  broadcast(wss, {
    type: "NEWS_EVENT",
    event: makeOfficialNews({
      turn: turnId,
      category: "politics",
      title: "Провинция переименована",
      message: `${auth.countryId} переименовал провинцию ${provinceId} в "${provinceName}"`,
      countryId: auth.countryId,
      priority: "low",
      visibility: "public",
    }),
  });

  return res.json({
    provinceId,
    provinceName,
    chargedDucats: provinceRenameDucatsCost,
    resources: { ducats: resources.ducats },
  });
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
    reasonText: z.string().trim().max(300).optional(),
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
  const reasonText = input.reasonText?.trim() ? input.reasonText.trim() : null;
  let data: { isLocked?: boolean; blockedUntilTurn?: number | null; blockedUntilAt?: Date | null; lockReason?: string | null } = {};

  if (input.action === "unlock") {
    data = { isLocked: false, blockedUntilTurn: null, blockedUntilAt: null, lockReason: null };
  }

  if (input.action === "permanent") {
    data = { isLocked: true, blockedUntilTurn: null, blockedUntilAt: null, lockReason: reasonText };
  }

  if (input.action === "turns") {
    data = { isLocked: false, blockedUntilTurn: turnId + (input.turns ?? 0), blockedUntilAt: null, lockReason: reasonText };
  }

  if (input.action === "time") {
    const until = new Date(input.blockedUntilAt ?? "");
    if (Number.isNaN(until.getTime()) || until <= new Date()) {
      return res.status(400).json({ error: "INVALID_TIME" });
    }
    data = { isLocked: false, blockedUntilTurn: null, blockedUntilAt: until, lockReason: reasonText };
  }

  const updated = await prisma.country.update({ where: { id: countryIdParam }, data, select: countrySelect });
  const punishmentNewsMessageBase =
    input.action === "unlock"
      ? `С страны ${updated.name} сняты ограничения`
      : input.action === "permanent"
        ? `Страна ${updated.name} заблокирована бессрочно`
        : input.action === "turns"
          ? `Страна ${updated.name} заблокирована до хода #${data.blockedUntilTurn ?? turnId}`
          : `Страна ${updated.name} заблокирована по времени`;
  const punishmentNewsMessage =
    input.action !== "unlock" && reasonText ? `${punishmentNewsMessageBase}. Причина: ${reasonText}` : punishmentNewsMessageBase;
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
    const isAdminCountry = !hasAnyAdmin;
    const requiresApproval = gameSettings.registration.requireAdminApproval && !isAdminCountry;
    const country = await prisma.country.create({
      data: {
        name: countryName,
        color: countryColor,
        flagUrl: flagFile ? `/uploads/flags/${flagFile.filename}` : null,
        crestUrl: crestFile ? `/uploads/crests/${crestFile.filename}` : null,
        passwordHash,
        isAdmin: isAdminCountry,
        isRegistrationApproved: !requiresApproval,
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
    if (requiresApproval) {
      sendUiNotificationToAdmins(wss, makeRegistrationApprovalUiNotification(country));
    }
    broadcast(wss, {
      type: "NEWS_EVENT",
      event: makeOfficialNews({
        turn: turnId,
        category: "politics",
        title: "Новая страна",
        message: requiresApproval ? `Зарегистрирована страна ${country.name} (ожидает подтверждения)` : `Зарегистрирована страна ${country.name}`,
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
      return res.status(403).json({ error: "ACCOUNT_LOCKED", reason: "PERMANENT", lockReason: country.lockReason ?? null });
    }

    if (block.reason === "TURN") {
      return res.status(403).json({
        error: "ACCOUNT_LOCKED",
        reason: "TURN",
        blockedUntilTurn: block.blockedUntilTurn,
        currentTurn: turnId,
        lockReason: country.lockReason ?? null,
      });
    }

    return res.status(403).json({
      error: "ACCOUNT_LOCKED",
      reason: "TIME",
      blockedUntilAt: block.blockedUntilAt?.toISOString() ?? null,
      lockReason: country.lockReason ?? null,
    });
  }

  const ok = await bcrypt.compare(password, country.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "INVALID_PASSWORD" });
  }
  if (country.isRegistrationApproved === false) {
    return res.status(403).json({ error: "REGISTRATION_PENDING_APPROVAL" });
  }

  ensureCountryInWorldBase(country.id);
  lastLoginAtByCountryId.set(country.id, new Date().toISOString());
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

const registrationReviewSchema = z.object({
  approve: z.boolean(),
});

const adminUiNotificationSchema = z.object({
  category: z.enum(["system", "politics", "economy"]),
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(500),
});

app.patch("/admin/registrations/:countryId/review", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const parsed = registrationReviewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }
  const targetId = String(req.params.countryId);
  const target = await prisma.country.findUnique({ where: { id: targetId }, select: countrySelect });
  if (!target) {
    return res.status(404).json({ error: "COUNTRY_NOT_FOUND" });
  }
  if (target.isRegistrationApproved) {
    return res.status(400).json({ error: "REGISTRATION_ALREADY_REVIEWED" });
  }

  if (parsed.data.approve) {
    const updated = await prisma.country.update({
      where: { id: targetId },
      data: { isRegistrationApproved: true },
      select: countrySelect,
    });
    removeQueuedUiNotification(`registration-approval:${targetId}`);
    broadcast(wss, {
      type: "NEWS_EVENT",
      event: makeOfficialNews({
        turn: turnId,
        category: "politics",
        title: "Регистрация подтверждена",
        message: `Администратор подтвердил регистрацию страны ${updated.name}`,
        countryId: updated.id,
        priority: "medium",
        visibility: "public",
      }),
    });
    return res.json({ ok: true, approved: true, country: countryFromDb(updated) });
  }

  const fullTarget = await prisma.country.findUnique({ where: { id: targetId } });
  if (!fullTarget) {
    return res.status(404).json({ error: "COUNTRY_NOT_FOUND" });
  }
  removeUploadedByUrl(fullTarget.flagUrl);
  removeUploadedByUrl(fullTarget.crestUrl);
  await prisma.country.delete({ where: { id: targetId } });

  delete worldBase.resourcesByCountry[targetId];
  for (const [provinceId, ownerId] of Object.entries(worldBase.provinceOwner)) {
    if (ownerId === targetId) delete worldBase.provinceOwner[provinceId];
  }
  for (const [provinceId, progressByCountry] of Object.entries(worldBase.colonyProgressByProvince)) {
    if (progressByCountry[targetId] != null) {
      delete progressByCountry[targetId];
      if (Object.keys(progressByCountry).length === 0) delete worldBase.colonyProgressByProvince[provinceId];
    }
  }
  savePersistentState();
  removeQueuedUiNotification(`registration-approval:${targetId}`);
  broadcastWorldBaseSync(wss);
  broadcast(wss, {
    type: "NEWS_EVENT",
    event: makeOfficialNews({
      turn: turnId,
      category: "politics",
      title: "Регистрация отклонена",
      message: `Администратор отклонил регистрацию страны ${target.name}`,
      countryId: target.id,
      priority: "medium",
      visibility: "public",
    }),
  });
  return res.json({ ok: true, approved: false, countryId: target.id });
});

app.post("/admin/ui-notifications", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const parsed = adminUiNotificationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  const notification: Extract<WsOutMessage, { type: "UI_NOTIFY" }>["notification"] = {
    id: randomUUID(),
    category: parsed.data.category,
    createdAt: new Date().toISOString(),
    title: parsed.data.title,
    message: parsed.data.message,
    action: { type: "message" },
  };

  broadcastUiNotification(wss, notification);
  return res.json({ ok: true, notification });
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
        (socket as WebSocket & { __arcIsAdmin?: boolean; __arcCountryId?: string }).__arcIsAdmin = isAdmin;
        (socket as WebSocket & { __arcIsAdmin?: boolean; __arcCountryId?: string }).__arcCountryId = country.id;
        if (!lastLoginAtByCountryId.has(country.id)) {
          lastLoginAtByCountryId.set(country.id, new Date().toISOString());
        }
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
        if (isAdmin) {
          await sendPendingRegistrationNotificationsToAdminSocket(socket, country.id);
        }
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


































