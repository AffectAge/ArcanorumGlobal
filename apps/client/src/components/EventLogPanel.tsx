import { useMemo, useState } from "react";
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
  Filter,
  ArrowUpDown,
  Scissors,
  Globe2,
  Lock,
  type LucideIcon,
} from "lucide-react";

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

export function EventLogPanel({ entries, currentCountryId, onTrimOld, onClear }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [sortMode, setSortMode] = useState<"time" | "priority">("time");
  const [countryScope, setCountryScope] = useState<EventCountryScope>("all");
  const [enabledCategories, setEnabledCategories] = useState<Set<EventCategory>>(() => new Set(allCategoryIds));

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
        return b.turn - a.turn || b.timestamp.localeCompare(a.timestamp);
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

  if (collapsed) {
    return (
      <aside className="pointer-events-auto absolute right-4 top-24 z-[72]">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="glass panel-border flex h-12 w-12 items-center justify-center rounded-xl text-slate-200 hover:text-arc-accent"
          aria-label="Развернуть журнал событий"
          title="Журнал событий"
        >
          <ChevronRight size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="pointer-events-auto absolute right-4 top-24 z-[72] w-[min(360px,calc(100vw-1.5rem))]">
      <div className="glass panel-border rounded-2xl p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bell size={15} className="text-arc-accent" />
            <div className="text-sm font-semibold text-slate-100">Журнал событий</div>
            <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">{entries.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onTrimOld} className="panel-border rounded-md bg-white/5 p-1.5 text-slate-300 hover:text-arc-accent" title="Скрыть старые">
              <Scissors size={14} />
            </button>
            <button type="button" onClick={() => setSortMode((s) => (s === "time" ? "priority" : "time"))} className="panel-border rounded-md bg-white/5 p-1.5 text-slate-300 hover:text-arc-accent" title={sortMode === "time" ? "Сортировка: по времени" : "Сортировка: по важности"}>
              <ArrowUpDown size={14} />
            </button>
            <button type="button" onClick={onClear} className="panel-border rounded-md bg-white/5 p-1.5 text-slate-300 hover:text-rose-300" title="Очистить журнал">
              <Trash2 size={14} />
            </button>
            <button type="button" onClick={() => setCollapsed(true)} className="panel-border rounded-md bg-white/5 p-1.5 text-slate-300 hover:text-arc-accent" title="Свернуть">
              <ChevronLeft size={14} />
            </button>
          </div>
        </div>

        <div className="mb-3 rounded-xl border border-white/10 bg-black/20 p-2">
          <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-400">
            <Filter size={12} />
            Категории
          </div>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const enabled = cat.id === "system" || enabledCategories.has(cat.id);
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => toggleCategory(cat.id)}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition ${
                    enabled ? "border-white/15 bg-white/10 text-slate-100" : "border-white/5 bg-black/15 text-slate-500"
                  } ${cat.id === "system" ? "cursor-default opacity-90" : ""}`}
                  title={cat.id === "system" ? "Системные события всегда видимы" : cat.label}
                >
                  <Icon size={12} className={cat.colorCls} />
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-3 rounded-xl border border-white/10 bg-black/20 p-2">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-400">Принадлежность</div>
          <div className="grid grid-cols-3 gap-1.5">
            {([
              { id: "all", label: "Все" },
              { id: "own", label: "Наши" },
              { id: "foreign", label: "Чужие" },
            ] as const).map((scope) => (
              <button
                key={scope.id}
                type="button"
                onClick={() => setCountryScope(scope.id)}
                className={`rounded-md px-2 py-1 text-xs transition ${countryScope === scope.id ? "bg-arc-accent/20 text-arc-accent" : "bg-white/5 text-slate-300 hover:text-white"}`}
              >
                {scope.label}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[52vh] space-y-2 overflow-auto pr-1">
          {filteredAndGrouped.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-black/15 p-3 text-sm text-slate-400">Нет событий</div>
          ) : (
            filteredAndGrouped.map(({ entry, count }) => {
              const categoryMeta = categories.find((c) => c.id === entry.category) ?? categories[0];
              const CatIcon = categoryMeta.icon;
              const priorityCls = entry.priority === "high" ? "text-rose-300" : entry.priority === "medium" ? "text-amber-300" : "text-slate-400";
              return (
                <div key={`${entry.id}-${count}`} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <CatIcon size={13} className={categoryMeta.colorCls} />
                      <span className="text-[11px] text-slate-400">Ход #{entry.turn}</span>
                      {count > 1 && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-200">x{count}</span>}
                    </div>
                    <div className="flex items-center gap-1 text-[10px]">
                      <Bell size={11} className={priorityCls} />
                      {entry.visibility === "private" && <Lock size={11} className="text-violet-300" />}
                    </div>
                  </div>

                  {entry.title ? <div className="mb-1 text-sm font-semibold text-slate-100">{entry.title}</div> : null}
                  <div className="text-xs leading-relaxed text-slate-300">{entry.message}</div>

                  <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 ${categoryMeta.colorCls}`}>{categoryMeta.label}</span>
                      {entry.countryId ? (
                        <span className="rounded bg-white/5 px-1.5 py-0.5 text-slate-300">{entry.countryId}</span>
                      ) : null}
                    </div>
                    <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
