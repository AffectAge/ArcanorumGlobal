import { Dialog } from "@headlessui/react";
import type { ProvincePopulation, WorldBase } from "@arcanorum/shared";
import * as echarts from "echarts";
import type { EChartsType } from "echarts";
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
type PanelSection = "general" | "finance" | "religions" | "cultures" | "professions" | "ideologies" | "races" | "branding";
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

type PopulationContentKind = "cultures" | "ideologies" | "religions" | "races" | "professions";

type BreakdownRow = {
  id: string;
  label: string;
  pct: number;
  color: string;
  imageUrl: string | null;
};

type FinanceFlowRow = {
  id: string;
  label: string;
  value: number;
  color: string;
};

type ProvinceFinanceRow = {
  provinceId: string;
  provinceName: string;
  population: number;
  treasury: number;
  income: number;
  expenses: number;
  netBalance: number;
  capitalPerCapita: number;
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
  { id: "finance", label: "Финансы населения", icon: BarChart3 },
  { id: "religions", label: "Религии", icon: ScrollText, dimension: "religionPct" },
  { id: "cultures", label: "Культуры", icon: Palette, dimension: "culturePct" },
  { id: "professions", label: "Профессии", icon: Briefcase, dimension: "professionPct" },
  { id: "ideologies", label: "Идеологии", icon: Flame, dimension: "ideologyPct" },
  { id: "races", label: "Расы", icon: UserRound, dimension: "racePct" },
  { id: "branding", label: "Логотип и стиль", icon: Sticker },
];

const KIND_BY_DIMENSION: Record<PopulationDimensionKey, PopulationContentKind> = {
  culturePct: "cultures",
  ideologyPct: "ideologies",
  religionPct: "religions",
  racePct: "races",
  professionPct: "professions",
};

function formatInt(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.max(0, Math.floor(value)));
}

const FALLBACK_COLORS = [
  "#4ade80",
  "#38bdf8",
  "#f59e0b",
  "#f87171",
  "#a78bfa",
  "#22d3ee",
  "#fb7185",
  "#84cc16",
  "#f97316",
  "#60a5fa",
];

const NEGATIVE_BALANCE_STREAK_TARGET = 3;
const LOW_CAPITAL_PER_CAPITA_THRESHOLD = 0.1;

function colorFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length] ?? "#9ca3af";
}

function round3(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(3));
}

function formatSignedInt(value: number): string {
  const rounded = Math.round(value);
  if (rounded > 0) return `+${formatInt(rounded)}`;
  if (rounded < 0) return `-${formatInt(Math.abs(rounded))}`;
  return "0";
}

function resolveScopeProvinceIds(worldBase: WorldBase | null, scope: ViewMode, countryId: string): string[] {
  if (!worldBase) return [];
  const ownerByProvince = worldBase.provinceOwner ?? {};
  const populationByProvince = worldBase.provincePopulationByProvince ?? {};
  return Object.keys(populationByProvince).filter((provinceId) => scope === "world" || ownerByProvince[provinceId] === countryId);
}

function normalizeColor(value: string | null | undefined, id: string): string {
  if (!value) return colorFromId(id);
  const trimmed = value.trim();
  if (trimmed.length === 0) return colorFromId(id);
  return trimmed;
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
  const [selectedByDimension, setSelectedByDimension] = useState<Partial<Record<PopulationDimensionKey, string>>>({});
  const [hoveredByDimension, setHoveredByDimension] = useState<Partial<Record<PopulationDimensionKey, string>>>({});
  const [entryByKindById, setEntryByKindById] = useState<Record<PopulationContentKind, Record<string, ContentEntryMeta>>>({
    cultures: {},
    ideologies: {},
    religions: {},
    races: {},
    professions: {},
  });
  const pieRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const prevTreasuryByModeRef = useRef<Record<ViewMode, number | null>>({ country: null, world: null });
  const treasuryTurnByModeRef = useRef<Record<ViewMode, number>>({ country: 0, world: 0 });
  const negativeStreakByModeRef = useRef<Record<ViewMode, Record<string, number>>>({ country: {}, world: {} });
  const negativeStreakTurnByModeRef = useRef<Record<ViewMode, number>>({ country: 0, world: 0 });
  const [treasuryDeltaByMode, setTreasuryDeltaByMode] = useState<Record<ViewMode, number | null>>({ country: null, world: null });
  const [negativeStreakTick, setNegativeStreakTick] = useState(0);

  const countryStats = useMemo(() => aggregatePopulation(worldBase, "country", countryId), [countryId, worldBase]);
  const worldStats = useMemo(() => aggregatePopulation(worldBase, "world", countryId), [countryId, worldBase]);
  const stats = mode === "country" ? countryStats : worldStats;
  const title = mode === "country" ? `Население: ${countryName}` : "Население мира";
  const subtitle = mode === "country" ? "Статистика по вашим провинциям" : "Сводная статистика по всем провинциям";
  const activeTab = STAT_TABS.find((tab) => tab.id === section) ?? STAT_TABS[0];
  const activeDimension = activeTab.dimension ?? null;
  const scopedProvinceIds = useMemo(() => resolveScopeProvinceIds(worldBase, mode, countryId), [countryId, mode, worldBase]);

  const financeStats = useMemo(() => {
    if (!worldBase) {
      return {
        totalTreasury: 0,
        totalPopulation: 0,
        incomeRows: [
          { id: "wages", label: "Зарплаты от зданий", value: 0, color: "#34d399" },
          { id: "transfers", label: "Соцвыплаты/трансферты", value: 0, color: "#60a5fa" },
          { id: "other-income", label: "Прочие источники", value: 0, color: "#f59e0b" },
        ] satisfies FinanceFlowRow[],
        expenseRows: [
          { id: "goods", label: "Покупка товаров населением", value: 0, color: "#f87171" },
          { id: "taxes", label: "Налоги/сборы", value: 0, color: "#fb7185" },
          { id: "other-expense", label: "Прочие траты", value: 0, color: "#a78bfa" },
        ] satisfies FinanceFlowRow[],
        totalIncome: 0,
        totalExpenses: 0,
        netBalance: 0,
        byProvince: [] as ProvinceFinanceRow[],
      };
    }

    const treasuryByProvince = worldBase.provincePopulationTreasuryByProvince ?? {};
    const populationByProvince = worldBase.provincePopulationByProvince ?? {};
    const buildingsByProvince = worldBase.provinceBuildingsByProvince ?? {};
    const provinceNameById = worldBase.provinceNameById ?? {};

    let totalTreasury = 0;
    let totalPopulation = 0;
    let wagesIncome = 0;
    let transferIncome = 0;
    let otherIncome = 0;
    let goodsExpense = 0;
    let taxesExpense = 0;
    let otherExpense = 0;

    const byProvince: ProvinceFinanceRow[] = [];

    for (const provinceId of scopedProvinceIds) {
      const population = Math.max(0, Number(populationByProvince[provinceId]?.populationTotal ?? 0));
      const treasury = Math.max(0, Number(treasuryByProvince[provinceId] ?? 0));
      const buildingList = buildingsByProvince[provinceId] ?? [];
      const wages = round3(
        buildingList.reduce((sum, instance) => sum + Math.max(0, Number(instance?.lastWagesDucats ?? 0)), 0),
      );
      const income = round3(wages);
      const expenses = round3(0);
      const netBalance = round3(income - expenses);
      const capitalPerCapita = population > 0 ? treasury / population : 0;

      totalTreasury = round3(totalTreasury + treasury);
      totalPopulation += population;
      wagesIncome = round3(wagesIncome + wages);

      byProvince.push({
        provinceId,
        provinceName: provinceNameById[provinceId] ?? provinceId,
        population,
        treasury,
        income,
        expenses,
        netBalance,
        capitalPerCapita,
      });
    }

    const incomeRows: FinanceFlowRow[] = [
      { id: "wages", label: "Зарплаты от зданий", value: wagesIncome, color: "#34d399" },
      { id: "transfers", label: "Соцвыплаты/трансферты", value: transferIncome, color: "#60a5fa" },
      { id: "other-income", label: "Прочие источники", value: otherIncome, color: "#f59e0b" },
    ];
    const expenseRows: FinanceFlowRow[] = [
      { id: "goods", label: "Покупка товаров населением", value: goodsExpense, color: "#f87171" },
      { id: "taxes", label: "Налоги/сборы", value: taxesExpense, color: "#fb7185" },
      { id: "other-expense", label: "Прочие траты", value: otherExpense, color: "#a78bfa" },
    ];
    const totalIncome = round3(incomeRows.reduce((sum, row) => sum + row.value, 0));
    const totalExpenses = round3(expenseRows.reduce((sum, row) => sum + row.value, 0));
    const netBalance = round3(totalIncome - totalExpenses);

    return {
      totalTreasury,
      totalPopulation,
      incomeRows,
      expenseRows,
      totalIncome,
      totalExpenses,
      netBalance,
      byProvince: byProvince.sort((a, b) => b.treasury - a.treasury),
    };
  }, [scopedProvinceIds, worldBase]);

  useEffect(() => {
    if (!open || !worldBase) return;
    const currentTurn = Math.max(1, Number(worldBase.turnId ?? 1));
    if (treasuryTurnByModeRef.current[mode] === currentTurn) return;
    treasuryTurnByModeRef.current[mode] = currentTurn;
    const previous = prevTreasuryByModeRef.current[mode];
    const nextDelta = previous == null ? null : round3(financeStats.totalTreasury - previous);
    prevTreasuryByModeRef.current[mode] = financeStats.totalTreasury;
    setTreasuryDeltaByMode((prev) => ({ ...prev, [mode]: nextDelta }));
  }, [financeStats.totalTreasury, mode, open, worldBase]);

  useEffect(() => {
    if (!open || !worldBase) return;
    const currentTurn = Math.max(1, Number(worldBase.turnId ?? 1));
    if (negativeStreakTurnByModeRef.current[mode] === currentTurn) return;
    negativeStreakTurnByModeRef.current[mode] = currentTurn;
    const prevStreak = negativeStreakByModeRef.current[mode] ?? {};
    const nextStreak: Record<string, number> = { ...prevStreak };
    const activeProvinceIds = new Set(financeStats.byProvince.map((row) => row.provinceId));
    for (const provinceId of Object.keys(nextStreak)) {
      if (!activeProvinceIds.has(provinceId)) {
        delete nextStreak[provinceId];
      }
    }
    for (const row of financeStats.byProvince) {
      if (row.netBalance < 0) {
        nextStreak[row.provinceId] = (nextStreak[row.provinceId] ?? 0) + 1;
      } else {
        nextStreak[row.provinceId] = 0;
      }
    }
    negativeStreakByModeRef.current[mode] = nextStreak;
    setNegativeStreakTick((prev) => prev + 1);
  }, [financeStats.byProvince, mode, open, worldBase]);

  const negativeBalanceAlerts = useMemo(() => {
    const streakByProvince = negativeStreakByModeRef.current[mode] ?? {};
    return financeStats.byProvince
      .map((row) => ({
        ...row,
        streak: streakByProvince[row.provinceId] ?? 0,
      }))
      .filter((row) => row.streak >= NEGATIVE_BALANCE_STREAK_TARGET)
      .sort((a, b) => b.streak - a.streak);
  }, [financeStats.byProvince, mode, negativeStreakTick]);

  const lowCapitalAlerts = useMemo(
    () =>
      financeStats.byProvince
        .filter((row) => row.population > 0 && row.capitalPerCapita < LOW_CAPITAL_PER_CAPITA_THRESHOLD)
        .sort((a, b) => a.capitalPerCapita - b.capitalPerCapita),
    [financeStats.byProvince],
  );

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
          color: normalizeColor(entry?.color, id),
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

  const topCulture = useMemo(() => {
    const [id, pct] = Object.entries(stats.breakdown.culturePct).sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!id || !pct || pct <= 0) return null;
    return {
      label: entryByKindById.cultures[id]?.name ?? id,
      pct,
      count: (stats.totalPopulation * pct) / 100,
    };
  }, [entryByKindById.cultures, stats.breakdown.culturePct, stats.totalPopulation]);

  const topReligion = useMemo(() => {
    const [id, pct] = Object.entries(stats.breakdown.religionPct).sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!id || !pct || pct <= 0) return null;
    return {
      label: entryByKindById.religions[id]?.name ?? id,
      pct,
      count: (stats.totalPopulation * pct) / 100,
    };
  }, [entryByKindById.religions, stats.breakdown.religionPct, stats.totalPopulation]);

  useEffect(() => {
    if (!open) {
      chartRef.current?.dispose();
      chartRef.current = null;
      return;
    }
    if (!activeDimension) return;
    if (!pieRef.current) return;

    const existing = chartRef.current;
    const chart =
      existing && existing.getDom() === pieRef.current
        ? existing
        : (() => {
            existing?.dispose();
            return echarts.init(pieRef.current!);
          })();
    chartRef.current = chart;
    const selectedId = selectedByDimension[activeDimension] ?? activeRows[0]?.id;
    const hoveredId = hoveredByDimension[activeDimension] ?? null;

    chart.off("mouseover");
    chart.off("mouseout");
    chart.off("click");

    chart.on("mouseover", (params: { componentType?: string; dataIndex?: number }) => {
      if (params.componentType !== "series") return;
      if (typeof params.dataIndex !== "number") return;
      const row = activeRows[params.dataIndex];
      if (!row) return;
      setHoveredByDimension((prev) => ({ ...prev, [activeDimension]: row.id }));
    });

    chart.on("mouseout", () => {
      setHoveredByDimension((prev) => ({ ...prev, [activeDimension]: undefined }));
    });

    chart.on("click", (params: { componentType?: string; dataIndex?: number }) => {
      if (params.componentType !== "series") return;
      if (typeof params.dataIndex !== "number") return;
      const row = activeRows[params.dataIndex];
      if (!row) return;
      setSelectedByDimension((prev) => ({ ...prev, [activeDimension]: row.id }));
    });

    chart.setOption({
      animationDuration: 280,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        backgroundColor: "transparent",
        borderWidth: 0,
        padding: 0,
        formatter: (params: { seriesName: string; name: string; value: number; percent: number; color?: string }) => {
          const pieceColor = params.color ?? "#334155";
          const peopleCount = formatInt((stats.totalPopulation * params.value) / 100);
          return `
            <div style="
              background:${pieceColor}dd;
              border:1px solid ${pieceColor};
              color:#f8fafc;
              border-radius:8px;
              padding:8px 10px;
              box-shadow:0 6px 18px rgba(0,0,0,0.35);
              backdrop-filter: blur(4px);
            ">
              <div style="font-weight:700; margin-bottom:2px;">${params.seriesName}</div>
              <div>${params.name}: ${params.value.toFixed(2)}%</div>
              <div style="opacity:0.92;">${peopleCount} чел.</div>
            </div>
          `;
        },
      },
      series: [
        {
          name: activeTab.label,
          type: "pie",
          radius: "48%",
          center: ["50%", "50%"],
          avoidLabelOverlap: true,
          selectedMode: "single",
          label: {
            show: true,
            color: "#e2e8f0",
            position: "outside",
            formatter: "{b}\n{d}%",
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 14,
          },
          labelLine: { show: true, length: 12, length2: 10, smooth: 0.2 },
          data: activeRows.map((row) => ({
            name: row.label,
            value: row.pct,
            selected: row.id === selectedId,
            itemStyle: {
              color: row.color,
              opacity: hoveredId ? (hoveredId === row.id ? 1 : 0.35) : 1,
            },
            label: {
              color: row.color,
            },
            labelLine: {
              lineStyle: {
                color: row.color,
              },
            },
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
    }, { notMerge: true });

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [open, activeDimension, activeRows, activeTab.label, hoveredByDimension, selectedByDimension]);

  useEffect(() => {
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  const renderDimensionStats = (dimension: PopulationDimensionKey) => {
    const dimensionLabel = DIMENSION_LABELS.find((item) => item.key === dimension)?.label ?? "Статистика";
    const selectedId = selectedByDimension[dimension] ?? activeRows[0]?.id ?? null;
    const hoveredId = hoveredByDimension[dimension] ?? null;

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
              <button
                key={row.id}
                type="button"
                onClick={() => setSelectedByDimension((prev) => ({ ...prev, [dimension]: row.id }))}
                onMouseEnter={() => setHoveredByDimension((prev) => ({ ...prev, [dimension]: row.id }))}
                onMouseLeave={() => setHoveredByDimension((prev) => ({ ...prev, [dimension]: undefined }))}
                className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left transition ${
                  selectedId === row.id
                    ? "border-arc-accent/50 bg-arc-accent/10"
                    : hoveredId === row.id
                      ? "border-white/25 bg-white/10"
                      : "border-white/10 bg-black/25 hover:border-white/20"
                }`}
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
              </button>
            ))}
            {activeRows.length === 0 && <div className="text-xs text-white/45">Нет данных</div>}
          </div>
        </section>
      </div>
    );
  };

  const renderFlowRows = (rows: FinanceFlowRow[]) => {
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    return (
      <div className="space-y-2.5">
        {rows.map((row) => {
          const pct = total > 0 ? Math.max(0, Math.min(100, (row.value / total) * 100)) : 0;
          return (
            <div key={row.id} className="rounded-lg border border-white/10 bg-black/25 p-2.5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-white/80">{row.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-white/90">{formatInt(row.value)} дукат</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: row.color,
                  }}
                />
              </div>
              <div className="mt-1 text-[11px] tabular-nums text-white/55">{pct.toFixed(2)}%</div>
            </div>
          );
        })}
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
                  <div className="mb-4 grid gap-3 md:grid-cols-3">
                    <section className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                      <div className="text-[11px] uppercase tracking-wide text-white/50">Всего населения</div>
                      <div className="mt-1 text-lg font-semibold text-white">{formatInt(stats.totalPopulation)}</div>
                    </section>
                    <section className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                      <div className="text-[11px] uppercase tracking-wide text-white/50">Крупнейшая культура</div>
                      <div className="mt-1 truncate text-sm font-semibold text-white">{topCulture?.label ?? "Нет данных"}</div>
                      <div className="text-[11px] text-white/60">
                        {topCulture ? `${topCulture.pct.toFixed(2)}% · ${formatInt(topCulture.count)} чел.` : "—"}
                      </div>
                    </section>
                    <section className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                      <div className="text-[11px] uppercase tracking-wide text-white/50">Доминирующая религия</div>
                      <div className="mt-1 truncate text-sm font-semibold text-white">{topReligion?.label ?? "Нет данных"}</div>
                      <div className="text-[11px] text-white/60">
                        {topReligion ? `${topReligion.pct.toFixed(2)}% · ${formatInt(topReligion.count)} чел.` : "—"}
                      </div>
                    </section>
                  </div>

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

                  {section === "finance" && (
                    <div className="space-y-4">
                      <div>
                        <div className="text-lg font-semibold text-white">Финансы населения</div>
                        <div className="text-xs text-white/50">Казна населения, доходы/расходы за ход и сигналы по рискам</div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                        <section className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                          <div className="text-[11px] uppercase tracking-wide text-white/50">Общий капитал населения</div>
                          <div className="mt-1 text-lg font-semibold text-white">{formatInt(financeStats.totalTreasury)} дукат</div>
                        </section>
                        <section className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                          <div className="text-[11px] uppercase tracking-wide text-white/50">Изменение за последний ход</div>
                          <div
                            className={`mt-1 text-lg font-semibold ${
                              (treasuryDeltaByMode[mode] ?? 0) > 0
                                ? "text-emerald-300"
                                : (treasuryDeltaByMode[mode] ?? 0) < 0
                                  ? "text-rose-300"
                                  : "text-white"
                            }`}
                          >
                            {treasuryDeltaByMode[mode] == null ? "—" : `${formatSignedInt(treasuryDeltaByMode[mode] ?? 0)} дукат`}
                          </div>
                        </section>
                        <section className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                          <div className="text-[11px] uppercase tracking-wide text-white/50">Доходы населения за ход</div>
                          <div className="mt-1 text-lg font-semibold text-emerald-300">+{formatInt(financeStats.totalIncome)} дукат</div>
                        </section>
                        <section className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                          <div className="text-[11px] uppercase tracking-wide text-white/50">Расходы населения за ход</div>
                          <div className="mt-1 text-lg font-semibold text-rose-300">-{formatInt(financeStats.totalExpenses)} дукат</div>
                        </section>
                        <section className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                          <div className="text-[11px] uppercase tracking-wide text-white/50">Чистый баланс</div>
                          <div className={`mt-1 text-lg font-semibold ${financeStats.netBalance >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                            {formatSignedInt(financeStats.netBalance)} дукат
                          </div>
                        </section>
                      </div>

                      <div className="grid gap-3 lg:grid-cols-2">
                        <section className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Структура доходов</div>
                          {renderFlowRows(financeStats.incomeRows)}
                        </section>
                        <section className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Структура расходов</div>
                          {renderFlowRows(financeStats.expenseRows)}
                        </section>
                      </div>

                      <section className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Сигналы (алерты)</div>
                        <div className="space-y-2">
                          {negativeBalanceAlerts.length > 0 ? (
                            negativeBalanceAlerts.map((row) => (
                              <div key={`neg-${row.provinceId}`} className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                                {row.provinceName}: отрицательный баланс {row.streak} ход. подряд ({formatSignedInt(row.netBalance)} дукат/ход)
                              </div>
                            ))
                          ) : (
                            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70">
                              Нет провинций с отрицательным балансом {NEGATIVE_BALANCE_STREAK_TARGET} ход. подряд
                            </div>
                          )}
                          {lowCapitalAlerts.length > 0 ? (
                            lowCapitalAlerts.map((row) => (
                              <div key={`low-${row.provinceId}`} className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                                {row.provinceName}: низкий капитал на душу ({row.capitalPerCapita.toFixed(3)} дукат/чел.)
                              </div>
                            ))
                          ) : (
                            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70">
                              Нет провинций с критично низким капиталом на душу
                            </div>
                          )}
                        </div>
                      </section>
                    </div>
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
