export type ServerStatus = "online" | "offline" | "maintenance";

export type Country = {
  id: string;
  name: string;
  color: string;
  flagUrl?: string | null;
  crestUrl?: string | null;
  isAdmin?: boolean;
  isLocked?: boolean;
  blockedUntilTurn?: number | null;
  blockedUntilAt?: string | null;
  lockReason?: string | null;
  ignoreUntilTurn?: number | null;
  eventLogRetentionTurns?: number | null;
  isRegistrationApproved?: boolean;
};

export type ResourceTotals = {
  culture: number;
  science: number;
  religion: number;
  colonization: number;
  ducats: number;
  gold: number;
};

export type EventCategory = "system" | "colonization" | "politics" | "economy" | "military" | "diplomacy";
export type EventPriority = "low" | "medium" | "high";
export type EventVisibility = "public" | "private";
export type EventCountryScope = "all" | "own" | "foreign";

export type EventLogEntry = {
  id: string;
  turn: number;
  timestamp: string;
  category: EventCategory;
  priority: EventPriority;
  visibility: EventVisibility;
  title?: string | null;
  message: string;
  countryId?: string | null;
};

export type OrderType = "BUILD" | "BUDGET" | "ARMY_MOVE" | "COLONIZE";

export type Order = {
  id: string;
  turnId: number;
  playerId: string;
  countryId: string;
  provinceId: string;
  type: OrderType;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type OrderDelta = {
  type: "ORDER_DELTA";
  order: Omit<Order, "id" | "createdAt">;
};

export type ProvincePopulation = {
  populationTotal: number;
  culturePct: Record<string, number>;
  ideologyPct: Record<string, number>;
  religionPct: Record<string, number>;
  racePct: Record<string, number>;
  professionPct: Record<string, number>;
};

export type WorldBase = {
  turnId: number;
  resourcesByCountry: Record<string, ResourceTotals>;
  provinceOwner: Record<string, string>;
  provinceNameById: Record<string, string>;
  colonyProgressByProvince: Record<string, Record<string, number>>;
  provinceColonizationByProvince: Record<string, { cost: number; disabled: boolean; manualCost?: boolean }>;
  provincePopulationByProvince: Record<string, ProvincePopulation>;
  provinceBuildingsByProvince: Record<string, Record<string, number>>;
  provinceBuildingDucatsByProvince: Record<string, Record<string, number>>;
  provincePopulationTreasuryByProvince: Record<string, number>;
};

export const WORLD_DELTA_MASK = {
  resourcesByCountry: 1 << 0,
  provinceOwner: 1 << 1,
  provinceNameById: 1 << 2,
  colonyProgressByProvince: 1 << 3,
  provinceColonizationByProvince: 1 << 4,
  provincePopulationByProvince: 1 << 5,
  provinceBuildingsByProvince: 1 << 6,
  provincePopulationTreasuryByProvince: 1 << 7,
  provinceBuildingDucatsByProvince: 1 << 8,
} as const;

export type WorldDelta = {
  type: "WORLD_DELTA";
  turnId: number;
  worldStateVersion: number;
  mask: number;
  c?: Record<string, ResourceTotals | null>;
  o?: Record<string, string | null>;
  n?: Record<string, string | null>;
  p?: Record<string, Record<string, number> | null>;
  z?: Record<string, { cost: number; disabled: boolean; manualCost?: boolean } | null>;
  u?: Record<string, ProvincePopulation | null>;
  b?: Record<string, Record<string, number> | null>;
  y?: Record<string, number | null>;
  q?: Record<string, Record<string, number> | null>;
  rejectedOrders: Array<{ playerId: string; reason: string; tempOrderId?: string }>;
};

export type WsInMessage =
  | { type: "AUTH"; token: string }
  | OrderDelta
  | { type: "PING" }
  | { type: "WORLD_DELTA_ACK"; worldStateVersion: number }
  | { type: "WORLD_DELTA_REPLAY_REQUEST"; fromWorldStateVersion: number }
  | { type: "REQUEST_RESOLVE" }
  | { type: "ADMIN_FORCE_RESOLVE" };

export type WsOutMessage =
  | { type: "CONNECTED"; serverTime: string }
  | { type: "AUTH_OK"; playerId: string; countryId: string; isAdmin: boolean; worldBase: WorldBase; turnId: number; worldStateVersion: number; clientSettings?: { eventLogRetentionTurns: number } }
  | { type: "ORDER_BROADCAST"; order: Order }
  | { type: "TURN_RESOLVE_STARTED"; turnId: number; reason: "manual" | "admin" | "auto" }
  | { type: "NEWS_EVENT"; event: EventLogEntry }
  | {
      type: "UI_NOTIFY";
      notification: {
        id: string;
        category: "registration" | "system" | "politics" | "economy";
        createdAt: string;
        title?: string | null;
        message?: string | null;
        action:
          | {
              type: "registration-approval";
              country: {
                id: string;
                name: string;
                color: string;
                flagUrl?: string | null;
                crestUrl?: string | null;
              };
            }
          | {
              type: "message";
            };
      };
    }
  | { type: "ERROR"; code: string; message: string }
  | { type: "PONG" }
  | { type: "PRESENCE"; onlinePlayerIds: string[] }
  | WorldDelta;

export type LoginPayload = {
  countryId: string;
  password: string;
  rememberMe: boolean;
};

export type RegisterPayload = {
  countryName: string;
  countryColor: string;
  flagUrl?: string;
  crestUrl?: string;
  password: string;
};

export const ADM1_GEOJSON = {
  type: "FeatureCollection",
  name: "adm1_sample",
  features: [
    {
      type: "Feature",
      properties: { id: "p-north", name: "North March", country: "ARC" },
      geometry: {
        type: "Polygon",
        coordinates: [[[-10, 20], [0, 20], [0, 30], [-10, 30], [-10, 20]]],
      },
    },
    {
      type: "Feature",
      properties: { id: "p-south", name: "South March", country: "ARC" },
      geometry: {
        type: "Polygon",
        coordinates: [[[-10, 10], [0, 10], [0, 20], [-10, 20], [-10, 10]]],
      },
    },
    {
      type: "Feature",
      properties: { id: "p-east", name: "East Crown", country: "VAL" },
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 10], [10, 10], [10, 30], [0, 30], [0, 10]]],
      },
    },
  ],
} as const;
