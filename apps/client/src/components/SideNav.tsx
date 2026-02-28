import { motion } from "framer-motion";
import { Landmark, Wallet, HandCoins, Hammer, Users, Handshake, Shield, Eye } from "lucide-react";

const navItems = [
  { key: "politics", label: "Политика", icon: Landmark },
  { key: "budget", label: "Бюджет", icon: Wallet },
  { key: "trade", label: "Торговля", icon: HandCoins },
  { key: "buildings", label: "Постройки", icon: Hammer },
  { key: "population", label: "Население", icon: Users },
  { key: "diplomacy", label: "Дипломатия", icon: Handshake },
  { key: "army", label: "Армия", icon: Shield },
  { key: "intel", label: "Спецслужбы", icon: Eye },
];

type Props = {
  onSelect?: (key: (typeof navItems)[number]["key"]) => void;
};

export function SideNav({ onSelect }: Props) {
  return (
    <aside className="pointer-events-auto absolute left-4 top-36 z-40 hidden flex-col gap-2 xl:flex">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <motion.button
            key={item.key}
            type="button"
            onClick={() => onSelect?.(item.key)}
            whileHover={{ x: 6, scale: 1.02 }}
            transition={{ type: "tween", duration: 0.12 }}
            className="group glass panel-border relative flex h-10 w-10 items-center justify-start overflow-hidden rounded-xl px-3 text-slate-100 transition-[width,color] duration-150 hover:w-[164px] hover:text-arc-accent hover:shadow-neon"
          >
            <Icon
              size={17}
              className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 transition-all duration-150 group-hover:left-3 group-hover:translate-x-0"
            />
            <span className="relative z-10 ml-6 max-w-0 overflow-hidden whitespace-nowrap text-xs font-medium text-arc-accent opacity-0 transition-all duration-150 group-hover:max-w-[118px] group-hover:opacity-100">
              {item.label}
            </span>
          </motion.button>
        );
      })}
    </aside>
  );
}
