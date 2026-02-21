import { motion } from "framer-motion";
import { Building2, HandCoins, Handshake, Hammer, Landmark, Users } from "lucide-react";
import { Tooltip } from "./Tooltip";

const modes = [
  { key: "Политическая карта", icon: Landmark },
  { key: "Торговля", icon: HandCoins },
  { key: "Инфраструктура", icon: Building2 },
  { key: "Население", icon: Users },
  { key: "Постройки", icon: Hammer },
  { key: "Дипломатия", icon: Handshake },
] as const;

type Props = {
  activeMode: string;
  onModeChange: (mode: string) => void;
};

export function MapModePanel({ activeMode, onModeChange }: Props) {
  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-40 -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-2xl bg-transparent p-1">
        {modes.map((mode) => {
          const Icon = mode.icon;
          const isActive = activeMode === mode.key;

          return (
            <Tooltip key={mode.key} content={mode.key} placement="top">
              <motion.button
                whileHover={{ y: -2, scale: 1.03 }}
                transition={{ type: "tween", duration: 0.12 }}
                onClick={() => onModeChange(mode.key)}
                className={`group glass panel-border relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl text-slate-100 transition-colors duration-100 hover:text-arc-accent ${isActive ? "text-arc-accent shadow-neon" : ""}`}
                aria-label={mode.key}
              >
                <span className={`pointer-events-none absolute left-1/2 top-1/2 h-3 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-transparent via-arc-accent/70 to-transparent blur-[2px] transition-opacity duration-100 ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`} />
                <Icon size={18} className="relative z-10" />
              </motion.button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

