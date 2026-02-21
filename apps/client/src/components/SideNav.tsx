import { motion } from "framer-motion";
import { Landmark, Wallet, HandCoins, Hammer, Users, Handshake, Shield, FlaskConical, Eye } from "lucide-react";
import { Tooltip } from "./Tooltip";

const navItems = [
  { key: "politics", label: "Политика", icon: Landmark },
  { key: "budget", label: "Бюджет", icon: Wallet },
  { key: "trade", label: "Торговля", icon: HandCoins },
  { key: "buildings", label: "Постройки", icon: Hammer },
  { key: "population", label: "Население", icon: Users },
  { key: "diplomacy", label: "Дипломатия", icon: Handshake },
  { key: "army", label: "Армия", icon: Shield },
  { key: "technology", label: "Технологии", icon: FlaskConical },
  { key: "intel", label: "Спецслужбы", icon: Eye },
];

export function SideNav() {
  return (
    <aside className="pointer-events-auto absolute left-4 top-24 z-40 flex flex-col gap-2">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <Tooltip key={item.key} content={item.label}>
            <motion.button
              whileHover={{ x: 8, scale: 1.03 }}
              className="group glass panel-border relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl text-slate-100 transition hover:shadow-neon"
            >
              <Icon size={20} />
              <span className="pointer-events-none absolute left-14 whitespace-nowrap rounded-md bg-arc-panel/95 px-3 py-1 text-xs text-arc-accent opacity-0 transition group-hover:opacity-100">
                {item.label}
              </span>
            </motion.button>
          </Tooltip>
        );
      })}
    </aside>
  );
}


