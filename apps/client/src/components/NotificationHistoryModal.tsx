import { Dialog } from "@headlessui/react";
import { motion } from "framer-motion";
import { Bell, Landmark, ScrollText, ShieldAlert, X } from "lucide-react";
import type { InAppUiNotification } from "./InAppNotificationTray";

type Props = {
  open: boolean;
  items: InAppUiNotification[];
  viewedIds?: ReadonlySet<string>;
  onClose: () => void;
  onOpenItem?: (item: InAppUiNotification) => void;
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

function categoryLabel(category: InAppUiNotification["category"]) {
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

function itemText(item: InAppUiNotification): string {
  if (item.action.type === "registration-approval") {
    return `Заявка на регистрацию: ${item.action.country.name}`;
  }
  if (item.title && item.message) return `${item.title}: ${item.message}`;
  return item.title ?? item.message ?? "Уведомление";
}

function categoryColor(category: InAppUiNotification["category"]): string {
  switch (category) {
    case "registration":
      return "text-rose-300 border-rose-400/20 bg-rose-500/10";
    case "politics":
      return "text-sky-300 border-sky-400/20 bg-sky-500/10";
    case "economy":
      return "text-emerald-300 border-emerald-400/20 bg-emerald-500/10";
    default:
      return "text-slate-200 border-slate-400/20 bg-slate-500/10";
  }
}

function categoryTextColor(category: InAppUiNotification["category"]): string {
  switch (category) {
    case "registration":
      return "text-rose-300";
    case "politics":
      return "text-sky-300";
    case "economy":
      return "text-emerald-300";
    default:
      return "text-slate-200";
  }
}

export function NotificationHistoryModal({ open, items, viewedIds, onClose, onOpenItem }: Props) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-[132]">
      <motion.div
        aria-hidden="true"
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
      />
      <div className="fixed inset-0 flex items-start justify-center p-4 pt-24">
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.99 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="w-full max-w-3xl"
        >
          <Dialog.Panel className="glass panel-border w-full rounded-xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <Dialog.Title className="text-sm font-semibold text-slate-100">История уведомлений</Dialog.Title>
                <p className="mt-1 text-xs text-slate-400">Всего: {items.length}</p>
              </div>
              <button
                onClick={onClose}
                className="panel-border inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/5 text-slate-200 transition hover:text-arc-accent"
                aria-label="Закрыть"
                type="button"
              >
                <X size={14} />
              </button>
            </div>

            <div className="arc-scrollbar max-h-[60vh] space-y-2 overflow-auto pr-1">
              {items.length === 0 && <div className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm text-slate-400">История уведомлений пока пуста</div>}
              {items.map((item) => {
                const Icon = iconForCategory(item.category);
                const isViewed = viewedIds?.has(item.id) ?? false;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpenItem?.(item)}
                    className="panel-border block w-full rounded-lg bg-black/25 p-3 text-left transition hover:border-white/15 hover:bg-black/35"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex flex-1 items-center gap-3">
                        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${categoryColor(item.category)}`}>
                        <Icon size={16} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`text-xs font-medium ${categoryTextColor(item.category)}`}>{categoryLabel(item.category)}</span>
                                <span className={`rounded border px-1.5 py-0.5 text-[10px] ${isViewed ? "border-slate-400/20 bg-slate-500/10 text-slate-300" : "border-amber-400/20 bg-amber-500/10 text-amber-300"}`}>
                                  {isViewed ? "Просмотрено" : "Новое"}
                                </span>
                              </div>
                              <div className="mt-1 break-words text-sm text-slate-200">{itemText(item)}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                                <span>{new Date(item.createdAt).toLocaleString()}</span>
                                <span>Ход получения: #{item.receivedTurnId ?? "?"}</span>
                              </div>
                            </div>
                            {item.action.type === "registration-approval" && (
                              <span className="shrink-0 rounded border border-rose-400/20 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300">Требует решения</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Dialog.Panel>
        </motion.div>
      </div>
    </Dialog>
  );
}
