import { motion } from "framer-motion";
import { Building2, Flag, HandCoins, Handshake, Hammer, Landmark, Users } from "lucide-react";

const modes = [
  { key: "Политическая карта", icon: Landmark },
  { key: "Торговля", icon: HandCoins },
  { key: "Инфраструктура", icon: Building2 },
  { key: "Население", icon: Users },
  { key: "Постройки", icon: Hammer },
  { key: "Дипломатия", icon: Handshake },
  { key: "Колонизация", icon: Flag },
] as const;

type Props = {
  activeMode: string;
  onModeChange: (mode: string) => void;
};

export function MapModePanel({ activeMode, onModeChange }: Props) {
  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-40 -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-2xl bg-transparent p-0.5">
        {modes.map((mode) => {
          const Icon = mode.icon;
          const isActive = activeMode === mode.key;

          return (
            <motion.button
              key={mode.key}
              whileHover={{ y: -2, scale: 1.03 }}
              transition={{ type: "tween", duration: 0.12 }}
              onClick={() => onModeChange(mode.key)}
              className={`group glass panel-border relative flex h-11 w-11 items-center justify-start overflow-hidden rounded-xl bg-[#0b111b]/86 px-3 text-slate-100 transition-[width,color] duration-150 hover:w-[170px] hover:text-arc-accent ${isActive ? "text-emerald-500 shadow-neon" : ""}`}
              aria-label={mode.key}
            >
              <Icon size={18} className="relative z-10 shrink-0" />
              <span className="relative z-10 ml-2 max-w-0 overflow-hidden whitespace-nowrap text-xs font-medium opacity-0 transition-all duration-150 group-hover:max-w-[120px] group-hover:opacity-100">
                {mode.key}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

