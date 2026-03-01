import { Dialog } from "@headlessui/react";
import type { WorldBase } from "@arcanorum/shared";
import { motion } from "framer-motion";
import { Building2, Factory, Hammer, MapPin, Plus, Trash2, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { cancelCountryBuild, fetchContentEntries, fetchCountries, type ContentEntry } from "../lib/api";
import { useGameStore } from "../store/gameStore";
import { CustomSelect } from "./CustomSelect";
import { Tooltip } from "./Tooltip";

type Props = {
  open: boolean;
  onClose: () => void;
  worldBase: WorldBase | null;
  countryId: string;
  countryName: string;
  onQueueBuildOrder: (provinceId: string, payload?: Record<string, unknown>) => void;
};

type Card = {
  key: string;
  kind: "built" | "construction";
  provinceId: string;
  provinceName: string;
  provinceOwnerCountryId: string;
  buildingId: string;
  buildingName: string;
  iconUrl: string | null;
  industryName: string | null;
  ownerLabel: string;
  ownerLogo: string | null;
  isActive: boolean;
  inactiveReasons: string[];
  level: number;
  progressPercent: number;
  costConstruction: number;
  workersEmployed: number;
  workersDemand: number;
};

type BuildAvailability = {
  available: boolean;
  reasons: string[];
};

const fmt = (v: number) => new Intl.NumberFormat("ru-RU").format(Math.max(0, Math.floor(v)));

export function ProvinceBuildingsModal({ open, onClose, worldBase, countryId, countryName, onQueueBuildOrder }: Props) {
  const [buildings, setBuildings] = useState<ContentEntry[]>([]);
  const [industries, setIndustries] = useState<ContentEntry[]>([]);
  const [companies, setCompanies] = useState<ContentEntry[]>([]);
  const [countries, setCountries] = useState<Array<{ id: string; name: string; flagUrl?: string | null }>>([]);
  const [constructionOpen, setConstructionOpen] = useState(false);
  const [provinceId, setProvinceId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [ownerType, setOwnerType] = useState<"state" | "company">("state");
  const [ownerCountryId, setOwnerCountryId] = useState("");
  const [ownerCompanyId, setOwnerCompanyId] = useState("");
  const [cancelingQueueKey, setCancelingQueueKey] = useState<string | null>(null);
  const auth = useGameStore((s) => s.auth);
  const turnId = useGameStore((s) => s.turnId);
  const ordersByTurn = useGameStore((s) => s.ordersByTurn);
  const removeOrder = useGameStore((s) => s.removeOrder);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([fetchContentEntries("buildings"), fetchContentEntries("industries"), fetchContentEntries("companies"), fetchCountries()])
      .then(([b, i, c, ctr]) => {
        if (cancelled) return;
        setBuildings(b);
        setIndustries(i);
        setCompanies(c);
        setCountries(ctr);
      })
      .catch(() => {
        if (cancelled) return;
        setBuildings([]);
        setIndustries([]);
        setCompanies([]);
        setCountries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const buildingById = useMemo(() => new Map(buildings.map((x) => [x.id, x] as const)), [buildings]);
  const sortedBuildings = useMemo(() => [...buildings].sort((a, b) => a.name.localeCompare(b.name, "ru")), [buildings]);
  const industryById = useMemo(() => new Map(industries.map((x) => [x.id, x] as const)), [industries]);
  const companyById = useMemo(() => new Map(companies.map((x) => [x.id, x] as const)), [companies]);
  const countryById = useMemo(() => new Map(countries.map((x) => [x.id, x] as const)), [countries]);

  const myProvinces = useMemo(() => {
    if (!worldBase) return [];
    return Object.entries(worldBase.provinceOwner)
      .filter(([, owner]) => owner === countryId)
      .map(([id]) => ({ id, name: worldBase.provinceNameById[id] || id }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [countryId, worldBase]);

  useEffect(() => {
    if (!open) return;
    setProvinceId(myProvinces[0]?.id ?? "");
    setBuildingId(buildings[0]?.id ?? "");
    setOwnerCountryId(countryId);
    setOwnerCompanyId(companies[0]?.id ?? "");
    setOwnerType("state");
  }, [open, myProvinces, buildings, companies, countryId]);

  const cards = useMemo<Card[]>(() => {
    if (!worldBase) return [];
    const res: Card[] = [];
    for (const prov of myProvinces) {
      const pid = prov.id;
      const pop = Math.max(0, worldBase.provincePopulationByProvince[pid]?.populationTotal ?? 0);
      const levels = worldBase.provinceBuildingsByProvince[pid] ?? {};
      for (const [bid, levelRaw] of Object.entries(levels)) {
        const b = buildingById.get(bid);
        if (!b) continue;
        const level = Math.max(0, Math.floor(Number(levelRaw) || 0));
        if (level <= 0) continue;
        const workersDemand = (b.workforceRequirements ?? []).reduce((s, r) => s + Math.max(0, r.workers) * level, 0);
        const workersEmployed = Math.min(workersDemand, pop);
        const inactiveReasons = workersDemand > 0 && workersEmployed <= 0 ? ["Нет доступной рабочей силы"] : [];
        const ind = industryById.get(((b as { industryId?: string }).industryId ?? "").trim());
        const ownerCountry = countryById.get(worldBase.provinceOwner[pid] ?? "");
        res.push({
          key: `${pid}-${bid}-built`,
          kind: "built",
          provinceId: pid,
          provinceName: prov.name,
          provinceOwnerCountryId: worldBase.provinceOwner[pid] ?? "",
          buildingId: bid,
          buildingName: b.name,
          iconUrl: b.logoUrl ?? null,
          industryName: ind?.name ?? null,
          ownerLabel: ownerCountry?.name ?? worldBase.provinceOwner[pid] ?? "—",
          ownerLogo: ownerCountry?.flagUrl ?? null,
          isActive: inactiveReasons.length === 0,
          inactiveReasons,
          level,
          progressPercent: 100,
          costConstruction: Math.max(1, Math.floor(Number(b.costConstruction ?? 100))),
          workersEmployed,
          workersDemand,
        });
      }
      for (const q of worldBase.provinceConstructionQueueByProvince[pid] ?? []) {
        const b = buildingById.get(q.buildingId);
        if (!b) continue;
        const ownerLabel = q.owner.type === "company" ? companyById.get(q.owner.companyId)?.name ?? q.owner.companyId : countryById.get(q.owner.countryId)?.name ?? q.owner.countryId;
        const ownerLogo = q.owner.type === "company" ? companyById.get(q.owner.companyId)?.logoUrl ?? null : countryById.get(q.owner.countryId)?.flagUrl ?? null;
        const progressPercent = Math.min(100, Math.round((q.progressConstruction / Math.max(1, q.costConstruction)) * 100));
        res.push({
          key: `${pid}-${q.queueId}-construction`,
          kind: "construction",
          provinceId: pid,
          provinceName: prov.name,
          provinceOwnerCountryId: worldBase.provinceOwner[pid] ?? "",
          buildingId: q.buildingId,
          buildingName: b.name,
          iconUrl: b.logoUrl ?? null,
          industryName: null,
          ownerLabel,
          ownerLogo,
          isActive: true,
          inactiveReasons: [],
          level: 0,
          progressPercent,
          costConstruction: Math.max(1, Math.floor(Number(q.costConstruction || b.costConstruction || 100))),
          workersEmployed: 0,
          workersDemand: 0,
        });
      }
    }
    return res;
  }, [worldBase, myProvinces, buildingById, industryById, countryById, companyById]);

  const constructionQueue = useMemo(
    () => {
      const committed: Array<{
        key: string;
        source: "queued";
        provinceId: string;
        provinceName: string;
        buildingName: string;
        ownerLabel: string;
        progressPercent: number;
        iconUrl: string | null;
        queueId: string;
      }> = [];
      for (const province of myProvinces) {
        const queue = worldBase?.provinceConstructionQueueByProvince?.[province.id] ?? [];
        for (const project of queue) {
          const building = buildingById.get(project.buildingId);
          if (!building) continue;
          const ownerLabel =
            project.owner.type === "company"
              ? companyById.get(project.owner.companyId)?.name ?? project.owner.companyId
              : countryById.get(project.owner.countryId)?.name ?? project.owner.countryId;
          committed.push({
            key: `queued-${province.id}-${project.queueId}`,
            source: "queued",
            provinceId: province.id,
            provinceName: province.name,
            buildingName: building.name,
            ownerLabel,
            progressPercent: Math.min(100, Math.round((project.progressConstruction / Math.max(1, project.costConstruction)) * 100)),
            iconUrl: building.logoUrl ?? null,
            queueId: project.queueId,
          });
        }
      }

      const pending: Array<{
        key: string;
        source: "pending";
        provinceId: string;
        provinceName: string;
        buildingName: string;
        ownerLabel: string;
        progressPercent: number;
        iconUrl: string | null;
        orderId: string;
      }> = [];
      const byPlayer = ordersByTurn.get(turnId);
      if (byPlayer) {
        for (const playerOrders of byPlayer.values()) {
          for (const order of playerOrders) {
            if (order.type !== "BUILD" || order.countryId !== countryId) continue;
            const payload = (order.payload ?? {}) as Record<string, unknown>;
            const payloadBuildingId =
              typeof payload.buildingId === "string"
                ? payload.buildingId
                : typeof payload.building === "string"
                  ? payload.building
                  : "";
            const pendingBuildingName =
              buildingById.get(payloadBuildingId)?.name ?? (payloadBuildingId || "Здание");
            const pendingProvinceName =
              myProvinces.find((p) => p.id === order.provinceId)?.name ??
              worldBase?.provinceNameById?.[order.provinceId] ??
              order.provinceId;
            const owner = payload.owner as { type?: "state" | "company"; countryId?: string; companyId?: string } | undefined;
            const ownerLabel =
              owner?.type === "company"
                ? companyById.get(owner.companyId ?? "")?.name ?? owner.companyId ?? "Компания"
                : countryById.get(owner?.countryId ?? countryId)?.name ?? owner?.countryId ?? countryId;
            pending.push({
              key: `pending-${order.id}`,
              source: "pending",
              provinceId: order.provinceId,
              provinceName: pendingProvinceName,
              buildingName: pendingBuildingName,
              ownerLabel,
              progressPercent: 0,
              iconUrl: buildingById.get(payloadBuildingId)?.logoUrl ?? null,
              orderId: order.id,
            });
          }
        }
      }
      return [...committed, ...pending].sort(
        (a, b) =>
          Number(a.source === "queued") - Number(b.source === "queued") ||
          a.provinceName.localeCompare(b.provinceName, "ru") ||
          a.buildingName.localeCompare(b.buildingName, "ru"),
      );
    },
    [ordersByTurn, turnId, countryId, buildingById, myProvinces, worldBase?.provinceConstructionQueueByProvince, worldBase?.provinceNameById, companyById, countryById],
  );

  const availableConstruction = Math.max(0, Math.floor(Number(worldBase?.resourcesByCountry?.[countryId]?.construction ?? 0)));
  const availableDucats = Math.max(0, Math.floor(Number(worldBase?.resourcesByCountry?.[countryId]?.ducats ?? 0)));
  const constructionCardClass =
    "h-[124px] rounded-lg border border-amber-400/55 bg-[#14100a] p-2 shadow-[0_0_0_1px_rgba(245,158,11,0.08)]";
  const selectedProvinceBuildings = worldBase?.provinceBuildingsByProvince?.[provinceId] ?? {};

  const getBuildingAvailability = (building: ContentEntry): BuildAvailability => {
    const reasons: string[] = [];
    if (!provinceId) {
      reasons.push("Не выбрана провинция");
    }
    if (ownerType === "company" && !ownerCompanyId) {
      reasons.push("Не выбрана компания-владелец");
    }

    const raw = building as unknown as Record<string, unknown>;
    const allowedCountries = Array.isArray(raw.allowedCountries)
      ? raw.allowedCountries.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    if (allowedCountries.length > 0 && !allowedCountries.includes(countryId)) {
      reasons.push("Страна не может строить это здание");
    }

    const dependencySource = Array.isArray(raw.requiredProvinceBuildingIds)
      ? raw.requiredProvinceBuildingIds
      : Array.isArray(raw.requiredBuildings)
        ? raw.requiredBuildings
        : Array.isArray(raw.dependencies)
          ? raw.dependencies
          : [];
    const dependencies = dependencySource.filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    for (const depId of dependencies) {
      if ((selectedProvinceBuildings[depId] ?? 0) <= 0) {
        reasons.push(`Нужно здание в провинции: ${buildingById.get(depId)?.name ?? depId}`);
      }
    }

    return { available: reasons.length === 0, reasons };
  };

  const buildableBuildingCards = useMemo(
    () =>
      sortedBuildings
        .map((building) => ({
          building,
          availability: getBuildingAvailability(building),
        }))
        .sort(
          (a, b) =>
            Number(b.availability.available) - Number(a.availability.available) ||
            a.building.name.localeCompare(b.building.name, "ru"),
        ),
    [sortedBuildings, provinceId, ownerType, ownerCompanyId, countryId, selectedProvinceBuildings, buildingById],
  );

  const submitBuild = (targetBuildingId: string) => {
    if (!provinceId || !targetBuildingId) return;
    if (ownerType === "company" && !ownerCompanyId) return;
    const owner = ownerType === "company" ? { type: "company", companyId: ownerCompanyId } : { type: "state", countryId: ownerCountryId || countryId };
    onQueueBuildOrder(provinceId, { buildingId: targetBuildingId, owner });
    setBuildingId(targetBuildingId);
  };

  const cancelBuildQueueItem = async (
    item:
      | { key: string; source: "pending"; orderId: string }
      | { key: string; source: "queued"; provinceId: string; queueId: string },
  ) => {
    if (!auth?.token) return;
    setCancelingQueueKey(item.key);
    try {
      if (item.source === "pending") {
        const result = await cancelCountryBuild(auth.token, { orderId: item.orderId });
        if (result.canceledPendingOrder) {
          removeOrder(turnId, item.orderId);
        }
      } else {
        await cancelCountryBuild(auth.token, { provinceId: item.provinceId, queueId: item.queueId });
      }
      toast.success("Строительство отменено");
    } catch (error) {
      const message = error instanceof Error ? error.message : "BUILD_CANCEL_FAILED";
      if (message === "BUILD_CANCEL_NOT_FOUND") {
        toast.error("Проект уже не найден");
      } else {
        toast.error("Не удалось отменить строительство");
      }
    } finally {
      setCancelingQueueKey(null);
    }
  };

  const border = (c: Card) => (c.kind === "construction" ? "border-amber-400/50" : c.isActive ? "border-white/10" : "border-red-400/60");

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[206]">
      <motion.div aria-hidden="true" className="fixed inset-0 bg-black/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <div className="fixed inset-0 p-4 md:p-6">
        <Dialog.Panel className="glass panel-border flex h-full flex-col rounded-2xl bg-[#0b111b] p-4 shadow-2xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><Dialog.Title className="font-display text-2xl tracking-wide text-arc-accent">Постройки</Dialog.Title><span className="mt-1 block text-xs text-white/60">Индустрия и строительство страны {countryName}</span></div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setConstructionOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-400/35 bg-emerald-500/15 px-3 text-xs text-emerald-200"><Hammer size={14} />Строительство</button>
              <button type="button" onClick={onClose} className="panel-border inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-slate-300"><X size={16} /></button>
            </div>
          </div>

          <div className="arc-scrollbar grid min-h-0 grid-cols-1 gap-3 overflow-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((c) => (
              <article key={c.key} className={`rounded-2xl border bg-gradient-to-br from-white/5 to-transparent p-4 flex flex-col gap-4 shadow-lg shadow-black/30 ${border(c)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/30">{c.iconUrl ? <img src={c.iconUrl} alt="" className="h-full w-full object-cover" /> : <Factory size={16} />}</div>
                    <div>
                      <div className="text-white/80 text-sm font-semibold">{c.buildingName || c.buildingId}</div>
                      <div className="text-[11px] text-white/45">Стоимость: {fmt(c.costConstruction)}</div>
                      {!c.isActive && (
                        <Tooltip content={c.inactiveReasons.join(", ")} placement="top">
                          <span className="mt-1 inline-flex rounded-full border border-red-400/40 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-200">Неактивное</span>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                  <button type="button" disabled className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-white/35">{c.kind === "construction" ? <X size={14} /> : <Trash2 size={14} />}</button>
                </div>
                {c.kind === "construction" && (
                  <div>
                    <div className="h-2 overflow-hidden rounded-full border border-amber-400/30 bg-black/50">
                      <div
                        className="h-full"
                        style={{
                          width: `${c.progressPercent}%`,
                          backgroundImage:
                            "repeating-linear-gradient(-45deg, rgba(245,158,11,0.95) 0 8px, rgba(15,23,42,0.95) 8px 16px)",
                        }}
                      />
                    </div>
                    <div className="mt-1 text-[11px] text-amber-300/90">Прогресс: {c.progressPercent}%</div>
                  </div>
                )}
                <div className="flex flex-col gap-1.5 text-xs text-white/65">
                  <div className="flex items-center gap-2"><Factory size={13} /><span className="text-white/40">Отрасль:</span><span>{c.industryName ?? "—"}</span></div>
                  <div className="flex items-center gap-2"><MapPin size={13} /><span className="text-white/40">Провинция:</span><span>{c.provinceName}</span></div>
                  <div className="flex items-center gap-2"><Building2 size={13} /><span className="text-white/40">Страна:</span><span>{countryById.get(c.provinceOwnerCountryId)?.name ?? (c.provinceOwnerCountryId || "—")}</span></div>
                  <div className="flex items-center gap-2"><Factory size={13} /><span className="text-white/40">Владелец:</span><span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/35 px-2 py-0.5 text-white/80">{c.ownerLogo ? <img src={c.ownerLogo} alt="" className="h-3.5 w-3.5 rounded object-cover border border-white/10" /> : null}{c.ownerLabel}</span></div>
                  {c.kind === "built" && <div className="flex items-center gap-2"><Users size={13} /><span className="text-white/40">Рабочие:</span><span>{fmt(c.workersEmployed)} / {fmt(c.workersDemand)}</span></div>}
                </div>
              </article>
            ))}
          </div>
        </Dialog.Panel>
      </div>

      <Dialog open={constructionOpen} onClose={() => setConstructionOpen(false)} className="relative z-[207]">
        <motion.div aria-hidden="true" className="fixed inset-0 bg-black/65 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
        <div className="fixed inset-0 p-4 md:p-6">
          <Dialog.Panel className="glass panel-border flex h-full w-full flex-col rounded-2xl bg-[#0b111b] p-4 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <Dialog.Title className="font-display text-xl tracking-wide text-arc-accent">Окно строительства</Dialog.Title>
              <button type="button" onClick={() => setConstructionOpen(false)} className="panel-border inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-slate-300">
                <X size={15} />
              </button>
            </div>

            <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
              <Tooltip content="Очки строительства, которые будут распределены между всеми проектами при резолве хода.">
                <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/70">
                  Доступно строительства: <span className="text-emerald-300">{fmt(availableConstruction)}</span>
                </div>
              </Tooltip>
              <Tooltip content="Текущий запас дукатов страны. Используется для оплаты строительных проектов и других механик.">
                <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/70">
                  Дукаты страны: <span className="text-amber-300">{fmt(availableDucats)}</span>
                </div>
              </Tooltip>
              <Tooltip content="Сколько проектов сейчас находится в очереди строительства с учетом pending-приказов хода.">
                <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/70">
                  Проектов в очереди: <span className="text-white">{fmt(constructionQueue.length)}</span>
                </div>
              </Tooltip>
            </div>

            <div className="min-h-0 flex flex-1 flex-col gap-4">
              <section className="rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="mb-2 text-xs uppercase tracking-wide text-white/45">Общие параметры строительства</div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="flex flex-col gap-1 text-xs text-white/65">
                    <Tooltip content="Выбранная провинция применяется ко всем добавляемым проектам из списка ниже.">
                      <span>Провинция</span>
                    </Tooltip>
                    <CustomSelect
                      value={provinceId}
                      onChange={setProvinceId}
                      options={myProvinces.map((p) => ({ value: p.id, label: p.name }))}
                      placeholder="Выберите провинцию"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-white/65">
                    <Tooltip content="Кому будет принадлежать каждое добавленное здание: государству или компании.">
                      <span>Владелец</span>
                    </Tooltip>
                    <CustomSelect
                      value={ownerType}
                      onChange={(value) => setOwnerType(value as "state" | "company")}
                      options={[
                        { value: "state", label: "Государство" },
                        { value: "company", label: "Компания" },
                      ]}
                    />
                  </label>
                  {ownerType === "state" ? (
                    <label className="flex flex-col gap-1 text-xs text-white/65">
                      <Tooltip content="Страна, которая станет владельцем проекта при выбранном типе «Государство».">
                        <span>Страна владельца</span>
                      </Tooltip>
                      <CustomSelect
                        value={ownerCountryId}
                        onChange={setOwnerCountryId}
                        options={Object.keys(worldBase?.resourcesByCountry ?? {}).map((id) => ({
                          value: id,
                          label: countryById.get(id)?.name ?? id,
                        }))}
                        placeholder="Выберите страну"
                      />
                    </label>
                  ) : (
                    <label className="flex flex-col gap-1 text-xs text-white/65">
                      <Tooltip content="Компания, которая станет владельцем проекта при выбранном типе «Компания».">
                        <span>Компания владельца</span>
                      </Tooltip>
                      <CustomSelect
                        value={ownerCompanyId}
                        onChange={setOwnerCompanyId}
                        options={companies.map((c) => ({ value: c.id, label: c.name }))}
                        placeholder="Выберите компанию"
                      />
                    </label>
                  )}
                </div>
              </section>

              <div className="min-h-0 flex-1 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <section className="min-h-0 rounded-xl border border-white/10 bg-black/25 p-3 flex flex-col">
                  <div className="mb-2 text-xs uppercase tracking-wide text-white/45">Доступные здания</div>
                  <div className="arc-scrollbar min-h-0 flex-1 space-y-2 overflow-auto pr-1">
                    {buildableBuildingCards.map(({ building, availability }) => {
                      const costConstruction = Math.max(1, Math.floor(Number(building.costConstruction ?? 100)));
                      const costDucats = Math.max(0, Math.floor(Number(building.costDucats ?? 0)));
                      const canAdd = availability.available;
                      const cardClass = canAdd
                        ? "h-[124px] rounded-lg border border-emerald-400/55 bg-[#0f1a13] p-2 shadow-[0_0_0_1px_rgba(16,185,129,0.1)]"
                        : "h-[124px] rounded-lg border border-red-400/55 bg-[#1a1010] p-2 shadow-[0_0_0_1px_rgba(248,113,113,0.08)]";
                      return (
                        <div key={building.id} className={cardClass}>
                          <div className="h-full overflow-hidden rounded-md flex items-stretch">
                            <div className={`flex w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black ${canAdd ? "border border-emerald-400/40" : "border border-red-400/40"}`}>
                              {building.logoUrl ? (
                                <img src={building.logoUrl} alt="" className="h-10 w-10 object-contain" />
                              ) : (
                                <Factory size={16} className="text-white/60" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1 p-3">
                            <div className="flex h-full items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-white/90">{building.name}</div>
                                <div className="text-[11px] text-white/55">
                                  Строительство: <span className="text-amber-300/90">{fmt(costConstruction)}</span>
                                  {" · "}
                                  Дукаты: <span className="text-amber-300/90">{fmt(costDucats)}</span>
                                </div>
                                <div className={`mt-1 text-[11px] ${canAdd ? "text-emerald-300/90" : "text-red-300/90"}`}>
                                  {canAdd ? "Доступно" : "Недоступно"}
                                </div>
                              </div>
                                <Tooltip
                                  content={
                                    canAdd
                                      ? `Добавить «${building.name}» в очередь строительства`
                                      : availability.reasons.join(", ")
                                  }
                                  placement="left"
                                >
                                  <button
                                    type="button"
                                    onClick={() => submitBuild(building.id)}
                                    disabled={!canAdd}
                                    className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full disabled:opacity-40 ${
                                      canAdd
                                        ? "border border-emerald-400/55 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
                                        : "border border-red-400/55 bg-red-500/20 text-red-200"
                                    }`}
                                  >
                                    <Plus size={20} />
                                  </button>
                                </Tooltip>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="min-h-0 rounded-xl border border-white/10 bg-black/25 p-3 flex flex-col">
                  <div className="mb-2 text-xs uppercase tracking-wide text-white/45">Очередь строительства</div>
                  {constructionQueue.length === 0 && (
                    <div className="rounded-lg border border-dashed border-white/15 bg-black/20 p-3 text-xs text-white/45">
                      Очередь пуста
                    </div>
                  )}
                  {constructionQueue.length > 0 && (
                    <div className="arc-scrollbar arc-scrollbar-construction min-h-0 flex-1 space-y-2 overflow-auto pr-1">
                      {constructionQueue.map((card) => (
                        <div key={card.key} className={constructionCardClass}>
                          <div className="h-full overflow-hidden rounded-md flex items-stretch">
                            <div className="flex w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-amber-400/40 bg-black">
                              {card.iconUrl ? (
                                <img src={card.iconUrl} alt="" className="h-10 w-10 object-contain" />
                              ) : (
                                <Factory size={16} className="text-white/60" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1 p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-white/90">{card.buildingName}</div>
                                  <div className="text-[11px] text-white/55">{card.provinceName}</div>
                                </div>
                              </div>
                              <div className="mt-2 flex items-center gap-2">
                                <div className="w-10 shrink-0 text-[11px] text-amber-300/90">{card.progressPercent}%</div>
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full border border-amber-400/30 bg-black/50">
                                  <div
                                    className="h-full"
                                    style={{
                                      width: `${card.progressPercent}%`,
                                      backgroundImage:
                                        "repeating-linear-gradient(-45deg, rgba(245,158,11,0.95) 0 8px, rgba(15,23,42,0.95) 8px 16px)",
                                    }}
                                  />
                                </div>
                              </div>
                              <div className="mt-2 text-[11px] text-white/55">
                                Владелец: <span className="text-white/80">{card.ownerLabel}</span>
                              </div>
                            </div>
                            <div className="flex w-16 shrink-0 items-center justify-center">
                              <Tooltip
                                content={
                                  card.source === "pending"
                                    ? "Отменить проект до резолва текущего хода"
                                    : "Удалить проект из очереди строительства"
                                }
                                placement="left"
                              >
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void cancelBuildQueueItem(
                                        card.source === "pending"
                                          ? { key: card.key, source: "pending", orderId: card.orderId }
                                          : { key: card.key, source: "queued", provinceId: card.provinceId, queueId: card.queueId },
                                      )
                                    }
                                    disabled={cancelingQueueKey === card.key}
                                    className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-amber-400/55 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 disabled:opacity-40"
                                  >
                                    {cancelingQueueKey === card.key ? "..." : <X size={20} />}
                                  </button>
                              </Tooltip>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </Dialog>
  );
}
