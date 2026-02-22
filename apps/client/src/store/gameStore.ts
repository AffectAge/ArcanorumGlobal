import { create } from "zustand";
import type { EventCategory, EventLogEntry, EventPriority, EventVisibility, Order, ResourceTotals, WorldBase } from "@arcanorum/shared";

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
  onlinePlayerIds: string[];
  selectedProvinceId: string | null;
  worldBase: WorldBase | null;
  ordersByTurn: OrdersByTurn;
  eventLog: EventLogEntry[];
  eventLogRetentionTurns: number;
  setAuth: (auth: AuthState | null) => void;
  setWorldBase: (world: WorldBase, turnId: number) => void;
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
  onlinePlayerIds: [],
  selectedProvinceId: null,
  worldBase: null,
  ordersByTurn: new Map(),
  eventLog: [],
  eventLogRetentionTurns: 3,
  setAuth: (auth) => set({ auth }),
  setWorldBase: (world, nextTurnId) => set({ worldBase: world, turnId: nextTurnId }),
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
