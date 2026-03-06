import { Dialog } from "@headlessui/react";
import { motion } from "framer-motion";
import { Plus, Save, ShieldBan, Trash2, X } from "lucide-react";
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

type Props = {
  open: boolean;
  onClose: () => void;
  token: string;
  countryId: string;
  marketId: string | null;
  onUpdated?: () => void;
};

export function MarketSanctionsModal({ open, onClose, token, countryId, marketId, onUpdated }: Props) {
  type DraftGoodRule = {
    rowId: string;
    goodId: string;
    direction: "import" | "export" | "both";
    mode: "ban" | "cap";
    capAmount: string;
  };

  const [loading, setLoading] = useState(false);
  const [ownerCountryId, setOwnerCountryId] = useState<string | null>(null);
  const [sanctions, setSanctions] = useState<MarketSanction[]>([]);
  const [countries, setCountries] = useState<Array<{ id: string; name: string }>>([]);
  const [goods, setGoods] = useState<Array<{ id: string; name: string }>>([]);
  const [marketsCatalog, setMarketsCatalog] = useState<Array<{ id: string; name: string }>>([]);

  const [pendingCreate, setPendingCreate] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const [targetType, setTargetType] = useState<"country" | "market">("country");
  const [targetId, setTargetId] = useState("");
  const [duration, setDuration] = useState("30");
  const [draftRules, setDraftRules] = useState<DraftGoodRule[]>([]);

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
      setCountries((allCountries ?? []).map((row) => ({ id: row.id, name: row.name })));
      setGoods((goodsEntries ?? []).map((row) => ({ id: row.id, name: row.name })));
      setMarketsCatalog((marketsRes.markets ?? []).map((row) => ({ id: row.id, name: row.name })));
      setDraftRules((prev) => {
        if (prev.length > 0) return prev;
        const firstGoodId = (goodsEntries ?? [])[0]?.id ?? "";
        if (!firstGoodId) return [];
        return [
          {
            rowId: crypto.randomUUID(),
            goodId: firstGoodId,
            direction: "both",
            mode: "ban",
            capAmount: "0",
          },
        ];
      });
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

  const isOwner = ownerCountryId === countryId;

  const targetOptions = useMemo(() => {
    if (targetType === "country") {
      return countries
        .filter((row) => row.id !== ownerCountryId)
        .sort((a, b) => a.name.localeCompare(b.name, "ru"))
        .map((row) => ({ value: row.id, label: `${row.name} (${row.id})` }));
    }
    return marketsCatalog
      .filter((row) => row.id !== marketId)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((row) => ({ value: row.id, label: `${row.name} (${row.id})` }));
  }, [countries, targetType, ownerCountryId, marketsCatalog, marketId]);

  useEffect(() => {
    if (!targetOptions.some((option) => option.value === targetId)) {
      setTargetId(targetOptions[0]?.value ?? "");
    }
  }, [targetOptions, targetId]);

  useEffect(() => {
    if (goods.length === 0) {
      setDraftRules([]);
      return;
    }
    setDraftRules((prev) => {
      if (prev.length > 0) return prev;
      return [
        {
          rowId: crypto.randomUUID(),
          goodId: goods[0]?.id ?? "",
          direction: "both",
          mode: "ban",
          capAmount: "0",
        },
      ];
    });
  }, [goods]);

  const goodsOptions = useMemo(
    () =>
      goods
        .map((good) => ({ value: good.id, label: `${good.name} (${good.id})` }))
        .sort((a, b) => a.label.localeCompare(b.label, "ru")),
    [goods],
  );

  const updateRule = (rowId: string, patch: Partial<DraftGoodRule>) => {
    setDraftRules((prev) => prev.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  };

  const addRule = () => {
    if (goods.length === 0) return;
    setDraftRules((prev) => [
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
    setDraftRules((prev) => prev.filter((row) => row.rowId !== rowId));
  };

  const addSanction = async () => {
    if (!marketId || !isOwner || !targetId) return;
    if (draftRules.length === 0) {
      toast.error("Добавьте хотя бы один товар");
      return;
    }
    setPendingCreate(true);
    try {
      const goodsSet = new Set(goods.map((good) => good.id));
      const validRows = draftRules.filter((row) => goodsSet.has(row.goodId));
      if (validRows.length === 0) {
        toast.error("Выберите валидные товары");
        return;
      }
      const durationTurns = Math.max(1, Math.floor(Number(duration || 1)));
      for (const row of validRows) {
        const capValue = Math.max(0, Number(row.capAmount || 0));
        const capAmountPerTurn = row.mode === "cap" ? capValue : null;
        if (row.mode === "cap" && (!Number.isFinite(capValue) || capValue <= 0)) {
          toast.error(`Для товара ${row.goodId} укажите лимит больше 0`);
          return;
        }
        await createMarketSanction(token, marketId, {
          direction: row.direction,
          targetType,
          targetId,
          goods: [row.goodId],
          mode: row.mode,
          capAmountPerTurn,
          durationTurns,
        });
      }
      toast.success(`Добавлено санкций: ${validRows.length}`);
      await load();
      onUpdated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось добавить санкцию");
    } finally {
      setPendingCreate(false);
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
    <Dialog open={open} onClose={onClose} className="fixed inset-0 z-[181]">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      <div className="absolute inset-4 flex items-center justify-center">
        <Dialog.Panel
          as={motion.div}
          initial={{ opacity: 0, y: 12, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="panel-border arc-scrollbar h-[min(92vh,920px)] w-[min(92vw,920px)] overflow-auto rounded-2xl bg-[#0b111b] p-4"
        >
          <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <h3 className="text-lg font-semibold text-white">Санкции рынка</h3>
              <p className="text-xs text-white/60">Запреты и лимиты импорта/экспорта по странам, рынкам и товарам</p>
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
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white/80">
                  <ShieldBan size={14} className="text-rose-300" />
                  Новая санкция
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <CustomSelect
                    value={targetType}
                    onChange={(value) => setTargetType(value as "country" | "market")}
                    options={[
                      { value: "country", label: "Цель: страна" },
                      { value: "market", label: "Цель: рынок" },
                    ]}
                    buttonClassName="h-9 text-xs"
                  />
                  <CustomSelect
                    value={targetId}
                    onChange={setTargetId}
                    options={targetOptions}
                    placeholder="Выберите цель"
                    buttonClassName="h-9 text-xs"
                  />
                  <input
                    value={duration}
                    onChange={(event) => setDuration(event.target.value.replace(/[^\d]/g, ""))}
                    placeholder="Срок (ходов)"
                    className="panel-border h-9 rounded-lg bg-black/35 px-3 text-sm text-white outline-none"
                  />
                </div>
                <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-2">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-semibold text-white/70">Товары санкции</div>
                    <button
                      type="button"
                      onClick={addRule}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-2 text-[11px] font-semibold text-emerald-200"
                    >
                      <Plus size={12} /> Товар
                    </button>
                  </div>
                  <div className="space-y-2">
                    {draftRules.map((row) => (
                      <div
                        key={row.rowId}
                        className="grid grid-cols-1 gap-2 rounded-lg border border-white/10 bg-black/25 p-2 md:grid-cols-[1.5fr_1fr_1fr_1fr_auto]"
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
                            { value: "both", label: "Импорт+Экспорт" },
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
                          className="panel-border h-9 rounded-lg bg-black/35 px-3 text-sm text-white outline-none disabled:opacity-50"
                        />
                        <button
                          type="button"
                          onClick={() => removeRule(row.rowId)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-400/40 bg-red-500/20 text-red-200"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                    {draftRules.length === 0 && (
                      <div className="text-xs text-white/45">Добавьте минимум один товар.</div>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-end">
                  <button
                    type="button"
                    disabled={pendingCreate || !targetId || draftRules.length === 0}
                    onClick={() => void addSanction()}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-3 text-xs font-semibold text-emerald-200 disabled:opacity-50"
                  >
                    <Save size={13} /> Добавить санкцию
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="mb-2 text-sm font-semibold text-white/80">Список санкций</div>
                <div className="space-y-1">
                  {sanctions.map((sanction) => (
                    <div
                      key={sanction.id}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-white/80">
                          {sanction.mode === "ban" ? "Запрет" : `Лимит ${sanction.capAmountPerTurn ?? 0}`} ·{" "}
                          {sanction.direction} · {sanction.targetType === "country" ? "страна" : "рынок"}:{" "}
                          {sanction.targetName ?? sanction.targetId}
                        </div>
                        <div className="truncate text-white/50">
                          Ходы: {sanction.startTurn} - {sanction.expiresAtTurn ?? sanction.startTurn + sanction.durationTurns} ·{" "}
                          {sanction.activeNow ? "Активна" : "Неактивна"} · {sanction.enabled === false ? "Выключена" : "Включена"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
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
                  ))}
                  {sanctions.length === 0 && <div className="text-xs text-white/45">Санкций пока нет.</div>}
                </div>
              </div>
            </div>
          )}
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
