import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
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
import { apiBase, fetchPublicGameUiSettings, type ResourceIconsMap } from "./lib/api";
import { useWs } from "./lib/useWs";
import { useGameStore } from "./store/gameStore";

type SessionCountry = {
  name: string;
  color: string;
  flagUrl?: string | null;
  crestUrl?: string | null;
};

export default function App() {
  const [country, setCountry] = useState<SessionCountry | null>(null);
  const [mapMode, setMapMode] = useState("Политическая карта");
  const [cmdOpen, setCmdOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [turnStatusOpen, setTurnStatusOpen] = useState(false);
  const [gameSettingsOpen, setGameSettingsOpen] = useState(false);
  const [countryCustomizationOpen, setCountryCustomizationOpen] = useState(false);
  const [resourceIcons, setResourceIcons] = useState<ResourceIconsMap>({
    culture: null,
    science: null,
    religion: null,
    colonization: null,
    ducats: null,
    gold: null,
  });

  const auth = useGameStore((s) => s.auth);
  const turnId = useGameStore((s) => s.turnId);
  const worldBase = useGameStore((s) => s.worldBase);
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

      if (msg.type === "WORLD_PATCH") {
        setWorldBase(msg.worldBase, msg.turnId);
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

      if (msg.type === "PRESENCE") {
        setPresence(msg.onlinePlayerIds);
      }

      if (msg.type === "ERROR") {
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
    let cancelled = false;
    fetchPublicGameUiSettings()
      .then((ui) => {
        if (!cancelled) {
          setResourceIcons(ui.resourceIcons);
        }
      })
      .catch(() => {
        // keep defaults
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onAuthSuccess = (payload: AuthSuccess) => {
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

  const logoutToAuth = () => {
    addEvent({ category: "system", title: "Выход", message: "Сессия игрока завершена", priority: "low", visibility: "private", countryId: auth?.countryId ?? null });
    setAuth(null);
    setCountry(null);
    toast("Вы вышли из страны");
  };

  const forceResolveAsAdmin = () => {
    if (!auth?.isAdmin) {
      toast.error("Только для администраторов");
      return;
    }

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

  return (
    <div className="relative h-screen overflow-hidden bg-arc-bg text-white">
      <MapView apiBase={apiBase} activeMode={mapMode} onQueueBuildOrder={queueBuildOrder} onQueueColonizeOrder={queueColonizeOrder} />

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

      {auth && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="pointer-events-none absolute inset-0 z-[70]">
          <TopBar
            countryName={country?.name ?? "Безымянная держава"}
            flagUrl={country?.flagUrl}
            crestUrl={country?.crestUrl}
            turnId={turnId}
            resources={currentResources}
            onOpenTurnStatus={() => setTurnStatusOpen(true)}
            onNextTurn={() => send({ type: "REQUEST_RESOLVE" })}
            onLogout={logoutToAuth}
            isAdmin={auth.isAdmin}
            onAdminForceResolve={forceResolveAsAdmin}
            onOpenAdminPanel={() => setAdminOpen(true)}
            onOpenGameSettings={() => setGameSettingsOpen(true)}
            onOpenCountryCustomization={() => setCountryCustomizationOpen(true)}
            resourceIconUrls={resourceIcons}
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
          onClose={() => setAdminOpen(false)}
          onSessionCountryUpdated={handleSessionCountryUpdated}
        />
      )}

      {auth && <TurnStatusModal open={turnStatusOpen} onClose={() => setTurnStatusOpen(false)} />}

      {auth?.isAdmin && auth?.token && (
        <GameSettingsPanel
          open={gameSettingsOpen}
          token={auth.token}
          onClose={() => setGameSettingsOpen(false)}
          onResourceIconsUpdated={setResourceIcons}
        />
      )}

      {auth?.token && country && (
        <CountryCustomizationModal
          open={countryCustomizationOpen}
          token={auth.token}
          country={country}
          currentDucats={currentResources.ducats}
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

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}




















