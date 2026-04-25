import { Dialog } from "@headlessui/react";
import type { WorldBase } from "@arcanorum/shared";
import { motion } from "framer-motion";
import { Landmark, ListFilter, ReceiptText, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

  const projectedEnd = useMemo(
    () => Math.floor(Number(currentDucats ?? 0) + Number(projectedIncomeDucats ?? 0) - Number(ducatExpenses.total ?? 0)),
    [currentDucats, ducatExpenses.total, projectedIncomeDucats],
  );
  const net = useMemo(() => projectedIncomeDucats - ducatExpenses.total, [ducatExpenses.total, projectedIncomeDucats]);

  useEffect(() => {
    if (!open) return;
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
      <div className="fixed inset-0 flex items-start justify-center p-4 pt-20">
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.99 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="w-full max-w-4xl"
        >
          <Dialog.Panel className="glass panel-border w-full rounded-xl p-4">
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

            {activeTab === "summary" && (
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
          </Dialog.Panel>
        </motion.div>
      </div>
    </Dialog>
  );
}
