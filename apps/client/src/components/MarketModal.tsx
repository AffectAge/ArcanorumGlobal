import { Dialog } from "@headlessui/react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDownUp,
  Globe2,
  ImagePlus,
  LineChart,
  LogOut,
  Save,
  Send,
  SlidersHorizontal,
  TrendingDown,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  createMarketInvite,
  fetchCountries,
  fetchCountryMarketInvites,
  fetchMarketDetails,
  fetchMarketOverview,
  leaveMarket,
  respondMarketInvite,
  updateMarket,
  type MarketDetails,
  type MarketInvite,
  type MarketOverviewResponse,
} from "../lib/api";
import { CustomSelect } from "./CustomSelect";
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

export function MarketModal({ open, onClose, token, countryId, countryName, mode = "both", title = "Рынок" }: Props) {
  const [overview, setOverview] = useState<MarketOverviewResponse | null>(null);
  const [marketDetails, setMarketDetails] = useState<MarketDetails | null>(null);
  const [countries, setCountries] = useState<Array<{ id: string; name: string; flagUrl?: string | null }>>([]);
  const [incomingInvites, setIncomingInvites] = useState<MarketInvite[]>([]);
  const [tab, setTab] = useState<ViewTab>("country");
  const [sortMode, setSortMode] = useState<SortMode>("deficit");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [marketNameEdit, setMarketNameEdit] = useState("");
  const [marketVisibilityEdit, setMarketVisibilityEdit] = useState<"public" | "private">("public");
  const [marketLogoFile, setMarketLogoFile] = useState<File | null>(null);
  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteTargetCountryId, setInviteTargetCountryId] = useState("");
  const [pendingSave, setPendingSave] = useState(false);
  const [pendingInvite, setPendingInvite] = useState(false);
  const [pendingInviteActionId, setPendingInviteActionId] = useState<string | null>(null);
  const [pendingLeave, setPendingLeave] = useState(false);

  const effectiveTab: ViewTab = mode === "global" ? "global" : mode === "country" ? "country" : tab;

  const loadMarketData = async () => {
    const nextOverview = await fetchMarketOverview(token);
    setOverview(nextOverview);
    if (mode !== "global") {
      const [details, invites, allCountries] = await Promise.all([
        fetchMarketDetails(token, nextOverview.marketId),
        fetchCountryMarketInvites(token),
        fetchCountries(),
      ]);
      setMarketDetails(details.market);
      setIncomingInvites(invites.invites ?? []);
      setCountries(allCountries);
      setMarketNameEdit(details.market.name);
      setMarketVisibilityEdit(details.market.visibility);
      setMarketLogoFile(null);
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        await loadMarketData();
      } catch {
        if (!cancelled) {
          setOverview(null);
          setMarketDetails(null);
          setIncomingInvites([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, token, mode]);

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

  const criticalCount = useMemo(() => rows.filter((row) => row.coverage < 50).length, [rows]);
  const infraOverloadCount = useMemo(() => infraRows.filter((row) => row.coverage < 1).length, [infraRows]);

  const isOwner = marketDetails?.ownerCountryId === countryId;
  const marketMemberIds = useMemo(() => new Set(marketDetails?.memberCountryIds ?? []), [marketDetails?.memberCountryIds]);

  const inviteOptions = useMemo(() => {
    const q = inviteSearch.trim().toLowerCase();
    return countries
      .filter((country) => !marketMemberIds.has(country.id))
      .filter((country) => {
        if (!q) return true;
        return country.name.toLowerCase().includes(q) || country.id.toLowerCase().includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((country) => ({ value: country.id, label: `${country.name} (${country.id})` }));
  }, [countries, inviteSearch, marketMemberIds]);

  useEffect(() => {
    if (!inviteOptions.some((option) => option.value === inviteTargetCountryId)) {
      setInviteTargetCountryId(inviteOptions[0]?.value ?? "");
    }
  }, [inviteOptions, inviteTargetCountryId]);

  const handleSaveMarket = async () => {
    if (!marketDetails || !isOwner) return;
    try {
      setPendingSave(true);
      const updated = await updateMarket(token, marketDetails.id, {
        name: marketNameEdit,
        visibility: marketVisibilityEdit,
        logoFile: marketLogoFile,
      });
      setMarketDetails(updated.market);
      setMarketNameEdit(updated.market.name);
      setMarketVisibilityEdit(updated.market.visibility);
      setMarketLogoFile(null);
      toast.success("Параметры рынка обновлены");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить рынок");
    } finally {
      setPendingSave(false);
    }
  };

  const handleInvite = async () => {
    if (!marketDetails || !isOwner || !inviteTargetCountryId) return;
    try {
      setPendingInvite(true);
      await createMarketInvite(token, marketDetails.id, { toCountryId: inviteTargetCountryId });
      toast.success("Приглашение отправлено");
      setInviteSearch("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить приглашение");
    } finally {
      setPendingInvite(false);
    }
  };

  const handleInviteAction = async (inviteId: string, action: "accept" | "reject") => {
    try {
      setPendingInviteActionId(inviteId);
      await respondMarketInvite(token, inviteId, action);
      await loadMarketData();
      toast.success(action === "accept" ? "Приглашение принято" : "Приглашение отклонено");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обработать приглашение");
    } finally {
      setPendingInviteActionId(null);
    }
  };

  const handleLeaveMarket = async () => {
    if (!marketDetails || isOwner) return;
    try {
      setPendingLeave(true);
      await leaveMarket(token, marketDetails.id);
      await loadMarketData();
      toast.success("Вы вышли из рынка");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось выйти из рынка");
    } finally {
      setPendingLeave(false);
    }
  };

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
          className="panel-border flex h-[min(92vh,980px)] w-[min(96vw,1500px)] flex-col overflow-hidden rounded-2xl bg-[#0b111b] shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-white/10 bg-[#0e1523] px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-white">{title}</h2>
              <p className="text-xs text-white/60">
                {effectiveTab === "country" ? `Наш рынок (${countryName})` : "Глобальный рынок"}
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

            <div className="arc-scrollbar min-h-0 space-y-3 overflow-auto pr-1">
              <div className="panel-border rounded-xl bg-black/25 p-3">
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
              </div>

              <div className="panel-border rounded-xl bg-black/30 p-3">
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

              {mode !== "global" && marketDetails && (
                <div className="panel-border rounded-xl bg-black/30 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-white/80">Управление рынком</div>
                    <span className="rounded-md border border-white/10 bg-black/35 px-2 py-0.5 text-[11px] text-white/60">
                      {marketDetails.memberCountryIds.length} участников
                    </span>
                  </div>

                  <div className="mb-2 flex items-center gap-2">
                    {marketDetails.logoUrl ? (
                      <img src={marketDetails.logoUrl} alt="" className="h-8 w-8 rounded-md border border-white/10 object-cover" />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-black/40 text-white/40">
                        <Globe2 size={14} />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white/85">{marketDetails.name}</div>
                      <div className="truncate text-[11px] text-white/50">Владелец: {marketDetails.ownerCountryName}</div>
                    </div>
                  </div>

                  {isOwner ? (
                    <div className="space-y-2">
                      <label className="block text-[11px] text-white/55">Название</label>
                      <input
                        value={marketNameEdit}
                        onChange={(event) => setMarketNameEdit(event.target.value)}
                        className="panel-border h-9 w-full rounded-lg bg-black/35 px-3 text-sm text-white outline-none"
                      />

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-[11px] text-white/55">Видимость</label>
                          <CustomSelect
                            value={marketVisibilityEdit}
                            onChange={(value) => setMarketVisibilityEdit(value as "public" | "private")}
                            options={[
                              { value: "public", label: "Публичный" },
                              { value: "private", label: "Приватный" },
                            ]}
                            buttonClassName="h-9 text-xs"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] text-white/55">Логотип</label>
                          <label className="panel-border flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg bg-black/35 text-xs text-white/75 hover:border-arc-accent/40">
                            <ImagePlus size={13} />
                            Загрузить
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(event) => setMarketLogoFile(event.target.files?.[0] ?? null)}
                            />
                          </label>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={pendingSave}
                        onClick={handleSaveMarket}
                        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/20 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/30 disabled:opacity-60"
                      >
                        <Save size={13} /> Сохранить
                      </button>

                      <div className="rounded-lg border border-white/10 bg-black/25 p-2">
                        <div className="mb-1 text-[11px] font-semibold text-white/70">Пригласить страну</div>
                        <input
                          value={inviteSearch}
                          onChange={(event) => setInviteSearch(event.target.value)}
                          placeholder="Поиск страны"
                          className="panel-border mb-2 h-8 w-full rounded-md bg-black/35 px-2 text-xs text-white outline-none"
                        />
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <CustomSelect
                              value={inviteTargetCountryId}
                              onChange={setInviteTargetCountryId}
                              options={inviteOptions}
                              placeholder="Выберите страну"
                              buttonClassName="h-8 text-xs"
                            />
                          </div>
                          <Tooltip content="Отправить приглашение на вступление в рынок">
                            <button
                              type="button"
                              disabled={pendingInvite || !inviteTargetCountryId}
                              onClick={handleInvite}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-emerald-400/40 bg-emerald-500/20 text-emerald-200 transition hover:bg-emerald-500/30 disabled:opacity-50"
                            >
                              <Send size={13} />
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="rounded-lg border border-white/10 bg-black/25 p-2 text-xs text-white/60">
                        Управление доступно только владельцу рынка.
                      </div>
                      <button
                        type="button"
                        disabled={pendingLeave}
                        onClick={handleLeaveMarket}
                        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/20 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/30 disabled:opacity-60"
                      >
                        <LogOut size={13} /> Выйти из рынка
                      </button>
                    </div>
                  )}

                  <div className="mt-2 rounded-lg border border-white/10 bg-black/25 p-2">
                    <div className="mb-1 text-[11px] font-semibold text-white/70">Участники</div>
                    <div className="space-y-1">
                      {marketDetails.members.map((member) => (
                        <div key={member.countryId} className="flex items-center justify-between rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-white/70">
                          <span className="truncate">{member.countryName}</span>
                          {member.isOwner && <span className="text-emerald-200">owner</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {mode !== "global" && (
                <div className="panel-border rounded-xl bg-black/30 p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white/80">
                    <UserPlus size={14} className="text-arc-accent" />
                    Входящие приглашения
                  </div>
                  <div className="space-y-2">
                    {incomingInvites.map((invite) => (
                      <div key={invite.id} className="rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-white/70">
                        <div className="font-semibold text-white/85">{invite.marketName ?? invite.marketId}</div>
                        <div className="text-white/50">От: {invite.fromCountryName ?? invite.fromCountryId}</div>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            disabled={pendingInviteActionId === invite.id}
                            onClick={() => void handleInviteAction(invite.id, "accept")}
                            className="h-7 rounded-md border border-emerald-400/40 bg-emerald-500/20 px-2 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-500/30 disabled:opacity-50"
                          >
                            Принять
                          </button>
                          <button
                            type="button"
                            disabled={pendingInviteActionId === invite.id}
                            onClick={() => void handleInviteAction(invite.id, "reject")}
                            className="h-7 rounded-md border border-red-400/40 bg-red-500/20 px-2 text-[11px] font-semibold text-red-200 transition hover:bg-red-500/30 disabled:opacity-50"
                          >
                            Отклонить
                          </button>
                        </div>
                      </div>
                    ))}
                    {incomingInvites.length === 0 && <div className="text-xs text-white/45">Приглашений нет.</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
