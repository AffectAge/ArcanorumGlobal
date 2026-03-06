import { Dialog } from "@headlessui/react";
import * as echarts from "echarts";
import type { EChartsType } from "echarts";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowDownUp, BarChart3, Globe2, LineChart, Settings2, SlidersHorizontal, TrendingDown, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  fetchCountries,
  fetchContentEntries,
  fetchCountryMarketInvites,
  fetchMarketsCatalog,
  fetchMarketOverview,
  joinMarket,
  leaveMarket,
  type MarketCatalogItem,
  respondMarketInvite,
  type MarketInvite,
  type MarketOverviewResponse,
} from "../lib/api";
import { CustomSelect } from "./CustomSelect";
import { CurrentMarketMembershipModal } from "./CurrentMarketMembershipModal";
import { MarketAlertsModal } from "./MarketAlertsModal";
import { MarketInfrastructureModal } from "./MarketInfrastructureModal";
import { MarketManagementModal } from "./MarketManagementModal";
import { Tooltip } from "./Tooltip";

type Props = {
  open: boolean;
  onClose: () => void;
  token: string;
  countryId: string;
  countryName: string;
  mode?: "both" | "country" | "global";
  title?: string;
};

type ViewTab = "country" | "global";
type SortMode = "deficit" | "price" | "volatility";
type QuickFilter = "all" | "critical";

const formatNumber = (value: number) => new Intl.NumberFormat("ru-RU").format(Math.max(0, Math.floor(value)));
const formatCompact = (value: number): string => {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const units = [
    { n: 1_000_000_000_000, s: "T" },
    { n: 1_000_000_000, s: "B" },
    { n: 1_000_000, s: "M" },
    { n: 1_000, s: "K" },
  ] as const;
  for (const unit of units) {
    if (abs >= unit.n) {
      const scaled = abs / unit.n;
      const text =
        scaled >= 100
          ? Math.floor(scaled).toString()
          : scaled >= 10
            ? scaled.toFixed(1).replace(/\.0$/, "")
            : scaled.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
      return `${sign}${text}${unit.s}`;
    }
  }
  return `${sign}${Math.floor(abs)}`;
};

const MARKET_METRIC_WINDOW_TURNS = 10;

const toCoveragePct = (demand: number, offer: number): number => {
  const safeDemand = Math.max(0, Number(demand));
  const safeOffer = Math.max(0, Number(offer));
  if (safeDemand <= 0) return 100;
  return Math.max(0, (safeOffer / safeDemand) * 100);
};

const buildCoverageHistory = (demandHistory: number[], offerHistory: number[]): number[] => {
  const length = Math.max(demandHistory.length, offerHistory.length);
  const result: number[] = [];
  for (let i = 0; i < length; i += 1) {
    const demand = Number(demandHistory[i] ?? 0);
    const offer = Number(offerHistory[i] ?? 0);
    result.push(toCoveragePct(demand, offer));
  }
  return result;
};

const getLastDelta = (history: number[]): number => {
  if (history.length < 2) return 0;
  return Number(history[history.length - 1] ?? 0) - Number(history[history.length - 2] ?? 0);
};

const getRelativeDeltaPct = (history: number[]): number => {
  if (history.length < 2) return 0;
  const prev = Number(history[history.length - 2] ?? 0);
  const curr = Number(history[history.length - 1] ?? 0);
  if (!Number.isFinite(prev) || Math.abs(prev) < 1e-9) return 0;
  return ((curr - prev) / prev) * 100;
};

const PARTNER_COLORS = [
  "#22d3ee",
  "#34d399",
  "#60a5fa",
  "#f59e0b",
  "#f472b6",
  "#a78bfa",
  "#fb7185",
  "#84cc16",
  "#f97316",
  "#38bdf8",
  "#facc15",
  "#4ade80",
];

const colorByPartnerName = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PARTNER_COLORS[hash % PARTNER_COLORS.length] ?? "#94a3b8";
};

const buildTop10WithOthers = (input: Record<string, number>, labelByCountryId: Record<string, string>) => {
  const rows = Object.entries(input)
    .map(([countryId, value]) => ({ countryId, value: Math.max(0, Number(value)) }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
  const top = rows.slice(0, 10).map((row) => ({
    name: labelByCountryId[row.countryId] ?? row.countryId,
    value: row.value,
  }));
  const others = rows.slice(10).reduce((sum, row) => sum + row.value, 0);
  if (others > 0) top.push({ name: "Другие", value: others });
  return top;
};

function TradePartnersChart({
  items,
  color,
}: {
  items: Array<{ name: string; value: number }>;
  color: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const existing = chartRef.current;
    const chart =
      existing && existing.getDom() === ref.current
        ? existing
        : (() => {
            existing?.dispose();
            return echarts.init(ref.current!);
          })();
    chartRef.current = chart;
    const data = items.slice(0, 11);
    chart.setOption({
      animationDuration: 350,
      backgroundColor: "transparent",
      legend: {
        type: "scroll",
        orient: "vertical",
        right: 2,
        top: 8,
        bottom: 8,
        textStyle: {
          color: "rgba(226,232,240,0.78)",
          fontSize: 10,
          fontWeight: 600,
        },
      },
      tooltip: {
        trigger: "item",
        confine: true,
        backgroundColor: "#000",
        borderColor: "rgba(148,163,184,0.35)",
        borderWidth: 1,
        textStyle: { color: "#e2e8f0", fontSize: 11, fontWeight: 600 },
        formatter: (params: { name: string; value: number; percent: number }) =>
          `${params.name}: ${formatCompact(Number(params.value ?? 0))} (${Number(params.percent ?? 0).toFixed(1)}%)`,
      },
      series: [
        {
          type: "pie",
          radius: ["38%", "68%"],
          center: ["34%", "50%"],
          avoidLabelOverlap: true,
          selectedMode: false,
          label: {
            show: false,
          },
          labelLine: {
            show: false,
          },
          data: data.map((item, idx) => ({
            name: item.name,
            value: item.value,
            itemStyle: {
              color: idx === data.length - 1 && item.name === "Другие" ? "rgba(148,163,184,0.55)" : colorByPartnerName(item.name),
              opacity: idx === data.length - 1 && item.name === "Другие" ? 0.9 : 1,
            },
          })),
          itemStyle: {
            borderColor: "rgba(0,0,0,0.35)",
            borderWidth: 1,
          },
          emphasis: {
            scale: true,
            scaleSize: 5,
          },
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [items, color]);

  useEffect(() => {
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return <div ref={ref} className="h-[240px] w-full rounded bg-black/20" />;
}

function Sparkline({
  chartId,
  values,
  stroke,
  targetLine,
  currentTurnId,
  syncedTurnId,
  activeTooltipChartId,
  onSyncTurnChange,
  renderSharedTooltipHtml,
  tooltipEnabled = true,
}: {
  chartId: string;
  values: number[];
  stroke: string;
  targetLine?: number;
  currentTurnId?: number;
  syncedTurnId?: number | null;
  activeTooltipChartId?: string | null;
  onSyncTurnChange?: (turnId: number | null, chartId: string | null) => void;
  renderSharedTooltipHtml?: (turnId: number) => string;
  tooltipEnabled?: boolean;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<EChartsType | null>(null);
  const trimmed = values.slice(-MARKET_METRIC_WINDOW_TURNS);
  const min = trimmed.length > 0 ? Math.min(...trimmed) : 0;
  const max = trimmed.length > 0 ? Math.max(...trimmed) : 0;

  useEffect(() => {
    if (!chartRef.current) return;
    const existing = instanceRef.current;
    const chart =
      existing && existing.getDom() === chartRef.current
        ? existing
        : (() => {
            existing?.dispose();
            return echarts.init(chartRef.current!);
          })();
    instanceRef.current = chart;

    const data = trimmed.length > 0 ? trimmed : [0];
    chart.setOption({
      animation: true,
      animationDuration: 500,
      animationEasing: "cubicOut",
      grid: { left: 0, right: 0, top: 0, bottom: 0, containLabel: false },
      xAxis: {
        type: "category",
        show: false,
        boundaryGap: false,
        data: data.map((_, idx) => idx),
      },
      yAxis: {
        type: "value",
        show: false,
        min: "dataMin",
        max: "dataMax",
      },
      tooltip: {
        show: tooltipEnabled,
        trigger: "axis",
        confine: true,
        backgroundColor: "transparent",
        borderWidth: 0,
        padding: 0,
        axisPointer: {
          type: "line",
          lineStyle: {
            color: "rgba(148,163,184,0.55)",
            width: 1,
          },
        },
        formatter: (params: Array<{ dataIndex?: number; value?: number }>) => {
          const p = params?.[0];
          const idx = Number(p?.dataIndex ?? 0);
          const value = Number(p?.value ?? 0);
          const startTurn = typeof currentTurnId === "number" ? Math.max(1, currentTurnId - data.length + 1) : null;
          const turn = startTurn != null ? startTurn + idx : null;
          const turnLabel = turn != null ? `Ход ${turn}` : `Точка ${idx + 1}`;
          const shared = turn != null ? renderSharedTooltipHtml?.(turn) : "";
          return `
            <div style="
              background:#000;
              border:1px solid rgba(148,163,184,0.35);
              color:#e2e8f0;
              border-radius:8px;
              padding:6px 8px;
              box-shadow:0 8px 20px rgba(0,0,0,0.35);
              font-size:11px;
              font-weight:600;
            ">
              <div style="opacity:0.8;margin-bottom:2px;">${turnLabel}</div>
              ${shared || `<div>${formatCompact(value)}</div>`}
            </div>
          `;
        },
      },
      series: [
        {
          type: "bar",
          data,
          barMaxWidth: 6,
          itemStyle: {
            color: `${stroke}33`,
            borderRadius: [2, 2, 0, 0],
          },
          label: {
            show: false,
            position: "top",
            color: "rgba(226,232,240,0.6)",
            fontSize: 8,
            fontWeight: 700,
            formatter: (params: { value: number }) => formatCompact(Number(params.value ?? 0)),
          },
          emphasis: {
            focus: "series",
            label: {
              show: true,
              position: "top",
              color: "rgba(226,232,240,0.92)",
              fontSize: 9,
              fontWeight: 700,
              formatter: (params: { value: number }) => formatCompact(Number(params.value ?? 0)),
            },
          },
          z: 1,
        },
        {
          type: "line",
          data,
          smooth: true,
          symbol: "none",
          lineStyle: {
            color: stroke,
            width: 2,
          },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: `${stroke}24` },
              { offset: 1, color: `${stroke}00` },
            ]),
          },
          markLine:
            typeof targetLine === "number"
              ? {
                  symbol: "none",
                  silent: true,
                  label: { show: false },
                  lineStyle: {
                    color: "rgba(226,232,240,0.45)",
                    type: "dashed",
                    width: 1,
                  },
                  data: [{ yAxis: targetLine }],
                }
              : undefined,
          z: 3,
        },
      ],
    });

    const startTurn = typeof currentTurnId === "number" ? Math.max(1, currentTurnId - data.length + 1) : null;
    const handleAxisPointer = (event: unknown) => {
      const maybe = event as { axesInfo?: Array<{ value?: number | string }> } | undefined;
      const axisValue = Number(maybe?.axesInfo?.[0]?.value);
      if (!Number.isFinite(axisValue) || axisValue < 0) return;
      if (startTurn == null) return;
      const turn = startTurn + Math.floor(axisValue);
      onSyncTurnChange?.(turn, chartId);
    };
    const handleGlobalOut = () => {
      onSyncTurnChange?.(null, null);
    };
    chart.on("updateAxisPointer", handleAxisPointer);
    chart.getZr().on("globalout", handleGlobalOut);

    const onResize = () => {
      chart.resize();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.off("updateAxisPointer", handleAxisPointer);
      chart.getZr().off("globalout", handleGlobalOut);
    };
  }, [trimmed, stroke, targetLine, currentTurnId, onSyncTurnChange, renderSharedTooltipHtml, tooltipEnabled, activeTooltipChartId, chartId]);

  useEffect(() => {
    const chart = instanceRef.current;
    if (!chart) return;
    const dataLength = trimmed.length > 0 ? trimmed.length : 1;
    const startTurn = typeof currentTurnId === "number" ? Math.max(1, currentTurnId - dataLength + 1) : null;
    if (syncedTurnId == null || startTurn == null) {
      chart.dispatchAction({ type: "hideTip" });
      return;
    }
    if (activeTooltipChartId !== chartId) {
      chart.dispatchAction({ type: "hideTip" });
      return;
    }
    const idx = syncedTurnId - startTurn;
    if (idx < 0 || idx >= dataLength) {
      chart.dispatchAction({ type: "hideTip" });
      return;
    }
    chart.dispatchAction({
      type: "showTip",
      seriesIndex: 1,
      dataIndex: idx,
    });
  }, [syncedTurnId, currentTurnId, trimmed, activeTooltipChartId, chartId]);

  useEffect(() => {
    return () => {
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
  }, []);

  return (
    <div className="flex items-stretch gap-2">
      <div className="flex h-[50px] w-10 flex-col justify-between text-right text-[9px] leading-none text-white/45">
        <span>{formatCompact(max)}</span>
        <span>{formatCompact(min)}</span>
      </div>
      <div ref={chartRef} className="h-[50px] w-full rounded bg-black/20" />
    </div>
  );
}

export function MarketModal({ open, onClose, token, countryId, countryName, mode = "both", title = "Рынок" }: Props) {
  const [overview, setOverview] = useState<MarketOverviewResponse | null>(null);
  const [incomingInvites, setIncomingInvites] = useState<MarketInvite[]>([]);
  const [marketsCatalog, setMarketsCatalog] = useState<MarketCatalogItem[]>([]);
  const [tab, setTab] = useState<ViewTab>("country");
  const [sortMode, setSortMode] = useState<SortMode>("deficit");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [pendingInviteActionId, setPendingInviteActionId] = useState<string | null>(null);
  const [managementOpen, setManagementOpen] = useState(false);
  const [membershipOpen, setMembershipOpen] = useState(false);
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [pendingJoin, setPendingJoin] = useState(false);
  const [pendingLeave, setPendingLeave] = useState(false);
  const [selectedGoodId, setSelectedGoodId] = useState("");
  const [syncedTurnId, setSyncedTurnId] = useState<number | null>(null);
  const [activeTooltipChartId, setActiveTooltipChartId] = useState<string | null>(null);
  const [countryNameById, setCountryNameById] = useState<Record<string, string>>({});
  const [infrastructureCategoryNamesById, setInfrastructureCategoryNamesById] = useState<Record<string, string>>({});
  const [infrastructureModalOpen, setInfrastructureModalOpen] = useState(false);
  const [alertsModalOpen, setAlertsModalOpen] = useState(false);

  const effectiveTab: ViewTab = mode === "global" ? "global" : mode === "country" ? "country" : tab;

  const load = async () => {
    const nextOverview = await fetchMarketOverview(token);
    setOverview(nextOverview);
    if (mode !== "global") {
      const [invites, markets] = await Promise.all([fetchCountryMarketInvites(token), fetchMarketsCatalog(token)]);
      setIncomingInvites(invites.invites ?? []);
      setMarketsCatalog(markets.markets ?? []);
    }
    const countries = await fetchCountries();
    setCountryNameById(Object.fromEntries(countries.map((country) => [country.id, country.name] as const)));
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch {
        if (!cancelled) {
          setOverview(null);
          setIncomingInvites([]);
          setMarketsCatalog([]);
          setCountryNameById({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, token, mode]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchContentEntries("resourceCategories")
      .then((items) => {
        if (cancelled) return;
        setInfrastructureCategoryNamesById(Object.fromEntries(items.map((item) => [item.id, item.name] as const)));
      })
      .catch(() => {
        if (cancelled) return;
        setInfrastructureCategoryNamesById({});
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const rows = useMemo(() => {
    const source = overview?.goods ?? [];
    const mapped = source.map((item) => {
      const price = effectiveTab === "country" ? item.countryPrice : item.globalPrice;
      const demand = effectiveTab === "country" ? item.countryDemand : item.globalDemand;
      const offer = effectiveTab === "country" ? item.countryOffer : item.globalOffer;
      const coverage = effectiveTab === "country" ? item.countryCoveragePct : item.globalCoveragePct;
      const deficit = Math.max(0, demand - offer);
      const volatility = Math.abs(item.countryPrice - item.globalPrice);
      return {
        ...item,
        price,
        demand,
        offer,
        coverage,
        deficit,
        volatility,
      };
    });
    const filtered = quickFilter === "critical" ? mapped.filter((row) => row.coverage < 50) : mapped;
    return [...filtered].sort((a, b) => {
      if (sortMode === "price") return b.price - a.price || a.goodName.localeCompare(b.goodName, "ru");
      if (sortMode === "volatility") return b.volatility - a.volatility || a.goodName.localeCompare(b.goodName, "ru");
      return b.deficit - a.deficit || a.goodName.localeCompare(b.goodName, "ru");
    });
  }, [overview?.goods, quickFilter, sortMode, effectiveTab]);

  const infraRows = useMemo(
    () =>
      Object.entries(overview?.infraByProvince ?? {})
        .map(([provinceId, infra]) => ({ provinceId, ...infra }))
        .sort((a, b) => a.coverage - b.coverage || a.provinceId.localeCompare(b.provinceId, "ru")),
    [overview?.infraByProvince],
  );
  const sharedInfraRows = useMemo(
    () =>
      [...(overview?.sharedInfrastructureByMarket ?? [])].sort(
        (a, b) => a.available - b.available || a.marketName.localeCompare(b.marketName, "ru"),
      ),
    [overview?.sharedInfrastructureByMarket],
  );
  const marketNameById = useMemo(
    () => Object.fromEntries((overview?.sharedInfrastructureByMarket ?? []).map((row) => [row.marketId, row.marketName] as const)),
    [overview?.sharedInfrastructureByMarket],
  );

  const criticalCount = useMemo(() => rows.filter((row) => row.coverage < 50).length, [rows]);
  const infraOverloadCount = useMemo(() => infraRows.filter((row) => row.coverage < 1).length, [infraRows]);
  const selectedRow = useMemo(() => rows.find((row) => row.goodId === selectedGoodId) ?? rows[0] ?? null, [rows, selectedGoodId]);
  const tradePartners = useMemo(() => {
    if (!selectedRow) {
      return { imports: [] as Array<{ name: string; value: number }>, exports: [] as Array<{ name: string; value: number }> };
    }
    const bucket = overview?.tradeByGood?.[selectedRow.goodId] ?? {};
    const importsRaw = effectiveTab === "country" ? bucket.countryImportsByCountry ?? {} : bucket.globalImportsByMarket ?? {};
    const exportsRaw = effectiveTab === "country" ? bucket.countryExportsByCountry ?? {} : bucket.globalExportsByMarket ?? {};
    const labelMap = effectiveTab === "country" ? countryNameById : marketNameById;
    return {
      imports: buildTop10WithOthers(importsRaw, labelMap),
      exports: buildTop10WithOthers(exportsRaw, labelMap),
    };
  }, [selectedRow, overview?.tradeByGood, effectiveTab, countryNameById, marketNameById]);

  useEffect(() => {
    if (!rows.some((row) => row.goodId === selectedGoodId)) {
      setSelectedGoodId(rows[0]?.goodId ?? "");
    }
  }, [rows, selectedGoodId]);

  useEffect(() => {
    setSyncedTurnId(null);
    setActiveTooltipChartId(null);
  }, [selectedGoodId, effectiveTab]);

  const handleInviteAction = async (inviteId: string, action: "accept" | "reject") => {
    try {
      setPendingInviteActionId(inviteId);
      await respondMarketInvite(token, inviteId, action);
      await load();
      toast.success(action === "accept" ? "Приглашение принято" : "Приглашение отклонено");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обработать приглашение");
    } finally {
      setPendingInviteActionId(null);
    }
  };

  const handleJoinMarket = async () => {
    const marketId = selectedMarketId.trim();
    if (!marketId) return;
    try {
      setPendingJoin(true);
      const result = await joinMarket(token, marketId);
      if (result.mode === "joined") {
        toast.success("Вы вступили в рынок");
      } else {
        toast.success("Запрос на вступление отправлен");
      }
      setSelectedMarketId("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось вступить в рынок");
    } finally {
      setPendingJoin(false);
    }
  };

  const handleLeaveCurrentMarket = async () => {
    const marketId = overview?.marketId;
    if (!marketId) return;
    const current = marketsCatalog.find((market) => market.id === marketId);
    if (!current || !current.isMember) return;
    try {
      setPendingLeave(true);
      await leaveMarket(token, marketId);
      toast.success("Вы вышли из рынка");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось выйти из рынка");
    } finally {
      setPendingLeave(false);
    }
  };

  const selectableMarkets = useMemo(
    () => marketsCatalog.filter((market) => !market.isMember),
    [marketsCatalog],
  );

  useEffect(() => {
    if (!selectableMarkets.some((market) => market.id === selectedMarketId)) {
      setSelectedMarketId(selectableMarkets[0]?.id ?? "");
    }
  }, [selectableMarkets, selectedMarketId]);

  const selectedMarket = useMemo(
    () => selectableMarkets.find((market) => market.id === selectedMarketId) ?? null,
    [selectableMarkets, selectedMarketId],
  );
  const currentMarket = useMemo(
    () => marketsCatalog.find((market) => market.id === overview?.marketId && market.isMember) ?? null,
    [marketsCatalog, overview?.marketId],
  );

  if (!open) return null;

  return (
    <>
      <Dialog open={open} onClose={onClose} className="fixed inset-0 z-[170]">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        <div className="fixed inset-0 p-4 md:p-6">
          <Dialog.Panel
            as={motion.div}
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            className="panel-border flex h-full w-full flex-col overflow-hidden rounded-2xl bg-[#0b111b] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/10 bg-[#0e1523] px-6 py-4">
              <div>
                <Tooltip content="Сводка цен, спроса, предложения, инфраструктуры и алертов по рынкам.">
                  <h2 className="text-lg font-semibold text-white">{title}</h2>
                </Tooltip>
                <Tooltip content="Текущий источник данных: ваш рынок или общий мировой рынок.">
                  <p className="text-xs text-white/60">
                    {effectiveTab === "country" ? `Наш рынок (${countryName})` : "Глобальный рынок"}
                  </p>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                {mode !== "global" && overview?.marketId && (
                  <button
                    type="button"
                    onClick={() => setManagementOpen(true)}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-arc-accent/35 bg-arc-accent/15 px-3 text-xs font-semibold text-arc-accent"
                  >
                    <Settings2 size={13} /> Управление
                  </button>
                )}
                {mode !== "global" && currentMarket && (
                  <button
                    type="button"
                    onClick={() => setMembershipOpen(true)}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-400/35 bg-amber-500/15 px-3 text-xs font-semibold text-amber-200"
                  >
                    <Settings2 size={13} /> Членство
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setInfrastructureModalOpen(true)}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-3 text-xs font-semibold text-cyan-200"
                >
                  <Globe2 size={13} /> Инфраструктура
                </button>
                <button
                  type="button"
                  onClick={() => setAlertsModalOpen(true)}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-400/35 bg-red-500/15 px-3 text-xs font-semibold text-red-200"
                >
                  <AlertTriangle size={13} /> Алерты
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/35 text-white/70 transition hover:border-arc-accent/45 hover:text-arc-accent"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="border-b border-white/10 bg-black/20 px-6 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {mode === "both" && (
                  <>
                    <button
                      type="button"
                      onClick={() => setTab("country")}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                        effectiveTab === "country"
                          ? "border-emerald-400/45 bg-emerald-500/15 text-emerald-200"
                          : "border-white/10 bg-black/35 text-white/65 hover:border-emerald-400/35"
                      }`}
                    >
                      Наш рынок
                    </button>
                    <button
                      type="button"
                      onClick={() => setTab("global")}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                        effectiveTab === "global"
                          ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-200"
                          : "border-white/10 bg-black/35 text-white/65 hover:border-cyan-400/35"
                      }`}
                    >
                      Глобальный
                    </button>
                  </>
                )}

                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setQuickFilter("all")}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                      quickFilter === "all"
                        ? "border-white/20 bg-white/10 text-white"
                        : "border-white/10 bg-black/35 text-white/70"
                    }`}
                  >
                    Все
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuickFilter("critical")}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                      quickFilter === "critical"
                        ? "border-red-400/45 bg-red-500/15 text-red-200"
                        : "border-white/10 bg-black/35 text-white/70"
                    }`}
                  >
                    Критические
                  </button>
                  <div className="h-6 w-px bg-white/10" />
                  <div className="w-[210px]">
                    <CustomSelect
                      value={sortMode}
                      onChange={(value) => setSortMode(value as SortMode)}
                      options={[
                        { value: "deficit", label: "Сортировка: Дефицит" },
                        { value: "price", label: "Сортировка: Цена" },
                        { value: "volatility", label: "Сортировка: Волатильность" },
                      ]}
                      buttonClassName="h-8 text-xs"
                    />
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 bg-red-500/10 px-2.5 py-1 text-xs text-red-200">
                  <Tooltip content="Количество товаров с покрытием спроса ниже 50%.">
                    <span className="inline-flex items-center gap-1.5">
                      <AlertTriangle size={13} /> {criticalCount}
                    </span>
                  </Tooltip>
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
                  <Tooltip content="Количество провинций с перегрузом инфраструктуры (покрытие ниже 100%).">
                    <span className="inline-flex items-center gap-1.5">
                      <SlidersHorizontal size={13} /> {infraOverloadCount}
                    </span>
                  </Tooltip>
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200">
                  <Tooltip content="Количество товаров в текущей выборке таблицы.">
                    <span className="inline-flex items-center gap-1.5">
                      <ArrowDownUp size={13} /> {rows.length}
                    </span>
                  </Tooltip>
                </span>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 xl:grid-cols-[1.45fr_1fr]">
              <div className="panel-border arc-scrollbar min-h-0 overflow-auto rounded-xl bg-black/25">
                <div className="border-b border-white/10 bg-black/35 px-3 py-2 text-xs font-semibold text-white/70">
                  <Tooltip content="Товар из каталога контента.">
                    <div>Товар</div>
                  </Tooltip>
                </div>
                <div className="space-y-1 p-2">
                  {rows.map((row) => (
                    <div
                      key={row.goodId}
                      onClick={() => setSelectedGoodId(row.goodId)}
                      className={`flex items-center rounded-lg border px-3 py-2 text-sm ${
                        row.coverage < 50
                          ? "border-red-400/35 bg-red-500/10"
                          : row.goodId === selectedGoodId
                            ? "border-arc-accent/40 bg-arc-accent/10"
                            : "border-white/10 bg-black/25"
                      }`}
                    >
                      <div className="flex items-center gap-2 text-white/85">
                        {row.coverage < 50 ? <TrendingDown size={14} className="text-red-300" /> : <LineChart size={14} className="text-emerald-300" />}
                        <span className="truncate">{row.goodName}</span>
                      </div>
                    </div>
                  ))}
                  {rows.length === 0 && (
                    <div className="rounded-lg border border-dashed border-white/15 bg-black/15 p-4 text-sm text-white/50">
                      Нет данных по выбранным фильтрам.
                    </div>
                  )}
                </div>
              </div>

              <div className="grid min-h-0 grid-cols-1 gap-3 pr-1 2xl:grid-cols-2">
                <div className="panel-border arc-scrollbar h-full min-h-0 overflow-auto rounded-xl bg-black/30 p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-white/70">
                      <BarChart3 size={13} className="text-arc-accent" />
                      Торговые партнеры
                    </div>
                    {selectedRow ? (
                      <div className="space-y-3 text-xs">
                        <div className="rounded-lg border border-white/10 bg-black/25 p-2">
                          <div className="mb-1 font-semibold text-emerald-200">
                            {effectiveTab === "country" ? "Импорт из стран (топ 10)" : "Импорт из рынков (топ 10)"}
                          </div>
                          <TradePartnersChart items={tradePartners.imports} color="#34d399" />
                        </div>
                        <div className="rounded-lg border border-white/10 bg-black/25 p-2">
                          <div className="mb-1 font-semibold text-cyan-200">
                            {effectiveTab === "country" ? "Экспорт в страны (топ 10)" : "Экспорт в рынки (топ 10)"}
                          </div>
                          <TradePartnersChart items={tradePartners.exports} color="#22d3ee" />
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-white/45">Выберите товар в таблице.</div>
                    )}
                  </div>

                <div className="panel-border arc-scrollbar h-full min-h-0 overflow-auto rounded-xl bg-black/30 p-3">
                  <Tooltip content="Исторические ряды по выбранному товару за последние ходы.">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-white/70">
                      <LineChart size={13} className="text-cyan-300" />
                      История товара
                    </div>
                  </Tooltip>
                  {selectedRow ? (
                    <div className="space-y-2 text-xs">
                      <div className="text-white/85">
                        {selectedRow.goodName} · последние {MARKET_METRIC_WINDOW_TURNS} ходов
                      </div>
                      {(() => {
                        const demandHistory =
                          (effectiveTab === "country" ? selectedRow.countryDemandHistory : selectedRow.globalDemandHistory) ?? [];
                        const offerHistory =
                          (effectiveTab === "country" ? selectedRow.countryOfferHistory : selectedRow.globalOfferHistory) ?? [];
                        const coverageHistory = buildCoverageHistory(demandHistory, offerHistory);
                        const currentDemand = effectiveTab === "country" ? selectedRow.countryDemand : selectedRow.globalDemand;
                        const currentOffer = effectiveTab === "country" ? selectedRow.countryOffer : selectedRow.globalOffer;
                        const series = [
                          {
                            key: "price",
                            label: "Цена за ед.",
                            value: effectiveTab === "country" ? selectedRow.countryPrice : selectedRow.globalPrice,
                            history:
                              (effectiveTab === "country" ? selectedRow.countryPriceHistory : selectedRow.globalPriceHistory) ?? [],
                            stroke: "#22d3ee",
                          },
                          {
                            key: "demand",
                            label: "Спрос",
                            value: currentDemand,
                            history: demandHistory,
                            stroke: "#f59e0b",
                          },
                          {
                            key: "offer",
                            label: "Предложение",
                            value: currentOffer,
                            history: offerHistory,
                            stroke: "#34d399",
                          },
                          {
                            key: "coverage",
                            label: "Покрытие",
                            value: effectiveTab === "country" ? selectedRow.countryCoveragePct : selectedRow.globalCoveragePct,
                            history: coverageHistory,
                            stroke: "#f472b6",
                            suffix: "%",
                          },
                          {
                            key: "prodFact",
                            label: "Произв. факт",
                            value:
                              ((effectiveTab === "country"
                                ? selectedRow.countryProductionFactHistory
                                : selectedRow.globalProductionFactHistory) ?? []).slice(-1)[0] ?? 0,
                            history:
                              (effectiveTab === "country"
                                ? selectedRow.countryProductionFactHistory
                                : selectedRow.globalProductionFactHistory) ?? [],
                            stroke: "#60a5fa",
                          },
                          {
                            key: "prodMax",
                            label: "Произв. макс",
                            value:
                              ((effectiveTab === "country"
                                ? selectedRow.countryProductionMaxHistory
                                : selectedRow.globalProductionMaxHistory) ?? []).slice(-1)[0] ?? 0,
                            history:
                              (effectiveTab === "country"
                                ? selectedRow.countryProductionMaxHistory
                                : selectedRow.globalProductionMaxHistory) ?? [],
                            stroke: "#a78bfa",
                          },
                        ];
                        const renderSharedTooltipHtml = (turnId: number): string => {
                          const rows = series.map((metric) => {
                            const history = metric.history ?? [];
                            const startTurn =
                              typeof overview?.turnId === "number" ? Math.max(1, overview.turnId - history.length + 1) : null;
                            const idx = startTurn != null ? turnId - startTurn : -1;
                            const raw = idx >= 0 && idx < history.length ? Number(history[idx] ?? NaN) : Number.NaN;
                            const valueText = Number.isFinite(raw)
                              ? metric.suffix
                                ? `${raw.toFixed(1)}${metric.suffix}`
                                : formatCompact(raw)
                              : "—";
                            return `
                              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                                <span style="color:${metric.stroke};opacity:0.95;">${metric.label}</span>
                                <span style="color:#e2e8f0;font-weight:700;">${valueText}</span>
                              </div>
                            `;
                          });
                          return `<div style="display:flex;flex-direction:column;gap:2px;min-width:180px;">${rows.join("")}</div>`;
                        };
                        return series.map((metric) => (
                          <div key={metric.key} className="rounded-lg border border-white/10 bg-black/25 p-2">
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-white/70">{metric.label}</span>
                              <span className="inline-flex items-center gap-2">
                                <span className="font-bold text-white/85">
                                  {metric.suffix ? `${metric.value.toFixed(1)}${metric.suffix}` : formatCompact(metric.value)}
                                </span>
                                <span
                                  className={`text-[11px] font-semibold ${
                                    (metric.key === "coverage" ? getRelativeDeltaPct(metric.history) : getLastDelta(metric.history)) >= 0
                                      ? "text-emerald-300"
                                      : "text-red-300"
                                  }`}
                                >
                                  {(() => {
                                    const delta = metric.key === "coverage" ? getRelativeDeltaPct(metric.history) : getLastDelta(metric.history);
                                    const abs = Math.abs(delta);
                                    if (metric.suffix) {
                                      return `${delta >= 0 ? "+" : "-"}${abs.toFixed(1)}${metric.suffix}`;
                                    }
                                    return `${delta >= 0 ? "+" : "-"}${formatCompact(abs)}`;
                                  })()}
                                </span>
                              </span>
                            </div>
                            <Sparkline
                              chartId={metric.key}
                              values={metric.history}
                              stroke={metric.stroke}
                              targetLine={metric.key === "coverage" ? 100 : undefined}
                              currentTurnId={overview?.turnId}
                              syncedTurnId={syncedTurnId}
                              activeTooltipChartId={activeTooltipChartId}
                              onSyncTurnChange={(turn, sourceChartId) => {
                                setSyncedTurnId(turn);
                                setActiveTooltipChartId(sourceChartId);
                              }}
                              renderSharedTooltipHtml={renderSharedTooltipHtml}
                              tooltipEnabled
                            />
                          </div>
                        ));
                      })()}
                    </div>
                  ) : (
                    <div className="text-xs text-white/45">Выберите товар в таблице.</div>
                  )}
                </div>

              </div>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>

      <MarketManagementModal
        open={managementOpen}
        onClose={() => setManagementOpen(false)}
        token={token}
        countryId={countryId}
        marketId={overview?.marketId ?? null}
        onUpdated={() => {
          void load();
        }}
      />
      <CurrentMarketMembershipModal
        open={membershipOpen}
        onClose={() => setMembershipOpen(false)}
        countryId={countryId}
        currentMarket={currentMarket}
        pendingLeave={pendingLeave}
        incomingInvites={incomingInvites}
        pendingInviteActionId={pendingInviteActionId}
        onInviteAction={(inviteId, action) => {
          void handleInviteAction(inviteId, action);
        }}
        selectableMarkets={selectableMarkets}
        selectedMarketId={selectedMarketId}
        onSelectMarket={setSelectedMarketId}
        selectedMarket={selectedMarket}
        pendingJoin={pendingJoin}
        onJoin={() => {
          void handleJoinMarket();
        }}
        onLeave={() => {
          void handleLeaveCurrentMarket();
        }}
      />
      <MarketInfrastructureModal
        open={infrastructureModalOpen}
        onClose={() => setInfrastructureModalOpen(false)}
        infraRows={infraRows}
        sharedInfraRows={sharedInfraRows}
        showShared={effectiveTab === "global"}
        formatNumber={formatNumber}
        formatCompact={formatCompact}
        infrastructureCategoryNamesById={infrastructureCategoryNamesById}
      />
      <MarketAlertsModal
        open={alertsModalOpen}
        onClose={() => setAlertsModalOpen(false)}
        alerts={overview?.alerts ?? []}
      />
    </>
  );
}
