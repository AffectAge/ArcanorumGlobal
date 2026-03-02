import { Dialog } from "@headlessui/react";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowDownUp, Globe2, LineChart, SlidersHorizontal, TrendingDown, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchMarketOverview, type MarketOverviewResponse } from "../lib/api";
import { CustomSelect } from "./CustomSelect";

type Props = {
  open: boolean;
  onClose: () => void;
  token: string;
  countryName: string;
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

export function MarketModal({ open, onClose, token, countryName }: Props) {
  const [overview, setOverview] = useState<MarketOverviewResponse | null>(null);
  const [tab, setTab] = useState<ViewTab>("country");
  const [sortMode, setSortMode] = useState<SortMode>("deficit");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchMarketOverview(token)
      .then((data) => {
        if (!cancelled) setOverview(data);
      })
      .catch(() => {
        if (!cancelled) setOverview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, token]);

  const rows = useMemo(() => {
    const source = overview?.goods ?? [];
    const mapped = source.map((item) => {
      const price = tab === "country" ? item.countryPrice : item.globalPrice;
      const demand = tab === "country" ? item.countryDemand : item.globalDemand;
      const offer = tab === "country" ? item.countryOffer : item.globalOffer;
      const coverage = tab === "country" ? item.countryCoveragePct : item.globalCoveragePct;
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
  }, [overview?.goods, quickFilter, sortMode, tab]);

  const infraRows = useMemo(
    () =>
      Object.entries(overview?.infraByProvince ?? {})
        .map(([provinceId, infra]) => ({ provinceId, ...infra }))
        .sort((a, b) => a.coverage - b.coverage || a.provinceId.localeCompare(b.provinceId, "ru")),
    [overview?.infraByProvince],
  );

  const criticalCount = useMemo(() => rows.filter((row) => row.coverage < 50).length, [rows]);
  const infraOverloadCount = useMemo(() => infraRows.filter((row) => row.coverage < 1).length, [infraRows]);

  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} className="fixed inset-0 z-[170]">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="absolute inset-4 flex items-center justify-center">
        <Dialog.Panel
          as={motion.div}
          initial={{ opacity: 0, y: 14, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.99 }}
          className="panel-border flex h-[min(92vh,980px)] w-[min(96vw,1400px)] flex-col overflow-hidden rounded-2xl bg-[#0b111b] shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-white/10 bg-[#0e1523] px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Рынок</h2>
              <p className="text-xs text-white/60">
                {tab === "country" ? `Наш рынок (${countryName})` : "Глобальный рынок"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/35 text-white/70 transition hover:border-arc-accent/45 hover:text-arc-accent"
            >
              <X size={16} />
            </button>
          </div>

          <div className="border-b border-white/10 bg-black/20 px-6 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setTab("country")}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  tab === "country"
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
                  tab === "global"
                    ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-200"
                    : "border-white/10 bg-black/35 text-white/65 hover:border-cyan-400/35"
                }`}
              >
                Глобальный
              </button>

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
                <AlertTriangle size={13} /> {criticalCount}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
                <SlidersHorizontal size={13} /> {infraOverloadCount}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200">
                <ArrowDownUp size={13} /> {rows.length}
              </span>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 xl:grid-cols-[1.7fr_1fr]">
            <div className="panel-border arc-scrollbar min-h-0 overflow-auto rounded-xl bg-black/25">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 border-b border-white/10 bg-black/35 px-3 py-2 text-xs font-semibold text-white/70">
                <div>Товар</div>
                <div className="text-right">Цена</div>
                <div className="text-right">Спрос</div>
                <div className="text-right">Предложение</div>
                <div className="text-right">Покрытие</div>
              </div>
              <div className="space-y-1 p-2">
                {rows.map((row) => (
                  <div
                    key={row.goodId}
                    className={`grid grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                      row.coverage < 50
                        ? "border-red-400/35 bg-red-500/10"
                        : "border-white/10 bg-black/25"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-white/85">
                      {row.coverage < 50 ? <TrendingDown size={14} className="text-red-300" /> : <LineChart size={14} className="text-emerald-300" />}
                      <span className="truncate">{row.goodName}</span>
                    </div>
                    <div className="text-right font-semibold text-white/80">{formatCompact(row.price)}</div>
                    <div className="text-right text-white/70">{formatCompact(row.demand)}</div>
                    <div className="text-right text-white/70">{formatCompact(row.offer)}</div>
                    <div className={`text-right font-semibold ${row.coverage < 50 ? "text-red-200" : "text-emerald-200"}`}>
                      {row.coverage.toFixed(1)}%
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

            <div className="panel-border arc-scrollbar min-h-0 overflow-auto rounded-xl bg-black/25 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white/80">
                <Globe2 size={14} className="text-arc-accent" />
                Инфраструктура провинций
              </div>
              <div className="space-y-1">
                {infraRows.map((row) => (
                  <div
                    key={row.provinceId}
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      row.coverage < 1 ? "border-amber-400/35 bg-amber-500/10" : "border-white/10 bg-black/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white/80">{row.provinceId}</span>
                      <span className={`font-semibold ${row.coverage < 1 ? "text-amber-200" : "text-emerald-200"}`}>
                        {(row.coverage * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-1 text-white/55">
                      {formatNumber(row.capacity)} / {formatNumber(row.required)}
                    </div>
                  </div>
                ))}
                {infraRows.length === 0 && <div className="text-xs text-white/50">Нет данных по инфраструктуре.</div>}
              </div>

              <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-white/70">
                  <AlertTriangle size={13} className="text-red-300" />
                  Алерты рынка
                </div>
                <div className="space-y-1 text-xs">
                  {(overview?.alerts ?? []).slice(0, 12).map((alert) => (
                    <div key={alert.id} className="rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-white/70">
                      {alert.message}
                    </div>
                  ))}
                  {(overview?.alerts ?? []).length === 0 && <div className="text-white/45">Нет алертов.</div>}
                </div>
              </div>
            </div>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}

