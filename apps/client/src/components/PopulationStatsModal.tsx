import { Dialog } from "@headlessui/react";
import type { ProvincePopulation, WorldBase } from "@arcanorum/shared";
import * as echarts from "echarts";
import { motion } from "framer-motion";
import { BarChart3, Briefcase, FileText, Flame, Globe2, MapPinned, Palette, ScrollText, Sticker, UserRound, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchContentEntries, type ContentEntryKind } from "../lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  worldBase: WorldBase | null;
  countryId: string;
  countryName: string;
};

type ViewMode = "country" | "world";
type PanelSection = "general" | "religions" | "cultures" | "professions" | "ideologies" | "races" | "branding";
type PopulationDimensionKey = "culturePct" | "ideologyPct" | "religionPct" | "racePct" | "professionPct";

type PopulationAggregate = {
  totalPopulation: number;
  provinceCount: number;
  breakdown: Record<PopulationDimensionKey, Record<string, number>>;
};

type ContentEntryMeta = {
  name: string;
  color: string;
  logoUrl: string | null;
  malePortraitUrl: string | null;
  femalePortraitUrl: string | null;
};

type BreakdownRow = {
  id: string;
  label: string;
  pct: number;
  color: string;
  imageUrl: string | null;
};

const DIMENSION_LABELS: Array<{ key: PopulationDimensionKey; label: string }> = [
  { key: "culturePct", label: "Культуры" },
  { key: "ideologyPct", label: "Идеологии" },
  { key: "religionPct", label: "Религии" },
  { key: "racePct", label: "Расы" },
  { key: "professionPct", label: "Профессии" },
];

const STAT_TABS: Array<{
  id: PanelSection;
  label: string;
  icon: typeof FileText;
  dimension?: PopulationDimensionKey;
}> = [
  { id: "general", label: "Основная информация", icon: FileText },
  { id: "religions", label: "Религии", icon: ScrollText, dimension: "religionPct" },
  { id: "cultures", label: "Культуры", icon: Palette, dimension: "culturePct" },
  { id: "professions", label: "Профессии", icon: Briefcase, dimension: "professionPct" },
  { id: "ideologies", label: "Идеологии", icon: Flame, dimension: "ideologyPct" },
  { id: "races", label: "Расы", icon: UserRound, dimension: "racePct" },
  { id: "branding", label: "Логотип и стиль", icon: Sticker },
];

const KIND_BY_DIMENSION: Record<PopulationDimensionKey, ContentEntryKind> = {
  culturePct: "cultures",
  ideologyPct: "ideologies",
  religionPct: "religions",
  racePct: "races",
  professionPct: "professions",
};

function formatInt(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.max(0, Math.floor(value)));
}

function aggregatePopulation(
  worldBase: WorldBase | null,
  scope: "country" | "world",
  countryId: string,
): PopulationAggregate {
  const empty: PopulationAggregate = {
    totalPopulation: 0,
    provinceCount: 0,
    breakdown: {
      culturePct: {},
      ideologyPct: {},
      religionPct: {},
      racePct: {},
      professionPct: {},
    },
  };
  if (!worldBase) return empty;

  const byProvince = worldBase.provincePopulationByProvince ?? {};
  const ownerByProvince = worldBase.provinceOwner ?? {};
  const provinceIds = Object.keys(byProvince).filter((provinceId) => scope === "world" || ownerByProvince[provinceId] === countryId);
  if (provinceIds.length === 0) {
    return empty;
  }

  let totalPopulation = 0;
  const weighted: PopulationAggregate["breakdown"] = {
    culturePct: {},
    ideologyPct: {},
    religionPct: {},
    racePct: {},
    professionPct: {},
  };

  for (const provinceId of provinceIds) {
    const population = byProvince[provinceId] as ProvincePopulation | undefined;
    if (!population) continue;
    const provinceTotal = Math.max(0, population.populationTotal);
    if (provinceTotal <= 0) continue;
    totalPopulation += provinceTotal;
    for (const { key } of DIMENSION_LABELS) {
      const map = population[key] ?? {};
      for (const [valueKey, valuePct] of Object.entries(map)) {
        if (typeof valuePct !== "number" || !Number.isFinite(valuePct) || valuePct <= 0) continue;
        weighted[key][valueKey] = (weighted[key][valueKey] ?? 0) + provinceTotal * (valuePct / 100);
      }
    }
  }

  if (totalPopulation <= 0) {
    return {
      totalPopulation: 0,
      provinceCount: provinceIds.length,
      breakdown: {
        culturePct: {},
        ideologyPct: {},
        religionPct: {},
        racePct: {},
        professionPct: {},
      },
    };
  }

  const normalized: PopulationAggregate["breakdown"] = {
    culturePct: {},
    ideologyPct: {},
    religionPct: {},
    racePct: {},
    professionPct: {},
  };
  for (const { key } of DIMENSION_LABELS) {
    for (const [valueKey, weightedValue] of Object.entries(weighted[key])) {
      normalized[key][valueKey] = (weightedValue / totalPopulation) * 100;
    }
  }

  return {
    totalPopulation,
    provinceCount: provinceIds.length,
    breakdown: normalized,
  };
}

export function PopulationStatsModal({ open, onClose, worldBase, countryId, countryName }: Props) {
  const [mode, setMode] = useState<ViewMode>("country");
  const [section, setSection] = useState<PanelSection>("general");
  const [entryByKindById, setEntryByKindById] = useState<Record<ContentEntryKind, Record<string, ContentEntryMeta>>>({
    cultures: {},
    ideologies: {},
    religions: {},
    races: {},
    professions: {},
  });
  const pieRef = useRef<HTMLDivElement | null>(null);

  const countryStats = useMemo(() => aggregatePopulation(worldBase, "country", countryId), [countryId, worldBase]);
  const worldStats = useMemo(() => aggregatePopulation(worldBase, "world", countryId), [countryId, worldBase]);
  const stats = mode === "country" ? countryStats : worldStats;
  const title = mode === "country" ? `Население: ${countryName}` : "Население мира";
  const subtitle = mode === "country" ? "Статистика по вашим провинциям" : "Сводная статистика по всем провинциям";
  const activeTab = STAT_TABS.find((tab) => tab.id === section) ?? STAT_TABS[0];
  const activeDimension = activeTab.dimension ?? null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      fetchContentEntries("cultures"),
      fetchContentEntries("ideologies"),
      fetchContentEntries("religions"),
      fetchContentEntries("races"),
      fetchContentEntries("professions"),
    ])
      .then(([cultures, ideologies, religions, races, professions]) => {
        if (cancelled) return;
        setEntryByKindById({
          cultures: Object.fromEntries(
            cultures.map((entry) => [entry.id, { name: entry.name, color: entry.color, logoUrl: entry.logoUrl ?? null, malePortraitUrl: null, femalePortraitUrl: null }]),
          ),
          ideologies: Object.fromEntries(
            ideologies.map((entry) => [entry.id, { name: entry.name, color: entry.color, logoUrl: entry.logoUrl ?? null, malePortraitUrl: null, femalePortraitUrl: null }]),
          ),
          religions: Object.fromEntries(
            religions.map((entry) => [entry.id, { name: entry.name, color: entry.color, logoUrl: entry.logoUrl ?? null, malePortraitUrl: null, femalePortraitUrl: null }]),
          ),
          races: Object.fromEntries(
            races.map((entry) => [
              entry.id,
              {
                name: entry.name,
                color: entry.color,
                logoUrl: entry.logoUrl ?? null,
                malePortraitUrl: entry.malePortraitUrl ?? null,
                femalePortraitUrl: entry.femalePortraitUrl ?? null,
              },
            ]),
          ),
          professions: Object.fromEntries(
            professions.map((entry) => [entry.id, { name: entry.name, color: entry.color, logoUrl: entry.logoUrl ?? null, malePortraitUrl: null, femalePortraitUrl: null }]),
          ),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setEntryByKindById({
          cultures: {},
          ideologies: {},
          religions: {},
          races: {},
          professions: {},
        });
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const activeRows: BreakdownRow[] = useMemo(() => {
    if (!activeDimension) return [];
    const kind = KIND_BY_DIMENSION[activeDimension];
    const entryById = entryByKindById[kind] ?? {};
    return Object.entries(stats.breakdown[activeDimension])
      .map(([id, rawPct]) => {
        const pct = Math.max(0, Math.min(100, rawPct));
        const entry = entryById[id];
        return {
          id,
          label: entry?.name ?? id,
          pct,
          color: entry?.color ?? "#9ca3af",
          imageUrl:
            kind === "races"
              ? (entry?.malePortraitUrl ?? entry?.femalePortraitUrl ?? entry?.logoUrl ?? null)
              : (entry?.logoUrl ?? null),
        } satisfies BreakdownRow;
      })
      .filter((row) => row.pct > 0)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 200);
  }, [activeDimension, entryByKindById, stats]);

  useEffect(() => {
    if (!activeDimension) return;
    if (!pieRef.current) return;

    const chart = echarts.init(pieRef.current);

    chart.setOption({
      animationDuration: 280,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        formatter: (params: { seriesName: string; name: string; value: number; percent: number }) =>
          `${params.seriesName} <br/>${params.name} : ${params.value.toFixed(2)} (${params.percent.toFixed(2)}%)`,
      },
      legend: {
        type: "scroll",
        orient: "vertical",
        right: 8,
        top: 20,
        bottom: 20,
        width: "36%",
        pageIconColor: "#4ade80",
        pageTextStyle: { color: "#94a3b8" },
        textStyle: { color: "#cbd5e1", fontSize: 11 },
      },
      series: [
        {
          name: activeTab.label,
          type: "pie",
          radius: "52%",
          center: ["34%", "50%"],
          label: {
            show: true,
            color: "#e2e8f0",
            formatter: "{d}%",
            fontSize: 10,
          },
          labelLine: { length: 10, length2: 6 },
          data: activeRows.map((row) => ({
            name: row.label,
            value: row.pct,
            itemStyle: { color: row.color },
          })),
          emphasis: {
            scale: true,
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: "rgba(0, 0, 0, 0.5)",
            },
          },
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [activeDimension, activeRows, activeTab.label]);

  const renderDimensionStats = (dimension: PopulationDimensionKey) => {
    const dimensionLabel = DIMENSION_LABELS.find((item) => item.key === dimension)?.label ?? "Статистика";

    return (
      <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-xl border border-white/10 bg-[#131a22] p-3">
          <div className="mb-2 text-xs text-white/60">{dimensionLabel}</div>
          {activeRows.length === 0 ? (
            <div className="flex h-[420px] items-center justify-center text-sm text-white/45">Нет данных</div>
          ) : (
            <div ref={pieRef} className="h-[420px] w-full" />
          )}
        </section>
        <section className="min-h-0 rounded-xl border border-white/10 bg-[#131a22] p-3">
          <div className="mb-2 text-xs text-white/60">Легенда ({activeRows.length})</div>
          <div className="arc-scrollbar max-h-[420px] space-y-2 overflow-auto pr-1">
            {activeRows.map((row) => (
              <div
                key={row.id}
                className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-left"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {row.imageUrl ? (
                    <img
                      src={row.imageUrl}
                      alt=""
                      className={`h-5 w-5 rounded-sm object-cover ${dimension === "racePct" ? "border border-white/15" : ""}`}
                    />
                  ) : (
                    <span
                      className="inline-flex h-5 w-5 items-center justify-center rounded-sm border text-[10px]"
                      style={{ borderColor: `${row.color}99`, backgroundColor: `${row.color}22`, color: row.color }}
                    >
                      {row.label.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="truncate text-sm text-white/85">{row.label}</span>
                </span>
                <span className="ml-2 shrink-0 text-right">
                  <span className="block tabular-nums text-xs text-arc-accent">{row.pct.toFixed(2)}%</span>
                  <span className="block tabular-nums text-[11px] text-white/60">
                    {formatInt((stats.totalPopulation * row.pct) / 100)} чел.
                  </span>
                </span>
              </div>
            ))}
            {activeRows.length === 0 && <div className="text-xs text-white/45">Нет данных</div>}
          </div>
        </section>
      </div>
    );
  };

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[205]">
      <motion.div
        aria-hidden="true"
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <div className="fixed inset-0 p-4 md:p-6">
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.99 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="h-full"
        >
          <Dialog.Panel className="glass panel-border flex h-full flex-col rounded-2xl bg-[#0b111b] p-4 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <Dialog.Title className="font-display text-2xl tracking-wide text-arc-accent">Панель населения</Dialog.Title>
                <span className="mt-1 block text-xs text-white/60">{subtitle}</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="panel-border inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-slate-300 transition hover:text-arc-accent"
                aria-label="Закрыть"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
              <aside className="min-h-0 rounded-xl border border-white/10 bg-black/20 p-3">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">Область</span>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setMode("country")}
                    className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
                      mode === "country"
                        ? "border-arc-accent/30 bg-arc-accent/10 text-arc-accent"
                        : "border-white/10 bg-black/20 text-white/70"
                    }`}
                  >
                    <MapPinned size={15} />
                    <span>{countryName}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("world")}
                    className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
                      mode === "world"
                        ? "border-arc-accent/30 bg-arc-accent/10 text-arc-accent"
                        : "border-white/10 bg-black/20 text-white/70"
                    }`}
                  >
                    <Globe2 size={15} />
                    <span>Мир</span>
                  </button>
                </div>
              </aside>

              <div className="grid min-h-0 gap-4 lg:grid-rows-[auto_minmax(0,1fr)]">
                <div className="arc-scrollbar flex items-center gap-5 overflow-auto border-b border-white/10 px-1">
                  {STAT_TABS.map((tab) => {
                    const TabIcon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setSection(tab.id)}
                        className={`inline-flex shrink-0 items-center gap-1.5 pb-2 text-sm transition ${
                          section === tab.id
                            ? "border-b-2 border-arc-accent text-arc-accent"
                            : "border-b-2 border-transparent text-white/60 hover:text-white"
                        }`}
                      >
                        <TabIcon size={14} />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                <div className="min-h-0 overflow-auto rounded-xl border border-white/10 bg-black/20 p-4">
                  {section === "general" && (
                    <>
                      <div className="mb-4">
                        <div className="text-lg font-semibold text-white">{title}</div>
                        <div className="text-xs text-white/50">Агрегированные данные по населению</div>
                      </div>

                      <div className="mb-4 grid gap-3 md:grid-cols-2">
                        <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                          <div className="flex items-center gap-2 text-xs text-white/60">
                            <Users size={13} />
                            <span>Общее население</span>
                          </div>
                          <div className="mt-2 text-2xl font-semibold text-white">{formatInt(stats.totalPopulation)}</div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                          <div className="flex items-center gap-2 text-xs text-white/60">
                            <BarChart3 size={13} />
                            <span>Провинций в расчете</span>
                          </div>
                          <div className="mt-2 text-2xl font-semibold text-white">{formatInt(stats.provinceCount)}</div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {DIMENSION_LABELS.map((dimension) => (
                          <section key={dimension.key} className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{dimension.label}</div>
                            <div className="text-sm text-white/70">
                              Откройте вкладку <span className="font-semibold text-white">{dimension.label}</span> для детальной статистики.
                            </div>
                          </section>
                        ))}
                      </div>
                    </>
                  )}

                  {activeDimension && renderDimensionStats(activeDimension)}

                  {section === "branding" && (
                    <div className="space-y-4">
                      <div>
                        <div className="text-lg font-semibold text-white">Логотип и стиль</div>
                        <div className="text-xs text-white/50">Подготовка визуальных настроек панели населения</div>
                      </div>
                      <section className="rounded-xl border border-white/10 bg-[#131a22] p-4">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Статус</div>
                        <div className="text-sm text-white/75">Раздел зарезервирован под будущие механики визуализации населения.</div>
                      </section>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Dialog.Panel>
        </motion.div>
      </div>
    </Dialog>
  );
}
