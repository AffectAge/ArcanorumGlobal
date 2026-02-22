import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EventCategory, EventCountryScope, EventLogEntry } from "@arcanorum/shared";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Coins,
  Flag,
  Gavel,
  Megaphone,
  Shield,
  Trash2,
  User,
  Users,
  Filter,
  ArrowUpDown,
  Scissors,
  Globe2,
  Lock,
  type LucideIcon,
} from "lucide-react";
import { Tooltip } from "./Tooltip";
import { fetchCountries } from "../lib/api";

type Props = {
  entries: EventLogEntry[];
  currentCountryId?: string | null;
  onTrimOld: () => void;
  onClear: () => void;
};

const categories: Array<{ id: EventCategory; label: string; icon: LucideIcon; colorCls: string }> = [
  { id: "system", label: "Система", icon: Megaphone, colorCls: "text-cyan-300" },
  { id: "colonization", label: "Колонизация", icon: Flag, colorCls: "text-emerald-300" },
  { id: "politics", label: "Политика", icon: Gavel, colorCls: "text-amber-300" },
  { id: "economy", label: "Экономика", icon: Coins, colorCls: "text-yellow-300" },
  { id: "military", label: "Война", icon: Shield, colorCls: "text-rose-300" },
  { id: "diplomacy", label: "Дипломатия", icon: Globe2, colorCls: "text-violet-300" },
];

const priorityWeight = { low: 0, medium: 1, high: 2 } as const;
const allCategoryIds = categories.map((c) => c.id);

function dedupeEntries(entries: EventLogEntry[]): Array<{ entry: EventLogEntry; count: number }> {
  const grouped = new Map<string, { entry: EventLogEntry; count: number }>();
  for (const entry of entries) {
    const key = [entry.turn, entry.category, entry.priority, entry.visibility, entry.countryId ?? "", entry.title ?? "", entry.message].join("|");
    const found = grouped.get(key);
    if (found) {
      found.count += 1;
      continue;
    }
    grouped.set(key, { entry, count: 1 });
  }
  return [...grouped.values()];
}

function IconBtn({
  icon: Icon,
  onClick,
  tooltip,
  tone = "default",
}: {
  icon: LucideIcon;
  onClick: () => void;
  tooltip: string;
  tone?: "default" | "danger";
}) {
  return (
    <Tooltip content={tooltip} placement="top">
      <motion.button
        type="button"
        onClick={onClick}
        whileHover={{ y: -2, scale: 1.03 }}
        transition={{ type: "tween", duration: 0.12 }}
        className={`group panel-border relative overflow-hidden rounded-md p-2 text-slate-300 transition ${
          tone === "danger" ? "bg-white/5 hover:text-rose-300" : "bg-white/5 hover:text-arc-accent"
        }`}
      >
        <span className="pointer-events-none absolute left-1/2 top-1/2 h-2.5 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-transparent via-arc-accent/70 to-transparent opacity-0 blur-[2px] transition-opacity duration-100 group-hover:opacity-100" />
        <Icon size={15} className="relative z-10" />
      </motion.button>
    </Tooltip>
  );
}

function ScopeIcon({ scope }: { scope: EventCountryScope }) {
  if (scope === "all") {
    return <Users size={14} />;
  }
  if (scope === "own") {
    return <User size={14} />;
  }
  return <Globe2 size={14} />;
}

export function EventLogPanel({ entries, currentCountryId, onTrimOld, onClear }: Props) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("arc.ui.eventLog.collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [sortMode, setSortMode] = useState<"time" | "priority">(() => {
    try {
      const raw = localStorage.getItem("arc.ui.eventLog.sortMode");
      return raw === "priority" ? "priority" : "time";
    } catch {
      return "time";
    }
  });
  const [countryScope, setCountryScope] = useState<EventCountryScope>(() => {
    try {
      const raw = localStorage.getItem("arc.ui.eventLog.countryScope");
      return raw === "own" || raw === "foreign" ? raw : "all";
    } catch {
      return "all";
    }
  });
  const [enabledCategories, setEnabledCategories] = useState<Set<EventCategory>>(() => {
    try {
      const raw = localStorage.getItem("arc.ui.eventLog.enabledCategories");
      if (!raw) return new Set(allCategoryIds);
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return new Set(allCategoryIds);
      const next = parsed.filter((v): v is EventCategory => allCategoryIds.includes(v as EventCategory));
      return new Set(next.length > 0 ? (["system", ...next.filter((v) => v !== "system")] as EventCategory[]) : allCategoryIds);
    } catch {
      return new Set(allCategoryIds);
    }
  });
  const [newEventsPulse, setNewEventsPulse] = useState(false);
  const [countriesById, setCountriesById] = useState<Record<string, { name: string; flagUrl?: string | null; color?: string }>>({});
  const prevEntriesCountRef = useRef(entries.length);
  const filteredAndGrouped = useMemo(() => {
    const filtered = entries.filter((entry) => {
      if (entry.visibility === "private" && entry.countryId && entry.countryId !== currentCountryId) {
        return false;
      }
      if (entry.category !== "system" && !enabledCategories.has(entry.category)) {
        return false;
      }
      if (countryScope === "own") {
        return entry.countryId === currentCountryId;
      }
      if (countryScope === "foreign") {
        return Boolean(entry.countryId && entry.countryId !== currentCountryId);
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (sortMode === "priority") {
        const byPriority = priorityWeight[b.priority] - priorityWeight[a.priority];
        if (byPriority !== 0) {
          return byPriority;
        }
      }
      return b.turn - a.turn || b.timestamp.localeCompare(a.timestamp);
    });

    return dedupeEntries(filtered);
  }, [countryScope, currentCountryId, enabledCategories, entries, sortMode]);

  const toggleCategory = (category: EventCategory) => {
    if (category === "system") {
      return;
    }
    setEnabledCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  useEffect(() => {
    if (entries.length > prevEntriesCountRef.current) {
      setNewEventsPulse(true);
      const t = window.setTimeout(() => setNewEventsPulse(false), 700);
      prevEntriesCountRef.current = entries.length;
      return () => window.clearTimeout(t);
    }
    prevEntriesCountRef.current = entries.length;
    return;
  }, [entries.length]);

  useEffect(() => {
    try {
      localStorage.setItem("arc.ui.eventLog.collapsed", collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [collapsed]);

  useEffect(() => {
    try {
      localStorage.setItem("arc.ui.eventLog.sortMode", sortMode);
    } catch {
      // ignore
    }
  }, [sortMode]);

  useEffect(() => {
    try {
      localStorage.setItem("arc.ui.eventLog.countryScope", countryScope);
    } catch {
      // ignore
    }
  }, [countryScope]);

  useEffect(() => {
    try {
      localStorage.setItem("arc.ui.eventLog.enabledCategories", JSON.stringify([...enabledCategories]));
    } catch {
      // ignore
    }
  }, [enabledCategories]);

  useEffect(() => {
    let cancelled = false;
    fetchCountries()
      .then((countries) => {
        if (cancelled) return;
        const map: Record<string, { name: string; flagUrl?: string | null; color?: string }> = {};
        for (const c of countries) {
          map[c.id] = { name: c.name, flagUrl: c.flagUrl, color: c.color };
        }
        setCountriesById(map);
      })
      .catch(() => {
        // keep graceful fallback to countryId text
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside className="pointer-events-auto absolute right-4 top-24 z-[72] w-[min(400px,calc(100vw-1.5rem))]">
      <AnimatePresence mode="wait" initial={false}>
        {collapsed ? (
          <motion.div
            key="collapsed"
            initial={{ opacity: 0, x: 12, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 10, scale: 0.96 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="flex justify-end"
          >
            <Tooltip content="Развернуть журнал событий" placement="left">
              <motion.button
                type="button"
                onClick={() => setCollapsed(false)}
                whileHover={{ y: -2, scale: 1.03 }}
                transition={{ type: "tween", duration: 0.12 }}
                className="group glass panel-border relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl text-slate-200 transition hover:text-arc-accent"
              >
                <span className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-transparent via-arc-accent/70 to-transparent opacity-0 blur-[2px] transition-opacity duration-100 group-hover:opacity-100" />
                <ChevronLeft size={20} className="relative z-10" />
              </motion.button>
            </Tooltip>
          </motion.div>
        ) : (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, x: 12, scale: 0.985 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 12, scale: 0.985 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="glass panel-border relative overflow-hidden rounded-2xl p-3.5"
          >
            <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent" />

            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Bell size={18} className="text-arc-accent" />
                <div className="text-base font-semibold text-slate-100">Журнал событий</div>
                <Tooltip content="Количество записей в журнале" placement="bottom">
                  <motion.span
                    animate={
                      newEventsPulse
                        ? { scale: [1, 1.09, 1], boxShadow: ["0 0 0 rgba(74,222,128,0)", "0 0 18px rgba(74,222,128,0.22)", "0 0 0 rgba(74,222,128,0)"] }
                        : { scale: 1, boxShadow: "0 0 0 rgba(0,0,0,0)" }
                    }
                    transition={{ duration: 0.55, ease: "easeOut" }}
                    className="rounded-md bg-white/5 px-2 py-0.5 text-xs text-slate-300"
                  >
                    {entries.length}
                  </motion.span>
                </Tooltip>
              </div>
              <div className="flex items-center gap-1">
                <IconBtn icon={Scissors} onClick={onTrimOld} tooltip="Скрыть старые" />
                <IconBtn
                  icon={ArrowUpDown}
                  onClick={() => setSortMode((s) => (s === "time" ? "priority" : "time"))}
                  tooltip={sortMode === "time" ? "Сортировка: по времени" : "Сортировка: по важности"}
                />
                <IconBtn icon={Trash2} onClick={onClear} tooltip="Очистить журнал" tone="danger" />
                <IconBtn icon={ChevronRight} onClick={() => setCollapsed(true)} tooltip="Свернуть журнал" />
              </div>
            </div>

            <div className="mb-3 rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.03] to-black/20 p-2.5">
              <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400">
                <Filter size={13} />
                Категории
              </div>
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => {
                  const Icon = cat.icon;
                  const enabled = cat.id === "system" || enabledCategories.has(cat.id);
                  const button = (
                    <motion.button
                      type="button"
                      onClick={() => toggleCategory(cat.id)}
                      whileHover={cat.id === "system" ? undefined : { y: -2, scale: 1.04 }}
                      transition={{ type: "tween", duration: 0.12 }}
                      className={`group panel-border relative inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg transition ${
                        enabled ? "bg-white/10 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]" : "bg-black/15 text-slate-500"
                      } ${cat.id === "system" ? "cursor-default opacity-95" : "hover:text-white"}`}
                    >
                      <span className={`pointer-events-none absolute left-1/2 top-1/2 h-2.5 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-transparent ${enabled ? "via-white/60" : "via-arc-accent/70"} to-transparent opacity-0 blur-[2px] transition-opacity duration-100 group-hover:opacity-100`} />
                      <Icon size={18} className={`relative z-10 ${enabled ? cat.colorCls : ""}`} />
                    </motion.button>
                  );

                  return (
                    <Tooltip key={cat.id} content={cat.id === "system" ? "Системные события всегда видимы" : cat.label} placement="top">
                      {button}
                    </Tooltip>
                  );
                })}
              </div>
            </div>

            <div className="mb-3 rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.03] to-black/20 p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs uppercase tracking-wide text-slate-400">Принадлежность</div>
                <div className="text-[10px] text-white/35">Фильтр по стране</div>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/10 bg-black/25 p-1">
                {([
                  { id: "all", label: "Все" },
                  { id: "own", label: "Наши" },
                  { id: "foreign", label: "Чужие" },
                ] as const).map((scope) => (
                  <Tooltip key={scope.id} content={`Показать: ${scope.label.toLowerCase()} события`} placement="top">
                    <motion.button
                      type="button"
                      onClick={() => setCountryScope(scope.id)}
                      whileHover={{ y: -2, scale: 1.02 }}
                      transition={{ type: "tween", duration: 0.12 }}
                      className={`group panel-border relative overflow-hidden rounded-lg px-2 py-2 text-sm transition ${
                        countryScope === scope.id
                          ? "border-emerald-400/35 bg-emerald-500/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                          : "border-white/10 bg-white/5 text-slate-300 hover:border-emerald-400/20 hover:text-white"
                      }`}
                    >
                      <span className="pointer-events-none absolute left-1/2 top-1/2 h-2.5 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-transparent via-arc-accent/70 to-transparent opacity-0 blur-[2px] transition-opacity duration-100 group-hover:opacity-100" />
                      <span className="relative z-10 flex flex-col items-center gap-1">
                        <ScopeIcon scope={scope.id} />
                        <span className="text-[11px] leading-none">{scope.label}</span>
                      </span>
                    </motion.button>
                  </Tooltip>
                ))}
              </div>
            </div>

            <div className="arc-scrollbar max-h-[52vh] space-y-2 overflow-auto pr-1">
              {filteredAndGrouped.length === 0 ? (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-white/10 bg-black/15 p-4 text-base text-slate-400">
                  Нет событий
                </motion.div>
              ) : (
                <AnimatePresence initial={false}>
                  {filteredAndGrouped.map(({ entry, count }, idx) => {
                    const categoryMeta = categories.find((c) => c.id === entry.category) ?? categories[0];
                    const CatIcon = categoryMeta.icon;
                    const priorityCls = entry.priority === "high" ? "text-rose-300" : entry.priority === "medium" ? "text-amber-300" : "text-slate-400";
                    const localDate = new Date(entry.timestamp);
                    return (
                      <motion.div
                        key={`${entry.id}-${count}`}
                        layout
                        initial={{ opacity: 0, y: 10, scale: 0.985 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.985 }}
                        transition={{ duration: 0.16, ease: "easeOut", delay: Math.min(idx * 0.015, 0.12) }}
                        className="group rounded-xl border border-white/10 bg-black/20 p-3.5 transition hover:border-white/15 hover:bg-black/25"
                      >
                        <div className="mb-1.5 flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <Tooltip content={`Категория: ${categoryMeta.label}`} placement="top">
                              <span className="inline-flex">
                                <CatIcon size={16} className={categoryMeta.colorCls} />
                              </span>
                            </Tooltip>
                            <Tooltip content={`Событие зафиксировано на ходу #${entry.turn}`} placement="top">
                              <span className="text-xs text-slate-300">Ход #{entry.turn}</span>
                            </Tooltip>
                            {count > 1 && (
                              <Tooltip content="Сколько одинаковых событий объединено" placement="top">
                                <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-slate-100">x{count}</span>
                              </Tooltip>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs">
                            <Tooltip
                              content={
                                entry.priority === "high"
                                  ? "Высокий приоритет"
                                  : entry.priority === "medium"
                                    ? "Средний приоритет"
                                    : "Низкий приоритет"
                              }
                              placement="top"
                            >
                              <span className="inline-flex">
                                <Bell size={13} className={priorityCls} />
                              </span>
                            </Tooltip>
                            {entry.visibility === "private" && (
                              <Tooltip content="Приватное событие (видно только вашей стране)" placement="top">
                                <span className="inline-flex">
                                  <Lock size={13} className="text-violet-300" />
                                </span>
                              </Tooltip>
                            )}
                          </div>
                        </div>

                        {entry.title ? <div className="mb-1.5 text-base font-semibold leading-tight text-slate-100">{entry.title}</div> : null}
                        <div className="text-sm leading-relaxed text-slate-200">{entry.message}</div>

                        <div className="mt-2.5 flex items-center justify-between gap-2 text-xs text-slate-400">
                          <div className="flex items-center gap-2">
                            <Tooltip content="Категория события" placement="top">
                              <span className={`inline-flex items-center gap-1 ${categoryMeta.colorCls}`}>{categoryMeta.label}</span>
                            </Tooltip>
                            {entry.countryId ? (
                              <Tooltip
                                content={countriesById[entry.countryId]?.name ? `Страна: ${countriesById[entry.countryId].name}` : "Страна, к которой относится событие"}
                                placement="top"
                              >
                                <span className="inline-flex max-w-[10.5rem] items-center gap-1.5 rounded bg-white/5 px-1.5 py-0.5 text-slate-200">
                                  {countriesById[entry.countryId]?.flagUrl ? (
                                    <img
                                      src={countriesById[entry.countryId].flagUrl ?? undefined}
                                      alt=""
                                      className="h-3.5 w-5 rounded-[2px] object-cover"
                                    />
                                  ) : (
                                    <span
                                      className="h-3 w-3 rounded-full"
                                      style={{ backgroundColor: countriesById[entry.countryId]?.color ?? "#94a3b8" }}
                                    />
                                  )}
                                  <span className="truncate">
                                    {countriesById[entry.countryId]?.name ?? entry.countryId}
                                  </span>
                                </span>
                              </Tooltip>
                            ) : null}
                          </div>
                          <Tooltip content={localDate.toLocaleString()} placement="top">
                            <span>{localDate.toLocaleTimeString()}</span>
                          </Tooltip>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
}
