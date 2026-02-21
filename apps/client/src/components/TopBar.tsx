import { BookOpen, FlaskConical, Landmark, Coins, CircleDollarSign, LogOut, Shield } from "lucide-react";
import { Tooltip } from "./Tooltip";

type Resources = {
  culture: number;
  science: number;
  religion: number;
  ducats: number;
  gold: number;
};

type Props = {
  countryName: string;
  flagUrl?: string | null;
  crestUrl?: string | null;
  turnId: number;
  resources: Resources;
  onNextTurn: () => void;
  onLogout: () => void;
  isAdmin?: boolean;
  onAdminForceResolve?: () => void;
};

const cards = [
  { key: "culture", label: "Культура", icon: BookOpen, tip: "Очки культуры для развития традиций" },
  { key: "science", label: "Наука", icon: FlaskConical, tip: "Очки науки ускоряют исследования" },
  { key: "religion", label: "Религия", icon: Landmark, tip: "Религия влияет на стабильность и миссии" },
  { key: "ducats", label: "Дукаты", icon: Coins, tip: "Планировочный бюджет текущего хода" },
  { key: "gold", label: "Золото", icon: CircleDollarSign, tip: "Госказна для больших проектов" },
] as const;

export function TopBar({ countryName, flagUrl, crestUrl, turnId, resources, onNextTurn, onLogout, isAdmin = false, onAdminForceResolve }: Props) {
  return (
    <header className="glass panel-border pointer-events-auto absolute left-4 right-4 top-3 z-40 rounded-xl px-4 py-3">
      <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
        <div className="flex items-center gap-3">
          <img src={flagUrl || "/placeholder-flag.svg"} alt="flag" className="h-8 w-12 rounded object-cover" />
          <img src={crestUrl || "/placeholder-crest.svg"} alt="crest" className="h-8 w-8 rounded-full object-cover" />
          <div className="font-display text-xl tracking-wide">{countryName}</div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Tooltip key={card.key} content={card.tip}>
                <div className="panel-border flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-xs">
                  <Icon size={14} className="text-arc-accent" />
                  <span className="text-slate-300">{card.label}:</span>
                  <strong>{resources[card.key]}</strong>
                </div>
              </Tooltip>
            );
          })}
        </div>

        <div className="flex justify-end gap-2">
          {isAdmin && (
            <button
              onClick={onAdminForceResolve}
              className="panel-border inline-flex items-center gap-2 rounded-lg bg-arc-accent/20 px-3 py-2 text-sm text-arc-accent transition hover:brightness-110"
            >
              <Shield size={15} />
              Админ: Форс-резолв
            </button>
          )}
          <button onClick={onLogout} className="panel-border inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-slate-100 transition hover:text-arc-accent">
            <LogOut size={15} />
            Выход
          </button>
          <button onClick={onNextTurn} className="rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110">
            Следующий ход #{turnId}
          </button>
        </div>
      </div>
    </header>
  );
}


