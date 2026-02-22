import { motion } from "framer-motion";
import { Landmark, Wallet, HandCoins, Hammer, Users, Handshake, Shield, FlaskConical, Eye } from "lucide-react";

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
    <aside className="pointer-events-auto absolute left-4 top-24 z-40 hidden flex-col gap-2 xl:flex">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <motion.button
            key={item.key}
            whileHover={{ x: 6, scale: 1.02 }}
            transition={{ type: "tween", duration: 0.12 }}
            className="group glass panel-border relative flex h-12 w-12 items-center justify-center overflow-visible rounded-xl text-slate-100 transition-colors duration-100 hover:text-arc-accent hover:shadow-neon"
          >
            <span className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-transparent via-arc-accent/70 to-transparent opacity-0 blur-[2px] transition-opacity duration-100 group-hover:opacity-100" />
            <Icon size={20} className="relative z-10" />
            <span className="pointer-events-none absolute left-14 top-1/2 -translate-y-1/2 translate-x-[-4px] whitespace-nowrap rounded-md bg-arc-panel/95 px-3 py-1 text-xs text-arc-accent opacity-0 transition-all duration-100 ease-out group-hover:translate-x-0 group-hover:opacity-100">
              {item.label}
            </span>
          </motion.button>
        );
      })}
    </aside>
  );
}

