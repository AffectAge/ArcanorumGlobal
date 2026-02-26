import { Dialog } from "@headlessui/react";
import { LinearGradient } from "@visx/gradient";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import { AreaClosed, LinePath, Pie } from "@visx/shape";
import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, Briefcase, Flag, Globe2, Layers3, MapPinned, Shield, Sparkles, Users, X } from "lucide-react";
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

const BREAKDOWN_ICONS: Record<BreakdownKey, typeof Layers3> = {
  strata: Layers3,
  professions: Briefcase,
  cultures: Sparkles,
  religions: Shield,
  races: Flag,
  ideologies: BarChart3,
};

const CHART_SURFACE = "#131a22";
const CHART_TRACK = "rgba(255,255,255,0.06)";
const CHART_GRID = "rgba(255,255,255,0.05)";
const CHART_TEXT_DIM = "rgba(255,255,255,0.62)";
const CHART_TEXT = "rgba(255,255,255,0.84)";
const MAX_BREAKDOWN_CHART_ITEMS = 10;

function fmtInt(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}

function fmtPercentPermille(value: number): string {
  return `${(value / 10).toFixed(1)}%`;
}

function fmtMoneyX100(value: number): string {
  return (value / 100).toFixed(2);
}

function breakdownOtherLabel(kindLabel?: string): string {
  if (!kindLabel) return "Другие";
  const lower = kindLabel.toLowerCase();
  return `Другие ${lower}`;
}

function prepareBreakdownChartRows(rows: PopulationBreakdownRow[], options?: { maxItems?: number; otherLabel?: string }): PopulationBreakdownRow[] {
  const maxItems = options?.maxItems ?? MAX_BREAKDOWN_CHART_ITEMS;
  if (rows.length <= maxItems) return rows;
  const head = rows.slice(0, maxItems);
  const tail = rows.slice(maxItems);
  if (tail.length === 0) return head;
  const totalTail = tail.reduce(
    (acc, row) => {
      acc.size += row.size;
      acc.sharePermille += row.sharePermille;
      acc.wealthWeighted += row.avgWealthX100 * row.size;
      acc.loyaltyWeighted += row.avgLoyalty * row.size;
      acc.radicalismWeighted += row.avgRadicalism * row.size;
      acc.employmentWeighted += row.avgEmployment * row.size;
      acc.migrationWeighted += row.avgMigrationDesire * row.size;
      return acc;
    },
    {
      size: 0,
      sharePermille: 0,
      wealthWeighted: 0,
      loyaltyWeighted: 0,
      radicalismWeighted: 0,
      employmentWeighted: 0,
      migrationWeighted: 0,
    },
  );
  if (totalTail.size <= 0) return head;
  const otherRow: PopulationBreakdownRow = {
    id: "__others__",
    label: options?.otherLabel ?? "Другие",
    color: "#64748b",
    logoUrl: null,
    malePortraitUrl: null,
    femalePortraitUrl: null,
    size: totalTail.size,
    sharePermille: Math.min(1000, totalTail.sharePermille),
    avgWealthX100: Math.round(totalTail.wealthWeighted / totalTail.size),
    avgLoyalty: Math.round(totalTail.loyaltyWeighted / totalTail.size),
    avgRadicalism: Math.round(totalTail.radicalismWeighted / totalTail.size),
    avgEmployment: Math.round(totalTail.employmentWeighted / totalTail.size),
    avgMigrationDesire: Math.round(totalTail.migrationWeighted / totalTail.size),
  };
  return [...head, otherRow];
}

function BreakdownRowMedia({
  row,
  kind,
  size = 18,
}: {
  row: PopulationBreakdownRow;
  kind: BreakdownKey;
  size?: number;
}) {
  const fallbackColor = row.color && /^#[0-9A-Fa-f]{6}$/.test(row.color) ? row.color : "#334155";
  const radius = Math.max(6, Math.round(size / 2));
  if (kind === "races" && (row.malePortraitUrl || row.femalePortraitUrl)) {
    const portraitSize = Math.max(14, Math.round(size * 1.05));
    return (
      <span className="inline-flex shrink-0 items-center gap-1" aria-hidden="true">
        {[row.malePortraitUrl, row.femalePortraitUrl].map((url, idx) => (
          <span
            key={`${row.id}-${idx}`}
            className="inline-flex items-center justify-center overflow-hidden rounded-md border border-white/10 bg-black/20"
            style={{ width: portraitSize, height: portraitSize }}
          >
            {url ? (
              <img src={url} alt="" className="h-full w-full object-contain" />
            ) : (
              <span
                className="inline-flex h-full w-full items-center justify-center text-[9px] font-semibold"
                style={{ backgroundColor: `${fallbackColor}22`, color: fallbackColor }}
              >
                {idx === 0 ? "M" : "F"}
              </span>
            )}
          </span>
        ))}
      </span>
    );
  }
  if (row.logoUrl) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-black/20"
        style={{ width: size, height: size, borderRadius: radius - 2 }}
      >
        <img src={row.logoUrl} alt="" className="h-full w-full object-contain" />
      </span>
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md border border-white/10"
      style={{ width: size, height: size, backgroundColor: `${fallbackColor}22`, color: fallbackColor, borderRadius: radius - 2 }}
      aria-hidden="true"
    >
      <span className="text-[10px] font-semibold leading-none">{row.label.slice(0, 1).toUpperCase()}</span>
    </span>
  );
}

function MetricBarsChart({
  values,
}: {
  values: Array<{ label: string; valuePermille: number; color: string }>;
}) {
  const width = 360;
  const height = 170;
  const margin = { top: 14, right: 10, bottom: 16, left: 78 };
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
    <div className="arc-scrollbar w-full overflow-x-auto overflow-y-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[170px] min-w-[360px] w-full max-w-none">
        <rect x={0.5} y={0.5} width={width - 1} height={height - 1} rx={12} fill={CHART_SURFACE} stroke="rgba(255,255,255,0.06)" />
        <Group left={margin.left} top={margin.top}>
          {values.map((row) => {
            const y = yScale(row.label) ?? 0;
            const h = yScale.bandwidth();
            const w = xScale(Math.max(0, Math.min(1000, row.valuePermille)));
            return (
              <g key={row.label}>
                <text x={-8} y={y + h / 2 + 4} textAnchor="end" fill={CHART_TEXT_DIM} fontSize="10">
                  {row.label}
                </text>
                <rect x={0} y={y} width={innerW} height={h} rx={6} fill={CHART_TRACK} />
                <rect x={0} y={y} width={w} height={h} rx={6} fill={row.color} fillOpacity={0.8} />
                <text
                  x={Math.min(innerW - 4, w + 6)}
                  y={y + h / 2 + 4}
                  fill={CHART_TEXT}
                  fontSize="10"
                >
                  {fmtPercentPermille(row.valuePermille)}
                </text>
              </g>
            );
          })}
        </Group>
      </svg>
    </div>
  );
}

function BreakdownBarsChart({
  rows,
  otherLabel,
  color = "#6ee7b7",
}: {
  rows: PopulationBreakdownRow[];
  otherLabel?: string;
  color?: string;
}) {
  const top = prepareBreakdownChartRows(rows, { otherLabel });
  const width = 420;
  const height = 240;
  const margin = { top: 8, right: 10, bottom: 10, left: 130 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const yScale = scaleBand<string>({
    domain: top.map((r) => r.id),
    range: [0, innerH],
    padding: 0.18,
  });
  const xScale = scaleLinear<number>({ domain: [0, 1000], range: [0, innerW] });

  return (
    <div className="arc-scrollbar w-full overflow-x-auto overflow-y-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[240px] min-w-[420px] w-full max-w-none">
        <rect x={0.5} y={0.5} width={width - 1} height={height - 1} rx={12} fill={CHART_SURFACE} stroke="rgba(255,255,255,0.06)" />
        <Group left={margin.left} top={margin.top}>
          {top.map((row) => {
            const y = yScale(row.id) ?? 0;
            const h = yScale.bandwidth();
            const w = xScale(row.sharePermille);
            return (
              <g key={row.id}>
                <text x={-8} y={y + h / 2 + 4} textAnchor="end" fill={CHART_TEXT_DIM} fontSize="10">
                  {row.label.length > 16 ? `${row.label.slice(0, 16)}…` : row.label}
                </text>
                <rect x={0} y={y} width={innerW} height={h} rx={6} fill={CHART_TRACK} />
                <rect x={0} y={y} width={w} height={h} rx={6} fill={color} fillOpacity={0.8} />
                <text x={innerW + 4} y={y + h / 2 + 4} fill={CHART_TEXT_DIM} fontSize="10">
                  {fmtPercentPermille(row.sharePermille)}
                </text>
              </g>
            );
          })}
        </Group>
      </svg>
    </div>
  );
}

function BreakdownPieChart({
  rows,
  otherLabel,
  selectedId,
  onSelect,
  colors = ["#22d3ee", "#34d399", "#f59e0b", "#fb7185", "#60a5fa", "#a78bfa"],
}: {
  rows: PopulationBreakdownRow[];
  otherLabel?: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  colors?: string[];
}) {
  const top = prepareBreakdownChartRows(rows, { otherLabel }).filter((r) => r.sharePermille > 0);
  const width = 260;
  const height = 240;
  const cx = width / 2;
  const cy = height / 2;
  const outerRadius = 70;
  const innerRadius = 44;

  if (top.length === 0) {
    return <div className="flex h-[240px] items-center justify-center text-xs text-white/50">Нет данных</div>;
  }

  return (
    <div className="arc-scrollbar w-full overflow-x-auto overflow-y-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[240px] min-w-[240px] w-full max-w-none">
        <rect x={0.5} y={0.5} width={width - 1} height={height - 1} rx={12} fill={CHART_SURFACE} stroke="rgba(255,255,255,0.06)" />
        <Group top={cy} left={cx}>
          <Pie<PopulationBreakdownRow>
            data={top}
            pieValue={(d) => d.sharePermille}
            outerRadius={outerRadius}
            innerRadius={innerRadius}
            padAngle={0.02}
          >
            {(pie) =>
              pie.arcs.map((arc, i) => {
                const path = pie.path(arc);
                const centroid = pie.path.centroid(arc);
                const row = arc.data;
                const isSelected = selectedId === row.id;
                const fill = row.color && /^#[0-9A-Fa-f]{6}$/.test(row.color) ? row.color : colors[i % colors.length];
                const angleMid = (arc.startAngle + arc.endAngle) / 2;
                const explode = isSelected ? 6 : 0;
                const tx = Math.cos(angleMid - Math.PI / 2) * explode;
                const ty = Math.sin(angleMid - Math.PI / 2) * explode;
                return (
                  <g
                    key={`${row.id}-${i}`}
                    transform={`translate(${tx}, ${ty})`}
                    className={onSelect ? "cursor-pointer" : undefined}
                    onClick={() => onSelect?.(row.id)}
                  >
                    <path
                      d={path ?? ""}
                      fill={fill}
                      fillOpacity={isSelected ? 0.95 : 0.82}
                      stroke={isSelected ? "rgba(255,255,255,0.9)" : "#0b111b"}
                      strokeWidth={isSelected ? 2 : 1.25}
                    />
                    {arc.endAngle - arc.startAngle > 0.45 && (
                      <text x={centroid[0]} y={centroid[1] + 3} textAnchor="middle" fontSize="9" fill={CHART_TEXT}>
                        {Math.round(row.sharePermille / 10)}%
                      </text>
                    )}
                  </g>
                );
              })
            }
          </Pie>
          <text y={-4} textAnchor="middle" fontSize="10" fill={CHART_TEXT_DIM}>
            Топ {top.length}
          </text>
          <text y={12} textAnchor="middle" fontSize="11" fill={CHART_TEXT}>
            {fmtInt(top.reduce((s, r) => s + r.size, 0))}
          </text>
        </Group>
      </svg>
      <div className="mt-2 grid grid-cols-1 gap-1.5 text-[11px]">
        {top.map((row, i) => {
          const fill = row.color && /^#[0-9A-Fa-f]{6}$/.test(row.color) ? row.color : colors[i % colors.length];
          const isSelected = selectedId === row.id;
          return (
            <button
              key={`legend-${row.id}`}
              type="button"
              onClick={() => onSelect?.(row.id)}
              className={`flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1 text-left transition ${
                isSelected ? "border-arc-accent/30 bg-arc-accent/10 text-white" : "border-white/10 bg-black/15 text-white/75"
              } ${onSelect ? "cursor-pointer" : "cursor-default"}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: fill }} />
                <span className="truncate">{row.label}</span>
              </span>
              <span className="shrink-0 tabular-nums text-white/60">{fmtPercentPermille(row.sharePermille)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PopulationHistoryAreaChart({
  rows,
  color,
}: {
  rows: Array<{ turnId: number; totalPopulation: number }>;
  color: string;
}) {
  const data = rows.slice(-100);
  const width = 520;
  const height = 220;
  const margin = { top: 12, right: 10, bottom: 28, left: 10 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const minTurn = data[0]?.turnId ?? 0;
  const maxTurn = data[data.length - 1]?.turnId ?? 1;
  const maxPopulation = Math.max(1, ...data.map((d) => d.totalPopulation));
  const xScale = scaleLinear<number>({
    domain: [minTurn, Math.max(minTurn + 1, maxTurn)],
    range: [0, innerW],
  });
  const yScale = scaleLinear<number>({
    domain: [0, maxPopulation],
    range: [innerH, 0],
    nice: true,
  });

  if (data.length < 2) {
    return <div className="flex h-[220px] items-center justify-center text-xs text-white/50">Недостаточно ходов для графика</div>;
  }

  return (
    <div className="arc-scrollbar w-full overflow-x-auto overflow-y-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[220px] min-w-[520px] w-full max-w-none">
        <defs>
          <LinearGradient id="pop-growth-fill" from={color} to={color} fromOpacity={0.35} toOpacity={0.02} />
        </defs>
        <rect x={0.5} y={0.5} width={width - 1} height={height - 1} rx={12} fill={CHART_SURFACE} stroke="rgba(255,255,255,0.06)" />
        <Group left={margin.left} top={margin.top}>
          {[0.25, 0.5, 0.75, 1].map((k) => {
            const y = yScale(maxPopulation * k);
            return <line key={k} x1={0} x2={innerW} y1={y} y2={y} stroke={CHART_GRID} strokeWidth={1} />;
          })}
          <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
          <AreaClosed<{ turnId: number; totalPopulation: number }>
            data={data}
            x={(d) => xScale(d.turnId)}
            y={(d) => yScale(d.totalPopulation)}
            yScale={yScale}
            stroke="transparent"
            fill="url(#pop-growth-fill)"
          />
          <LinePath<{ turnId: number; totalPopulation: number }>
            data={data}
            x={(d) => xScale(d.turnId)}
            y={(d) => yScale(d.totalPopulation)}
            stroke={color}
            strokeWidth={2.25}
          />
          {data.map((d, idx) =>
            idx === data.length - 1 ? (
              <circle
                key={d.turnId}
                cx={xScale(d.turnId)}
                cy={yScale(d.totalPopulation)}
                r={3.5}
                fill={color}
                stroke="#0b111b"
                strokeWidth={1.5}
              />
            ) : null,
          )}
          <text x={0} y={innerH + 20} fill="rgba(255,255,255,.5)" fontSize="10">
            Ход {minTurn}
          </text>
          <text x={innerW} y={innerH + 20} textAnchor="end" fill="rgba(255,255,255,.5)" fontSize="10">
            Ход {maxTurn}
          </text>
          <text x={innerW} y={10} textAnchor="end" fill={CHART_TEXT_DIM} fontSize="10">
            {fmtInt(maxPopulation)}
          </text>
        </Group>
      </svg>
    </div>
  );
}

function SummaryCards({
  title,
  summary,
  strataRows,
  historyRows,
}: {
  title: string;
  summary:
    | PopulationWorldSummaryResponse["summary"]
    | PopulationCountrySummaryResponse["summary"];
  strataRows?: PopulationBreakdownRow[];
  historyRows?: Array<{ turnId: number; totalPopulation: number }>;
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
        <div className="arc-scrollbar overflow-x-auto overflow-y-hidden rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Показатели</div>
          <MetricBarsChart
            values={[
              { label: "Лояльность", valuePermille: summary.avgLoyalty, color: "#34d399" },
              { label: "Радикализм", valuePermille: summary.avgRadicalism, color: "#fb7185" },
              { label: "Занятость", valuePermille: 1000 - summary.unemploymentPermille, color: "#22d3ee" },
              { label: "Миграция", valuePermille: summary.avgMigrationDesire, color: "#f59e0b" },
            ]}
          />
        </div>
        <div className="arc-scrollbar overflow-x-auto overflow-y-hidden rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Страты</div>
          {strataRows && strataRows.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
              <BreakdownBarsChart rows={strataRows} color="#22d3ee" otherLabel="Другие страты" />
              <BreakdownPieChart rows={strataRows} otherLabel="Другие страты" />
            </div>
          ) : (
            <div className="flex h-[240px] items-center justify-center text-xs text-white/50">Нет данных</div>
          )}
        </div>
      </div>
      <div className="arc-scrollbar overflow-x-auto overflow-y-hidden rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Рост населения (последние 100 ходов)
        </div>
        {historyRows && historyRows.length > 1 ? (
          <PopulationHistoryAreaChart rows={historyRows} color="#2dd4bf" />
        ) : (
          <div className="flex h-[220px] items-center justify-center text-xs text-white/50">История населения ещё не накоплена</div>
        )}
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
                <div className="border-b border-white/10 px-1 pb-2">
                  <div className="flex items-center gap-5">
                    {[
                      { id: "summary" as const, label: "Сводка", icon: BarChart3 },
                      { id: "structure" as const, label: "Структура", icon: Layers3 },
                    ].map((section) => (
                      (() => {
                        const Icon = section.icon;
                        return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setTab(section.id)}
                      className={`pb-2 text-sm transition ${
                        tab === section.id ? "border-b-2 border-arc-accent text-arc-accent" : "border-b-2 border-transparent text-white/60 hover:text-white"
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Icon size={13} />
                        <span>{section.label}</span>
                      </span>
                    </button>
                        );
                      })()
                  ))}
                  </div>
                  <AnimatePresence initial={false}>
                    {tab === "structure" && category !== "provinces" && (
                      <motion.div
                        key="structure-breakdowns"
                        initial={{ opacity: 0, y: -6, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: "auto" }}
                        exit={{ opacity: 0, y: -4, height: 0 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        className="overflow-hidden"
                      >
                        <div className="mt-2 flex flex-wrap items-center gap-4">
                          {(Object.keys(BREAKDOWN_LABELS) as BreakdownKey[]).map((key) => (
                            (() => {
                              const Icon = BREAKDOWN_ICONS[key];
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() => setBreakdownKey(key)}
                                  className={`inline-flex items-center gap-1.5 pb-1 text-xs transition ${
                                    breakdownKey === key
                                      ? "border-b-2 border-arc-accent text-arc-accent"
                                      : "border-b-2 border-transparent text-white/60 hover:text-white"
                                  }`}
                                >
                                  <Icon size={12} />
                                  <span>{BREAKDOWN_LABELS[key]}</span>
                                </button>
                              );
                            })()
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
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
                </div>

                <div className="min-h-0">
                  {loading || !activeData ? (
                    <div className="flex h-full items-center justify-center rounded-xl border border-white/10 bg-black/20 text-sm text-white/60">
                      Загрузка статистики...
                    </div>
                  ) : tab === "summary" ? (
                    <div className="arc-scrollbar h-full overflow-auto pr-1">
                      <SummaryCards
                        title={category === "country" ? "Моя страна" : "Мир"}
                        summary={activeData.summary}
                        strataRows={activeData.breakdowns?.strata}
                        historyRows={activeData.history}
                      />
                    </div>
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
                                selectedRow?.id === row.id
                                  ? "border-arc-accent/30 bg-arc-accent/10"
                                  : "border-white/10 bg-black/20 hover:border-white/15"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2">
                                  {breakdownKey !== "strata" && <BreakdownRowMedia row={row} kind={breakdownKey} />}
                                  <div className="truncate text-sm text-white">{row.label}</div>
                                </div>
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
                              <div className="flex items-center gap-2">
                                {breakdownKey !== "strata" && <BreakdownRowMedia row={selectedRow} kind={breakdownKey} size={22} />}
                                <div className="text-sm font-semibold text-white">{selectedRow.label}</div>
                              </div>
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
                            <div className="arc-scrollbar overflow-x-auto overflow-y-hidden rounded-xl border border-white/10 bg-[#131a22] p-3">
                              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                Топ {BREAKDOWN_LABELS[breakdownKey]}
                              </div>
                              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
                                <BreakdownBarsChart rows={activeRows} color="#2dd4bf" otherLabel={breakdownOtherLabel(BREAKDOWN_LABELS[breakdownKey])} />
                                <BreakdownPieChart
                                  rows={activeRows}
                                  otherLabel={breakdownOtherLabel(BREAKDOWN_LABELS[breakdownKey])}
                                  selectedId={selectedRow?.id ?? null}
                                  onSelect={setSelectedRowId}
                                />
                              </div>
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
                                <div className="arc-scrollbar overflow-x-auto overflow-y-hidden rounded-xl border border-white/10 bg-[#131a22] p-3">
                                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                    Топ провинций по населению
                                  </div>
                                  <BreakdownBarsChart rows={provinceRows} color="#22d3ee" otherLabel="Другие провинции" />
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
