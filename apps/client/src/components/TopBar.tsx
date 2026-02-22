import { BookOpen, FlaskConical, Landmark, Coins, CircleDollarSign, ListChecks, LogOut, ShieldAlert, SkipForward, SlidersHorizontal, Cog, Flag } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
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
};

const cards = [
  { key: "culture", label: "Культура", icon: BookOpen, tip: "Очки культуры для развития традиций" },
  { key: "science", label: "Наука", icon: FlaskConical, tip: "Очки науки ускоряют исследования" },
  { key: "religion", label: "Религия", icon: Landmark, tip: "Религия влияет на стабильность и миссии" },
  { key: "colonization", label: "Колонизация", icon: Flag, tip: "Очки колонизации за ход" },
  { key: "ducats", label: "Дукаты", icon: Coins, tip: "Планировочный бюджет текущего хода" },
  { key: "gold", label: "Золото", icon: CircleDollarSign, tip: "Госказна для больших проектов" },
] as const;

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
}: Props) {
  return (
    <header className="glass panel-border pointer-events-auto absolute left-4 right-4 top-3 z-40 rounded-xl px-4 py-3">
      <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
        <button
          type="button"
          onClick={onOpenCountryCustomization}
          className="flex items-center gap-3 rounded-lg px-1 py-1 text-left transition hover:bg-white/5"
          title="Изменить страну"
        >
          <img src={flagUrl || "/placeholder-flag.svg"} alt="flag" className="h-8 w-12 rounded object-cover" />
          <img src={crestUrl || "/placeholder-crest.svg"} alt="crest" className="h-8 w-8 rounded-full object-cover" />
          <div className="font-display text-xl tracking-wide">{countryName}</div>
        </button>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {cards.map((card) => {
            const Icon = card.icon;
            const customIconUrl = resourceIconUrls?.[card.key] ?? null;
            const growth = Math.max(0, Math.floor(resourceGrowthByTurn?.[card.key] ?? 0));
            const expense = Math.max(0, Math.floor(resourceExpenseByTurn?.[card.key] ?? 0));
            const net = growth - expense;
            return (
              <Tooltip key={card.key} content={card.tip} placement="top">
                <div className="panel-border flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-xs">
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
                      {resources[card.key]}
                    </motion.strong>
                  </AnimatePresence>
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={`${card.key}-deltas-${growth}-${expense}`}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.16, ease: "easeOut" }}
                      className="inline-flex items-center gap-1"
                    >
                      <span className="text-emerald-300/90">+{growth}</span>
                      <span className="text-white/25">•</span>
                      <span className="text-rose-300/90">-{expense}</span>
                      <span className="text-white/25">•</span>
                      <span className={net >= 0 ? "text-cyan-300/90" : "text-rose-300/90"}>{net >= 0 ? `+${net}` : net}</span>
                    </motion.span>
                  </AnimatePresence>
                </div>
              </Tooltip>
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
