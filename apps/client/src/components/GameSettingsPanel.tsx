import { Dialog } from "@headlessui/react";
import { useEffect, useState } from "react";
import { Coins, Flag, Image as ImageIcon, Palette, RefreshCcw, Save, ScrollText, Timer, Wallet, X, Monitor } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { adminRecalculateAutoProvinceCosts, adminUploadResourceIcons, adminUploadUiBackground, fetchGameSettings, type GameSettings, type ResourceIconsMap, updateGameSettings } from "../lib/api";

type Props = {
  open: boolean;
  token: string;
  onClose: () => void;
  onResourceIconsUpdated?: (icons: ResourceIconsMap) => void;
  onSettingsUpdated?: (settings: GameSettings) => void;
};

const categories = [
  { id: "economy", label: "Экономика", icon: Wallet },
  { id: "turnTimer", label: "Таймер хода", icon: Timer },
  { id: "colonization", label: "Колонизация", icon: Flag },
  { id: "registration", label: "Регистрация", icon: Flag },
  { id: "customization", label: "Кастомизация", icon: Palette },
  { id: "eventLog", label: "Журнал событий", icon: ScrollText },
  { id: "background", label: "Фон интерфейса", icon: Monitor },
  { id: "resourceIcons", label: "Иконки очков", icon: ImageIcon },
] as const;

async function isImageWithinMaxSize(file: File, maxSize = 64): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const ok = img.width <= maxSize && img.height <= maxSize;
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}

export function GameSettingsPanel({ open, token, onClose, onResourceIconsUpdated, onSettingsUpdated }: Props) {
  const [activeCategory, setActiveCategory] = useState<(typeof categories)[number]["id"]>("economy");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [baseDucatsPerTurn, setBaseDucatsPerTurn] = useState(5);
  const [baseGoldPerTurn, setBaseGoldPerTurn] = useState(10);
  const [maxActiveColonizations, setMaxActiveColonizations] = useState(3);
  const [colonizationPointsPerTurn, setColonizationPointsPerTurn] = useState(30);
  const [colonizationPointsCostPer1000Km2, setColonizationPointsCostPer1000Km2] = useState(5);
  const [colonizationDucatsCostPer1000Km2, setColonizationDucatsCostPer1000Km2] = useState(5);
  const [renameDucats, setRenameDucats] = useState(20);
  const [recolorDucats, setRecolorDucats] = useState(10);
  const [flagDucats, setFlagDucats] = useState(15);
  const [crestDucats, setCrestDucats] = useState(15);
  const [provinceRenameDucats, setProvinceRenameDucats] = useState(25);
  const [eventLogRetentionTurns, setEventLogRetentionTurns] = useState(3);
  const [requireAdminApprovalForRegistration, setRequireAdminApprovalForRegistration] = useState(false);
  const [turnTimerEnabled, setTurnTimerEnabled] = useState(false);
  const [turnTimerSeconds, setTurnTimerSeconds] = useState(300);
  const [showAntarctica, setShowAntarctica] = useState(true);
  const [resourceIcons, setResourceIcons] = useState<ResourceIconsMap>({
    culture: null,
    science: null,
    religion: null,
    colonization: null,
    ducats: null,
    gold: null,
  });
  const [resourceIconFiles, setResourceIconFiles] = useState<Partial<Record<keyof ResourceIconsMap, File | null>>>({});
  const [uiBackgroundImageUrl, setUiBackgroundImageUrl] = useState<string | null>(null);
  const [uiBackgroundFile, setUiBackgroundFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchGameSettings(token)
      .then((settings) => {
        if (cancelled) return;
        setBaseDucatsPerTurn(settings.economy.baseDucatsPerTurn);
        setBaseGoldPerTurn(settings.economy.baseGoldPerTurn);
        setMaxActiveColonizations(settings.colonization.maxActiveColonizations);
        setColonizationPointsPerTurn(settings.colonization.pointsPerTurn);
        setColonizationPointsCostPer1000Km2(settings.colonization.pointsCostPer1000Km2);
        setColonizationDucatsCostPer1000Km2(settings.colonization.ducatsCostPer1000Km2);
        setRenameDucats(settings.customization.renameDucats);
        setRecolorDucats(settings.customization.recolorDucats);
        setFlagDucats(settings.customization.flagDucats);
        setCrestDucats(settings.customization.crestDucats);
        setProvinceRenameDucats(settings.customization.provinceRenameDucats ?? 25);
        setEventLogRetentionTurns(settings.eventLog.retentionTurns);
        setRequireAdminApprovalForRegistration(settings.registration?.requireAdminApproval ?? false);
        setTurnTimerEnabled(settings.turnTimer?.enabled ?? false);
        setTurnTimerSeconds(settings.turnTimer?.secondsPerTurn ?? 300);
        setShowAntarctica(settings.map?.showAntarctica ?? true);
        setUiBackgroundImageUrl(settings.map?.backgroundImageUrl ?? null);
        setUiBackgroundFile(null);
        setResourceIcons(settings.resourceIcons);
        setResourceIconFiles({});
      })
      .catch(() => {
        if (!cancelled) toast.error("Не удалось загрузить настройки игры");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, token]);

  const saveEconomy = async () => {
    setSaving(true);
    try {
      const updated = await updateGameSettings(token, {
        economy: {
          baseDucatsPerTurn: Math.max(0, Math.floor(baseDucatsPerTurn)),
          baseGoldPerTurn: Math.max(0, Math.floor(baseGoldPerTurn)),
        },
      });
      setBaseDucatsPerTurn(updated.economy.baseDucatsPerTurn);
      setBaseGoldPerTurn(updated.economy.baseGoldPerTurn);
      onSettingsUpdated?.(updated);
      toast.success("Настройки экономики сохранены");
    } catch {
      toast.error("Не удалось сохранить настройки экономики");
    } finally {
      setSaving(false);
    }
  };

  const saveColonization = async () => {
    setSaving(true);
    try {
      const updated = await updateGameSettings(token, {
        colonization: {
          maxActiveColonizations: Math.max(1, Math.floor(maxActiveColonizations)),
          pointsPerTurn: Math.max(0, Math.floor(colonizationPointsPerTurn)),
          pointsCostPer1000Km2: Math.max(1, Math.floor(colonizationPointsCostPer1000Km2)),
          ducatsCostPer1000Km2: Math.max(0, Math.floor(colonizationDucatsCostPer1000Km2)),
        },
        map: {
          showAntarctica,
        },
      });
      setMaxActiveColonizations(updated.colonization.maxActiveColonizations);
      setColonizationPointsPerTurn(updated.colonization.pointsPerTurn);
      setColonizationPointsCostPer1000Km2(updated.colonization.pointsCostPer1000Km2);
      setColonizationDucatsCostPer1000Km2(updated.colonization.ducatsCostPer1000Km2);
      setShowAntarctica(updated.map?.showAntarctica ?? true);
      onSettingsUpdated?.(updated);
      toast.success("Настройки колонизации сохранены");
    } catch {
      toast.error("Не удалось сохранить настройки колонизации");
    } finally {
      setSaving(false);
    }
  };

  const recalculateAutoProvinceCosts = async () => {
    setSaving(true);
    try {
      const result = await adminRecalculateAutoProvinceCosts(token);
      toast.success(`Пересчитаны авто-цены: ${result.updatedCount}`);
    } catch {
      toast.error("Не удалось пересчитать авто-цены");
    } finally {
      setSaving(false);
    }
  };

  const saveCustomization = async () => {
    setSaving(true);
    try {
      const updated = await updateGameSettings(token, {
        customization: {
          renameDucats: Math.max(0, Math.floor(renameDucats)),
          recolorDucats: Math.max(0, Math.floor(recolorDucats)),
          flagDucats: Math.max(0, Math.floor(flagDucats)),
          crestDucats: Math.max(0, Math.floor(crestDucats)),
          provinceRenameDucats: Math.max(0, Math.floor(provinceRenameDucats)),
        },
      });
      setRenameDucats(updated.customization.renameDucats);
      setRecolorDucats(updated.customization.recolorDucats);
      setFlagDucats(updated.customization.flagDucats);
      setCrestDucats(updated.customization.crestDucats);
      setProvinceRenameDucats(updated.customization.provinceRenameDucats ?? 25);
      onSettingsUpdated?.(updated);
      toast.success("Цены кастомизации сохранены");
    } catch {
      toast.error("Не удалось сохранить цены кастомизации");
    } finally {
      setSaving(false);
    }
  };

  const saveEventLogSettings = async () => {
    setSaving(true);
    try {
      const updated = await updateGameSettings(token, {
        eventLog: { retentionTurns: Math.max(1, Math.floor(eventLogRetentionTurns)) },
      });
      setEventLogRetentionTurns(updated.eventLog.retentionTurns);
      onSettingsUpdated?.(updated);
      toast.success("Настройки журнала событий сохранены");
    } catch {
      toast.error("Не удалось сохранить настройки журнала событий");
    } finally {
      setSaving(false);
    }
  };

  const saveRegistrationSettings = async () => {
    setSaving(true);
    try {
      const updated = await updateGameSettings(token, {
        registration: { requireAdminApproval: requireAdminApprovalForRegistration },
      });
      setRequireAdminApprovalForRegistration(updated.registration?.requireAdminApproval ?? false);
      onSettingsUpdated?.(updated);
      toast.success("Настройки регистрации сохранены");
    } catch {
      toast.error("Не удалось сохранить настройки регистрации");
    } finally {
      setSaving(false);
    }
  };

  const saveTurnTimer = async () => {
    setSaving(true);
    try {
      const updated = await updateGameSettings(token, {
        turnTimer: {
          enabled: turnTimerEnabled,
          secondsPerTurn: Math.min(2_592_000, Math.max(10, Math.floor(turnTimerSeconds || 10))),
        },
      });
      setTurnTimerEnabled(updated.turnTimer.enabled);
      setTurnTimerSeconds(updated.turnTimer.secondsPerTurn);
      onSettingsUpdated?.(updated);
      toast.success("Таймер хода сохранён");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("GAME_SETTINGS_INVALID")) {
        toast.error("Не удалось сохранить таймер хода", {
          description: "Допустимый диапазон: от 10 до 2 592 000 секунд (до 30 дней)",
        });
      } else {
        toast.error("Не удалось сохранить таймер хода");
      }
    } finally {
      setSaving(false);
    }
  };

  const saveResourceIcons = async () => {
    const selected = Object.entries(resourceIconFiles).filter(([, f]) => f) as Array<[keyof ResourceIconsMap, File]>;
    if (selected.length === 0) {
      toast.error("Сначала выберите хотя бы одну иконку");
      return;
    }

    for (const [key, file] of selected) {
      const ok = await isImageWithinMaxSize(file, 64);
      if (!ok) {
        toast.error(`Иконка "${key}" должна быть максимум 64x64`);
        return;
      }
    }

    setSaving(true);
    try {
      const updated = await adminUploadResourceIcons(token, resourceIconFiles);
      setResourceIcons(updated.resourceIcons);
      setResourceIconFiles({});
      onResourceIconsUpdated?.(updated.resourceIcons);
      toast.success("Иконки очков обновлены");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "RESOURCE_ICONS_UPDATE_FAILED";
      if (msg === "IMAGE_DIMENSIONS_TOO_LARGE") {
        toast.error("Иконка должна быть максимум 64x64");
      } else {
        toast.error("Не удалось обновить иконки очков");
      }
    } finally {
      setSaving(false);
    }
  };

  const saveUiBackground = async () => {
    if (!uiBackgroundFile) {
      toast.error("Сначала выберите изображение");
      return;
    }
    const ok = await isImageWithinMaxSize(uiBackgroundFile, 4096);
    if (!ok) {
      toast.error("Фоновое изображение должно быть максимум 4096x4096");
      return;
    }
    setSaving(true);
    try {
      const updated = await adminUploadUiBackground(token, uiBackgroundFile);
      setUiBackgroundImageUrl(updated.map.backgroundImageUrl);
      setUiBackgroundFile(null);
      const next = await fetchGameSettings(token);
      onSettingsUpdated?.(next);
      toast.success("Фон интерфейса обновлён");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "UI_BACKGROUND_UPDATE_FAILED";
      if (msg === "IMAGE_DIMENSIONS_TOO_LARGE") {
        toast.error("Фоновое изображение должно быть максимум 4096x4096");
      } else {
        toast.error("Не удалось обновить фон интерфейса");
      }
    } finally {
      setSaving(false);
    }
  };

  const clearUiBackground = async () => {
    setSaving(true);
    try {
      const updated = await updateGameSettings(token, { map: { backgroundImageUrl: null } });
      setUiBackgroundImageUrl(updated.map.backgroundImageUrl ?? null);
      setUiBackgroundFile(null);
      onSettingsUpdated?.(updated);
      toast.success("Фон интерфейса удалён");
    } catch {
      toast.error("Не удалось удалить фон интерфейса");
    } finally {
      setSaving(false);
    }
  };

  const resourceLabels: Array<[keyof ResourceIconsMap, string]> = [
    ["culture", "Культура"],
    ["science", "Наука"],
    ["religion", "Религия"],
    ["colonization", "Колонизация"],
    ["ducats", "Дукаты"],
    ["gold", "Золото"],
  ];

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[125]">
      <motion.div
        aria-hidden="true"
        className="fixed inset-0 bg-black/55"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
      />
      <div className="fixed inset-0">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="h-full w-full"
        >
        <Dialog.Panel className="glass panel-border h-full w-full rounded-none p-4">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="font-display text-2xl tracking-wide text-arc-accent">Настройки игры</Dialog.Title>
            <button onClick={onClose} className="panel-border inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:text-arc-accent">
              <X size={16} />
            </button>
          </div>

          <div className="grid h-[calc(100vh-92px)] gap-4 md:grid-cols-[260px_1fr]">
            <aside className="arc-scrollbar panel-border overflow-auto rounded-xl bg-black/25 p-2">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`mb-2 block w-full rounded-lg px-3 py-2 text-left text-sm transition ${activeCategory === cat.id ? "bg-arc-accent/20 text-arc-accent" : "text-slate-300 hover:text-white"}`}
                >
                  <span className="inline-flex items-center gap-2">
                    <cat.icon size={14} />
                    <span>{cat.label}</span>
                  </span>
                </button>
              ))}
            </aside>

            <section className="arc-scrollbar panel-border overflow-auto rounded-xl bg-black/25 p-4">
              {loading ? (
                <div className="text-sm text-slate-400">Загрузка настроек...</div>
              ) : (
                <div className="space-y-4">
                  {activeCategory === "economy" && (
                    <div className="space-y-4 rounded-lg border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm text-slate-200">
                        <Coins size={15} className="text-arc-accent" />
                        Базовый доход за каждый резолв хода
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Дукаты / ход</label>
                          <input type="number" min={0} value={baseDucatsPerTurn} onChange={(e) => setBaseDucatsPerTurn(Math.max(0, Number(e.target.value) || 0))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Золото / ход</label>
                          <input type="number" min={0} value={baseGoldPerTurn} onChange={(e) => setBaseGoldPerTurn(Math.max(0, Number(e.target.value) || 0))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" />
                        </div>
                      </div>
                      <button onClick={saveEconomy} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">
                        <Save size={14} />
                        Сохранить
                      </button>
                    </div>
                  )}

                  {activeCategory === "turnTimer" && (
                    <div className="space-y-4 rounded-lg border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm text-slate-200">
                        <RefreshCcw size={15} className="text-arc-accent" />
                        Автоматический переход хода по таймеру
                      </div>
                      <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                        <div>
                          <div className="text-sm text-slate-100">Включить авто-переход хода</div>
                          <div className="text-xs text-slate-500">Сервер завершит ход по таймеру даже если не все страны нажали следующий ход</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setTurnTimerEnabled((v) => !v)}
                          className={`relative inline-flex h-7 w-12 items-center rounded-full border transition ${
                            turnTimerEnabled ? "border-emerald-400/50 bg-emerald-500/20" : "border-white/10 bg-white/5"
                          }`}
                          aria-pressed={turnTimerEnabled}
                          aria-label={turnTimerEnabled ? "Выключить таймер хода" : "Включить таймер хода"}
                        >
                          <span
                            className={`h-5 w-5 rounded-full transition ${
                              turnTimerEnabled
                                ? "translate-x-6 bg-emerald-500 shadow-[0_0_12px_rgba(110,231,183,0.45)]"
                                : "translate-x-1 bg-white/60"
                            }`}
                          />
                        </button>
                      </label>
                      <div>
                        <label className="mb-1 block text-xs text-slate-300">Секунд на ход</label>
                        <input
                          type="number"
                          min={10}
                          max={2_592_000}
                          value={turnTimerSeconds}
                          onChange={(e) =>
                            setTurnTimerSeconds(
                              Math.min(2_592_000, Math.max(10, Number(e.target.value) || 10)),
                            )
                          }
                          className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                        />
                        <div className="mt-1 text-xs text-slate-500">
                          Диапазон: 10–2 592 000 секунд (до 30 дней). Таймер сбрасывается после каждого резолва хода.
                        </div>
                      </div>
                      <button onClick={saveTurnTimer} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">
                        <Save size={14} />
                        Сохранить
                      </button>
                    </div>
                  )}

                  {activeCategory === "colonization" && (
                    <div className="space-y-4 rounded-lg border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm text-slate-200">
                        <Flag size={15} className="text-arc-accent" />
                        Лимиты колонизации
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Макс. одновременных колонизаций</label>
                          <input type="number" min={1} value={maxActiveColonizations} onChange={(e) => setMaxActiveColonizations(Math.max(1, Number(e.target.value) || 1))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Прирост очков колонизации / ход</label>
                          <input type="number" min={0} value={colonizationPointsPerTurn} onChange={(e) => setColonizationPointsPerTurn(Math.max(0, Number(e.target.value) || 0))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Цена (очки колонизации) за 1000 км²</label>
                          <input type="number" min={1} value={colonizationPointsCostPer1000Km2} onChange={(e) => setColonizationPointsCostPer1000Km2(Math.max(1, Number(e.target.value) || 1))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Цена (дукаты) за 1000 км²</label>
                          <input type="number" min={0} value={colonizationDucatsCostPer1000Km2} onChange={(e) => setColonizationDucatsCostPer1000Km2(Math.max(0, Number(e.target.value) || 0))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" />
                        </div>
                        <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                          <div>
                            <div className="text-sm text-slate-100">Показывать Антарктиду</div>
                            <div className="text-xs text-slate-500">Скрывает провинции Антарктиды на карте для всех игроков</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowAntarctica((v) => !v)}
                            className={`relative inline-flex h-7 w-12 items-center rounded-full border transition ${
                              showAntarctica ? "border-emerald-400/50 bg-emerald-500/20" : "border-white/10 bg-white/5"
                            }`}
                            aria-pressed={showAntarctica}
                            aria-label={showAntarctica ? "Скрыть Антарктиду" : "Показать Антарктиду"}
                          >
                            <span
                              className={`h-5 w-5 rounded-full transition ${
                                showAntarctica
                                  ? "translate-x-6 bg-emerald-500 shadow-[0_0_12px_rgba(110,231,183,0.45)]"
                                  : "translate-x-1 bg-white/60"
                              }`}
                            />
                          </button>
                        </label>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-400">
                        Базовая стоимость провинции рассчитывается от площади: `ставка за 1000 км² × площадь / 1000`. Ручная стоимость провинции в админ-редакторе остаётся как override.
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={saveColonization} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">
                          <Save size={14} />
                          Сохранить
                        </button>
                        <button
                          type="button"
                          onClick={recalculateAutoProvinceCosts}
                          disabled={saving}
                          className="inline-flex items-center gap-2 rounded-lg border border-arc-accent/30 bg-arc-accent/10 px-4 py-2 text-sm text-arc-accent transition hover:bg-arc-accent/15 disabled:opacity-60"
                        >
                          <RefreshCcw size={14} />
                          Пересчитать все авто-цены
                        </button>
                      </div>
                    </div>
                  )}

                  {activeCategory === "customization" && (
                    <div className="space-y-4 rounded-lg border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm text-slate-200">
                        <Coins size={15} className="text-arc-accent" />
                        Цены на изменение страны за дукаты
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div><label className="mb-1 block text-xs text-slate-300">Переименование страны</label><input type="number" min={0} value={renameDucats} onChange={(e) => setRenameDucats(Math.max(0, Number(e.target.value) || 0))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" /></div>
                        <div><label className="mb-1 block text-xs text-slate-300">Смена цвета</label><input type="number" min={0} value={recolorDucats} onChange={(e) => setRecolorDucats(Math.max(0, Number(e.target.value) || 0))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" /></div>
                        <div><label className="mb-1 block text-xs text-slate-300">Смена флага</label><input type="number" min={0} value={flagDucats} onChange={(e) => setFlagDucats(Math.max(0, Number(e.target.value) || 0))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" /></div>
                        <div><label className="mb-1 block text-xs text-slate-300">Смена герба</label><input type="number" min={0} value={crestDucats} onChange={(e) => setCrestDucats(Math.max(0, Number(e.target.value) || 0))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" /></div>
                        <div><label className="mb-1 block text-xs text-slate-300">Переименование провинции</label><input type="number" min={0} value={provinceRenameDucats} onChange={(e) => setProvinceRenameDucats(Math.max(0, Number(e.target.value) || 0))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" /></div>
                      </div>
                      <button onClick={saveCustomization} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">
                        <Save size={14} />
                        Сохранить
                      </button>
                    </div>
                  )}

                  {activeCategory === "registration" && (
                    <div className="space-y-4 rounded-lg border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm text-slate-200">
                        <Flag size={15} className="text-arc-accent" />
                        Регистрация новых стран
                      </div>
                      <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                        <div>
                          <div className="text-sm text-slate-100">Требовать подтверждение администратора</div>
                          <div className="text-xs text-slate-500">Новые страны регистрируются, но не могут войти до одобрения админом</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setRequireAdminApprovalForRegistration((v) => !v)}
                          className={`relative inline-flex h-7 w-12 items-center rounded-full border transition ${
                            requireAdminApprovalForRegistration ? "border-emerald-400/50 bg-emerald-500/20" : "border-white/10 bg-white/5"
                          }`}
                          aria-pressed={requireAdminApprovalForRegistration}
                          aria-label={requireAdminApprovalForRegistration ? "Выключить подтверждение регистрации" : "Включить подтверждение регистрации"}
                        >
                          <span
                            className={`h-5 w-5 rounded-full transition ${
                              requireAdminApprovalForRegistration
                                ? "translate-x-6 bg-emerald-500 shadow-[0_0_12px_rgba(110,231,183,0.45)]"
                                : "translate-x-1 bg-white/60"
                            }`}
                          />
                        </button>
                      </label>
                      <button onClick={saveRegistrationSettings} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">
                        <Save size={14} />
                        Сохранить
                      </button>
                    </div>
                  )}

                  {activeCategory === "eventLog" && (
                    <div className="space-y-4 rounded-lg border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm text-slate-200">
                        <Coins size={15} className="text-arc-accent" />
                        Глобальные настройки журнала событий
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-300">Хранить события за последние (ходов)</label>
                        <input type="number" min={1} max={100} value={eventLogRetentionTurns} onChange={(e) => setEventLogRetentionTurns(Math.max(1, Number(e.target.value) || 1))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" />
                      </div>
                      <button onClick={saveEventLogSettings} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">
                        <Save size={14} />
                        Сохранить
                      </button>
                    </div>
                  )}

                  {activeCategory === "background" && (
                    <div className="space-y-4 rounded-lg border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm text-slate-200">
                        <Monitor size={15} className="text-arc-accent" />
                        Фоновое изображение интерфейса (макс. 4096x4096)
                      </div>
                      <div className="panel-border rounded-lg bg-black/25 p-3">
                        <div className="mb-2 text-xs text-slate-400">Текущий фон</div>
                        <div className="flex h-40 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-black/30">
                          {uiBackgroundImageUrl ? (
                            <img src={uiBackgroundImageUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="text-xs text-slate-500">Фон не установлен</div>
                          )}
                        </div>
                      </div>
                      <label className="panel-border flex cursor-pointer items-center justify-center rounded-lg bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:border-arc-accent/40">
                        Выбрать изображение
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => setUiBackgroundFile(e.target.files?.[0] ?? null)}
                        />
                      </label>
                      {uiBackgroundFile ? <div className="text-xs text-emerald-500">Выбран файл: {uiBackgroundFile.name}</div> : null}
                      <div className="flex flex-wrap gap-2">
                        <button onClick={saveUiBackground} disabled={saving || !uiBackgroundFile} className="inline-flex items-center gap-2 rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">
                          <Save size={14} />
                          Загрузить фон
                        </button>
                        <button
                          type="button"
                          onClick={clearUiBackground}
                          disabled={saving || (!uiBackgroundImageUrl && !uiBackgroundFile)}
                          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:border-rose-300/30 hover:text-rose-200 disabled:opacity-60"
                        >
                          <X size={14} />
                          Удалить фон
                        </button>
                      </div>
                    </div>
                  )}

                  {activeCategory === "resourceIcons" && (
                    <div className="space-y-4 rounded-lg border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm text-slate-200">
                        <Coins size={15} className="text-arc-accent" />
                        Иконки очков в верхней панели (макс. 64x64)
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {resourceLabels.map(([key, label]) => (
                          <div key={key} className="panel-border rounded-lg bg-black/25 p-3">
                            <div className="mb-2 text-xs text-slate-300">{label}</div>
                            <div className="mb-2 flex h-16 items-center justify-center rounded-md bg-black/35">
                              {resourceIcons[key] ? <img src={resourceIcons[key] ?? undefined} alt="" className="h-12 w-12 object-contain" /> : <div className="text-xs text-slate-500">Нет иконки</div>}
                            </div>
                            <label className="panel-border flex cursor-pointer items-center justify-center rounded-lg bg-white/5 px-2 py-2 text-xs text-slate-200 transition hover:border-arc-accent/40">
                              Выбрать файл
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => setResourceIconFiles((prev) => ({ ...prev, [key]: e.target.files?.[0] ?? null }))}
                              />
                            </label>
                            {resourceIconFiles[key] ? <div className="mt-1 truncate text-[10px] text-emerald-500">{resourceIconFiles[key]?.name}</div> : null}
                          </div>
                        ))}
                      </div>

                      <button onClick={saveResourceIcons} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">
                        <Save size={14} />
                        Загрузить иконки
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        </Dialog.Panel>
        </motion.div>
      </div>
    </Dialog>
  );
}
