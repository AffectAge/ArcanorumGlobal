import { AnimatePresence, motion } from "framer-motion";
import { Bell, Landmark, ScrollText, ShieldAlert } from "lucide-react";

export type InAppUiNotification = {
  id: string;
  category: "registration" | "system" | "politics" | "economy";
  createdAt: string;
  title?: string | null;
  message?: string | null;
  action:
    | {
        type: "registration-approval";
        country: {
          id: string;
          name: string;
          color: string;
          flagUrl?: string | null;
          crestUrl?: string | null;
        };
      }
    | {
        type: "message";
      };
};

type Props = {
  items: InAppUiNotification[];
  viewedIds?: ReadonlySet<string>;
  topOffsetPx?: number;
  onClickItem: (item: InAppUiNotification) => void;
};

function iconForCategory(category: InAppUiNotification["category"]) {
  switch (category) {
    case "registration":
      return ShieldAlert;
    case "politics":
      return ScrollText;
    case "economy":
      return Landmark;
    default:
      return Bell;
  }
}

function colorForCategory(category: InAppUiNotification["category"]) {
  switch (category) {
    case "registration":
      return "text-rose-300 border-rose-900/80";
    case "politics":
      return "text-sky-300 border-sky-400/70";
    case "economy":
      return "text-emerald-500 border-emerald-400/70";
    default:
      return "text-slate-200 border-slate-400/70";
  }
}

function glowColorForCategory(category: InAppUiNotification["category"]) {
  switch (category) {
    case "registration":
      return "rgba(127, 29, 29, 0.55)";
    case "politics":
      return "rgba(56, 189, 248, 0.55)";
    case "economy":
      return "rgba(52, 211, 153, 0.55)";
    default:
      return "rgba(148, 163, 184, 0.4)";
  }
}

function tooltipText(item: InAppUiNotification): string {
  if (item.action.type === "registration-approval") {
    return `Заявка на регистрацию: ${item.action.country.name}`;
  }
  if (item.title && item.message) {
    return `${item.title}: ${item.message}`;
  }
  return item.title ?? item.message ?? "Уведомление";
}

function categoryLabel(category: InAppUiNotification["category"]): string {
  switch (category) {
    case "registration":
      return "Регистрация";
    case "politics":
      return "Политика";
    case "economy":
      return "Экономика";
    default:
      return "Система";
  }
}

export function InAppNotificationTray({ items, viewedIds, topOffsetPx = 72, onClickItem }: Props) {
  return (
    <div className="pointer-events-none absolute left-4 z-[110]" style={{ top: topOffsetPx }}>
      <div className="flex max-w-[min(70vw,560px)] flex-row-reverse items-start justify-start gap-2">
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const Icon = iconForCategory(item.category);
            const colorClass = colorForCategory(item.category);
            const isUnread = !viewedIds?.has(item.id);
            const glowColor = glowColorForCategory(item.category);
            const label = categoryLabel(item.category);
            const hoverText = tooltipText(item);
            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 18, x: 14, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, x: -14, scale: 0.9 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-auto"
              >
                <button
                  type="button"
                  onClick={() => onClickItem(item)}
                  className={`group relative inline-flex h-10 w-10 items-start justify-start overflow-hidden rounded-xl border bg-[#131a22] px-3 py-[11px] shadow-xl shadow-black/35 transition-[width,height,transform] duration-200 hover:h-[56px] hover:w-[240px] hover:scale-[1.03] ${colorClass}`}
                  style={
                    isUnread
                      ? {
                          boxShadow: `0 0 0 1px ${glowColor} inset, 0 0 16px ${glowColor}, 0 10px 24px rgba(0,0,0,0.35)`,
                        }
                      : undefined
                  }
                  aria-label={tooltipText(item)}
                >
                  {isUnread && (
                    <span
                      className="pointer-events-none absolute -inset-1 rounded-2xl blur-md"
                      style={{ background: glowColor, opacity: 0.38 }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="pointer-events-none absolute inset-x-1 bottom-0 h-px bg-gradient-to-r from-transparent via-arc-accent/70 to-transparent opacity-0 transition group-hover:opacity-100" />
                  <Icon
                    size={17}
                    className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 transition-all duration-200 group-hover:left-3 group-hover:top-[14px] group-hover:translate-x-0 group-hover:translate-y-0"
                  />
                  <span className="relative z-10 ml-6 min-w-0">
                    <span className="block max-w-0 overflow-hidden whitespace-nowrap text-xs font-medium opacity-0 transition-all duration-200 group-hover:max-w-[180px] group-hover:opacity-100">
                      {label}
                    </span>
                    <span className="block max-h-0 max-w-[180px] overflow-hidden text-[10px] leading-3 text-white/70 opacity-0 transition-all duration-200 group-hover:mt-0.5 group-hover:max-h-8 group-hover:opacity-100">
                      {hoverText}
                    </span>
                  </span>
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
