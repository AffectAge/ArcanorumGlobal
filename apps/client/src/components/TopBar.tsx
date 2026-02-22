import { BookOpen, FlaskConical, Landmark, Coins, CircleDollarSign, ListChecks, LogOut, ShieldAlert, SkipForward, SlidersHorizontal, Cog, Flag } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Tooltip } from "./Tooltip";

type Resources = {
  culture: number;
  science: number;
  religion: number;
  colonization: number;
  ducats: number;
  gold: number;
};

type Props = {
  countryName: string;
  flagUrl?: string | null;
  crestUrl?: string | null;
  turnId: number;
  resources: Resources;
  onOpenTurnStatus: () => void;
  onNextTurn: () => void;
  onLogout: () => void;
  isAdmin?: boolean;
  onAdminForceResolve?: () => void;
  onOpenAdminPanel?: () => void;
  onOpenGameSettings?: () => void;
  onOpenCountryCustomization?: () => void;
  resourceIconUrls?: Partial<Record<(typeof cards)[number]["key"], string | null>>;
  resourceGrowthByTurn?: Partial<Record<(typeof cards)[number]["key"], number>>;
  resourceExpenseByTurn?: Partial<Record<(typeof cards)[number]["key"], number>>;
  colonizationLimit?: { active: number; max: number } | null;
  countryDetails?: { provinceCount: number; totalAreaKm2: number } | null;
};

const cards = [
  { key: "culture", label: "Культура", icon: BookOpen, tip: "Очки культуры для развития традиций" },
  { key: "science", label: "Наука", icon: FlaskConical, tip: "Очки науки ускоряют исследования" },
  { key: "religion", label: "Религия", icon: Landmark, tip: "Религия влияет на стабильность и миссии" },
  { key: "colonization", label: "Колонизация", icon: Flag, tip: "Очки колонизации за ход" },
  { key: "ducats", label: "Дукаты", icon: Coins, tip: "Планировочный бюджет текущего хода" },
  { key: "gold", label: "Золото", icon: CircleDollarSign, tip: "Госказна для больших проектов" },
] as const;

function formatCompact(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const units = [
    { n: 1_000_000_000_000, s: "T" },
    { n: 1_000_000_000, s: "B" },
    { n: 1_000_000, s: "M" },
    { n: 1_000, s: "K" },
  ] as const;

  for (const unit of units) {
    if (abs >= unit.n) {
      const scaled = abs / unit.n;
      const text =
        scaled >= 100 ? Math.floor(scaled).toString() : scaled >= 10 ? scaled.toFixed(1).replace(/\.0$/, "") : scaled.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
      return `${sign}${text}${unit.s}`;
    }
  }

  return `${sign}${Math.floor(abs)}`;
}

function formatAreaKm2(value: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(Math.max(0, Math.round(value)))} км²`;
}

export function TopBar({
  countryName,
  flagUrl,
  crestUrl,
  turnId,
  resources,
  onOpenTurnStatus,
  onNextTurn,
  onLogout,
  isAdmin = false,
  onAdminForceResolve,
  onOpenAdminPanel,
  onOpenGameSettings,
  onOpenCountryCustomization,
  resourceIconUrls,
  resourceGrowthByTurn,
  resourceExpenseByTurn,
  colonizationLimit,
  countryDetails,
}: Props) {
  const hoverOpenTimerRef = useRef<number | null>(null);
  const countryHoverTimerRef = useRef<number | null>(null);
  const [hoveredResource, setHoveredResource] = useState<(typeof cards)[number]["key"] | null>(null);
  const [countryHovered, setCountryHovered] = useState(false);

  useEffect(() => {
    return () => {
      if (hoverOpenTimerRef.current !== null) {
        window.clearTimeout(hoverOpenTimerRef.current);
      }
      if (countryHoverTimerRef.current !== null) {
        window.clearTimeout(countryHoverTimerRef.current);
      }
    };
  }, []);

  const clearHoverTimer = () => {
    if (hoverOpenTimerRef.current !== null) {
      window.clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
  };

  const scheduleHoverOpen = (key: (typeof cards)[number]["key"]) => {
    clearHoverTimer();
    hoverOpenTimerRef.current = window.setTimeout(() => {
      setHoveredResource(key);
      hoverOpenTimerRef.current = null;
    }, 120);
  };

  const closeHover = (key: (typeof cards)[number]["key"]) => {
    clearHoverTimer();
    setHoveredResource((prev) => (prev === key ? null : prev));
  };

  const scheduleCountryHoverOpen = () => {
    if (countryHoverTimerRef.current !== null) {
      window.clearTimeout(countryHoverTimerRef.current);
    }
    countryHoverTimerRef.current = window.setTimeout(() => {
      setCountryHovered(true);
      countryHoverTimerRef.current = null;
    }, 120);
  };

  const closeCountryHover = () => {
    if (countryHoverTimerRef.current !== null) {
      window.clearTimeout(countryHoverTimerRef.current);
      countryHoverTimerRef.current = null;
    }
    setCountryHovered(false);
  };

  return (
    <header className="glass panel-border pointer-events-auto absolute left-4 right-4 top-3 z-[95] rounded-xl px-4 py-3">
      <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
        <div className="relative z-30 w-fit" onMouseEnter={scheduleCountryHoverOpen} onMouseLeave={closeCountryHover}>
          <button
            type="button"
            onClick={onOpenCountryCustomization}
            className="flex items-center gap-3 rounded-lg px-1 py-1 text-left transition hover:bg-white/5"
            aria-expanded={countryHovered}
            aria-label="Открыть детали страны"
          >
            <img src={flagUrl || "/placeholder-flag.svg"} alt="flag" className="h-8 w-12 rounded object-cover" />
            <img src={crestUrl || "/placeholder-crest.svg"} alt="crest" className="h-8 w-8 rounded-full object-cover" />
            <div className="font-display text-xl tracking-wide">{countryName}</div>
          </button>
          <AnimatePresence>
            {countryHovered && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 6, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="absolute left-0 top-full z-50 mt-1 min-w-[240px] rounded-xl"
              >
                <div className="glass panel-border rounded-xl bg-[#0b111b]/90 p-3 text-xs shadow-2xl backdrop-blur-xl">
                  <div className="mb-2 flex items-center gap-2 text-white/90">
                    <img src={flagUrl || "/placeholder-flag.svg"} alt="" className="h-4 w-6 rounded object-cover" />
                    <span className="font-semibold">{countryName}</span>
                  </div>
                  <div className="mb-2 text-[11px] text-white/55">Детали страны и её владений</div>
                  <div className="space-y-1 text-white/75">
                    <div className="flex items-center justify-between gap-3">
                      <span>Провинций под контролем</span>
                      <span className="text-white">{countryDetails?.provinceCount ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Общая площадь</span>
                      <span className="text-white">{formatAreaKm2(countryDetails?.totalAreaKm2 ?? 0)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 border-t border-white/10 pt-1">
                      <span>Текущий ход</span>
                      <span className="text-arc-accent">#{turnId}</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {cards.map((card) => {
            const Icon = card.icon;
            const customIconUrl = resourceIconUrls?.[card.key] ?? null;
            const growth = Math.max(0, Math.floor(resourceGrowthByTurn?.[card.key] ?? 0));
            const expense = Math.max(0, Math.floor(resourceExpenseByTurn?.[card.key] ?? 0));
            const net = growth - expense;
            const netColorClass =
              net > 0 ? "text-emerald-300/90" : net < 0 ? "text-rose-300/90" : "text-white/85";
            const netDetailColorClass = net > 0 ? "text-emerald-300" : net < 0 ? "text-rose-300" : "text-white";
            return (
              <div
                key={card.key}
                className="relative"
                onMouseEnter={() => scheduleHoverOpen(card.key)}
                onMouseLeave={() => closeHover(card.key)}
              >
                  <button
                    type="button"
                    className="panel-border flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-xs transition hover:bg-white/10"
                    aria-expanded={hoveredResource === card.key}
                    aria-label={`${card.label}: открыть детали`}
                  >
                    {customIconUrl ? (
                      <img src={customIconUrl} alt="" className="h-[18px] w-[18px] rounded-sm object-contain" />
                    ) : (
                      <Icon size={17} className="text-arc-accent" />
                    )}
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.strong
                        key={`${card.key}-value-${resources[card.key]}`}
                        initial={{ opacity: 0, y: 4, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.97 }}
                        transition={{ duration: 0.16, ease: "easeOut" }}
                      >
                        {formatCompact(resources[card.key])}
                      </motion.strong>
                    </AnimatePresence>
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.span
                        key={`${card.key}-deltas-${growth}-${expense}`}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.16, ease: "easeOut" }}
                        className="inline-flex items-center"
                      >
                        <span className={netColorClass}>
                          {net >= 0 ? `+${formatCompact(net)}` : formatCompact(net)}
                        </span>
                      </motion.span>
                    </AnimatePresence>
                  </button>
                  <AnimatePresence>
                    {hoveredResource === card.key && (
                      <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 6, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.98 }}
                        transition={{ duration: 0.16, ease: "easeOut" }}
                        className="absolute left-0 top-full z-20 mt-1 min-w-[220px] rounded-xl"
                      >
                        <div className="glass panel-border rounded-xl bg-[#0b111b]/90 p-3 text-xs shadow-2xl backdrop-blur-xl">
                          <div className="mb-2 flex items-center gap-2 text-white/90">
                            {customIconUrl ? (
                              <img src={customIconUrl} alt="" className="h-4 w-4 rounded-sm object-contain" />
                            ) : (
                              <Icon size={14} className="text-arc-accent" />
                            )}
                            <span className="font-semibold">{card.label}</span>
                          </div>
                          <div className="mb-2 text-[11px] text-white/55">{card.tip}</div>
                          <div className="space-y-1 text-white/75">
                            <div className="flex items-center justify-between gap-3">
                              <span>Текущее значение</span>
                              <span className="text-white">{formatCompact(resources[card.key])}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span>Прирост за ход</span>
                              <span className="text-emerald-300">+{formatCompact(growth)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span>Расход за ход</span>
                              <span className="text-rose-300">-{formatCompact(expense)}</span>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-3 border-t border-white/10 pt-1">
                              <span>Итог за ход</span>
                              <span className={netDetailColorClass}>
                                {net >= 0 ? `+${formatCompact(net)}` : formatCompact(net)}
                              </span>
                            </div>
                            {card.key === "colonization" && colonizationLimit && (
                              <div className="mt-1 flex items-center justify-between gap-3 border-t border-white/10 pt-1">
                                <span>Лимит колонизаций</span>
                                <span
                                  className={
                                    colonizationLimit.active >= colonizationLimit.max
                                      ? "text-rose-300"
                                      : colonizationLimit.active > 0
                                        ? "text-amber-300"
                                        : "text-emerald-300"
                                  }
                                >
                                  {colonizationLimit.active} / {colonizationLimit.max}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-2">
          {isAdmin && (
            <Tooltip content="Панель администратора" placement="top">
              <button
                onClick={onOpenAdminPanel}
                className="panel-border inline-flex h-10 w-10 items-center justify-center rounded-lg bg-rose-500/20 text-rose-300 transition hover:bg-rose-500/30"
                aria-label="Панель администратора"
              >
                <SlidersHorizontal size={16} />
              </button>
            </Tooltip>
          )}

          {isAdmin && (
            <Tooltip content="Настройки игры" placement="top">
              <button
                onClick={onOpenGameSettings}
                className="panel-border inline-flex h-10 w-10 items-center justify-center rounded-lg bg-rose-500/20 text-rose-300 transition hover:bg-rose-500/30"
                aria-label="Настройки игры"
              >
                <Cog size={16} />
              </button>
            </Tooltip>
          )}

          {isAdmin && (
            <Tooltip content="Админ: форс-резолв" placement="top">
              <button
                onClick={onAdminForceResolve}
                className="panel-border inline-flex h-10 w-10 items-center justify-center rounded-lg bg-rose-500/20 text-rose-300 transition hover:bg-rose-500/30"
                aria-label="Админ: форс-резолв"
              >
                <ShieldAlert size={16} />
              </button>
            </Tooltip>
          )}

          <Tooltip content="Выход" placement="top">
            <button
              onClick={onLogout}
              className="panel-border inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-slate-100 transition hover:text-arc-accent"
              aria-label="Выход"
            >
              <LogOut size={16} />
            </button>
          </Tooltip>

          <Tooltip content="Статусы стран" placement="top">
            <button
              onClick={onOpenTurnStatus}
              className="panel-border inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-slate-100 transition hover:text-arc-accent"
              aria-label="Статусы стран"
            >
              <ListChecks size={16} />
            </button>
          </Tooltip>

          <Tooltip content={`Следующий ход #${turnId}`} placement="top">
            <button
              onClick={onNextTurn}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-arc-accent text-black transition hover:brightness-110"
              aria-label={`Следующий ход #${turnId}`}
            >
              <SkipForward size={16} />
            </button>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}
