import { Dialog } from "@headlessui/react";
import type { WorldBase } from "@arcanorum/shared";
import { motion } from "framer-motion";
import { Building2, Coins, Factory, Hammer, MapPin, Trash2, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchContentEntries, type ContentEntry } from "../lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  worldBase: WorldBase | null;
  countryId: string;
  countryName: string;
  onQueueBuildOrder: (provinceId: string, payload?: Record<string, unknown>) => void;
};

type NamedItem = { id: string; name: string; color: string; logoUrl?: string | null };
type SortMode = "building" | "province" | "ducats" | "workers";
type FilterActive = "all" | "active" | "inactive";

function formatInt(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.max(0, Math.floor(value)));
}

function formatNum(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Math.max(0, value));
}

function entryById(items: ContentEntry[]): Record<string, NamedItem> {
  return Object.fromEntries(
    items.map((item) => [
      item.id,
      { id: item.id, name: item.name, color: item.color, logoUrl: item.logoUrl ?? null },
    ]),
  );
}

export function ProvinceBuildingsModal({ open, onClose, worldBase, countryId, countryName, onQueueBuildOrder }: Props) {
  const [filterBuildingId, setFilterBuildingId] = useState<string>("");
  const [filterProvinceId, setFilterProvinceId] = useState<string>("");
  const [filterActive, setFilterActive] = useState<FilterActive>("all");
  const [sortMode, setSortMode] = useState<SortMode>("building");
  const [buildings, setBuildings] = useState<ContentEntry[]>([]);
  const [goods, setGoods] = useState<ContentEntry[]>([]);
  const [professions, setProfessions] = useState<ContentEntry[]>([]);
  const [companies, setCompanies] = useState<ContentEntry[]>([]);
  const [constructionOpen, setConstructionOpen] = useState(false);
  const [constructionProvinceId, setConstructionProvinceId] = useState("");
  const [constructionBuildingId, setConstructionBuildingId] = useState("");
  const [constructionOwnerType, setConstructionOwnerType] = useState<"state" | "company">("state");
  const [constructionOwnerCountryId, setConstructionOwnerCountryId] = useState("");
  const [constructionOwnerCompanyId, setConstructionOwnerCompanyId] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      fetchContentEntries("buildings"),
      fetchContentEntries("goods"),
      fetchContentEntries("professions"),
      fetchContentEntries("companies"),
    ])
      .then(([nextBuildings, nextGoods, nextProfessions, nextCompanies]) => {
        if (cancelled) return;
        setBuildings(nextBuildings);
        setGoods(nextGoods);
        setProfessions(nextProfessions);
        setCompanies(nextCompanies);
      })
      .catch(() => {
        if (cancelled) return;
        setBuildings([]);
        setGoods([]);
        setProfessions([]);
        setCompanies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const goodById = useMemo(() => entryById(goods), [goods]);
  const professionById = useMemo(() => entryById(professions), [professions]);

  const provinceItems = useMemo(() => {
    if (!worldBase) return [];
    const ids = new Set<string>();
    for (const [provinceId, owner] of Object.entries(worldBase.provinceOwner ?? {})) {
      if (owner === countryId) ids.add(provinceId);
    }
    for (const provinceId of Object.keys(worldBase.provinceBuildingsByProvince ?? {})) {
      if ((worldBase.provinceOwner?.[provinceId] ?? "") === countryId) ids.add(provinceId);
    }
    return [...ids]
      .map((provinceId) => {
        const name = worldBase.provinceNameById?.[provinceId] || provinceId;
        const levels = worldBase.provinceBuildingsByProvince?.[provinceId] ?? {};
        const totalLevels = Object.values(levels).reduce((sum, v) => sum + Math.max(0, Number(v) || 0), 0);
        return { provinceId, name, totalLevels };
      })
      .sort((a, b) => b.totalLevels - a.totalLevels || a.name.localeCompare(b.name, "ru"));
  }, [countryId, worldBase]);

  const cards = useMemo(() => {
    if (!worldBase) return [];
    return provinceItems.flatMap((province) => {
      const levels = worldBase.provinceBuildingsByProvince?.[province.provinceId] ?? {};
      const buildingDucats = worldBase.provinceBuildingDucatsByProvince?.[province.provinceId] ?? {};
      const population = worldBase.provincePopulationByProvince?.[province.provinceId];
      const populationTotal = Math.max(0, population?.populationTotal ?? 0);

      return Object.entries(levels)
        .map(([buildingId, levelRaw]) => {
          const level = Math.max(0, Math.floor(Number(levelRaw) || 0));
          if (level <= 0) return null;
          const entry = buildings.find((b) => b.id === buildingId);
          if (!entry) return null;

          const workforceNeeds = (entry.workforceRequirements ?? []).map((row) => ({
            professionId: row.professionId,
            workers: Math.max(0, row.workers) * level,
          }));
          const workersDemand = workforceNeeds.reduce((sum, row) => sum + row.workers, 0);
          const employedRatio = workersDemand > 0 ? Math.max(0, Math.min(1, populationTotal / workersDemand)) : 0;
          const workersEmployed = workersDemand * employedRatio;
          const isActive = workersDemand === 0 ? true : workersEmployed > 0;
          const inactiveReason = workersDemand > 0 && workersEmployed <= 0 ? "Нет доступной рабочей силы" : "";

          return {
            key: `${province.provinceId}-${buildingId}`,
            provinceId: province.provinceId,
            provinceName: province.name,
            id: buildingId,
            name: entry.name,
            color: entry.color,
            logoUrl: entry.logoUrl ?? null,
            level,
            isActive,
            inactiveReason,
            ducats: Math.max(0, Number(buildingDucats[buildingId] ?? 0)),
            workersDemand,
            workersEmployed,
            inputs: (entry.inputs ?? []).map((row) => ({ goodId: row.goodId, amount: row.amount * level * employedRatio })),
            outputs: (entry.outputs ?? []).map((row) => ({ goodId: row.goodId, amount: row.amount * level * employedRatio })),
            workforceNeeds,
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row));
    });
  }, [buildings, provinceItems, worldBase]);

  const filteredCards = useMemo(() => {
    const filtered = cards.filter((card) => {
      if (filterBuildingId && card.id !== filterBuildingId) return false;
      if (filterProvinceId && card.provinceId !== filterProvinceId) return false;
      if (filterActive === "active" && !card.isActive) return false;
      if (filterActive === "inactive" && card.isActive) return false;
      return true;
    });

    filtered.sort((a, b) => {
      if (sortMode === "province") {
        return a.provinceName.localeCompare(b.provinceName, "ru") || a.name.localeCompare(b.name, "ru");
      }
      if (sortMode === "ducats") {
        return b.ducats - a.ducats || b.level - a.level || a.name.localeCompare(b.name, "ru");
      }
      if (sortMode === "workers") {
        return b.workersEmployed - a.workersEmployed || b.level - a.level || a.name.localeCompare(b.name, "ru");
      }
      return a.name.localeCompare(b.name, "ru") || a.provinceName.localeCompare(b.provinceName, "ru");
    });

    return filtered;
  }, [cards, filterActive, filterBuildingId, filterProvinceId, sortMode]);

  const groupedByProvince = useMemo(() => {
    const map = new Map<string, typeof filteredCards>();
    for (const card of filteredCards) {
      const key = card.provinceId;
      map.set(key, [...(map.get(key) ?? []), card]);
    }
    return map;
  }, [filteredCards]);

  const countryOptions = useMemo(
    () => Object.keys(worldBase?.resourcesByCountry ?? {}).sort((a, b) => a.localeCompare(b, "ru")),
    [worldBase?.resourcesByCountry],
  );

  const selectedConstructionBuilding = useMemo(
    () => buildings.find((item) => item.id === constructionBuildingId) ?? null,
    [buildings, constructionBuildingId],
  );

  useEffect(() => {
    if (!open) return;
    const defaultProvince = provinceItems[0]?.provinceId ?? "";
    const defaultBuilding = buildings[0]?.id ?? "";
    const defaultCountry = countryOptions.includes(countryId) ? countryId : countryOptions[0] ?? "";
    const defaultCompany = companies[0]?.id ?? "";
    setConstructionProvinceId(defaultProvince);
    setConstructionBuildingId(defaultBuilding);
    setConstructionOwnerType("state");
    setConstructionOwnerCountryId(defaultCountry);
    setConstructionOwnerCompanyId(defaultCompany);
  }, [open, provinceItems, buildings, countryOptions, companies, countryId]);

  const submitConstruction = () => {
    if (!constructionProvinceId || !constructionBuildingId) return;
    const ownerPayload =
      constructionOwnerType === "company"
        ? { type: "company", companyId: constructionOwnerCompanyId }
        : { type: "state", countryId: constructionOwnerCountryId || countryId };
    if (constructionOwnerType === "company" && !constructionOwnerCompanyId) return;
    onQueueBuildOrder(constructionProvinceId, {
      buildingId: constructionBuildingId,
      owner: ownerPayload,
    });
    setConstructionOpen(false);
  };

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
                <Dialog.Title className="font-display text-2xl tracking-wide text-arc-accent">Постройки</Dialog.Title>
                <span className="mt-1 block text-xs text-white/60">Индустрия и дукаты зданий страны {countryName}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConstructionOpen(true)}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-400/35 bg-emerald-500/15 px-3 text-xs text-emerald-200 transition hover:bg-emerald-500/25"
                  title="Открыть окно строительства"
                >
                  <Hammer size={14} />
                  Строительство
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="panel-border inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-slate-300 transition hover:text-arc-accent"
                  aria-label="Закрыть"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 lg:grid-rows-[auto_minmax(0,1fr)]">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                <label className="flex flex-col gap-1 text-xs text-white/65">
                  Фильтр по зданию
                  <select
                    value={filterBuildingId}
                    onChange={(event) => setFilterBuildingId(event.target.value)}
                    className="h-10 rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white outline-none focus:border-arc-accent/40"
                  >
                    <option value="">Все здания</option>
                    {buildings.map((building) => (
                      <option key={building.id} value={building.id}>
                        {building.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/65">
                  Фильтр по провинции
                  <select
                    value={filterProvinceId}
                    onChange={(event) => setFilterProvinceId(event.target.value)}
                    className="h-10 rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white outline-none focus:border-arc-accent/40"
                  >
                    <option value="">Все провинции</option>
                    {provinceItems.map((province) => (
                      <option key={province.provinceId} value={province.provinceId}>
                        {province.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/65">
                  Активность
                  <select
                    value={filterActive}
                    onChange={(event) => setFilterActive(event.target.value as FilterActive)}
                    className="h-10 rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white outline-none focus:border-arc-accent/40"
                  >
                    <option value="all">Все</option>
                    <option value="active">Только активные</option>
                    <option value="inactive">Только неактивные</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/65">
                  Сортировка
                  <select
                    value={sortMode}
                    onChange={(event) => setSortMode(event.target.value as SortMode)}
                    className="h-10 rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white outline-none focus:border-arc-accent/40"
                  >
                    <option value="building">По зданию</option>
                    <option value="province">По провинции</option>
                    <option value="ducats">По дукатам</option>
                    <option value="workers">По рабочим</option>
                  </select>
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => {
                      setFilterBuildingId("");
                      setFilterProvinceId("");
                      setFilterActive("all");
                      setSortMode("building");
                    }}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white/70 transition hover:border-arc-accent/40 hover:text-arc-accent"
                  >
                    <Trash2 size={14} />
                    Сбросить
                  </button>
                </div>
              </div>

              <section className="min-h-0">
                {provinceItems.length === 0 && (
                  <div className="rounded-xl border border-dashed border-white/15 bg-black/20 p-4 text-sm text-white/50">
                    Нет ваших провинций.
                  </div>
                )}
                {provinceItems.length > 0 && filteredCards.length === 0 && (
                  <div className="rounded-xl border border-dashed border-white/15 bg-black/20 p-4 text-sm text-white/50">
                    По выбранным фильтрам ничего не найдено.
                  </div>
                )}

                {filteredCards.length > 0 && !filterProvinceId && (
                  <div className="arc-scrollbar max-h-[calc(100vh-20rem)] space-y-4 overflow-auto pr-1">
                    {[...groupedByProvince.entries()].map(([provinceId, provinceCards]) => (
                      <div key={provinceId} className="space-y-3">
                        <div className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-xs text-white/70">
                          {provinceCards[0]?.provinceName ?? provinceId}
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {provinceCards.map((row) => (
                            <article
                              key={row.key}
                              className={`rounded-2xl border bg-gradient-to-br from-white/5 to-transparent p-4 shadow-lg shadow-black/30 ${
                                row.isActive ? "border-white/10" : "border-red-400/55"
                              }`}
                            >
                              <div className="mb-3 flex items-start justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-3">
                                  <div
                                    className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg border border-white/10"
                                    style={{ boxShadow: `0 0 0 1px ${row.color}33 inset`, backgroundColor: `${row.color}22` }}
                                  >
                                    {row.logoUrl ? (
                                      <img src={row.logoUrl} alt="" className="h-full w-full object-cover" />
                                    ) : (
                                      <Factory size={16} style={{ color: row.color }} />
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-white">{row.name}</div>
                                    <div className="text-[11px] text-white/45">Уровень: {formatInt(row.level)}</div>
                                  </div>
                                </div>
                                {!row.isActive && (
                                  <span className="rounded-full border border-red-400/40 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-200">
                                    Неактивно
                                  </span>
                                )}
                              </div>

                              <div className="mb-3 space-y-1 text-xs text-white/65">
                                <div className="flex items-center justify-between">
                                  <span className="inline-flex items-center gap-1">
                                    <Coins size={13} />
                                    Дукаты здания
                                  </span>
                                  <span className="tabular-nums text-amber-300">{formatNum(row.ducats)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="inline-flex items-center gap-1">
                                    <Users size={13} />
                                    Рабочие
                                  </span>
                                  <span className="tabular-nums text-white/75">
                                    {formatInt(row.workersEmployed)} / {formatInt(row.workersDemand)}
                                  </span>
                                </div>
                                {!row.isActive && row.inactiveReason && <div className="text-[11px] text-red-200/85">{row.inactiveReason}</div>}
                              </div>

                              <div className="grid gap-2 md:grid-cols-3">
                                <div className="rounded-lg border border-white/10 bg-black/25 p-2">
                                  <div className="mb-1 text-[10px] uppercase tracking-wide text-white/45">Вход</div>
                                  {row.inputs.length === 0 && <div className="text-[11px] text-white/40">Нет</div>}
                                  {row.inputs.map((item, idx) => (
                                    <div key={`${row.key}-in-${idx}`} className="flex items-center justify-between text-[11px] text-white/75">
                                      <span className="truncate">{goodById[item.goodId]?.name ?? item.goodId}</span>
                                      <span className="ml-2 tabular-nums text-white/55">{formatNum(item.amount)}</span>
                                    </div>
                                  ))}
                                </div>
                                <div className="rounded-lg border border-white/10 bg-black/25 p-2">
                                  <div className="mb-1 text-[10px] uppercase tracking-wide text-white/45">Выход</div>
                                  {row.outputs.length === 0 && <div className="text-[11px] text-white/40">Нет</div>}
                                  {row.outputs.map((item, idx) => (
                                    <div key={`${row.key}-out-${idx}`} className="flex items-center justify-between text-[11px] text-white/75">
                                      <span className="truncate">{goodById[item.goodId]?.name ?? item.goodId}</span>
                                      <span className="ml-2 tabular-nums text-white/55">{formatNum(item.amount)}</span>
                                    </div>
                                  ))}
                                </div>
                                <div className="rounded-lg border border-white/10 bg-black/25 p-2">
                                  <div className="mb-1 text-[10px] uppercase tracking-wide text-white/45">Профессии</div>
                                  {row.workforceNeeds.length === 0 && <div className="text-[11px] text-white/40">Нет</div>}
                                  {row.workforceNeeds.map((item, idx) => (
                                    <div key={`${row.key}-wf-${idx}`} className="flex items-center justify-between text-[11px] text-white/75">
                                      <span className="truncate">{professionById[item.professionId]?.name ?? item.professionId}</span>
                                      <span className="ml-2 tabular-nums text-white/55">{formatInt(item.workers)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-white/45">
                                <MapPin size={12} />
                                {row.provinceName}
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {filteredCards.length > 0 && filterProvinceId && (
                  <div className="arc-scrollbar grid max-h-[calc(100vh-20rem)] grid-cols-1 gap-3 overflow-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
                    {filteredCards.map((row) => (
                      <article
                        key={row.key}
                        className={`rounded-2xl border bg-gradient-to-br from-white/5 to-transparent p-4 shadow-lg shadow-black/30 ${
                          row.isActive ? "border-white/10" : "border-red-400/55"
                        }`}
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <div
                              className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg border border-white/10"
                              style={{ boxShadow: `0 0 0 1px ${row.color}33 inset`, backgroundColor: `${row.color}22` }}
                            >
                              {row.logoUrl ? (
                                <img src={row.logoUrl} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <Factory size={16} style={{ color: row.color }} />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-white">{row.name}</div>
                              <div className="text-[11px] text-white/45">Уровень: {formatInt(row.level)}</div>
                            </div>
                          </div>
                          {!row.isActive && (
                            <span className="rounded-full border border-red-400/40 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-200">
                              Неактивно
                            </span>
                          )}
                        </div>
                        <div className="space-y-1 text-xs text-white/65">
                          <div className="flex items-center justify-between">
                            <span className="inline-flex items-center gap-1">
                              <Coins size={13} />
                              Дукаты здания
                            </span>
                            <span className="tabular-nums text-amber-300">{formatNum(row.ducats)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="inline-flex items-center gap-1">
                              <Users size={13} />
                              Рабочие
                            </span>
                            <span className="tabular-nums text-white/75">
                              {formatInt(row.workersEmployed)} / {formatInt(row.workersDemand)}
                            </span>
                          </div>
                          {!row.isActive && row.inactiveReason && <div className="text-[11px] text-red-200/85">{row.inactiveReason}</div>}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </Dialog.Panel>
        </motion.div>
      </div>
      <Dialog open={constructionOpen} onClose={() => setConstructionOpen(false)} className="relative z-[207]">
        <motion.div
          aria-hidden="true"
          className="fixed inset-0 bg-black/65 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="w-full max-w-2xl"
          >
            <Dialog.Panel className="glass panel-border rounded-2xl bg-[#0b111b] p-4 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <Dialog.Title className="font-display text-xl tracking-wide text-arc-accent">Окно строительства</Dialog.Title>
                <button
                  type="button"
                  onClick={() => setConstructionOpen(false)}
                  className="panel-border inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-slate-300 transition hover:text-arc-accent"
                  aria-label="Закрыть"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-white/65">
                  Провинция
                  <select
                    value={constructionProvinceId}
                    onChange={(event) => setConstructionProvinceId(event.target.value)}
                    className="h-10 rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white outline-none focus:border-arc-accent/40"
                  >
                    {provinceItems.map((province) => (
                      <option key={province.provinceId} value={province.provinceId}>
                        {province.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/65">
                  Здание
                  <select
                    value={constructionBuildingId}
                    onChange={(event) => setConstructionBuildingId(event.target.value)}
                    className="h-10 rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white outline-none focus:border-arc-accent/40"
                  >
                    {buildings.map((building) => (
                      <option key={building.id} value={building.id}>
                        {building.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/65">
                  Владелец
                  <select
                    value={constructionOwnerType}
                    onChange={(event) => setConstructionOwnerType(event.target.value as "state" | "company")}
                    className="h-10 rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white outline-none focus:border-arc-accent/40"
                  >
                    <option value="state">Государство</option>
                    <option value="company">Компания</option>
                  </select>
                </label>
                {constructionOwnerType === "state" ? (
                  <label className="flex flex-col gap-1 text-xs text-white/65">
                    Страна-владелец
                    <select
                      value={constructionOwnerCountryId}
                      onChange={(event) => setConstructionOwnerCountryId(event.target.value)}
                      className="h-10 rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white outline-none focus:border-arc-accent/40"
                    >
                      {countryOptions.map((entryCountryId) => (
                        <option key={entryCountryId} value={entryCountryId}>
                          {entryCountryId}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="flex flex-col gap-1 text-xs text-white/65">
                    Компания-владелец
                    <select
                      value={constructionOwnerCompanyId}
                      onChange={(event) => setConstructionOwnerCompanyId(event.target.value)}
                      className="h-10 rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white outline-none focus:border-arc-accent/40"
                    >
                      {companies.map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <div className="mt-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/65">
                Стоимость: {Math.max(1, Math.floor(Number(selectedConstructionBuilding?.costConstruction ?? 100)))} строительства /{" "}
                {formatNum(Math.max(0, Number(selectedConstructionBuilding?.costDucats ?? 10)))} дукатов
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConstructionOpen(false)}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-white/10 bg-black/35 px-4 text-sm text-white/70 transition hover:text-white"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={submitConstruction}
                  disabled={!constructionProvinceId || !constructionBuildingId || (constructionOwnerType === "company" && !constructionOwnerCompanyId)}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-emerald-400/35 bg-emerald-500/20 px-4 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Добавить в очередь
                </button>
              </div>
            </Dialog.Panel>
          </motion.div>
        </div>
      </Dialog>
    </Dialog>
  );
}
