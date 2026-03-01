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
  type ProvincePopulation,
  type ResourceTotals,
  type ServerStatus,
  type WorldBase,
  type WorldDelta,
  WORLD_DELTA_MASK,
  type WsInMessage,
  type WsOutMessage,
} from "@arcanorum/shared";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../.env") });
if (!process.env.DATABASE_URL) {
  const fallbackDbPath = resolve(__dirname, "../prisma/dev.db").replace(/\\/g, "/");
  process.env.DATABASE_URL = `file:${fallbackDbPath}`;
}

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
const contentUploadDirs = {
  cultures: resolve(uploadsRoot, "cultures"),
  religions: resolve(uploadsRoot, "religions"),
  professions: resolve(uploadsRoot, "professions"),
  ideologies: resolve(uploadsRoot, "ideologies"),
  races: resolve(uploadsRoot, "races"),
  buildings: resolve(uploadsRoot, "buildings"),
  goods: resolve(uploadsRoot, "goods"),
  companies: resolve(uploadsRoot, "companies"),
  industries: resolve(uploadsRoot, "industries"),
  technologies: resolve(uploadsRoot, "technologies"),
} as const;
mkdirSync(flagsDir, { recursive: true });
mkdirSync(crestsDir, { recursive: true });
mkdirSync(resourceIconsDir, { recursive: true });
mkdirSync(uiBackgroundsDir, { recursive: true });
mkdirSync(civilopediaImagesDir, { recursive: true });
for (const dir of Object.values(contentUploadDirs)) {
  mkdirSync(dir, { recursive: true });
}

function resolveContentUploadDir(kind?: string): string {
  if (!kind) return contentUploadDirs.cultures;
  if (kind === "cultures") return contentUploadDirs.cultures;
  if (kind === "religions") return contentUploadDirs.religions;
  if (kind === "professions") return contentUploadDirs.professions;
  if (kind === "ideologies") return contentUploadDirs.ideologies;
  if (kind === "races") return contentUploadDirs.races;
  if (kind === "buildings") return contentUploadDirs.buildings;
  if (kind === "goods") return contentUploadDirs.goods;
  if (kind === "companies") return contentUploadDirs.companies;
  if (kind === "industries") return contentUploadDirs.industries;
  if (kind === "technologies") return contentUploadDirs.technologies;
  return contentUploadDirs.cultures;
}

const resourceIconFields = new Set(["culture", "science", "religion", "colonization", "ducats", "gold"]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
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
    if (file.fieldname === "cultureLogo") {
      const kindParam = typeof req.params.kind === "string" ? req.params.kind : undefined;
      cb(null, resolveContentUploadDir(kindParam));
      return;
    }
    if (file.fieldname === "racePortrait") {
      cb(null, contentUploadDirs.races);
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
let worldStateVersion = 1;
type WsDeltaSizeMetrics = {
  totalMessages: number;
  totalCompactBytes: number;
  totalBaselineBytes: number;
  maxCompactBytes: number;
  maxBaselineBytes: number;
  lastCompactBytes: number;
  lastBaselineBytes: number;
  lastTurnId: number | null;
  lastStateVersion: number | null;
  updatedAtIso: string | null;
};
const wsDeltaSizeMetrics: WsDeltaSizeMetrics = {
  totalMessages: 0,
  totalCompactBytes: 0,
  totalBaselineBytes: 0,
  maxCompactBytes: 0,
  maxBaselineBytes: 0,
  lastCompactBytes: 0,
  lastBaselineBytes: 0,
  lastTurnId: null,
  lastStateVersion: null,
  updatedAtIso: null,
};
const MAX_WORLD_DELTA_HISTORY = 512;
const MAX_PERSISTED_WORLD_DELTA_LOG = 10_000;
const PERSIST_STATE_DEBOUNCE_MS = 750;
const WORLD_DELTA_LOG_PRUNE_INTERVAL_MS = 30_000;
const worldDeltaHistory: WorldDelta[] = [];
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
const activeColonizeProvincesByCountry = new Map<string, Set<string>>();
const queuedColonizeProvincesByCountryByTurn = new Map<number, Map<string, Set<string>>>();
const queuedBuildProvincesByCountryByTurn = new Map<number, Map<string, Set<string>>>();
const economyTickCountryIds = new Set<string>();
const COUNTRY_QUERY_CACHE_TTL_MS = 2_000;
const countryQueryCache = new Map<string, { expiresAtMs: number; value: unknown }>();
const DEFAULT_MAX_ACTIVE_COLONIZATIONS = 3;
const DEFAULT_COLONIZATION_POINTS_PER_TURN = 30;
const COLONIZATION_GOAL = 100;
const DEFAULT_PROVINCE_COLONIZATION_COST = 100;
const SETTINGS_MAX_NUMBER = 1_000_000_000_000;
const POPULATION_MIN_TOTAL = 100;
const POPULATION_DEFAULT_BASE_TOTAL = 10_000;
const POPULATION_BIRTH_RATE = 0.012;
const POPULATION_DEATH_RATE = 0.008;

type PopulationDimensionKey = "culturePct" | "ideologyPct" | "religionPct" | "racePct" | "professionPct";

type PopulationDomainKeys = {
  culturePct: string[];
  ideologyPct: string[];
  religionPct: string[];
  racePct: string[];
  professionPct: string[];
};

const POPULATION_FALLBACK_KEY_BY_DIMENSION: Record<PopulationDimensionKey, string> = {
  culturePct: "culture:default",
  ideologyPct: "ideology:default",
  religionPct: "religion:default",
  racePct: "race:default",
  professionPct: "profession:default",
};

function invalidateCountryQueryCache(): void {
  countryQueryCache.clear();
}

async function getCachedCountryQuery<T>(params: { key: string; ttlMs?: number; loader: () => Promise<T> }): Promise<T> {
  const ttlMs = params.ttlMs ?? COUNTRY_QUERY_CACHE_TTL_MS;
  const nowMs = Date.now();
  const cached = countryQueryCache.get(params.key);
  if (cached && cached.expiresAtMs > nowMs) {
    return cached.value as T;
  }
  const value = await params.loader();
  countryQueryCache.set(params.key, { expiresAtMs: nowMs + ttlMs, value });
  return value;
}

type GameSettings = {
  content: {
    races: Array<{
      id: string;
      name: string;
      description: string;
      color: string;
      logoUrl: string | null;
      malePortraitUrl: string | null;
      femalePortraitUrl: string | null;
    }>;
    professions: Array<{
      id: string;
      name: string;
      description: string;
      color: string;
      logoUrl: string | null;
      malePortraitUrl: string | null;
      femalePortraitUrl: string | null;
    }>;
    ideologies: Array<{
      id: string;
      name: string;
      description: string;
      color: string;
      logoUrl: string | null;
      malePortraitUrl: string | null;
      femalePortraitUrl: string | null;
    }>;
    religions: Array<{
      id: string;
      name: string;
      description: string;
      color: string;
      logoUrl: string | null;
      malePortraitUrl: string | null;
      femalePortraitUrl: string | null;
    }>;
    technologies: Array<{
      id: string;
      name: string;
      description: string;
      color: string;
      logoUrl: string | null;
      malePortraitUrl: string | null;
      femalePortraitUrl: string | null;
    }>;
    buildings: Array<{
      id: string;
      name: string;
      description: string;
      color: string;
      logoUrl: string | null;
      malePortraitUrl: string | null;
      femalePortraitUrl: string | null;
    }>;
    goods: Array<{
      id: string;
      name: string;
      description: string;
      color: string;
      logoUrl: string | null;
      malePortraitUrl: string | null;
      femalePortraitUrl: string | null;
    }>;
    companies: Array<{
      id: string;
      name: string;
      description: string;
      color: string;
      logoUrl: string | null;
      malePortraitUrl: string | null;
      femalePortraitUrl: string | null;
    }>;
    industries: Array<{
      id: string;
      name: string;
      description: string;
      color: string;
      logoUrl: string | null;
      malePortraitUrl: string | null;
      femalePortraitUrl: string | null;
    }>;
    cultures: Array<{
      id: string;
      name: string;
      description: string;
      color: string;
      logoUrl: string | null;
      malePortraitUrl: string | null;
      femalePortraitUrl: string | null;
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

function normalizeContentRaces(input: unknown): GameSettings["content"]["races"] {
  return normalizeContentCultures(input);
}

function hashStringToUInt32(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizePercentageMap(input: unknown, allowedKeys: string[], fallbackKey: string): Record<string, number> {
  const fallback = fallbackKey.trim() || "default";
  const normalizedKeys = [...new Set(allowedKeys.map((key) => key.trim()).filter(Boolean))];
  const keys = normalizedKeys.length > 0 ? normalizedKeys : [fallback];
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const rawByKey = new Map<string, number>();
  let total = 0;

  for (const key of keys) {
    const raw = source[key];
    const value = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, raw) : 0;
    rawByKey.set(key, value);
    total += value;
  }

  if (total <= 0) {
    return { [keys[0]]: 100 };
  }

  const unitsByKey = new Map<string, number>();
  const fractional: Array<{ key: string; remainder: number }> = [];
  let usedUnits = 0;
  for (const key of keys) {
    const scaled = (rawByKey.get(key) ?? 0) * 10000 / total;
    const baseUnits = Math.floor(scaled);
    unitsByKey.set(key, baseUnits);
    usedUnits += baseUnits;
    fractional.push({ key, remainder: scaled - baseUnits });
  }

  fractional.sort((a, b) => b.remainder - a.remainder || a.key.localeCompare(b.key));
  let remainingUnits = 10000 - usedUnits;
  let index = 0;
  while (remainingUnits > 0 && fractional.length > 0) {
    const row = fractional[index % fractional.length];
    unitsByKey.set(row.key, (unitsByKey.get(row.key) ?? 0) + 1);
    remainingUnits -= 1;
    index += 1;
  }

  const result: Record<string, number> = {};
  for (const key of keys) {
    const units = unitsByKey.get(key) ?? 0;
    if (units <= 0) continue;
    result[key] = units / 100;
  }
  return Object.keys(result).length > 0 ? result : { [keys[0]]: 100 };
}

function getPopulationDomainKeys(): PopulationDomainKeys {
  return {
    culturePct: gameSettings.content.cultures.map((entry) => entry.id),
    ideologyPct: gameSettings.content.ideologies.map((entry) => entry.id),
    religionPct: gameSettings.content.religions.map((entry) => entry.id),
    racePct: gameSettings.content.races.map((entry) => entry.id),
    professionPct: gameSettings.content.professions.map((entry) => entry.id),
  };
}

function buildDeterministicPctMap(keys: string[], seed: string, fallbackKey: string): Record<string, number> {
  if (keys.length <= 1) {
    const key = (keys[0] ?? fallbackKey).trim() || fallbackKey;
    return { [key]: 100 };
  }
  const weighted: Record<string, number> = {};
  for (const key of keys) {
    weighted[key] = (hashStringToUInt32(`${seed}:${key}`) % 1000) + 1;
  }
  return normalizePercentageMap(weighted, keys, fallbackKey);
}

function buildRandomPctMap(keys: string[], fallbackKey: string): Record<string, number> {
  const sourceKeys = keys.length > 0 ? keys : [fallbackKey];
  const weights: Record<string, number> = {};
  for (const key of sourceKeys) {
    weights[key] = Math.random() * 100 + 1;
  }
  return normalizePercentageMap(weights, sourceKeys, fallbackKey);
}

function isEqualPercentageMap(prevValue: Record<string, number> | undefined, nextValue: Record<string, number>): boolean {
  if (!prevValue) {
    return false;
  }
  const prevKeys = Object.keys(prevValue);
  const nextKeys = Object.keys(nextValue);
  if (prevKeys.length !== nextKeys.length) {
    return false;
  }
  for (const key of nextKeys) {
    if ((prevValue[key] ?? Number.NaN) !== nextValue[key]) {
      return false;
    }
  }
  return true;
}

function isEqualProvincePopulation(prevValue: ProvincePopulation | undefined, nextValue: ProvincePopulation): boolean {
  if (!prevValue) {
    return false;
  }
  return (
    prevValue.populationTotal === nextValue.populationTotal &&
    isEqualPercentageMap(prevValue.culturePct, nextValue.culturePct) &&
    isEqualPercentageMap(prevValue.ideologyPct, nextValue.ideologyPct) &&
    isEqualPercentageMap(prevValue.religionPct, nextValue.religionPct) &&
    isEqualPercentageMap(prevValue.racePct, nextValue.racePct) &&
    isEqualPercentageMap(prevValue.professionPct, nextValue.professionPct)
  );
}

function buildDefaultProvincePopulation(provinceId: string, domains: PopulationDomainKeys): ProvincePopulation {
  const areaKm2 = Math.max(1, adm1ProvinceAreaById.get(provinceId) ?? 1_000);
  const seed = hashStringToUInt32(provinceId);
  const areaBasedPopulation = Math.floor(areaKm2 * 120);
  const populationTotal = Math.max(POPULATION_MIN_TOTAL, areaBasedPopulation + POPULATION_DEFAULT_BASE_TOTAL + (seed % 5000));
  return {
    populationTotal,
    culturePct: buildDeterministicPctMap(
      domains.culturePct,
      `${provinceId}:culture`,
      POPULATION_FALLBACK_KEY_BY_DIMENSION.culturePct,
    ),
    ideologyPct: buildDeterministicPctMap(
      domains.ideologyPct,
      `${provinceId}:ideology`,
      POPULATION_FALLBACK_KEY_BY_DIMENSION.ideologyPct,
    ),
    religionPct: buildDeterministicPctMap(
      domains.religionPct,
      `${provinceId}:religion`,
      POPULATION_FALLBACK_KEY_BY_DIMENSION.religionPct,
    ),
    racePct: buildDeterministicPctMap(
      domains.racePct,
      `${provinceId}:race`,
      POPULATION_FALLBACK_KEY_BY_DIMENSION.racePct,
    ),
    professionPct: buildDeterministicPctMap(
      domains.professionPct,
      `${provinceId}:profession`,
      POPULATION_FALLBACK_KEY_BY_DIMENSION.professionPct,
    ),
  };
}

function normalizeProvincePopulation(
  input: unknown,
  provinceId: string,
  domains: PopulationDomainKeys,
): ProvincePopulation {
  const fallback = buildDefaultProvincePopulation(provinceId, domains);
  if (!input || typeof input !== "object") {
    return fallback;
  }
  const row = input as Partial<ProvincePopulation>;
  const rawTotal = row.populationTotal;
  const populationTotal =
    typeof rawTotal === "number" && Number.isFinite(rawTotal)
      ? (rawTotal <= 0 ? 0 : Math.max(POPULATION_MIN_TOTAL, Math.floor(rawTotal)))
      : fallback.populationTotal;
  return {
    populationTotal,
    culturePct: normalizePercentageMap(
      row.culturePct,
      domains.culturePct,
      POPULATION_FALLBACK_KEY_BY_DIMENSION.culturePct,
    ),
    ideologyPct: normalizePercentageMap(
      row.ideologyPct,
      domains.ideologyPct,
      POPULATION_FALLBACK_KEY_BY_DIMENSION.ideologyPct,
    ),
    religionPct: normalizePercentageMap(
      row.religionPct,
      domains.religionPct,
      POPULATION_FALLBACK_KEY_BY_DIMENSION.religionPct,
    ),
    racePct: normalizePercentageMap(row.racePct, domains.racePct, POPULATION_FALLBACK_KEY_BY_DIMENSION.racePct),
    professionPct: normalizePercentageMap(
      row.professionPct,
      domains.professionPct,
      POPULATION_FALLBACK_KEY_BY_DIMENSION.professionPct,
    ),
  };
}

function buildRandomProvincePopulation(
  provinceId: string,
  domains: PopulationDomainKeys,
  populationTotalOverride?: number,
): ProvincePopulation {
  const fallback = buildDefaultProvincePopulation(provinceId, domains);
  const total =
    typeof populationTotalOverride === "number" && Number.isFinite(populationTotalOverride)
      ? Math.max(0, Math.floor(populationTotalOverride))
      : fallback.populationTotal;
  return {
    populationTotal: total,
    culturePct: buildRandomPctMap(domains.culturePct, POPULATION_FALLBACK_KEY_BY_DIMENSION.culturePct),
    ideologyPct: buildRandomPctMap(domains.ideologyPct, POPULATION_FALLBACK_KEY_BY_DIMENSION.ideologyPct),
    religionPct: buildRandomPctMap(domains.religionPct, POPULATION_FALLBACK_KEY_BY_DIMENSION.religionPct),
    racePct: buildRandomPctMap(domains.racePct, POPULATION_FALLBACK_KEY_BY_DIMENSION.racePct),
    professionPct: buildRandomPctMap(domains.professionPct, POPULATION_FALLBACK_KEY_BY_DIMENSION.professionPct),
  };
}

function normalizeProvincePopulationMap(input: unknown): Record<string, ProvincePopulation> {
  const domains = getPopulationDomainKeys();
  const normalized: Record<string, ProvincePopulation> = {};
  if (input && typeof input === "object") {
    for (const [provinceId, raw] of Object.entries(input as Record<string, unknown>)) {
      normalized[provinceId] = normalizeProvincePopulation(raw, provinceId, domains);
    }
  }
  for (const province of adm1ProvinceIndex) {
    if (!normalized[province.id]) {
      normalized[province.id] = buildDefaultProvincePopulation(province.id, domains);
    }
  }
  return normalized;
}

function resolvePopulationTurnForProvince(currentPopulation: ProvincePopulation): ProvincePopulation {
  if (currentPopulation.populationTotal <= 0) {
    return currentPopulation;
  }
  const growthRate = POPULATION_BIRTH_RATE - POPULATION_DEATH_RATE;
  const populationTotal = Math.max(
    POPULATION_MIN_TOTAL,
    Math.floor(currentPopulation.populationTotal * Math.max(0.8, 1 + growthRate)),
  );
  return {
    populationTotal,
    culturePct: currentPopulation.culturePct,
    ideologyPct: currentPopulation.ideologyPct,
    religionPct: currentPopulation.religionPct,
    racePct: currentPopulation.racePct,
    professionPct: currentPopulation.professionPct,
  };
}

function resolvePopulationTurn(): void {
  const domains = getPopulationDomainKeys();
  for (const province of adm1ProvinceIndex) {
    const provinceId = province.id;
    const currentPopulation = normalizeProvincePopulation(
      worldBase.provincePopulationByProvince[provinceId],
      provinceId,
      domains,
    );
    const nextPopulation = resolvePopulationTurnForProvince(currentPopulation);
    if (!isEqualProvincePopulation(worldBase.provincePopulationByProvince[provinceId], nextPopulation)) {
      worldBase.provincePopulationByProvince[provinceId] = nextPopulation;
    }
  }
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
      professions: [],
      ideologies: [],
      religions: [],
      technologies: [],
      buildings: [],
      goods: [],
      companies: [],
      industries: [],
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
  const domains = getPopulationDomainKeys();
  const provincePopulationByProvince: Record<string, ProvincePopulation> = {};
  for (const province of adm1ProvinceIndex) {
    provincePopulationByProvince[province.id] = buildDefaultProvincePopulation(province.id, domains);
  }
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
    provinceNameById: {},
    colonyProgressByProvince: {},
    provinceColonizationByProvince: {},
    provincePopulationByProvince,
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
    worldStateVersion: unknown;
    gameSettings: unknown;
    worldBase: unknown;
    ordersByTurn: unknown;
    resolveReadyByTurn: unknown;
  }>;

  if (typeof parsed.turnId === "number" && Number.isFinite(parsed.turnId) && parsed.turnId >= 1) {
    turnId = Math.floor(parsed.turnId);
  }
  if (typeof parsed.worldStateVersion === "number" && Number.isFinite(parsed.worldStateVersion) && parsed.worldStateVersion >= 1) {
    worldStateVersion = Math.floor(parsed.worldStateVersion);
  }

  if (parsed.gameSettings && typeof parsed.gameSettings === "object") {
    const next = parsed.gameSettings as Partial<GameSettings>;
    const defaults = defaultGameSettings();
    const civilopediaEntries = normalizeCivilopediaEntries((next as Partial<{ civilopedia?: { entries?: unknown } }>).civilopedia?.entries);
    gameSettings = {
        content: {
          races: normalizeContentRaces((next as Partial<{ content?: { races?: unknown } }>).content?.races),
          professions: normalizeContentCultures((next as Partial<{ content?: { professions?: unknown } }>).content?.professions),
          ideologies: normalizeContentCultures((next as Partial<{ content?: { ideologies?: unknown } }>).content?.ideologies),
          religions: normalizeContentCultures((next as Partial<{ content?: { religions?: unknown } }>).content?.religions),
          technologies: normalizeContentCultures((next as Partial<{ content?: { technologies?: unknown } }>).content?.technologies),
          buildings: normalizeContentCultures((next as Partial<{ content?: { buildings?: unknown } }>).content?.buildings),
          goods: normalizeContentCultures((next as Partial<{ content?: { goods?: unknown } }>).content?.goods),
          companies: normalizeContentCultures((next as Partial<{ content?: { companies?: unknown } }>).content?.companies),
          industries: normalizeContentCultures((next as Partial<{ content?: { industries?: unknown } }>).content?.industries),
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
        provincePopulationByProvince: normalizeProvincePopulationMap(
          (candidate as Partial<WorldBase> & { provincePopulationByProvince?: unknown }).provincePopulationByProvince,
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

  rebuildTurnOrderIndexes();
  rebuildEconomyTickCountryIndexFromWorldBase();

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
let persistWorldDeltaQueue: Promise<void> = Promise.resolve();
let persistStateDebounceTimer: NodeJS.Timeout | null = null;
let persistStateDirty = false;

function savePersistentState(): void {
  persistStateDirty = true;
  if (persistStateDebounceTimer) {
    return;
  }
  persistStateDebounceTimer = setTimeout(() => {
    persistStateDebounceTimer = null;
    if (!persistStateDirty) {
      return;
    }
    persistStateDirty = false;
    persistStateQueue = persistStateQueue
      .then(async () => {
        await persistStateToDb();
      })
      .catch((error) => {
        console.error("[state] Failed to save game state to DB:", error);
      });
  }, PERSIST_STATE_DEBOUNCE_MS);
}

function flushPersistentStateNow(): Promise<void> {
  if (persistStateDebounceTimer) {
    clearTimeout(persistStateDebounceTimer);
    persistStateDebounceTimer = null;
  }
  if (!persistStateDirty) {
    return persistStateQueue;
  }
  persistStateDirty = false;
  persistStateQueue = persistStateQueue
    .then(async () => {
      await persistStateToDb();
    })
    .catch((error) => {
      console.error("[state] Failed to save game state to DB:", error);
    });
  return persistStateQueue;
}

async function ensureWorldDeltaLogTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS WorldDeltaLog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      worldStateVersion INTEGER NOT NULL UNIQUE,
      turnId INTEGER NOT NULL,
      payloadJson TEXT NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_world_delta_log_version ON WorldDeltaLog(worldStateVersion)`,
  );
}

async function persistWorldDeltaToDb(delta: WorldDelta): Promise<void> {
  await prisma.$executeRaw`
    INSERT OR IGNORE INTO WorldDeltaLog (worldStateVersion, turnId, payloadJson)
    VALUES (${delta.worldStateVersion}, ${delta.turnId}, ${JSON.stringify(delta)})
  `;
}

async function prunePersistedWorldDeltaLog(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    DELETE FROM WorldDeltaLog
    WHERE id NOT IN (
      SELECT id FROM WorldDeltaLog
      ORDER BY worldStateVersion DESC
      LIMIT ${MAX_PERSISTED_WORLD_DELTA_LOG}
    )
  `);
}

function saveWorldDeltaPersistent(delta: WorldDelta): void {
  persistWorldDeltaQueue = persistWorldDeltaQueue
    .then(async () => {
      await persistWorldDeltaToDb(delta);
    })
    .catch((error) => {
      console.error("[state] Failed to save world delta log:", error);
    });
}

function schedulePersistedWorldDeltaLogPrune(): void {
  persistWorldDeltaQueue = persistWorldDeltaQueue
    .then(async () => {
      await prunePersistedWorldDeltaLog();
    })
    .catch((error) => {
      console.error("[state] Failed to prune world delta log:", error);
    });
}

async function syncPersistedWorldDeltaLogWithCurrentState(): Promise<void> {
  await prisma.$executeRaw`DELETE FROM WorldDeltaLog WHERE worldStateVersion > ${worldStateVersion}`;
}

function isWorldDeltaPayload(value: unknown): value is WorldDelta {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<WorldDelta>;
  return row.type === "WORLD_DELTA" && typeof row.worldStateVersion === "number" && typeof row.turnId === "number";
}

async function loadPersistedWorldDeltaHistory(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ worldStateVersion: number; payloadJson: string }>>`
    SELECT worldStateVersion, payloadJson
    FROM WorldDeltaLog
    WHERE worldStateVersion <= ${worldStateVersion}
    ORDER BY worldStateVersion DESC
    LIMIT ${MAX_WORLD_DELTA_HISTORY}
  `;
  const parsed: WorldDelta[] = [];
  for (const row of [...rows].reverse()) {
    try {
      const payload = JSON.parse(row.payloadJson) as unknown;
      if (!isWorldDeltaPayload(payload)) {
        continue;
      }
      parsed.push(payload);
    } catch {
      // ignore malformed payload rows
    }
  }
  worldDeltaHistory.splice(0, worldDeltaHistory.length, ...parsed);
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
    economyTickCountryIds.add(countryId);
    savePersistentState();
    return;
  }
  economyTickCountryIds.add(countryId);
}

function rebuildEconomyTickCountryIndexFromWorldBase(): void {
  economyTickCountryIds.clear();
  for (const countryId of Object.keys(worldBase.resourcesByCountry)) {
    economyTickCountryIds.add(countryId);
  }
}

function addCountryToEconomyTick(countryId: string): void {
  economyTickCountryIds.add(countryId);
}

function removeCountryFromEconomyTick(countryId: string): void {
  economyTickCountryIds.delete(countryId);
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

function rebuildActiveColonizationIndexFromWorldBase(): void {
  activeColonizeProvincesByCountry.clear();
  for (const [provinceId, progressByCountry] of Object.entries(worldBase.colonyProgressByProvince)) {
    if (worldBase.provinceOwner[provinceId] || getProvinceColonizationConfig(provinceId).disabled) {
      continue;
    }
    for (const [countryId, value] of Object.entries(progressByCountry)) {
      if (typeof value !== "number") continue;
      const byCountry = activeColonizeProvincesByCountry.get(countryId) ?? new Set<string>();
      byCountry.add(provinceId);
      activeColonizeProvincesByCountry.set(countryId, byCountry);
    }
  }
}

function addActiveColonizationTarget(countryId: string, provinceId: string): void {
  const byCountry = activeColonizeProvincesByCountry.get(countryId) ?? new Set<string>();
  byCountry.add(provinceId);
  activeColonizeProvincesByCountry.set(countryId, byCountry);
}

function removeActiveColonizationTarget(countryId: string, provinceId: string): void {
  const byCountry = activeColonizeProvincesByCountry.get(countryId);
  if (!byCountry) return;
  byCountry.delete(provinceId);
  if (byCountry.size === 0) {
    activeColonizeProvincesByCountry.delete(countryId);
  }
}

function removeProvinceFromActiveColonizationIndex(provinceId: string): void {
  for (const [countryId, provinces] of activeColonizeProvincesByCountry.entries()) {
    provinces.delete(provinceId);
    if (provinces.size === 0) {
      activeColonizeProvincesByCountry.delete(countryId);
    }
  }
}

function removeCountryFromActiveColonizationIndex(countryId: string): void {
  activeColonizeProvincesByCountry.delete(countryId);
}

function addQueuedProvinceIndexEntry(
  indexByTurn: Map<number, Map<string, Set<string>>>,
  turn: number,
  countryId: string,
  provinceId: string,
): void {
  const byCountry = indexByTurn.get(turn) ?? new Map<string, Set<string>>();
  const provinces = byCountry.get(countryId) ?? new Set<string>();
  provinces.add(provinceId);
  byCountry.set(countryId, provinces);
  indexByTurn.set(turn, byCountry);
}

function removeQueuedProvinceIndexEntry(
  indexByTurn: Map<number, Map<string, Set<string>>>,
  turn: number,
  countryId: string,
  provinceId: string,
): void {
  const byCountry = indexByTurn.get(turn);
  if (!byCountry) return;
  const provinces = byCountry.get(countryId);
  if (!provinces) return;
  provinces.delete(provinceId);
  if (provinces.size === 0) {
    byCountry.delete(countryId);
  }
  if (byCountry.size === 0) {
    indexByTurn.delete(turn);
  }
}

function addOrderToTurnIndexes(order: Order): void {
  if (order.type === "COLONIZE") {
    addQueuedProvinceIndexEntry(queuedColonizeProvincesByCountryByTurn, order.turnId, order.countryId, order.provinceId);
    return;
  }
  if (order.type === "BUILD") {
    addQueuedProvinceIndexEntry(queuedBuildProvincesByCountryByTurn, order.turnId, order.countryId, order.provinceId);
  }
}

function removeOrderFromTurnIndexes(order: Order): void {
  if (order.type === "COLONIZE") {
    removeQueuedProvinceIndexEntry(queuedColonizeProvincesByCountryByTurn, order.turnId, order.countryId, order.provinceId);
    return;
  }
  if (order.type === "BUILD") {
    removeQueuedProvinceIndexEntry(queuedBuildProvincesByCountryByTurn, order.turnId, order.countryId, order.provinceId);
  }
}

function rebuildTurnOrderIndexes(): void {
  queuedColonizeProvincesByCountryByTurn.clear();
  queuedBuildProvincesByCountryByTurn.clear();
  for (const players of ordersByTurn.values()) {
    for (const playerOrders of players.values()) {
      for (const order of playerOrders) {
        addOrderToTurnIndexes(order);
      }
    }
  }
}

function dropTurnOrderIndexes(turn: number): void {
  queuedColonizeProvincesByCountryByTurn.delete(turn);
  queuedBuildProvincesByCountryByTurn.delete(turn);
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
  removeProvinceFromActiveColonizationIndex(provinceId);
  const turnOrders = ordersByTurn.get(turnId);
  if (!turnOrders) {
    return;
  }
  for (const [playerId, orders] of turnOrders.entries()) {
    const removed: Order[] = [];
    const nextOrders = orders.filter((order) => {
      const shouldRemove = order.type === "COLONIZE" && order.provinceId === provinceId;
      if (shouldRemove) removed.push(order);
      return !shouldRemove;
    });
    if (nextOrders.length !== orders.length) {
      for (const order of removed) {
        removeOrderFromTurnIndexes(order);
      }
      if (nextOrders.length > 0) {
        turnOrders.set(playerId, nextOrders);
      } else {
        turnOrders.delete(playerId);
      }
    }
  }
  if (turnOrders.size === 0) {
    ordersByTurn.delete(turnId);
    dropTurnOrderIndexes(turnId);
  }
}

function createToken(player: { id: string; countryId: string; isAdmin: boolean }, rememberMe: boolean): string {
  const expiresIn = rememberMe ? "30d" : "8h";
  return jwt.sign(player, env.jwtSecret, { expiresIn });
}

function broadcast(wss: WebSocketServer, message: WsOutMessage): void {
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    const meta = client as WebSocket & { __arcIsAdmin?: boolean; __arcCountryId?: string };
    // WS broadcast path is gameplay-only: send only to authenticated sockets.
    if (!meta.__arcCountryId) return;
    if (message.type === "NEWS_EVENT" && message.event.visibility === "private") {
      const targetCountryId = message.event.countryId ?? null;
      const isTargetCountry = targetCountryId != null && meta.__arcCountryId === targetCountryId;
      const isAdmin = Boolean(meta.__arcIsAdmin);
      if (!isTargetCountry && !isAdmin) {
        return;
      }
    }
    client.send(payload);
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
  const pending = await getCachedCountryQuery({
    key: "country:pending-registration",
    loader: () =>
      prisma.country.findMany({
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
      }),
  });
  for (const country of pending) {
    const notification = makeRegistrationApprovalUiNotification(country);
    enqueueUiNotification(notification, "admins");
    const queued = uiNotificationQueue.find((item) => item.notification.id === notification.id);
    if (queued?.viewedByCountryIds.has(adminCountryId)) continue;
    sendUiNotificationToSocket(socket, notification);
  }
}

type WorldBaseSectionSnapshot = {
  turnId: number;
  mask: number;
  resourcesByCountry?: WorldBase["resourcesByCountry"];
  provinceOwner?: WorldBase["provinceOwner"];
  provinceNameById?: WorldBase["provinceNameById"];
  colonyProgressByProvince?: WorldBase["colonyProgressByProvince"];
  provinceColonizationByProvince?: WorldBase["provinceColonizationByProvince"];
  provincePopulationByProvince?: WorldBase["provincePopulationByProvince"];
};

function cloneWorldBaseSectionSnapshot(mask: number): WorldBaseSectionSnapshot {
  const snapshot: WorldBaseSectionSnapshot = {
    turnId,
    mask,
  };

  if ((mask & WORLD_DELTA_MASK.resourcesByCountry) !== 0) {
    snapshot.resourcesByCountry = structuredClone(worldBase.resourcesByCountry);
  }
  if ((mask & WORLD_DELTA_MASK.provinceOwner) !== 0) {
    snapshot.provinceOwner = { ...worldBase.provinceOwner };
  }
  if ((mask & WORLD_DELTA_MASK.provinceNameById) !== 0) {
    snapshot.provinceNameById = { ...worldBase.provinceNameById };
  }
  if ((mask & WORLD_DELTA_MASK.colonyProgressByProvince) !== 0) {
    snapshot.colonyProgressByProvince = structuredClone(worldBase.colonyProgressByProvince);
  }
  if ((mask & WORLD_DELTA_MASK.provinceColonizationByProvince) !== 0) {
    snapshot.provinceColonizationByProvince = structuredClone(worldBase.provinceColonizationByProvince);
  }
  if ((mask & WORLD_DELTA_MASK.provincePopulationByProvince) !== 0) {
    snapshot.provincePopulationByProvince = structuredClone(worldBase.provincePopulationByProvince);
  }

  return snapshot;
}

function resetWsDeltaSizeMetrics(): void {
  wsDeltaSizeMetrics.totalMessages = 0;
  wsDeltaSizeMetrics.totalCompactBytes = 0;
  wsDeltaSizeMetrics.totalBaselineBytes = 0;
  wsDeltaSizeMetrics.maxCompactBytes = 0;
  wsDeltaSizeMetrics.maxBaselineBytes = 0;
  wsDeltaSizeMetrics.lastCompactBytes = 0;
  wsDeltaSizeMetrics.lastBaselineBytes = 0;
  wsDeltaSizeMetrics.lastTurnId = null;
  wsDeltaSizeMetrics.lastStateVersion = null;
  wsDeltaSizeMetrics.updatedAtIso = null;
}

function pushWorldDeltaToHistory(delta: WorldDelta): void {
  worldDeltaHistory.push(delta);
  if (worldDeltaHistory.length > MAX_WORLD_DELTA_HISTORY) {
    worldDeltaHistory.splice(0, worldDeltaHistory.length - MAX_WORLD_DELTA_HISTORY);
  }
}

function getReplayDeltasFromVersion(fromWorldStateVersion: number): { ok: true; deltas: WorldDelta[] } | { ok: false } {
  if (fromWorldStateVersion >= worldStateVersion) {
    return { ok: true, deltas: [] };
  }
  const deltas = worldDeltaHistory
    .filter((delta) => delta.worldStateVersion > fromWorldStateVersion)
    .sort((a, b) => a.worldStateVersion - b.worldStateVersion);
  if (deltas.length === 0) {
    return { ok: false };
  }
  if (deltas[0].worldStateVersion !== fromWorldStateVersion + 1) {
    return { ok: false };
  }
  for (let i = 1; i < deltas.length; i += 1) {
    if (deltas[i].worldStateVersion !== deltas[i - 1].worldStateVersion + 1) {
      return { ok: false };
    }
  }
  if (deltas[deltas.length - 1].worldStateVersion !== worldStateVersion) {
    return { ok: false };
  }
  return { ok: true, deltas };
}

function captureWsDeltaSizeMetrics(params: { compactPayload: WorldDelta; baselinePayload: unknown }): void {
  const compactBytes = Buffer.byteLength(JSON.stringify(params.compactPayload), "utf8");
  const baselineBytes = Buffer.byteLength(JSON.stringify(params.baselinePayload), "utf8");
  wsDeltaSizeMetrics.totalMessages += 1;
  wsDeltaSizeMetrics.totalCompactBytes += compactBytes;
  wsDeltaSizeMetrics.totalBaselineBytes += baselineBytes;
  wsDeltaSizeMetrics.maxCompactBytes = Math.max(wsDeltaSizeMetrics.maxCompactBytes, compactBytes);
  wsDeltaSizeMetrics.maxBaselineBytes = Math.max(wsDeltaSizeMetrics.maxBaselineBytes, baselineBytes);
  wsDeltaSizeMetrics.lastCompactBytes = compactBytes;
  wsDeltaSizeMetrics.lastBaselineBytes = baselineBytes;
  wsDeltaSizeMetrics.lastTurnId = params.compactPayload.turnId;
  wsDeltaSizeMetrics.lastStateVersion = params.compactPayload.worldStateVersion;
  wsDeltaSizeMetrics.updatedAtIso = new Date().toISOString();
}

function isEqualCountryProgressMap(
  prevValue: Record<string, number> | undefined,
  nextValue: Record<string, number>,
): boolean {
  if (!prevValue) {
    return false;
  }
  const prevKeys = Object.keys(prevValue);
  const nextKeys = Object.keys(nextValue);
  if (prevKeys.length !== nextKeys.length) {
    return false;
  }
  for (const key of nextKeys) {
    if ((prevValue[key] ?? Number.NaN) !== nextValue[key]) {
      return false;
    }
  }
  return true;
}

function buildCompactWorldDelta(prev: WorldBase, next: WorldBase): Omit<WorldDelta, "type" | "turnId" | "worldStateVersion" | "rejectedOrders"> {
  const resourcesByCountry: Record<string, ResourceTotals | null> = {};
  const provinceOwner: Record<string, string | null> = {};
  const provinceNameById: Record<string, string | null> = {};
  const colonyProgressByProvince: Record<string, Record<string, number> | null> = {};
  const provinceColonizationByProvince: Record<string, { cost: number; disabled: boolean; manualCost?: boolean } | null> = {};
  const provincePopulationByProvince: Record<string, ProvincePopulation | null> = {};

  for (const key of new Set([...Object.keys(prev.resourcesByCountry), ...Object.keys(next.resourcesByCountry)])) {
    const prevValue = prev.resourcesByCountry[key];
    const nextValue = next.resourcesByCountry[key];
    if (!nextValue) {
      resourcesByCountry[key] = null;
      continue;
    }
    if (
      !prevValue ||
      prevValue.culture !== nextValue.culture ||
      prevValue.science !== nextValue.science ||
      prevValue.religion !== nextValue.religion ||
      prevValue.colonization !== nextValue.colonization ||
      prevValue.ducats !== nextValue.ducats ||
      prevValue.gold !== nextValue.gold
    ) {
      resourcesByCountry[key] = nextValue;
    }
  }

  for (const key of new Set([...Object.keys(prev.provinceOwner), ...Object.keys(next.provinceOwner)])) {
    const prevValue = prev.provinceOwner[key];
    const nextValue = next.provinceOwner[key];
    if (typeof nextValue !== "string") {
      provinceOwner[key] = null;
      continue;
    }
    if (prevValue !== nextValue) {
      provinceOwner[key] = nextValue;
    }
  }

  for (const key of new Set([...Object.keys(prev.provinceNameById), ...Object.keys(next.provinceNameById)])) {
    const prevValue = prev.provinceNameById[key];
    const nextValue = next.provinceNameById[key];
    if (typeof nextValue !== "string") {
      provinceNameById[key] = null;
      continue;
    }
    if (prevValue !== nextValue) {
      provinceNameById[key] = nextValue;
    }
  }

  for (const key of new Set([...Object.keys(prev.colonyProgressByProvince), ...Object.keys(next.colonyProgressByProvince)])) {
    const prevValue = prev.colonyProgressByProvince[key];
    const nextValue = next.colonyProgressByProvince[key];
    if (!nextValue) {
      colonyProgressByProvince[key] = null;
      continue;
    }
    if (!isEqualCountryProgressMap(prevValue, nextValue)) {
      colonyProgressByProvince[key] = nextValue;
    }
  }

  for (const key of new Set([...Object.keys(prev.provinceColonizationByProvince), ...Object.keys(next.provinceColonizationByProvince)])) {
    const prevValue = prev.provinceColonizationByProvince[key];
    const nextValue = next.provinceColonizationByProvince[key];
    if (!nextValue) {
      provinceColonizationByProvince[key] = null;
      continue;
    }
    if (
      !prevValue ||
      prevValue.cost !== nextValue.cost ||
      prevValue.disabled !== nextValue.disabled ||
      Boolean(prevValue.manualCost) !== Boolean(nextValue.manualCost)
    ) {
      provinceColonizationByProvince[key] = nextValue;
    }
  }

  for (const key of new Set([...Object.keys(prev.provincePopulationByProvince), ...Object.keys(next.provincePopulationByProvince)])) {
    const prevValue = prev.provincePopulationByProvince[key];
    const nextValue = next.provincePopulationByProvince[key];
    if (!nextValue) {
      provincePopulationByProvince[key] = null;
      continue;
    }
    if (!isEqualProvincePopulation(prevValue, nextValue)) {
      provincePopulationByProvince[key] = nextValue;
    }
  }

  let mask = 0;
  const compact: Omit<WorldDelta, "type" | "turnId" | "worldStateVersion" | "rejectedOrders"> = { mask: 0 };
  if (Object.keys(resourcesByCountry).length > 0) {
    mask |= WORLD_DELTA_MASK.resourcesByCountry;
    compact.c = resourcesByCountry;
  }
  if (Object.keys(provinceOwner).length > 0) {
    mask |= WORLD_DELTA_MASK.provinceOwner;
    compact.o = provinceOwner;
  }
  if (Object.keys(provinceNameById).length > 0) {
    mask |= WORLD_DELTA_MASK.provinceNameById;
    compact.n = provinceNameById;
  }
  if (Object.keys(colonyProgressByProvince).length > 0) {
    mask |= WORLD_DELTA_MASK.colonyProgressByProvince;
    compact.p = colonyProgressByProvince;
  }
  if (Object.keys(provinceColonizationByProvince).length > 0) {
    mask |= WORLD_DELTA_MASK.provinceColonizationByProvince;
    compact.z = provinceColonizationByProvince;
  }
  if (Object.keys(provincePopulationByProvince).length > 0) {
    mask |= WORLD_DELTA_MASK.provincePopulationByProvince;
    compact.u = provincePopulationByProvince;
  }
  compact.mask = mask;
  return compact;
}

function toWorldBaseForDeltaDiff(previous: WorldBaseSectionSnapshot, next: WorldBase): WorldBase {
  return {
    turnId: previous.turnId,
    resourcesByCountry:
      (previous.mask & WORLD_DELTA_MASK.resourcesByCountry) !== 0 && previous.resourcesByCountry
        ? previous.resourcesByCountry
        : next.resourcesByCountry,
    provinceOwner:
      (previous.mask & WORLD_DELTA_MASK.provinceOwner) !== 0 && previous.provinceOwner
        ? previous.provinceOwner
        : next.provinceOwner,
    provinceNameById:
      (previous.mask & WORLD_DELTA_MASK.provinceNameById) !== 0 && previous.provinceNameById
        ? previous.provinceNameById
        : next.provinceNameById,
    colonyProgressByProvince:
      (previous.mask & WORLD_DELTA_MASK.colonyProgressByProvince) !== 0 && previous.colonyProgressByProvince
        ? previous.colonyProgressByProvince
        : next.colonyProgressByProvince,
    provinceColonizationByProvince:
      (previous.mask & WORLD_DELTA_MASK.provinceColonizationByProvince) !== 0 && previous.provinceColonizationByProvince
        ? previous.provinceColonizationByProvince
        : next.provinceColonizationByProvince,
    provincePopulationByProvince:
      (previous.mask & WORLD_DELTA_MASK.provincePopulationByProvince) !== 0 && previous.provincePopulationByProvince
        ? previous.provincePopulationByProvince
        : next.provincePopulationByProvince,
  };
}

function broadcastWorldDeltaFromSectionSnapshot(
  wss: WebSocketServer,
  previous: WorldBaseSectionSnapshot,
  rejectedOrders: WorldDelta["rejectedOrders"] = [],
): void {
  const next = {
    ...worldBase,
    turnId,
  };
  const prevForDiff = toWorldBaseForDeltaDiff(previous, next);
  const compact = buildCompactWorldDelta(prevForDiff, next);
  if (compact.mask === 0 && rejectedOrders.length === 0) {
    return;
  }
  worldStateVersion += 1;
  const payload: WorldDelta = {
    type: "WORLD_DELTA",
    turnId,
    worldStateVersion,
    mask: compact.mask,
    c: compact.c,
    o: compact.o,
    n: compact.n,
    p: compact.p,
    z: compact.z,
    u: compact.u,
    rejectedOrders,
  };
  const baselinePayload = {
    type: "WORLD_DELTA",
    turnId,
    worldStateVersion,
    changes: {
      resourcesByCountry: compact.c,
      provinceOwner: compact.o,
      provinceNameById: compact.n,
      colonyProgressByProvince: compact.p,
      provinceColonizationByProvince: compact.z,
      provincePopulationByProvince: compact.u,
    },
    rejectedOrders,
  };
  captureWsDeltaSizeMetrics({ compactPayload: payload, baselinePayload });
  pushWorldDeltaToHistory(payload);
  saveWorldDeltaPersistent(payload);
  broadcast(wss, payload);
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
  const clearedByTurn = await prisma.country.updateMany({
    where: {
      isLocked: false,
      blockedUntilTurn: { lt: currentTurn },
    },
    data: { blockedUntilTurn: null },
  });

  const clearedByTime = await prisma.country.updateMany({
    where: {
      isLocked: false,
      blockedUntilAt: { lt: now },
    },
    data: { blockedUntilAt: null },
  });
  if (clearedByTurn.count > 0 || clearedByTime.count > 0) {
    invalidateCountryQueryCache();
  }
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

function resolveTurn(): { rejectedOrders: WorldDelta["rejectedOrders"]; news: EventLogEntry[]; previousWorldBase: WorldBaseSectionSnapshot } {
  const previousWorldBase = cloneWorldBaseSectionSnapshot(
    WORLD_DELTA_MASK.resourcesByCountry |
      WORLD_DELTA_MASK.provinceOwner |
      WORLD_DELTA_MASK.colonyProgressByProvince |
      WORLD_DELTA_MASK.provincePopulationByProvince,
  );
  const currentOrders = ordersByTurn.get(turnId) ?? new Map<string, Order[]>();
  const rejectedOrders: WorldDelta["rejectedOrders"] = [];
  const claimed = new Set<string>();
  const news: EventLogEntry[] = [];

  const colonizeTargetsByCountry = new Map<string, Set<string>>();
  const touchedProvinceIds = new Set<string>();
  for (const [countryId, provinces] of activeColonizeProvincesByCountry.entries()) {
    colonizeTargetsByCountry.set(countryId, new Set(provinces));
    for (const provinceId of provinces) {
      touchedProvinceIds.add(provinceId);
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
        touchedProvinceIds.add(order.provinceId);
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
      addActiveColonizationTarget(countryId, provinceId);
      touchedProvinceIds.add(provinceId);
    }
    if (countryResource) {
      countryResource.colonization = Math.max(0, countryResource.colonization - spentColonizationPoints);
      countryResource.ducats = Math.max(0, countryResource.ducats - spentSupportDucats);
    }

  }
  for (const provinceId of touchedProvinceIds) {
    const progressByCountry = worldBase.colonyProgressByProvince[provinceId];
    if (!progressByCountry) {
      removeProvinceFromActiveColonizationIndex(provinceId);
      continue;
    }
    if (worldBase.provinceOwner[provinceId]) {
      delete worldBase.colonyProgressByProvince[provinceId];
      removeProvinceFromActiveColonizationIndex(provinceId);
      continue;
    }
    if (getProvinceColonizationConfig(provinceId).disabled) {
      delete worldBase.colonyProgressByProvince[provinceId];
      removeProvinceFromActiveColonizationIndex(provinceId);
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
    removeProvinceFromActiveColonizationIndex(provinceId);
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

  for (const countryId of economyTickCountryIds) {
    const resource = worldBase.resourcesByCountry[countryId];
    if (!resource) {
      continue;
    }
    resource.colonization += gameSettings.colonization.pointsPerTurn;
    resource.ducats += gameSettings.economy.baseDucatsPerTurn;
    resource.gold += gameSettings.economy.baseGoldPerTurn;
  }

  resolvePopulationTurn();

  turnId += 1;
  worldBase = {
    ...worldBase,
    turnId,
  };
  resetTurnTimerAnchor();

  ordersByTurn.delete(turnId - 1);
  dropTurnOrderIndexes(turnId - 1);
  resolveReadyByTurn.delete(turnId - 1);
  void flushPersistentStateNow();

  return {
    previousWorldBase,
    rejectedOrders,
    news,
  };
}

function resolveAndBroadcastCurrentTurn(wsServer: WebSocketServer): boolean {
  if (isResolvingTurnNow) {
    return false;
  }
  isResolvingTurnNow = true;
  try {
    const { previousWorldBase, rejectedOrders, news } = resolveTurn();
    broadcastWorldDeltaFromSectionSnapshot(wsServer, previousWorldBase, rejectedOrders);
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

app.get("/world/snapshot", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  ensureCountryInWorldBase(auth.countryId);
  return res.json({
    worldBase: {
      ...worldBase,
      turnId,
    },
    turnId,
    worldStateVersion,
  });
});

app.get("/admin/ws-delta-metrics", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const avgCompactBytes =
    wsDeltaSizeMetrics.totalMessages > 0
      ? wsDeltaSizeMetrics.totalCompactBytes / wsDeltaSizeMetrics.totalMessages
      : 0;
  const avgBaselineBytes =
    wsDeltaSizeMetrics.totalMessages > 0
      ? wsDeltaSizeMetrics.totalBaselineBytes / wsDeltaSizeMetrics.totalMessages
      : 0;
  const savedBytes = Math.max(0, wsDeltaSizeMetrics.totalBaselineBytes - wsDeltaSizeMetrics.totalCompactBytes);
  const savedPercent =
    wsDeltaSizeMetrics.totalBaselineBytes > 0
      ? Number(((savedBytes / wsDeltaSizeMetrics.totalBaselineBytes) * 100).toFixed(2))
      : 0;
  return res.json({
    ...wsDeltaSizeMetrics,
    avgCompactBytes: Number(avgCompactBytes.toFixed(2)),
    avgBaselineBytes: Number(avgBaselineBytes.toFixed(2)),
    savedBytes,
    savedPercent,
  });
});

app.get("/admin/world-delta-log/status", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const rows = await prisma.$queryRaw<Array<{ depth: number; oldest: number | null; newest: number | null }>>`
    SELECT COUNT(*) as depth, MIN(worldStateVersion) as oldest, MAX(worldStateVersion) as newest
    FROM WorldDeltaLog
  `;
  const db = rows[0] ?? { depth: 0, oldest: null, newest: null };
  return res.json({
    dbDepth: Number(db.depth ?? 0),
    dbOldestWorldStateVersion: db.oldest == null ? null : Number(db.oldest),
    dbNewestWorldStateVersion: db.newest == null ? null : Number(db.newest),
    memoryDepth: worldDeltaHistory.length,
    memoryOldestWorldStateVersion: worldDeltaHistory[0]?.worldStateVersion ?? null,
    memoryNewestWorldStateVersion: worldDeltaHistory[worldDeltaHistory.length - 1]?.worldStateVersion ?? null,
    currentWorldStateVersion: worldStateVersion,
    maxPersisted: MAX_PERSISTED_WORLD_DELTA_LOG,
    maxReplayInMemory: MAX_WORLD_DELTA_HISTORY,
  });
});

app.post("/admin/ws-delta-metrics/reset", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  resetWsDeltaSizeMetrics();
  return res.json({ ok: true });
});

app.get("/countries", async (_req, res) => {
  await cleanupExpiredPunishments(turnId, new Date());
  const countries = await getCachedCountryQuery({
    key: "country:list",
    loader: () => prisma.country.findMany({ select: countrySelect, orderBy: { createdAt: "asc" } }),
  });
  res.json(countries.map(countryFromDb));
});

app.get("/turn/status", async (_req, res) => {
  const now = new Date();
  await cleanupExpiredPunishments(turnId, now);
  const countries = await getCachedCountryQuery({
    key: "country:turn-status",
    loader: () =>
      prisma.country.findMany({
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
      }),
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
  if (!validateImageDimensions(file, 64)) {
    removeUploadedFile(file);
    return res.status(400).json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", max: "64x64" });
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
const contentEntryKindSchema = z.enum([
  "cultures",
  "religions",
  "professions",
  "ideologies",
  "races",
  "buildings",
  "goods",
  "companies",
  "industries",
]);
type ContentEntryKind = z.infer<typeof contentEntryKindSchema>;

function getContentEntriesByKind(kind: ContentEntryKind) {
  return gameSettings.content[kind];
}

function contentNameExists(kind: ContentEntryKind, name: string, excludeId?: string): boolean {
  return getContentEntriesByKind(kind).some(
    (entry) => entry.id !== excludeId && entry.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
}

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
    return res.status(409).json({ error: "CONTENT_NAME_EXISTS" });
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
    return res.status(409).json({ error: "CONTENT_NAME_EXISTS" });
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
  const previousUrl = items[index].logoUrl;
  items[index] = {
    ...items[index],
    logoUrl: `/uploads/${kind}/${file.filename}`,
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
  const index = gameSettings.content.races.findIndex((entry) => entry.id === entryId);
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
  const key = slotParsed.data === "male" ? "malePortraitUrl" : "femalePortraitUrl";
  const previousUrl = gameSettings.content.races[index][key] ?? null;
  gameSettings.content.races[index] = {
    ...gameSettings.content.races[index],
    [key]: `/uploads/races/${file.filename}`,
  };
  if (previousUrl) {
    removeUploadedByUrl(previousUrl);
  }
  savePersistentState();
  return res.json({ item: gameSettings.content.races[index], items: gameSettings.content.races });
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
  const index = gameSettings.content.races.findIndex((entry) => entry.id === entryId);
  if (index < 0) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  const key = slotParsed.data === "male" ? "malePortraitUrl" : "femalePortraitUrl";
  const previousUrl = gameSettings.content.races[index][key] ?? null;
  gameSettings.content.races[index] = {
    ...gameSettings.content.races[index],
    [key]: null,
  };
  if (previousUrl) {
    removeUploadedByUrl(previousUrl);
  }
  savePersistentState();
  return res.json({ item: gameSettings.content.races[index], items: gameSettings.content.races });
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
  const removedRace = removed as Partial<{ malePortraitUrl?: string | null; femalePortraitUrl?: string | null }>;
  if (removedRace.malePortraitUrl) {
    removeUploadedByUrl(removedRace.malePortraitUrl);
  }
  if (removedRace.femalePortraitUrl) {
    removeUploadedByUrl(removedRace.femalePortraitUrl);
  }
  savePersistentState();
  return res.json({ ok: true, items });
});

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
    malePortraitUrl: null as string | null,
    femalePortraitUrl: null as string | null,
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
  if (!validateImageDimensions(file, 1024)) {
    removeUploadedFile(file);
    return res.status(400).json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", max: "1024x1024" });
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
  if (removed?.malePortraitUrl) {
    removeUploadedByUrl(removed.malePortraitUrl);
  }
  if (removed?.femalePortraitUrl) {
    removeUploadedByUrl(removed.femalePortraitUrl);
  }
  savePersistentState();
  return res.json({ ok: true, cultures: gameSettings.content.cultures });
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
  const previousWorldBase = parsed.data.colonization
    ? cloneWorldBaseSectionSnapshot(WORLD_DELTA_MASK.provinceColonizationByProvince)
    : null;
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
    if (previousWorldBase) {
      broadcastWorldDeltaFromSectionSnapshot(wss, previousWorldBase);
    }
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

  const activeColonizeTargets = new Set<string>(activeColonizeProvincesByCountry.get(auth.countryId) ?? []);
  const queuedColonizeByCountry = queuedColonizeProvincesByCountryByTurn.get(turnId)?.get(auth.countryId);
  if (queuedColonizeByCountry) {
    for (const provinceId of queuedColonizeByCountry) {
      activeColonizeTargets.add(provinceId);
    }
  }

  if (activeColonizeTargets.size >= gameSettings.colonization.maxActiveColonizations) {
    return res.status(400).json({
      error: "COLONIZE_LIMIT",
      current: activeColonizeTargets.size,
      limit: gameSettings.colonization.maxActiveColonizations,
    });
  }

  const previousWorldBase = cloneWorldBaseSectionSnapshot(WORLD_DELTA_MASK.colonyProgressByProvince);
  worldBase.colonyProgressByProvince[provinceId] = {
    ...existing,
    [auth.countryId]: 0,
  };
  addActiveColonizationTarget(auth.countryId, provinceId);

  savePersistentState();
  broadcastWorldDeltaFromSectionSnapshot(wss, previousWorldBase);
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

  const previousWorldBase = cloneWorldBaseSectionSnapshot(WORLD_DELTA_MASK.colonyProgressByProvince);
  delete progress[auth.countryId];
  if (Object.keys(progress).length === 0) {
    delete worldBase.colonyProgressByProvince[provinceId];
    removeProvinceFromActiveColonizationIndex(provinceId);
  } else {
    worldBase.colonyProgressByProvince[provinceId] = progress;
    removeActiveColonizationTarget(auth.countryId, provinceId);
  }

  const turnOrders = ordersByTurn.get(turnId);
  if (turnOrders) {
    for (const [playerId, orders] of turnOrders.entries()) {
      const removed: Order[] = [];
      const filtered = orders.filter((order) => {
        const shouldRemove = order.type === "COLONIZE" && order.countryId === auth.countryId && order.provinceId === provinceId;
        if (shouldRemove) removed.push(order);
        return !shouldRemove;
      });
      if (filtered.length !== orders.length) {
        for (const order of removed) {
          removeOrderFromTurnIndexes(order);
        }
        if (filtered.length > 0) {
          turnOrders.set(playerId, filtered);
        } else {
          turnOrders.delete(playerId);
        }
      }
    }
    if (turnOrders.size === 0) {
      ordersByTurn.delete(turnId);
      dropTurnOrderIndexes(turnId);
    }
  }

  savePersistentState();
  broadcastWorldDeltaFromSectionSnapshot(wss, previousWorldBase);
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

  const previousWorldBase = cloneWorldBaseSectionSnapshot(
    WORLD_DELTA_MASK.resourcesByCountry | WORLD_DELTA_MASK.provinceNameById,
  );
  resources.ducats = Math.max(0, resources.ducats - provinceRenameDucatsCost);
  worldBase.provinceNameById[provinceId] = provinceName;

  savePersistentState();
  broadcastWorldDeltaFromSectionSnapshot(wss, previousWorldBase);
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

const populationScopeSchema = z.enum(["province", "country", "world"]);
const populationBreakdownSchema = z.record(z.string().min(1), z.coerce.number().min(0)).optional();

const adminPopulationGenerateSchema = z.object({
  scope: populationScopeSchema,
  provinceId: z.string().min(1).optional(),
  countryId: z.string().min(1).optional(),
  strategy: z.enum(["random", "custom"]),
  populationTotal: z.coerce.number().int().min(0).max(SETTINGS_MAX_NUMBER).optional(),
  culturePct: populationBreakdownSchema,
  ideologyPct: populationBreakdownSchema,
  religionPct: populationBreakdownSchema,
  racePct: populationBreakdownSchema,
  professionPct: populationBreakdownSchema,
});

const adminPopulationUpdateProvinceSchema = z.object({
  populationTotal: z.coerce.number().int().min(0).max(SETTINGS_MAX_NUMBER).optional(),
  culturePct: populationBreakdownSchema,
  ideologyPct: populationBreakdownSchema,
  religionPct: populationBreakdownSchema,
  racePct: populationBreakdownSchema,
  professionPct: populationBreakdownSchema,
});

const adminPopulationClearSchema = z.object({
  scope: populationScopeSchema,
  provinceId: z.string().min(1).optional(),
  countryId: z.string().min(1).optional(),
});

function resolvePopulationTargetProvinceIds(
  scope: z.infer<typeof populationScopeSchema>,
  params: { provinceId?: string; countryId?: string },
): string[] {
  if (scope === "world") {
    return adm1ProvinceIndex.map((province) => province.id);
  }
  if (scope === "province") {
    const provinceId = params.provinceId?.trim();
    if (!provinceId) {
      throw new Error("PROVINCE_ID_REQUIRED");
    }
    const exists = adm1ProvinceIndex.some((province) => province.id === provinceId);
    if (!exists) {
      throw new Error("PROVINCE_NOT_FOUND");
    }
    return [provinceId];
  }
  const countryId = params.countryId?.trim();
  if (!countryId) {
    throw new Error("COUNTRY_ID_REQUIRED");
  }
  const provinceIds = adm1ProvinceIndex
    .map((province) => province.id)
    .filter((provinceId) => worldBase.provinceOwner[provinceId] === countryId);
  if (provinceIds.length === 0) {
    throw new Error("COUNTRY_HAS_NO_PROVINCES");
  }
  return provinceIds;
}

app.get("/admin/provinces", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }

  const searchQuery = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const requestedLimit =
    typeof req.query.limit === "string" && Number.isFinite(Number(req.query.limit))
      ? Math.floor(Number(req.query.limit))
      : null;
  const requestedOffset =
    typeof req.query.offset === "string" && Number.isFinite(Number(req.query.offset))
      ? Math.floor(Number(req.query.offset))
      : 0;
  const limit = requestedLimit == null ? null : Math.max(1, Math.min(5000, requestedLimit));
  const offset = Math.max(0, requestedOffset);
  const source = searchQuery
    ? adm1ProvinceIndex.filter((province) => province.name.toLowerCase().includes(searchQuery) || province.id.toLowerCase().includes(searchQuery))
    : adm1ProvinceIndex;
  const total = source.length;
  const selected = limit == null ? source : source.slice(offset, offset + limit);

  const provinces = selected.map((province) => {
    const provinceId = province.id;
    const provinceName = province.name;
    const cfg = getProvinceColonizationConfig(provinceId);
    const population = worldBase.provincePopulationByProvince[provinceId] ?? null;
    return {
      id: provinceId,
      name: provinceName,
      areaKm2: province.areaKm2,
      ownerCountryId: worldBase.provinceOwner[provinceId] ?? null,
      colonizationCost: cfg.cost,
      colonizationDisabled: cfg.disabled,
      manualCost: cfg.manualCost,
      colonyProgressByCountry: worldBase.colonyProgressByProvince[provinceId] ?? {},
      population,
    };
  });

  return res.json({
    provinces,
    total,
    offset,
    limit,
  });
});

app.post("/admin/population/generate", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }

  const parsed = adminPopulationGenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  let targetProvinceIds: string[] = [];
  try {
    targetProvinceIds = resolvePopulationTargetProvinceIds(parsed.data.scope, {
      provinceId: parsed.data.provinceId,
      countryId: parsed.data.countryId,
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "INVALID_SCOPE_TARGET" });
  }

  const previousWorldBase = cloneWorldBaseSectionSnapshot(WORLD_DELTA_MASK.provincePopulationByProvince);
  const domains = getPopulationDomainKeys();
  let updatedCount = 0;
  for (const provinceId of targetProvinceIds) {
    const current = normalizeProvincePopulation(worldBase.provincePopulationByProvince[provinceId], provinceId, domains);
    const next =
      parsed.data.strategy === "random"
        ? buildRandomProvincePopulation(provinceId, domains, parsed.data.populationTotal)
        : {
            populationTotal:
              typeof parsed.data.populationTotal === "number"
                ? Math.max(0, Math.floor(parsed.data.populationTotal))
                : current.populationTotal,
            culturePct:
              parsed.data.culturePct != null
                ? normalizePercentageMap(parsed.data.culturePct, domains.culturePct, POPULATION_FALLBACK_KEY_BY_DIMENSION.culturePct)
                : current.culturePct,
            ideologyPct:
              parsed.data.ideologyPct != null
                ? normalizePercentageMap(parsed.data.ideologyPct, domains.ideologyPct, POPULATION_FALLBACK_KEY_BY_DIMENSION.ideologyPct)
                : current.ideologyPct,
            religionPct:
              parsed.data.religionPct != null
                ? normalizePercentageMap(parsed.data.religionPct, domains.religionPct, POPULATION_FALLBACK_KEY_BY_DIMENSION.religionPct)
                : current.religionPct,
            racePct:
              parsed.data.racePct != null
                ? normalizePercentageMap(parsed.data.racePct, domains.racePct, POPULATION_FALLBACK_KEY_BY_DIMENSION.racePct)
                : current.racePct,
            professionPct:
              parsed.data.professionPct != null
                ? normalizePercentageMap(parsed.data.professionPct, domains.professionPct, POPULATION_FALLBACK_KEY_BY_DIMENSION.professionPct)
                : current.professionPct,
          };
    if (!isEqualProvincePopulation(worldBase.provincePopulationByProvince[provinceId], next)) {
      worldBase.provincePopulationByProvince[provinceId] = next;
      updatedCount += 1;
    }
  }

  savePersistentState();
  if (updatedCount > 0) {
    broadcastWorldDeltaFromSectionSnapshot(wss, previousWorldBase);
  }
  return res.json({ ok: true, updatedCount, scope: parsed.data.scope, strategy: parsed.data.strategy });
});

app.post("/admin/population/clear", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }

  const parsed = adminPopulationClearSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  let targetProvinceIds: string[] = [];
  try {
    targetProvinceIds = resolvePopulationTargetProvinceIds(parsed.data.scope, {
      provinceId: parsed.data.provinceId,
      countryId: parsed.data.countryId,
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "INVALID_SCOPE_TARGET" });
  }

  const previousWorldBase = cloneWorldBaseSectionSnapshot(WORLD_DELTA_MASK.provincePopulationByProvince);
  const domains = getPopulationDomainKeys();
  let updatedCount = 0;
  for (const provinceId of targetProvinceIds) {
    const current = normalizeProvincePopulation(worldBase.provincePopulationByProvince[provinceId], provinceId, domains);
    const next: ProvincePopulation = {
      populationTotal: 0,
      culturePct: current.culturePct,
      ideologyPct: current.ideologyPct,
      religionPct: current.religionPct,
      racePct: current.racePct,
      professionPct: current.professionPct,
    };
    if (!isEqualProvincePopulation(worldBase.provincePopulationByProvince[provinceId], next)) {
      worldBase.provincePopulationByProvince[provinceId] = next;
      updatedCount += 1;
    }
  }

  savePersistentState();
  if (updatedCount > 0) {
    broadcastWorldDeltaFromSectionSnapshot(wss, previousWorldBase);
  }
  return res.json({ ok: true, updatedCount, scope: parsed.data.scope });
});

app.patch("/admin/population/provinces/:provinceId", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }

  const provinceId = String(req.params.provinceId);
  const provinceIndexEntry = adm1ProvinceIndex.find((f) => f.id === provinceId);
  if (!provinceIndexEntry) {
    return res.status(404).json({ error: "PROVINCE_NOT_FOUND" });
  }

  const parsed = adminPopulationUpdateProvinceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  const previousWorldBase = cloneWorldBaseSectionSnapshot(WORLD_DELTA_MASK.provincePopulationByProvince);
  const domains = getPopulationDomainKeys();
  const current = normalizeProvincePopulation(worldBase.provincePopulationByProvince[provinceId], provinceId, domains);
  const next: ProvincePopulation = {
    populationTotal:
      typeof parsed.data.populationTotal === "number" ? Math.max(0, Math.floor(parsed.data.populationTotal)) : current.populationTotal,
    culturePct:
      parsed.data.culturePct != null
        ? normalizePercentageMap(parsed.data.culturePct, domains.culturePct, POPULATION_FALLBACK_KEY_BY_DIMENSION.culturePct)
        : current.culturePct,
    ideologyPct:
      parsed.data.ideologyPct != null
        ? normalizePercentageMap(parsed.data.ideologyPct, domains.ideologyPct, POPULATION_FALLBACK_KEY_BY_DIMENSION.ideologyPct)
        : current.ideologyPct,
    religionPct:
      parsed.data.religionPct != null
        ? normalizePercentageMap(parsed.data.religionPct, domains.religionPct, POPULATION_FALLBACK_KEY_BY_DIMENSION.religionPct)
        : current.religionPct,
    racePct:
      parsed.data.racePct != null
        ? normalizePercentageMap(parsed.data.racePct, domains.racePct, POPULATION_FALLBACK_KEY_BY_DIMENSION.racePct)
        : current.racePct,
    professionPct:
      parsed.data.professionPct != null
        ? normalizePercentageMap(parsed.data.professionPct, domains.professionPct, POPULATION_FALLBACK_KEY_BY_DIMENSION.professionPct)
        : current.professionPct,
  };
  worldBase.provincePopulationByProvince[provinceId] = next;

  savePersistentState();
  broadcastWorldDeltaFromSectionSnapshot(wss, previousWorldBase);
  return res.json({
    province: {
      id: provinceId,
      name: provinceIndexEntry.name,
      areaKm2: provinceIndexEntry.areaKm2,
      population: worldBase.provincePopulationByProvince[provinceId],
    },
  });
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
  const previousWorldBase = cloneWorldBaseSectionSnapshot(
    WORLD_DELTA_MASK.resourcesByCountry |
      WORLD_DELTA_MASK.provinceOwner |
      WORLD_DELTA_MASK.colonyProgressByProvince |
      WORLD_DELTA_MASK.provinceColonizationByProvince,
  );
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
  broadcastWorldDeltaFromSectionSnapshot(wss, previousWorldBase);
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
      population: worldBase.provincePopulationByProvince[provinceId] ?? null,
    },
  });
});

app.post("/admin/provinces/recalculate-auto-costs", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth || !(await isAdminCountry(auth.countryId))) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const previousWorldBase = cloneWorldBaseSectionSnapshot(WORLD_DELTA_MASK.provinceColonizationByProvince);
  const updatedCount = recalculateAllProvinceColonizationCosts();
  savePersistentState();
  if (updatedCount > 0) {
    broadcastWorldDeltaFromSectionSnapshot(wss, previousWorldBase);
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
    invalidateCountryQueryCache();
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
    invalidateCountryQueryCache();
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

  const previousWorldBase = cloneWorldBaseSectionSnapshot(
    WORLD_DELTA_MASK.resourcesByCountry |
      WORLD_DELTA_MASK.provinceOwner |
      WORLD_DELTA_MASK.colonyProgressByProvince,
  );
  await prisma.country.delete({ where: { id: countryIdParam } });
  invalidateCountryQueryCache();

  removeUploadedByUrl(target.flagUrl);
  removeUploadedByUrl(target.crestUrl);

  delete worldBase.resourcesByCountry[countryIdParam];
  removeCountryFromEconomyTick(countryIdParam);
  for (const [provinceId, ownerId] of Object.entries(worldBase.provinceOwner)) {
    if (ownerId === countryIdParam) {
      delete worldBase.provinceOwner[provinceId];
    }
  }
  for (const progress of Object.values(worldBase.colonyProgressByProvince)) {
    delete progress[countryIdParam];
  }
  removeCountryFromActiveColonizationIndex(countryIdParam);
  for (const [provinceId, progress] of Object.entries(worldBase.colonyProgressByProvince)) {
    if (Object.keys(progress).length === 0) {
      delete worldBase.colonyProgressByProvince[provinceId];
      removeProvinceFromActiveColonizationIndex(provinceId);
    }
  }

  savePersistentState();
  broadcastWorldDeltaFromSectionSnapshot(wss, previousWorldBase);
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
    invalidateCountryQueryCache();

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
  invalidateCountryQueryCache();
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
    invalidateCountryQueryCache();

  if (!worldBase.resourcesByCountry[country.id]) {
    worldBase.resourcesByCountry[country.id] = {
      culture: 5,
      science: 5,
      religion: 5,
      colonization: gameSettings.colonization.pointsPerTurn,
      ducats: 20,
      gold: 80,
    };
    addCountryToEconomyTick(country.id);
  } else {
    addCountryToEconomyTick(country.id);
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
    invalidateCountryQueryCache();
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
  const previousWorldBase = cloneWorldBaseSectionSnapshot(
    WORLD_DELTA_MASK.resourcesByCountry |
      WORLD_DELTA_MASK.provinceOwner |
      WORLD_DELTA_MASK.colonyProgressByProvince,
  );
  await prisma.country.delete({ where: { id: targetId } });
  invalidateCountryQueryCache();

  delete worldBase.resourcesByCountry[targetId];
  removeCountryFromEconomyTick(targetId);
  for (const [provinceId, ownerId] of Object.entries(worldBase.provinceOwner)) {
    if (ownerId === targetId) delete worldBase.provinceOwner[provinceId];
  }
  for (const [provinceId, progressByCountry] of Object.entries(worldBase.colonyProgressByProvince)) {
    if (progressByCountry[targetId] != null) {
      delete progressByCountry[targetId];
      if (Object.keys(progressByCountry).length === 0) delete worldBase.colonyProgressByProvince[provinceId];
    }
  }
  removeCountryFromActiveColonizationIndex(targetId);
  savePersistentState();
  removeQueuedUiNotification(`registration-approval:${targetId}`);
  broadcastWorldDeltaFromSectionSnapshot(wss, previousWorldBase);
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
  let lastAckedWorldStateVersion = 0;

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
          worldBase: {
            ...worldBase,
            turnId,
          },
          turnId,
          worldStateVersion,
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

    if (msg.type === "WORLD_DELTA_ACK") {
      if (typeof msg.worldStateVersion === "number" && Number.isFinite(msg.worldStateVersion)) {
        lastAckedWorldStateVersion = Math.max(lastAckedWorldStateVersion, Math.floor(msg.worldStateVersion));
      }
      return;
    }

    if (msg.type === "WORLD_DELTA_REPLAY_REQUEST") {
      const fromWorldStateVersion = Math.floor(msg.fromWorldStateVersion ?? 0);
      if (!Number.isFinite(fromWorldStateVersion) || fromWorldStateVersion < 0) {
        send({ type: "ERROR", code: "REPLAY_BAD_REQUEST", message: "Invalid replay request version" });
        return;
      }
      const replayBaseVersion =
        lastAckedWorldStateVersion > 0
          ? Math.min(fromWorldStateVersion, lastAckedWorldStateVersion)
          : fromWorldStateVersion;
      const replay = getReplayDeltasFromVersion(replayBaseVersion);
      if (!replay.ok) {
        send({
          type: "ERROR",
          code: "REPLAY_UNAVAILABLE",
          message: "Replay history is unavailable for requested version",
        });
        return;
      }
      for (const delta of replay.deltas) {
        send(delta);
      }
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

        const activeColonizeTargets = new Set<string>(activeColonizeProvincesByCountry.get(delta.order.countryId) ?? []);
        const queuedByCountry = queuedColonizeProvincesByCountryByTurn.get(turnId)?.get(delta.order.countryId);
        if (queuedByCountry) {
          for (const provinceId of queuedByCountry) {
            activeColonizeTargets.add(provinceId);
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
      addOrderToTurnIndexes(order);
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
      const countries = await getCachedCountryQuery({
        key: "country:resolve-status",
        loader: () =>
          prisma.country.findMany({
            select: {
              id: true,
              isLocked: true,
              blockedUntilTurn: true,
              blockedUntilAt: true,
              ignoreUntilTurn: true,
            },
          }),
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
  await ensureWorldDeltaLogTable();
  await loadPersistentState();
  rebuildTurnOrderIndexes();
  rebuildActiveColonizationIndexFromWorldBase();
  rebuildEconomyTickCountryIndexFromWorldBase();
  await syncPersistedWorldDeltaLogWithCurrentState();
  schedulePersistedWorldDeltaLogPrune();
  await loadPersistedWorldDeltaHistory();
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
  setInterval(() => {
    schedulePersistedWorldDeltaLogPrune();
  }, WORLD_DELTA_LOG_PRUNE_INTERVAL_MS);
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
