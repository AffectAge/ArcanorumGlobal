import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import multer from "multer";
import { imageSize } from "image-size";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import Redis from "ioredis";
import dotenv from "dotenv";
import { Engine } from "json-rules-engine";
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
  type ProvinceConstructionProject,
  type ProvinceResourceDeposit,
  type ProvinceResourceExplorationProject,
  type BuildingInstance,
  type BuildingOwner,
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
  autoCleanupUploadsOnStart: process.env.AUTO_CLEANUP_UPLOADS_ON_START !== "false",
};

const uploadsRoot = resolve(__dirname, "../uploads");
const flagsDir = resolve(uploadsRoot, "flags");
const crestsDir = resolve(uploadsRoot, "crests");
const marketsDir = resolve(uploadsRoot, "markets");
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
const FLAG_IMAGE_RULE = { maxWidth: 192, maxHeight: 128, ratioWidth: 3, ratioHeight: 2 } as const;
const CREST_IMAGE_RULE = { maxWidth: 128, maxHeight: 192, ratioWidth: 2, ratioHeight: 3 } as const;
mkdirSync(flagsDir, { recursive: true });
mkdirSync(crestsDir, { recursive: true });
mkdirSync(marketsDir, { recursive: true });
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

const resourceIconFields = new Set(["culture", "science", "religion", "colonization", "construction", "ducats", "gold"]);

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
    if (file.fieldname === "marketLogo") {
      cb(null, marketsDir);
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
const BUILDING_BASE_THROUGHPUT = 1;
const BUILDING_BASE_WAGE_PER_WORKER_GOLD = 0.2;
const DEFAULT_PROVINCE_INFRASTRUCTURE_CAPACITY = 100;
const DEFAULT_LOCAL_INFRA_CATEGORY_CAPACITY = 100;
const DEFAULT_RESOURCE_BASE_PRICE = 1;
const MARKET_PRICE_SMOOTHING = 0.3;
const MARKET_PRICE_HISTORY_LENGTH = 10;
const MARKET_PRICE_EPSILON = 0.0001;
const DEFAULT_MARKET_PRICE_SMOOTHING = MARKET_PRICE_SMOOTHING;
const DEFAULT_EXPLORATION_EMPTY_CHANCE_PCT = 50;
const DEFAULT_EXPLORATION_DEPLETION_PER_ATTEMPT_PCT = 7.5;
const DEFAULT_EXPLORATION_DURATION_TURNS = 3;
const DEFAULT_EXPLORATION_ROLLS_PER_EXPEDITION = 3;
type PriceScopeState = Record<string, Record<string, number>>;
let countryGoodPrices: PriceScopeState = {};
let globalGoodPrices: Record<string, number> = {};
let globalGoodPriceHistoryByResourceId: Record<string, number[]> = {};
let globalGoodDemandHistoryByResourceId: Record<string, number[]> = {};
let globalGoodOfferHistoryByResourceId: Record<string, number[]> = {};
let globalGoodProductionFactHistoryByResourceId: Record<string, number[]> = {};
let globalGoodProductionMaxHistoryByResourceId: Record<string, number[]> = {};
let previousTradeInfraLoadByProvince: Record<string, number> = {};
function createEmptyMarketOverviewState(nextTurnId: number): MarketOverviewState {
  return {
    turnId: Math.max(1, Math.floor(Number(nextTurnId) || 1)),
    demandByCountry: {},
    offerByCountry: {},
    demandGlobal: {},
    offerGlobal: {},
    infraByProvince: {},
    alertsByCountry: {},
    importsByCountryByCountryAndGood: {},
    exportsByCountryByCountryAndGood: {},
    importsByMarketByMarketAndGood: {},
    exportsByMarketByMarketAndGood: {},
  };
}
let latestMarketOverview: MarketOverviewState = createEmptyMarketOverviewState(1);

function round3(value: number): number {
  return Number(value.toFixed(3));
}

function normalizeTradeInfraLoadMap(input: unknown): Record<string, number> {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const normalized: Record<string, number> = {};
  for (const [provinceId, rawValue] of Object.entries(source)) {
    if (!provinceId) continue;
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) continue;
    normalized[provinceId] = round3(Math.max(0, Number(rawValue)));
  }
  return normalized;
}

function normalizeMarketId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const next = value.trim();
  if (!next) return null;
  return next;
}

function normalizeMarketVisibility(value: unknown): "public" | "private" {
  return value === "private" ? "private" : "public";
}

function ensureMarketsStateShape(): void {
  if (!gameSettings.markets) {
    gameSettings.markets = { countryMarketByCountryId: {}, marketById: {}, marketInvitesById: {}, sanctionsById: {} };
    return;
  }
  if (!gameSettings.markets.countryMarketByCountryId || typeof gameSettings.markets.countryMarketByCountryId !== "object") {
    gameSettings.markets.countryMarketByCountryId = {};
  }
  if (!gameSettings.markets.marketById || typeof gameSettings.markets.marketById !== "object") {
    gameSettings.markets.marketById = {};
  }
  if (!gameSettings.markets.marketInvitesById || typeof gameSettings.markets.marketInvitesById !== "object") {
    gameSettings.markets.marketInvitesById = {};
  }
  if (!gameSettings.markets.sanctionsById || typeof gameSettings.markets.sanctionsById !== "object") {
    gameSettings.markets.sanctionsById = {};
  }
}

function createDefaultMarketRecord(marketId: string, ownerCountryId: string): {
  id: string;
  name: string;
  logoUrl: string | null;
  ownerCountryId: string;
  memberCountryIds: string[];
  visibility: "public" | "private";
  createdAt: string;
  warehouseByResourceId: Record<string, number>;
  priceByResourceId: Record<string, number>;
  priceHistoryByResourceId: Record<string, number[]>;
  demandHistoryByResourceId: Record<string, number[]>;
  offerHistoryByResourceId: Record<string, number[]>;
  productionFactHistoryByResourceId: Record<string, number[]>;
  productionMaxHistoryByResourceId: Record<string, number[]>;
  worldTradePolicyByResourceId: Record<string, MarketTradePolicyEntry>;
  resourceTradePolicyByCountryId: Record<string, Record<string, MarketTradePolicyEntry>>;
  lastSharedInfrastructureConsumedByCategory: Record<string, number>;
  lastSharedInfrastructureCapacityByCategory: Record<string, number>;
} {
  return {
    id: marketId,
    name: `Рынок ${marketId}`,
    logoUrl: null,
    ownerCountryId,
    memberCountryIds: [ownerCountryId],
    visibility: "public",
    createdAt: new Date().toISOString(),
    warehouseByResourceId: {},
    priceByResourceId: {},
    priceHistoryByResourceId: {},
    demandHistoryByResourceId: {},
    offerHistoryByResourceId: {},
    productionFactHistoryByResourceId: {},
    productionMaxHistoryByResourceId: {},
    worldTradePolicyByResourceId: {},
    resourceTradePolicyByCountryId: {},
    lastSharedInfrastructureConsumedByCategory: {},
    lastSharedInfrastructureCapacityByCategory: {},
  };
}

function getMarketDisplayName(params: { marketId: string; marketName: string; ownerCountryName?: string | null }): string {
  const rawName = (params.marketName ?? "").trim();
  const isDefaultName = rawName.length === 0 || rawName === `Рынок ${params.marketId}`;
  if (!isDefaultName) {
    return rawName;
  }
  const ownerName = (params.ownerCountryName ?? "").trim();
  return ownerName ? `Рынок ${ownerName}` : `Рынок ${params.marketId}`;
}

function isDefaultMarketName(marketId: string, marketName: string): boolean {
  const raw = (marketName ?? "").trim();
  return raw.length === 0 || raw === `Рынок ${marketId}`;
}

async function migratePersistedMarketNamesToReadable(): Promise<boolean> {
  ensureMarketModelReady();
  const markets = Object.values(gameSettings.markets.marketById);
  if (markets.length === 0) return false;
  const ownerIds = [...new Set(markets.map((market) => market.ownerCountryId).filter(Boolean))];
  const countries = ownerIds.length
    ? await prisma.country.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })
    : [];
  const countryNameById = new Map(countries.map((country) => [country.id, country.name] as const));
  let changed = false;
  for (const market of markets) {
    if (!isDefaultMarketName(market.id, market.name)) continue;
    const ownerName = countryNameById.get(market.ownerCountryId) ?? market.ownerCountryId;
    const nextName = getMarketDisplayName({
      marketId: market.id,
      marketName: market.name,
      ownerCountryName: ownerName,
    });
    if (nextName !== market.name) {
      market.name = nextName;
      changed = true;
    }
  }
  return changed;
}

function upsertMarketMembership(countryId: string, targetMarketIdRaw: string | null): string {
  ensureMarketsStateShape();
  const targetMarketId = normalizeMarketId(targetMarketIdRaw) ?? countryId;
  const marketById = gameSettings.markets.marketById;
  if (!marketById[targetMarketId]) {
    marketById[targetMarketId] = createDefaultMarketRecord(targetMarketId, countryId);
  }
  for (const market of Object.values(marketById)) {
    market.memberCountryIds = (market.memberCountryIds ?? []).filter((id) => id !== countryId);
  }
  const target = marketById[targetMarketId];
  if (!target.memberCountryIds.includes(countryId)) {
    target.memberCountryIds.push(countryId);
  }
  if (!target.ownerCountryId || !target.memberCountryIds.includes(target.ownerCountryId)) {
    target.ownerCountryId = target.memberCountryIds[0] ?? countryId;
  }
  gameSettings.markets.countryMarketByCountryId[countryId] = targetMarketId;
  return targetMarketId;
}

function rebuildCountryMarketIndexFromMembers(): void {
  ensureMarketsStateShape();
  const assignment: Record<string, string> = {};
  for (const [marketId, market] of Object.entries(gameSettings.markets.marketById)) {
    market.id = marketId;
    market.memberCountryIds = [...new Set((market.memberCountryIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
    market.visibility = normalizeMarketVisibility(market.visibility);
    market.createdAt =
      typeof market.createdAt === "string" && market.createdAt.trim() ? market.createdAt : new Date().toISOString();
    if (!market.ownerCountryId || !market.memberCountryIds.includes(market.ownerCountryId)) {
      market.ownerCountryId = market.memberCountryIds[0] ?? market.ownerCountryId ?? marketId;
    }
    for (const countryId of market.memberCountryIds) {
      if (!assignment[countryId]) {
        assignment[countryId] = marketId;
      }
    }
  }
  gameSettings.markets.countryMarketByCountryId = assignment;
}

function ensureMarketModelReady(): void {
  ensureMarketsStateShape();
  const knownCountryIds = new Set<string>([
    ...Object.keys(worldBase.resourcesByCountry ?? {}),
    ...Object.keys(gameSettings.markets.countryMarketByCountryId ?? {}),
  ]);
  for (const countryId of knownCountryIds) {
    const preferred = normalizeMarketId(gameSettings.markets.countryMarketByCountryId[countryId]) ?? countryId;
    upsertMarketMembership(countryId, preferred);
  }
  rebuildCountryMarketIndexFromMembers();
}

function getCountryMarketId(countryId: string): string {
  ensureMarketModelReady();
  const raw = gameSettings.markets.countryMarketByCountryId[countryId];
  const next = normalizeMarketId(raw) ?? countryId;
  if (!gameSettings.markets.marketById[next]) {
    gameSettings.markets.marketById[next] = createDefaultMarketRecord(next, countryId);
  }
  return next;
}

function setCountryMarketId(countryId: string, marketId: string | null): void {
  ensureMarketModelReady();
  upsertMarketMembership(countryId, marketId);
  rebuildCountryMarketIndexFromMembers();
}

function getMarketById(marketId: string): (typeof gameSettings.markets.marketById)[string] | null {
  ensureMarketModelReady();
  return gameSettings.markets.marketById[marketId] ?? null;
}

function getCountryMarketRecord(countryId: string): (typeof gameSettings.markets.marketById)[string] {
  const marketId = getCountryMarketId(countryId);
  const market = getMarketById(marketId);
  if (market) return market;
  const fallback = createDefaultMarketRecord(marketId, countryId);
  gameSettings.markets.marketById[marketId] = fallback;
  rebuildCountryMarketIndexFromMembers();
  return fallback;
}

function cleanupMarketsAfterCountryRemoval(removedCountryId: string): void {
  ensureMarketsStateShape();
  const validCountryIds = new Set<string>(Object.keys(worldBase.resourcesByCountry ?? {}));
  const marketById = gameSettings.markets.marketById;
  for (const [marketId, market] of Object.entries(marketById)) {
    const members = [...new Set((market.memberCountryIds ?? []).filter((countryId) => validCountryIds.has(countryId)))];
    market.memberCountryIds = members;
    if (!members.includes(market.ownerCountryId)) {
      market.ownerCountryId = members[0] ?? "";
    }
    if (members.length === 0) {
      if (market.logoUrl) removeUploadedByUrl(market.logoUrl);
      delete marketById[marketId];
    }
  }

  for (const [inviteId, invite] of Object.entries(gameSettings.markets.marketInvitesById)) {
    if (
      invite.fromCountryId === removedCountryId ||
      invite.toCountryId === removedCountryId ||
      !marketById[invite.marketId] ||
      !validCountryIds.has(invite.fromCountryId) ||
      !validCountryIds.has(invite.toCountryId)
    ) {
      delete gameSettings.markets.marketInvitesById[inviteId];
    }
  }

  for (const [sanctionId, sanction] of Object.entries(gameSettings.markets.sanctionsById ?? {})) {
    const initiatorExists = validCountryIds.has(sanction.initiatorCountryId);
    const targetExists =
      sanction.targetType === "country" ? validCountryIds.has(sanction.targetId) : Boolean(marketById[sanction.targetId]);
    if (!initiatorExists || !targetExists) {
      delete gameSettings.markets.sanctionsById[sanctionId];
    }
  }

  ensureMarketModelReady();
}

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

type GoodFlow = {
  goodId: string;
  amount: number;
};

type WorkforceRequirement = {
  professionId: string;
  workers: number;
};

type BuildingCountryLimit = {
  countryId: string;
  limit: number;
};

type GameContentEntry = {
  id: string;
  name: string;
  description: string;
  color: string;
  logoUrl: string | null;
  malePortraitUrl: string | null;
  femalePortraitUrl: string | null;
  baseWage?: number | null;
};

type GoodContentEntry = GameContentEntry & {
  resourceCategoryId?: string | null;
  isResourceDiscoverable?: boolean | null;
  basePrice?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  infraPerUnit?: number | null;
  infrastructureCostPerUnit?: number | null;
  explorationBaseWeight?: number | null;
  explorationSmallVeinChancePct?: number | null;
  explorationMediumVeinChancePct?: number | null;
  explorationLargeVeinChancePct?: number | null;
  explorationSmallVeinMin?: number | null;
  explorationSmallVeinMax?: number | null;
  explorationMediumVeinMin?: number | null;
  explorationMediumVeinMax?: number | null;
  explorationLargeVeinMin?: number | null;
  explorationLargeVeinMax?: number | null;
};

type BuildingContentEntry = GameContentEntry & {
  costConstruction?: number | null;
  costDucats?: number | null;
  startingDucats?: number | null;
  inputs?: GoodFlow[];
  outputs?: GoodFlow[];
  workforceRequirements?: WorkforceRequirement[];
  infrastructureUse?: number | null;
  marketInfrastructureByCategory?: Record<string, number> | null;
  allowedCountryIds?: string[];
  deniedCountryIds?: string[];
  countryBuildLimits?: BuildingCountryLimit[];
  globalBuildLimit?: number | null;
};

type MarketTradePolicyEntry = {
  allowImportFromWorld?: boolean;
  allowExportToWorld?: boolean;
  maxImportAmountPerTurnFromWorld?: number | null;
  maxExportAmountPerTurnToWorld?: number | null;
  overridesByCountryId?: Record<
    string,
    {
      allowImportFromWorld?: boolean;
      allowExportToWorld?: boolean;
      maxImportAmountPerTurnFromWorld?: number | null;
      maxExportAmountPerTurnToWorld?: number | null;
    }
  >;
  overridesByMarketId?: Record<
    string,
    {
      allowImportFromWorld?: boolean;
      allowExportToWorld?: boolean;
      maxImportAmountPerTurnFromWorld?: number | null;
      maxExportAmountPerTurnToWorld?: number | null;
    }
  >;
};

type MarketSanctionEntry = {
  id: string;
  initiatorCountryId: string;
  direction: "import" | "export" | "both";
  targetType: "country" | "market";
  targetId: string;
  goods?: string[];
  mode: "ban" | "cap";
  capAmountPerTurn?: number | null;
  startTurn: number;
  durationTurns: number;
  enabled?: boolean;
};

type GameSettings = {
  content: {
    races: GameContentEntry[];
    resourceCategories: GameContentEntry[];
    professions: GameContentEntry[];
    ideologies: GameContentEntry[];
    religions: GameContentEntry[];
    technologies: GameContentEntry[];
    buildings: BuildingContentEntry[];
    goods: GoodContentEntry[];
    companies: GameContentEntry[];
    industries: GameContentEntry[];
    cultures: GameContentEntry[];
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
    baseConstructionPerTurn: number;
    baseDucatsPerTurn: number;
    baseGoldPerTurn: number;
    demolitionCostConstructionPercent: number;
    marketPriceSmoothing: number;
    explorationBaseEmptyChancePct: number;
    explorationDepletionPerAttemptPct: number;
    explorationDurationTurns: number;
    explorationRollsPerExpedition: number;
  };
  markets: {
    countryMarketByCountryId: Record<string, string>;
    marketById: Record<
      string,
      {
        id: string;
        name: string;
        logoUrl: string | null;
        ownerCountryId: string;
        memberCountryIds: string[];
        visibility: "public" | "private";
        createdAt: string;
        warehouseByResourceId?: Record<string, number>;
        priceByResourceId?: Record<string, number>;
        priceHistoryByResourceId?: Record<string, number[]>;
        demandHistoryByResourceId?: Record<string, number[]>;
        offerHistoryByResourceId?: Record<string, number[]>;
        productionFactHistoryByResourceId?: Record<string, number[]>;
        productionMaxHistoryByResourceId?: Record<string, number[]>;
        worldTradePolicyByResourceId?: Record<string, MarketTradePolicyEntry>;
        resourceTradePolicyByCountryId?: Record<string, Record<string, MarketTradePolicyEntry>>;
        lastSharedInfrastructureConsumedByCategory?: Record<string, number>;
        lastSharedInfrastructureCapacityByCategory?: Record<string, number>;
      }
    >;
    marketInvitesById: Record<
      string,
      {
        id: string;
        marketId: string;
        fromCountryId: string;
        toCountryId: string;
        kind: "invite" | "join-request";
        status: "pending" | "accepted" | "rejected" | "canceled";
        expiresAt: string;
        createdAt: string;
        updatedAt: string;
      }
    >;
    sanctionsById: Record<string, MarketSanctionEntry>;
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
    pauseWhenNoPlayersOnline: boolean;
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
    construction: string | null;
    ducats: string | null;
    gold: string | null;
  };
};

type MarketOverviewAlert = {
  id: string;
  severity: "warning" | "critical";
  kind: "critical-deficit" | "infra-overload" | "building-inactive";
  message: string;
  provinceId?: string;
  buildingId?: string;
  instanceId?: string;
  goodId?: string;
};

type MarketOverviewState = {
  turnId: number;
  demandByCountry: Record<string, Record<string, number>>;
  offerByCountry: Record<string, Record<string, number>>;
  demandGlobal: Record<string, number>;
  offerGlobal: Record<string, number>;
  infraByProvince: Record<string, { capacity: number; required: number; coverage: number }>;
  alertsByCountry: Record<string, MarketOverviewAlert[]>;
  importsByCountryByCountryAndGood: Record<string, Record<string, Record<string, number>>>;
  exportsByCountryByCountryAndGood: Record<string, Record<string, Record<string, number>>>;
  importsByMarketByMarketAndGood: Record<string, Record<string, Record<string, number>>>;
  exportsByMarketByMarketAndGood: Record<string, Record<string, Record<string, number>>>;
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
      baseWage: unknown;
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
    const baseWage =
      typeof row.baseWage === "number" && Number.isFinite(row.baseWage) ? Math.max(0, Number(row.baseWage)) : undefined;
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
      baseWage: baseWage == null ? undefined : Number(baseWage.toFixed(3)),
    });
  }
  return items;
}

function normalizeContentRaces(input: unknown): GameSettings["content"]["races"] {
  return normalizeContentCultures(input);
}

function normalizeGoodFlows(input: unknown): GoodFlow[] {
  if (!Array.isArray(input)) return [];
  const items: GoodFlow[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Partial<{ goodId: unknown; amount: unknown }>;
    const goodId = typeof row.goodId === "string" ? row.goodId.trim() : "";
    const amount = typeof row.amount === "number" && Number.isFinite(row.amount) ? Math.max(0, row.amount) : 0;
    if (!goodId || amount <= 0) continue;
    items.push({ goodId, amount: Number(amount.toFixed(3)) });
  }
  return items.slice(0, 64);
}

function normalizeWorkforceRequirements(input: unknown): WorkforceRequirement[] {
  if (!Array.isArray(input)) return [];
  const items: WorkforceRequirement[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Partial<{ professionId: unknown; workers: unknown }>;
    const professionId = typeof row.professionId === "string" ? row.professionId.trim() : "";
    const workers = typeof row.workers === "number" && Number.isFinite(row.workers) ? Math.max(0, Math.floor(row.workers)) : 0;
    if (!professionId || workers <= 0) continue;
    items.push({ professionId, workers });
  }
  return items.slice(0, 64);
}

function normalizeCountryIdList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const unique = new Set<string>();
  const items: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value || unique.has(value)) continue;
    unique.add(value);
    items.push(value);
  }
  return items.slice(0, 256);
}

function normalizeBuildingCountryLimits(input: unknown): BuildingCountryLimit[] {
  if (!Array.isArray(input)) return [];
  const byCountry = new Map<string, number>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Partial<{ countryId: unknown; limit: unknown }>;
    const countryId = typeof row.countryId === "string" ? row.countryId.trim() : "";
    const limit = typeof row.limit === "number" && Number.isFinite(row.limit) ? Math.max(1, Math.floor(row.limit)) : 0;
    if (!countryId || limit <= 0) continue;
    byCountry.set(countryId, limit);
  }
  return [...byCountry.entries()].slice(0, 256).map(([countryId, limit]) => ({ countryId, limit }));
}

function normalizeCategoryAmountMap(input: unknown): Record<string, number> {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const normalized: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(source)) {
    const nextKey = key.trim();
    if (!nextKey) continue;
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) continue;
    const value = round3(Math.max(0, Number(rawValue)));
    if (value <= 0) continue;
    normalized[nextKey] = value;
  }
  return normalized;
}

function normalizeNumberMap(input: unknown): Record<string, number> {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const normalized: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(source)) {
    const nextKey = key.trim();
    if (!nextKey) continue;
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) continue;
    normalized[nextKey] = round3(Number(rawValue));
  }
  return normalized;
}

function normalizeNumberHistoryMap(input: unknown): Record<string, number[]> {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const normalized: Record<string, number[]> = {};
  for (const [key, rawValue] of Object.entries(source)) {
    const nextKey = key.trim();
    if (!nextKey || !Array.isArray(rawValue)) continue;
    const values = rawValue
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .map((value) => round3(value))
      .slice(-MARKET_PRICE_HISTORY_LENGTH);
    normalized[nextKey] = values;
  }
  return normalized;
}

function normalizeNumberMapL2(input: unknown): Record<string, Record<string, number>> {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const normalized: Record<string, Record<string, number>> = {};
  for (const [scopeId, rawValue] of Object.entries(source)) {
    const key = scopeId.trim();
    if (!key) continue;
    normalized[key] = normalizeNumberMap(rawValue);
  }
  return normalized;
}

function normalizeNumberMapL3(input: unknown): Record<string, Record<string, Record<string, number>>> {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const normalized: Record<string, Record<string, Record<string, number>>> = {};
  for (const [scopeId, rawGoods] of Object.entries(source)) {
    const key = scopeId.trim();
    if (!key || !rawGoods || typeof rawGoods !== "object") continue;
    const goodsMap: Record<string, Record<string, number>> = {};
    for (const [goodId, rawPartners] of Object.entries(rawGoods as Record<string, unknown>)) {
      const goodKey = goodId.trim();
      if (!goodKey) continue;
      goodsMap[goodKey] = normalizeNumberMap(rawPartners);
    }
    normalized[key] = goodsMap;
  }
  return normalized;
}

function normalizeInfraOverviewMap(
  input: unknown,
): Record<string, { capacity: number; required: number; coverage: number }> {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const normalized: Record<string, { capacity: number; required: number; coverage: number }> = {};
  for (const [provinceId, rawValue] of Object.entries(source)) {
    const key = provinceId.trim();
    if (!key || !rawValue || typeof rawValue !== "object") continue;
    const row = rawValue as Record<string, unknown>;
    const capacity =
      typeof row.capacity === "number" && Number.isFinite(row.capacity) ? round3(Math.max(0, row.capacity)) : 0;
    const required =
      typeof row.required === "number" && Number.isFinite(row.required) ? round3(Math.max(0, row.required)) : 0;
    const coverage =
      typeof row.coverage === "number" && Number.isFinite(row.coverage)
        ? round3(Math.max(0, row.coverage))
        : required <= 0
          ? 1
          : round3(Math.max(0, Math.min(1, capacity / required)));
    normalized[key] = { capacity, required, coverage };
  }
  return normalized;
}

function normalizeMarketOverviewAlertsMap(input: unknown): Record<string, MarketOverviewAlert[]> {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const normalized: Record<string, MarketOverviewAlert[]> = {};
  for (const [countryId, rawAlerts] of Object.entries(source)) {
    const key = countryId.trim();
    if (!key || !Array.isArray(rawAlerts)) continue;
    const alerts: MarketOverviewAlert[] = [];
    for (const rawAlert of rawAlerts) {
      if (!rawAlert || typeof rawAlert !== "object") continue;
      const row = rawAlert as Record<string, unknown>;
      const severity = row.severity === "critical" ? "critical" : "warning";
      const kindRaw = typeof row.kind === "string" ? row.kind : "";
      const kind: MarketOverviewAlert["kind"] =
        kindRaw === "critical-deficit" || kindRaw === "infra-overload" || kindRaw === "building-inactive"
          ? kindRaw
          : "critical-deficit";
      const message = typeof row.message === "string" ? row.message.trim() : "";
      if (!message) continue;
      alerts.push({
        id: typeof row.id === "string" && row.id.trim() ? row.id : randomUUID(),
        severity,
        kind,
        message,
        provinceId: typeof row.provinceId === "string" ? row.provinceId : undefined,
        buildingId: typeof row.buildingId === "string" ? row.buildingId : undefined,
        instanceId: typeof row.instanceId === "string" ? row.instanceId : undefined,
        goodId: typeof row.goodId === "string" ? row.goodId : undefined,
      });
    }
    normalized[key] = alerts;
  }
  return normalized;
}

function normalizeMarketOverviewState(input: unknown, fallbackTurnId: number): MarketOverviewState {
  if (!input || typeof input !== "object") {
    return createEmptyMarketOverviewState(fallbackTurnId);
  }
  const row = input as Partial<MarketOverviewState>;
  const nextTurnId =
    typeof row.turnId === "number" && Number.isFinite(row.turnId) && row.turnId >= 1
      ? Math.floor(row.turnId)
      : Math.max(1, Math.floor(Number(fallbackTurnId) || 1));
  return {
    turnId: nextTurnId,
    demandByCountry: normalizeNumberMapL2(row.demandByCountry),
    offerByCountry: normalizeNumberMapL2(row.offerByCountry),
    demandGlobal: normalizeNumberMap(row.demandGlobal),
    offerGlobal: normalizeNumberMap(row.offerGlobal),
    infraByProvince: normalizeInfraOverviewMap(row.infraByProvince),
    alertsByCountry: normalizeMarketOverviewAlertsMap(row.alertsByCountry),
    importsByCountryByCountryAndGood: normalizeNumberMapL3(row.importsByCountryByCountryAndGood),
    exportsByCountryByCountryAndGood: normalizeNumberMapL3(row.exportsByCountryByCountryAndGood),
    importsByMarketByMarketAndGood: normalizeNumberMapL3(row.importsByMarketByMarketAndGood),
    exportsByMarketByMarketAndGood: normalizeNumberMapL3(row.exportsByMarketByMarketAndGood),
  };
}

function normalizeMarketTradePolicyEntry(input: unknown): MarketTradePolicyEntry {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const normalizeLayer = (
    value: unknown,
  ): {
    allowImportFromWorld?: boolean;
    allowExportToWorld?: boolean;
    maxImportAmountPerTurnFromWorld?: number | null;
    maxExportAmountPerTurnToWorld?: number | null;
  } => {
    const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    return {
      allowImportFromWorld:
        typeof row.allowImportFromWorld === "boolean" ? row.allowImportFromWorld : undefined,
      allowExportToWorld:
        typeof row.allowExportToWorld === "boolean" ? row.allowExportToWorld : undefined,
      maxImportAmountPerTurnFromWorld:
        typeof row.maxImportAmountPerTurnFromWorld === "number" && Number.isFinite(row.maxImportAmountPerTurnFromWorld)
          ? Math.max(0, row.maxImportAmountPerTurnFromWorld)
          : undefined,
      maxExportAmountPerTurnToWorld:
        typeof row.maxExportAmountPerTurnToWorld === "number" && Number.isFinite(row.maxExportAmountPerTurnToWorld)
          ? Math.max(0, row.maxExportAmountPerTurnToWorld)
          : undefined,
    };
  };

  const normalizeOverrides = (
    value: unknown,
  ): Record<
    string,
    {
      allowImportFromWorld?: boolean;
      allowExportToWorld?: boolean;
      maxImportAmountPerTurnFromWorld?: number | null;
      maxExportAmountPerTurnToWorld?: number | null;
    }
  > => {
    if (!value || typeof value !== "object") return {};
    const map = value as Record<string, unknown>;
    const result: Record<string, ReturnType<typeof normalizeLayer>> = {};
    for (const [id, row] of Object.entries(map)) {
      const key = id.trim();
      if (!key) continue;
      result[key] = normalizeLayer(row);
    }
    return result;
  };

  return {
    ...normalizeLayer(source),
    overridesByCountryId: normalizeOverrides(source.overridesByCountryId),
    overridesByMarketId: normalizeOverrides(source.overridesByMarketId),
  };
}

function normalizeMarketTradePolicyMap(input: unknown): Record<string, MarketTradePolicyEntry> {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const normalized: Record<string, MarketTradePolicyEntry> = {};
  for (const [resourceId, rawValue] of Object.entries(source)) {
    const key = resourceId.trim();
    if (!key) continue;
    normalized[key] = normalizeMarketTradePolicyEntry(rawValue);
  }
  return normalized;
}

function normalizeCountryResourceTradePolicyMap(
  input: unknown,
): Record<string, Record<string, MarketTradePolicyEntry>> {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const normalized: Record<string, Record<string, MarketTradePolicyEntry>> = {};
  for (const [countryId, rawValue] of Object.entries(source)) {
    const key = countryId.trim();
    if (!key) continue;
    normalized[key] = normalizeMarketTradePolicyMap(rawValue);
  }
  return normalized;
}

function normalizeMarketSanctionsMap(input: unknown): Record<string, MarketSanctionEntry> {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const normalized: Record<string, MarketSanctionEntry> = {};
  for (const [entryId, rawValue] of Object.entries(source)) {
    const fallbackId = entryId.trim();
    if (!fallbackId) continue;
    const value = rawValue && typeof rawValue === "object" ? (rawValue as Record<string, unknown>) : {};
    const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : fallbackId;
    const initiatorCountryId =
      typeof value.initiatorCountryId === "string" && value.initiatorCountryId.trim()
        ? value.initiatorCountryId.trim()
        : "";
    const targetId = typeof value.targetId === "string" && value.targetId.trim() ? value.targetId.trim() : "";
    if (!initiatorCountryId || !targetId) continue;
    const directionRaw = typeof value.direction === "string" ? value.direction : "both";
    const direction: MarketSanctionEntry["direction"] =
      directionRaw === "import" || directionRaw === "export" ? directionRaw : "both";
    const targetTypeRaw = typeof value.targetType === "string" ? value.targetType : "country";
    const targetType: MarketSanctionEntry["targetType"] = targetTypeRaw === "market" ? "market" : "country";
    const modeRaw = typeof value.mode === "string" ? value.mode : "ban";
    const mode: MarketSanctionEntry["mode"] = modeRaw === "cap" ? "cap" : "ban";
    const goods = Array.isArray(value.goods)
      ? [
          ...new Set(
            value.goods.filter((row): row is string => typeof row === "string").map((row) => row.trim()).filter(Boolean),
          ),
        ]
      : [];
    const capAmountPerTurn =
      typeof value.capAmountPerTurn === "number" && Number.isFinite(value.capAmountPerTurn)
        ? round3(Math.max(0, Number(value.capAmountPerTurn)))
        : null;
    const startTurn =
      typeof value.startTurn === "number" && Number.isFinite(value.startTurn)
        ? Math.max(1, Math.floor(value.startTurn))
        : turnId;
    const durationTurns =
      typeof value.durationTurns === "number" && Number.isFinite(value.durationTurns)
        ? Math.max(1, Math.floor(value.durationTurns))
        : 1;
    const enabled = typeof value.enabled === "boolean" ? value.enabled : true;
    normalized[id] = {
      id,
      initiatorCountryId,
      direction,
      targetType,
      targetId,
      goods,
      mode,
      capAmountPerTurn: mode === "cap" ? capAmountPerTurn ?? 0 : null,
      startTurn,
      durationTurns,
      enabled,
    };
  }
  return normalized;
}

function normalizeContentGoods(input: unknown): GameSettings["content"]["goods"] {
  const base = normalizeContentCultures(input);
  const sourceRows = Array.isArray(input) ? input : [];
  return base.map((entry, index) => {
    const raw = sourceRows[index] as Partial<{
      resourceCategoryId?: unknown;
      isResourceDiscoverable?: unknown;
      basePrice?: unknown;
      minPrice?: unknown;
      maxPrice?: unknown;
      infraPerUnit?: unknown;
      infrastructureCostPerUnit?: unknown;
      explorationBaseWeight?: unknown;
      explorationSmallVeinChancePct?: unknown;
      explorationMediumVeinChancePct?: unknown;
      explorationLargeVeinChancePct?: unknown;
      explorationSmallVeinMin?: unknown;
      explorationSmallVeinMax?: unknown;
      explorationMediumVeinMin?: unknown;
      explorationMediumVeinMax?: unknown;
      explorationLargeVeinMin?: unknown;
      explorationLargeVeinMax?: unknown;
    }> | undefined;
    const basePrice =
      typeof raw?.basePrice === "number" && Number.isFinite(raw.basePrice)
        ? Math.max(0, raw.basePrice)
        : DEFAULT_RESOURCE_BASE_PRICE;
    const defaultMin = basePrice * 0.1;
    const defaultMax = basePrice * 10;
    const minPriceRaw =
      typeof raw?.minPrice === "number" && Number.isFinite(raw.minPrice) ? Math.max(0, Number(raw.minPrice)) : defaultMin;
    const maxPriceRaw =
      typeof raw?.maxPrice === "number" && Number.isFinite(raw.maxPrice) ? Math.max(minPriceRaw, Number(raw.maxPrice)) : defaultMax;
    const infraRaw =
      typeof raw?.infrastructureCostPerUnit === "number" && Number.isFinite(raw.infrastructureCostPerUnit)
        ? Number(raw.infrastructureCostPerUnit)
        : typeof raw?.infraPerUnit === "number" && Number.isFinite(raw.infraPerUnit)
          ? Number(raw.infraPerUnit)
          : 1;
    const infraPerUnit = Math.max(0.01, Math.max(0, infraRaw));
    const resourceCategoryId =
      typeof raw?.resourceCategoryId === "string" && raw.resourceCategoryId.trim().length > 0
        ? raw.resourceCategoryId.trim()
        : null;
    const isResourceDiscoverable = typeof raw?.isResourceDiscoverable === "boolean" ? raw.isResourceDiscoverable : false;
    const explorationBaseWeight =
      typeof raw?.explorationBaseWeight === "number" && Number.isFinite(raw.explorationBaseWeight)
        ? Math.max(0, Number(raw.explorationBaseWeight))
        : 1;
    const smallChanceRaw =
      typeof raw?.explorationSmallVeinChancePct === "number" && Number.isFinite(raw.explorationSmallVeinChancePct)
        ? Math.max(0, Number(raw.explorationSmallVeinChancePct))
        : 60;
    const mediumChanceRaw =
      typeof raw?.explorationMediumVeinChancePct === "number" && Number.isFinite(raw.explorationMediumVeinChancePct)
        ? Math.max(0, Number(raw.explorationMediumVeinChancePct))
        : 30;
    const largeChanceRaw =
      typeof raw?.explorationLargeVeinChancePct === "number" && Number.isFinite(raw.explorationLargeVeinChancePct)
        ? Math.max(0, Number(raw.explorationLargeVeinChancePct))
        : 10;
    const chanceSum = smallChanceRaw + mediumChanceRaw + largeChanceRaw;
    const chanceNormDiv = chanceSum > 0 ? chanceSum / 100 : 1;
    const smallChance = chanceSum > 0 ? smallChanceRaw / chanceNormDiv : 60;
    const mediumChance = chanceSum > 0 ? mediumChanceRaw / chanceNormDiv : 30;
    const largeChance = chanceSum > 0 ? largeChanceRaw / chanceNormDiv : 10;
    const smallMin =
      typeof raw?.explorationSmallVeinMin === "number" && Number.isFinite(raw.explorationSmallVeinMin)
        ? Math.max(0, Number(raw.explorationSmallVeinMin))
        : 10;
    const smallMax =
      typeof raw?.explorationSmallVeinMax === "number" && Number.isFinite(raw.explorationSmallVeinMax)
        ? Math.max(smallMin, Number(raw.explorationSmallVeinMax))
        : 100;
    const mediumMin =
      typeof raw?.explorationMediumVeinMin === "number" && Number.isFinite(raw.explorationMediumVeinMin)
        ? Math.max(0, Number(raw.explorationMediumVeinMin))
        : 100;
    const mediumMax =
      typeof raw?.explorationMediumVeinMax === "number" && Number.isFinite(raw.explorationMediumVeinMax)
        ? Math.max(mediumMin, Number(raw.explorationMediumVeinMax))
        : 500;
    const largeMin =
      typeof raw?.explorationLargeVeinMin === "number" && Number.isFinite(raw.explorationLargeVeinMin)
        ? Math.max(0, Number(raw.explorationLargeVeinMin))
        : 500;
    const largeMax =
      typeof raw?.explorationLargeVeinMax === "number" && Number.isFinite(raw.explorationLargeVeinMax)
        ? Math.max(largeMin, Number(raw.explorationLargeVeinMax))
        : 2_000;
    return {
      ...entry,
      resourceCategoryId,
      isResourceDiscoverable,
      basePrice: Number(basePrice.toFixed(3)),
      minPrice: Number(minPriceRaw.toFixed(3)),
      maxPrice: Number(maxPriceRaw.toFixed(3)),
      infraPerUnit: Number(infraPerUnit.toFixed(3)),
      infrastructureCostPerUnit: Number(infraPerUnit.toFixed(3)),
      explorationBaseWeight: Number(explorationBaseWeight.toFixed(3)),
      explorationSmallVeinChancePct: Number(smallChance.toFixed(3)),
      explorationMediumVeinChancePct: Number(mediumChance.toFixed(3)),
      explorationLargeVeinChancePct: Number(largeChance.toFixed(3)),
      explorationSmallVeinMin: Number(smallMin.toFixed(3)),
      explorationSmallVeinMax: Number(smallMax.toFixed(3)),
      explorationMediumVeinMin: Number(mediumMin.toFixed(3)),
      explorationMediumVeinMax: Number(mediumMax.toFixed(3)),
      explorationLargeVeinMin: Number(largeMin.toFixed(3)),
      explorationLargeVeinMax: Number(largeMax.toFixed(3)),
    };
  });
}

function normalizeContentBuildings(input: unknown): GameSettings["content"]["buildings"] {
  const base = normalizeContentCultures(input);
  const sourceRows = Array.isArray(input) ? input : [];
  return base.map((entry, index) => {
    const raw = sourceRows[index] as Partial<{
      costConstruction?: unknown;
      costDucats?: unknown;
      startingDucats?: unknown;
      inputs?: unknown;
      outputs?: unknown;
      workforceRequirements?: unknown;
      infrastructureUse?: unknown;
      marketInfrastructureByCategory?: unknown;
      allowedCountryIds?: unknown;
      deniedCountryIds?: unknown;
      countryBuildLimits?: unknown;
      globalBuildLimit?: unknown;
    }> | undefined;
    const costConstruction =
      typeof raw?.costConstruction === "number" && Number.isFinite(raw.costConstruction)
        ? Math.max(1, Math.floor(raw.costConstruction))
        : 100;
    const costDucats =
      typeof raw?.costDucats === "number" && Number.isFinite(raw.costDucats)
        ? Math.max(0, Number(raw.costDucats))
        : 10;
    const startingDucats =
      typeof raw?.startingDucats === "number" && Number.isFinite(raw.startingDucats)
        ? Math.max(0, Number(raw.startingDucats))
        : 0;
    const globalBuildLimit =
      typeof raw?.globalBuildLimit === "number" && Number.isFinite(raw.globalBuildLimit)
        ? Math.max(1, Math.floor(raw.globalBuildLimit))
        : null;
    return {
      ...entry,
      costConstruction,
      costDucats: Number(costDucats.toFixed(3)),
      startingDucats: Number(startingDucats.toFixed(3)),
      inputs: normalizeGoodFlows(raw?.inputs),
      outputs: normalizeGoodFlows(raw?.outputs),
      workforceRequirements: normalizeWorkforceRequirements(raw?.workforceRequirements),
      infrastructureUse:
        typeof raw?.infrastructureUse === "number" && Number.isFinite(raw.infrastructureUse)
          ? Number(Math.max(0, raw.infrastructureUse).toFixed(3))
          : 0,
      marketInfrastructureByCategory: normalizeCategoryAmountMap(raw?.marketInfrastructureByCategory),
      allowedCountryIds: normalizeCountryIdList(raw?.allowedCountryIds),
      deniedCountryIds: normalizeCountryIdList(raw?.deniedCountryIds),
      countryBuildLimits: normalizeBuildingCountryLimits(raw?.countryBuildLimits),
      globalBuildLimit,
    };
  });
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

function normalizeProvinceInfrastructureMap(input: unknown): Record<string, number> {
  const normalized: Record<string, number> = {};
  if (input && typeof input === "object") {
    for (const [provinceId, raw] of Object.entries(input as Record<string, unknown>)) {
      const value = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Number(raw)) : DEFAULT_PROVINCE_INFRASTRUCTURE_CAPACITY;
      normalized[provinceId] = round3(value);
    }
  }
  for (const province of adm1ProvinceIndex) {
    if (normalized[province.id] == null) {
      normalized[province.id] = DEFAULT_PROVINCE_INFRASTRUCTURE_CAPACITY;
    }
  }
  return normalized;
}

function normalizeProvinceBuildingsMap(input: unknown): Record<string, BuildingInstance[]> {
  const fallbackCountryId = Object.keys(worldBase.resourcesByCountry ?? {})[0] ?? "SYSTEM";
  const normalized: Record<string, BuildingInstance[]> = {};
  if (input && typeof input === "object") {
    for (const [provinceId, raw] of Object.entries(input as Record<string, unknown>)) {
      const instances: BuildingInstance[] = [];
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (!item || typeof item !== "object") continue;
          const source = item as Partial<BuildingInstance>;
          const buildingId = typeof source.buildingId === "string" ? source.buildingId.trim() : "";
          if (!buildingId) continue;
          const createdTurnId =
            typeof source.createdTurnId === "number" && Number.isFinite(source.createdTurnId)
              ? Math.max(1, Math.floor(source.createdTurnId))
              : turnId;
          instances.push({
            instanceId:
              typeof source.instanceId === "string" && source.instanceId.trim()
                ? source.instanceId.trim()
                : randomUUID(),
            buildingId,
            owner: normalizeBuildingOwner(source.owner ?? { type: "state", countryId: fallbackCountryId }),
            createdTurnId,
            ducats:
              typeof source.ducats === "number" && Number.isFinite(source.ducats)
                ? Number(Math.max(0, source.ducats).toFixed(3))
                : 0,
            warehouseByGoodId:
              source.warehouseByGoodId && typeof source.warehouseByGoodId === "object"
                ? Object.fromEntries(
                    Object.entries(source.warehouseByGoodId as Record<string, unknown>)
                      .filter(([goodId]) => typeof goodId === "string" && goodId.trim().length > 0)
                      .map(([goodId, valueRaw]) => [
                        goodId,
                        Number(
                          (
                            typeof valueRaw === "number" && Number.isFinite(valueRaw) ? Math.max(0, valueRaw) : 0
                          ).toFixed(3),
                        ),
                      ]),
                  )
                : {},
            lastLaborCoverage:
              typeof source.lastLaborCoverage === "number" && Number.isFinite(source.lastLaborCoverage)
                ? Number(Math.max(0, Math.min(1, source.lastLaborCoverage)).toFixed(3))
                : 0,
            lastInfraCoverage:
              typeof source.lastInfraCoverage === "number" && Number.isFinite(source.lastInfraCoverage)
                ? Number(Math.max(0, Math.min(1, source.lastInfraCoverage)).toFixed(3))
                : 0,
            lastInputCoverage:
              typeof source.lastInputCoverage === "number" && Number.isFinite(source.lastInputCoverage)
                ? Number(Math.max(0, Math.min(1, source.lastInputCoverage)).toFixed(3))
                : 0,
            lastFinanceCoverage:
              typeof source.lastFinanceCoverage === "number" && Number.isFinite(source.lastFinanceCoverage)
                ? Number(Math.max(0, Math.min(1, source.lastFinanceCoverage)).toFixed(3))
                : 0,
            lastProductivity:
              typeof source.lastProductivity === "number" && Number.isFinite(source.lastProductivity)
                ? Number(Math.max(0, Math.min(1, source.lastProductivity)).toFixed(3))
                : 0,
            lastPurchaseByGoodId:
              source.lastPurchaseByGoodId && typeof source.lastPurchaseByGoodId === "object"
                ? Object.fromEntries(
                    Object.entries(source.lastPurchaseByGoodId as Record<string, unknown>).map(([goodId, valueRaw]) => [
                      goodId,
                      Number(
                        (
                          typeof valueRaw === "number" && Number.isFinite(valueRaw) ? Math.max(0, valueRaw) : 0
                        ).toFixed(3),
                      ),
                    ]),
                  )
                : {},
            lastPurchaseCostByGoodId:
              source.lastPurchaseCostByGoodId && typeof source.lastPurchaseCostByGoodId === "object"
                ? Object.fromEntries(
                    Object.entries(source.lastPurchaseCostByGoodId as Record<string, unknown>).map(([goodId, valueRaw]) => [
                      goodId,
                      Number.isFinite(Number(valueRaw)) ? round3(Math.max(0, Number(valueRaw))) : 0,
                    ]),
                  )
                : {},
            lastSalesByGoodId:
              source.lastSalesByGoodId && typeof source.lastSalesByGoodId === "object"
                ? Object.fromEntries(
                    Object.entries(source.lastSalesByGoodId as Record<string, unknown>).map(([goodId, valueRaw]) => [
                      goodId,
                      Number.isFinite(Number(valueRaw)) ? round3(Math.max(0, Number(valueRaw))) : 0,
                    ]),
                  )
                : {},
            lastSalesRevenueByGoodId:
              source.lastSalesRevenueByGoodId && typeof source.lastSalesRevenueByGoodId === "object"
                ? Object.fromEntries(
                    Object.entries(source.lastSalesRevenueByGoodId as Record<string, unknown>).map(([goodId, valueRaw]) => [
                      goodId,
                      Number.isFinite(Number(valueRaw)) ? round3(Math.max(0, Number(valueRaw))) : 0,
                    ]),
                  )
                : {},
            lastConsumptionByGoodId:
              source.lastConsumptionByGoodId && typeof source.lastConsumptionByGoodId === "object"
                ? Object.fromEntries(
                    Object.entries(source.lastConsumptionByGoodId as Record<string, unknown>).map(([goodId, valueRaw]) => [
                      goodId,
                      Number(
                        (
                          typeof valueRaw === "number" && Number.isFinite(valueRaw) ? Math.max(0, valueRaw) : 0
                        ).toFixed(3),
                      ),
                    ]),
                  )
                : {},
            lastProductionByGoodId:
              source.lastProductionByGoodId && typeof source.lastProductionByGoodId === "object"
                ? Object.fromEntries(
                    Object.entries(source.lastProductionByGoodId as Record<string, unknown>).map(([goodId, valueRaw]) => [
                      goodId,
                      Number(
                        (
                          typeof valueRaw === "number" && Number.isFinite(valueRaw) ? Math.max(0, valueRaw) : 0
                        ).toFixed(3),
                      ),
                    ]),
                  )
                : {},
            lastRevenueDucats:
              typeof source.lastRevenueDucats === "number" && Number.isFinite(source.lastRevenueDucats)
                ? Number(source.lastRevenueDucats.toFixed(3))
                : 0,
            lastInputCostDucats:
              typeof source.lastInputCostDucats === "number" && Number.isFinite(source.lastInputCostDucats)
                ? Number(source.lastInputCostDucats.toFixed(3))
                : 0,
            lastWagesDucats:
              typeof source.lastWagesDucats === "number" && Number.isFinite(source.lastWagesDucats)
                ? Number(source.lastWagesDucats.toFixed(3))
                : 0,
            lastNetDucats:
              typeof source.lastNetDucats === "number" && Number.isFinite(source.lastNetDucats)
                ? Number(source.lastNetDucats.toFixed(3))
                : 0,
            isInactive: Boolean(source.isInactive),
            inactiveReason:
              typeof source.inactiveReason === "string" || source.inactiveReason === null
                ? (source.inactiveReason ?? null)
                : null,
          });
        }
      } else if (raw && typeof raw === "object") {
        // Legacy migration: { [buildingId]: level } -> instance array.
        for (const [buildingId, levelRaw] of Object.entries(raw as Record<string, unknown>)) {
          const level =
            typeof levelRaw === "number" && Number.isFinite(levelRaw) ? Math.max(0, Math.floor(levelRaw)) : 0;
          if (!buildingId || level <= 0) continue;
          for (let i = 0; i < level; i += 1) {
            instances.push({
              instanceId: randomUUID(),
              buildingId,
              owner: { type: "state", countryId: fallbackCountryId },
              createdTurnId: turnId,
              ducats: 0,
              warehouseByGoodId: {},
              lastLaborCoverage: 0,
              lastInfraCoverage: 0,
              lastInputCoverage: 0,
              lastFinanceCoverage: 0,
              lastProductivity: 0,
              lastPurchaseByGoodId: {},
              lastPurchaseCostByGoodId: {},
              lastSalesByGoodId: {},
              lastSalesRevenueByGoodId: {},
              lastConsumptionByGoodId: {},
              lastProductionByGoodId: {},
              lastRevenueDucats: 0,
              lastInputCostDucats: 0,
              lastWagesDucats: 0,
              lastNetDucats: 0,
              isInactive: false,
              inactiveReason: null,
            });
          }
        }
      }
      normalized[provinceId] = instances;
    }
  }
  for (const province of adm1ProvinceIndex) {
    if (!normalized[province.id]) {
      normalized[province.id] = [];
    }
  }
  return normalized;
}

function normalizeProvincePopulationTreasuryMap(input: unknown): Record<string, number> {
  const normalized: Record<string, number> = {};
  if (input && typeof input === "object") {
    for (const [provinceId, raw] of Object.entries(input as Record<string, unknown>)) {
      const value = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, raw) : 0;
      normalized[provinceId] = Number(value.toFixed(3));
    }
  }
  for (const province of adm1ProvinceIndex) {
    if (normalized[province.id] == null) {
      normalized[province.id] = 0;
    }
  }
  return normalized;
}

function normalizeProvinceBuildingDucatsMap(input: unknown): Record<string, Record<string, number>> {
  const normalized: Record<string, Record<string, number>> = {};
  if (input && typeof input === "object") {
    for (const [provinceId, raw] of Object.entries(input as Record<string, unknown>)) {
      if (!raw || typeof raw !== "object") continue;
      const byBuilding: Record<string, number> = {};
      for (const [buildingId, valueRaw] of Object.entries(raw as Record<string, unknown>)) {
        const value = typeof valueRaw === "number" && Number.isFinite(valueRaw) ? Math.max(0, valueRaw) : 0;
        if (!buildingId) continue;
        byBuilding[buildingId] = Number(value.toFixed(3));
      }
      normalized[provinceId] = byBuilding;
    }
  }
  for (const province of adm1ProvinceIndex) {
    if (!normalized[province.id]) {
      normalized[province.id] = {};
    }
  }
  return normalized;
}

function normalizeBuildingOwner(input: unknown): BuildingOwner {
  const fallbackCountryId = Object.keys(worldBase.resourcesByCountry ?? {})[0] ?? "SYSTEM";
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (source.type === "company" && typeof source.companyId === "string" && source.companyId.trim()) {
    return { type: "company", companyId: source.companyId.trim() };
  }
  if (typeof source.countryId === "string" && source.countryId.trim()) {
    return { type: "state", countryId: source.countryId.trim() };
  }
  return { type: "state", countryId: fallbackCountryId };
}

function normalizeProvinceConstructionQueueMap(input: unknown): Record<string, ProvinceConstructionProject[]> {
  const fallbackCountryId = Object.keys(worldBase.resourcesByCountry ?? {})[0] ?? "SYSTEM";
  const normalized: Record<string, ProvinceConstructionProject[]> = {};
  if (input && typeof input === "object") {
    for (const [provinceId, raw] of Object.entries(input as Record<string, unknown>)) {
      const rows = Array.isArray(raw) ? raw : [];
      const projects: ProvinceConstructionProject[] = [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const source = row as Partial<ProvinceConstructionProject>;
        const queueId = typeof source.queueId === "string" && source.queueId.trim() ? source.queueId.trim() : randomUUID();
        const requestedByCountryId =
          typeof source.requestedByCountryId === "string" && source.requestedByCountryId.trim()
            ? source.requestedByCountryId.trim()
            : fallbackCountryId;
        const buildingId = typeof source.buildingId === "string" ? source.buildingId.trim() : "";
        if (!buildingId) continue;
        const costConstruction =
          typeof source.costConstruction === "number" && Number.isFinite(source.costConstruction)
            ? Math.max(1, Math.floor(source.costConstruction))
            : 100;
        const costDucats =
          typeof source.costDucats === "number" && Number.isFinite(source.costDucats)
            ? Math.max(0, Number(source.costDucats))
            : 10;
        const progressConstruction =
          typeof source.progressConstruction === "number" && Number.isFinite(source.progressConstruction)
            ? Math.max(0, Math.min(costConstruction, Number(source.progressConstruction)))
            : 0;
        const createdTurnId =
          typeof source.createdTurnId === "number" && Number.isFinite(source.createdTurnId)
            ? Math.max(1, Math.floor(source.createdTurnId))
            : turnId;
        projects.push({
          queueId,
          requestedByCountryId,
          buildingId,
          owner: normalizeBuildingOwner(source.owner),
          progressConstruction: Number(progressConstruction.toFixed(3)),
          costConstruction,
          costDucats: Number(costDucats.toFixed(3)),
          createdTurnId,
        });
      }
      normalized[provinceId] = projects;
    }
  }
  for (const province of adm1ProvinceIndex) {
    if (!normalized[province.id]) {
      normalized[province.id] = [];
    }
  }
  return normalized;
}

function normalizeProvinceResourceDepositsMap(input: unknown): Record<string, ProvinceResourceDeposit[]> {
  const normalized: Record<string, ProvinceResourceDeposit[]> = {};
  if (input && typeof input === "object") {
    const source = input as Record<string, unknown>;
    for (const [provinceId, rawRows] of Object.entries(source)) {
      if (!provinceId || !Array.isArray(rawRows)) continue;
      const rows: ProvinceResourceDeposit[] = [];
      for (const rawRow of rawRows) {
        if (!rawRow || typeof rawRow !== "object") continue;
        const row = rawRow as Partial<ProvinceResourceDeposit>;
        const goodId = typeof row.goodId === "string" ? row.goodId.trim() : "";
        if (!goodId) continue;
        const amount =
          typeof row.amount === "number" && Number.isFinite(row.amount) ? round3(Math.max(0, Number(row.amount))) : 0;
        if (amount <= 0) continue;
        const discoveredTurnId =
          typeof row.discoveredTurnId === "number" && Number.isFinite(row.discoveredTurnId)
            ? Math.max(1, Math.floor(row.discoveredTurnId))
            : turnId;
        const veinSize =
          row.veinSize === "small" || row.veinSize === "medium" || row.veinSize === "large"
            ? row.veinSize
            : "small";
        const existing = rows.find((entry) => entry.goodId === goodId);
        if (existing) {
          existing.amount = round3(existing.amount + amount);
          continue;
        }
        rows.push({ goodId, amount, discoveredTurnId, veinSize });
      }
      normalized[provinceId] = rows.sort((a, b) => a.goodId.localeCompare(b.goodId));
    }
  }
  for (const province of adm1ProvinceIndex) {
    if (!normalized[province.id]) normalized[province.id] = [];
  }
  return normalized;
}

function normalizeProvinceResourceExplorationQueueMap(
  input: unknown,
): Record<string, ProvinceResourceExplorationProject[]> {
  const normalized: Record<string, ProvinceResourceExplorationProject[]> = {};
  if (input && typeof input === "object") {
    const source = input as Record<string, unknown>;
    for (const [provinceId, rawRows] of Object.entries(source)) {
      if (!provinceId || !Array.isArray(rawRows)) continue;
      const rows: ProvinceResourceExplorationProject[] = [];
      for (const rawRow of rawRows) {
        if (!rawRow || typeof rawRow !== "object") continue;
        const row = rawRow as Partial<ProvinceResourceExplorationProject>;
        const requestedByCountryId =
          typeof row.requestedByCountryId === "string" && row.requestedByCountryId.trim()
            ? row.requestedByCountryId.trim()
            : "";
        if (!requestedByCountryId) continue;
        const queueId = typeof row.queueId === "string" && row.queueId.trim() ? row.queueId.trim() : randomUUID();
        const startedTurnId =
          typeof row.startedTurnId === "number" && Number.isFinite(row.startedTurnId)
            ? Math.max(1, Math.floor(row.startedTurnId))
            : turnId;
        const turnsRemaining =
          typeof row.turnsRemaining === "number" && Number.isFinite(row.turnsRemaining)
            ? Math.max(0, Math.floor(row.turnsRemaining))
            : 0;
        rows.push({ queueId, requestedByCountryId, startedTurnId, turnsRemaining });
      }
      normalized[provinceId] = rows;
    }
  }
  for (const province of adm1ProvinceIndex) {
    if (!normalized[province.id]) normalized[province.id] = [];
  }
  return normalized;
}

function normalizeProvinceResourceExplorationCountMap(input: unknown): Record<string, number> {
  const normalized: Record<string, number> = {};
  if (input && typeof input === "object") {
    const source = input as Record<string, unknown>;
    for (const [provinceId, rawValue] of Object.entries(source)) {
      if (!provinceId) continue;
      const value =
        typeof rawValue === "number" && Number.isFinite(rawValue) ? Math.max(0, Math.floor(rawValue)) : 0;
      normalized[provinceId] = value;
    }
  }
  for (const province of adm1ProvinceIndex) {
    if (normalized[province.id] == null) normalized[province.id] = 0;
  }
  return normalized;
}

function resolvePopulationTurnForProvince(
  currentPopulation: ProvincePopulation,
  nextProfessionPct?: Record<string, number>,
): ProvincePopulation {
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
    professionPct: nextProfessionPct ?? currentPopulation.professionPct,
  };
}

function resolveBuildingsTurn(): Record<string, Record<string, number>> {
  const domains = getPopulationDomainKeys();
  const buildingById = new Map(gameSettings.content.buildings.map((entry) => [entry.id, entry] as const));
  const goodById = new Map(gameSettings.content.goods.map((entry) => [entry.id, entry] as const));
  const professionById = new Map(gameSettings.content.professions.map((entry) => [entry.id, entry] as const));
  const goodBasePriceById = new Map(
    gameSettings.content.goods.map((entry) => [entry.id, Number(entry.basePrice ?? 1)] as const),
  );
  const nextProfessionPctByProvince: Record<string, Record<string, number>> = {};
  const smoothing = Number(
    Math.max(0, Math.min(1, gameSettings.economy.marketPriceSmoothing ?? DEFAULT_MARKET_PRICE_SMOOTHING)).toFixed(3),
  );

  type CountryGoodMap = Record<string, Record<string, number>>;
  const demandRequestedByCountry: CountryGoodMap = {};
  const productionByCountry: CountryGoodMap = {};
  const productionMaxByCountry: CountryGoodMap = {};
  const marketVolumeByCountry: CountryGoodMap = {};
  const demandRequestedGlobal: Record<string, number> = {};
  const productionGlobal: Record<string, number> = {};
  const productionMaxGlobal: Record<string, number> = {};
  const marketVolumeGlobal: Record<string, number> = {};
  const infraRemainingByProvinceAndCategory: Record<string, Record<string, number>> = {};
  const infraConsumedByProvinceAndCategory: Record<string, Record<string, number>> = {};
  const remainingSharedInfrastructureByMarketIdAndCategory: Record<string, Record<string, number>> = {};
  const consumedSharedInfrastructureByMarketIdAndCategory: Record<string, Record<string, number>> = {};
  const worldTradeUsedAmountByScope: Record<string, number> = {};
  const sanctionUsedAmountById: Record<string, number> = {};
  const infraByProvince: Record<string, { capacity: number; required: number; coverage: number }> = {};
  const alertsByCountry: Record<string, MarketOverviewAlert[]> = {};
  const importsByCountryByCountryAndGood: Record<string, Record<string, Record<string, number>>> = {};
  const exportsByCountryByCountryAndGood: Record<string, Record<string, Record<string, number>>> = {};
  const importsByMarketByMarketAndGood: Record<string, Record<string, Record<string, number>>> = {};
  const exportsByMarketByMarketAndGood: Record<string, Record<string, Record<string, number>>> = {};
  let alertSeq = 0;
  const pushCountryAlert = (countryId: string, alert: Omit<MarketOverviewAlert, "id">): void => {
    if (!alertsByCountry[countryId]) alertsByCountry[countryId] = [];
    alertsByCountry[countryId].push({ id: `a-${turnId}-${++alertSeq}`, ...alert });
  };
  type ActiveTradeSanction = MarketSanctionEntry & {
    goodsSet: Set<string> | null;
    expiresAtTurnExclusive: number;
  };
  const sanctionsRaw = Object.values(gameSettings.markets.sanctionsById ?? {});
  const activeSanctionsByInitiator = new Map<string, ActiveTradeSanction[]>();
  for (const sanction of sanctionsRaw) {
    if (sanction.enabled === false) continue;
    const startTurn = Math.max(1, Math.floor(Number(sanction.startTurn ?? turnId)));
    const durationTurns = Math.max(1, Math.floor(Number(sanction.durationTurns ?? 1)));
    const expiresAtTurnExclusive = startTurn + durationTurns;
    if (turnId < startTurn || turnId >= expiresAtTurnExclusive) continue;
    const list = activeSanctionsByInitiator.get(sanction.initiatorCountryId) ?? [];
    list.push({
      ...sanction,
      goodsSet: sanction.goods && sanction.goods.length > 0 ? new Set(sanction.goods) : null,
      expiresAtTurnExclusive,
    });
    activeSanctionsByInitiator.set(sanction.initiatorCountryId, list);
  }
  const collectTradeSanctions = (params: {
    initiatorCountryId: string;
    direction: "import" | "export";
    targetCountryId: string;
    targetMarketId: string;
    goodId: string;
  }): ActiveTradeSanction[] => {
    const list = activeSanctionsByInitiator.get(params.initiatorCountryId) ?? [];
    if (list.length === 0) return [];
    return list.filter((sanction) => {
      if (!(sanction.direction === "both" || sanction.direction === params.direction)) return false;
      if (sanction.goodsSet && !sanction.goodsSet.has(params.goodId)) return false;
      if (sanction.targetType === "country") return sanction.targetId === params.targetCountryId;
      return sanction.targetId === params.targetMarketId;
    });
  };

  type SellerSlot = {
    provinceId: string;
    countryId: string;
    marketId: string;
    instanceId: string;
    instance: BuildingInstance;
  };
  const sellersByProvinceGood = new Map<string, SellerSlot[]>();
  const sellersByCountryGood = new Map<string, SellerSlot[]>();
  const sellersByMarketGood = new Map<string, SellerSlot[]>();
  const sellersByGlobalGood = new Map<string, SellerSlot[]>();
  const soldBySellerAndGood = new Map<string, number>();
  const getSellerUsageKey = (instanceId: string, goodId: string) => `${instanceId}:${goodId}`;

  const ensureCountryGood = (map: CountryGoodMap, countryId: string, goodId: string): void => {
    if (!map[countryId]) map[countryId] = {};
    if (map[countryId][goodId] == null) map[countryId][goodId] = 0;
  };
  const addCountryGood = (map: CountryGoodMap, countryId: string, goodId: string, value: number): void => {
    if (value <= 0) return;
    ensureCountryGood(map, countryId, goodId);
    map[countryId][goodId] = round3((map[countryId][goodId] ?? 0) + value);
  };
  const addGlobalGood = (map: Record<string, number>, goodId: string, value: number): void => {
    if (value <= 0) return;
    map[goodId] = round3((map[goodId] ?? 0) + value);
  };
  const getMarketIdByCountry = (countryId: string): string => getCountryMarketId(countryId);
  const getProvinceInfrastructureFallbackCapacity = (provinceId: string): number =>
    round3(Math.max(0, Number(worldBase.provinceInfrastructureByProvince[provinceId] ?? DEFAULT_PROVINCE_INFRASTRUCTURE_CAPACITY)));
  const getProvinceCategoryCapacity = (provinceId: string, categoryId: string): number => {
    const anyWorldBase = worldBase as WorldBase & {
      provinceLogisticsPointsByCategoryByProvince?: Record<string, Record<string, number>>;
    };
    const explicit = anyWorldBase.provinceLogisticsPointsByCategoryByProvince?.[provinceId]?.[categoryId];
    if (typeof explicit === "number" && Number.isFinite(explicit)) {
      return round3(Math.max(0, explicit));
    }
    return DEFAULT_LOCAL_INFRA_CATEGORY_CAPACITY;
  };
  const getProvinceInfraRemaining = (provinceId: string, categoryId: string): number => {
    if (!infraRemainingByProvinceAndCategory[provinceId]) infraRemainingByProvinceAndCategory[provinceId] = {};
    if (infraRemainingByProvinceAndCategory[provinceId][categoryId] == null) {
      infraRemainingByProvinceAndCategory[provinceId][categoryId] = getProvinceCategoryCapacity(provinceId, categoryId);
    }
    return Math.max(0, Number(infraRemainingByProvinceAndCategory[provinceId][categoryId]));
  };
  const consumeProvinceInfra = (provinceId: string, categoryId: string, amount: number): void => {
    if (amount <= 0) return;
    const currentRemaining = getProvinceInfraRemaining(provinceId, categoryId);
    const consumed = Math.min(currentRemaining, amount);
    infraRemainingByProvinceAndCategory[provinceId][categoryId] = round3(Math.max(0, currentRemaining - consumed));
    if (!infraConsumedByProvinceAndCategory[provinceId]) infraConsumedByProvinceAndCategory[provinceId] = {};
    infraConsumedByProvinceAndCategory[provinceId][categoryId] = round3(
      (infraConsumedByProvinceAndCategory[provinceId][categoryId] ?? 0) + consumed,
    );
  };
  const getSharedInfraRemaining = (marketId: string, categoryId: string): number => {
    return Math.max(0, Number(remainingSharedInfrastructureByMarketIdAndCategory[marketId]?.[categoryId] ?? 0));
  };
  const consumeSharedInfra = (marketId: string, categoryId: string, amount: number): void => {
    if (amount <= 0) return;
    if (!remainingSharedInfrastructureByMarketIdAndCategory[marketId]) {
      remainingSharedInfrastructureByMarketIdAndCategory[marketId] = {};
    }
    const current = Math.max(0, Number(remainingSharedInfrastructureByMarketIdAndCategory[marketId][categoryId] ?? 0));
    const consumed = Math.min(current, amount);
    remainingSharedInfrastructureByMarketIdAndCategory[marketId][categoryId] = round3(Math.max(0, current - consumed));
    if (!consumedSharedInfrastructureByMarketIdAndCategory[marketId]) {
      consumedSharedInfrastructureByMarketIdAndCategory[marketId] = {};
    }
    consumedSharedInfrastructureByMarketIdAndCategory[marketId][categoryId] = round3(
      (consumedSharedInfrastructureByMarketIdAndCategory[marketId][categoryId] ?? 0) + consumed,
    );
  };
  const getPriceMeta = (goodId: string): { base: number; min: number; max: number } => {
    const entry = goodById.get(goodId);
    const base = Math.max(0, Number(entry?.basePrice ?? DEFAULT_RESOURCE_BASE_PRICE));
    const min = Math.max(0, Number(entry?.minPrice ?? base * 0.1));
    const max = Math.max(min, Number(entry?.maxPrice ?? base * 10));
    return { base, min, max };
  };
  const getCountryGoodPrice = (countryId: string, goodId: string): number => {
    const meta = getPriceMeta(goodId);
    const marketId = getCountryMarketId(countryId);
    if (!countryGoodPrices[marketId]) countryGoodPrices[marketId] = {};
    if (countryGoodPrices[marketId][goodId] == null) {
      countryGoodPrices[marketId][goodId] = round3(meta.base);
    }
    return Math.max(meta.min, Math.min(meta.max, Number(countryGoodPrices[marketId][goodId])));
  };
  const getGlobalGoodPrice = (goodId: string): number => {
    const meta = getPriceMeta(goodId);
    if (globalGoodPrices[goodId] == null) {
      globalGoodPrices[goodId] = round3(meta.base);
    }
    return Math.max(meta.min, Math.min(meta.max, Number(globalGoodPrices[goodId])));
  };
  const getInfraPerUnit = (goodId: string): number => {
    const entry = goodById.get(goodId);
    const value = Number(entry?.infrastructureCostPerUnit ?? entry?.infraPerUnit ?? 1);
    return round3(Math.max(0.01, Math.max(0, Number.isFinite(value) ? value : 1)));
  };
  const getResourceCategoryId = (goodId: string): string | null => {
    const raw = goodById.get(goodId)?.resourceCategoryId;
    if (typeof raw !== "string") return null;
    const next = raw.trim();
    return next.length > 0 ? next : null;
  };
  const resolveTradePolicyLayer = (
    base: MarketTradePolicyEntry | undefined,
    otherMarketId: string,
    otherCountryId: string,
  ): {
    allowImportFromWorld: boolean;
    allowExportToWorld: boolean;
    maxImportAmountPerTurnFromWorld: number | null;
    maxExportAmountPerTurnToWorld: number | null;
    scopeImport: string;
    scopeExport: string;
  } => {
    const byCountry = base?.overridesByCountryId?.[otherCountryId];
    const byMarket = base?.overridesByMarketId?.[otherMarketId];
    const layer = byCountry ?? byMarket ?? base;
    const scope = byCountry ? `country:${otherCountryId}` : byMarket ? `market:${otherMarketId}` : "all";
    return {
      allowImportFromWorld: layer?.allowImportFromWorld ?? true,
      allowExportToWorld: layer?.allowExportToWorld ?? true,
      maxImportAmountPerTurnFromWorld:
        typeof layer?.maxImportAmountPerTurnFromWorld === "number" && Number.isFinite(layer.maxImportAmountPerTurnFromWorld)
          ? Math.max(0, layer.maxImportAmountPerTurnFromWorld)
          : null,
      maxExportAmountPerTurnToWorld:
        typeof layer?.maxExportAmountPerTurnToWorld === "number" && Number.isFinite(layer.maxExportAmountPerTurnToWorld)
          ? Math.max(0, layer.maxExportAmountPerTurnToWorld)
          : null,
      scopeImport: scope,
      scopeExport: scope,
    };
  };
  const getWorldTradeUsageKey = (
    marketId: string,
    goodId: string,
    direction: "import" | "export",
    scope: string,
  ): string => `${marketId}::${goodId}::${direction}::${scope}`;
  const getRemainingByPolicyLimit = (
    marketId: string,
    goodId: string,
    direction: "import" | "export",
    scope: string,
    limit: number | null,
  ): number => {
    if (limit == null) return Number.POSITIVE_INFINITY;
    const used = Number(worldTradeUsedAmountByScope[getWorldTradeUsageKey(marketId, goodId, direction, scope)] ?? 0);
    return Math.max(0, round3(limit - used));
  };
  const consumePolicyLimit = (
    marketId: string,
    goodId: string,
    direction: "import" | "export",
    scope: string,
    amount: number,
  ): void => {
    if (amount <= 0) return;
    const key = getWorldTradeUsageKey(marketId, goodId, direction, scope);
    worldTradeUsedAmountByScope[key] = round3((worldTradeUsedAmountByScope[key] ?? 0) + amount);
  };
  const updatePrice = (current: number, demand: number, offer: number, meta: { base: number; min: number; max: number }): number => {
    const ratio = (demand + 1) / (offer + 1);
    const epsilon = MARKET_PRICE_EPSILON;
    const target = Math.abs(demand - offer) <= epsilon ? meta.base : current * ratio;
    const clampedTarget = Math.max(meta.min, Math.min(meta.max, target));
    const next = current * (1 - smoothing) + clampedTarget * smoothing;
    return round3(Math.max(0.01, Math.max(meta.min, Math.min(meta.max, next))));
  };
  const addCategoryAmount = (map: Record<string, Record<string, number>>, scopeId: string, categoryId: string, value: number): void => {
    if (!scopeId || !categoryId || value <= 0) return;
    if (!map[scopeId]) map[scopeId] = {};
    map[scopeId][categoryId] = round3((map[scopeId][categoryId] ?? 0) + value);
  };
  const addScopeGoodPartnerAmount = (
    map: Record<string, Record<string, Record<string, number>>>,
    scopeId: string,
    goodId: string,
    partnerId: string,
    value: number,
  ): void => {
    if (!scopeId || !goodId || !partnerId || value <= 0) return;
    if (!map[scopeId]) map[scopeId] = {};
    if (!map[scopeId][goodId]) map[scopeId][goodId] = {};
    map[scopeId][goodId][partnerId] = round3((map[scopeId][goodId][partnerId] ?? 0) + value);
  };
  const getScopeGoodTradeTotal = (
    map: Record<string, Record<string, Record<string, number>>>,
    scopeId: string,
    goodId: string,
  ): number => {
    const byPartner = map[scopeId]?.[goodId] ?? {};
    return round3(
      Object.values(byPartner).reduce((sum, value) => sum + Math.max(0, Number(value ?? 0)), 0),
    );
  };
  const pushHistory = (map: Record<string, number[]>, key: string, value: number): void => {
    const prev = map[key] ?? [];
    map[key] = [...prev, round3(value)].slice(-MARKET_PRICE_HISTORY_LENGTH);
  };

  for (const [provinceId, instances] of Object.entries(worldBase.provinceBuildingsByProvince)) {
    const ownerCountryId = worldBase.provinceOwner[provinceId];
    if (!ownerCountryId) continue;
    const marketId = getMarketIdByCountry(ownerCountryId);
    for (const instance of instances ?? []) {
      const building = buildingById.get(instance.buildingId);
      if (!building) continue;
      for (const [categoryId, amountRaw] of Object.entries(building.marketInfrastructureByCategory ?? {})) {
        const amount = round3(Math.max(0, Number(amountRaw)));
        if (amount <= 0) continue;
        addCategoryAmount(remainingSharedInfrastructureByMarketIdAndCategory, marketId, categoryId, amount);
      }
    }
  }

  // Pass 1: normalize instances and index all sellers before any purchases.
  // This lets buildings buy from the full market scope (province/country/market/global)
  // instead of only provinces that were processed earlier in the same turn.
  for (const province of adm1ProvinceIndex) {
    const provinceId = province.id;
    const ownerCountryId = worldBase.provinceOwner[provinceId];
    if (!ownerCountryId) continue;
    const marketId = getMarketIdByCountry(ownerCountryId);
    const buildingInstances = [...(worldBase.provinceBuildingsByProvince[provinceId] ?? [])].sort((a, b) =>
      a.instanceId.localeCompare(b.instanceId),
    );
    for (const instance of buildingInstances) {
      const building = buildingById.get(instance.buildingId);
      if (!building) continue;
      const sellableGoodIds = new Set((building.outputs ?? []).map((row) => row.goodId).filter(Boolean));
      instance.ducats = round3(Math.max(0, Number(instance.ducats ?? 0)));
      instance.warehouseByGoodId = { ...(instance.warehouseByGoodId ?? {}) };
      instance.lastPurchaseByGoodId = {};
      instance.lastPurchaseCostByGoodId = {};
      instance.lastSalesByGoodId = {};
      instance.lastSalesRevenueByGoodId = {};
      instance.lastConsumptionByGoodId = {};
      instance.lastProductionByGoodId = {};
      instance.lastLaborCoverage = 0;
      instance.lastInfraCoverage = 0;
      instance.lastInputCoverage = 0;
      instance.lastFinanceCoverage = 0;
      instance.lastProductivity = 0;
      instance.lastRevenueDucats = 0;
      instance.lastInputCostDucats = 0;
      instance.lastWagesDucats = 0;
      instance.lastNetDucats = 0;
      instance.isInactive = false;
      instance.inactiveReason = null;
      for (const [goodId, amountRaw] of Object.entries(instance.warehouseByGoodId ?? {})) {
        if (!sellableGoodIds.has(goodId)) continue;
        const amount = round3(Math.max(0, Number(amountRaw)));
        if (amount <= 0) continue;
        const slot: SellerSlot = {
          provinceId,
          countryId: ownerCountryId,
          marketId,
          instanceId: instance.instanceId,
          instance,
        };
        const provinceKey = `${provinceId}:${goodId}`;
        const countryKey = `${ownerCountryId}:${goodId}`;
        const marketKey = `${marketId}:${goodId}`;
        const globalKey = goodId;
        const provinceList = sellersByProvinceGood.get(provinceKey) ?? [];
        provinceList.push(slot);
        sellersByProvinceGood.set(provinceKey, provinceList);
        const countryList = sellersByCountryGood.get(countryKey) ?? [];
        countryList.push(slot);
        sellersByCountryGood.set(countryKey, countryList);
        const marketList = sellersByMarketGood.get(marketKey) ?? [];
        marketList.push(slot);
        sellersByMarketGood.set(marketKey, marketList);
        const globalList = sellersByGlobalGood.get(globalKey) ?? [];
        globalList.push(slot);
        sellersByGlobalGood.set(globalKey, globalList);
        addCountryGood(marketVolumeByCountry, marketId, goodId, amount);
        addGlobalGood(marketVolumeGlobal, goodId, amount);
      }
    }
  }

  for (const province of adm1ProvinceIndex) {
    const provinceId = province.id;
    const ownerCountryId = worldBase.provinceOwner[provinceId];
    if (!ownerCountryId) continue;
    if (!alertsByCountry[ownerCountryId]) alertsByCountry[ownerCountryId] = [];

    const population = normalizeProvincePopulation(worldBase.provincePopulationByProvince[provinceId], provinceId, domains);
    const marketId = getMarketIdByCountry(ownerCountryId);
    const buildingInstances = [...(worldBase.provinceBuildingsByProvince[provinceId] ?? [])]
      .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
    if (buildingInstances.length === 0) continue;

    const demandByProfession: Record<string, number> = {};
    let totalWorkforceDemand = 0;
    for (const instance of buildingInstances) {
      const building = buildingById.get(instance.buildingId);
      if (!building) continue;
      for (const requirement of building.workforceRequirements ?? []) {
        const workersDemand = Math.max(0, requirement.workers);
        if (workersDemand <= 0) continue;
        demandByProfession[requirement.professionId] = (demandByProfession[requirement.professionId] ?? 0) + workersDemand;
        totalWorkforceDemand += workersDemand;
      }
    }

    const laborCoverageProvince =
      totalWorkforceDemand > 0 ? round3(Math.max(0, Math.min(1, population.populationTotal / totalWorkforceDemand))) : 1;

    const availableByProfession: Record<string, number> = {};
    for (const [professionId, pct] of Object.entries(population.professionPct ?? {})) {
      availableByProfession[professionId] = (population.populationTotal * Math.max(0, Number(pct))) / 100;
    }
    const wageMultiplierByProfession: Record<string, number> = {};
    for (const [professionId, demand] of Object.entries(demandByProfession)) {
      const available = Math.max(1, availableByProfession[professionId] ?? 0);
      const shortageRatio = demand / available;
      const multiplier = shortageRatio > 1 ? 1 + (shortageRatio - 1) * 0.5 : 1;
      wageMultiplierByProfession[professionId] = round3(Math.max(0.5, Math.min(3, multiplier)));
    }
    let totalEmployed = 0;
    const employedByProfession: Record<string, number> = {};
    let provinceWages = 0;

    const getScopedSellerList = (scope: "province" | "country" | "market" | "global", goodId: string): SellerSlot[] => {
      if (scope === "province") return sellersByProvinceGood.get(`${provinceId}:${goodId}`) ?? [];
      if (scope === "country") return sellersByCountryGood.get(`${ownerCountryId}:${goodId}`) ?? [];
      if (scope === "market") return sellersByMarketGood.get(`${marketId}:${goodId}`) ?? [];
      return sellersByGlobalGood.get(goodId) ?? [];
    };

    for (const instance of buildingInstances) {
      const building = buildingById.get(instance.buildingId);
      if (!building) continue;
      const warehouse = instance.warehouseByGoodId ?? {};
      let wagesEstimate = 0;
      let workersDemand = 0;
      for (const requirement of building.workforceRequirements ?? []) {
        const baseWage = Math.max(0, Number(professionById.get(requirement.professionId)?.baseWage ?? BUILDING_BASE_WAGE_PER_WORKER_GOLD));
        const multiplier = wageMultiplierByProfession[requirement.professionId] ?? 1;
        const workers = Math.max(0, requirement.workers);
        wagesEstimate += workers * baseWage * multiplier;
        workersDemand += workers;
      }
      const laborCoverage = workersDemand > 0 ? laborCoverageProvince : 1;
      const employedWorkers = workersDemand * laborCoverage;
      totalEmployed += employedWorkers;
      for (const requirement of building.workforceRequirements ?? []) {
        const workers = Math.max(0, requirement.workers) * laborCoverage;
        employedByProfession[requirement.professionId] = round3((employedByProfession[requirement.professionId] ?? 0) + workers);
      }
      const infraCoverage = 1;

      let requiredInputValueEstimate = 0;
      for (const input of building.inputs ?? []) {
        const required = Math.max(0, input.amount) * laborCoverage * BUILDING_BASE_THROUGHPUT;
        const available = Math.max(0, Number(warehouse[input.goodId] ?? 0));
        const deficit = Math.max(0, required - available);
        const price = getCountryGoodPrice(ownerCountryId, input.goodId);
        requiredInputValueEstimate += deficit * price;
        addCountryGood(demandRequestedByCountry, marketId, input.goodId, deficit);
        addGlobalGood(demandRequestedGlobal, input.goodId, deficit);
      }
      const financeCoverage =
        wagesEstimate + requiredInputValueEstimate > 0
          ? round3(Math.max(0, Math.min(1, Number(instance.ducats ?? 0) / (wagesEstimate + requiredInputValueEstimate))))
          : 1;

      let purchaseCost = 0;
      const purchasedByGood: Record<string, number> = {};
      const purchasedCostByGood: Record<string, number> = {};
      for (const input of building.inputs ?? []) {
        const required = Math.max(0, input.amount) * laborCoverage * BUILDING_BASE_THROUGHPUT;
        const available = Math.max(0, Number(warehouse[input.goodId] ?? 0));
        let deficit = Math.max(0, required - available);
        if (deficit <= 0) continue;
        let remainingNeed = round3(deficit);
        if (remainingNeed <= 0) continue;
        type ScopeOption = { scope: "province" | "country" | "market" | "global"; unitPrice: number; list: SellerSlot[] };
        const options: ScopeOption[] = [
          { scope: "province", unitPrice: getCountryGoodPrice(ownerCountryId, input.goodId), list: getScopedSellerList("province", input.goodId) },
          { scope: "country", unitPrice: getCountryGoodPrice(ownerCountryId, input.goodId), list: getScopedSellerList("country", input.goodId) },
          { scope: "market", unitPrice: getCountryGoodPrice(ownerCountryId, input.goodId), list: getScopedSellerList("market", input.goodId) },
          { scope: "global", unitPrice: getGlobalGoodPrice(input.goodId), list: getScopedSellerList("global", input.goodId) },
        ];
        options.sort((a, b) => a.unitPrice - b.unitPrice);
        for (const option of options) {
          if (remainingNeed <= 0) break;
          if (option.unitPrice <= 0) continue;
          const affordable = Math.floor((Number(instance.ducats ?? 0) - purchaseCost) / option.unitPrice);
          if (affordable <= 0) continue;
          const sellerCandidates = [...option.list].sort((a, b) => {
            const score = (slot: SellerSlot): number => {
              if (slot.countryId === ownerCountryId) return 0;
              if (slot.marketId === marketId) return 1;
              return 2;
            };
            return score(a) - score(b) || a.instanceId.localeCompare(b.instanceId);
          });
          for (const seller of sellerCandidates) {
            if (remainingNeed <= 0) break;
            if (seller.instanceId === instance.instanceId) continue;
            const sellerWarehouse = seller.instance.warehouseByGoodId ?? {};
            const sellerAvailable = Math.max(0, Number(sellerWarehouse[input.goodId] ?? 0));
            if (sellerAvailable <= 0) continue;
            const soldKey = getSellerUsageKey(seller.instanceId, input.goodId);
            const soldAlready = soldBySellerAndGood.get(soldKey) ?? 0;
            const transferCap = Math.max(0, sellerAvailable - soldAlready);
            if (transferCap <= 0) continue;
            const maxAffordableNow = Math.floor((Number(instance.ducats ?? 0) - purchaseCost) / option.unitPrice);
            if (maxAffordableNow <= 0) break;
            const isExternalTrade = seller.marketId !== marketId;
            const isCrossCountryTrade = seller.countryId !== ownerCountryId;
            let applicableCapSanctions: ActiveTradeSanction[] = [];
            let maxBySanctions = Number.POSITIVE_INFINITY;
            if (isCrossCountryTrade) {
              const buyerSideSanctions = collectTradeSanctions({
                initiatorCountryId: ownerCountryId,
                direction: "import",
                targetCountryId: seller.countryId,
                targetMarketId: seller.marketId,
                goodId: input.goodId,
              });
              const sellerSideSanctions = collectTradeSanctions({
                initiatorCountryId: seller.countryId,
                direction: "export",
                targetCountryId: ownerCountryId,
                targetMarketId: marketId,
                goodId: input.goodId,
              });
              const allSanctions = [...buyerSideSanctions, ...sellerSideSanctions];
              if (allSanctions.some((sanction) => sanction.mode === "ban")) {
                continue;
              }
              applicableCapSanctions = allSanctions.filter((sanction) => sanction.mode === "cap");
              for (const sanction of applicableCapSanctions) {
                const cap = Math.max(0, Number(sanction.capAmountPerTurn ?? 0));
                const used = Math.max(0, Number(sanctionUsedAmountById[sanction.id] ?? 0));
                const remaining = round3(Math.max(0, cap - used));
                maxBySanctions = Math.min(maxBySanctions, remaining);
              }
              if (maxBySanctions <= 0) continue;
            }
            let maxByPolicy = Number.POSITIVE_INFINITY;
            let buyerPolicyScope = "all";
            let sellerPolicyScope = "all";
            if (isExternalTrade) {
              const buyerMarket = getMarketById(marketId);
              const sellerMarket = getMarketById(seller.marketId);
              const buyerPolicy = resolveTradePolicyLayer(
                buyerMarket?.worldTradePolicyByResourceId?.[input.goodId],
                seller.marketId,
                seller.countryId,
              );
              const sellerPolicy = resolveTradePolicyLayer(
                sellerMarket?.worldTradePolicyByResourceId?.[input.goodId],
                marketId,
                ownerCountryId,
              );
              if (!buyerPolicy.allowImportFromWorld || !sellerPolicy.allowExportToWorld) {
                continue;
              }
              buyerPolicyScope = buyerPolicy.scopeImport;
              sellerPolicyScope = sellerPolicy.scopeExport;
              const buyerRemainingByPolicy = getRemainingByPolicyLimit(
                marketId,
                input.goodId,
                "import",
                buyerPolicy.scopeImport,
                buyerPolicy.maxImportAmountPerTurnFromWorld,
              );
              const sellerRemainingByPolicy = getRemainingByPolicyLimit(
                seller.marketId,
                input.goodId,
                "export",
                sellerPolicy.scopeExport,
                sellerPolicy.maxExportAmountPerTurnToWorld,
              );
              maxByPolicy = Math.floor(Math.min(buyerRemainingByPolicy, sellerRemainingByPolicy));
              if (maxByPolicy <= 0) continue;
            }

            let maxByInfra = Number.POSITIVE_INFINITY;
            const categoryId = getResourceCategoryId(input.goodId);
            if (categoryId) {
              const infraPerUnit = getInfraPerUnit(input.goodId);
              const buyerLocal = getProvinceInfraRemaining(provinceId, categoryId);
              const sellerLocal = getProvinceInfraRemaining(seller.provinceId, categoryId);
              if (isExternalTrade) {
                const buyerShared = getSharedInfraRemaining(marketId, categoryId);
                const sellerShared = getSharedInfraRemaining(seller.marketId, categoryId);
                maxByInfra = Math.floor(Math.min(buyerLocal, sellerLocal, buyerShared, sellerShared) / infraPerUnit);
              } else if (provinceId === seller.provinceId) {
                maxByInfra = Math.floor(buyerLocal / (infraPerUnit * 2));
              } else {
                maxByInfra = Math.floor(Math.min(buyerLocal, sellerLocal) / infraPerUnit);
              }
              if (maxByInfra <= 0) {
                if (getProvinceInfraRemaining(provinceId, categoryId) <= 0) {
                  remainingNeed = 0;
                  break;
                }
                continue;
              }
            }

            const transfer = round3(
              Math.min(remainingNeed, transferCap, maxAffordableNow, maxByInfra, maxByPolicy, maxBySanctions),
            );
            if (transfer <= 0) continue;
            remainingNeed = round3(Math.max(0, remainingNeed - transfer));
            const transferCost = round3(transfer * option.unitPrice);
            if (seller.countryId !== ownerCountryId) {
              addScopeGoodPartnerAmount(
                importsByCountryByCountryAndGood,
                ownerCountryId,
                input.goodId,
                seller.countryId,
                transfer,
              );
              addScopeGoodPartnerAmount(
                exportsByCountryByCountryAndGood,
                seller.countryId,
                input.goodId,
                ownerCountryId,
                transfer,
              );
            }
            if (isExternalTrade) {
              addScopeGoodPartnerAmount(
                importsByMarketByMarketAndGood,
                marketId,
                input.goodId,
                seller.marketId,
                transfer,
              );
              addScopeGoodPartnerAmount(
                exportsByMarketByMarketAndGood,
                seller.marketId,
                input.goodId,
                marketId,
                transfer,
              );
            }
            if (categoryId) {
              const infraConsumed = round3(transfer * getInfraPerUnit(input.goodId));
              consumeProvinceInfra(provinceId, categoryId, infraConsumed);
              consumeProvinceInfra(seller.provinceId, categoryId, infraConsumed);
              if (isExternalTrade) {
                consumeSharedInfra(marketId, categoryId, infraConsumed);
                consumeSharedInfra(seller.marketId, categoryId, infraConsumed);
              }
            }
            if (isExternalTrade) {
              consumePolicyLimit(marketId, input.goodId, "import", buyerPolicyScope, transfer);
              consumePolicyLimit(seller.marketId, input.goodId, "export", sellerPolicyScope, transfer);
            }
            for (const sanction of applicableCapSanctions) {
              sanctionUsedAmountById[sanction.id] = round3(
                Math.max(0, Number(sanctionUsedAmountById[sanction.id] ?? 0)) + transfer,
              );
            }
            purchaseCost = round3(purchaseCost + transferCost);
            purchasedByGood[input.goodId] = round3((purchasedByGood[input.goodId] ?? 0) + transfer);
            purchasedCostByGood[input.goodId] = round3((purchasedCostByGood[input.goodId] ?? 0) + transferCost);
            sellerWarehouse[input.goodId] = round3(Math.max(0, sellerAvailable - transfer));
            seller.instance.warehouseByGoodId = sellerWarehouse;
            const revenueDelta = transferCost;
            seller.instance.ducats = round3(Math.max(0, Number(seller.instance.ducats ?? 0)) + revenueDelta);
            seller.instance.lastRevenueDucats = round3(Math.max(0, Number(seller.instance.lastRevenueDucats ?? 0)) + revenueDelta);
            const sellerSales = seller.instance.lastSalesByGoodId ?? {};
            sellerSales[input.goodId] = round3(Math.max(0, Number(sellerSales[input.goodId] ?? 0)) + transfer);
            seller.instance.lastSalesByGoodId = sellerSales;
            const sellerSalesRevenue = seller.instance.lastSalesRevenueByGoodId ?? {};
            sellerSalesRevenue[input.goodId] = round3(
              Math.max(0, Number(sellerSalesRevenue[input.goodId] ?? 0)) + revenueDelta,
            );
            seller.instance.lastSalesRevenueByGoodId = sellerSalesRevenue;
            soldBySellerAndGood.set(soldKey, round3(soldAlready + transfer));
          }
        }
      }

      for (const [goodId, amount] of Object.entries(purchasedByGood)) {
        warehouse[goodId] = round3(Math.max(0, Number(warehouse[goodId] ?? 0)) + amount);
      }
      instance.lastPurchaseByGoodId = purchasedByGood;
      instance.lastPurchaseCostByGoodId = purchasedCostByGood;
      instance.lastInputCostDucats = round3(purchaseCost);

      let inputCoverage = 1;
      const missingInputGoods: string[] = [];
      for (const input of building.inputs ?? []) {
        const required = Math.max(0, input.amount) * laborCoverage * BUILDING_BASE_THROUGHPUT;
        if (required <= 0) continue;
        const available = Math.max(0, Number(warehouse[input.goodId] ?? 0));
        inputCoverage = Math.min(inputCoverage, available / required);
        if (available + 1e-9 < required) {
          const goodName = goodById.get(input.goodId)?.name?.trim() || input.goodId;
          if (!missingInputGoods.includes(goodName)) {
            missingInputGoods.push(goodName);
          }
        }
      }
      if (!Number.isFinite(inputCoverage)) inputCoverage = 1;
      inputCoverage = round3(Math.max(0, Math.min(1, inputCoverage)));
      const productivity = round3(Math.max(0, Math.min(1, Math.min(laborCoverage, infraCoverage, inputCoverage, financeCoverage))));
      instance.lastLaborCoverage = laborCoverage;
      instance.lastInfraCoverage = infraCoverage;
      instance.lastInputCoverage = inputCoverage;
      instance.lastFinanceCoverage = financeCoverage;
      instance.lastProductivity = productivity;

      const consumedByGood: Record<string, number> = {};
      for (const input of building.inputs ?? []) {
        const required = Math.max(0, input.amount) * laborCoverage * BUILDING_BASE_THROUGHPUT;
        const consumed = round3(required * productivity);
        if (consumed <= 0) continue;
        const before = Math.max(0, Number(warehouse[input.goodId] ?? 0));
        const next = round3(Math.max(0, before - consumed));
        warehouse[input.goodId] = next;
        consumedByGood[input.goodId] = consumed;
      }
      instance.lastConsumptionByGoodId = consumedByGood;

      const producedByGood: Record<string, number> = {};
      for (const output of building.outputs ?? []) {
        const producedMax = round3(Math.max(0, output.amount) * laborCoverage * BUILDING_BASE_THROUGHPUT);
        if (producedMax > 0) {
          addCountryGood(productionMaxByCountry, marketId, output.goodId, producedMax);
          addGlobalGood(productionMaxGlobal, output.goodId, producedMax);
        }
        const produced = round3(Math.max(0, output.amount) * productivity * BUILDING_BASE_THROUGHPUT);
        if (produced <= 0) continue;
        warehouse[output.goodId] = round3(Math.max(0, Number(warehouse[output.goodId] ?? 0)) + produced);
        producedByGood[output.goodId] = produced;
        addCountryGood(productionByCountry, marketId, output.goodId, produced);
        addGlobalGood(productionGlobal, output.goodId, produced);
      }
      instance.lastProductionByGoodId = producedByGood;
      const realizedRevenue = round3(Math.max(0, Number(instance.lastRevenueDucats ?? 0)));
      instance.lastRevenueDucats = realizedRevenue;
      instance.ducats = round3(Math.max(0, Number(instance.ducats ?? 0) - purchaseCost));

      const wagesActual = round3(wagesEstimate * productivity);
      provinceWages = round3(provinceWages + wagesActual);
      instance.lastWagesDucats = wagesActual;
      const paidWages = Math.min(Number(instance.ducats ?? 0), wagesActual);
      instance.ducats = round3(Math.max(0, Number(instance.ducats ?? 0) - paidWages));
      const unpaidWages = round3(Math.max(0, wagesActual - paidWages));
      const net = round3(realizedRevenue - purchaseCost - wagesActual);
      instance.lastNetDucats = net;
      if (productivity <= 0) {
        instance.isInactive = true;
        const buildingLabel = building.name?.trim() || instance.buildingId;
        const coverages: Array<{ key: "labor" | "input" | "infra" | "finance"; value: number }> = [
          { key: "labor", value: laborCoverage },
          { key: "input", value: inputCoverage },
          { key: "infra", value: infraCoverage },
          { key: "finance", value: financeCoverage },
        ];
        coverages.sort((a, b) => a.value - b.value);
        const limiting = coverages[0];
        const label =
          limiting.key === "labor"
            ? "труда"
            : limiting.key === "input"
              ? "входных товаров"
              : limiting.key === "infra"
                ? "инфраструктуры"
                : "финансов";
        const missingInputsText =
          limiting.key === "input" && missingInputGoods.length > 0
            ? `; не хватает: ${missingInputGoods.slice(0, 4).join(", ")}${missingInputGoods.length > 4 ? "..." : ""}`
            : "";
        instance.inactiveReason = `Нулевая продуктивность (лимит: ${label}, ${(limiting.value * 100).toFixed(1)}%${missingInputsText})`;
        pushCountryAlert(ownerCountryId, {
          severity: "critical",
          kind: "building-inactive",
          message: `Здание ${buildingLabel} неактивно: ${instance.inactiveReason}`,
          provinceId,
          buildingId: instance.buildingId,
          instanceId: instance.instanceId,
        });
      } else if (unpaidWages > 0) {
        instance.isInactive = true;
        const buildingLabel = building.name?.trim() || instance.buildingId;
        instance.inactiveReason = "Недостаточно дукатов для покрытия расходов";
        pushCountryAlert(ownerCountryId, {
          severity: "critical",
          kind: "building-inactive",
          message: `Здание ${buildingLabel} неактивно: ${instance.inactiveReason}`,
          provinceId,
          buildingId: instance.buildingId,
          instanceId: instance.instanceId,
        });
      } else {
        instance.isInactive = false;
        instance.inactiveReason = null;
      }
      instance.warehouseByGoodId = Object.fromEntries(
        Object.entries(warehouse)
          .map(([goodId, amount]) => [goodId, round3(Math.max(0, Number(amount)))])
          .filter(([, amount]) => Number(amount) > 0),
      );
    }

    for (const instance of buildingInstances) {
      instance.lastNetDucats = round3(
        Number(instance.lastRevenueDucats ?? 0) -
          Number(instance.lastInputCostDucats ?? 0) -
          Number(instance.lastWagesDucats ?? 0),
      );
    }

    if (totalEmployed > 0) {
      nextProfessionPctByProvince[provinceId] = normalizePercentageMap(
        employedByProfession,
        domains.professionPct,
        POPULATION_FALLBACK_KEY_BY_DIMENSION.professionPct,
      );
    }

    const prevTreasury = worldBase.provincePopulationTreasuryByProvince[provinceId] ?? 0;
    worldBase.provincePopulationTreasuryByProvince[provinceId] = round3(prevTreasury + provinceWages);
    const byBuildingDucats: Record<string, number> = {};
    for (const instance of buildingInstances) {
      byBuildingDucats[instance.buildingId] = round3((byBuildingDucats[instance.buildingId] ?? 0) + Number(instance.ducats ?? 0));
    }
    worldBase.provinceBuildingDucatsByProvince[provinceId] = byBuildingDucats;
    worldBase.provinceBuildingsByProvince[provinceId] = buildingInstances;
  }

  const marketIds = new Set<string>([
    ...Object.keys(gameSettings.markets.marketById ?? {}),
    ...Object.keys(worldBase.resourcesByCountry).map((countryId) => getCountryMarketId(countryId)),
  ]);
  for (const marketId of marketIds) {
    if (!countryGoodPrices[marketId]) countryGoodPrices[marketId] = {};
    const keys = new Set<string>([
      ...Object.keys(demandRequestedByCountry[marketId] ?? {}),
      ...Object.keys(productionByCountry[marketId] ?? {}),
      ...Object.keys(marketVolumeByCountry[marketId] ?? {}),
      ...Object.keys(countryGoodPrices[marketId] ?? {}),
      ...gameSettings.content.goods.map((g) => g.id),
    ]);
    const marketRecord = getMarketById(marketId) ?? createDefaultMarketRecord(marketId, marketId);
    if (!gameSettings.markets.marketById[marketId]) {
      gameSettings.markets.marketById[marketId] = marketRecord;
    }
    marketRecord.priceByResourceId ??= {};
    marketRecord.warehouseByResourceId ??= {};
    marketRecord.priceHistoryByResourceId ??= {};
    marketRecord.demandHistoryByResourceId ??= {};
    marketRecord.offerHistoryByResourceId ??= {};
    marketRecord.productionFactHistoryByResourceId ??= {};
    marketRecord.productionMaxHistoryByResourceId ??= {};
    for (const goodId of keys) {
      const current = getCountryGoodPrice(marketId, goodId);
      const demand = Number(demandRequestedByCountry[marketId]?.[goodId] ?? 0);
      const offerFact = Number(productionByCountry[marketId]?.[goodId] ?? 0);
      const marketVolume = Number(marketVolumeByCountry[marketId]?.[goodId] ?? 0);
      const importsTotal = getScopeGoodTradeTotal(importsByMarketByMarketAndGood, marketId, goodId);
      const exportsTotal = getScopeGoodTradeTotal(exportsByMarketByMarketAndGood, marketId, goodId);
      const netTrade = round3(importsTotal - exportsTotal);
      const offer = Math.max(0, round3(offerFact + marketVolume + netTrade));
      const adjustedWarehouse = Math.max(0, round3(marketVolume + netTrade));
      const nextPrice = updatePrice(current, demand, offer, getPriceMeta(goodId));
      countryGoodPrices[marketId][goodId] = nextPrice;
      marketRecord.priceByResourceId[goodId] = nextPrice;
      marketRecord.warehouseByResourceId[goodId] = adjustedWarehouse;
      pushHistory(marketRecord.priceHistoryByResourceId, goodId, nextPrice);
      pushHistory(marketRecord.demandHistoryByResourceId, goodId, demand);
      pushHistory(marketRecord.offerHistoryByResourceId, goodId, offer);
      pushHistory(marketRecord.productionFactHistoryByResourceId, goodId, offerFact);
      pushHistory(
        marketRecord.productionMaxHistoryByResourceId,
        goodId,
        Number(productionMaxByCountry[marketId]?.[goodId] ?? 0),
      );
    }
  }
  {
    const keys = new Set<string>([
      ...Object.keys(demandRequestedGlobal),
      ...Object.keys(productionGlobal),
      ...Object.keys(productionMaxGlobal),
      ...Object.keys(marketVolumeGlobal),
      ...Object.keys(globalGoodPrices),
      ...gameSettings.content.goods.map((g) => g.id),
    ]);
    for (const goodId of keys) {
      const current = getGlobalGoodPrice(goodId);
      const demand = Number(demandRequestedGlobal[goodId] ?? 0);
      const offerFact = Number(productionGlobal[goodId] ?? 0);
      const marketVolume = Number(marketVolumeGlobal[goodId] ?? 0);
      const offer = offerFact + marketVolume;
      const nextPrice = updatePrice(current, demand, offer, getPriceMeta(goodId));
      globalGoodPrices[goodId] = nextPrice;
      pushHistory(globalGoodPriceHistoryByResourceId, goodId, nextPrice);
      pushHistory(globalGoodDemandHistoryByResourceId, goodId, demand);
      pushHistory(globalGoodOfferHistoryByResourceId, goodId, offer);
      pushHistory(globalGoodProductionFactHistoryByResourceId, goodId, offerFact);
      pushHistory(globalGoodProductionMaxHistoryByResourceId, goodId, Number(productionMaxGlobal[goodId] ?? 0));
    }
  }

  for (const countryId of Object.keys(worldBase.resourcesByCountry)) {
    const marketId = getCountryMarketId(countryId);
    const demand = demandRequestedByCountry[marketId] ?? {};
    const offerProduced = productionByCountry[marketId] ?? {};
    const offerStock = marketVolumeByCountry[marketId] ?? {};
    for (const goodId of Object.keys(demand)) {
      const d = Number(demand[goodId] ?? 0);
      if (d <= 0) continue;
      const importsTotal = getScopeGoodTradeTotal(importsByMarketByMarketAndGood, marketId, goodId);
      const exportsTotal = getScopeGoodTradeTotal(exportsByMarketByMarketAndGood, marketId, goodId);
      const netTrade = round3(importsTotal - exportsTotal);
      const o = Math.max(0, Number(offerProduced[goodId] ?? 0) + Number(offerStock[goodId] ?? 0) + netTrade);
      const coverage = d > 0 ? o / d : 1;
      if (coverage < 0.5) {
        pushCountryAlert(countryId, {
          severity: "critical",
          kind: "critical-deficit",
          message: `Критический дефицит ${goodId}: покрытие ${(coverage * 100).toFixed(1)}%`,
          goodId,
        });
      }
    }
  }
  const offerByCountry: Record<string, Record<string, number>> = {};
  for (const countryId of marketIds) {
    const keys = new Set<string>([
      ...Object.keys(productionByCountry[countryId] ?? {}),
      ...Object.keys(marketVolumeByCountry[countryId] ?? {}),
    ]);
    offerByCountry[countryId] = {};
    for (const goodId of keys) {
      const produced = Number(productionByCountry[countryId]?.[goodId] ?? 0);
      const stock = Number(marketVolumeByCountry[countryId]?.[goodId] ?? 0);
      const importsTotal = getScopeGoodTradeTotal(importsByMarketByMarketAndGood, countryId, goodId);
      const exportsTotal = getScopeGoodTradeTotal(exportsByMarketByMarketAndGood, countryId, goodId);
      const netTrade = round3(importsTotal - exportsTotal);
      offerByCountry[countryId][goodId] = round3(Math.max(0, produced + stock + netTrade));
    }
  }
  const offerGlobal: Record<string, number> = {};
  for (const goodId of new Set<string>([...Object.keys(productionGlobal), ...Object.keys(marketVolumeGlobal)])) {
    const produced = Number(productionGlobal[goodId] ?? 0);
    const stock = Number(marketVolumeGlobal[goodId] ?? 0);
    offerGlobal[goodId] = round3(produced + stock);
  }
  for (const province of adm1ProvinceIndex) {
    const provinceId = province.id;
    const capacity = getProvinceInfrastructureFallbackCapacity(provinceId);
    const consumed = round3(
      Object.values(infraConsumedByProvinceAndCategory[provinceId] ?? {}).reduce(
        (sum, value) => sum + Math.max(0, Number(value)),
        0,
      ),
    );
    const remaining = round3(Math.max(0, capacity - consumed));
    const coverage = capacity > 0 ? round3(Math.max(0, Math.min(1, remaining / capacity))) : 1;
    infraByProvince[provinceId] = {
      capacity,
      required: consumed,
      coverage,
    };
    if (consumed > 0 && remaining <= 0) {
      const ownerCountryId = worldBase.provinceOwner[provinceId];
      if (ownerCountryId) {
        pushCountryAlert(ownerCountryId, {
          severity: "warning",
          kind: "infra-overload",
          message: `Инфраструктура в провинции ${provinceId} исчерпана в этом ходу`,
          provinceId,
        });
      }
    }
  }
  {
    const anyWorldBase = worldBase as WorldBase & {
      provinceLastLogisticsConsumedByCategoryByProvince?: Record<string, Record<string, number>>;
      provinceLastLogisticsCapacityByCategoryByProvince?: Record<string, Record<string, number>>;
    };
    anyWorldBase.provinceLastLogisticsConsumedByCategoryByProvince = Object.fromEntries(
      adm1ProvinceIndex.map((province) => [
        province.id,
        normalizeCategoryAmountMap(infraConsumedByProvinceAndCategory[province.id] ?? {}),
      ]),
    );
    anyWorldBase.provinceLastLogisticsCapacityByCategoryByProvince = Object.fromEntries(
      adm1ProvinceIndex.map((province) => {
        const provinceId = province.id;
        const categories = new Set<string>([
          ...Object.keys(infraConsumedByProvinceAndCategory[provinceId] ?? {}),
          ...Object.keys(infraRemainingByProvinceAndCategory[provinceId] ?? {}),
        ]);
        const capacityByCategory: Record<string, number> = {};
        for (const categoryId of categories) {
          const consumed = Number(infraConsumedByProvinceAndCategory[provinceId]?.[categoryId] ?? 0);
          const remaining = Number(infraRemainingByProvinceAndCategory[provinceId]?.[categoryId] ?? 0);
          const capacity = round3(Math.max(0, consumed + remaining));
          if (capacity > 0) capacityByCategory[categoryId] = capacity;
        }
        return [provinceId, capacityByCategory];
      }),
    );
  }
  for (const marketId of marketIds) {
    const market = getMarketById(marketId);
    if (!market) continue;
    const capacityByCategory: Record<string, number> = {};
    for (const categoryId of new Set<string>([
      ...Object.keys(consumedSharedInfrastructureByMarketIdAndCategory[marketId] ?? {}),
      ...Object.keys(remainingSharedInfrastructureByMarketIdAndCategory[marketId] ?? {}),
    ])) {
      const consumed = Number(consumedSharedInfrastructureByMarketIdAndCategory[marketId]?.[categoryId] ?? 0);
      const remaining = Number(remainingSharedInfrastructureByMarketIdAndCategory[marketId]?.[categoryId] ?? 0);
      const capacity = round3(Math.max(0, consumed + remaining));
      if (capacity > 0) capacityByCategory[categoryId] = capacity;
    }
    market.lastSharedInfrastructureCapacityByCategory = capacityByCategory;
    market.lastSharedInfrastructureConsumedByCategory = normalizeCategoryAmountMap(
      consumedSharedInfrastructureByMarketIdAndCategory[marketId] ?? {},
    );
  }
  latestMarketOverview = {
    turnId,
    demandByCountry: structuredClone(demandRequestedByCountry),
    offerByCountry,
    demandGlobal: structuredClone(demandRequestedGlobal),
    offerGlobal,
    infraByProvince,
    alertsByCountry,
    importsByCountryByCountryAndGood,
    exportsByCountryByCountryAndGood,
    importsByMarketByMarketAndGood,
    exportsByMarketByMarketAndGood,
  };
  previousTradeInfraLoadByProvince = Object.fromEntries(
    adm1ProvinceIndex.map((province) => [
      province.id,
      round3(
        Object.values(infraConsumedByProvinceAndCategory[province.id] ?? {}).reduce(
          (sum, value) => sum + Math.max(0, Number(value)),
          0,
        ),
      ),
    ]),
  );

  return nextProfessionPctByProvince;
}

function resolvePopulationTurn(): void {
  const domains = getPopulationDomainKeys();
  const professionByProvince = resolveBuildingsTurn();
  for (const province of adm1ProvinceIndex) {
    const provinceId = province.id;
    const currentPopulation = normalizeProvincePopulation(
      worldBase.provincePopulationByProvince[provinceId],
      provinceId,
      domains,
    );
    const nextPopulation = resolvePopulationTurnForProvince(currentPopulation, professionByProvince[provinceId]);
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

const persistedContentLibraryPath = resolve(__dirname, "../data/content-library.json");
type PersistedContentLibrary = {
  content?: unknown;
  civilopedia?: {
    categories?: unknown;
    entries?: unknown;
  };
  map?: {
    backgroundImageUrl?: unknown;
  };
  resourceIcons?: Partial<Record<keyof GameSettings["resourceIcons"], unknown>>;
};

let cachedPersistedContentLibrary: PersistedContentLibrary | null | undefined;

function getPersistedContentLibraryFromDisk(): PersistedContentLibrary | null {
  if (cachedPersistedContentLibrary !== undefined) {
    return cachedPersistedContentLibrary;
  }
  if (!existsSync(persistedContentLibraryPath)) {
    cachedPersistedContentLibrary = null;
    return null;
  }
  try {
    const raw = readFileSync(persistedContentLibraryPath, "utf8");
    const parsed = JSON.parse(raw) as PersistedContentLibrary;
    cachedPersistedContentLibrary = parsed && typeof parsed === "object" ? parsed : null;
    return cachedPersistedContentLibrary;
  } catch (error) {
    console.error("[content-library] Failed to read content-library.json:", error);
    cachedPersistedContentLibrary = null;
    return null;
  }
}

function persistContentLibraryFromSettings(): void {
  const snapshot = {
    content: gameSettings.content,
    civilopedia: gameSettings.civilopedia,
    map: {
      backgroundImageUrl: gameSettings.map.backgroundImageUrl,
    },
    resourceIcons: gameSettings.resourceIcons,
    updatedAt: new Date().toISOString(),
  };
  try {
    writeFileSync(persistedContentLibraryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    cachedPersistedContentLibrary = snapshot;
  } catch (error) {
    console.error("[content-library] Failed to persist content-library.json:", error);
  }
}

const defaultGameSettings = (): GameSettings => {
  const defaults: GameSettings = {
    content: {
      races: [],
      resourceCategories: [],
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
      baseConstructionPerTurn: 5,
      baseDucatsPerTurn: 5,
      baseGoldPerTurn: 10,
      demolitionCostConstructionPercent: 20,
      marketPriceSmoothing: 0.2,
      explorationBaseEmptyChancePct: DEFAULT_EXPLORATION_EMPTY_CHANCE_PCT,
      explorationDepletionPerAttemptPct: DEFAULT_EXPLORATION_DEPLETION_PER_ATTEMPT_PCT,
      explorationDurationTurns: DEFAULT_EXPLORATION_DURATION_TURNS,
      explorationRollsPerExpedition: DEFAULT_EXPLORATION_ROLLS_PER_EXPEDITION,
    },
    markets: {
      countryMarketByCountryId: {},
      marketById: {},
      marketInvitesById: {},
      sanctionsById: {},
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
      pauseWhenNoPlayersOnline: false,
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
      construction: null,
      ducats: null,
      gold: null,
    },
  };

  const library = getPersistedContentLibraryFromDisk();
  if (!library) {
    return defaults;
  }

  const civilopediaEntries = normalizeCivilopediaEntries(library.civilopedia?.entries);
  return {
    ...defaults,
    content: {
      races: normalizeContentRaces((library.content as { races?: unknown } | undefined)?.races),
      resourceCategories: normalizeContentCultures(
        (library.content as { resourceCategories?: unknown } | undefined)?.resourceCategories,
      ),
      professions: normalizeContentCultures((library.content as { professions?: unknown } | undefined)?.professions),
      ideologies: normalizeContentCultures((library.content as { ideologies?: unknown } | undefined)?.ideologies),
      religions: normalizeContentCultures((library.content as { religions?: unknown } | undefined)?.religions),
      technologies: normalizeContentCultures((library.content as { technologies?: unknown } | undefined)?.technologies),
      buildings: normalizeContentBuildings((library.content as { buildings?: unknown } | undefined)?.buildings),
      goods: normalizeContentGoods((library.content as { goods?: unknown } | undefined)?.goods),
      companies: normalizeContentCultures((library.content as { companies?: unknown } | undefined)?.companies),
      industries: normalizeContentCultures((library.content as { industries?: unknown } | undefined)?.industries),
      cultures: normalizeContentCultures((library.content as { cultures?: unknown } | undefined)?.cultures),
    },
    civilopedia: {
      categories: normalizeCivilopediaCategories(library.civilopedia?.categories, civilopediaEntries),
      entries: civilopediaEntries,
    },
    map: {
      ...defaults.map,
      backgroundImageUrl:
        typeof library.map?.backgroundImageUrl === "string" || library.map?.backgroundImageUrl === null
          ? (library.map.backgroundImageUrl ?? null)
          : defaults.map.backgroundImageUrl,
    },
    resourceIcons: {
      culture:
        typeof library.resourceIcons?.culture === "string" || library.resourceIcons?.culture === null
          ? (library.resourceIcons.culture ?? null)
          : defaults.resourceIcons.culture,
      science:
        typeof library.resourceIcons?.science === "string" || library.resourceIcons?.science === null
          ? (library.resourceIcons.science ?? null)
          : defaults.resourceIcons.science,
      religion:
        typeof library.resourceIcons?.religion === "string" || library.resourceIcons?.religion === null
          ? (library.resourceIcons.religion ?? null)
          : defaults.resourceIcons.religion,
      colonization:
        typeof library.resourceIcons?.colonization === "string" || library.resourceIcons?.colonization === null
          ? (library.resourceIcons.colonization ?? null)
          : defaults.resourceIcons.colonization,
      construction:
        typeof library.resourceIcons?.construction === "string" || library.resourceIcons?.construction === null
          ? (library.resourceIcons.construction ?? null)
          : defaults.resourceIcons.construction,
      ducats:
        typeof library.resourceIcons?.ducats === "string" || library.resourceIcons?.ducats === null
          ? (library.resourceIcons.ducats ?? null)
          : defaults.resourceIcons.ducats,
      gold:
        typeof library.resourceIcons?.gold === "string" || library.resourceIcons?.gold === null
          ? (library.resourceIcons.gold ?? null)
          : defaults.resourceIcons.gold,
    },
  };
};

function normalizeResourceTotals(input: unknown): ResourceTotals {
  const source = input && typeof input === "object" ? (input as Partial<ResourceTotals>) : {};
  return {
    culture: typeof source.culture === "number" && Number.isFinite(source.culture) ? Math.max(0, Math.floor(source.culture)) : 0,
    science: typeof source.science === "number" && Number.isFinite(source.science) ? Math.max(0, Math.floor(source.science)) : 0,
    religion: typeof source.religion === "number" && Number.isFinite(source.religion) ? Math.max(0, Math.floor(source.religion)) : 0,
    colonization:
      typeof source.colonization === "number" && Number.isFinite(source.colonization)
        ? Math.max(0, Math.floor(source.colonization))
        : gameSettings.colonization.pointsPerTurn,
    construction:
      typeof source.construction === "number" && Number.isFinite(source.construction)
        ? Math.max(0, Math.floor(source.construction))
        : gameSettings.economy.baseConstructionPerTurn,
    ducats: typeof source.ducats === "number" && Number.isFinite(source.ducats) ? Math.max(0, Math.floor(source.ducats)) : 0,
    gold: typeof source.gold === "number" && Number.isFinite(source.gold) ? Math.max(0, Math.floor(source.gold)) : 0,
  };
}

function normalizeResourcesByCountryMap(input: unknown): Record<string, ResourceTotals> {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const normalized: Record<string, ResourceTotals> = {};
  for (const [countryId, totals] of Object.entries(source)) {
    if (!countryId) continue;
    normalized[countryId] = normalizeResourceTotals(totals);
  }
  return normalized;
}

function defaultWorldBase(currentTurnId: number): WorldBase {
  const domains = getPopulationDomainKeys();
  const provincePopulationByProvince: Record<string, ProvincePopulation> = {};
  const provinceInfrastructureByProvince: Record<string, number> = {};
  const provinceBuildingsByProvince: Record<string, BuildingInstance[]> = {};
  const provinceBuildingDucatsByProvince: Record<string, Record<string, number>> = {};
  const provincePopulationTreasuryByProvince: Record<string, number> = {};
  const provinceConstructionQueueByProvince: Record<string, ProvinceConstructionProject[]> = {};
  const provinceResourceDepositsByProvince: Record<string, ProvinceResourceDeposit[]> = {};
  const provinceResourceExplorationQueueByProvince: Record<string, ProvinceResourceExplorationProject[]> = {};
  const provinceResourceExplorationCountByProvince: Record<string, number> = {};
  for (const province of adm1ProvinceIndex) {
    provincePopulationByProvince[province.id] = buildDefaultProvincePopulation(province.id, domains);
    provinceInfrastructureByProvince[province.id] = DEFAULT_PROVINCE_INFRASTRUCTURE_CAPACITY;
    provinceBuildingsByProvince[province.id] = [];
    provinceBuildingDucatsByProvince[province.id] = {};
    provincePopulationTreasuryByProvince[province.id] = 0;
    provinceConstructionQueueByProvince[province.id] = [];
    provinceResourceDepositsByProvince[province.id] = [];
    provinceResourceExplorationQueueByProvince[province.id] = [];
    provinceResourceExplorationCountByProvince[province.id] = 0;
  }
  return {
    turnId: currentTurnId,
    resourcesByCountry: {},
    provinceOwner: {},
    provinceNameById: {},
    colonyProgressByProvince: {},
    provinceColonizationByProvince: {},
    provinceInfrastructureByProvince,
    provincePopulationByProvince,
    provinceBuildingsByProvince,
    provinceBuildingDucatsByProvince,
    provincePopulationTreasuryByProvince,
    provinceConstructionQueueByProvince,
    provinceResourceDepositsByProvince,
    provinceResourceExplorationQueueByProvince,
    provinceResourceExplorationCountByProvince,
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
    marketOverview: unknown;
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
          resourceCategories: normalizeContentCultures((next as Partial<{ content?: { resourceCategories?: unknown } }>).content?.resourceCategories),
          professions: normalizeContentCultures((next as Partial<{ content?: { professions?: unknown } }>).content?.professions),
          ideologies: normalizeContentCultures((next as Partial<{ content?: { ideologies?: unknown } }>).content?.ideologies),
          religions: normalizeContentCultures((next as Partial<{ content?: { religions?: unknown } }>).content?.religions),
          technologies: normalizeContentCultures((next as Partial<{ content?: { technologies?: unknown } }>).content?.technologies),
          buildings: normalizeContentBuildings((next as Partial<{ content?: { buildings?: unknown } }>).content?.buildings),
          goods: normalizeContentGoods((next as Partial<{ content?: { goods?: unknown } }>).content?.goods),
          companies: normalizeContentCultures((next as Partial<{ content?: { companies?: unknown } }>).content?.companies),
          industries: normalizeContentCultures((next as Partial<{ content?: { industries?: unknown } }>).content?.industries),
          cultures: normalizeContentCultures((next as Partial<{ content?: { cultures?: unknown } }>).content?.cultures),
        },
      civilopedia: {
        categories: normalizeCivilopediaCategories((next as Partial<{ civilopedia?: { categories?: unknown } }>).civilopedia?.categories, civilopediaEntries),
        entries: civilopediaEntries,
      },
      economy: {
        baseConstructionPerTurn:
          typeof next.economy?.baseConstructionPerTurn === "number"
            ? Math.max(0, Math.floor(next.economy.baseConstructionPerTurn))
            : defaults.economy.baseConstructionPerTurn,
        baseDucatsPerTurn:
          typeof next.economy?.baseDucatsPerTurn === "number"
            ? Math.max(0, Math.floor(next.economy.baseDucatsPerTurn))
            : defaults.economy.baseDucatsPerTurn,
        baseGoldPerTurn:
          typeof next.economy?.baseGoldPerTurn === "number"
            ? Math.max(0, Math.floor(next.economy.baseGoldPerTurn))
            : defaults.economy.baseGoldPerTurn,
        demolitionCostConstructionPercent:
          typeof next.economy?.demolitionCostConstructionPercent === "number"
            ? Math.max(0, Math.min(100, Math.floor(next.economy.demolitionCostConstructionPercent)))
            : defaults.economy.demolitionCostConstructionPercent,
        marketPriceSmoothing:
          typeof next.economy?.marketPriceSmoothing === "number" && Number.isFinite(next.economy.marketPriceSmoothing)
            ? Math.max(0, Math.min(1, Number(next.economy.marketPriceSmoothing)))
            : defaults.economy.marketPriceSmoothing,
        explorationBaseEmptyChancePct:
          typeof next.economy?.explorationBaseEmptyChancePct === "number" &&
          Number.isFinite(next.economy.explorationBaseEmptyChancePct)
            ? Math.max(0, Math.min(100, Number(next.economy.explorationBaseEmptyChancePct)))
            : defaults.economy.explorationBaseEmptyChancePct,
        explorationDepletionPerAttemptPct:
          typeof next.economy?.explorationDepletionPerAttemptPct === "number" &&
          Number.isFinite(next.economy.explorationDepletionPerAttemptPct)
            ? Math.max(0, Math.min(100, Number(next.economy.explorationDepletionPerAttemptPct)))
            : defaults.economy.explorationDepletionPerAttemptPct,
        explorationDurationTurns:
          typeof next.economy?.explorationDurationTurns === "number" &&
          Number.isFinite(next.economy.explorationDurationTurns)
            ? Math.max(1, Math.floor(next.economy.explorationDurationTurns))
            : defaults.economy.explorationDurationTurns,
        explorationRollsPerExpedition:
          typeof next.economy?.explorationRollsPerExpedition === "number" &&
          Number.isFinite(next.economy.explorationRollsPerExpedition)
            ? Math.max(1, Math.floor(next.economy.explorationRollsPerExpedition))
            : defaults.economy.explorationRollsPerExpedition,
      },
      markets: {
        countryMarketByCountryId:
          next.markets && typeof next.markets === "object" && next.markets.countryMarketByCountryId && typeof next.markets.countryMarketByCountryId === "object"
            ? Object.fromEntries(
                Object.entries(next.markets.countryMarketByCountryId as Record<string, unknown>)
                  .map(([countryId, marketId]) => [countryId, normalizeMarketId(marketId)])
                  .filter((row): row is [string, string] => Boolean(row[0] && row[1])),
              )
            : { ...defaults.markets.countryMarketByCountryId },
        marketById:
          next.markets && typeof next.markets === "object" && next.markets.marketById && typeof next.markets.marketById === "object"
            ? Object.fromEntries(
                Object.entries(next.markets.marketById as Record<string, unknown>).map(([marketId, raw]) => {
                  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
                  const ownerCountryId =
                    typeof value.ownerCountryId === "string" && value.ownerCountryId.trim()
                      ? value.ownerCountryId.trim()
                      : marketId;
                  return [
                    marketId,
                    {
                      id: marketId,
                      name:
                        typeof value.name === "string" && value.name.trim() ? value.name.trim() : `Рынок ${marketId}`,
                      logoUrl: typeof value.logoUrl === "string" || value.logoUrl === null ? (value.logoUrl ?? null) : null,
                      ownerCountryId,
                      memberCountryIds: Array.isArray(value.memberCountryIds)
                        ? [
                            ...new Set(
                              value.memberCountryIds
                                .filter((row): row is string => typeof row === "string" && row.trim().length > 0)
                                .map((row) => row.trim()),
                            ),
                          ]
                        : [ownerCountryId],
                      visibility: normalizeMarketVisibility(value.visibility),
                      createdAt:
                        typeof value.createdAt === "string" && value.createdAt.trim()
                          ? value.createdAt.trim()
                          : new Date().toISOString(),
                      warehouseByResourceId: normalizeNumberMap(value.warehouseByResourceId),
                      priceByResourceId: normalizeNumberMap(value.priceByResourceId),
                      priceHistoryByResourceId: normalizeNumberHistoryMap(value.priceHistoryByResourceId),
                      demandHistoryByResourceId: normalizeNumberHistoryMap(value.demandHistoryByResourceId),
                      offerHistoryByResourceId: normalizeNumberHistoryMap(value.offerHistoryByResourceId),
                      productionFactHistoryByResourceId: normalizeNumberHistoryMap(value.productionFactHistoryByResourceId),
                      productionMaxHistoryByResourceId: normalizeNumberHistoryMap(value.productionMaxHistoryByResourceId),
                      worldTradePolicyByResourceId: normalizeMarketTradePolicyMap(value.worldTradePolicyByResourceId),
                      resourceTradePolicyByCountryId: normalizeCountryResourceTradePolicyMap(value.resourceTradePolicyByCountryId),
                      lastSharedInfrastructureConsumedByCategory: normalizeCategoryAmountMap(
                        value.lastSharedInfrastructureConsumedByCategory,
                      ),
                      lastSharedInfrastructureCapacityByCategory: normalizeCategoryAmountMap(
                        value.lastSharedInfrastructureCapacityByCategory,
                      ),
                    },
                  ];
                }),
              )
            : { ...defaults.markets.marketById },
        marketInvitesById:
          next.markets && typeof next.markets === "object" && next.markets.marketInvitesById && typeof next.markets.marketInvitesById === "object"
            ? Object.fromEntries(
                Object.entries(next.markets.marketInvitesById as Record<string, unknown>).map(([inviteId, raw]) => {
                  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
                  const nowIso = new Date().toISOString();
                  const statusRaw = typeof value.status === "string" ? value.status : "pending";
                  const status =
                    statusRaw === "accepted" || statusRaw === "rejected" || statusRaw === "canceled" ? statusRaw : "pending";
                  const kindRaw = typeof value.kind === "string" ? value.kind : "invite";
                  const kind = kindRaw === "join-request" ? "join-request" : "invite";
                  return [
                    inviteId,
                    {
                      id: inviteId,
                      marketId: typeof value.marketId === "string" ? value.marketId : "",
                      fromCountryId: typeof value.fromCountryId === "string" ? value.fromCountryId : "",
                      toCountryId: typeof value.toCountryId === "string" ? value.toCountryId : "",
                      kind,
                      status,
                      expiresAt: typeof value.expiresAt === "string" && value.expiresAt.trim() ? value.expiresAt : nowIso,
                      createdAt: typeof value.createdAt === "string" && value.createdAt.trim() ? value.createdAt : nowIso,
                      updatedAt: typeof value.updatedAt === "string" && value.updatedAt.trim() ? value.updatedAt : nowIso,
                    },
                  ];
                }),
              )
            : { ...defaults.markets.marketInvitesById },
        sanctionsById:
          next.markets && typeof next.markets === "object" && next.markets.sanctionsById && typeof next.markets.sanctionsById === "object"
            ? normalizeMarketSanctionsMap(next.markets.sanctionsById)
            : { ...defaults.markets.sanctionsById },
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
        pauseWhenNoPlayersOnline:
          typeof (next as Partial<{ turnTimer?: { pauseWhenNoPlayersOnline?: unknown } }>).turnTimer?.pauseWhenNoPlayersOnline === "boolean"
            ? Boolean((next as Partial<{ turnTimer?: { pauseWhenNoPlayersOnline?: boolean } }>).turnTimer?.pauseWhenNoPlayersOnline)
            : defaults.turnTimer.pauseWhenNoPlayersOnline,
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
        construction:
          typeof next.resourceIcons?.construction === "string" || next.resourceIcons?.construction === null
            ? (next.resourceIcons?.construction ?? null)
            : defaults.resourceIcons.construction,
        ducats: typeof next.resourceIcons?.ducats === "string" || next.resourceIcons?.ducats === null ? (next.resourceIcons?.ducats ?? null) : defaults.resourceIcons.ducats,
        gold: typeof next.resourceIcons?.gold === "string" || next.resourceIcons?.gold === null ? (next.resourceIcons?.gold ?? null) : defaults.resourceIcons.gold,
      },
    };
  }

  if (parsed.worldBase && typeof parsed.worldBase === "object") {
    const candidate = parsed.worldBase as Partial<WorldBase> & { previousTradeInfraLoadByProvince?: unknown };
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
        resourcesByCountry: normalizeResourcesByCountryMap(candidate.resourcesByCountry),
        provinceOwner: candidate.provinceOwner,
        provinceNameById:
          candidate.provinceNameById && typeof candidate.provinceNameById === "object"
            ? (candidate.provinceNameById as Record<string, string>)
            : {},
        colonyProgressByProvince: candidate.colonyProgressByProvince,
        provinceColonizationByProvince: normalizeProvinceColonizationMap(
          (candidate as Partial<WorldBase> & { provinceColonizationByProvince?: unknown }).provinceColonizationByProvince,
        ),
        provinceInfrastructureByProvince: normalizeProvinceInfrastructureMap(
          (candidate as Partial<WorldBase> & { provinceInfrastructureByProvince?: unknown }).provinceInfrastructureByProvince,
        ),
        provincePopulationByProvince: normalizeProvincePopulationMap(
          (candidate as Partial<WorldBase> & { provincePopulationByProvince?: unknown }).provincePopulationByProvince,
        ),
        provinceBuildingsByProvince: normalizeProvinceBuildingsMap(
          (candidate as Partial<WorldBase> & { provinceBuildingsByProvince?: unknown }).provinceBuildingsByProvince,
        ),
        provinceBuildingDucatsByProvince: normalizeProvinceBuildingDucatsMap(
          (candidate as Partial<WorldBase> & { provinceBuildingDucatsByProvince?: unknown }).provinceBuildingDucatsByProvince,
        ),
        provincePopulationTreasuryByProvince: normalizeProvincePopulationTreasuryMap(
          (candidate as Partial<WorldBase> & { provincePopulationTreasuryByProvince?: unknown }).provincePopulationTreasuryByProvince,
        ),
        provinceConstructionQueueByProvince: normalizeProvinceConstructionQueueMap(
          (candidate as Partial<WorldBase> & { provinceConstructionQueueByProvince?: unknown }).provinceConstructionQueueByProvince,
        ),
        provinceResourceDepositsByProvince: normalizeProvinceResourceDepositsMap(
          (candidate as Partial<WorldBase> & { provinceResourceDepositsByProvince?: unknown })
            .provinceResourceDepositsByProvince,
        ),
        provinceResourceExplorationQueueByProvince: normalizeProvinceResourceExplorationQueueMap(
          (candidate as Partial<WorldBase> & { provinceResourceExplorationQueueByProvince?: unknown })
            .provinceResourceExplorationQueueByProvince,
        ),
        provinceResourceExplorationCountByProvince: normalizeProvinceResourceExplorationCountMap(
          (candidate as Partial<WorldBase> & { provinceResourceExplorationCountByProvince?: unknown })
            .provinceResourceExplorationCountByProvince,
        ),
      };
    } else {
      worldBase = defaultWorldBase(turnId);
    }
  } else {
    worldBase = defaultWorldBase(turnId);
  }
  previousTradeInfraLoadByProvince = normalizeTradeInfraLoadMap(
    parsed.worldBase && typeof parsed.worldBase === "object"
      ? (parsed.worldBase as { previousTradeInfraLoadByProvince?: unknown }).previousTradeInfraLoadByProvince
      : undefined,
  );
  latestMarketOverview = normalizeMarketOverviewState(
    parsed.worldBase && typeof parsed.worldBase === "object"
      ? (parsed.worldBase as { latestMarketOverview?: unknown }).latestMarketOverview
      : parsed.marketOverview,
    turnId,
  );

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
  ensureMarketModelReady();

  return true;
}

async function persistStateToDb(): Promise<void> {
  const payload = {
    turnId,
    gameSettings,
    worldBase: {
      ...worldBase,
      turnId,
      previousTradeInfraLoadByProvince,
      latestMarketOverview,
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
        persistContentLibraryFromSettings();
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
      persistContentLibraryFromSettings();
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

async function ensureCorePrismaTables(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Country (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      flagUrl TEXT,
      crestUrl TEXT,
      passwordHash TEXT NOT NULL,
      isLocked INTEGER NOT NULL DEFAULT 0,
      isAdmin INTEGER NOT NULL DEFAULT 0,
      blockedUntilTurn INTEGER,
      blockedUntilAt DATETIME,
      lockReason TEXT,
      ignoreUntilTurn INTEGER,
      eventLogRetentionTurns INTEGER NOT NULL DEFAULT 3,
      isRegistrationApproved INTEGER NOT NULL DEFAULT 1,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS GameState (
      id TEXT PRIMARY KEY NOT NULL,
      turnId INTEGER NOT NULL,
      gameSettingsJson JSONB NOT NULL,
      worldBaseJson JSONB NOT NULL,
      ordersByTurnJson JSONB NOT NULL,
      resolveReadyByTurnJson JSONB NOT NULL,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
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
  const existing = worldBase.resourcesByCountry[countryId];
  if (!existing) {
    worldBase.resourcesByCountry[countryId] = {
      culture: 5,
      science: 5,
      religion: 5,
      colonization: gameSettings.colonization.pointsPerTurn,
      construction: gameSettings.economy.baseConstructionPerTurn,
      ducats: 20,
      gold: 80,
    };
    economyTickCountryIds.add(countryId);
    savePersistentState();
    return;
  }
  const normalized = normalizeResourceTotals(existing);
  if (
    normalized.culture !== existing.culture ||
    normalized.science !== existing.science ||
    normalized.religion !== existing.religion ||
    normalized.colonization !== existing.colonization ||
    normalized.construction !== existing.construction ||
    normalized.ducats !== existing.ducats ||
    normalized.gold !== existing.gold
  ) {
    worldBase.resourcesByCountry[countryId] = normalized;
    savePersistentState();
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
    marketId: getCountryMarketId(row.id),
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
  provinceInfrastructureByProvince?: WorldBase["provinceInfrastructureByProvince"];
  provincePopulationByProvince?: WorldBase["provincePopulationByProvince"];
  provinceBuildingsByProvince?: WorldBase["provinceBuildingsByProvince"];
  provinceBuildingDucatsByProvince?: WorldBase["provinceBuildingDucatsByProvince"];
  provincePopulationTreasuryByProvince?: WorldBase["provincePopulationTreasuryByProvince"];
  provinceConstructionQueueByProvince?: WorldBase["provinceConstructionQueueByProvince"];
  provinceResourceDepositsByProvince?: WorldBase["provinceResourceDepositsByProvince"];
  provinceResourceExplorationQueueByProvince?: WorldBase["provinceResourceExplorationQueueByProvince"];
  provinceResourceExplorationCountByProvince?: WorldBase["provinceResourceExplorationCountByProvince"];
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
  if ((mask & WORLD_DELTA_MASK.provinceInfrastructureByProvince) !== 0) {
    snapshot.provinceInfrastructureByProvince = structuredClone(worldBase.provinceInfrastructureByProvince);
  }
  if ((mask & WORLD_DELTA_MASK.provincePopulationByProvince) !== 0) {
    snapshot.provincePopulationByProvince = structuredClone(worldBase.provincePopulationByProvince);
  }
  if ((mask & WORLD_DELTA_MASK.provinceBuildingsByProvince) !== 0) {
    snapshot.provinceBuildingsByProvince = structuredClone(worldBase.provinceBuildingsByProvince);
  }
  if ((mask & WORLD_DELTA_MASK.provinceBuildingDucatsByProvince) !== 0) {
    snapshot.provinceBuildingDucatsByProvince = structuredClone(worldBase.provinceBuildingDucatsByProvince);
  }
  if ((mask & WORLD_DELTA_MASK.provincePopulationTreasuryByProvince) !== 0) {
    snapshot.provincePopulationTreasuryByProvince = structuredClone(worldBase.provincePopulationTreasuryByProvince);
  }
  if ((mask & WORLD_DELTA_MASK.provinceConstructionQueueByProvince) !== 0) {
    snapshot.provinceConstructionQueueByProvince = structuredClone(worldBase.provinceConstructionQueueByProvince);
  }
  if ((mask & WORLD_DELTA_MASK.provinceResourceDepositsByProvince) !== 0) {
    snapshot.provinceResourceDepositsByProvince = structuredClone(worldBase.provinceResourceDepositsByProvince);
  }
  if ((mask & WORLD_DELTA_MASK.provinceResourceExplorationQueueByProvince) !== 0) {
    snapshot.provinceResourceExplorationQueueByProvince = structuredClone(
      worldBase.provinceResourceExplorationQueueByProvince,
    );
  }
  if ((mask & WORLD_DELTA_MASK.provinceResourceExplorationCountByProvince) !== 0) {
    snapshot.provinceResourceExplorationCountByProvince = structuredClone(
      worldBase.provinceResourceExplorationCountByProvince,
    );
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

function isEqualConstructionQueue(
  prevValue: ProvinceConstructionProject[] | undefined,
  nextValue: ProvinceConstructionProject[],
): boolean {
  if (!prevValue) return false;
  if (prevValue.length !== nextValue.length) return false;
  for (let i = 0; i < nextValue.length; i += 1) {
    const prev = prevValue[i];
    const next = nextValue[i];
    if (!prev || !next) return false;
    if (
      prev.queueId !== next.queueId ||
      prev.requestedByCountryId !== next.requestedByCountryId ||
      prev.buildingId !== next.buildingId ||
      prev.owner.type !== next.owner.type ||
      (prev.owner.type === "state" && next.owner.type === "state" && prev.owner.countryId !== next.owner.countryId) ||
      (prev.owner.type === "company" && next.owner.type === "company" && prev.owner.companyId !== next.owner.companyId) ||
      prev.progressConstruction !== next.progressConstruction ||
      prev.costConstruction !== next.costConstruction ||
      prev.costDucats !== next.costDucats ||
      prev.createdTurnId !== next.createdTurnId
    ) {
      return false;
    }
  }
  return true;
}

function isEqualResourceDeposits(
  prevValue: ProvinceResourceDeposit[] | undefined,
  nextValue: ProvinceResourceDeposit[],
): boolean {
  if (!prevValue) return false;
  if (prevValue.length !== nextValue.length) return false;
  for (let i = 0; i < nextValue.length; i += 1) {
    const prev = prevValue[i];
    const next = nextValue[i];
    if (!prev || !next) return false;
    if (
      prev.goodId !== next.goodId ||
      Number(prev.amount) !== Number(next.amount) ||
      prev.discoveredTurnId !== next.discoveredTurnId ||
      prev.veinSize !== next.veinSize
    ) {
      return false;
    }
  }
  return true;
}

function isEqualResourceExplorationQueue(
  prevValue: ProvinceResourceExplorationProject[] | undefined,
  nextValue: ProvinceResourceExplorationProject[],
): boolean {
  if (!prevValue) return false;
  if (prevValue.length !== nextValue.length) return false;
  for (let i = 0; i < nextValue.length; i += 1) {
    const prev = prevValue[i];
    const next = nextValue[i];
    if (!prev || !next) return false;
    if (
      prev.queueId !== next.queueId ||
      prev.requestedByCountryId !== next.requestedByCountryId ||
      prev.startedTurnId !== next.startedTurnId ||
      prev.turnsRemaining !== next.turnsRemaining
    ) {
      return false;
    }
  }
  return true;
}

function isEqualBuildingInstances(
  prevValue: BuildingInstance[] | undefined,
  nextValue: BuildingInstance[],
): boolean {
  if (!prevValue) return false;
  if (prevValue.length !== nextValue.length) return false;
  for (let i = 0; i < nextValue.length; i += 1) {
    const prev = prevValue[i];
    const next = nextValue[i];
    if (!prev || !next) return false;
    if (
      prev.instanceId !== next.instanceId ||
      prev.buildingId !== next.buildingId ||
      prev.createdTurnId !== next.createdTurnId ||
      prev.owner.type !== next.owner.type ||
      (prev.owner.type === "state" && next.owner.type === "state" && prev.owner.countryId !== next.owner.countryId) ||
      (prev.owner.type === "company" &&
        next.owner.type === "company" &&
        prev.owner.companyId !== next.owner.companyId)
    ) {
      return false;
    }
    if (
      Number(prev.ducats ?? 0) !== Number(next.ducats ?? 0) ||
      Number(prev.lastLaborCoverage ?? 0) !== Number(next.lastLaborCoverage ?? 0) ||
      Number(prev.lastInfraCoverage ?? 0) !== Number(next.lastInfraCoverage ?? 0) ||
      Number(prev.lastInputCoverage ?? 0) !== Number(next.lastInputCoverage ?? 0) ||
      Number(prev.lastFinanceCoverage ?? 0) !== Number(next.lastFinanceCoverage ?? 0) ||
      Number(prev.lastProductivity ?? 0) !== Number(next.lastProductivity ?? 0) ||
      Number(prev.lastRevenueDucats ?? 0) !== Number(next.lastRevenueDucats ?? 0) ||
      Number(prev.lastInputCostDucats ?? 0) !== Number(next.lastInputCostDucats ?? 0) ||
      Number(prev.lastWagesDucats ?? 0) !== Number(next.lastWagesDucats ?? 0) ||
      Number(prev.lastNetDucats ?? 0) !== Number(next.lastNetDucats ?? 0) ||
      Boolean(prev.isInactive) !== Boolean(next.isInactive) ||
      (prev.inactiveReason ?? null) !== (next.inactiveReason ?? null)
    ) {
      return false;
    }
    if (!isEqualCountryProgressMap(prev.warehouseByGoodId, next.warehouseByGoodId ?? {})) return false;
    if (!isEqualCountryProgressMap(prev.lastPurchaseByGoodId, next.lastPurchaseByGoodId ?? {})) return false;
    if (!isEqualCountryProgressMap(prev.lastPurchaseCostByGoodId, next.lastPurchaseCostByGoodId ?? {})) return false;
    if (!isEqualCountryProgressMap(prev.lastSalesByGoodId, next.lastSalesByGoodId ?? {})) return false;
    if (!isEqualCountryProgressMap(prev.lastSalesRevenueByGoodId, next.lastSalesRevenueByGoodId ?? {})) return false;
    if (!isEqualCountryProgressMap(prev.lastConsumptionByGoodId, next.lastConsumptionByGoodId ?? {})) return false;
    if (!isEqualCountryProgressMap(prev.lastProductionByGoodId, next.lastProductionByGoodId ?? {})) return false;
  }
  return true;
}

function buildCompactWorldDelta(
  prev: WorldBase,
  next: WorldBase,
): Omit<WorldDelta, "type" | "turnId" | "worldStateVersion" | "rejectedOrders"> {
  const resourcesByCountry: Record<string, ResourceTotals | null> = {};
  const provinceOwner: Record<string, string | null> = {};
  const provinceNameById: Record<string, string | null> = {};
  const colonyProgressByProvince: Record<string, Record<string, number> | null> = {};
  const provinceColonizationByProvince: Record<string, { cost: number; disabled: boolean; manualCost?: boolean } | null> = {};
  const provinceInfrastructureByProvince: Record<string, number | null> = {};
  const provincePopulationByProvince: Record<string, ProvincePopulation | null> = {};
  const provinceBuildingsByProvince: Record<string, BuildingInstance[] | null> = {};
  const provinceBuildingDucatsByProvince: Record<string, Record<string, number> | null> = {};
  const provincePopulationTreasuryByProvince: Record<string, number | null> = {};
  const provinceConstructionQueueByProvince: Record<string, ProvinceConstructionProject[] | null> = {};
  const provinceResourceDepositsByProvince: Record<string, ProvinceResourceDeposit[] | null> = {};
  const provinceResourceExplorationQueueByProvince: Record<string, ProvinceResourceExplorationProject[] | null> = {};
  const provinceResourceExplorationCountByProvince: Record<string, number | null> = {};

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
      prevValue.construction !== nextValue.construction ||
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

  for (const key of new Set([...Object.keys(prev.provinceInfrastructureByProvince), ...Object.keys(next.provinceInfrastructureByProvince)])) {
    const prevValue = prev.provinceInfrastructureByProvince[key];
    const nextValue = next.provinceInfrastructureByProvince[key];
    if (nextValue == null) {
      provinceInfrastructureByProvince[key] = null;
      continue;
    }
    if (prevValue !== nextValue) {
      provinceInfrastructureByProvince[key] = nextValue;
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

  for (const key of new Set([...Object.keys(prev.provinceBuildingsByProvince), ...Object.keys(next.provinceBuildingsByProvince)])) {
    const prevValue = prev.provinceBuildingsByProvince[key];
    const nextValue = next.provinceBuildingsByProvince[key];
    if (!nextValue) {
      provinceBuildingsByProvince[key] = null;
      continue;
    }
    if (!isEqualBuildingInstances(prevValue, nextValue)) {
      provinceBuildingsByProvince[key] = nextValue;
    }
  }

  for (const key of new Set([...Object.keys(prev.provinceBuildingDucatsByProvince), ...Object.keys(next.provinceBuildingDucatsByProvince)])) {
    const prevValue = prev.provinceBuildingDucatsByProvince[key];
    const nextValue = next.provinceBuildingDucatsByProvince[key];
    if (!nextValue) {
      provinceBuildingDucatsByProvince[key] = null;
      continue;
    }
    if (!isEqualCountryProgressMap(prevValue, nextValue)) {
      provinceBuildingDucatsByProvince[key] = nextValue;
    }
  }

  for (const key of new Set([...Object.keys(prev.provincePopulationTreasuryByProvince), ...Object.keys(next.provincePopulationTreasuryByProvince)])) {
    const prevValue = prev.provincePopulationTreasuryByProvince[key];
    const nextValue = next.provincePopulationTreasuryByProvince[key];
    if (nextValue == null) {
      provincePopulationTreasuryByProvince[key] = null;
      continue;
    }
    if (prevValue !== nextValue) {
      provincePopulationTreasuryByProvince[key] = nextValue;
    }
  }

  for (const key of new Set([...Object.keys(prev.provinceConstructionQueueByProvince), ...Object.keys(next.provinceConstructionQueueByProvince)])) {
    const prevValue = prev.provinceConstructionQueueByProvince[key];
    const nextValue = next.provinceConstructionQueueByProvince[key];
    if (!nextValue) {
      provinceConstructionQueueByProvince[key] = null;
      continue;
    }
    if (!isEqualConstructionQueue(prevValue, nextValue)) {
      provinceConstructionQueueByProvince[key] = nextValue;
    }
  }

  for (const key of new Set([...Object.keys(prev.provinceResourceDepositsByProvince), ...Object.keys(next.provinceResourceDepositsByProvince)])) {
    const prevValue = prev.provinceResourceDepositsByProvince[key];
    const nextValue = next.provinceResourceDepositsByProvince[key];
    if (!nextValue) {
      provinceResourceDepositsByProvince[key] = null;
      continue;
    }
    if (!isEqualResourceDeposits(prevValue, nextValue)) {
      provinceResourceDepositsByProvince[key] = nextValue;
    }
  }

  for (
    const key of new Set([
      ...Object.keys(prev.provinceResourceExplorationQueueByProvince),
      ...Object.keys(next.provinceResourceExplorationQueueByProvince),
    ])
  ) {
    const prevValue = prev.provinceResourceExplorationQueueByProvince[key];
    const nextValue = next.provinceResourceExplorationQueueByProvince[key];
    if (!nextValue) {
      provinceResourceExplorationQueueByProvince[key] = null;
      continue;
    }
    if (!isEqualResourceExplorationQueue(prevValue, nextValue)) {
      provinceResourceExplorationQueueByProvince[key] = nextValue;
    }
  }

  for (
    const key of new Set([
      ...Object.keys(prev.provinceResourceExplorationCountByProvince),
      ...Object.keys(next.provinceResourceExplorationCountByProvince),
    ])
  ) {
    const prevValue = prev.provinceResourceExplorationCountByProvince[key];
    const nextValue = next.provinceResourceExplorationCountByProvince[key];
    if (nextValue == null) {
      provinceResourceExplorationCountByProvince[key] = null;
      continue;
    }
    if (prevValue !== nextValue) {
      provinceResourceExplorationCountByProvince[key] = nextValue;
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
  if (Object.keys(provinceInfrastructureByProvince).length > 0) {
    mask |= WORLD_DELTA_MASK.provinceInfrastructureByProvince;
    compact.s = provinceInfrastructureByProvince;
  }
  if (Object.keys(provincePopulationByProvince).length > 0) {
    mask |= WORLD_DELTA_MASK.provincePopulationByProvince;
    compact.u = provincePopulationByProvince;
  }
  if (Object.keys(provinceBuildingsByProvince).length > 0) {
    mask |= WORLD_DELTA_MASK.provinceBuildingsByProvince;
    compact.b = provinceBuildingsByProvince;
  }
  if (Object.keys(provinceBuildingDucatsByProvince).length > 0) {
    mask |= WORLD_DELTA_MASK.provinceBuildingDucatsByProvince;
    compact.q = provinceBuildingDucatsByProvince;
  }
  if (Object.keys(provincePopulationTreasuryByProvince).length > 0) {
    mask |= WORLD_DELTA_MASK.provincePopulationTreasuryByProvince;
    compact.y = provincePopulationTreasuryByProvince;
  }
  if (Object.keys(provinceConstructionQueueByProvince).length > 0) {
    mask |= WORLD_DELTA_MASK.provinceConstructionQueueByProvince;
    compact.r = provinceConstructionQueueByProvince;
  }
  if (Object.keys(provinceResourceDepositsByProvince).length > 0) {
    mask |= WORLD_DELTA_MASK.provinceResourceDepositsByProvince;
    compact.t = provinceResourceDepositsByProvince;
  }
  if (Object.keys(provinceResourceExplorationQueueByProvince).length > 0) {
    mask |= WORLD_DELTA_MASK.provinceResourceExplorationQueueByProvince;
    compact.e = provinceResourceExplorationQueueByProvince;
  }
  if (Object.keys(provinceResourceExplorationCountByProvince).length > 0) {
    mask |= WORLD_DELTA_MASK.provinceResourceExplorationCountByProvince;
    compact.k = provinceResourceExplorationCountByProvince;
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
    provinceInfrastructureByProvince:
      (previous.mask & WORLD_DELTA_MASK.provinceInfrastructureByProvince) !== 0 && previous.provinceInfrastructureByProvince
        ? previous.provinceInfrastructureByProvince
        : next.provinceInfrastructureByProvince,
    provincePopulationByProvince:
      (previous.mask & WORLD_DELTA_MASK.provincePopulationByProvince) !== 0 && previous.provincePopulationByProvince
        ? previous.provincePopulationByProvince
        : next.provincePopulationByProvince,
    provinceBuildingsByProvince:
      (previous.mask & WORLD_DELTA_MASK.provinceBuildingsByProvince) !== 0 && previous.provinceBuildingsByProvince
        ? previous.provinceBuildingsByProvince
        : next.provinceBuildingsByProvince,
    provinceBuildingDucatsByProvince:
      (previous.mask & WORLD_DELTA_MASK.provinceBuildingDucatsByProvince) !== 0 && previous.provinceBuildingDucatsByProvince
        ? previous.provinceBuildingDucatsByProvince
        : next.provinceBuildingDucatsByProvince,
    provincePopulationTreasuryByProvince:
      (previous.mask & WORLD_DELTA_MASK.provincePopulationTreasuryByProvince) !== 0 && previous.provincePopulationTreasuryByProvince
        ? previous.provincePopulationTreasuryByProvince
        : next.provincePopulationTreasuryByProvince,
    provinceConstructionQueueByProvince:
      (previous.mask & WORLD_DELTA_MASK.provinceConstructionQueueByProvince) !== 0 && previous.provinceConstructionQueueByProvince
        ? previous.provinceConstructionQueueByProvince
        : next.provinceConstructionQueueByProvince,
    provinceResourceDepositsByProvince:
      (previous.mask & WORLD_DELTA_MASK.provinceResourceDepositsByProvince) !== 0 &&
      previous.provinceResourceDepositsByProvince
        ? previous.provinceResourceDepositsByProvince
        : next.provinceResourceDepositsByProvince,
    provinceResourceExplorationQueueByProvince:
      (previous.mask & WORLD_DELTA_MASK.provinceResourceExplorationQueueByProvince) !== 0 &&
      previous.provinceResourceExplorationQueueByProvince
        ? previous.provinceResourceExplorationQueueByProvince
        : next.provinceResourceExplorationQueueByProvince,
    provinceResourceExplorationCountByProvince:
      (previous.mask & WORLD_DELTA_MASK.provinceResourceExplorationCountByProvince) !== 0 &&
      previous.provinceResourceExplorationCountByProvince
        ? previous.provinceResourceExplorationCountByProvince
        : next.provinceResourceExplorationCountByProvince,
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
    s: compact.s,
    u: compact.u,
    b: compact.b,
    q: compact.q,
    y: compact.y,
    r: compact.r,
    t: compact.t,
    e: compact.e,
    k: compact.k,
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
      provinceInfrastructureByProvince: compact.s,
      provincePopulationByProvince: compact.u,
      provinceBuildingsByProvince: compact.b,
      provinceBuildingDucatsByProvince: compact.q,
      provincePopulationTreasuryByProvince: compact.y,
      provinceConstructionQueueByProvince: compact.r,
      provinceResourceDepositsByProvince: compact.t,
      provinceResourceExplorationQueueByProvince: compact.e,
      provinceResourceExplorationCountByProvince: compact.k,
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

function validateImageRule(
  file: Express.Multer.File,
  rule: { maxWidth: number; maxHeight: number; ratioWidth: number; ratioHeight: number },
): boolean {
  const dimensions = imageSize(readFileSync(file.path));
  const width = Number(dimensions.width ?? 0);
  const height = Number(dimensions.height ?? 0);
  if (width <= 0 || height <= 0) return false;
  if (width > rule.maxWidth || height > rule.maxHeight) return false;
  const expected = rule.ratioWidth / rule.ratioHeight;
  const actual = width / height;
  return Math.abs(actual - expected) <= 0.01;
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

function extractUploadRelativePathFromUrl(url?: string | null): string | null {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;
  const withoutHash = raw.split("#")[0] ?? "";
  const withoutQuery = withoutHash.split("?")[0] ?? "";
  if (withoutQuery.startsWith("/uploads/")) {
    return withoutQuery.replace(/^\/uploads\//, "").replace(/\\/g, "/");
  }
  try {
    const parsed = new URL(withoutQuery);
    if (!parsed.pathname.startsWith("/uploads/")) {
      return null;
    }
    return parsed.pathname.replace(/^\/uploads\//, "").replace(/\\/g, "/");
  } catch {
    return null;
  }
}

function makeVersionedUploadUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, "");
  return `/uploads/${clean}?v=${Date.now()}`;
}

function collectUploadPathsFromUnknown(input: unknown, sink: Set<string>): void {
  if (input == null) return;
  if (typeof input === "string") {
    const rel = extractUploadRelativePathFromUrl(input);
    if (rel) sink.add(rel);
    return;
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      collectUploadPathsFromUnknown(item, sink);
    }
    return;
  }
  if (typeof input !== "object") {
    return;
  }
  for (const value of Object.values(input as Record<string, unknown>)) {
    collectUploadPathsFromUnknown(value, sink);
  }
}

function listUploadFilesRecursively(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  const walk = (current: string, relativePrefix = "") => {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      const abs = resolve(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      if (entry.isFile()) {
        files.push(rel.replace(/\\/g, "/"));
      }
    }
  };
  walk(root);
  return files;
}

async function cleanupOrphanUploadsOnServerStart(): Promise<void> {
  if (!env.autoCleanupUploadsOnStart) {
    return;
  }

  try {
    const referenced = new Set<string>();
    collectUploadPathsFromUnknown(worldBase, referenced);
    collectUploadPathsFromUnknown(gameSettings, referenced);
    const countries = await prisma.country.findMany({
      select: {
        flagUrl: true,
        crestUrl: true,
      },
    });
    for (const country of countries) {
      const flagRel = extractUploadRelativePathFromUrl(country.flagUrl);
      if (flagRel) referenced.add(flagRel);
      const crestRel = extractUploadRelativePathFromUrl(country.crestUrl);
      if (crestRel) referenced.add(crestRel);
    }

    const uploadFiles = listUploadFilesRecursively(uploadsRoot);
    const orphanFiles = uploadFiles.filter((path) => !referenced.has(path));
    if (uploadFiles.length > 0 && referenced.size === 0) {
      console.warn("[uploads] Startup cleanup skipped: no references detected.");
      return;
    }
    const orphanRatio = uploadFiles.length > 0 ? orphanFiles.length / uploadFiles.length : 0;
    if (orphanFiles.length > 10 && orphanRatio > 0.8) {
      console.warn(
        `[uploads] Startup cleanup skipped: suspicious orphan ratio ${Math.round(orphanRatio * 100)}% (${orphanFiles.length}/${uploadFiles.length}).`,
      );
      return;
    }
    if (orphanFiles.length === 0) {
      return;
    }

    let removed = 0;
    for (const rel of orphanFiles) {
      try {
        unlinkSync(resolve(uploadsRoot, rel));
        removed += 1;
      } catch {
        // Ignore per-file delete failures and continue cleanup.
      }
    }

    console.log(
      `[uploads] Startup cleanup removed ${removed}/${orphanFiles.length} orphan files (tracked=${referenced.size}).`,
    );
  } catch (error) {
    console.error("[uploads] Startup cleanup failed:", error);
  }
}

function removeUploadedByUrl(url?: string | null): void {
  const rel = extractUploadRelativePathFromUrl(url);
  if (!rel) return;
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

const buildingCountryAccessEngine = (() => {
  const engine = new Engine();
  engine.addRule({
    conditions: {
      all: [
        { fact: "isDenied", operator: "equal", value: false },
        { fact: "allowListSatisfied", operator: "equal", value: true },
      ],
    },
    event: { type: "allowed" },
  });
  return engine;
})();

function parseRequestedBuildingIdFromPayload(payload: Record<string, unknown>): string {
  const requestedBuildingId =
    typeof payload.buildingId === "string"
      ? payload.buildingId.trim()
      : typeof payload.building === "string"
        ? payload.building.trim()
        : "";
  if (requestedBuildingId) {
    return requestedBuildingId;
  }
  return gameSettings.content.buildings[0]?.id || "";
}

function getBuildingRuleLists(building: BuildingContentEntry): { allowed: string[]; denied: string[] } {
  return {
    allowed: normalizeCountryIdList(building.allowedCountryIds),
    denied: normalizeCountryIdList(building.deniedCountryIds),
  };
}

function isCountryAllowedForBuildingSync(building: BuildingContentEntry, countryId: string): boolean {
  const lists = getBuildingRuleLists(building);
  if (lists.denied.includes(countryId)) {
    return false;
  }
  if (lists.allowed.length > 0 && !lists.allowed.includes(countryId)) {
    return false;
  }
  return true;
}

async function isCountryAllowedForBuildingWithEngine(building: BuildingContentEntry, countryId: string): Promise<boolean> {
  const lists = getBuildingRuleLists(building);
  const result = await buildingCountryAccessEngine.run({
    isDenied: lists.denied.includes(countryId),
    allowListSatisfied: lists.allowed.length === 0 || lists.allowed.includes(countryId),
  });
  return result.events.some((event) => event.type === "allowed");
}

function countBuildingOccurrences(
  buildingId: string,
  countryId: string,
  options?: { includePendingOrders?: boolean },
): { byCountry: number; global: number } {
  let byCountry = 0;
  let global = 0;

  for (const [provinceId, instances] of Object.entries(worldBase.provinceBuildingsByProvince)) {
    const amount = (instances ?? []).filter((instance) => instance.buildingId === buildingId).length;
    if (amount <= 0) continue;
    global += amount;
    if ((worldBase.provinceOwner[provinceId] ?? null) === countryId) {
      byCountry += amount;
    }
  }

  for (const [provinceId, queue] of Object.entries(worldBase.provinceConstructionQueueByProvince)) {
    for (const project of queue ?? []) {
      if (project.buildingId !== buildingId) continue;
      global += 1;
      if ((worldBase.provinceOwner[provinceId] ?? null) === countryId) {
        byCountry += 1;
      }
    }
  }

  if (options?.includePendingOrders !== false) {
    const turnOrders = ordersByTurn.get(turnId);
    if (turnOrders) {
      for (const orders of turnOrders.values()) {
        for (const order of orders) {
          if (order.type !== "BUILD") continue;
          const payload = (order.payload ?? {}) as Record<string, unknown>;
          if (parseRequestedBuildingIdFromPayload(payload) !== buildingId) continue;
          global += 1;
          if (order.countryId === countryId) {
            byCountry += 1;
          }
        }
      }
    }
  }

  return { byCountry, global };
}

function getCountryBuildLimit(building: BuildingContentEntry, countryId: string): number | null {
  const limits = normalizeBuildingCountryLimits(building.countryBuildLimits);
  const row = limits.find((item) => item.countryId === countryId);
  return row ? row.limit : null;
}

function resolveBuildingOwnerFromPayload(payload: Record<string, unknown>, requestedByCountryId: string): BuildingOwner | null {
  const rawOwner = payload.owner;
  if (!rawOwner || typeof rawOwner !== "object") {
    return { type: "state", countryId: requestedByCountryId };
  }
  const source = rawOwner as Record<string, unknown>;
  const ownerType = source.type === "company" ? "company" : "state";
  if (ownerType === "company") {
    const companyId = typeof source.companyId === "string" ? source.companyId.trim() : "";
    if (!companyId) return null;
    const exists = gameSettings.content.companies.some((company) => company.id === companyId);
    if (!exists) return null;
    return { type: "company", companyId };
  }
  const countryId = typeof source.countryId === "string" ? source.countryId.trim() : requestedByCountryId;
  if (!countryId || !worldBase.resourcesByCountry[countryId]) return null;
  return { type: "state", countryId };
}

function resolveBuildingConstructionQueuesTurn(): void {
  type ProjectRef = { provinceId: string; index: number };
  const projectsByCountry = new Map<string, ProjectRef[]>();
  const EPS = 1e-6;
  const buildingById = new Map(gameSettings.content.buildings.map((entry) => [entry.id, entry] as const));

  for (const [provinceId, queue] of Object.entries(worldBase.provinceConstructionQueueByProvince ?? {})) {
    if (!Array.isArray(queue) || queue.length === 0) continue;
    for (let index = 0; index < queue.length; index += 1) {
      const project = queue[index];
      if (!project) continue;
      if (project.progressConstruction >= project.costConstruction) continue;
      if ((worldBase.provinceOwner[provinceId] ?? null) !== project.requestedByCountryId) continue;
      const list = projectsByCountry.get(project.requestedByCountryId) ?? [];
      list.push({ provinceId, index });
      projectsByCountry.set(project.requestedByCountryId, list);
    }
  }

  for (const [countryId, refs] of projectsByCountry.entries()) {
    const countryResource = worldBase.resourcesByCountry[countryId];
    if (!countryResource) continue;
    const availableConstruction = Math.max(0, Number(countryResource.construction ?? 0));
    if (availableConstruction <= 0 || refs.length === 0) continue;
    let remainingCountryDucats = Math.max(0, Number(countryResource.ducats ?? 0));
    let remainingConstruction = availableConstruction;
    let spentConstruction = 0;
    let spentDucats = 0;

    const sortedRefs = [...refs].sort(
      (a, b) =>
        a.provinceId.localeCompare(b.provinceId) ||
        (worldBase.provinceConstructionQueueByProvince[a.provinceId]?.[a.index]?.queueId ?? "").localeCompare(
          worldBase.provinceConstructionQueueByProvince[b.provinceId]?.[b.index]?.queueId ?? "",
        ),
    );

    let activeRefs = [...sortedRefs];
    while (remainingConstruction > EPS && activeRefs.length > 0) {
      const equalShare = remainingConstruction / activeRefs.length;
      let progressedInRound = 0;
      const nextActiveRefs: ProjectRef[] = [];
      for (const ref of activeRefs) {
        const queue = worldBase.provinceConstructionQueueByProvince[ref.provinceId];
        const project = queue?.[ref.index];
        if (!queue || !project) continue;
        const remainingProjectConstruction = Math.max(0, project.costConstruction - project.progressConstruction);
        if (remainingProjectConstruction <= EPS) continue;
        const ducatRatio = project.costConstruction > 0 ? project.costDucats / project.costConstruction : 0;
        const spentProjectDucats = project.progressConstruction * ducatRatio;
        const remainingProjectDucats = Math.max(0, project.costDucats - spentProjectDucats);
        const maxByCountryDucats = ducatRatio > 0 ? remainingCountryDucats / ducatRatio : Number.POSITIVE_INFINITY;
        const maxByProjectDucats = ducatRatio > 0 ? remainingProjectDucats / ducatRatio : Number.POSITIVE_INFINITY;
        const appliedConstruction = Math.min(
          equalShare,
          remainingProjectConstruction,
          maxByCountryDucats,
          maxByProjectDucats,
        );
        if (appliedConstruction <= EPS) continue;
        const appliedDucats =
          ducatRatio > 0
            ? Math.min(remainingProjectDucats, appliedConstruction * ducatRatio, remainingCountryDucats)
            : 0;
        project.progressConstruction = Number(
          Math.min(project.costConstruction, project.progressConstruction + appliedConstruction).toFixed(3),
        );
        spentConstruction += appliedConstruction;
        spentDucats += appliedDucats;
        remainingConstruction = Math.max(0, remainingConstruction - appliedConstruction);
        remainingCountryDucats = Math.max(0, remainingCountryDucats - appliedDucats);
        progressedInRound += appliedConstruction;

        const stillHasConstruction = project.costConstruction - project.progressConstruction > EPS;
        const canPayMore =
          ducatRatio <= 0 || (remainingCountryDucats > EPS && project.costDucats - project.progressConstruction * ducatRatio > EPS);
        if (stillHasConstruction && canPayMore) {
          nextActiveRefs.push(ref);
        }
      }
      if (progressedInRound <= EPS) {
        break;
      }
      activeRefs = nextActiveRefs;
    }

    countryResource.construction = Math.max(0, Number((countryResource.construction - spentConstruction).toFixed(3)));
    countryResource.ducats = Math.max(0, Number((countryResource.ducats - spentDucats).toFixed(3)));
  }

  for (const [provinceId, queue] of Object.entries(worldBase.provinceConstructionQueueByProvince ?? {})) {
    if (!Array.isArray(queue) || queue.length === 0) continue;
    const nextQueue: ProvinceConstructionProject[] = [];
    const buildingInstances = [...(worldBase.provinceBuildingsByProvince[provinceId] ?? [])];
    for (const project of queue) {
      if (project.progressConstruction + 1e-9 >= project.costConstruction) {
        const building = buildingById.get(project.buildingId);
        const startingDucats = Math.max(0, Number(building?.startingDucats ?? 0));
        buildingInstances.push({
          instanceId: randomUUID(),
          buildingId: project.buildingId,
          owner: project.owner,
          createdTurnId: turnId,
          ducats: Number(startingDucats.toFixed(3)),
        });
        continue;
      }
      nextQueue.push(project);
    }
    worldBase.provinceBuildingsByProvince[provinceId] = buildingInstances;
    worldBase.provinceConstructionQueueByProvince[provinceId] = nextQueue;
  }
}

function rollIntInRange(minValue: number, maxValue: number): number {
  const min = Math.max(0, Number.isFinite(minValue) ? minValue : 0);
  const max = Math.max(min, Number.isFinite(maxValue) ? maxValue : min);
  const value = min + Math.random() * (max - min);
  return round3(value);
}

function rollWeightedChoice<T>(items: Array<{ weight: number; value: T }>): T | null {
  const prepared = items
    .map((item) => ({ ...item, weight: Math.max(0, Number(item.weight)) }))
    .filter((item) => item.weight > 0);
  if (prepared.length === 0) return null;
  const total = prepared.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return null;
  let pivot = Math.random() * total;
  for (const item of prepared) {
    pivot -= item.weight;
    if (pivot <= 0) return item.value;
  }
  return prepared[prepared.length - 1].value;
}

function resolveResourceExplorationTurn(): void {
  const goods = gameSettings.content.goods.filter((good) => Boolean(good.isResourceDiscoverable));
  if (goods.length === 0) return;
  const duration = Math.max(1, Math.floor(Number(gameSettings.economy.explorationDurationTurns ?? 1)));
  const rollsPerExpedition = Math.max(
    1,
    Math.floor(Number(gameSettings.economy.explorationRollsPerExpedition ?? DEFAULT_EXPLORATION_ROLLS_PER_EXPEDITION)),
  );
  const baseEmptyChancePct = Math.max(
    0,
    Math.min(100, Number(gameSettings.economy.explorationBaseEmptyChancePct ?? DEFAULT_EXPLORATION_EMPTY_CHANCE_PCT)),
  );
  const depletionPerAttemptPct = Math.max(
    0,
    Math.min(
      100,
      Number(gameSettings.economy.explorationDepletionPerAttemptPct ?? DEFAULT_EXPLORATION_DEPLETION_PER_ATTEMPT_PCT),
    ),
  );

  for (const province of adm1ProvinceIndex) {
    const provinceId = province.id;
    const ownerCountryId = worldBase.provinceOwner[provinceId] ?? null;
    const queue = [...(worldBase.provinceResourceExplorationQueueByProvince[provinceId] ?? [])];
    if (queue.length === 0) continue;
    const nextQueue: ProvinceResourceExplorationProject[] = [];
    let explorationCount = Math.max(0, Math.floor(worldBase.provinceResourceExplorationCountByProvince[provinceId] ?? 0));
    const deposits = [...(worldBase.provinceResourceDepositsByProvince[provinceId] ?? [])];
    for (const project of queue) {
      if (!ownerCountryId || project.requestedByCountryId !== ownerCountryId) {
        continue;
      }
      const nextTurnsRemaining = Math.max(0, Math.floor(project.turnsRemaining) - 1);
      if (nextTurnsRemaining > 0) {
        nextQueue.push({ ...project, turnsRemaining: nextTurnsRemaining });
        continue;
      }
      const emptyChancePct = Math.max(0, Math.min(99.9, baseEmptyChancePct + explorationCount * depletionPerAttemptPct));
      const areaKm2 = getProvinceAreaKm2(provinceId);
      const areaFactor = Math.max(0.001, areaKm2 / 1000);
      const foundByGoodId = new Map<string, { amount: number; veinSize: "small" | "medium" | "large" }>();

      for (let roll = 0; roll < rollsPerExpedition; roll += 1) {
        if (Math.random() * 100 < emptyChancePct) continue;
        const chosenGoodId = rollWeightedChoice(
          goods.map((good) => ({
            weight: Math.max(0, Number(good.explorationBaseWeight ?? 0)) * areaFactor,
            value: good.id,
          })),
        );
        if (!chosenGoodId) continue;
        const good = goods.find((entry) => entry.id === chosenGoodId);
        if (!good) continue;
        const smallChance = Math.max(0, Number(good.explorationSmallVeinChancePct ?? 60));
        const mediumChance = Math.max(0, Number(good.explorationMediumVeinChancePct ?? 30));
        const largeChance = Math.max(0, Number(good.explorationLargeVeinChancePct ?? 10));
        const chosenVeinSize =
          rollWeightedChoice<"small" | "medium" | "large">([
            { weight: smallChance, value: "small" },
            { weight: mediumChance, value: "medium" },
            { weight: largeChance, value: "large" },
          ]) ?? "small";
        const amount =
          chosenVeinSize === "small"
            ? rollIntInRange(Number(good.explorationSmallVeinMin ?? 10), Number(good.explorationSmallVeinMax ?? 100))
            : chosenVeinSize === "medium"
              ? rollIntInRange(
                  Number(good.explorationMediumVeinMin ?? 100),
                  Number(good.explorationMediumVeinMax ?? 500),
                )
              : rollIntInRange(Number(good.explorationLargeVeinMin ?? 500), Number(good.explorationLargeVeinMax ?? 2000));
        if (amount <= 0) continue;
        const prev = foundByGoodId.get(chosenGoodId);
        foundByGoodId.set(chosenGoodId, {
          amount: round3((prev?.amount ?? 0) + amount),
          veinSize: prev?.veinSize ?? chosenVeinSize,
        });
      }

      for (const [goodId, found] of foundByGoodId.entries()) {
        const existing = deposits.find((row) => row.goodId === goodId);
        if (existing) {
          existing.amount = round3(existing.amount + found.amount);
          continue;
        }
        deposits.push({
          goodId,
          amount: round3(found.amount),
          discoveredTurnId: turnId,
          veinSize: found.veinSize,
        });
      }
      explorationCount += 1;
    }
    worldBase.provinceResourceExplorationQueueByProvince[provinceId] = nextQueue;
    worldBase.provinceResourceExplorationCountByProvince[provinceId] = explorationCount;
    worldBase.provinceResourceDepositsByProvince[provinceId] = deposits.sort((a, b) => a.goodId.localeCompare(b.goodId));
    if (worldBase.provinceResourceExplorationQueueByProvince[provinceId].length === 0 && duration > 0) {
      // Keep array shape stable for delta and UI.
      worldBase.provinceResourceExplorationQueueByProvince[provinceId] = [];
    }
  }
}

function resolveTurn(): { rejectedOrders: WorldDelta["rejectedOrders"]; news: EventLogEntry[]; previousWorldBase: WorldBaseSectionSnapshot } {
  const previousWorldBase = cloneWorldBaseSectionSnapshot(
    WORLD_DELTA_MASK.resourcesByCountry |
      WORLD_DELTA_MASK.provinceOwner |
      WORLD_DELTA_MASK.colonyProgressByProvince |
      WORLD_DELTA_MASK.provincePopulationByProvince |
      WORLD_DELTA_MASK.provinceBuildingsByProvince |
      WORLD_DELTA_MASK.provinceBuildingDucatsByProvince |
      WORLD_DELTA_MASK.provincePopulationTreasuryByProvince |
      WORLD_DELTA_MASK.provinceConstructionQueueByProvince |
      WORLD_DELTA_MASK.provinceResourceDepositsByProvince |
      WORLD_DELTA_MASK.provinceResourceExplorationQueueByProvince |
      WORLD_DELTA_MASK.provinceResourceExplorationCountByProvince,
  );
  const currentOrders = ordersByTurn.get(turnId) ?? new Map<string, Order[]>();
  const rejectedOrders: WorldDelta["rejectedOrders"] = [];
  const news: EventLogEntry[] = [];
  const buildingById = new Map(gameSettings.content.buildings.map((entry) => [entry.id, entry] as const));

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
        if (!owner || owner !== order.countryId) {
          rejectedOrders.push({ playerId, reason: "BUILD_CONFLICT", tempOrderId: order.id });
          continue;
        }
        const payload = (order.payload ?? {}) as Record<string, unknown>;
        const buildingId = parseRequestedBuildingIdFromPayload(payload);
        const building = buildingById.get(buildingId);
        const ownerForProject = resolveBuildingOwnerFromPayload(payload, order.countryId);
        if (!buildingId || !building || !ownerForProject) {
          rejectedOrders.push({ playerId, reason: "BUILD_INVALID", tempOrderId: order.id });
          continue;
        }
        if (!isCountryAllowedForBuildingSync(building, order.countryId)) {
          rejectedOrders.push({ playerId, reason: "BUILD_INVALID", tempOrderId: order.id });
          continue;
        }
        const counts = countBuildingOccurrences(buildingId, order.countryId, { includePendingOrders: false });
        const countryLimit = getCountryBuildLimit(building, order.countryId);
        const globalLimit =
          typeof building.globalBuildLimit === "number" && Number.isFinite(building.globalBuildLimit)
            ? Math.max(1, Math.floor(building.globalBuildLimit))
            : null;
        if (countryLimit != null && counts.byCountry >= countryLimit) {
          rejectedOrders.push({ playerId, reason: "BUILD_INVALID", tempOrderId: order.id });
          continue;
        }
        if (globalLimit != null && counts.global >= globalLimit) {
          rejectedOrders.push({ playerId, reason: "BUILD_INVALID", tempOrderId: order.id });
          continue;
        }
        const queue = [...(worldBase.provinceConstructionQueueByProvince[order.provinceId] ?? [])];
        queue.push({
          queueId: randomUUID(),
          requestedByCountryId: order.countryId,
          buildingId,
          owner: ownerForProject,
          progressConstruction: 0,
          costConstruction: Math.max(1, Math.floor(Number(building.costConstruction ?? 100))),
          costDucats: Math.max(0, Number(building.costDucats ?? 10)),
          createdTurnId: turnId,
        });
        worldBase.provinceConstructionQueueByProvince[order.provinceId] = queue;
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

  resolveBuildingConstructionQueuesTurn();
  resolveResourceExplorationTurn();

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
    resource.construction += gameSettings.economy.baseConstructionPerTurn;
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

app.get("/economy/market-overview", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  ensureCountryInWorldBase(auth.countryId);
  const countryId = auth.countryId;
  const marketId = getCountryMarketId(countryId);
  const marketRecord = getMarketById(marketId);
  const goods = gameSettings.content.goods.map((good) => {
    const countryDemand = Number(latestMarketOverview.demandByCountry[marketId]?.[good.id] ?? 0);
    const countryOffer = Number(latestMarketOverview.offerByCountry[marketId]?.[good.id] ?? 0);
    const globalDemand = Number(latestMarketOverview.demandGlobal[good.id] ?? 0);
    const globalOffer = Number(latestMarketOverview.offerGlobal[good.id] ?? 0);
    const countryCoveragePct = countryDemand > 0 ? round3((countryOffer / countryDemand) * 100) : 100;
    const globalCoveragePct = globalDemand > 0 ? round3((globalOffer / globalDemand) * 100) : 100;
    return {
      goodId: good.id,
      goodName: good.name,
      countryPrice: round3(Math.max(0, Number(countryGoodPrices[getCountryMarketId(countryId)]?.[good.id] ?? good.basePrice ?? 1))),
      globalPrice: round3(Math.max(0, Number(globalGoodPrices[good.id] ?? good.basePrice ?? 1))),
      countryDemand: round3(countryDemand),
      countryOffer: round3(countryOffer),
      countryCoveragePct,
      globalDemand: round3(globalDemand),
      globalOffer: round3(globalOffer),
      globalCoveragePct,
      countryPriceHistory: (marketRecord?.priceHistoryByResourceId?.[good.id] ?? []).map((value) => round3(value)),
      globalPriceHistory: (globalGoodPriceHistoryByResourceId[good.id] ?? []).map((value) => round3(value)),
      countryDemandHistory: (marketRecord?.demandHistoryByResourceId?.[good.id] ?? []).map((value) => round3(value)),
      countryOfferHistory: (marketRecord?.offerHistoryByResourceId?.[good.id] ?? []).map((value) => round3(value)),
      globalDemandHistory: (globalGoodDemandHistoryByResourceId[good.id] ?? []).map((value) => round3(value)),
      globalOfferHistory: (globalGoodOfferHistoryByResourceId[good.id] ?? []).map((value) => round3(value)),
      countryProductionFactHistory: (marketRecord?.productionFactHistoryByResourceId?.[good.id] ?? []).map((value) =>
        round3(value),
      ),
      countryProductionMaxHistory: (marketRecord?.productionMaxHistoryByResourceId?.[good.id] ?? []).map((value) =>
        round3(value),
      ),
      globalProductionFactHistory: (globalGoodProductionFactHistoryByResourceId[good.id] ?? []).map((value) =>
        round3(value),
      ),
      globalProductionMaxHistory: (globalGoodProductionMaxHistoryByResourceId[good.id] ?? []).map((value) =>
        round3(value),
      ),
    };
  });
  const infraByProvince = Object.fromEntries(
    Object.entries(latestMarketOverview.infraByProvince).filter(
      ([provinceId]) => (worldBase.provinceOwner[provinceId] ?? null) === countryId,
    ),
  );
  const sharedInfrastructureByMarket = Object.values(gameSettings.markets.marketById).map((market) => {
    const capacityByCategory = normalizeCategoryAmountMap(market.lastSharedInfrastructureCapacityByCategory ?? {});
    const consumedByCategory = normalizeCategoryAmountMap(market.lastSharedInfrastructureConsumedByCategory ?? {});
    const availableByCategory = Object.fromEntries(
      [...new Set([...Object.keys(capacityByCategory), ...Object.keys(consumedByCategory)])].map((categoryId) => [
        categoryId,
        round3(Math.max(0, Number(capacityByCategory[categoryId] ?? 0) - Number(consumedByCategory[categoryId] ?? 0))),
      ]),
    );
    const capacity = round3(
      Object.values(capacityByCategory).reduce(
        (sum, value) => sum + Math.max(0, Number(value)),
        0,
      ),
    );
    const consumed = round3(
      Object.values(consumedByCategory).reduce(
        (sum, value) => sum + Math.max(0, Number(value)),
        0,
      ),
    );
    return {
      marketId: market.id,
      marketName: getMarketDisplayName({
        marketId: market.id,
        marketName: market.name,
        ownerCountryName: null,
      }),
      capacity,
      consumed,
      available: round3(Math.max(0, capacity - consumed)),
      capacityByCategory,
      consumedByCategory,
      availableByCategory,
    };
  });
  const tradeByGood = Object.fromEntries(
    gameSettings.content.goods.map((good) => [
      good.id,
      {
        countryImportsByCountry: latestMarketOverview.importsByCountryByCountryAndGood[countryId]?.[good.id] ?? {},
        countryExportsByCountry: latestMarketOverview.exportsByCountryByCountryAndGood[countryId]?.[good.id] ?? {},
        globalImportsByMarket: latestMarketOverview.importsByMarketByMarketAndGood[marketId]?.[good.id] ?? {},
        globalExportsByMarket: latestMarketOverview.exportsByMarketByMarketAndGood[marketId]?.[good.id] ?? {},
      },
    ]),
  );
  return res.json({
    turnId,
    countryId,
    marketId,
    goods,
    tradeByGood,
    infraByProvince,
    sharedInfrastructureByMarket,
    alerts: latestMarketOverview.alertsByCountry[countryId] ?? [],
  });
});

const marketInviteCreateSchema = z.object({
  toCountryId: z.string().trim().min(1).max(120),
  expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
});

const marketInviteActionSchema = z.object({
  action: z.enum(["accept", "reject", "cancel"]),
});

const marketTransferOwnerSchema = z.object({
  nextOwnerCountryId: z.string().trim().min(1).max(120),
});

const marketPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  visibility: z.enum(["public", "private"]).optional(),
});

const marketSanctionCreateSchema = z.object({
  direction: z.enum(["import", "export", "both"]),
  targetType: z.enum(["country", "market"]),
  targetId: z.string().trim().min(1).max(120),
  goods: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
  mode: z.enum(["ban", "cap"]),
  capAmountPerTurn: z.coerce.number().min(0).max(SETTINGS_MAX_NUMBER).nullable().optional(),
  startTurn: z.coerce.number().int().min(1).optional(),
  durationTurns: z.coerce.number().int().min(1).max(SETTINGS_MAX_NUMBER),
  enabled: z.boolean().optional(),
});

const marketSanctionPatchSchema = z.object({
  direction: z.enum(["import", "export", "both"]).optional(),
  targetType: z.enum(["country", "market"]).optional(),
  targetId: z.string().trim().min(1).max(120).optional(),
  goods: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
  mode: z.enum(["ban", "cap"]).optional(),
  capAmountPerTurn: z.coerce.number().min(0).max(SETTINGS_MAX_NUMBER).nullable().optional(),
  startTurn: z.coerce.number().int().min(1).optional(),
  durationTurns: z.coerce.number().int().min(1).max(SETTINGS_MAX_NUMBER).optional(),
  enabled: z.boolean().optional(),
});

async function buildMarketDetailsResponse(marketId: string): Promise<{
  market: {
    id: string;
    name: string;
    logoUrl: string | null;
    ownerCountryId: string;
    ownerCountryName: string;
    memberCountryIds: string[];
    visibility: "public" | "private";
    createdAt: string;
    members: Array<{ countryId: string; countryName: string; flagUrl: string | null; isOwner: boolean }>;
  };
}> {
  const market = getMarketById(marketId);
  if (!market) {
    throw new Error("MARKET_NOT_FOUND");
  }
  const countries = await prisma.country.findMany({
    where: { id: { in: market.memberCountryIds } },
    select: { id: true, name: true, flagUrl: true },
  });
  const byId = new Map(countries.map((country) => [country.id, country] as const));
  const members = market.memberCountryIds.map((countryId) => {
    const country = byId.get(countryId);
    return {
      countryId,
      countryName: country?.name ?? countryId,
      flagUrl: country?.flagUrl ?? null,
      isOwner: market.ownerCountryId === countryId,
    };
  });
  return {
    market: {
      id: market.id,
      name: getMarketDisplayName({
        marketId: market.id,
        marketName: market.name,
        ownerCountryName: byId.get(market.ownerCountryId)?.name ?? market.ownerCountryId,
      }),
      logoUrl: market.logoUrl,
      ownerCountryId: market.ownerCountryId,
      ownerCountryName: byId.get(market.ownerCountryId)?.name ?? market.ownerCountryId,
      memberCountryIds: [...market.memberCountryIds],
      visibility: market.visibility,
      createdAt: market.createdAt,
      members,
    },
  };
}

async function enrichMarketInvites(
  invites: Array<(typeof gameSettings.markets.marketInvitesById)[string]>,
): Promise<
  Array<
    (typeof gameSettings.markets.marketInvitesById)[string] & {
      marketName: string;
      marketLogoUrl: string | null;
      fromCountryName: string;
      fromCountryFlagUrl: string | null;
      toCountryName: string;
      toCountryFlagUrl: string | null;
    }
  >
> {
  const countryIds = [...new Set(invites.flatMap((invite) => [invite.fromCountryId, invite.toCountryId]))];
  const countries = countryIds.length
    ? await prisma.country.findMany({ where: { id: { in: countryIds } }, select: { id: true, name: true, flagUrl: true } })
    : [];
  const countryById = new Map(countries.map((country) => [country.id, country] as const));
  return invites.map((invite) => ({
    ...invite,
    marketName: getMarketDisplayName({
      marketId: invite.marketId,
      marketName: gameSettings.markets.marketById[invite.marketId]?.name ?? "",
      ownerCountryName: countryById.get(gameSettings.markets.marketById[invite.marketId]?.ownerCountryId ?? "")?.name ?? null,
    }),
    marketLogoUrl: gameSettings.markets.marketById[invite.marketId]?.logoUrl ?? null,
    fromCountryName: countryById.get(invite.fromCountryId)?.name ?? invite.fromCountryId,
    fromCountryFlagUrl: countryById.get(invite.fromCountryId)?.flagUrl ?? null,
    toCountryName: countryById.get(invite.toCountryId)?.name ?? invite.toCountryId,
    toCountryFlagUrl: countryById.get(invite.toCountryId)?.flagUrl ?? null,
  }));
}

async function enrichMarketSanctions(
  sanctions: MarketSanctionEntry[],
): Promise<
  Array<
    MarketSanctionEntry & {
      initiatorCountryName: string;
      targetName: string;
      goodsNamed: Array<{ id: string; name: string }>;
      activeNow: boolean;
      expiresAtTurn: number;
    }
  >
> {
  const countryIds = new Set<string>();
  for (const sanction of sanctions) {
    countryIds.add(sanction.initiatorCountryId);
    if (sanction.targetType === "country") countryIds.add(sanction.targetId);
  }
  const countries = countryIds.size
    ? await prisma.country.findMany({
        where: { id: { in: [...countryIds] } },
        select: { id: true, name: true },
      })
    : [];
  const countryById = new Map(countries.map((country) => [country.id, country.name] as const));
  const goodsById = new Map(gameSettings.content.goods.map((good) => [good.id, good.name] as const));
  return sanctions.map((sanction) => {
    const targetName =
      sanction.targetType === "country"
        ? countryById.get(sanction.targetId) ?? sanction.targetId
        : getMarketDisplayName({
            marketId: sanction.targetId,
            marketName: gameSettings.markets.marketById[sanction.targetId]?.name ?? sanction.targetId,
            ownerCountryName: null,
          });
    const goodsNamed = (sanction.goods ?? []).map((id) => ({ id, name: goodsById.get(id) ?? id }));
    const expiresAtTurn = sanction.startTurn + sanction.durationTurns;
    const activeNow =
      sanction.enabled !== false && turnId >= sanction.startTurn && turnId < sanction.startTurn + sanction.durationTurns;
    return {
      ...sanction,
      initiatorCountryName: countryById.get(sanction.initiatorCountryId) ?? sanction.initiatorCountryId,
      targetName,
      goodsNamed,
      activeNow,
      expiresAtTurn,
    };
  });
}

app.get("/markets/:marketId", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const marketId = String(req.params.marketId || "").trim();
  if (!marketId) {
    return res.status(400).json({ error: "MARKET_ID_REQUIRED" });
  }
  const market = getMarketById(marketId);
  if (!market) {
    return res.status(404).json({ error: "MARKET_NOT_FOUND" });
  }
  const isMember = market.memberCountryIds.includes(auth.countryId);
  const isPublic = market.visibility === "public";
  if (!isMember && !isPublic) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  try {
    return res.json(await buildMarketDetailsResponse(marketId));
  } catch {
    return res.status(404).json({ error: "MARKET_NOT_FOUND" });
  }
});

app.get("/markets", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  ensureMarketModelReady();
  const countries = await prisma.country.findMany({
    where: { id: { in: Object.values(gameSettings.markets.marketById).map((market) => market.ownerCountryId) } },
    select: { id: true, name: true, flagUrl: true },
  });
  const countryById = new Map(countries.map((country) => [country.id, country] as const));
  const markets = Object.values(gameSettings.markets.marketById)
    .map((market) => {
      const owner = countryById.get(market.ownerCountryId);
      const isMember = market.memberCountryIds.includes(auth.countryId);
      const pendingRequest = Object.values(gameSettings.markets.marketInvitesById).some(
        (invite) =>
          invite.marketId === market.id &&
          invite.kind === "join-request" &&
          invite.fromCountryId === auth.countryId &&
          invite.status === "pending",
      );
      return {
        id: market.id,
        name: getMarketDisplayName({
          marketId: market.id,
          marketName: market.name,
          ownerCountryName: owner?.name ?? market.ownerCountryId,
        }),
        logoUrl: market.logoUrl,
        ownerCountryId: market.ownerCountryId,
        ownerCountryName: owner?.name ?? market.ownerCountryId,
        ownerCountryFlagUrl: owner?.flagUrl ?? null,
        visibility: market.visibility,
        membersCount: market.memberCountryIds.length,
        isMember,
        canJoinDirectly: !isMember && market.visibility === "public",
        canRequestJoin: !isMember && market.visibility === "private" && !pendingRequest,
        hasPendingJoinRequest: pendingRequest,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return res.json({ markets });
});

app.patch("/markets/:marketId", upload.single("marketLogo"), async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const marketId = String(req.params.marketId || "").trim();
  const market = getMarketById(marketId);
  if (!market) {
    removeUploadedFile(req.file as Express.Multer.File | undefined);
    return res.status(404).json({ error: "MARKET_NOT_FOUND" });
  }
  if (market.ownerCountryId !== auth.countryId) {
    removeUploadedFile(req.file as Express.Multer.File | undefined);
    return res.status(403).json({ error: "MARKET_OWNER_ONLY" });
  }
  const parsed = marketPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    removeUploadedFile(req.file as Express.Multer.File | undefined);
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }
  const logoFile = req.file as Express.Multer.File | undefined;
  if (logoFile && !validateImageDimensions(logoFile)) {
    removeUploadedFile(logoFile);
    return res.status(400).json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", field: "marketLogo", max: "256x256" });
  }

  if (typeof parsed.data.name === "string") {
    market.name = parsed.data.name.trim();
  }
  if (typeof parsed.data.visibility === "string") {
    market.visibility = normalizeMarketVisibility(parsed.data.visibility);
  }
  if (logoFile) {
    const previous = market.logoUrl;
    market.logoUrl = makeVersionedUploadUrl(`markets/${logoFile.filename}`);
    if (previous) {
      removeUploadedByUrl(previous);
    }
  }
  market.id = marketId;
  savePersistentState();
  return res.json(await buildMarketDetailsResponse(marketId));
});

app.post("/markets/:marketId/invites", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const marketId = String(req.params.marketId || "").trim();
  const market = getMarketById(marketId);
  if (!market) {
    return res.status(404).json({ error: "MARKET_NOT_FOUND" });
  }
  if (market.ownerCountryId !== auth.countryId) {
    return res.status(403).json({ error: "MARKET_OWNER_ONLY" });
  }
  const parsed = marketInviteCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }
  const toCountryId = parsed.data.toCountryId;
  const target = await prisma.country.findUnique({ where: { id: toCountryId }, select: { id: true, name: true } });
  if (!target) {
    return res.status(404).json({ error: "COUNTRY_NOT_FOUND" });
  }
  if (market.memberCountryIds.includes(toCountryId)) {
    return res.status(400).json({ error: "COUNTRY_ALREADY_IN_MARKET" });
  }
  const hasPending = Object.values(gameSettings.markets.marketInvitesById).some(
    (invite) => invite.marketId === marketId && invite.toCountryId === toCountryId && invite.status === "pending",
  );
  if (hasPending) {
    return res.status(409).json({ error: "INVITE_ALREADY_PENDING" });
  }
  const now = new Date();
  const expiresInDays = parsed.data.expiresInDays ?? 14;
  const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const inviteId = randomUUID();
  gameSettings.markets.marketInvitesById[inviteId] = {
    id: inviteId,
    marketId,
    fromCountryId: auth.countryId,
    toCountryId,
    kind: "invite",
    status: "pending",
    expiresAt,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  savePersistentState();
  return res.status(201).json({ invite: gameSettings.markets.marketInvitesById[inviteId] });
});

app.get("/markets/:marketId/invites", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const marketId = String(req.params.marketId || "").trim();
  const market = getMarketById(marketId);
  if (!market) {
    return res.status(404).json({ error: "MARKET_NOT_FOUND" });
  }
  if (market.ownerCountryId !== auth.countryId) {
    return res.status(403).json({ error: "MARKET_OWNER_ONLY" });
  }
  const invites = Object.values(gameSettings.markets.marketInvitesById)
    .filter((invite) => invite.marketId === marketId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return res.json({ invites: await enrichMarketInvites(invites) });
});

app.get("/markets/:marketId/sanctions", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const marketId = String(req.params.marketId || "").trim();
  const market = getMarketById(marketId);
  if (!market) {
    return res.status(404).json({ error: "MARKET_NOT_FOUND" });
  }
  const isOwner = market.ownerCountryId === auth.countryId;
  const isMember = market.memberCountryIds.includes(auth.countryId);
  if (!isOwner && !isMember) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const sanctions = Object.values(gameSettings.markets.sanctionsById ?? {})
    .filter((sanction) => sanction.initiatorCountryId === market.ownerCountryId)
    .sort((a, b) => b.startTurn - a.startTurn || a.id.localeCompare(b.id));
  return res.json({
    sanctions: await enrichMarketSanctions(sanctions),
    ownerCountryId: market.ownerCountryId,
    turnId,
  });
});

app.post("/markets/:marketId/sanctions", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const marketId = String(req.params.marketId || "").trim();
  const market = getMarketById(marketId);
  if (!market) {
    return res.status(404).json({ error: "MARKET_NOT_FOUND" });
  }
  if (market.ownerCountryId !== auth.countryId) {
    return res.status(403).json({ error: "MARKET_OWNER_ONLY" });
  }
  const parsed = marketSanctionCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }
  const payload = parsed.data;
  if (payload.targetType === "country") {
    const countryExists = await prisma.country.findUnique({
      where: { id: payload.targetId },
      select: { id: true },
    });
    if (!countryExists) {
      return res.status(404).json({ error: "TARGET_COUNTRY_NOT_FOUND" });
    }
  } else {
    const targetMarket = getMarketById(payload.targetId);
    if (!targetMarket) {
      return res.status(404).json({ error: "TARGET_MARKET_NOT_FOUND" });
    }
  }
  const validGoods = new Set(gameSettings.content.goods.map((good) => good.id));
  const goods = [...new Set((payload.goods ?? []).map((goodId) => goodId.trim()).filter(Boolean))].filter((goodId) =>
    validGoods.has(goodId),
  );
  if ((payload.goods ?? []).length > 0 && goods.length === 0) {
    return res.status(400).json({ error: "NO_VALID_GOODS" });
  }
  if (payload.mode === "cap" && (payload.capAmountPerTurn == null || payload.capAmountPerTurn <= 0)) {
    return res.status(400).json({ error: "CAP_AMOUNT_REQUIRED" });
  }
  const sanctionId = randomUUID();
  const sanction: MarketSanctionEntry = {
    id: sanctionId,
    initiatorCountryId: market.ownerCountryId,
    direction: payload.direction,
    targetType: payload.targetType,
    targetId: payload.targetId,
    goods,
    mode: payload.mode,
    capAmountPerTurn: payload.mode === "cap" ? round3(Math.max(0, Number(payload.capAmountPerTurn ?? 0))) : null,
    startTurn: payload.startTurn ?? turnId,
    durationTurns: payload.durationTurns,
    enabled: payload.enabled ?? true,
  };
  gameSettings.markets.sanctionsById[sanctionId] = sanction;
  savePersistentState();
  return res.status(201).json({ sanction: (await enrichMarketSanctions([sanction]))[0] });
});

app.patch("/markets/:marketId/sanctions/:sanctionId", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const marketId = String(req.params.marketId || "").trim();
  const market = getMarketById(marketId);
  if (!market) {
    return res.status(404).json({ error: "MARKET_NOT_FOUND" });
  }
  if (market.ownerCountryId !== auth.countryId) {
    return res.status(403).json({ error: "MARKET_OWNER_ONLY" });
  }
  const sanctionId = String(req.params.sanctionId || "").trim();
  const sanction = gameSettings.markets.sanctionsById[sanctionId];
  if (!sanction || sanction.initiatorCountryId !== market.ownerCountryId) {
    return res.status(404).json({ error: "SANCTION_NOT_FOUND" });
  }
  const parsed = marketSanctionPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }
  const payload = parsed.data;
  const nextTargetType = payload.targetType ?? sanction.targetType;
  const nextTargetId = payload.targetId ?? sanction.targetId;
  if (nextTargetType === "country") {
    const countryExists = await prisma.country.findUnique({ where: { id: nextTargetId }, select: { id: true } });
    if (!countryExists) return res.status(404).json({ error: "TARGET_COUNTRY_NOT_FOUND" });
  } else {
    const targetMarket = getMarketById(nextTargetId);
    if (!targetMarket) return res.status(404).json({ error: "TARGET_MARKET_NOT_FOUND" });
  }
  if (Array.isArray(payload.goods)) {
    const validGoods = new Set(gameSettings.content.goods.map((good) => good.id));
    const goods = [...new Set(payload.goods.map((goodId) => goodId.trim()).filter(Boolean))].filter((goodId) =>
      validGoods.has(goodId),
    );
    if (payload.goods.length > 0 && goods.length === 0) {
      return res.status(400).json({ error: "NO_VALID_GOODS" });
    }
    sanction.goods = goods;
  }
  sanction.direction = payload.direction ?? sanction.direction;
  sanction.targetType = nextTargetType;
  sanction.targetId = nextTargetId;
  sanction.mode = payload.mode ?? sanction.mode;
  sanction.startTurn = payload.startTurn ?? sanction.startTurn;
  sanction.durationTurns = payload.durationTurns ?? sanction.durationTurns;
  sanction.enabled = payload.enabled ?? sanction.enabled;
  if (sanction.mode === "cap") {
    const cap = payload.capAmountPerTurn ?? sanction.capAmountPerTurn;
    if (cap == null || cap <= 0) {
      return res.status(400).json({ error: "CAP_AMOUNT_REQUIRED" });
    }
    sanction.capAmountPerTurn = round3(Math.max(0, Number(cap)));
  } else {
    sanction.capAmountPerTurn = null;
  }
  savePersistentState();
  return res.json({ sanction: (await enrichMarketSanctions([sanction]))[0] });
});

app.delete("/markets/:marketId/sanctions/:sanctionId", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const marketId = String(req.params.marketId || "").trim();
  const market = getMarketById(marketId);
  if (!market) {
    return res.status(404).json({ error: "MARKET_NOT_FOUND" });
  }
  if (market.ownerCountryId !== auth.countryId) {
    return res.status(403).json({ error: "MARKET_OWNER_ONLY" });
  }
  const sanctionId = String(req.params.sanctionId || "").trim();
  const sanction = gameSettings.markets.sanctionsById[sanctionId];
  if (!sanction || sanction.initiatorCountryId !== market.ownerCountryId) {
    return res.status(404).json({ error: "SANCTION_NOT_FOUND" });
  }
  delete gameSettings.markets.sanctionsById[sanctionId];
  savePersistentState();
  return res.json({ ok: true });
});

app.get("/country/market-invites", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const nowMs = Date.now();
  const invites = Object.values(gameSettings.markets.marketInvitesById)
    .filter((invite) => invite.toCountryId === auth.countryId && invite.status === "pending")
    .filter((invite) => new Date(invite.expiresAt).getTime() > nowMs)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return res.json({ invites: await enrichMarketInvites(invites) });
});

app.patch("/market-invites/:inviteId", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const parsed = marketInviteActionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }
  const inviteId = String(req.params.inviteId || "").trim();
  const invite = gameSettings.markets.marketInvitesById[inviteId];
  if (!invite) {
    return res.status(404).json({ error: "INVITE_NOT_FOUND" });
  }
  if (invite.status !== "pending") {
    return res.status(409).json({ error: "INVITE_ALREADY_RESOLVED" });
  }
  const market = getMarketById(invite.marketId);
  const isRecipient = invite.toCountryId === auth.countryId;
  const isMarketOwner = market?.ownerCountryId === auth.countryId;
  const isSender = invite.fromCountryId === auth.countryId;
  if (parsed.data.action === "cancel") {
    if (!isSender && !isMarketOwner) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    invite.status = "canceled";
    invite.updatedAt = new Date().toISOString();
    savePersistentState();
    return res.json({ invite });
  }
  if (!isRecipient) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  if (new Date(invite.expiresAt).getTime() <= Date.now()) {
    invite.status = "canceled";
    invite.updatedAt = new Date().toISOString();
    savePersistentState();
    return res.status(409).json({ error: "INVITE_EXPIRED" });
  }
  invite.status = parsed.data.action === "accept" ? "accepted" : "rejected";
  invite.updatedAt = new Date().toISOString();
  if (parsed.data.action === "accept") {
    const targetCountryId = invite.kind === "join-request" ? invite.fromCountryId : invite.toCountryId;
    upsertMarketMembership(targetCountryId, invite.marketId);
    rebuildCountryMarketIndexFromMembers();
  }
  savePersistentState();
  return res.json({ invite });
});

app.post("/markets/:marketId/leave", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const marketId = String(req.params.marketId || "").trim();
  const market = getMarketById(marketId);
  if (!market) {
    return res.status(404).json({ error: "MARKET_NOT_FOUND" });
  }
  if (!market.memberCountryIds.includes(auth.countryId)) {
    return res.status(403).json({ error: "NOT_MARKET_MEMBER" });
  }
  if (market.ownerCountryId === auth.countryId) {
    return res.status(400).json({ error: "OWNER_CANNOT_LEAVE" });
  }
  upsertMarketMembership(auth.countryId, auth.countryId);
  rebuildCountryMarketIndexFromMembers();
  savePersistentState();
  return res.json({ ok: true, marketIdLeft: marketId, newMarketId: getCountryMarketId(auth.countryId) });
});

app.post("/markets/:marketId/join", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const marketId = String(req.params.marketId || "").trim();
  const market = getMarketById(marketId);
  if (!market) {
    return res.status(404).json({ error: "MARKET_NOT_FOUND" });
  }
  if (market.memberCountryIds.includes(auth.countryId)) {
    return res.status(409).json({ error: "COUNTRY_ALREADY_IN_MARKET" });
  }
  if (market.visibility === "public") {
    upsertMarketMembership(auth.countryId, marketId);
    rebuildCountryMarketIndexFromMembers();
    savePersistentState();
    return res.json({ mode: "joined", ...(await buildMarketDetailsResponse(marketId)) });
  }
  const hasPending = Object.values(gameSettings.markets.marketInvitesById).some(
    (invite) =>
      invite.marketId === marketId &&
      invite.kind === "join-request" &&
      invite.fromCountryId === auth.countryId &&
      invite.toCountryId === market.ownerCountryId &&
      invite.status === "pending",
  );
  if (hasPending) {
    return res.status(409).json({ error: "JOIN_REQUEST_ALREADY_PENDING" });
  }
  const now = new Date();
  const inviteId = randomUUID();
  gameSettings.markets.marketInvitesById[inviteId] = {
    id: inviteId,
    marketId,
    fromCountryId: auth.countryId,
    toCountryId: market.ownerCountryId,
    kind: "join-request",
    status: "pending",
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  savePersistentState();
  return res.json({ mode: "requested", invite: gameSettings.markets.marketInvitesById[inviteId] });
});

app.post("/markets/:marketId/transfer-owner", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const marketId = String(req.params.marketId || "").trim();
  const market = getMarketById(marketId);
  if (!market) {
    return res.status(404).json({ error: "MARKET_NOT_FOUND" });
  }
  if (market.ownerCountryId !== auth.countryId) {
    return res.status(403).json({ error: "MARKET_OWNER_ONLY" });
  }
  const parsed = marketTransferOwnerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }
  const nextOwnerCountryId = parsed.data.nextOwnerCountryId;
  if (!market.memberCountryIds.includes(nextOwnerCountryId)) {
    return res.status(400).json({ error: "NEXT_OWNER_NOT_MARKET_MEMBER" });
  }
  market.ownerCountryId = nextOwnerCountryId;
  savePersistentState();
  return res.json(await buildMarketDetailsResponse(marketId));
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
      baseConstructionPerTurn: z.coerce.number().int().min(0).max(SETTINGS_MAX_NUMBER).optional(),
      baseDucatsPerTurn: z.coerce.number().int().min(0).max(SETTINGS_MAX_NUMBER).optional(),
      baseGoldPerTurn: z.coerce.number().int().min(0).max(SETTINGS_MAX_NUMBER).optional(),
      demolitionCostConstructionPercent: z.coerce.number().int().min(0).max(100).optional(),
      marketPriceSmoothing: z.coerce.number().min(0).max(1).optional(),
      explorationBaseEmptyChancePct: z.coerce.number().min(0).max(100).optional(),
      explorationDepletionPerAttemptPct: z.coerce.number().min(0).max(100).optional(),
      explorationDurationTurns: z.coerce.number().int().min(1).max(3650).optional(),
      explorationRollsPerExpedition: z.coerce.number().int().min(1).max(100).optional(),
    })
    .optional(),
  markets: z
    .object({
      countryMarketByCountryId: z.record(z.string().trim().min(1).max(120)).optional(),
      sanctionsById: z
        .record(
          z.object({
            id: z.string().trim().min(1).max(120).optional(),
            initiatorCountryId: z.string().trim().min(1).max(120),
            direction: z.enum(["import", "export", "both"]),
            targetType: z.enum(["country", "market"]),
            targetId: z.string().trim().min(1).max(120),
            goods: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
            mode: z.enum(["ban", "cap"]),
            capAmountPerTurn: z.coerce.number().min(0).max(SETTINGS_MAX_NUMBER).nullable().optional(),
            startTurn: z.coerce.number().int().min(1),
            durationTurns: z.coerce.number().int().min(1).max(SETTINGS_MAX_NUMBER),
            enabled: z.boolean().optional(),
          }),
        )
        .optional(),
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
      pauseWhenNoPlayersOnline: z.boolean().optional(),
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
  return res.json({ imageUrl: makeVersionedUploadUrl(`civilopedia/${file.filename}`) });
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
  return res.json({ imageUrl: makeVersionedUploadUrl(`civilopedia/${file.filename}`) });
});

app.patch(
  "/admin/resource-icons",
  upload.fields([
    { name: "culture", maxCount: 1 },
    { name: "science", maxCount: 1 },
    { name: "religion", maxCount: 1 },
    { name: "colonization", maxCount: 1 },
    { name: "construction", maxCount: 1 },
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
      construction: files?.construction?.[0],
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
      gameSettings.resourceIcons[key] = makeVersionedUploadUrl(`resource-icons/${file.filename}`);
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
  gameSettings.map.backgroundImageUrl = makeVersionedUploadUrl(`ui-backgrounds/${file.filename}`);
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
  resourceCategoryId: z.string().trim().min(1).max(120).nullable().optional(),
  isResourceDiscoverable: z.boolean().optional(),
  basePrice: z.number().finite().min(0).optional(),
  minPrice: z.number().finite().min(0).optional(),
  maxPrice: z.number().finite().min(0).optional(),
  infraPerUnit: z.number().finite().min(0).optional(),
  infrastructureCostPerUnit: z.number().finite().min(0).optional(),
  explorationBaseWeight: z.number().finite().min(0).optional(),
  explorationSmallVeinChancePct: z.number().finite().min(0).optional(),
  explorationMediumVeinChancePct: z.number().finite().min(0).optional(),
  explorationLargeVeinChancePct: z.number().finite().min(0).optional(),
  explorationSmallVeinMin: z.number().finite().min(0).optional(),
  explorationSmallVeinMax: z.number().finite().min(0).optional(),
  explorationMediumVeinMin: z.number().finite().min(0).optional(),
  explorationMediumVeinMax: z.number().finite().min(0).optional(),
  explorationLargeVeinMin: z.number().finite().min(0).optional(),
  explorationLargeVeinMax: z.number().finite().min(0).optional(),
  baseWage: z.number().finite().min(0).optional(),
  costConstruction: z.number().int().min(1).optional(),
  costDucats: z.number().finite().min(0).optional(),
  startingDucats: z.number().finite().min(0).optional(),
  inputs: z
    .array(
      z.object({
        goodId: z.string().trim().min(1).max(120),
        amount: z.number().finite().min(0),
      }),
    )
    .optional(),
  outputs: z
    .array(
      z.object({
        goodId: z.string().trim().min(1).max(120),
        amount: z.number().finite().min(0),
      }),
    )
    .optional(),
  workforceRequirements: z
    .array(
      z.object({
        professionId: z.string().trim().min(1).max(120),
        workers: z.number().int().min(0),
      }),
    )
    .optional(),
  infrastructureUse: z.number().finite().min(0).optional(),
  marketInfrastructureByCategory: z.record(z.string().trim().min(1).max(120), z.number().finite().min(0)).optional(),
  allowedCountryIds: z.array(z.string().trim().min(1).max(120)).optional(),
  deniedCountryIds: z.array(z.string().trim().min(1).max(120)).optional(),
  countryBuildLimits: z
    .array(
      z.object({
        countryId: z.string().trim().min(1).max(120),
        limit: z.number().int().min(1),
      }),
    )
    .optional(),
  globalBuildLimit: z.number().int().min(1).nullable().optional(),
});
const contentEntryKindSchema = z.enum([
  "cultures",
  "resourceCategories",
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

function sanitizeContentEntryByKind(
  kind: ContentEntryKind,
  payload: z.infer<typeof culturePayloadSchema>,
): Partial<GameContentEntry & GoodContentEntry & BuildingContentEntry> {
  if (kind === "goods") {
    const basePrice = Number((payload.basePrice ?? DEFAULT_RESOURCE_BASE_PRICE).toFixed(3));
    const minPrice = Number(Math.max(0, payload.minPrice ?? basePrice * 0.1).toFixed(3));
    const maxPrice = Number(Math.max(minPrice, payload.maxPrice ?? basePrice * 10).toFixed(3));
    const infraRaw = payload.infrastructureCostPerUnit ?? payload.infraPerUnit ?? 1;
    const infraPerUnit = Number(Math.max(0.01, Math.max(0, infraRaw)).toFixed(3));
    const resourceCategoryId =
      payload.resourceCategoryId === undefined
        ? undefined
        : typeof payload.resourceCategoryId === "string" && payload.resourceCategoryId.trim().length > 0
          ? payload.resourceCategoryId.trim()
          : null;
    const isResourceDiscoverable = payload.isResourceDiscoverable ?? false;
    const explorationBaseWeight = Number(Math.max(0, payload.explorationBaseWeight ?? 1).toFixed(3));
    const smallChanceRaw = Math.max(0, Number(payload.explorationSmallVeinChancePct ?? 60));
    const mediumChanceRaw = Math.max(0, Number(payload.explorationMediumVeinChancePct ?? 30));
    const largeChanceRaw = Math.max(0, Number(payload.explorationLargeVeinChancePct ?? 10));
    const chanceSum = smallChanceRaw + mediumChanceRaw + largeChanceRaw;
    const chanceDiv = chanceSum > 0 ? chanceSum / 100 : 1;
    const explorationSmallVeinChancePct = Number((chanceSum > 0 ? smallChanceRaw / chanceDiv : 60).toFixed(3));
    const explorationMediumVeinChancePct = Number((chanceSum > 0 ? mediumChanceRaw / chanceDiv : 30).toFixed(3));
    const explorationLargeVeinChancePct = Number((chanceSum > 0 ? largeChanceRaw / chanceDiv : 10).toFixed(3));
    const explorationSmallVeinMin = Number(Math.max(0, payload.explorationSmallVeinMin ?? 10).toFixed(3));
    const explorationSmallVeinMax = Number(
      Math.max(explorationSmallVeinMin, payload.explorationSmallVeinMax ?? 100).toFixed(3),
    );
    const explorationMediumVeinMin = Number(Math.max(0, payload.explorationMediumVeinMin ?? 100).toFixed(3));
    const explorationMediumVeinMax = Number(
      Math.max(explorationMediumVeinMin, payload.explorationMediumVeinMax ?? 500).toFixed(3),
    );
    const explorationLargeVeinMin = Number(Math.max(0, payload.explorationLargeVeinMin ?? 500).toFixed(3));
    const explorationLargeVeinMax = Number(
      Math.max(explorationLargeVeinMin, payload.explorationLargeVeinMax ?? 2000).toFixed(3),
    );
    return {
      resourceCategoryId,
      isResourceDiscoverable,
      basePrice,
      minPrice,
      maxPrice,
      infraPerUnit,
      infrastructureCostPerUnit: infraPerUnit,
      explorationBaseWeight,
      explorationSmallVeinChancePct,
      explorationMediumVeinChancePct,
      explorationLargeVeinChancePct,
      explorationSmallVeinMin,
      explorationSmallVeinMax,
      explorationMediumVeinMin,
      explorationMediumVeinMax,
      explorationLargeVeinMin,
      explorationLargeVeinMax,
    };
  }
  if (kind === "professions") {
    return {
      baseWage: Number(Math.max(0, payload.baseWage ?? 1).toFixed(3)),
    };
  }
  if (kind === "buildings") {
    return {
      costConstruction: Math.max(1, Math.floor(payload.costConstruction ?? 100)),
      costDucats: Number(Math.max(0, payload.costDucats ?? 10).toFixed(3)),
      startingDucats: Number(Math.max(0, payload.startingDucats ?? 0).toFixed(3)),
      inputs: normalizeGoodFlows(payload.inputs),
      outputs: normalizeGoodFlows(payload.outputs),
      workforceRequirements: normalizeWorkforceRequirements(payload.workforceRequirements),
      infrastructureUse: Number(Math.max(0, payload.infrastructureUse ?? 0).toFixed(3)),
      marketInfrastructureByCategory: normalizeCategoryAmountMap(payload.marketInfrastructureByCategory),
      allowedCountryIds: normalizeCountryIdList(payload.allowedCountryIds),
      deniedCountryIds: normalizeCountryIdList(payload.deniedCountryIds),
      countryBuildLimits: normalizeBuildingCountryLimits(payload.countryBuildLimits),
      globalBuildLimit:
        payload.globalBuildLimit == null
          ? null
          : Math.max(1, Math.floor(Number(payload.globalBuildLimit))),
    };
  }
  return {};
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
    ...sanitizeContentEntryByKind(kind, parsed.data),
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
    ...sanitizeContentEntryByKind(kind, parsed.data),
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
    logoUrl: makeVersionedUploadUrl(`${kind}/${file.filename}`),
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
    [key]: makeVersionedUploadUrl(`races/${file.filename}`),
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
    logoUrl: makeVersionedUploadUrl(`cultures/${file.filename}`),
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
    if (typeof nextEconomy.baseConstructionPerTurn === "number") {
      gameSettings.economy.baseConstructionPerTurn = nextEconomy.baseConstructionPerTurn;
    }
    if (typeof nextEconomy.baseDucatsPerTurn === "number") {
      gameSettings.economy.baseDucatsPerTurn = nextEconomy.baseDucatsPerTurn;
    }
    if (typeof nextEconomy.baseGoldPerTurn === "number") {
      gameSettings.economy.baseGoldPerTurn = nextEconomy.baseGoldPerTurn;
    }
    if (typeof nextEconomy.demolitionCostConstructionPercent === "number") {
      gameSettings.economy.demolitionCostConstructionPercent = nextEconomy.demolitionCostConstructionPercent;
    }
    if (typeof nextEconomy.marketPriceSmoothing === "number") {
      gameSettings.economy.marketPriceSmoothing = nextEconomy.marketPriceSmoothing;
    }
    if (typeof nextEconomy.explorationBaseEmptyChancePct === "number") {
      gameSettings.economy.explorationBaseEmptyChancePct = nextEconomy.explorationBaseEmptyChancePct;
    }
    if (typeof nextEconomy.explorationDepletionPerAttemptPct === "number") {
      gameSettings.economy.explorationDepletionPerAttemptPct = nextEconomy.explorationDepletionPerAttemptPct;
    }
    if (typeof nextEconomy.explorationDurationTurns === "number") {
      gameSettings.economy.explorationDurationTurns = nextEconomy.explorationDurationTurns;
    }
    if (typeof nextEconomy.explorationRollsPerExpedition === "number") {
      gameSettings.economy.explorationRollsPerExpedition = nextEconomy.explorationRollsPerExpedition;
    }
  }
  const nextMarkets = parsed.data.markets;
  if (nextMarkets?.countryMarketByCountryId && typeof nextMarkets.countryMarketByCountryId === "object") {
    gameSettings.markets.countryMarketByCountryId = Object.fromEntries(
      Object.entries(nextMarkets.countryMarketByCountryId)
        .map(([countryId, marketId]) => [countryId, normalizeMarketId(marketId)])
        .filter((row): row is [string, string] => Boolean(row[0] && row[1])),
    );
  }
  if (nextMarkets?.sanctionsById && typeof nextMarkets.sanctionsById === "object") {
    gameSettings.markets.sanctionsById = normalizeMarketSanctionsMap(nextMarkets.sanctionsById);
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
    if (typeof nextTurnTimer.pauseWhenNoPlayersOnline === "boolean") {
      gameSettings.turnTimer.pauseWhenNoPlayersOnline = nextTurnTimer.pauseWhenNoPlayersOnline;
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
    parsed.data.markets ? "рынки" : null,
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

const buildCancelSchema = z
  .object({
    provinceId: z.string().min(1).optional(),
    queueId: z.string().min(1).optional(),
    orderId: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.orderId) || Boolean(value.provinceId && value.queueId), {
    message: "orderId or (provinceId + queueId) required",
  });

const buildDemolishSchema = z.object({
  provinceId: z.string().min(1),
  buildingId: z.string().min(1),
  instanceId: z.string().min(1).optional(),
});

const provinceRenameSchema = z.object({
  provinceId: z.string().min(1),
  provinceName: z.string().trim().min(1).max(64),
});
const explorationActionSchema = z.object({
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

app.post("/country/exploration/start", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const parsed = explorationActionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }
  const { provinceId } = parsed.data;
  if ((worldBase.provinceOwner[provinceId] ?? null) !== auth.countryId) {
    return res.status(403).json({ error: "PROVINCE_NOT_OWNED" });
  }
  const queue = [...(worldBase.provinceResourceExplorationQueueByProvince[provinceId] ?? [])];
  if (queue.some((project) => project.requestedByCountryId === auth.countryId)) {
    return res.status(409).json({ error: "EXPLORATION_ALREADY_QUEUED" });
  }
  const durationTurns = Math.max(
    1,
    Math.floor(Number(gameSettings.economy.explorationDurationTurns ?? DEFAULT_EXPLORATION_DURATION_TURNS)),
  );
  const previousWorldBase = cloneWorldBaseSectionSnapshot(WORLD_DELTA_MASK.provinceResourceExplorationQueueByProvince);
  queue.push({
    queueId: randomUUID(),
    requestedByCountryId: auth.countryId,
    startedTurnId: turnId,
    turnsRemaining: durationTurns,
  });
  worldBase.provinceResourceExplorationQueueByProvince[provinceId] = queue;
  savePersistentState();
  broadcastWorldDeltaFromSectionSnapshot(wss, previousWorldBase);
  return res.json({ ok: true, provinceId, queue: worldBase.provinceResourceExplorationQueueByProvince[provinceId] });
});

app.post("/country/build/cancel", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  const parsed = buildCancelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  const { provinceId, queueId, orderId } = parsed.data;
  let canceledQueuedProject = false;
  let canceledPendingOrder = false;
  let previousWorldBase: WorldBaseSectionSnapshot | null = null;

  if (provinceId && queueId) {
    const queue = worldBase.provinceConstructionQueueByProvince[provinceId] ?? [];
    const nextQueue = queue.filter((project) => {
      const shouldRemove =
        project.queueId === queueId &&
        project.requestedByCountryId === auth.countryId &&
        (worldBase.provinceOwner[provinceId] ?? null) === auth.countryId;
      if (shouldRemove) {
        canceledQueuedProject = true;
      }
      return !shouldRemove;
    });
    if (canceledQueuedProject) {
      previousWorldBase = cloneWorldBaseSectionSnapshot(WORLD_DELTA_MASK.provinceConstructionQueueByProvince);
      worldBase.provinceConstructionQueueByProvince[provinceId] = nextQueue;
    }
  }

  if (orderId) {
    const turnOrders = ordersByTurn.get(turnId);
    if (turnOrders) {
      for (const [playerId, list] of turnOrders.entries()) {
        const removed: Order[] = [];
        const filtered = list.filter((order) => {
          const shouldRemove =
            order.id === orderId && order.type === "BUILD" && order.countryId === auth.countryId;
          if (shouldRemove) {
            removed.push(order);
          }
          return !shouldRemove;
        });
        if (removed.length > 0) {
          canceledPendingOrder = true;
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
  }

  if (!canceledQueuedProject && !canceledPendingOrder) {
    return res.status(404).json({ error: "BUILD_CANCEL_NOT_FOUND" });
  }

  savePersistentState();
  if (previousWorldBase) {
    broadcastWorldDeltaFromSectionSnapshot(wss, previousWorldBase);
  }

  return res.json({ ok: true, canceledQueuedProject, canceledPendingOrder });
});

app.post("/country/build/demolish", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  const parsed = buildDemolishSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  const { provinceId, buildingId, instanceId } = parsed.data;
  const provinceOwnerId = worldBase.provinceOwner[provinceId] ?? null;
  if (!provinceOwnerId || provinceOwnerId !== auth.countryId) {
    return res.status(403).json({ error: "NOT_PROVINCE_OWNER" });
  }

  const instances = [...(worldBase.provinceBuildingsByProvince[provinceId] ?? [])];
  const matchingInstances = instances.filter((instance) => instance.buildingId === buildingId);
  if (matchingInstances.length <= 0) {
    return res.status(404).json({ error: "BUILDING_NOT_FOUND" });
  }
  const targetInstance =
    typeof instanceId === "string" && instanceId.trim().length > 0
      ? matchingInstances.find((instance) => instance.instanceId === instanceId.trim())
      : matchingInstances[0];
  if (!targetInstance) {
    return res.status(404).json({ error: "BUILDING_INSTANCE_NOT_FOUND" });
  }

  const building = gameSettings.content.buildings.find((entry) => entry.id === buildingId);
  if (!building) {
    return res.status(404).json({ error: "BUILDING_DEFINITION_NOT_FOUND" });
  }
  const costConstruction = Math.max(1, Math.floor(Number(building.costConstruction ?? 100)));
  const demolitionPercent = Math.max(0, Math.min(100, Math.floor(gameSettings.economy.demolitionCostConstructionPercent ?? 20)));
  const demolitionCostConstruction = Math.ceil((costConstruction * demolitionPercent) / 100);

  ensureCountryInWorldBase(auth.countryId);
  const countryResource = worldBase.resourcesByCountry[auth.countryId];
  if (!countryResource) {
    return res.status(500).json({ error: "NO_RESOURCES" });
  }
  if (countryResource.construction < demolitionCostConstruction) {
    return res.status(400).json({
      error: "INSUFFICIENT_CONSTRUCTION_POINTS",
      required: demolitionCostConstruction,
      available: countryResource.construction,
    });
  }

  const previousWorldBase = cloneWorldBaseSectionSnapshot(
    WORLD_DELTA_MASK.resourcesByCountry |
      WORLD_DELTA_MASK.provinceBuildingsByProvince |
      WORLD_DELTA_MASK.provinceBuildingDucatsByProvince,
  );
  countryResource.construction = Math.max(0, countryResource.construction - demolitionCostConstruction);
  const nextInstances = instances.filter((instance) => instance.instanceId !== targetInstance.instanceId);
  worldBase.provinceBuildingsByProvince[provinceId] = nextInstances;
  const buildingDucats = worldBase.provinceBuildingDucatsByProvince[provinceId] ?? {};
  const remainingByType = nextInstances.some((instance) => instance.buildingId === buildingId);
  if (!remainingByType && Object.prototype.hasOwnProperty.call(buildingDucats, buildingId)) {
    delete buildingDucats[buildingId];
    worldBase.provinceBuildingDucatsByProvince[provinceId] = buildingDucats;
  }

  savePersistentState();
  broadcastWorldDeltaFromSectionSnapshot(wss, previousWorldBase);

  return res.json({
    ok: true,
    provinceId,
    buildingId,
    removedInstanceId: targetInstance.instanceId,
    previousCount: matchingInstances.length,
    newCount: Math.max(0, matchingInstances.length - 1),
    demolitionCostConstruction,
    demolitionPercent,
    constructionLeft: countryResource.construction,
  });
});

app.get("/country/orders/current", async (req, res) => {
  const auth = parseAuthHeader(req);
  if (!auth) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  const turnOrders = ordersByTurn.get(turnId);
  if (!turnOrders) {
    return res.json({ turnId, orders: [] as Order[] });
  }

  const orders: Order[] = [];
  for (const list of turnOrders.values()) {
    for (const order of list) {
      orders.push(order);
    }
  }

  return res.json({ turnId, orders });
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
  infrastructureCapacity: z.coerce.number().min(0).max(SETTINGS_MAX_NUMBER).optional(),
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
    const infrastructureCapacity = round3(
      Math.max(0, Number(worldBase.provinceInfrastructureByProvince[provinceId] ?? DEFAULT_PROVINCE_INFRASTRUCTURE_CAPACITY)),
    );
    return {
      id: provinceId,
      name: provinceName,
      areaKm2: province.areaKm2,
      ownerCountryId: worldBase.provinceOwner[provinceId] ?? null,
      colonizationCost: cfg.cost,
      infrastructureCapacity,
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
      WORLD_DELTA_MASK.provinceColonizationByProvince |
      WORLD_DELTA_MASK.provinceInfrastructureByProvince,
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
  if (typeof parsed.data.infrastructureCapacity === "number") {
    worldBase.provinceInfrastructureByProvince[provinceId] = round3(Math.max(0, parsed.data.infrastructureCapacity));
  }

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
      infrastructureCapacity: round3(
        Math.max(0, Number(worldBase.provinceInfrastructureByProvince[provinceId] ?? DEFAULT_PROVINCE_INFRASTRUCTURE_CAPACITY)),
      ),
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
  marketId: z
    .string()
    .optional()
    .transform((v) => {
      if (v == null) return undefined;
      const next = v.trim();
      if (!next) return null;
      return next;
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

  if (flagFile && !validateImageRule(flagFile, FLAG_IMAGE_RULE)) {
    removeUploadedFile(flagFile);
    removeUploadedFile(crestFile);
    return res
      .status(400)
      .json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", field: "flag", max: "192x128", ratio: "3:2" });
  }

  if (crestFile && !validateImageRule(crestFile, CREST_IMAGE_RULE)) {
    removeUploadedFile(flagFile);
    removeUploadedFile(crestFile);
    return res
      .status(400)
      .json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", field: "crest", max: "128x192", ratio: "2:3" });
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
    data.flagUrl = makeVersionedUploadUrl(`flags/${flagFile.filename}`);
  }
  if (crestFile) {
    data.crestUrl = makeVersionedUploadUrl(`crests/${crestFile.filename}`);
  }

  try {
    const updated = await prisma.country.update({
      where: { id: target.id },
      data,
      select: countrySelect,
    });
    if (parsed.data.marketId !== undefined) {
      setCountryMarketId(target.id, parsed.data.marketId);
    }

    if (flagFile) {
      removeUploadedByUrl(target.flagUrl);
    }
    if (crestFile) {
      removeUploadedByUrl(target.crestUrl);
    }
    invalidateCountryQueryCache();
    savePersistentState();
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
      WORLD_DELTA_MASK.colonyProgressByProvince |
      WORLD_DELTA_MASK.provinceConstructionQueueByProvince,
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
  for (const [provinceId, queue] of Object.entries(worldBase.provinceConstructionQueueByProvince)) {
    if (!Array.isArray(queue) || queue.length === 0) continue;
    worldBase.provinceConstructionQueueByProvince[provinceId] = queue.filter((project) => {
      if (project.requestedByCountryId === countryIdParam) return false;
      if (project.owner.type === "state" && project.owner.countryId === countryIdParam) return false;
      return true;
    });
  }
  cleanupMarketsAfterCountryRemoval(countryIdParam);

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

  if (flagFile && !validateImageRule(flagFile, FLAG_IMAGE_RULE)) {
    removeUploadedFile(flagFile);
    removeUploadedFile(crestFile);
    return res
      .status(400)
      .json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", field: "flag", max: "192x128", ratio: "3:2" });
  }

  if (crestFile && !validateImageRule(crestFile, CREST_IMAGE_RULE)) {
    removeUploadedFile(flagFile);
    removeUploadedFile(crestFile);
    return res
      .status(400)
      .json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", field: "crest", max: "128x192", ratio: "2:3" });
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
    data.flagUrl = makeVersionedUploadUrl(`flags/${flagFile.filename}`);
  }
  if (crestFile) {
    data.crestUrl = makeVersionedUploadUrl(`crests/${crestFile.filename}`);
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

  if (flagFile && !validateImageRule(flagFile, FLAG_IMAGE_RULE)) {
    removeUploadedFile(flagFile);
    removeUploadedFile(crestFile);
    return res
      .status(400)
      .json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", field: "flag", max: "192x128", ratio: "3:2" });
  }

  if (crestFile && !validateImageRule(crestFile, CREST_IMAGE_RULE)) {
    removeUploadedFile(flagFile);
    removeUploadedFile(crestFile);
    return res
      .status(400)
      .json({ error: "IMAGE_DIMENSIONS_TOO_LARGE", field: "crest", max: "128x192", ratio: "2:3" });
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
        flagUrl: flagFile ? makeVersionedUploadUrl(`flags/${flagFile.filename}`) : null,
        crestUrl: crestFile ? makeVersionedUploadUrl(`crests/${crestFile.filename}`) : null,
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
      construction: gameSettings.economy.baseConstructionPerTurn,
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

      if (delta.order.type !== "COLONIZE" && delta.order.type !== "BUILD" && countryResource.ducats <= 0) {
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

      if (delta.order.type === "BUILD") {
        const owner = worldBase.provinceOwner[delta.order.provinceId];
        if (!owner || owner !== delta.order.countryId) {
          send({ type: "ERROR", code: "BUILD_CONFLICT", message: "Провинция не принадлежит вашей стране" });
          return;
        }
        const payload = (delta.order.payload ?? {}) as Record<string, unknown>;
        const buildingId = parseRequestedBuildingIdFromPayload(payload);
        const building = gameSettings.content.buildings.find((entry) => entry.id === buildingId);
        if (!buildingId || !building) {
          send({ type: "ERROR", code: "BUILD_INVALID", message: "Некорректное здание для строительства" });
          return;
        }
        const ownerForProject = resolveBuildingOwnerFromPayload(payload, delta.order.countryId);
        if (!ownerForProject) {
          send({ type: "ERROR", code: "BUILD_INVALID", message: "Некорректный владелец проекта" });
          return;
        }
        const allowedByRules = await isCountryAllowedForBuildingWithEngine(building, delta.order.countryId);
        if (!allowedByRules) {
          send({ type: "ERROR", code: "BUILD_RESTRICTED", message: "Ваша страна не может строить это здание" });
          return;
        }
        const counts = countBuildingOccurrences(buildingId, delta.order.countryId, { includePendingOrders: true });
        const countryLimit = getCountryBuildLimit(building, delta.order.countryId);
        const globalLimit =
          typeof building.globalBuildLimit === "number" && Number.isFinite(building.globalBuildLimit)
            ? Math.max(1, Math.floor(building.globalBuildLimit))
            : null;
        if (countryLimit != null && counts.byCountry >= countryLimit) {
          send({
            type: "ERROR",
            code: "BUILD_LIMIT_COUNTRY",
            message: `Достигнут лимит здания для страны: ${counts.byCountry}/${countryLimit}`,
          });
          return;
        }
        if (globalLimit != null && counts.global >= globalLimit) {
          send({
            type: "ERROR",
            code: "BUILD_LIMIT_GLOBAL",
            message: `Достигнут глобальный лимит здания: ${counts.global}/${globalLimit}`,
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
  await ensureCorePrismaTables();
  await ensureWorldDeltaLogTable();
  await loadPersistentState();
  persistContentLibraryFromSettings();
  await cleanupOrphanUploadsOnServerStart();
  if (await migratePersistedMarketNamesToReadable()) {
    savePersistentState();
  }
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
      if (gameSettings.turnTimer.pauseWhenNoPlayersOnline && onlinePlayers.size === 0) {
        resetTurnTimerAnchor();
        return;
      }
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
