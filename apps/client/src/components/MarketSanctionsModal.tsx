
import { Dialog } from "@headlessui/react";
import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  CheckCircle2,
  Clock3,
  Filter,
  Plus,
  Save,
  ShieldBan,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  createMarketSanction,
  deleteMarketSanction,
  fetchCountries,
  fetchContentEntries,
  fetchMarketsCatalog,
  fetchMarketSanctions,
  updateMarketSanction,
  type MarketSanction,
} from "../lib/api";
import { CustomSelect } from "./CustomSelect";
import { Tooltip } from "./Tooltip";

type Props = {
  open: boolean;
  onClose: () => void;
  token: string;
  countryId: string;
  marketId: string | null;
  onUpdated?: () => void;
};

type DraftGoodRule = {
  rowId: string;
  goodId: string;
  direction: "import" | "export" | "both";
  mode: "ban" | "cap";
  capAmount: string;
};

type StatusFilter = "all" | "active" | "expired" | "paused";

const directionLabel = (direction: DraftGoodRule["direction"] | MarketSanction["direction"]): string => {
  if (direction === "import") return "Импорт";
  if (direction === "export") return "Экспорт";
  return "Импорт+Экспорт";
};

const statusChip = (sanction: MarketSanction, turnId: number): { label: string; className: string } => {
  if (sanction.enabled === false) {
    return {
      label: "PAUSED",
      className: "border-amber-400/40 bg-amber-500/20 text-amber-200",
    };
  }
  if (turnId >= Number(sanction.expiresAtTurn ?? sanction.startTurn + sanction.durationTurns)) {
    return {
      label: "EXPIRED",
      className: "border-red-400/40 bg-red-500/20 text-red-200",
    };
  }
  return {
    label: "ACTIVE",
    className: "border-emerald-400/40 bg-emerald-500/20 text-emerald-200",
  };
};

const getDirectionIcon = (direction: DraftGoodRule["direction"] | MarketSanction["direction"], className = "h-3.5 w-3.5") => {
  if (direction === "import") return <ArrowDown className={className} />;
  if (direction === "export") return <ArrowUp className={className} />;
  return <ArrowDownUp className={className} />;
};

export function MarketSanctionsModal({ open, onClose, token, countryId, marketId, onUpdated }: Props) {
  const [loading, setLoading] = useState(false);
  const [ownerCountryId, setOwnerCountryId] = useState<string | null>(null);
  const [turnId, setTurnId] = useState(1);
  const [sanctions, setSanctions] = useState<MarketSanction[]>([]);
  const [countries, setCountries] = useState<Array<{ id: string; name: string; flagUrl?: string | null }>>([]);
  const [goods, setGoods] = useState<Array<{ id: string; name: string }>>([]);
  const [marketsCatalog, setMarketsCatalog] = useState<Array<{ id: string; name: string; logoUrl?: string | null }>>([]);

  const [pendingApply, setPendingApply] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [targetType, setTargetType] = useState<"country" | "market">("country");
  const [targetId, setTargetId] = useState("");
  const [duration, setDuration] = useState("30");
  const [rules, setRules] = useState<DraftGoodRule[]>([]);
  const [bulkDirection, setBulkDirection] = useState<"import" | "export" | "both">("both");
  const [bulkMode, setBulkMode] = useState<"ban" | "cap">("ban");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const isOwner = ownerCountryId === countryId;

  const load = async () => {
    if (!marketId) return;
    setLoading(true);
    try {
      const [sanctionsRes, allCountries, goodsEntries, marketsRes] = await Promise.all([
        fetchMarketSanctions(token, marketId),
        fetchCountries(),
        fetchContentEntries("goods"),
        fetchMarketsCatalog(token),
      ]);
      setSanctions(sanctionsRes.sanctions ?? []);
      setOwnerCountryId(sanctionsRes.ownerCountryId ?? null);
      setTurnId(Math.max(1, Number(sanctionsRes.turnId ?? 1)));
      setCountries((allCountries ?? []).map((row) => ({ id: row.id, name: row.name, flagUrl: row.flagUrl ?? null })));
      setGoods((goodsEntries ?? []).map((row) => ({ id: row.id, name: row.name })));
      setMarketsCatalog((marketsRes.markets ?? []).map((row) => ({ id: row.id, name: row.name, logoUrl: row.logoUrl ?? null })));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить санкции");
      setSanctions([]);
      setOwnerCountryId(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !marketId) return;
    void load();
  }, [open, marketId]);

  useEffect(() => {
    if (!open) return;
    setStatusFilter("all");
    setConfirmOpen(false);
  }, [open]);

  const targetOptions = useMemo(() => {
    if (targetType === "country") {
      return countries
        .filter((row) => row.id !== ownerCountryId)
        .sort((a, b) => a.name.localeCompare(b.name, "ru"))
        .map((row) => ({ value: row.id, label: row.name }));
    }
    return marketsCatalog
      .filter((row) => row.id !== marketId)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((row) => ({ value: row.id, label: row.name }));
  }, [countries, targetType, ownerCountryId, marketsCatalog, marketId]);

  useEffect(() => {
    if (!targetOptions.some((option) => option.value === targetId)) {
      setTargetId(targetOptions[0]?.value ?? "");
    }
  }, [targetOptions, targetId]);

  const goodsOptions = useMemo(
    () =>
      goods
        .map((good) => ({ value: good.id, label: good.name }))
        .sort((a, b) => a.label.localeCompare(b.label, "ru")),
    [goods],
  );

  useEffect(() => {
    if (rules.length > 0 || goods.length === 0) return;
    setRules([
      {
        rowId: crypto.randomUUID(),
        goodId: goods[0]?.id ?? "",
        direction: "both",
        mode: "ban",
        capAmount: "0",
      },
    ]);
  }, [goods, rules.length]);

  const targetMeta = useMemo(() => {
    if (targetType === "country") {
      const country = countries.find((row) => row.id === targetId);
      return {
        name: country?.name ?? "—",
        imageUrl: country?.flagUrl ?? null,
      };
    }
    const market = marketsCatalog.find((row) => row.id === targetId);
    return {
      name: market?.name ?? "—",
      imageUrl: market?.logoUrl ?? null,
    };
  }, [countries, marketsCatalog, targetId, targetType]);

  const getRuleError = (row: DraftGoodRule): string | null => {
    if (!row.goodId) return "Выберите товар";
    if (row.mode === "cap") {
      const cap = Number(row.capAmount);
      if (!Number.isFinite(cap) || cap <= 0) {
        return "Лимит > 0";
      }
    }
    return null;
  };

  const rulesWithValidation = useMemo(
    () =>
      rules.map((row) => ({
        ...row,
        error: getRuleError(row),
      })),
    [rules],
  );

  const validRules = useMemo(
    () => rulesWithValidation.filter((row) => !row.error),
    [rulesWithValidation],
  );

  const previewStats = useMemo(() => {
    const banCount = validRules.filter((row) => row.mode === "ban").length;
    const capRows = validRules.filter((row) => row.mode === "cap");
    const capCount = capRows.length;
    const capTotal = capRows.reduce((sum, row) => sum + Math.max(0, Number(row.capAmount || 0)), 0);
    const goodNames = validRules
      .map((row) => goods.find((g) => g.id === row.goodId)?.name ?? row.goodId)
      .slice(0, 8);
    return {
      totalRules: validRules.length,
      banCount,
      capCount,
      capTotal,
      goodNames,
      overflowCount: Math.max(0, validRules.length - goodNames.length),
    };
  }, [validRules, goods]);

  const filteredSanctions = useMemo(() => {
    return sanctions.filter((sanction) => {
      const status = statusChip(sanction, turnId).label;
      if (statusFilter === "all") return true;
      if (statusFilter === "active") return status === "ACTIVE";
      if (statusFilter === "expired") return status === "EXPIRED";
      return status === "PAUSED";
    });
  }, [sanctions, statusFilter, turnId]);

  const applyBulkDirection = () => {
    setRules((prev) => prev.map((row) => ({ ...row, direction: bulkDirection })));
  };

  const applyBulkMode = () => {
    setRules((prev) =>
      prev.map((row) => ({
        ...row,
        mode: bulkMode,
        capAmount: bulkMode === "cap" ? row.capAmount || "0" : "0",
      })),
    );
  };

  const updateRule = (rowId: string, patch: Partial<DraftGoodRule>) => {
    setRules((prev) => prev.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  };

  const addRule = () => {
    if (goods.length === 0) return;
    setRules((prev) => [
      ...prev,
      {
        rowId: crypto.randomUUID(),
        goodId: goods[0]?.id ?? "",
        direction: "both",
        mode: "ban",
        capAmount: "0",
      },
    ]);
  };

  const removeRule = (rowId: string) => {
    setRules((prev) => prev.filter((row) => row.rowId !== rowId));
  };

  const applyRules = async () => {
    if (!marketId || !isOwner || !targetId) return;
    if (validRules.length === 0) {
      toast.error("Нет валидных правил для применения");
      return;
    }
    setPendingApply(true);
    try {
      const durationTurns = Math.max(1, Math.floor(Number(duration || 1)));
      for (const row of validRules) {
        await createMarketSanction(token, marketId, {
          direction: row.direction,
          targetType,
          targetId,
          goods: [row.goodId],
          mode: row.mode,
          capAmountPerTurn: row.mode === "cap" ? Math.max(0, Number(row.capAmount || 0)) : null,
          durationTurns,
        });
      }
      toast.success(`Добавлено санкций: ${validRules.length}`);
      setConfirmOpen(false);
      await load();
      onUpdated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось применить санкции");
    } finally {
      setPendingApply(false);
    }
  };

  const toggleEnabled = async (sanction: MarketSanction) => {
    if (!marketId || !isOwner) return;
    try {
      await updateMarketSanction(token, marketId, sanction.id, { enabled: sanction.enabled === false });
      await load();
      onUpdated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить санкцию");
    }
  };

  const removeSanction = async (sanctionId: string) => {
    if (!marketId || !isOwner) return;
    setPendingDeleteId(sanctionId);
    try {
      await deleteMarketSanction(token, marketId, sanctionId);
      toast.success("Санкция удалена");
      await load();
      onUpdated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить санкцию");
    } finally {
      setPendingDeleteId(null);
    }
  };

  if (!open) return null;

  return (
    <>
      <Dialog open={open} onClose={onClose} className="fixed inset-0 z-[181]">
        <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
        <div className="absolute inset-4 flex items-center justify-center">
          <Dialog.Panel
            as={motion.div}
            initial={{ opacity: 0, y: 12, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="panel-border arc-scrollbar h-[min(92vh,960px)] w-[min(96vw,1460px)] overflow-auto rounded-2xl bg-[#0b111b] p-4"
          >
            <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="text-lg font-semibold text-white">Санкции рынка</h3>
                <p className="text-xs text-white/60">Конструктор правил импорта/экспорта с пакетным применением</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/35 text-white/70"
              >
                <X size={16} />
              </button>
            </div>

            {loading ? (
              <div className="text-sm text-white/60">Загрузка...</div>
            ) : !isOwner ? (
              <div className="rounded-lg border border-amber-400/35 bg-amber-500/10 p-4 text-sm text-amber-200">
                Санкции может изменять только владелец рынка.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
                <div className="panel-border flex min-h-[720px] flex-col rounded-xl bg-black/25">
                  <div className="sticky top-0 z-20 border-b border-white/10 bg-[#0b111b]/95 p-3 backdrop-blur">
                    <div className="mb-3 grid grid-cols-3 gap-2 text-[11px]">
                      <div className="flex h-7 items-center justify-center rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-2 font-semibold text-cyan-200">
                        1. Цель
                      </div>
                      <div className="flex h-7 items-center justify-center rounded-lg border border-amber-400/35 bg-amber-500/15 px-2 font-semibold text-amber-200">
                        2. Товары
                      </div>
                      <div className="flex h-7 items-center justify-center rounded-lg border border-emerald-400/35 bg-emerald-500/15 px-2 font-semibold text-emerald-200">
                        3. Подтверждение
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                      <Tooltip content="Кого санкционируем: страну или целый рынок.">
                        <div>
                          <CustomSelect
                            value={targetType}
                            onChange={(value) => setTargetType(value as "country" | "market")}
                            options={[
                              { value: "country", label: "Цель: страна" },
                              { value: "market", label: "Цель: рынок" },
                            ]}
                            buttonClassName="h-9 text-xs"
                          />
                        </div>
                      </Tooltip>
                      <Tooltip content="Конкретная цель санкций.">
                        <div>
                          <CustomSelect
                            value={targetId}
                            onChange={setTargetId}
                            options={targetOptions}
                            placeholder="Выберите цель"
                            buttonClassName="h-9 text-xs"
                          />
                        </div>
                      </Tooltip>
                      <Tooltip content="Сколько ходов правило будет действовать.">
                        <input
                          value={duration}
                          onChange={(event) => setDuration(event.target.value.replace(/[^\d]/g, ""))}
                          placeholder="Срок (ходов)"
                          className="panel-border h-9 rounded-lg bg-black/35 px-3 text-sm text-white outline-none"
                        />
                      </Tooltip>
                    </div>
                    <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-xs text-white/75">
                      {targetMeta.imageUrl ? (
                        <img src={targetMeta.imageUrl} alt="" className="h-5 w-5 rounded object-cover border border-white/15" />
                      ) : (
                        <span className="h-5 w-5 rounded border border-white/15 bg-black/40" />
                      )}
                      <span className="max-w-[420px] truncate">Цель: {targetMeta.name || "—"}</span>
                    </div>
                  </div>

                  <div className="flex-1 overflow-hidden p-3">
                    <div className="mb-2 grid grid-cols-[1fr_120px_110px_110px_54px] items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-white/55">
                      <span>Товар</span>
                      <span>Направление</span>
                      <span>Режим</span>
                      <span>Лимит</span>
                      <span>Действие</span>
                    </div>
                    <div className="arc-scrollbar h-[430px] overflow-auto pr-1">
                      <div className="space-y-2 pb-16">
                        {rulesWithValidation.map((row) => {
                          const rowTone =
                            row.mode === "ban"
                              ? "border-red-400/35 bg-red-500/10 hover:border-red-400/55"
                              : "border-amber-400/35 bg-amber-500/10 hover:border-amber-400/55";
                          return (
                            <div
                              key={row.rowId}
                              className={`grid grid-cols-[1fr_120px_110px_110px_54px] gap-2 rounded-lg border px-2 py-2 transition-all duration-150 hover:-translate-y-[1px] ${rowTone} ${
                                row.error ? "ring-1 ring-red-400/50" : ""
                              }`}
                            >
                              <CustomSelect
                                value={row.goodId}
                                onChange={(value) => updateRule(row.rowId, { goodId: value })}
                                options={goodsOptions}
                                placeholder="Товар"
                                buttonClassName="h-9 text-xs"
                              />
                              <CustomSelect
                                value={row.direction}
                                onChange={(value) =>
                                  updateRule(row.rowId, { direction: value as "import" | "export" | "both" })
                                }
                                options={[
                                  { value: "both", label: "Имп+Эксп" },
                                  { value: "import", label: "Импорт" },
                                  { value: "export", label: "Экспорт" },
                                ]}
                                buttonClassName="h-9 text-xs"
                              />
                              <CustomSelect
                                value={row.mode}
                                onChange={(value) => updateRule(row.rowId, { mode: value as "ban" | "cap" })}
                                options={[
                                  { value: "ban", label: "Запрет" },
                                  { value: "cap", label: "Лимит" },
                                ]}
                                buttonClassName="h-9 text-xs"
                              />
                              <input
                                value={row.capAmount}
                                disabled={row.mode !== "cap"}
                                onChange={(event) =>
                                  updateRule(row.rowId, { capAmount: event.target.value.replace(/[^\d.]/g, "") })
                                }
                                placeholder="Лимит"
                                className={`panel-border h-9 rounded-lg bg-black/35 px-3 text-sm text-white outline-none disabled:opacity-50 ${
                                  row.error ? "border-red-400/60" : ""
                                }`}
                              />
                              <button
                                type="button"
                                onClick={() => removeRule(row.rowId)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-400/40 bg-red-500/20 text-red-200"
                              >
                                <Trash2 size={12} />
                              </button>
                              {row.error && (
                                <div className="col-span-5 -mt-1 text-[11px] font-semibold text-red-300">{row.error}</div>
                              )}
                            </div>
                          );
                        })}
                        {rulesWithValidation.length === 0 && (
                          <div className="rounded-lg border border-dashed border-white/20 bg-black/20 p-4 text-xs text-white/45">
                            Добавьте минимум одну строку товара.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="sticky bottom-0 z-20 border-t border-white/10 bg-[#0b111b]/95 p-3 backdrop-blur">
                    <div className="mb-2 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
                      <Tooltip content="Применить направление сразу ко всем строкам.">
                        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-2 py-2">
                          <CustomSelect
                            value={bulkDirection}
                            onChange={(value) => setBulkDirection(value as "import" | "export" | "both")}
                            options={[
                              { value: "both", label: "Импорт+Экспорт" },
                              { value: "import", label: "Импорт" },
                              { value: "export", label: "Экспорт" },
                            ]}
                            buttonClassName="h-8 text-xs"
                          />
                          <button
                            type="button"
                            onClick={applyBulkDirection}
                            className="h-8 rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-2 text-[11px] font-semibold text-cyan-200"
                          >
                            Применить всем
                          </button>
                        </div>
                      </Tooltip>
                      <Tooltip content="Применить режим (ban/cap) сразу ко всем строкам.">
                        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-2 py-2">
                          <CustomSelect
                            value={bulkMode}
                            onChange={(value) => setBulkMode(value as "ban" | "cap")}
                            options={[
                              { value: "ban", label: "Запрет" },
                              { value: "cap", label: "Лимит" },
                            ]}
                            buttonClassName="h-8 text-xs"
                          />
                          <button
                            type="button"
                            onClick={applyBulkMode}
                            className="h-8 rounded-lg border border-amber-400/35 bg-amber-500/15 px-2 text-[11px] font-semibold text-amber-200"
                          >
                            Применить всем
                          </button>
                        </div>
                      </Tooltip>
                      <button
                        type="button"
                        onClick={addRule}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-3 text-xs font-semibold text-emerald-200"
                      >
                        <Plus size={13} /> Добавить товар
                      </button>
                    </div>
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        disabled={!targetId || validRules.length === 0}
                        onClick={() => setConfirmOpen(true)}
                        className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-4 text-xs font-semibold text-emerald-200 disabled:opacity-50"
                      >
                        <Save size={13} /> Применить пакет
                      </button>
                    </div>
                  </div>
                </div>

                <div className="panel-border flex min-h-[720px] flex-col rounded-xl bg-black/25">
                  <div className="sticky top-0 z-20 border-b border-white/10 bg-[#0b111b]/95 p-3 backdrop-blur">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white/85">
                      <Filter size={14} className="text-cyan-300" />
                      Санкции
                    </div>
                  </div>

                  <div className="sticky top-[57px] z-10 border-b border-white/10 bg-[#0b111b]/95 p-3 backdrop-blur">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
                        <Filter size={14} className="text-cyan-300" />
                        Список санкций
                      </div>
                      <CustomSelect
                        value={statusFilter}
                        onChange={(value) => setStatusFilter(value as StatusFilter)}
                        options={[
                          { value: "all", label: "Все" },
                          { value: "active", label: "Активные" },
                          { value: "expired", label: "Истекшие" },
                          { value: "paused", label: "Выключенные" },
                        ]}
                        buttonClassName="h-8 text-xs"
                      />
                    </div>
                  </div>

                  <div className="arc-scrollbar flex-1 overflow-auto p-3">
                    <div className="space-y-2">
                      {filteredSanctions.map((sanction) => {
                        const badge = statusChip(sanction, turnId);
                        const expiresAtTurn = Number(sanction.expiresAtTurn ?? sanction.startTurn + sanction.durationTurns);
                        const turnsLeft = Math.max(0, expiresAtTurn - turnId);
                        return (
                          <div
                            key={sanction.id}
                            className="rounded-lg border border-white/10 bg-black/30 p-2 text-xs transition-all duration-150 hover:-translate-y-[1px] hover:border-arc-accent/35"
                          >
                            <div className="mb-1 flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 font-semibold text-white/85">
                                  {getDirectionIcon(sanction.direction)}
                                  <span>{directionLabel(sanction.direction)}</span>
                                  <span className="text-white/45">·</span>
                                  <span>{sanction.mode === "ban" ? "Запрет" : `Лимит ${sanction.capAmountPerTurn ?? 0}`}</span>
                                </div>
                                <div className="truncate text-white/55">
                                  {sanction.targetType === "country" ? "Страна" : "Рынок"}: {sanction.targetName ?? sanction.targetId}
                                </div>
                              </div>
                              <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${badge.className}`}>{badge.label}</span>
                            </div>
                            <div className="mb-2 flex items-center gap-3 text-[11px] text-white/60">
                              <span className="inline-flex items-center gap-1">
                                <Clock3 size={12} />
                                осталось {turnsLeft} ход.
                              </span>
                              <span>Период: {sanction.startTurn}-{expiresAtTurn}</span>
                            </div>
                            <div className="mb-2 flex flex-wrap gap-1">
                              {(sanction.goodsNamed ?? []).map((good) => (
                                <span key={good.id} className="rounded-md border border-white/15 bg-black/35 px-2 py-0.5 text-white/75">
                                  {good.name}
                                </span>
                              ))}
                              {(sanction.goodsNamed?.length ?? 0) === 0 && (
                                <span className="rounded-md border border-white/15 bg-black/35 px-2 py-0.5 text-white/60">
                                  Все товары
                                </span>
                              )}
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => void toggleEnabled(sanction)}
                                className="h-8 rounded-lg border border-white/15 bg-black/35 px-2 text-[11px] text-white/70"
                              >
                                {sanction.enabled === false ? "Включить" : "Выключить"}
                              </button>
                              <button
                                type="button"
                                disabled={pendingDeleteId === sanction.id}
                                onClick={() => void removeSanction(sanction.id)}
                                className="h-8 rounded-lg border border-red-400/40 bg-red-500/20 px-2 text-[11px] font-semibold text-red-200 disabled:opacity-50"
                              >
                                Удалить
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {filteredSanctions.length === 0 && (
                        <div className="rounded-lg border border-dashed border-white/20 bg-black/20 p-4 text-xs text-white/45">
                          По фильтру ничего не найдено.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Dialog.Panel>
        </div>
      </Dialog>

      <Dialog open={confirmOpen} onClose={() => (pendingApply ? undefined : setConfirmOpen(false))} className="fixed inset-0 z-[182]">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        <div className="absolute inset-4 flex items-center justify-center">
          <Dialog.Panel
            as={motion.div}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="panel-border w-[min(92vw,520px)] rounded-2xl bg-[#0b111b] p-4"
          >
            <div className="mb-3 text-sm font-semibold text-white">Подтверждение</div>
            <div className="rounded-lg border border-white/10 bg-black/25 p-3 text-sm text-white/75">
              Будет создано санкций: <span className="font-semibold text-white">{validRules.length}</span>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={pendingApply}
                onClick={() => setConfirmOpen(false)}
                className="h-9 rounded-lg border border-white/15 bg-black/30 px-3 text-xs text-white/70 disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={pendingApply}
                onClick={() => void applyRules()}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-3 text-xs font-semibold text-emerald-200 disabled:opacity-50"
              >
                <Save size={13} /> Применить
              </button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </>
  );
}
