import { create } from "zustand";
import type { Order, ResourceTotals, WorldBase } from "@arcanorum/shared";

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
  setAuth: (auth: AuthState | null) => void;
  setWorldBase: (world: WorldBase, turnId: number) => void;
  addOrder: (order: Order) => void;
  setPresence: (ids: string[]) => void;
  setSelectedProvince: (id: string | null) => void;
  resetOverlay: (turnId: number) => void;
  updateCountryResources: (countryId: string, patch: Partial<ResourceTotals>) => void;
};

export const useGameStore = create<GameState>((set) => ({
  auth: null,
  turnId: 1,
  onlinePlayerIds: [],
  selectedProvinceId: null,
  worldBase: null,
  ordersByTurn: new Map(),
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
