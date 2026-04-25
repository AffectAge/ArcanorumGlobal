import { Dialog } from "@headlessui/react";
import type { WorldBase } from "@arcanorum/shared";
import * as echarts from "echarts";
import type { EChartsType } from "echarts";
import { motion } from "framer-motion";
import { Landmark, ListFilter, ReceiptText, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchContentEntries } from "../lib/api";

type DucatExpenses = {
  customization: number;
  provinceRename: number;
  colonizationSupport: number;
  construction: number;
  subsidies: number;
  total: number;
};

type SubsidyItem = {
  provinceId: string;
  buildingId: string;
  instanceId: string;
  amount: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  worldBase: WorldBase | null;
  turnId: number;
  countryId: string;
  countryName: string;
  currentDucats: number;
  projectedIncomeDucats: number;
  ducatExpenses: DucatExpenses;
  subsidyItems: SubsidyItem[];
  ducatIconUrl?: string | null;
};

type TabId = "summary" | "expenses" | "subsidies" | "history";

type HistoryRow = {
  turnId: number;
  treasuryStart: number;
  income: number;
  expenses: number;
  net: number;
  projectedEnd: number;
};

type BudgetCategoryRow = {
  key: string;
  label: string;
  value: number;
};

function formatInt(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.max(0, Math.floor(value)));
}

function formatSigned(value: number): string {
  const rounded = Math.round(value);
  if (rounded > 0) return `+${new Intl.NumberFormat("ru-RU").format(rounded)}`;
  if (rounded < 0) return `-${new Intl.NumberFormat("ru-RU").format(Math.abs(rounded))}`;
  return "0";
}

function netClass(value: number): string {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-rose-300";
  return "text-slate-200";
}

const TABS: Array<{ id: TabId; label: string; icon: typeof Wallet }> = [
  { id: "summary", label: "Сводка", icon: Wallet },
  { id: "expenses", label: "Расходы", icon: ReceiptText },
  { id: "subsidies", label: "Субсидии", icon: Landmark },
  { id: "history", label: "История", icon: ListFilter },
];

const INCOME_CHART_COLORS = ["#34d399", "#22d3ee", "#60a5fa", "#a78bfa", "#f59e0b"];
const EXPENSE_CHART_COLORS = ["#fb7185", "#f87171", "#f59e0b", "#f97316", "#a78bfa"];

export function StateBudgetModal({
  open,
  onClose,
  worldBase,
  turnId,
  countryId,
  countryName,
  currentDucats,
  projectedIncomeDucats,
  ducatExpenses,
  subsidyItems,
  ducatIconUrl,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("summary");
  const [buildingNameById, setBuildingNameById] = useState<Record<string, string>>({});
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const incomePieRef = useRef<HTMLDivElement | null>(null);
  const expensePieRef = useRef<HTMLDivElement | null>(null);
  const incomeChartRef = useRef<EChartsType | null>(null);
  const expenseChartRef = useRef<EChartsType | null>(null);

  const projectedEnd = useMemo(
    () => Math.floor(Number(currentDucats ?? 0) + Number(projectedIncomeDucats ?? 0) - Number(ducatExpenses.total ?? 0)),
    [currentDucats, ducatExpenses.total, projectedIncomeDucats],
  );
  const net = useMemo(() => projectedIncomeDucats - ducatExpenses.total, [ducatExpenses.total, projectedIncomeDucats]);
  const incomeRows = useMemo<BudgetCategoryRow[]>(
    () => [
      {
        key: "base-income",
        label: "Базовый доход государства",
        value: Math.max(0, Math.floor(projectedIncomeDucats ?? 0)),
      },
    ],
    [projectedIncomeDucats],
  );
  const expenseRows = useMemo<BudgetCategoryRow[]>(
    () => [
      { key: "subsidies", label: "Государственные субсидии", value: Math.max(0, Math.floor(ducatExpenses.subsidies ?? 0)) },
      { key: "construction", label: "Строительные проекты", value: Math.max(0, Math.floor(ducatExpenses.construction ?? 0)) },
      { key: "colonization", label: "Поддержка колонизаций", value: Math.max(0, Math.floor(ducatExpenses.colonizationSupport ?? 0)) },
      { key: "province-rename", label: "Переименование провинций", value: Math.max(0, Math.floor(ducatExpenses.provinceRename ?? 0)) },
      { key: "customization", label: "Кастомизация страны", value: Math.max(0, Math.floor(ducatExpenses.customization ?? 0)) },
    ],
    [
      ducatExpenses.colonizationSupport,
      ducatExpenses.construction,
      ducatExpenses.customization,
      ducatExpenses.provinceRename,
      ducatExpenses.subsidies,
    ],
  );
  const incomeTableTotal = useMemo(
    () => incomeRows.reduce((sum, row) => sum + Math.max(0, Math.floor(row.value)), 0),
    [incomeRows],
  );
  const expenseTableTotal = useMemo(
    () => expenseRows.reduce((sum, row) => sum + Math.max(0, Math.floor(row.value)), 0),
    [expenseRows],
  );
  const incomeChartRows = useMemo(
    () =>
      incomeRows
        .filter((row) => row.value > 0)
        .map((row, index) => ({ ...row, color: INCOME_CHART_COLORS[index % INCOME_CHART_COLORS.length] })),
    [incomeRows],
  );
  const expenseChartRows = useMemo(
    () =>
      expenseRows
        .filter((row) => row.value > 0)
        .map((row, index) => ({ ...row, color: EXPENSE_CHART_COLORS[index % EXPENSE_CHART_COLORS.length] })),
    [expenseRows],
  );

  useEffect(() => {
    if (!open) return;
    setActiveTab("summary");
    let cancelled = false;
    fetchContentEntries("buildings")
      .then((items) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const item of items) {
          map[item.id] = item.name;
        }
        setBuildingNameById(map);
      })
      .catch(() => {
        if (!cancelled) setBuildingNameById({});
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setHistoryRows((prev) => {
      const row: HistoryRow = {
        turnId,
        treasuryStart: Math.max(0, Math.floor(currentDucats ?? 0)),
        income: Math.max(0, Math.floor(projectedIncomeDucats ?? 0)),
        expenses: Math.max(0, Math.floor(ducatExpenses.total ?? 0)),
        net: Math.floor(net),
        projectedEnd: Math.max(0, Math.floor(projectedEnd)),
      };
      const rest = prev.filter((entry) => entry.turnId !== turnId);
      return [row, ...rest].slice(0, 20);
    });
  }, [currentDucats, ducatExpenses.total, net, open, projectedEnd, projectedIncomeDucats, turnId]);

  useEffect(() => {
    if (!open || activeTab !== "summary") return;
    const applyPie = (
      container: HTMLDivElement | null,
      holder: { current: EChartsType | null },
      title: string,
      rows: Array<{ label: string; value: number; color: string }>,
    ) => {
      if (!container) return;
      const existing = holder.current;
      const chart =
        existing && existing.getDom() === container
          ? existing
          : (() => {
              existing?.dispose();
              return echarts.init(container);
            })();
      holder.current = chart;
      chart.setOption(
        {
          animationDuration: 280,
          backgroundColor: "transparent",
          tooltip: {
            trigger: "item",
            backgroundColor: "rgba(7,12,20,0.92)",
            borderColor: "rgba(148,163,184,0.25)",
            borderWidth: 1,
            textStyle: { color: "#e2e8f0", fontSize: 11 },
            formatter: (params: { name: string; value: number; percent: number }) =>
              `${params.name}<br/>${formatInt(params.value)} дукат (${Math.round(params.percent)}%)`,
          },
          legend: {
            bottom: 0,
            left: "center",
            itemWidth: 10,
            itemHeight: 10,
            textStyle: { color: "rgba(226,232,240,0.75)", fontSize: 11 },
          },
          series: [
            {
              name: title,
              type: "pie",
              radius: ["48%", "68%"],
              center: ["50%", "43%"],
              avoidLabelOverlap: true,
              label: { show: false },
              labelLine: { show: false },
              data: rows.map((row) => ({
                name: row.label,
                value: Math.max(0, Math.floor(row.value)),
                itemStyle: { color: row.color },
              })),
              emphasis: {
                scale: true,
                itemStyle: {
                  shadowBlur: 10,
                  shadowOffsetX: 0,
                  shadowColor: "rgba(0, 0, 0, 0.45)",
                },
              },
            },
          ],
        },
        { notMerge: true },
      );
    };

    applyPie(incomePieRef.current, incomeChartRef, "Доходы", incomeChartRows);
    applyPie(expensePieRef.current, expenseChartRef, "Расходы", expenseChartRows);

    // Framer-motion entry animation can leave containers with transient zero-size.
    // Deferred resize ensures charts appear immediately on first open.
    const rafId = window.requestAnimationFrame(() => {
      incomeChartRef.current?.resize();
      expenseChartRef.current?.resize();
    });
    const timeoutId = window.setTimeout(() => {
      incomeChartRef.current?.resize();
      expenseChartRef.current?.resize();
    }, 140);

    const onResize = () => {
      incomeChartRef.current?.resize();
      expenseChartRef.current?.resize();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
      window.removeEventListener("resize", onResize);
    };
  }, [activeTab, expenseChartRows, incomeChartRows, open]);

  useEffect(() => {
    if (open) return;
    incomeChartRef.current?.dispose();
    expenseChartRef.current?.dispose();
    incomeChartRef.current = null;
    expenseChartRef.current = null;
  }, [open]);

  useEffect(() => {
    return () => {
      incomeChartRef.current?.dispose();
      expenseChartRef.current?.dispose();
      incomeChartRef.current = null;
      expenseChartRef.current = null;
    };
  }, []);

  const subsidyTotal = Math.max(0, Math.floor(subsidyItems.reduce((sum, item) => sum + Math.max(0, item.amount), 0)));
  const subsidyRows = useMemo(
    () =>
      subsidyItems
        .map((item) => ({
          ...item,
          buildingName: buildingNameById[item.buildingId] ?? item.buildingId,
          provinceName: worldBase?.provinceNameById?.[item.provinceId] ?? item.provinceId,
          amountInt: Math.max(0, Math.floor(item.amount)),
        }))
        .sort((a, b) => b.amountInt - a.amountInt),
    [buildingNameById, subsidyItems, worldBase?.provinceNameById],
  );

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[130]">
      <motion.div
        aria-hidden="true"
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
      />
      <div className="fixed inset-0 p-4 md:p-6">
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.99 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="h-full w-full"
        >
          <Dialog.Panel className="glass panel-border flex h-full w-full flex-col rounded-2xl bg-[#0b111b] p-4 md:p-5">
            <div className="mb-3 flex items-center justify-between gap-4">
              <div>
                <Dialog.Title className="text-sm font-semibold text-slate-100">Бюджет дукатов государства</Dialog.Title>
                <p className="mt-1 text-xs text-slate-400">
                  {countryName} ({countryId}) • Ход #{turnId}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="panel-border inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/5 text-slate-200 transition hover:text-arc-accent"
                aria-label="Закрыть"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`panel-border inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition ${
                      active ? "bg-arc-accent/20 text-arc-accent" : "bg-black/20 text-white/75 hover:bg-white/10"
                    }`}
                  >
                    <Icon size={14} />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="arc-scrollbar min-h-0 flex-1 overflow-auto pr-1">
            {activeTab === "summary" && (
              <div className="space-y-3">
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
                  <div className="panel-border rounded-lg bg-black/20 p-3">
                    <div className="text-[11px] text-white/55">Казна сейчас</div>
                    <div className="mt-1 flex items-center gap-2 text-lg font-semibold text-white">
                      {ducatIconUrl ? <img src={ducatIconUrl} alt="" className="h-4 w-4 object-contain" /> : null}
                      {formatInt(currentDucats)}
                    </div>
                  </div>
                  <div className="panel-border rounded-lg bg-black/20 p-3">
                    <div className="text-[11px] text-white/55">Доходы за ход</div>
                    <div className="mt-1 text-lg font-semibold text-emerald-400">+{formatInt(projectedIncomeDucats)}</div>
                  </div>
                  <div className="panel-border rounded-lg bg-black/20 p-3">
                    <div className="text-[11px] text-white/55">Расходы за ход</div>
                    <div className="mt-1 text-lg font-semibold text-rose-300">-{formatInt(ducatExpenses.total)}</div>
                  </div>
                  <div className="panel-border rounded-lg bg-black/20 p-3">
                    <div className="text-[11px] text-white/55">Прогноз на конец хода</div>
                    <div className={`mt-1 text-lg font-semibold ${netClass(net)}`}>{formatInt(projectedEnd)}</div>
                    <div className={`mt-1 text-xs ${netClass(net)}`}>Итог: {formatSigned(net)}</div>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <section className="panel-border rounded-lg bg-black/20 p-3">
                    <div className="mb-2 text-sm font-semibold text-white/90">График доходов по категориям</div>
                    <div ref={incomePieRef} className="h-[320px] w-full" />
                  </section>
                  <section className="panel-border rounded-lg bg-black/20 p-3">
                    <div className="mb-2 text-sm font-semibold text-white/90">График расходов по категориям</div>
                    <div ref={expensePieRef} className="h-[320px] w-full" />
                  </section>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="panel-border rounded-lg bg-black/20 p-3">
                    <div className="mb-2 text-sm font-semibold text-white/90">Доходы по категориям</div>
                    <div className="overflow-hidden rounded-md border border-white/10">
                      <div className="grid grid-cols-[1fr_auto] items-center gap-2 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-wide text-white/50">
                        <span>Категория</span>
                        <span>Сумма</span>
                      </div>
                      <div className="divide-y divide-white/10">
                        {incomeRows.map((row) => (
                          <div key={row.key} className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-2 text-sm">
                            <span className="text-white/80">{row.label}</span>
                            <span className="font-semibold text-emerald-400">+{formatInt(row.value)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-[1fr_auto] items-center gap-2 border-t border-white/10 bg-black/30 px-3 py-2 text-sm font-semibold">
                        <span className="text-white">Итого доходов</span>
                        <span className="text-emerald-400">+{formatInt(incomeTableTotal)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="panel-border rounded-lg bg-black/20 p-3">
                    <div className="mb-2 text-sm font-semibold text-white/90">Расходы по категориям</div>
                    <div className="overflow-hidden rounded-md border border-white/10">
                      <div className="grid grid-cols-[1fr_auto] items-center gap-2 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-wide text-white/50">
                        <span>Категория</span>
                        <span>Сумма</span>
                      </div>
                      <div className="divide-y divide-white/10">
                        {expenseRows.map((row) => (
                          <div key={row.key} className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-2 text-sm">
                            <span className="text-white/80">{row.label}</span>
                            <span className="font-semibold text-rose-300">-{formatInt(row.value)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-[1fr_auto] items-center gap-2 border-t border-white/10 bg-black/30 px-3 py-2 text-sm font-semibold">
                        <span className="text-white">Итого расходов</span>
                        <span className="text-rose-300">-{formatInt(expenseTableTotal)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "expenses" && (
              <div className="space-y-2">
                {[
                  { key: "subsidies", label: "Государственные субсидии", value: ducatExpenses.subsidies },
                  { key: "construction", label: "Строительные проекты", value: ducatExpenses.construction },
                  { key: "colonization", label: "Поддержка колонизаций", value: ducatExpenses.colonizationSupport },
                  { key: "rename", label: "Переименование провинций", value: ducatExpenses.provinceRename },
                  { key: "customization", label: "Кастомизация страны", value: ducatExpenses.customization },
                ]
                  .filter((row) => row.value > 0)
                  .map((row) => (
                    <div key={row.key} className="panel-border flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 text-sm">
                      <span className="text-white/85">{row.label}</span>
                      <span className="text-rose-300">-{formatInt(row.value)} дукат</span>
                    </div>
                  ))}
                <div className="panel-border flex items-center justify-between rounded-lg border-white/20 bg-black/30 px-3 py-2 text-sm font-semibold">
                  <span className="text-white">Итого расходов</span>
                  <span className="text-rose-300">-{formatInt(ducatExpenses.total)} дукат</span>
                </div>
              </div>
            )}

            {activeTab === "subsidies" && (
              <div className="space-y-2">
                <div className="panel-border rounded-lg bg-black/20 px-3 py-2 text-sm text-white/85">
                  Выплачено субсидий в этом ходу: <span className="font-semibold text-emerald-400">{formatInt(subsidyTotal)} дукат</span>
                </div>
                <div className="arc-scrollbar max-h-[45vh] space-y-2 overflow-auto pr-1">
                  {subsidyRows.length === 0 ? (
                    <div className="panel-border rounded-lg bg-black/20 px-3 py-5 text-center text-sm text-white/60">В этом ходу субсидий не выплачено.</div>
                  ) : (
                    subsidyRows.map((row) => (
                      <div key={row.instanceId} className="panel-border rounded-lg bg-black/20 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-white">{row.buildingName}</span>
                          <span className="text-emerald-400">+{formatInt(row.amountInt)} дукат</span>
                        </div>
                        <div className="mt-1 text-xs text-white/55">{row.provinceName}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === "history" && (
              <div className="arc-scrollbar max-h-[45vh] space-y-2 overflow-auto pr-1">
                {historyRows.map((row) => (
                  <div key={row.turnId} className="panel-border rounded-lg bg-black/20 px-3 py-2 text-sm">
                    <div className="mb-1 text-xs text-white/55">Ход #{row.turnId}</div>
                    <div className="grid gap-2 md:grid-cols-5">
                      <div>
                        <div className="text-[11px] text-white/50">Казна</div>
                        <div className="text-white">{formatInt(row.treasuryStart)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-white/50">Доходы</div>
                        <div className="text-emerald-400">+{formatInt(row.income)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-white/50">Расходы</div>
                        <div className="text-rose-300">-{formatInt(row.expenses)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-white/50">Итог</div>
                        <div className={netClass(row.net)}>{formatSigned(row.net)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-white/50">Прогноз</div>
                        <div className={netClass(row.net)}>{formatInt(row.projectedEnd)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            </div>
          </Dialog.Panel>
        </motion.div>
      </div>
    </Dialog>
  );
}
