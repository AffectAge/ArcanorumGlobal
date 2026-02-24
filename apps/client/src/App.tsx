import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { OrderDelta, WsOutMessage } from "@arcanorum/shared";
import { AuthPanel, type AuthSuccess } from "./components/AuthPanel";
import { MapView } from "./components/MapView";
import { TopBar } from "./components/TopBar";
import { SideNav } from "./components/SideNav";
import { MapModePanel } from "./components/MapModePanel";
import { CommandPalette } from "./components/CommandPalette";
import { AdminPanel } from "./components/AdminPanel";
import { TurnStatusModal } from "./components/TurnStatusModal";
import { GameSettingsPanel } from "./components/GameSettingsPanel";
import { CountryCustomizationModal } from "./components/CountryCustomizationModal";
import { EventLogPanel } from "./components/EventLogPanel";
import { ClientSettingsModal } from "./components/ClientSettingsModal";
import { CivilopediaModal } from "./components/CivilopediaModal";
import { InAppNotificationTray, type InAppUiNotification } from "./components/InAppNotificationTray";
import { RegistrationApprovalModal } from "./components/RegistrationApprovalModal";
import { adminReviewRegistration, apiBase, fetchCountries, fetchProvinceIndex, fetchPublicGameUiSettings, type ResourceIconsMap } from "./lib/api";
import { useWs } from "./lib/useWs";
import { useGameStore } from "./store/gameStore";

type SessionCountry = {
  name: string;
  color: string;
  flagUrl?: string | null;
  crestUrl?: string | null;
};

type RegistrationApprovalCountry = Extract<
  InAppUiNotification["action"],
  { type: "registration-approval" }
>["country"];

export default function App() {
  const [entryLoadingGate, setEntryLoadingGate] = useState<"hidden" | "loading" | "ready">("hidden");
  const [turnResolveOverlay, setTurnResolveOverlay] = useState<
    | { phase: "idle" }
    | { phase: "processing"; startedAtMs: number }
    | { phase: "done"; startedAtMs: number; finishedAtMs: number; durationMs: number; resolvedTurnId: number }
  >({ phase: "idle" });
  const [uiNotifications, setUiNotifications] = useState<InAppUiNotification[]>([]);
  const [viewedUiNotificationIds, setViewedUiNotificationIds] = useState<Set<string>>(new Set());
  const [registrationApprovalModal, setRegistrationApprovalModal] = useState<{
    open: boolean;
    country: RegistrationApprovalCountry | null;
    notificationId: string | null;
    pending: boolean;
  }>({ open: false, country: null, notificationId: null, pending: false });
  const [country, setCountry] = useState<SessionCountry | null>(null);
  const [mapMode, setMapMode] = useState(() => {
    try {
      return localStorage.getItem("arc.ui.mapMode") || "Политическая карта";
    } catch {
      return "Политическая карта";
    }
  });
  const [cmdOpen, setCmdOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminInitialProvinceId, setAdminInitialProvinceId] = useState<string | null>(null);
  const [turnStatusOpen, setTurnStatusOpen] = useState(false);
  const [gameSettingsOpen, setGameSettingsOpen] = useState(false);
  const [countryCustomizationOpen, setCountryCustomizationOpen] = useState(false);
  const [clientSettingsOpen, setClientSettingsOpen] = useState(false);
  const [civilopediaOpen, setCivilopediaOpen] = useState(false);
  const [civilopediaIntent, setCivilopediaIntent] = useState<
    | { type: "open-entry"; entryId: string }
    | { type: "province"; provinceId: string; provinceName: string; createIfMissing: boolean }
    | null
  >(null);
  const [resourceIcons, setResourceIcons] = useState<ResourceIconsMap>({
    culture: null,
    science: null,
    religion: null,
    colonization: null,
    ducats: null,
    gold: null,
  });
  const [resourceGrowthByTurn, setResourceGrowthByTurn] = useState<{
    culture: number;
    science: number;
    religion: number;
    colonization: number;
    ducats: number;
    gold: number;
  }>({
    culture: 0,
    science: 0,
    religion: 0,
    colonization: 0,
    ducats: 0,
    gold: 0,
  });
  const [customizationDucatSpend, setCustomizationDucatSpend] = useState<{ turnId: number; amount: number }>({
    turnId: 0,
    amount: 0,
  });
  const [provinceRenameDucatSpend, setProvinceRenameDucatSpend] = useState<{ turnId: number; amount: number }>({
    turnId: 0,
    amount: 0,
  });
  const [maxActiveColonizations, setMaxActiveColonizations] = useState(3);
  const [colonizationCostPer1000Km2, setColonizationCostPer1000Km2] = useState({ points: 5, ducats: 5 });
  const [provinceRenameDucatsCost, setProvinceRenameDucatsCost] = useState(25);
  const [provinceAreaKm2ById, setProvinceAreaKm2ById] = useState<Record<string, number>>({});
  const [showAntarctica, setShowAntarctica] = useState(false);
  const [showMapControls, setShowMapControls] = useState(false);
  const [sortNotifications, setSortNotifications] = useState(true);
  const [provinceIndexLoaded, setProvinceIndexLoaded] = useState(false);
  const [publicUiLoaded, setPublicUiLoaded] = useState(false);
  const [turnTimerUi, setTurnTimerUi] = useState<{ enabled: boolean; secondsPerTurn: number; startedAtMs: number | null }>({
    enabled: false,
    secondsPerTurn: 300,
    startedAtMs: null,
  });

  const auth = useGameStore((s) => s.auth);
  const turnId = useGameStore((s) => s.turnId);
  const worldBase = useGameStore((s) => s.worldBase);
  const ordersByTurn = useGameStore((s) => s.ordersByTurn);
  const selectedProvinceId = useGameStore((s) => s.selectedProvinceId);
  const setAuth = useGameStore((s) => s.setAuth);
  const setWorldBase = useGameStore((s) => s.setWorldBase);
  const addOrder = useGameStore((s) => s.addOrder);
  const setPresence = useGameStore((s) => s.setPresence);
  const resetOverlay = useGameStore((s) => s.resetOverlay);
  const updateCountryResources = useGameStore((s) => s.updateCountryResources);
  const eventLog = useGameStore((s) => s.eventLog);
  const addEvent = useGameStore((s) => s.addEvent);
  const pruneLogEntries = useGameStore((s) => s.pruneLogEntries);
  const trimOldLogEntries = useGameStore((s) => s.trimOldLogEntries);
  const clearEventLog = useGameStore((s) => s.clearEventLog);
  const eventLogRetentionTurns = useGameStore((s) => s.eventLogRetentionTurns);
  const setEventLogRetentionTurns = useGameStore((s) => s.setEventLogRetentionTurns);

  const onWsMessage = useCallback(
    (msg: WsOutMessage) => {
      if (msg.type === "AUTH_OK") {
        setWorldBase(msg.worldBase, msg.turnId);
        const currentAuth = useGameStore.getState().auth;
        if (currentAuth?.token) {
          setAuth({ token: currentAuth.token, playerId: msg.playerId, countryId: msg.countryId, isAdmin: msg.isAdmin });
        }
        if (msg.clientSettings?.eventLogRetentionTurns) {
          setEventLogRetentionTurns(msg.clientSettings.eventLogRetentionTurns);
        }
        addEvent({ category: "system", title: "Подключение", message: "Соединение с игровым сервером установлено", priority: "low", visibility: "private", countryId: msg.countryId, turn: msg.turnId });
      }

      if (msg.type === "ORDER_BROADCAST") {
        addOrder(msg.order);
        addEvent({
          category: msg.order.type === "COLONIZE" ? "colonization" : "military",
          title: msg.order.type === "COLONIZE" ? "Новый приказ колонизации" : "Новый приказ",
          message: `${msg.order.countryId} -> ${msg.order.type} (${msg.order.provinceId})`,
          countryId: msg.order.countryId,
          priority: "low",
          visibility: "public",
          turn: msg.order.turnId,
        });
      }

      if (msg.type === "TURN_RESOLVE_STARTED") {
        setTurnResolveOverlay((prev) =>
          prev.phase === "idle" ? { phase: "processing", startedAtMs: Date.now() } : prev,
        );
      }

      if (msg.type === "WORLD_PATCH") {
        setTurnResolveOverlay((prev) =>
          prev.phase === "processing"
            ? {
                phase: "done",
                startedAtMs: prev.startedAtMs,
                finishedAtMs: Date.now(),
                durationMs: Math.max(0, Date.now() - prev.startedAtMs),
                resolvedTurnId: msg.turnId,
              }
            : prev,
        );
        setWorldBase(msg.worldBase, msg.turnId);
        setTurnTimerUi((prev) => ({ ...prev, startedAtMs: Date.now() }));
        resetOverlay(msg.turnId);
        pruneLogEntries(msg.turnId);
        if (msg.rejectedOrders.length > 0) {
          toast.warning(`Отклонено приказов: ${msg.rejectedOrders.length}`);
          addEvent({
            category: "system",
            title: `Ход #${msg.turnId} завершен`,
            message: `Отклонено приказов: ${msg.rejectedOrders.length}`,
            priority: "medium",
            visibility: "public",
            turn: msg.turnId,
          });
        } else {
          toast.success("Ход успешно зарезолвен");
          addEvent({
            category: "system",
            title: `Ход #${msg.turnId} завершен`,
            message: "Резолв завершен без отклонений приказов",
            priority: "low",
            visibility: "public",
            turn: msg.turnId,
          });
        }
      }

      if (msg.type === "WORLD_BASE_SYNC") {
        setWorldBase(msg.worldBase, msg.turnId);
      }

      if (msg.type === "NEWS_EVENT") {
        addEvent({
          ...msg.event,
          turn: msg.event.turn,
          category: msg.event.category,
          message: msg.event.message,
          title: msg.event.title ?? undefined,
          countryId: msg.event.countryId ?? null,
          priority: msg.event.priority,
          visibility: msg.event.visibility,
        });
      }

      if (msg.type === "UI_NOTIFY") {
        setUiNotifications((prev) => {
          const next = [msg.notification as InAppUiNotification, ...prev.filter((n) => n.id !== msg.notification.id)];
          return next.slice(0, 8);
        });
      }

      if (msg.type === "PRESENCE") {
        setPresence(msg.onlinePlayerIds);
      }

      if (msg.type === "ERROR") {
        setTurnResolveOverlay((prev) => (prev.phase === "processing" ? { phase: "idle" } : prev));
        toast.error(msg.message);
        addEvent({ category: "system", title: "Ошибка", message: msg.message, priority: "high", visibility: "private" });
      }
    },
    [addEvent, addOrder, pruneLogEntries, resetOverlay, setEventLogRetentionTurns, setPresence, setWorldBase],
  );

  const { send } = useWs(onWsMessage, auth?.token);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCmdOpen((v) => !v);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    try {
      const key = `arc.ui.${auth?.countryId ?? "guest"}.mapMode`;
      const saved = localStorage.getItem(key);
      if (saved) {
        setMapMode(saved);
      }
    } catch {
      // ignore storage failures
    }
  }, [auth?.countryId]);

  useEffect(() => {
    try {
      localStorage.setItem(`arc.ui.${auth?.countryId ?? "guest"}.mapMode`, mapMode);
    } catch {
      // ignore storage failures
    }
  }, [auth?.countryId, mapMode]);

  useEffect(() => {
    try {
      const key = `arc.ui.${auth?.countryId ?? "guest"}.map.showControls`;
      const raw = localStorage.getItem(key);
      setShowMapControls(raw === "1");
    } catch {
      setShowMapControls(false);
    }
  }, [auth?.countryId]);

  useEffect(() => {
    try {
      localStorage.setItem(`arc.ui.${auth?.countryId ?? "guest"}.map.showControls`, showMapControls ? "1" : "0");
    } catch {
      // ignore storage failures
    }
  }, [auth?.countryId, showMapControls]);

  useEffect(() => {
    try {
      const key = `arc.ui.${auth?.countryId ?? "guest"}.notifications.sort`;
      const raw = localStorage.getItem(key);
      setSortNotifications(raw == null ? true : raw === "1");
    } catch {
      setSortNotifications(true);
    }
  }, [auth?.countryId]);

  useEffect(() => {
    try {
      localStorage.setItem(`arc.ui.${auth?.countryId ?? "guest"}.notifications.sort`, sortNotifications ? "1" : "0");
    } catch {
      // ignore storage failures
    }
  }, [auth?.countryId, sortNotifications]);

  useEffect(() => {
    let cancelled = false;
    fetchProvinceIndex()
      .then((items) => {
        if (cancelled) return;
        const next: Record<string, number> = {};
        for (const item of items) next[item.id] = item.areaKm2;
        setProvinceAreaKm2ById(next);
        setProvinceIndexLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setProvinceAreaKm2ById({});
          setProvinceIndexLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchPublicGameUiSettings()
      .then((ui) => {
        if (!cancelled) {
          setResourceIcons(ui.resourceIcons);
          setResourceGrowthByTurn({
            culture: 0,
            science: 0,
            religion: 0,
            colonization: ui.colonization.pointsPerTurn,
            ducats: ui.economy.baseDucatsPerTurn,
            gold: ui.economy.baseGoldPerTurn,
          });
          setMaxActiveColonizations(ui.colonization.maxActiveColonizations);
          setColonizationCostPer1000Km2({
            points: ui.colonization.pointsCostPer1000Km2,
            ducats: ui.colonization.ducatsCostPer1000Km2,
          });
          setShowAntarctica(ui.map?.showAntarctica ?? true);
          setProvinceRenameDucatsCost(ui.customization?.provinceRenameDucats ?? 25);
          setTurnTimerUi({
            enabled: ui.turnTimer?.enabled ?? false,
            secondsPerTurn: ui.turnTimer?.secondsPerTurn ?? 300,
            startedAtMs:
              typeof ui.turnTimer?.currentTurnStartedAtMs === "number" && Number.isFinite(ui.turnTimer.currentTurnStartedAtMs)
                ? ui.turnTimer.currentTurnStartedAtMs
                : Date.now(),
          });
          setPublicUiLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPublicUiLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!auth?.countryId) return;
    if (country?.name && country.name.trim().length > 0) return;

    let cancelled = false;
    fetchCountries()
      .then((list) => {
        if (cancelled) return;
        const found = list.find((c) => c.id === auth.countryId);
        if (!found) return;
        setCountry({
          name: found.name,
          color: found.color,
          flagUrl: found.flagUrl ?? null,
          crestUrl: found.crestUrl ?? null,
        });
      })
      .catch(() => {
        // keep fallback label
      });

    return () => {
      cancelled = true;
    };
  }, [auth?.countryId, country?.name]);

  const onAuthSuccess = (payload: AuthSuccess) => {
    setEntryLoadingGate("loading");
    setAuth({ token: payload.token, playerId: payload.playerId, countryId: payload.countryId, isAdmin: payload.isAdmin });
    setCountry({ name: payload.countryName, color: payload.countryColor, flagUrl: payload.flagUrl, crestUrl: payload.crestUrl });
    if (payload.clientSettings?.eventLogRetentionTurns) {
      setEventLogRetentionTurns(payload.clientSettings.eventLogRetentionTurns);
    }
    addEvent({ category: "system", title: "Вход", message: `Вы вошли в страну ${payload.countryName}`, priority: "medium", visibility: "private", countryId: payload.countryId, turn: payload.turnId });
  };

  const currentResources = useMemo(() => {
    if (!worldBase || !auth) {
      return { culture: 0, science: 0, religion: 0, colonization: 0, ducats: 0, gold: 0 };
    }
    return worldBase.resourcesByCountry[auth.countryId] ?? { culture: 0, science: 0, religion: 0, colonization: 0, ducats: 0, gold: 0 };
  }, [auth, worldBase]);
  const currentCountryDetails = useMemo(() => {
    if (!auth || !worldBase) {
      return { provinceCount: 0, totalAreaKm2: 0 };
    }
    let provinceCount = 0;
    let totalAreaKm2 = 0;
    for (const [provinceId, ownerCountryId] of Object.entries(worldBase.provinceOwner ?? {})) {
      if (ownerCountryId !== auth.countryId) continue;
      provinceCount += 1;
      totalAreaKm2 += Math.max(0, Number(provinceAreaKm2ById[provinceId] ?? 0));
    }
    return { provinceCount, totalAreaKm2: Math.round(totalAreaKm2) };
  }, [auth, provinceAreaKm2ById, worldBase]);

  const myColonizationProjection = useMemo(() => {
    if (!auth || !worldBase) {
      return { activeCount: 0, predictedPointsSpend: 0, predictedSupportDucatSpend: 0 };
    }

    const targetIds = new Set<string>();
    for (const [provinceId, byCountry] of Object.entries(worldBase.colonyProgressByProvince ?? {})) {
      if (worldBase.provinceOwner[provinceId]) continue;
      if (worldBase.provinceColonizationByProvince?.[provinceId]?.disabled) continue;
      if (byCountry[auth.countryId] != null) {
        targetIds.add(provinceId);
      }
    }

    const myOrders = ordersByTurn.get(turnId)?.get(auth.playerId) ?? [];
    for (const order of myOrders) {
      if (order.type !== "COLONIZE") continue;
      if (worldBase.provinceOwner[order.provinceId]) continue;
      if (worldBase.provinceColonizationByProvince?.[order.provinceId]?.disabled) continue;
      targetIds.add(order.provinceId);
    }

    const activeCount = targetIds.size;
    if (activeCount === 0) {
      return { activeCount, predictedPointsSpend: 0, predictedSupportDucatSpend: 0 };
    }

    const availablePoints = Math.max(0, Math.floor(currentResources.colonization ?? 0));
    if (availablePoints <= 0) {
      return { activeCount, predictedPointsSpend: 0, predictedSupportDucatSpend: 0 };
    }

    const gainPerProvince = availablePoints / activeCount;
    let predictedPointsSpend = 0;
    let predictedSupportDucatSpend = 0;
    let remainingSupportDucats = Math.max(0, Number(currentResources.ducats ?? 0));

    for (const provinceId of targetIds) {
      const provinceCfg = worldBase.provinceColonizationByProvince?.[provinceId];
      const areaKm2 = Math.max(1, Number(provinceAreaKm2ById[provinceId] ?? 1000));
      const areaFactor = Math.max(0.001, areaKm2 / 1000);
      const derivedPointsCost = Math.max(1, Math.round(colonizationCostPer1000Km2.points * areaFactor));
      const derivedDucatsCost = Math.max(0, Math.round(colonizationCostPer1000Km2.ducats * areaFactor));
      const provinceCost = Math.max(1, Math.floor(provinceCfg?.cost ?? derivedPointsCost));
      const currentProgress = Math.max(
        0,
        Number(worldBase.colonyProgressByProvince?.[provinceId]?.[auth.countryId] ?? 0),
      );
      const remainingPoints = Math.max(0, provinceCost - currentProgress);
      const ducatRatio = provinceCost > 0 ? derivedDucatsCost / provinceCost : 0;
      const spentDucatsForCurrentProgress = currentProgress * ducatRatio;
      const remainingProvinceDucats = Math.max(0, derivedDucatsCost - spentDucatsForCurrentProgress);
      const maxGainByCountryDucats = ducatRatio > 0 ? remainingSupportDucats / ducatRatio : Number.POSITIVE_INFINITY;
      const maxGainByProvinceDucats = ducatRatio > 0 ? remainingProvinceDucats / ducatRatio : Number.POSITIVE_INFINITY;
      const appliedPoints = Math.min(gainPerProvince, remainingPoints, maxGainByCountryDucats, maxGainByProvinceDucats);
      if (appliedPoints <= 0) continue;
      const appliedDucats = ducatRatio > 0 ? Math.min(remainingSupportDucats, remainingProvinceDucats, appliedPoints * ducatRatio) : 0;
      predictedPointsSpend += appliedPoints;
      predictedSupportDucatSpend += appliedDucats;
      remainingSupportDucats = Math.max(0, remainingSupportDucats - appliedDucats);
    }

    return {
      activeCount,
      predictedPointsSpend: Math.max(0, Math.floor(predictedPointsSpend)),
      predictedSupportDucatSpend: Math.max(0, Math.floor(predictedSupportDucatSpend)),
    };
  }, [auth, colonizationCostPer1000Km2.ducats, colonizationCostPer1000Km2.points, currentResources.colonization, currentResources.ducats, ordersByTurn, provinceAreaKm2ById, turnId, worldBase]);
  const activeColonizationCount = myColonizationProjection.activeCount;
  const currentTurnExpenses = useMemo(() => {
    const empty = { culture: 0, science: 0, religion: 0, colonization: 0, ducats: 0, gold: 0 };
    if (!auth) {
      return empty;
    }

    const byPlayer = ordersByTurn.get(turnId);
    const myOrders = byPlayer?.get(auth.playerId) ?? [];
    const totals = { ...empty };
    let queuedOrderDucatSpend = 0;

    for (const order of myOrders) {
      if (order.type === "COLONIZE") {
        continue;
      }
      if (order.type === "BUILD") {
        totals.ducats += 2;
        totals.gold += 5;
        queuedOrderDucatSpend += 2;
      }
    }

    if (customizationDucatSpend.turnId === turnId && customizationDucatSpend.amount > 0) {
      totals.ducats += customizationDucatSpend.amount;
    }
    if (provinceRenameDucatSpend.turnId === turnId && provinceRenameDucatSpend.amount > 0) {
      totals.ducats += provinceRenameDucatSpend.amount;
    }

    if (myColonizationProjection.predictedPointsSpend > 0) {
      totals.colonization += myColonizationProjection.predictedPointsSpend;
      const supportDucatSpend = Math.min(
        myColonizationProjection.predictedSupportDucatSpend,
        Math.max(0, Math.floor((currentResources.ducats ?? 0) - queuedOrderDucatSpend)),
      );
      totals.ducats += supportDucatSpend;
    }

    return totals;
  }, [auth, currentResources.ducats, customizationDucatSpend.amount, customizationDucatSpend.turnId, myColonizationProjection.predictedPointsSpend, myColonizationProjection.predictedSupportDucatSpend, ordersByTurn, provinceRenameDucatSpend.amount, provinceRenameDucatSpend.turnId, turnId]);
  useEffect(() => {
    setCustomizationDucatSpend((prev) => (prev.turnId === turnId ? prev : { turnId, amount: 0 }));
    setProvinceRenameDucatSpend((prev) => (prev.turnId === turnId ? prev : { turnId, amount: 0 }));
  }, [turnId]);

  const logoutToAuth = () => {
    addEvent({ category: "system", title: "Выход", message: "Сессия игрока завершена", priority: "low", visibility: "private", countryId: auth?.countryId ?? null });
    setAuth(null);
    setCountry(null);
    setEntryLoadingGate("hidden");
    toast("Вы вышли из страны");
  };

  const forceResolveAsAdmin = () => {
    if (!auth?.isAdmin) {
      toast.error("Только для администраторов");
      return;
    }

    setTurnResolveOverlay({ phase: "processing", startedAtMs: Date.now() });
    send({ type: "ADMIN_FORCE_RESOLVE" });
    toast("Админ-команда отправлена", { description: "Принудительный резолв хода" });
    addEvent({ category: "system", title: "Админ-команда", message: "Отправлен принудительный резолв хода", priority: "high", visibility: "private", countryId: auth.countryId });
  };

  const handleSessionCountryUpdated = (updated: { name: string; color: string; flagUrl?: string | null; crestUrl?: string | null; isAdmin?: boolean }) => {
    setCountry((prev) => ({
      name: updated.name,
      color: updated.color,
      flagUrl: updated.flagUrl ?? prev?.flagUrl ?? null,
      crestUrl: updated.crestUrl ?? prev?.crestUrl ?? null,
    }));

    if (auth) {
      setAuth({ ...auth, isAdmin: Boolean(updated.isAdmin) });
    }
  };


  const queueColonizeOrder = (provinceId?: string) => {
    if (!auth) {
      return;
    }

    const delta: OrderDelta = {
      type: "ORDER_DELTA",
      order: {
        turnId,
        playerId: auth.playerId,
        countryId: auth.countryId,
        provinceId: provinceId ?? selectedProvinceId ?? "ARG-1309",
        type: "COLONIZE",
        payload: {},
      },
    };

    send(delta);
    toast("Приказ отправлен", { description: `COLONIZE -> ${provinceId ?? selectedProvinceId ?? "ARG-1309"}` });
    addEvent({
      category: "colonization",
      title: "Отправлен приказ",
      message: `COLONIZE -> ${provinceId ?? selectedProvinceId ?? "ARG-1309"}`,
      countryId: auth.countryId,
      priority: "medium",
      visibility: "private",
      turn: turnId,
    });
  };

  const queueBuildOrder = (provinceId?: string) => {
    if (!auth) {
      return;
    }

    const delta: OrderDelta = {
      type: "ORDER_DELTA",
      order: {
        turnId,
        playerId: auth.playerId,
        countryId: auth.countryId,
        provinceId: provinceId ?? selectedProvinceId ?? "ARG-1309",
        type: "BUILD",
        payload: { building: "factory" },
      },
    };

    send(delta);
    toast("Приказ отправлен", { description: `BUILD -> ${provinceId ?? selectedProvinceId ?? "ARG-1309"}` });
    addEvent({
      category: "economy",
      title: "Отправлен приказ",
      message: `BUILD -> ${provinceId ?? selectedProvinceId ?? "ARG-1309"}`,
      countryId: auth.countryId,
      priority: "medium",
      visibility: "private",
      turn: turnId,
    });
  };

  useEffect(() => {
    pruneLogEntries(turnId);
  }, [eventLogRetentionTurns, pruneLogEntries, turnId]);

  useEffect(() => {
    if (!auth) return;
    if (turnResolveOverlay.phase !== "idle") return;
    if (!turnTimerUi.enabled || !turnTimerUi.startedAtMs) return;

    const dueAtMs = turnTimerUi.startedAtMs + Math.max(10, turnTimerUi.secondsPerTurn) * 1000;
    const tick = () => {
      if (Date.now() >= dueAtMs) {
        setTurnResolveOverlay((prev) => (prev.phase === "idle" ? { phase: "processing", startedAtMs: Date.now() } : prev));
      }
    };

    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [auth, turnResolveOverlay.phase, turnTimerUi.enabled, turnTimerUi.secondsPerTurn, turnTimerUi.startedAtMs]);

  useEffect(() => {
    if (!auth) {
      setEntryLoadingGate("hidden");
      return;
    }
    const ready = Boolean(worldBase) && Boolean(country) && provinceIndexLoaded && publicUiLoaded;
    setEntryLoadingGate((prev) => {
      if (prev === "hidden") return prev;
      if (prev === "loading" && ready) return "ready";
      return prev;
    });
  }, [auth, country, provinceIndexLoaded, publicUiLoaded, worldBase]);

  const requestNextTurn = () => {
    if (turnResolveOverlay.phase === "processing") return;
    setTurnResolveOverlay({ phase: "processing", startedAtMs: Date.now() });
    send({ type: "REQUEST_RESOLVE" });
  };

  const openUiNotification = (item: InAppUiNotification) => {
    setViewedUiNotificationIds((prev) => {
      if (prev.has(item.id)) return prev;
      const next = new Set(prev);
      next.add(item.id);
      return next;
    });
    if (sortNotifications) {
      setUiNotifications((prev) => {
        const idx = prev.findIndex((n) => n.id === item.id);
        if (idx < 0 || idx === prev.length - 1) return prev;
        const next = [...prev];
        const [opened] = next.splice(idx, 1);
        next.push(opened);
        return next;
      });
    }
    if (item.action.type === "registration-approval") {
      setRegistrationApprovalModal({
        open: true,
        country: item.action.country,
        notificationId: item.id,
        pending: false,
      });
    }
  };

  const resolveRegistrationApproval = async (approve: boolean) => {
    if (!auth?.token || !registrationApprovalModal.country || !registrationApprovalModal.notificationId) return;
    setRegistrationApprovalModal((prev) => ({ ...prev, pending: true }));
    try {
      const result = await adminReviewRegistration(auth.token, registrationApprovalModal.country.id, approve);
      setUiNotifications((prev) => prev.filter((n) => n.id !== registrationApprovalModal.notificationId));
      setRegistrationApprovalModal({ open: false, country: null, notificationId: null, pending: false });
      toast.success(approve ? "Регистрация подтверждена" : "Регистрация отклонена");
      if (result.country) {
        addEvent({
          category: "politics",
          title: approve ? "Регистрация подтверждена" : "Регистрация отклонена",
          message: `${result.country.name}`,
          visibility: "private",
          countryId: auth.countryId,
        });
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "REGISTRATION_REVIEW_FAILED";
      if (code === "REGISTRATION_ALREADY_REVIEWED") {
        toast.error("Заявка уже обработана");
        setUiNotifications((prev) => prev.filter((n) => n.id !== registrationApprovalModal.notificationId));
        setRegistrationApprovalModal({ open: false, country: null, notificationId: null, pending: false });
      } else {
        toast.error("Не удалось обработать заявку");
        setRegistrationApprovalModal((prev) => ({ ...prev, pending: false }));
      }
    }
  };

  return (
    <div className="relative h-screen overflow-hidden bg-arc-bg text-white">
      <MapView
        apiBase={apiBase}
        activeMode={mapMode}
        onQueueBuildOrder={queueBuildOrder}
        onQueueColonizeOrder={queueColonizeOrder}
        colonizationIconUrl={resourceIcons.colonization}
        ducatsIconUrl={resourceIcons.ducats}
        maxActiveColonizations={maxActiveColonizations}
        colonizationCostPer1000Km2={colonizationCostPer1000Km2}
        provinceRenameDucatsCost={provinceRenameDucatsCost}
        showMapControls={showMapControls}
        showAntarctica={showAntarctica}
        onOpenAdminProvinceEditor={(provinceId) => {
          setAdminInitialProvinceId(provinceId);
          setAdminOpen(true);
        }}
        onOpenProvinceKnowledge={(provinceId, provinceName) => {
          setCivilopediaIntent({
            type: "province",
            provinceId,
            provinceName,
            createIfMissing: false,
          });
          setCivilopediaOpen(true);
        }}
        onCreateProvinceKnowledge={(provinceId, provinceName) => {
          setCivilopediaIntent({
            type: "province",
            provinceId,
            provinceName,
            createIfMissing: true,
          });
          setCivilopediaOpen(true);
        }}
        onProvinceRenameCharged={(chargedDucats) => {
          if (chargedDucats <= 0) return;
          setProvinceRenameDucatSpend((prev) =>
            prev.turnId === turnId ? { turnId, amount: prev.amount + chargedDucats } : { turnId, amount: chargedDucats },
          );
        }}
      />

      <AnimatePresence>
        {!auth && (
          <motion.div
            key="auth"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 backdrop-blur-[3px]"
          >
                        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(10,14,18,0.06),rgba(3,6,10,0.62)_72%)]" />
            <div className="relative z-10">
              <AuthPanel onSuccess={onAuthSuccess} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {auth?.isAdmin && (
        <InAppNotificationTray
          items={uiNotifications}
          viewedIds={viewedUiNotificationIds}
          topOffsetPx={80}
          onClickItem={openUiNotification}
        />
      )}

      <AnimatePresence>
        {auth && entryLoadingGate !== "hidden" && (
          <motion.div
            key="entry-loading-gate"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[145] flex items-center justify-center bg-black/60 backdrop-blur-md"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(18,26,38,0.16),rgba(4,8,12,0.82)_72%)]" />
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="glass panel-border relative z-10 w-[min(92vw,34rem)] rounded-2xl bg-[#0b111b] p-6 shadow-2xl"
            >
              {entryLoadingGate === "loading" ? (
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-arc-accent/30 bg-arc-accent/10">
                    <Loader2 className="h-8 w-8 animate-spin text-arc-accent" />
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-white">Загрузка данных игры</div>
                    <div className="mt-1 text-sm text-white/60">
                      Подготавливаем карту, настройки и состояние вашей страны
                    </div>
                  </div>
                  <div className="grid w-full grid-cols-1 gap-2 text-left text-xs text-white/70 sm:grid-cols-2">
                    <div className={`rounded-lg border px-3 py-2 ${worldBase ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-white/10 bg-white/5"}`}>
                      Состояние мира {worldBase ? "готово" : "загрузка"}
                    </div>
                    <div className={`rounded-lg border px-3 py-2 ${provinceIndexLoaded ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-white/10 bg-white/5"}`}>
                      Провинции {provinceIndexLoaded ? "готово" : "загрузка"}
                    </div>
                    <div className={`rounded-lg border px-3 py-2 ${publicUiLoaded ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-white/10 bg-white/5"}`}>
                      UI-настройки {publicUiLoaded ? "готово" : "загрузка"}
                    </div>
                    <div className={`rounded-lg border px-3 py-2 ${country ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-white/10 bg-white/5"}`}>
                      Профиль страны {country ? "готово" : "загрузка"}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-500/10 text-2xl text-emerald-300">
                    ✓
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-white">Данные загружены</div>
                    <div className="mt-1 text-sm text-white/60">Можно входить в игру</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEntryLoadingGate("hidden")}
                    className="panel-border inline-flex h-11 items-center justify-center rounded-xl bg-arc-accent px-5 text-sm font-semibold text-black transition hover:brightness-110"
                  >
                    Войти в игру
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {auth && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="pointer-events-none absolute inset-0 z-[70]">
          <TopBar
            countryName={country?.name ?? "Безымянная держава"}
            flagUrl={country?.flagUrl}
            crestUrl={country?.crestUrl}
            turnId={turnId}
            resources={currentResources}
            onOpenTurnStatus={() => setTurnStatusOpen(true)}
            onNextTurn={requestNextTurn}
            onLogout={logoutToAuth}
            isAdmin={auth.isAdmin}
            onAdminForceResolve={forceResolveAsAdmin}
            onOpenAdminPanel={() => setAdminOpen(true)}
            onOpenGameSettings={() => setGameSettingsOpen(true)}
            onOpenCountryCustomization={() => setCountryCustomizationOpen(true)}
            onOpenClientSettings={() => setClientSettingsOpen(true)}
            onOpenCivilopedia={() => {
              setCivilopediaIntent(null);
              setCivilopediaOpen(true);
            }}
            resourceIconUrls={resourceIcons}
            resourceGrowthByTurn={resourceGrowthByTurn}
            resourceExpenseByTurn={currentTurnExpenses}
            colonizationLimit={{ active: activeColonizationCount, max: maxActiveColonizations }}
            countryDetails={currentCountryDetails}
            turnTimer={turnTimerUi}
          />
          <SideNav />
          <EventLogPanel
            entries={eventLog}
            currentCountryId={auth.countryId}
            onTrimOld={() => trimOldLogEntries(50)}
            onClear={clearEventLog}
          />
          <MapModePanel activeMode={mapMode} onModeChange={setMapMode} />

        </motion.div>
      )}

      {auth?.isAdmin && auth?.token && (
        <AdminPanel
          open={adminOpen}
          token={auth.token}
          currentCountryId={auth.countryId}
          onClose={() => {
            setAdminOpen(false);
            setAdminInitialProvinceId(null);
          }}
          onSessionCountryUpdated={handleSessionCountryUpdated}
          initialProvinceId={adminInitialProvinceId}
        />
      )}

      {auth && <TurnStatusModal open={turnStatusOpen} onClose={() => setTurnStatusOpen(false)} />}

      {auth?.isAdmin && auth?.token && (
        <GameSettingsPanel
          open={gameSettingsOpen}
          token={auth.token}
          onClose={() => setGameSettingsOpen(false)}
          onResourceIconsUpdated={setResourceIcons}
          onSettingsUpdated={(updated) => {
            setMaxActiveColonizations(updated.colonization.maxActiveColonizations);
            setColonizationCostPer1000Km2({
              points: updated.colonization.pointsCostPer1000Km2,
              ducats: updated.colonization.ducatsCostPer1000Km2,
            });
            setResourceGrowthByTurn((prev) => ({
              ...prev,
              colonization: updated.colonization.pointsPerTurn,
              ducats: updated.economy.baseDucatsPerTurn,
              gold: updated.economy.baseGoldPerTurn,
            }));
            setEventLogRetentionTurns(updated.eventLog.retentionTurns);
            setShowAntarctica(updated.map?.showAntarctica ?? true);
            setProvinceRenameDucatsCost(updated.customization?.provinceRenameDucats ?? 25);
            setTurnTimerUi((prev) => ({
              enabled: updated.turnTimer?.enabled ?? prev.enabled,
              secondsPerTurn: updated.turnTimer?.secondsPerTurn ?? prev.secondsPerTurn,
              startedAtMs: Date.now(),
            }));
          }}
        />
      )}

      {auth?.token && country && (
        <CountryCustomizationModal
          open={countryCustomizationOpen}
          token={auth.token}
          country={country}
          currentDucats={currentResources.ducats}
          ducatsIconUrl={resourceIcons.ducats}
          onClose={() => setCountryCustomizationOpen(false)}
          onSaved={(updated) => {
            setCountry((prev) => ({
              name: updated.name,
              color: updated.color,
              flagUrl: updated.flagUrl ?? prev?.flagUrl ?? null,
              crestUrl: updated.crestUrl ?? prev?.crestUrl ?? null,
            }));
            if (auth) {
              updateCountryResources(auth.countryId, { ducats: updated.ducats });
              if (updated.chargedDucats > 0) {
                setCustomizationDucatSpend((prev) =>
                  prev.turnId === turnId
                    ? { turnId, amount: prev.amount + updated.chargedDucats }
                    : { turnId, amount: updated.chargedDucats },
                );
              }
              addEvent({
                category: "politics",
                title: "Изменение страны",
                message: `Кастомизация применена для ${updated.name} (-дукаты)`,
                countryId: auth.countryId,
                priority: "medium",
                visibility: "private",
                turn: turnId,
              });
            }
          }}
        />
      )}

      {auth && (
        <ClientSettingsModal
          open={clientSettingsOpen}
          showMapControls={showMapControls}
          sortNotifications={sortNotifications}
          onClose={() => setClientSettingsOpen(false)}
          onSave={({ showMapControls: nextShowMapControls, sortNotifications: nextSortNotifications }) => {
            setShowMapControls(nextShowMapControls);
            setSortNotifications(nextSortNotifications);
          }}
        />
      )}

      {auth?.isAdmin && (
        <RegistrationApprovalModal
          open={registrationApprovalModal.open}
          pending={registrationApprovalModal.pending}
          country={registrationApprovalModal.country}
          onClose={() => setRegistrationApprovalModal((prev) => (prev.pending ? prev : { open: false, country: null, notificationId: null, pending: false }))}
          onApprove={() => void resolveRegistrationApproval(true)}
          onReject={() => void resolveRegistrationApproval(false)}
        />
      )}

      <CivilopediaModal
        open={civilopediaOpen}
        onClose={() => {
          setCivilopediaOpen(false);
          setCivilopediaIntent(null);
        }}
        isAdmin={Boolean(auth?.isAdmin)}
        adminToken={auth?.token ?? null}
        initialIntent={civilopediaIntent}
        onIntentHandled={() => setCivilopediaIntent(null)}
      />

      <AnimatePresence>
        {auth && turnResolveOverlay.phase !== "idle" && (
          <motion.div
            key="turn-resolve-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[160] flex items-center justify-center bg-black/55 backdrop-blur-md"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(18,26,38,0.18),rgba(4,8,12,0.78)_72%)]" />
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="glass panel-border relative z-10 w-[min(92vw,34rem)] rounded-2xl bg-[#0b111b] p-6 shadow-2xl"
            >
              {turnResolveOverlay.phase === "processing" ? (
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-500/10">
                    <Loader2 className="h-8 w-8 animate-spin text-emerald-300" />
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-white">Идет обработка хода</div>
                    <div className="mt-1 text-sm text-white/60">Подождите, сервер выполняет резолв приказов</div>
                  </div>
                  <div className="text-xs text-white/45">Во время обработки действия временно недоступны</div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-arc-accent/30 bg-arc-accent/10 text-2xl text-arc-accent">
                    ✓
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-white">
                      Обработка хода завершена
                    </div>
                    <div className="mt-1 text-sm text-white/65">
                      Ход #{turnResolveOverlay.resolvedTurnId} успешно обработан
                    </div>
                  </div>
                  <div className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="text-xs text-white/55">Общее время обработки</div>
                    <div className="mt-1 text-xl font-semibold tabular-nums text-white">
                      {(turnResolveOverlay.durationMs / 1000).toFixed(2)} c
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTurnResolveOverlay({ phase: "idle" })}
                    className="panel-border inline-flex h-11 items-center justify-center rounded-xl bg-arc-accent px-5 text-sm font-semibold text-black transition hover:brightness-110"
                  >
                    Вернуться к игре
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}




















