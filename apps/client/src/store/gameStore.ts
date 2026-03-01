import { create } from "zustand";
import { WORLD_DELTA_MASK, type EventCategory, type EventLogEntry, type EventPriority, type EventVisibility, type Order, type ResourceTotals, type WorldBase, type WorldDelta } from "@arcanorum/shared";

type OrdersByTurn = Map<number, Map<string, Order[]>>;

type AuthState = {
  token: string;
  playerId: string;
  countryId: string;
  isAdmin: boolean;
};

type GameState = {
  auth: AuthState | null;
  turnId: number;
  worldStateVersion: number;
  onlinePlayerIds: string[];
  selectedProvinceId: string | null;
  worldBase: WorldBase | null;
  ordersByTurn: OrdersByTurn;
  eventLog: EventLogEntry[];
  eventLogRetentionTurns: number;
  setAuth: (auth: AuthState | null) => void;
  setWorldBase: (world: WorldBase, turnId: number, worldStateVersion: number) => void;
  applyWorldDelta: (delta: WorldDelta, turnId: number, worldStateVersion: number) => void;
  addOrder: (order: Order) => void;
  setPresence: (ids: string[]) => void;
  setSelectedProvince: (id: string | null) => void;
  resetOverlay: (turnId: number) => void;
  updateCountryResources: (countryId: string, patch: Partial<ResourceTotals>) => void;
  addEvent: (entry: { turn?: number; category: EventCategory; message: string; title?: string; countryId?: string | null; priority?: EventPriority; visibility?: EventVisibility }) => void;
  pruneLogEntries: (currentTurn: number, keepTurns?: number) => void;
  trimOldLogEntries: (keepLast?: number) => void;
  clearEventLog: () => void;
  setEventLogRetentionTurns: (turns: number) => void;
};

const MAX_LOG_ENTRIES = 200;

export const useGameStore = create<GameState>((set) => ({
  auth: null,
  turnId: 1,
  worldStateVersion: 1,
  onlinePlayerIds: [],
  selectedProvinceId: null,
  worldBase: null,
  ordersByTurn: new Map(),
  eventLog: [],
  eventLogRetentionTurns: 3,
  setAuth: (auth) => set({ auth }),
  setWorldBase: (world, nextTurnId, nextWorldStateVersion) =>
    set({
      worldBase: world,
      turnId: nextTurnId,
      worldStateVersion: nextWorldStateVersion,
    }),
  applyWorldDelta: (delta, nextTurnId, nextWorldStateVersion) =>
    set((state) => {
      if (!state.worldBase) {
        return state;
      }

      const nextWorldBase: WorldBase = {
        ...state.worldBase,
        turnId: nextTurnId,
      };

      if ((delta.mask & WORLD_DELTA_MASK.resourcesByCountry) !== 0 && delta.c) {
        nextWorldBase.resourcesByCountry = { ...nextWorldBase.resourcesByCountry };
        for (const [countryId, value] of Object.entries(delta.c)) {
          if (!value) {
            delete nextWorldBase.resourcesByCountry[countryId];
            continue;
          }
          nextWorldBase.resourcesByCountry[countryId] = value;
        }
      }

      if ((delta.mask & WORLD_DELTA_MASK.provinceOwner) !== 0 && delta.o) {
        nextWorldBase.provinceOwner = { ...nextWorldBase.provinceOwner };
        for (const [provinceId, value] of Object.entries(delta.o)) {
          if (value == null) {
            delete nextWorldBase.provinceOwner[provinceId];
            continue;
          }
          nextWorldBase.provinceOwner[provinceId] = value;
        }
      }

      if ((delta.mask & WORLD_DELTA_MASK.provinceNameById) !== 0 && delta.n) {
        nextWorldBase.provinceNameById = { ...nextWorldBase.provinceNameById };
        for (const [provinceId, value] of Object.entries(delta.n)) {
          if (value == null) {
            delete nextWorldBase.provinceNameById[provinceId];
            continue;
          }
          nextWorldBase.provinceNameById[provinceId] = value;
        }
      }

      if ((delta.mask & WORLD_DELTA_MASK.colonyProgressByProvince) !== 0 && delta.p) {
        nextWorldBase.colonyProgressByProvince = { ...nextWorldBase.colonyProgressByProvince };
        for (const [provinceId, value] of Object.entries(delta.p)) {
          if (!value) {
            delete nextWorldBase.colonyProgressByProvince[provinceId];
            continue;
          }
          nextWorldBase.colonyProgressByProvince[provinceId] = value;
        }
      }

      if ((delta.mask & WORLD_DELTA_MASK.provinceColonizationByProvince) !== 0 && delta.z) {
        nextWorldBase.provinceColonizationByProvince = { ...nextWorldBase.provinceColonizationByProvince };
        for (const [provinceId, value] of Object.entries(delta.z)) {
          if (!value) {
            delete nextWorldBase.provinceColonizationByProvince[provinceId];
            continue;
          }
          nextWorldBase.provinceColonizationByProvince[provinceId] = value;
        }
      }

      if ((delta.mask & WORLD_DELTA_MASK.provincePopulationByProvince) !== 0 && delta.u) {
        nextWorldBase.provincePopulationByProvince = { ...nextWorldBase.provincePopulationByProvince };
        for (const [provinceId, value] of Object.entries(delta.u)) {
          if (!value) {
            delete nextWorldBase.provincePopulationByProvince[provinceId];
            continue;
          }
          nextWorldBase.provincePopulationByProvince[provinceId] = value;
        }
      }

      return {
        worldBase: nextWorldBase,
        turnId: nextTurnId,
        worldStateVersion: nextWorldStateVersion,
      };
    }),
  addOrder: (order) =>
    set((state) => {
      const turnMap = new Map(state.ordersByTurn);
      const byPlayer = new Map(turnMap.get(order.turnId) ?? []);
      const list = [...(byPlayer.get(order.playerId) ?? []), order];
      byPlayer.set(order.playerId, list);
      turnMap.set(order.turnId, byPlayer);
      return { ordersByTurn: turnMap };
    }),
  setPresence: (ids) => set({ onlinePlayerIds: ids }),
  setSelectedProvince: (id) => set({ selectedProvinceId: id }),
  resetOverlay: (nextTurnId) =>
    set((state) => {
      const map = new Map(state.ordersByTurn);
      map.delete(nextTurnId - 1);
      return { ordersByTurn: map, turnId: nextTurnId };
    }),
  updateCountryResources: (countryId, patch) =>
    set((state) => {
      if (!state.worldBase?.resourcesByCountry[countryId]) {
        return state;
      }

      return {
        worldBase: {
          ...state.worldBase,
          resourcesByCountry: {
            ...state.worldBase.resourcesByCountry,
            [countryId]: {
              ...state.worldBase.resourcesByCountry[countryId],
              ...patch,
            },
          },
        },
      };
    }),
  addEvent: (entry) =>
    set((state) => {
      const timestamp = new Date().toISOString();
      const nextTurn = entry.turn ?? state.turnId;
      const next: EventLogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        turn: nextTurn,
        timestamp,
        category: entry.category,
        priority: entry.priority ?? "medium",
        visibility: entry.visibility ?? "public",
        title: entry.title ?? null,
        message: entry.message,
        countryId: entry.countryId ?? null,
      };
      const merged = [...state.eventLog, next];
      return { eventLog: merged.slice(-MAX_LOG_ENTRIES) };
    }),
  pruneLogEntries: (currentTurn, keepTurns) =>
    set((state) => {
      const retention = Math.max(1, Math.floor(keepTurns ?? state.eventLogRetentionTurns));
      return {
        eventLog: state.eventLog.filter((entry) => currentTurn - entry.turn < retention).slice(-MAX_LOG_ENTRIES),
      };
    }),
  trimOldLogEntries: (keepLast = 50) =>
    set((state) => ({
      eventLog: state.eventLog.slice(-Math.max(1, keepLast)),
    })),
  clearEventLog: () => set({ eventLog: [] }),
  setEventLogRetentionTurns: (turns) =>
    set((state) => {
      const next = Math.max(1, Math.floor(turns));
      return {
        eventLogRetentionTurns: next,
        eventLog: state.eventLog.slice(-MAX_LOG_ENTRIES),
      };
    }),
}));

export const selectOrdersForProvince = (provinceId: string, turnId: number) => (state: GameState): Order[] => {
  const byPlayer = state.ordersByTurn.get(turnId);
  if (!byPlayer) {
    return [];
  }

  const orders: Order[] = [];
  for (const list of byPlayer.values()) {
    for (const order of list) {
      if (order.provinceId === provinceId) {
        orders.push(order);
      }
    }
  }
  return orders;
};
