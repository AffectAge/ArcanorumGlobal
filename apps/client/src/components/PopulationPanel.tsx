import { Dialog } from "@headlessui/react";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import { motion } from "framer-motion";
import { BarChart3, Globe2, MapPinned, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  fetchPopulationCountrySummary,
  fetchPopulationWorldSummary,
  type PopulationBreakdownRow,
  type PopulationCountrySummaryResponse,
  type PopulationWorldSummaryResponse,
} from "../lib/api";

type Props = {
  open: boolean;
  token: string;
  countryId: string;
  onClose: () => void;
};

type PanelCategory = "country" | "world" | "provinces";
type PanelTab = "summary" | "structure" | "groups";
type BreakdownKey = "strata" | "professions" | "cultures" | "religions" | "races" | "ideologies";

const BREAKDOWN_LABELS: Record<BreakdownKey, string> = {
  strata: "Страты",
  professions: "Профессии",
  cultures: "Культуры",
  religions: "Религии",
  races: "Расы",
  ideologies: "Идеологии",
};

function fmtInt(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}

function fmtPercentPermille(value: number): string {
  return `${(value / 10).toFixed(1)}%`;
}

function fmtMoneyX100(value: number): string {
  return (value / 100).toFixed(2);
}

function MetricBarsChart({
  values,
}: {
  values: Array<{ label: string; valuePermille: number; color: string }>;
}) {
  const width = 420;
  const height = 170;
  const margin = { top: 14, right: 12, bottom: 16, left: 92 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const yScale = scaleBand<string>({
    domain: values.map((v) => v.label),
    range: [0, innerH],
    padding: 0.22,
  });
  const xScale = scaleLinear<number>({
    domain: [0, 1000],
    range: [0, innerW],
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[170px] w-full">
      <Group left={margin.left} top={margin.top}>
        {values.map((row) => {
          const y = yScale(row.label) ?? 0;
          const h = yScale.bandwidth();
          const w = xScale(Math.max(0, Math.min(1000, row.valuePermille)));
          return (
            <g key={row.label}>
              <text x={-10} y={y + h / 2 + 4} textAnchor="end" fill="rgba(255,255,255,.65)" fontSize="11">
                {row.label}
              </text>
              <rect x={0} y={y} width={innerW} height={h} rx={6} fill="rgba(255,255,255,.05)" />
              <rect x={0} y={y} width={w} height={h} rx={6} fill={row.color} fillOpacity={0.9} />
              <text x={Math.min(innerW - 4, w + 6)} y={y + h / 2 + 4} fill="rgba(255,255,255,.85)" fontSize="11">
                {fmtPercentPermille(row.valuePermille)}
              </text>
            </g>
          );
        })}
      </Group>
    </svg>
  );
}

function BreakdownBarsChart({
  rows,
  color = "#6ee7b7",
}: {
  rows: PopulationBreakdownRow[];
  color?: string;
}) {
  const top = rows.slice(0, 6);
  const width = 520;
  const height = 240;
  const margin = { top: 8, right: 14, bottom: 10, left: 170 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const yScale = scaleBand<string>({
    domain: top.map((r) => r.id),
    range: [0, innerH],
    padding: 0.18,
  });
  const xScale = scaleLinear<number>({ domain: [0, 1000], range: [0, innerW] });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[240px] w-full">
      <Group left={margin.left} top={margin.top}>
        {top.map((row) => {
          const y = yScale(row.id) ?? 0;
          const h = yScale.bandwidth();
          const w = xScale(row.sharePermille);
          return (
            <g key={row.id}>
              <text x={-10} y={y + h / 2 + 4} textAnchor="end" fill="rgba(255,255,255,.72)" fontSize="11">
                {row.label.length > 22 ? `${row.label.slice(0, 22)}…` : row.label}
              </text>
              <rect x={0} y={y} width={innerW} height={h} rx={6} fill="rgba(255,255,255,.04)" />
              <rect x={0} y={y} width={w} height={h} rx={6} fill={color} fillOpacity={0.85} />
              <text x={innerW + 6} y={y + h / 2 + 4} fill="rgba(255,255,255,.72)" fontSize="11">
                {fmtPercentPermille(row.sharePermille)}
              </text>
            </g>
          );
        })}
      </Group>
    </svg>
  );
}

function SummaryCards({
  title,
  summary,
  strataRows,
}: {
  title: string;
  summary:
    | PopulationWorldSummaryResponse["summary"]
    | PopulationCountrySummaryResponse["summary"];
  strataRows?: PopulationBreakdownRow[];
}) {
  const cards = [
    { label: "Население", value: fmtInt(summary.totalPopulation), tone: "text-white" },
    { label: "POP-группы", value: fmtInt(summary.popGroupCount), tone: "text-arc-accent" },
    { label: "Занятые", value: fmtInt(summary.employedPopulation), tone: "text-emerald-300" },
    { label: "Безработица", value: fmtPercentPermille(summary.unemploymentPermille), tone: "text-amber-300" },
    { label: "Благосостояние", value: fmtMoneyX100(summary.avgWealthX100), tone: "text-sky-300" },
    { label: "Лояльность", value: fmtPercentPermille(summary.avgLoyalty), tone: "text-emerald-300" },
    { label: "Радикализм", value: fmtPercentPermille(summary.avgRadicalism), tone: "text-rose-300" },
    { label: "Миграция", value: fmtPercentPermille(summary.avgMigrationDesire), tone: "text-amber-300" },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="mt-1 text-xs text-white/55">Сводная статистика населения</div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] text-white/50">{card.label}</div>
            <div className={`mt-1 text-lg font-semibold tabular-nums ${card.tone}`}>{card.value}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Показатели</div>
          <MetricBarsChart
            values={[
              { label: "Лояльность", valuePermille: summary.avgLoyalty, color: "#34d399" },
              { label: "Радикализм", valuePermille: summary.avgRadicalism, color: "#fb7185" },
              { label: "Занятость", valuePermille: 1000 - summary.unemploymentPermille, color: "#60a5fa" },
              { label: "Миграция", valuePermille: summary.avgMigrationDesire, color: "#fbbf24" },
            ]}
          />
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Страты</div>
          {strataRows && strataRows.length > 0 ? (
            <BreakdownBarsChart rows={strataRows} color="#38bdf8" />
          ) : (
            <div className="flex h-[240px] items-center justify-center text-xs text-white/50">Нет данных</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PopulationPanel({ open, token, countryId, onClose }: Props) {
  const [category, setCategory] = useState<PanelCategory>("country");
  const [tab, setTab] = useState<PanelTab>("summary");
  const [breakdownKey, setBreakdownKey] = useState<BreakdownKey>("professions");
  const [selectedRowId, setSelectedRowId] = useState<string>("");
  const [countryData, setCountryData] = useState<PopulationCountrySummaryResponse | null>(null);
  const [worldData, setWorldData] = useState<PopulationWorldSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupFilters, setGroupFilters] = useState<{
    strata: string;
    professions: string;
    cultures: string;
    religions: string;
    races: string;
    ideologies: string;
  }>({
    strata: "",
    professions: "",
    cultures: "",
    religions: "",
    races: "",
    ideologies: "",
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchPopulationCountrySummary(token, countryId), fetchPopulationWorldSummary(token)])
      .then(([countryResp, worldResp]) => {
        if (cancelled) return;
        setCountryData(countryResp);
        setWorldData(worldResp);
      })
      .catch(() => {
        if (!cancelled) toast.error("Не удалось загрузить статистику населения");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, token, countryId]);

  useEffect(() => {
    if ((category === "world" || category === "provinces") && tab === "groups") {
      setTab("summary");
    }
  }, [category, tab]);

  const activeData = category === "country" || category === "provinces" ? countryData : worldData;
  const activeBreakdowns = activeData?.breakdowns ?? null;
  const activeRows = useMemo(() => (activeBreakdowns ? activeBreakdowns[breakdownKey] : []), [activeBreakdowns, breakdownKey]);
  const selectedRow = useMemo(
    () => activeRows.find((row) => row.id === selectedRowId) ?? activeRows[0] ?? null,
    [activeRows, selectedRowId],
  );

  useEffect(() => {
    setSelectedRowId(activeRows[0]?.id ?? "");
  }, [breakdownKey, category, activeRows]);

  const topGroups = countryData?.topGroups ?? [];
  const provinceRows = countryData?.provinces ?? [];
  const selectedProvinceRow = useMemo(
    () => provinceRows.find((r) => r.id === selectedRowId) ?? provinceRows[0] ?? null,
    [provinceRows, selectedRowId],
  );

  const labelById = useMemo(() => {
    const byKind = {
      professions: new Map<string, string>(),
      cultures: new Map<string, string>(),
      religions: new Map<string, string>(),
      races: new Map<string, string>(),
      ideologies: new Map<string, string>(),
    };
    if (!countryData) return byKind;
    (Object.keys(byKind) as Array<keyof typeof byKind>).forEach((k) => {
      for (const row of countryData.breakdowns[k]) byKind[k].set(row.id, row.label);
    });
    return byKind;
  }, [countryData]);

  const filteredTopGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    return topGroups.filter((g) => {
      if (q && !g.provinceId.toLowerCase().includes(q)) return false;
      if (groupFilters.strata && g.strata !== groupFilters.strata) return false;
      if (groupFilters.professions && g.professionId !== groupFilters.professions) return false;
      if (groupFilters.cultures && g.cultureId !== groupFilters.cultures) return false;
      if (groupFilters.religions && g.religionId !== groupFilters.religions) return false;
      if (groupFilters.races && g.raceId !== groupFilters.races) return false;
      if (groupFilters.ideologies && g.ideologyId !== groupFilters.ideologies) return false;
      return true;
    });
  }, [groupFilters, groupSearch, topGroups]);

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[206]">
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
                <Dialog.Title className="font-display text-2xl tracking-wide text-arc-accent">Население</Dialog.Title>
                <div className="mt-1 text-xs text-white/60">Статистика населения страны и мира (агрегированные POP-группы)</div>
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
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Категории</div>
                <div className="space-y-2">
                  {[
                    { id: "country" as const, label: "Моя страна", icon: Users },
                    { id: "provinces" as const, label: "Провинции", icon: MapPinned },
                    { id: "world" as const, label: "Мир", icon: Globe2 },
                  ].map((item) => {
                    const Icon = item.icon;
                    const active = item.id === category;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setCategory(item.id)}
                        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
                          active ? "border-arc-accent/30 bg-arc-accent/10 text-arc-accent" : "border-white/10 bg-black/20 text-white/70"
                        }`}
                      >
                        <Icon size={15} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <div className="grid min-h-0 gap-4 lg:grid-rows-[auto_auto_minmax(0,1fr)]">
                <div className="flex items-center gap-5 border-b border-white/10 px-1">
                  {[
                    { id: "summary" as const, label: "Сводка" },
                    { id: "structure" as const, label: "Структура" },
                    ...(category === "country" ? ([{ id: "groups" as const, label: "POP-группы" }] as const) : []),
                  ].map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setTab(section.id)}
                      className={`pb-2 text-sm transition ${
                        tab === section.id ? "border-b-2 border-arc-accent text-arc-accent" : "border-b-2 border-transparent text-white/60 hover:text-white"
                      }`}
                    >
                      {section.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div>
                    <div className="text-sm font-semibold text-white">
                      {category === "country" ? "Статистика моей страны" : category === "provinces" ? "Статистика по провинциям" : "Мировая статистика"}
                    </div>
                    <div className="mt-1 text-xs text-white/55">
                      {tab === "summary"
                        ? "Общие показатели населения"
                        : tab === "structure"
                          ? category === "provinces"
                            ? "Сравнение провинций вашей страны"
                            : "Разбивка по социальным и контент-категориям"
                          : "Крупнейшие POP-группы страны"}
                    </div>
                  </div>
                  {tab === "structure" && category !== "provinces" && (
                    <div className="flex flex-wrap items-center gap-2">
                      {(Object.keys(BREAKDOWN_LABELS) as BreakdownKey[]).map((key) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setBreakdownKey(key)}
                          className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
                            breakdownKey === key
                              ? "border-arc-accent/30 bg-arc-accent/10 text-arc-accent"
                              : "border-white/10 bg-black/20 text-white/70"
                          }`}
                        >
                          {BREAKDOWN_LABELS[key]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="min-h-0">
                  {loading || !activeData ? (
                    <div className="flex h-full items-center justify-center rounded-xl border border-white/10 bg-black/20 text-sm text-white/60">
                      Загрузка статистики...
                    </div>
                  ) : tab === "summary" ? (
                    <SummaryCards
                      title={category === "country" ? "Моя страна" : "Мир"}
                      summary={activeData.summary}
                      strataRows={activeData.breakdowns?.strata}
                    />
                  ) : tab === "structure" && category !== "provinces" ? (
                    <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
                      <section className="min-h-0 rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          {BREAKDOWN_LABELS[breakdownKey]}
                        </div>
                        <div className="arc-scrollbar max-h-full space-y-2 overflow-auto pr-1">
                          {activeRows.map((row) => (
                            <button
                              key={row.id}
                              type="button"
                              onClick={() => setSelectedRowId(row.id)}
                              className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                                selectedProvinceRow?.id === row.id
                                  ? "border-arc-accent/30 bg-arc-accent/10"
                                  : "border-white/10 bg-black/20 hover:border-white/15"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="truncate text-sm text-white">{row.label}</div>
                                <div className="text-xs tabular-nums text-white/60">{fmtPercentPermille(row.sharePermille)}</div>
                              </div>
                              <div className="mt-1 text-[11px] text-white/50">Население: {fmtInt(row.size)}</div>
                            </button>
                          ))}
                        </div>
                      </section>
                      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
                        {selectedRow ? (
                          <div className="space-y-4">
                            <div>
                              <div className="text-sm font-semibold text-white">{selectedRow.label}</div>
                              <div className="mt-1 text-xs text-white/55">
                                {BREAKDOWN_LABELS[breakdownKey]} • Доля: {fmtPercentPermille(selectedRow.sharePermille)}
                              </div>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                              {[
                                ["Население", fmtInt(selectedRow.size), "text-white"],
                                ["Благосостояние", fmtMoneyX100(selectedRow.avgWealthX100), "text-sky-300"],
                                ["Лояльность", fmtPercentPermille(selectedRow.avgLoyalty), "text-emerald-300"],
                                ["Радикализм", fmtPercentPermille(selectedRow.avgRadicalism), "text-rose-300"],
                                ["Занятость", fmtPercentPermille(selectedRow.avgEmployment), "text-emerald-300"],
                                ["Миграция", fmtPercentPermille(selectedRow.avgMigrationDesire), "text-amber-300"],
                              ].map(([label, value, tone]) => (
                                <div key={String(label)} className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                                  <div className="text-[11px] text-white/50">{label}</div>
                                  <div className={`mt-1 text-base font-semibold tabular-nums ${tone}`}>{value}</div>
                                </div>
                              ))}
                            </div>
                            <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                Топ {BREAKDOWN_LABELS[breakdownKey]}
                              </div>
                              <BreakdownBarsChart rows={activeRows} color="#22d3ee" />
                            </div>
                          </div>
                        ) : (
                          <div className="text-sm text-white/60">Нет данных</div>
                        )}
                      </section>
                    </div>
                  ) : tab === "structure" && category === "provinces" ? (
                    <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
                      <section className="min-h-0 rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Провинции</div>
                        <div className="arc-scrollbar max-h-full space-y-2 overflow-auto pr-1">
                          {provinceRows.map((row) => (
                            <button
                              key={row.id}
                              type="button"
                              onClick={() => setSelectedRowId(row.id)}
                              className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                                selectedRow?.id === row.id
                                  ? "border-arc-accent/30 bg-arc-accent/10"
                                  : "border-white/10 bg-black/20 hover:border-white/15"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="truncate text-sm text-white">{row.label}</div>
                                <div className="text-xs tabular-nums text-white/60">{fmtPercentPermille(row.sharePermille)}</div>
                              </div>
                              <div className="mt-1 text-[11px] text-white/50">Население: {fmtInt(row.size)}</div>
                            </button>
                          ))}
                        </div>
                      </section>
                      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
                        {selectedProvinceRow ? (
                          (() => {
                            const row = selectedProvinceRow;
                            return (
                              <div className="space-y-4">
                                <div>
                                  <div className="text-sm font-semibold text-white">{row.label}</div>
                                  <div className="mt-1 text-xs text-white/55">Доля населения страны: {fmtPercentPermille(row.sharePermille)}</div>
                                </div>
                                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                  {[
                                    ["Население", fmtInt(row.size), "text-white"],
                                    ["Благосостояние", fmtMoneyX100(row.avgWealthX100), "text-sky-300"],
                                    ["Лояльность", fmtPercentPermille(row.avgLoyalty), "text-emerald-300"],
                                    ["Радикализм", fmtPercentPermille(row.avgRadicalism), "text-rose-300"],
                                    ["Занятость", fmtPercentPermille(row.avgEmployment), "text-emerald-300"],
                                    ["Миграция", fmtPercentPermille(row.avgMigrationDesire), "text-amber-300"],
                                  ].map(([label, value, tone]) => (
                                    <div key={String(label)} className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                                      <div className="text-[11px] text-white/50">{label}</div>
                                      <div className={`mt-1 text-base font-semibold tabular-nums ${tone}`}>{value}</div>
                                    </div>
                                  ))}
                                </div>
                                <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                    Топ провинций по населению
                                  </div>
                                  <BreakdownBarsChart rows={provinceRows} color="#a78bfa" />
                                </div>
                              </div>
                            );
                          })()
                        ) : (
                          <div className="text-sm text-white/60">Нет данных по провинциям</div>
                        )}
                      </section>
                    </div>
                  ) : (
                    <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                      <section className="min-h-0 rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          <BarChart3 size={13} />
                          Крупнейшие POP-группы страны
                        </div>
                        <div className="mb-3 grid gap-2 rounded-xl border border-white/10 bg-[#131a22] p-2">
                          <input
                            value={groupSearch}
                            onChange={(e) => setGroupSearch(e.target.value)}
                            placeholder="Поиск по провинции"
                            className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-xs text-white outline-none transition focus:border-arc-accent/30"
                          />
                          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                            <select
                              value={groupFilters.strata}
                              onChange={(e) => setGroupFilters((p) => ({ ...p, strata: e.target.value }))}
                              className="rounded-lg border border-white/10 bg-black/35 px-2 py-2 text-xs text-white outline-none"
                            >
                              <option value="">Все страты</option>
                              <option value="lower">Низший</option>
                              <option value="middle">Средний</option>
                              <option value="upper">Высший</option>
                            </select>
                            {([
                              ["professions", "Профессии"],
                              ["cultures", "Культуры"],
                              ["religions", "Религии"],
                              ["races", "Расы"],
                              ["ideologies", "Идеологии"],
                            ] as const).map(([key, label]) => (
                              <select
                                key={key}
                                value={groupFilters[key]}
                                onChange={(e) => setGroupFilters((p) => ({ ...p, [key]: e.target.value }))}
                                className="rounded-lg border border-white/10 bg-black/35 px-2 py-2 text-xs text-white outline-none"
                              >
                                <option value="">Все: {label}</option>
                                {(countryData?.breakdowns[key] ?? []).slice(0, 200).map((row) => (
                                  <option key={row.id} value={row.id}>
                                    {row.label}
                                  </option>
                                ))}
                              </select>
                            ))}
                          </div>
                        </div>
                        <div className="arc-scrollbar max-h-full overflow-auto pr-1">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-[#0b111b]">
                              <tr className="text-left text-white/50">
                                <th className="px-2 py-2 font-medium">Провинция</th>
                                <th className="px-2 py-2 font-medium">Размер</th>
                                <th className="px-2 py-2 font-medium">Страта</th>
                                <th className="px-2 py-2 font-medium">Профессия</th>
                                <th className="px-2 py-2 font-medium">Рад.</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredTopGroups.map((g) => (
                                <tr key={g.id} className="border-t border-white/5 text-white/80">
                                  <td className="px-2 py-2">{g.provinceId}</td>
                                  <td className="px-2 py-2 tabular-nums">{fmtInt(g.size)}</td>
                                  <td className="px-2 py-2">{g.strata}</td>
                                  <td className="px-2 py-2">{labelById.professions.get(g.professionId) ?? g.professionId}</td>
                                  <td className="px-2 py-2 tabular-nums text-rose-300">{fmtPercentPermille(g.radicalism)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                      <aside className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Объяснение</div>
                        <div className="space-y-2 text-xs leading-5 text-white/70">
                          <p>Это агрегированные POP-группы, а не отдельные жители.</p>
                          <p>Группы объединяются по ключу (провинция, раса, культура, религия, профессия, идеология, strata) и сжимаются по бакетам значений.</p>
                          <p>Показатели обновляются на резолве хода.</p>
                        </div>
                      </aside>
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
