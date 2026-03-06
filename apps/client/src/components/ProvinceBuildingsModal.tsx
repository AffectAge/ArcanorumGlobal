import { Dialog } from "@headlessui/react";
import type { WorldBase } from "@arcanorum/shared";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowUpRight,
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronUp,
  Coins,
  Factory,
  Hammer,
  Lock,
  MapPin,
  Package,
  Plus,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  cancelCountryBuild,
  demolishCountryBuild,
  fetchContentEntries,
  fetchCountries,
  fetchMarketOverview,
  fetchPublicGameUiSettings,
  type ContentEntry,
  type MarketOverviewResponse,
  type ResourceIconsMap,
} from "../lib/api";
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
  instanceId?: string;
  queueId?: string;
  provinceId: string;
  provinceName: string;
  provinceOwnerCountryId: string;
  buildingId: string;
  buildingName: string;
  iconUrl: string | null;
  industryName: string | null;
  ownerLabel: string;
  ownerLogo: string | null;
  ownerType: "state" | "company";
  ownerCompanyId?: string;
  isActive: boolean;
  inactiveReasons: string[];
  level: number;
  progressPercent: number;
  costConstruction: number;
  workersEmployed: number;
  workersDemand: number;
  lastLaborCoverage?: number;
  lastInputCoverage?: number;
  lastInfraCoverage?: number;
  lastFinanceCoverage?: number;
  lastProductivity?: number;
  inactiveReason?: string | null;
};

type BuildAvailability = {
  available: boolean;
  reasons: string[];
};

const fmt = (v: number) => new Intl.NumberFormat("ru-RU").format(Math.max(0, Math.floor(v)));
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

export function ProvinceBuildingsModal({ open, onClose, worldBase, countryId, countryName, onQueueBuildOrder }: Props) {
  const [buildings, setBuildings] = useState<ContentEntry[]>([]);
  const [industries, setIndustries] = useState<ContentEntry[]>([]);
  const [goods, setGoods] = useState<ContentEntry[]>([]);
  const [companies, setCompanies] = useState<ContentEntry[]>([]);
  const [countries, setCountries] = useState<Array<{ id: string; name: string; flagUrl?: string | null }>>([]);
  const [resourceIcons, setResourceIcons] = useState<ResourceIconsMap>({
    culture: null,
    science: null,
    religion: null,
    colonization: null,
    construction: null,
    ducats: null,
    gold: null,
  });
  const [constructionOpen, setConstructionOpen] = useState(false);
  const [demolitionCostConstructionPercent, setDemolitionCostConstructionPercent] = useState(20);
  const [buildCountryId, setBuildCountryId] = useState("");
  const [provinceId, setProvinceId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [ownerType, setOwnerType] = useState<"state" | "company">("state");
  const [ownerCountryId, setOwnerCountryId] = useState("");
  const [ownerCompanyId, setOwnerCompanyId] = useState("");
  const [cancelingQueueKey, setCancelingQueueKey] = useState<string | null>(null);
  const [demolishingCardKey, setDemolishingCardKey] = useState<string | null>(null);
  const [cancelConfirmTarget, setCancelConfirmTarget] = useState<
    | null
    | {
        key: string;
        source: "pending" | "queued";
        buildingName: string;
        provinceName: string;
        orderId?: string;
        provinceId?: string;
        queueId?: string;
      }
  >(null);
  const [demolishConfirmTarget, setDemolishConfirmTarget] = useState<
    | null
    | {
        key: string;
        provinceId: string;
        buildingId: string;
        instanceId?: string;
        buildingName: string;
        provinceName: string;
        demolitionCostConstruction: number;
      }
  >(null);
  const [filterBuildingId, setFilterBuildingId] = useState("");
  const [filterProvinceId, setFilterProvinceId] = useState("");
  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [filterCompanyCountryId, setFilterCompanyCountryId] = useState("");
  const [filterIndustryId, setFilterIndustryId] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "construction" | "built">("all");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("all");
  const [filterEconomy, setFilterEconomy] = useState<"all" | "profit" | "loss">("all");
  const [sortBy, setSortBy] = useState<"building" | "province" | "company" | "industry">("building");
  const [openEconomyByCardKey, setOpenEconomyByCardKey] = useState<Record<string, boolean>>({});
  const [marketOverview, setMarketOverview] = useState<MarketOverviewResponse | null>(null);
  const auth = useGameStore((s) => s.auth);
  const turnId = useGameStore((s) => s.turnId);
  const ordersByTurn = useGameStore((s) => s.ordersByTurn);
  const removeOrder = useGameStore((s) => s.removeOrder);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      fetchContentEntries("buildings"),
      fetchContentEntries("industries"),
      fetchContentEntries("goods"),
      fetchContentEntries("companies"),
      fetchCountries(),
      fetchPublicGameUiSettings(),
    ])
      .then(([b, i, g, c, ctr, ui]) => {
        if (cancelled) return;
        setBuildings(b);
        setIndustries(i);
        setGoods(g);
        setCompanies(c);
        setCountries(ctr);
        setResourceIcons(ui.resourceIcons);
        setDemolitionCostConstructionPercent(ui.economy?.demolitionCostConstructionPercent ?? 20);
      })
      .catch(() => {
        if (cancelled) return;
        setBuildings([]);
        setIndustries([]);
        setGoods([]);
        setCompanies([]);
        setCountries([]);
        setResourceIcons({
          culture: null,
          science: null,
          religion: null,
          colonization: null,
          construction: null,
          ducats: null,
          gold: null,
        });
        setDemolitionCostConstructionPercent(20);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !auth?.token) {
      setMarketOverview(null);
      return;
    }
    let cancelled = false;
    fetchMarketOverview(auth.token)
      .then((data) => {
        if (!cancelled) setMarketOverview(data);
      })
      .catch(() => {
        if (!cancelled) setMarketOverview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, auth?.token, worldBase?.turnId, countryId]);

  const buildingById = useMemo(() => new Map(buildings.map((x) => [x.id, x] as const)), [buildings]);
  const sortedBuildings = useMemo(() => [...buildings].sort((a, b) => a.name.localeCompare(b.name, "ru")), [buildings]);
  const industryById = useMemo(() => new Map(industries.map((x) => [x.id, x] as const)), [industries]);
  const goodById = useMemo(() => new Map(goods.map((x) => [x.id, x] as const)), [goods]);
  const companyById = useMemo(() => new Map(companies.map((x) => [x.id, x] as const)), [companies]);
  const countryById = useMemo(() => new Map(countries.map((x) => [x.id, x] as const)), [countries]);

  const myProvinces = useMemo(() => {
    if (!worldBase) return [];
    return Object.entries(worldBase.provinceOwner)
      .filter(([, owner]) => owner === countryId)
      .map(([id]) => ({ id, name: worldBase.provinceNameById[id] || id }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [countryId, worldBase]);

  const buildCountryOptions = useMemo(() => {
    // TODO: add foreign countries here when diplomacy/build access permissions are implemented.
    const own = countryById.get(countryId);
    return [{ id: countryId, name: own?.name ?? countryName }];
  }, [countryById, countryId, countryName]);

  const ownerCountryOptions = useMemo(() => {
    // Uses the same permission source as build-country selection.
    return buildCountryOptions;
  }, [buildCountryOptions]);

  const buildProvinces = useMemo(() => {
    if (!worldBase || !buildCountryId) return [];
    return Object.entries(worldBase.provinceOwner)
      .filter(([, owner]) => owner === buildCountryId)
      .map(([id]) => ({ id, name: worldBase.provinceNameById[id] || id }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [buildCountryId, worldBase]);

  useEffect(() => {
    if (!open) return;
    setBuildCountryId(countryId);
    setProvinceId(myProvinces[0]?.id ?? "");
    setBuildingId(buildings[0]?.id ?? "");
    setOwnerCountryId(countryId);
    setOwnerCompanyId(companies[0]?.id ?? "");
    setOwnerType("state");
  }, [open, myProvinces, buildings, companies, countryId]);

  useEffect(() => {
    if (!open) return;
    setProvinceId(buildProvinces[0]?.id ?? "");
  }, [buildProvinces, open]);

  useEffect(() => {
    if (!open || ownerType !== "state") return;
    const hasSelected = ownerCountryOptions.some((country) => country.id === ownerCountryId);
    if (hasSelected) return;
    setOwnerCountryId(ownerCountryOptions[0]?.id ?? countryId);
  }, [open, ownerType, ownerCountryOptions, ownerCountryId, countryId]);

  const cards = useMemo<Card[]>(() => {
    if (!worldBase) return [];
    const res: Card[] = [];
    for (const prov of myProvinces) {
      const pid = prov.id;
      const pop = Math.max(0, worldBase.provincePopulationByProvince[pid]?.populationTotal ?? 0);
      const instances = worldBase.provinceBuildingsByProvince[pid] ?? [];
      const countsByBuildingId = instances.reduce<Record<string, number>>((acc, instance) => {
        acc[instance.buildingId] = (acc[instance.buildingId] ?? 0) + 1;
        return acc;
      }, {});
      const workersDemandByBuildingId = Object.entries(countsByBuildingId).reduce<Record<string, number>>(
        (acc, [buildingId, count]) => {
          const b = buildingById.get(buildingId);
          if (!b) return acc;
          const perLevel = (b.workforceRequirements ?? []).reduce((s, r) => s + Math.max(0, r.workers), 0);
          acc[buildingId] = Math.max(0, perLevel * count);
          return acc;
        },
        {},
      );
      const totalWorkersDemand = Object.values(workersDemandByBuildingId).reduce((sum, value) => sum + value, 0);
      const employmentRatio = totalWorkersDemand > 0 ? Math.max(0, Math.min(1, pop / totalWorkersDemand)) : 0;

      const builtByBuildingId = new Map<string, number>();
      for (const instance of instances) {
        const bid = instance.buildingId;
        const b = buildingById.get(bid);
        if (!b) continue;
        const workersDemandPerLevel = (b.workforceRequirements ?? []).reduce(
          (s, r) => s + Math.max(0, r.workers),
          0,
        );
        const laborCoverage = Math.max(
          0,
          Math.min(1, typeof instance.lastLaborCoverage === "number" ? instance.lastLaborCoverage : employmentRatio),
        );
        const workersEmployed = Math.round(workersDemandPerLevel * laborCoverage);
        const inactiveReasons: string[] = [];
        if (instance.inactiveReason) {
          inactiveReasons.push(instance.inactiveReason);
        }
        if (workersDemandPerLevel > 0 && workersEmployed <= 0) {
          inactiveReasons.push("Нет доступной рабочей силы");
        }
        const ind = industryById.get(((b as { industryId?: string }).industryId ?? "").trim());
        const ownerLabel =
          instance.owner.type === "company"
            ? companyById.get(instance.owner.companyId)?.name ?? instance.owner.companyId
            : countryById.get(instance.owner.countryId)?.name ?? instance.owner.countryId;
        const ownerLogo =
          instance.owner.type === "company"
            ? companyById.get(instance.owner.companyId)?.logoUrl ?? null
            : countryById.get(instance.owner.countryId)?.flagUrl ?? null;
        const level = (builtByBuildingId.get(bid) ?? 0) + 1;
        builtByBuildingId.set(bid, level);
        res.push({
          key: `${pid}-${instance.instanceId}-built`,
          kind: "built",
          instanceId: instance.instanceId,
          queueId: undefined,
          provinceId: pid,
          provinceName: prov.name,
          provinceOwnerCountryId: worldBase.provinceOwner[pid] ?? "",
          buildingId: bid,
          buildingName: b.name,
          iconUrl: b.logoUrl ?? null,
          industryName: ind?.name ?? null,
          ownerLabel,
          ownerLogo,
          ownerType: instance.owner.type,
          ownerCompanyId: instance.owner.type === "company" ? instance.owner.companyId : undefined,
          isActive: !(instance.isInactive ?? false) && inactiveReasons.length === 0,
          inactiveReasons,
          level,
          progressPercent: 100,
          costConstruction: Math.max(1, Math.floor(Number(b.costConstruction ?? 100))),
          workersEmployed,
          workersDemand: workersDemandPerLevel,
          lastLaborCoverage: typeof instance.lastLaborCoverage === "number" ? instance.lastLaborCoverage : undefined,
          lastInputCoverage: typeof instance.lastInputCoverage === "number" ? instance.lastInputCoverage : undefined,
          lastInfraCoverage: typeof instance.lastInfraCoverage === "number" ? instance.lastInfraCoverage : undefined,
          lastFinanceCoverage: typeof instance.lastFinanceCoverage === "number" ? instance.lastFinanceCoverage : undefined,
          lastProductivity: typeof instance.lastProductivity === "number" ? instance.lastProductivity : undefined,
          inactiveReason: instance.inactiveReason ?? null,
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
          queueId: q.queueId,
          provinceId: pid,
          provinceName: prov.name,
          provinceOwnerCountryId: worldBase.provinceOwner[pid] ?? "",
          buildingId: q.buildingId,
          buildingName: b.name,
          iconUrl: b.logoUrl ?? null,
          industryName: null,
          ownerLabel,
          ownerLogo,
          ownerType: q.owner.type,
          ownerCompanyId: q.owner.type === "company" ? q.owner.companyId : undefined,
          isActive: true,
          inactiveReasons: [],
          level: 0,
          progressPercent,
          costConstruction: Math.max(1, Math.floor(Number(q.costConstruction || b.costConstruction || 100))),
          workersEmployed: 0,
          workersDemand: 0,
          inactiveReason: null,
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

  const getCardEconomy = (card: Card) => {
    const building = buildingById.get(card.buildingId);
    const instance =
      card.kind === "built"
        ? (worldBase?.provinceBuildingsByProvince?.[card.provinceId] ?? []).find((x) => x.instanceId === card.instanceId)
        : null;
    const productivity =
      card.kind === "construction"
        ? card.progressPercent
        : typeof instance?.lastProductivity === "number"
          ? Math.round(Math.max(0, Math.min(1, instance.lastProductivity)) * 100)
          : card.workersDemand > 0
            ? Math.round((card.workersEmployed / card.workersDemand) * 100)
            : 100;
    if (!building) {
      return {
        productivity,
        inputCost: 0,
        outputRevenue: 0,
        wagesCost: 0,
        netPerTurn: 0,
        storageAmount: 0,
        inputs: [] as Array<{ goodName: string; goodLogoUrl: string | null; factual: number; max: number; cost: number }>,
        outputs: [] as Array<{ goodName: string; goodLogoUrl: string | null; factual: number; max: number; income: number }>,
        stockRows: [] as Array<{ goodName: string; goodLogoUrl: string | null; available: number; incoming: number; outgoing: number; remainder: number }>,
        trade: [] as Array<{ kind: "buy" | "sell"; goodName: string; goodLogoUrl: string | null; amount: number; total: number }>,
      };
    }
    const ratio = Math.max(0, Math.min(1, productivity / 100));
    const lastConsumption = instance?.lastConsumptionByGoodId ?? {};
    const lastProduction = instance?.lastProductionByGoodId ?? {};
    const lastPurchase = instance?.lastPurchaseByGoodId ?? {};
    const lastPurchaseCost = instance?.lastPurchaseCostByGoodId ?? {};
    const lastSales = instance?.lastSalesByGoodId ?? {};
    const lastSalesRevenue = instance?.lastSalesRevenueByGoodId ?? {};
    const inputs = (building.inputs ?? []).map((entry) => {
      const good = goodById.get(entry.goodId);
      const price = Math.max(0, Number(good?.basePrice ?? 1));
      const max = Math.max(0, Number(entry.amount ?? 0));
      const factual = Math.max(0, Number(lastConsumption[entry.goodId] ?? max * ratio));
      const cost =
        typeof instance?.lastInputCostDucats === "number"
          ? Math.max(0, Number(lastPurchaseCost[entry.goodId] ?? 0))
          : factual * price;
      return { goodName: good?.name ?? entry.goodId, goodLogoUrl: good?.logoUrl ?? null, factual, max, cost };
    });
    const outputs = (building.outputs ?? []).map((entry) => {
      const good = goodById.get(entry.goodId);
      const price = Math.max(0, Number(good?.basePrice ?? 1));
      const max = Math.max(0, Number(entry.amount ?? 0));
      const factual = Math.max(0, Number(lastProduction[entry.goodId] ?? max * ratio));
      const soldForGood = Math.max(0, Number(lastSales[entry.goodId] ?? 0));
      const revenue =
        typeof instance?.lastRevenueDucats === "number"
          ? Math.max(0, Number(lastSalesRevenue[entry.goodId] ?? 0))
          : factual * price;
      return { goodName: good?.name ?? entry.goodId, goodLogoUrl: good?.logoUrl ?? null, factual, max, income: revenue };
    });
    const inputCost =
      typeof instance?.lastInputCostDucats === "number"
        ? Math.max(0, Number(instance.lastInputCostDucats))
        : inputs.reduce((sum, entry) => sum + entry.cost, 0);
    const outputRevenue =
      typeof instance?.lastRevenueDucats === "number"
        ? Math.max(0, Number(instance.lastRevenueDucats))
        : outputs.reduce((sum, entry) => sum + entry.income, 0);
    const wagesCost =
      typeof instance?.lastWagesDucats === "number"
        ? Math.max(0, Number(instance.lastWagesDucats))
        : 0;
    const netPerTurn =
      typeof instance?.lastNetDucats === "number"
        ? Number(instance.lastNetDucats)
        : outputRevenue - inputCost - wagesCost;

    const storageAmount =
      typeof instance?.ducats === "number"
        ? Math.max(0, Number(instance.ducats))
        : (() => {
            const totalTreasuryByType = worldBase?.provinceBuildingDucatsByProvince?.[card.provinceId]?.[card.buildingId] ?? 0;
            const totalInstancesByType = (worldBase?.provinceBuildingsByProvince?.[card.provinceId] ?? []).filter(
              (entry) => entry.buildingId === card.buildingId,
            ).length;
            return totalInstancesByType > 0 ? totalTreasuryByType / totalInstancesByType : 0;
          })();
    const trade = [
      ...Object.entries(lastPurchase)
        .filter(([, amount]) => Number(amount) > 0)
        .map(([goodId, amount]) => {
          const good = goodById.get(goodId);
          const value = Number(amount);
          return {
            kind: "buy" as const,
            goodName: good?.name ?? goodId,
            goodLogoUrl: good?.logoUrl ?? null,
            amount: value,
            total: Math.max(0, Number(lastPurchaseCost[goodId] ?? 0)),
          };
        }),
      ...Object.entries(lastSales)
        .filter(([, amount]) => Number(amount) > 0)
        .map(([goodId, amount]) => {
          const good = goodById.get(goodId);
          const value = Number(amount);
          return {
            kind: "sell" as const,
            goodName: good?.name ?? goodId,
            goodLogoUrl: good?.logoUrl ?? null,
            amount: value,
            total: Math.max(0, Number(lastSalesRevenue[goodId] ?? 0)),
          };
        }),
    ];

    const stockMap = new Map<
      string,
      { goodName: string; goodLogoUrl: string | null; available: number; incoming: number; outgoing: number }
    >();
    const warehouse = instance?.warehouseByGoodId ?? {};
    for (const [goodId, amount] of Object.entries(warehouse)) {
      const good = goodById.get(goodId);
      const row = stockMap.get(goodId) ?? {
        goodName: good?.name ?? goodId,
        goodLogoUrl: good?.logoUrl ?? null,
        available: 0,
        incoming: 0,
        outgoing: 0,
      };
      row.available += Math.max(0, Number(amount));
      stockMap.set(goodId, row);
    }
    for (const [goodId, amount] of Object.entries(lastPurchase)) {
      const good = goodById.get(goodId);
      const row = stockMap.get(goodId) ?? {
        goodName: good?.name ?? goodId,
        goodLogoUrl: good?.logoUrl ?? null,
        available: 0,
        incoming: 0,
        outgoing: 0,
      };
      row.incoming += Math.max(0, Number(amount));
      stockMap.set(goodId, row);
    }
    for (const [goodId, amount] of Object.entries(lastConsumption)) {
      const good = goodById.get(goodId);
      const row = stockMap.get(goodId) ?? {
        goodName: good?.name ?? goodId,
        goodLogoUrl: good?.logoUrl ?? null,
        available: 0,
        incoming: 0,
        outgoing: 0,
      };
      row.outgoing += Math.max(0, Number(amount));
      stockMap.set(goodId, row);
    }
    for (const [goodId, amount] of Object.entries(lastSales)) {
      const good = goodById.get(goodId);
      const row = stockMap.get(goodId) ?? {
        goodName: good?.name ?? goodId,
        goodLogoUrl: good?.logoUrl ?? null,
        available: 0,
        incoming: 0,
        outgoing: 0,
      };
      row.outgoing += Math.max(0, Number(amount));
      stockMap.set(goodId, row);
    }
    const stockRows = [...stockMap.values()].map((row) => ({
      ...row,
      remainder: row.available + row.incoming - row.outgoing,
    }));

    return { productivity, inputCost, outputRevenue, wagesCost, netPerTurn, storageAmount, inputs, outputs, stockRows, trade };
  };

  const filteredCards = useMemo(() => {
    const source = [...cards].filter((card) => {
      if (filterBuildingId && card.buildingId !== filterBuildingId) return false;
      if (filterProvinceId && card.provinceId !== filterProvinceId) return false;
      if (filterCompanyId && card.ownerCompanyId !== filterCompanyId) return false;
      if (filterCompanyCountryId) {
        if (card.ownerType !== "company" || !card.ownerCompanyId) return false;
        const companyCountryId =
          (companies.find((company) => company.id === card.ownerCompanyId) as (ContentEntry & { countryId?: string }) | undefined)?.countryId ?? "";
        if (companyCountryId !== filterCompanyCountryId) return false;
      }
      if (filterIndustryId) {
        const industryId = (buildingById.get(card.buildingId) as (ContentEntry & { industryId?: string }) | undefined)?.industryId ?? "";
        if (industryId !== filterIndustryId) return false;
      }
      if (filterStatus !== "all" && card.kind !== filterStatus) return false;
      if (filterActive === "active" && !card.isActive) return false;
      if (filterActive === "inactive" && card.isActive) return false;
      if (filterEconomy !== "all" && card.kind === "built") {
        const econ = getCardEconomy(card);
        if (filterEconomy === "profit" && econ.netPerTurn <= 0) return false;
        if (filterEconomy === "loss" && econ.netPerTurn >= 0) return false;
      }
      return true;
    });
    source.sort((a, b) => {
      if (sortBy === "province") return a.provinceName.localeCompare(b.provinceName, "ru");
      if (sortBy === "company") return a.ownerLabel.localeCompare(b.ownerLabel, "ru");
      if (sortBy === "industry") return (a.industryName ?? "").localeCompare(b.industryName ?? "", "ru");
      return a.buildingName.localeCompare(b.buildingName, "ru");
    });
    return source;
  }, [
    cards,
    filterBuildingId,
    filterProvinceId,
    filterCompanyId,
    filterCompanyCountryId,
    filterIndustryId,
    filterStatus,
    filterActive,
    filterEconomy,
    sortBy,
    companies,
    buildingById,
  ]);

  const availableConstruction = Math.max(0, Math.floor(Number(worldBase?.resourcesByCountry?.[countryId]?.construction ?? 0)));
  const availableDucats = Math.max(0, Math.floor(Number(worldBase?.resourcesByCountry?.[countryId]?.ducats ?? 0)));
  const marketTopDeficitGoods = useMemo(
    () =>
      [...(marketOverview?.goods ?? [])]
        .sort((a, b) => a.countryCoveragePct - b.countryCoveragePct)
        .slice(0, 6),
    [marketOverview],
  );
  const infraRows = useMemo(
    () =>
      Object.entries(marketOverview?.infraByProvince ?? {})
        .map(([provinceId, info]) => ({ provinceId, ...info }))
        .sort((a, b) => a.coverage - b.coverage),
    [marketOverview],
  );
  const constructionCardClass =
    "relative z-0 h-[124px] rounded-lg border border-amber-400/55 bg-[#14100a] p-2 shadow-[0_0_0_1px_rgba(245,158,11,0.08)] transition-all duration-150 hover:z-10 hover:-translate-y-0.5 hover:border-amber-300/80 hover:shadow-[0_8px_24px_rgba(245,158,11,0.16)]";
  const selectedProvinceBuildings = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const instance of worldBase?.provinceBuildingsByProvince?.[provinceId] ?? []) {
      counts[instance.buildingId] = (counts[instance.buildingId] ?? 0) + 1;
    }
    return counts;
  }, [provinceId, worldBase?.provinceBuildingsByProvince]);

  const getBuildingAvailability = (building: ContentEntry): BuildAvailability => {
    const reasons: string[] = [];
    if (!provinceId) {
      reasons.push("Не выбрана провинция");
    }
    if (ownerType === "company" && !ownerCompanyId) {
      reasons.push("Не выбрана компания-владелец");
    }

    const raw = building as unknown as Record<string, unknown>;
    const allowedCountries = Array.isArray(raw.allowedCountryIds)
      ? raw.allowedCountryIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : Array.isArray(raw.allowedCountries)
        ? raw.allowedCountries.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
    const deniedCountries = Array.isArray(raw.deniedCountryIds)
      ? raw.deniedCountryIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    if (deniedCountries.includes(countryId)) {
      reasons.push("Страна находится в списке запрета");
    } else if (allowedCountries.length > 0 && !allowedCountries.includes(countryId)) {
      reasons.push("Страна не входит в список разрешенных");
    }

    const countBuiltAndQueued = Object.entries(worldBase?.provinceBuildingsByProvince ?? {}).reduce(
      (sum, [, instances]) =>
        sum + (instances ?? []).filter((instance) => instance.buildingId === building.id).length,
      0,
    ) +
      Object.values(worldBase?.provinceConstructionQueueByProvince ?? {}).reduce(
        (sum, queue) => sum + (queue ?? []).filter((project) => project.buildingId === building.id).length,
        0,
      );
    const countBuiltAndQueuedByCountry =
      Object.entries(worldBase?.provinceBuildingsByProvince ?? {}).reduce((sum, [pid, instances]) => {
        if ((worldBase?.provinceOwner?.[pid] ?? "") !== countryId) return sum;
        return sum + (instances ?? []).filter((instance) => instance.buildingId === building.id).length;
      }, 0) +
      Object.entries(worldBase?.provinceConstructionQueueByProvince ?? {}).reduce((sum, [pid, queue]) => {
        if ((worldBase?.provinceOwner?.[pid] ?? "") !== countryId) return sum;
        return sum + (queue ?? []).filter((project) => project.buildingId === building.id).length;
      }, 0);
    const pendingBuildOrders = [...(ordersByTurn.get(turnId)?.values() ?? [])]
      .flat()
      .filter((order) => {
        if (order.type !== "BUILD") return false;
        const payload = (order.payload ?? {}) as Record<string, unknown>;
        const requestedBuildingId =
          typeof payload.buildingId === "string"
            ? payload.buildingId
            : typeof payload.building === "string"
              ? payload.building
              : "";
        return requestedBuildingId === building.id;
      });
    const pendingGlobal = pendingBuildOrders.length;
    const pendingByCountry = pendingBuildOrders.filter((order) => order.countryId === countryId).length;
    const globalLimit =
      typeof raw.globalBuildLimit === "number" && Number.isFinite(raw.globalBuildLimit)
        ? Math.max(1, Math.floor(raw.globalBuildLimit))
        : null;
    if (globalLimit != null && countBuiltAndQueued + pendingGlobal >= globalLimit) {
      reasons.push(`Достигнут глобальный лимит (${countBuiltAndQueued + pendingGlobal}/${globalLimit})`);
    }
    const countryLimits = Array.isArray(raw.countryBuildLimits)
      ? raw.countryBuildLimits.filter(
          (row): row is { countryId: string; limit: number } =>
            Boolean(
              row &&
                typeof row === "object" &&
                typeof (row as { countryId?: unknown }).countryId === "string" &&
                typeof (row as { limit?: unknown }).limit === "number",
            ),
        )
      : [];
    const countryLimit = countryLimits.find((row) => row.countryId === countryId)?.limit ?? null;
    if (countryLimit != null && countBuiltAndQueuedByCountry + pendingByCountry >= countryLimit) {
      reasons.push(`Достигнут лимит для страны (${countBuiltAndQueuedByCountry + pendingByCountry}/${countryLimit})`);
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
    [sortedBuildings, provinceId, ownerType, ownerCompanyId, countryId, selectedProvinceBuildings, buildingById, worldBase, ordersByTurn, turnId],
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

  const demolishBuiltCard = async (target: {
    key: string;
    provinceId: string;
    buildingId: string;
    instanceId?: string;
  }) => {
    if (!auth?.token) return;
    setDemolishingCardKey(target.key);
    try {
      const result = await demolishCountryBuild(auth.token, {
        provinceId: target.provinceId,
        buildingId: target.buildingId,
        instanceId: target.instanceId,
      });
      toast.success(
        `Постройка снесена: -1 уровень (${formatCompact(result.demolitionCostConstruction)} очков строительства)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "BUILD_DEMOLISH_FAILED";
      if (message === "INSUFFICIENT_CONSTRUCTION_POINTS") {
        toast.error("Недостаточно очков строительства для сноса");
      } else if (message === "BUILDING_NOT_FOUND") {
        toast.error("Постройка уже отсутствует");
      } else if (message === "NOT_PROVINCE_OWNER") {
        toast.error("Снос доступен только в ваших провинциях");
      } else {
        toast.error("Не удалось снести постройку");
      }
    } finally {
      setDemolishingCardKey(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[206]">
      <motion.div aria-hidden="true" className="fixed inset-0 bg-black/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <div className="fixed inset-0 p-4 md:p-6">
        <Dialog.Panel className="glass panel-border flex h-full flex-col rounded-2xl bg-[#0b111b] p-4 shadow-2xl">
          <div className="mb-3 rounded-xl border border-white/10 bg-gradient-to-r from-[#0f1726] to-[#0b111b] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Dialog.Title className="font-display text-2xl tracking-wide text-arc-accent">Индустрия</Dialog.Title>
                <span className="mt-1 block text-xs text-white/60">Все построенные здания по провинциям</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConstructionOpen(true)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-400/35 bg-emerald-500/15 text-emerald-200"
                >
                  <SlidersHorizontal size={15} />
                </button>
                <button type="button" onClick={onClose} className="panel-border inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-slate-300">
                  <X size={16} />
                </button>
              </div>
            </div>
          </div>

          <div className="mb-3 rounded-xl border border-white/10 bg-black/25 p-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-7">
              <CustomSelect
                value={filterBuildingId}
                onChange={setFilterBuildingId}
                options={[{ value: "", label: "Фильтр по зданию" }, ...sortedBuildings.map((b) => ({ value: b.id, label: b.name }))]}
                placeholder="Фильтр по зданию"
              />
              <CustomSelect
                value={filterProvinceId}
                onChange={setFilterProvinceId}
                options={[{ value: "", label: "Фильтр по провинции" }, ...myProvinces.map((p) => ({ value: p.id, label: p.name }))]}
                placeholder="Фильтр по провинции"
              />
              <CustomSelect
                value={filterCompanyId}
                onChange={setFilterCompanyId}
                options={[{ value: "", label: "Фильтр по компании" }, ...companies.map((c) => ({ value: c.id, label: c.name }))]}
                placeholder="Фильтр по компании"
              />
              <CustomSelect
                value={filterCompanyCountryId}
                onChange={setFilterCompanyCountryId}
                options={[{ value: "", label: "Фильтр по стране компании" }, ...countries.map((c) => ({ value: c.id, label: c.name }))]}
                placeholder="Фильтр по стране компании"
              />
              <CustomSelect
                value={filterIndustryId}
                onChange={setFilterIndustryId}
                options={[{ value: "", label: "Фильтр по отрасли" }, ...industries.map((i) => ({ value: i.id, label: i.name }))]}
                placeholder="Фильтр по отрасли"
              />
              <CustomSelect
                value={filterStatus}
                onChange={(value) => setFilterStatus(value as "all" | "construction" | "built")}
                options={[
                  { value: "all", label: "Статус: Все" },
                  { value: "construction", label: "Статус: Строящиеся" },
                  { value: "built", label: "Статус: Построенные" },
                ]}
              />
              <CustomSelect
                value={filterActive}
                onChange={(value) => setFilterActive(value as "all" | "active" | "inactive")}
                options={[
                  { value: "all", label: "Активность: Все" },
                  { value: "active", label: "Активные" },
                  { value: "inactive", label: "Неактивные" },
                ]}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="w-full max-w-[260px]">
                <CustomSelect
                  value={filterEconomy}
                  onChange={(value) => setFilterEconomy(value as "all" | "profit" | "loss")}
                  options={[
                    { value: "all", label: "Экономика: Все" },
                    { value: "profit", label: "Экономика: Прибыльные" },
                    { value: "loss", label: "Экономика: Убыточные" },
                  ]}
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-white/70">
                <span>Всего: {filteredCards.length}</span>
                <button
                  type="button"
                  onClick={() => {
                    setFilterBuildingId("");
                    setFilterProvinceId("");
                    setFilterCompanyId("");
                    setFilterCompanyCountryId("");
                    setFilterIndustryId("");
                    setFilterStatus("all");
                    setFilterActive("all");
                    setFilterEconomy("all");
                  }}
                  className="rounded-lg border border-white/15 bg-black/35 px-2 py-1 hover:border-emerald-400/40"
                >
                  Сбросить фильтры
                </button>
                <div className="w-[190px]">
                  <CustomSelect
                    value={sortBy}
                    onChange={(value) => setSortBy(value as "building" | "province" | "company" | "industry")}
                    options={[
                      { value: "building", label: "Сортировка: По зданию" },
                      { value: "province", label: "Сортировка: По провинции" },
                      { value: "company", label: "Сортировка: По компании" },
                      { value: "industry", label: "Сортировка: По отрасли" },
                    ]}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="arc-scrollbar grid min-h-0 grid-cols-1 gap-3 overflow-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
            {filteredCards.map((c) => (
              (() => {
                const econ = c.kind === "built" ? getCardEconomy(c) : null;
                const displayInactiveReasons = [...c.inactiveReasons];
                if (c.kind === "built") {
                  const factors = [
                    { label: "labor", value: c.lastLaborCoverage },
                    { label: "input", value: c.lastInputCoverage },
                    { label: "infra", value: c.lastInfraCoverage },
                    { label: "finance", value: c.lastFinanceCoverage },
                  ]
                    .filter((f): f is { label: string; value: number } => typeof f.value === "number")
                    .sort((a, b) => a.value - b.value);
                  if (factors.length > 0 && factors[0].value < 0.999) {
                    const limiting = factors[0];
                    displayInactiveReasons.push(`Лимит-фактор: ${limiting.label} (${Math.round(limiting.value * 100)}%)`);
                  }
                }
                if (c.kind === "built" && econ && econ.netPerTurn < 0 && econ.storageAmount <= 0) {
                  displayInactiveReasons.push("Недостаточно дукатов: убыток не покрывается кассой здания");
                }
                const displayIsActive = displayInactiveReasons.length === 0;
                const econData = c.kind === "built" ? (econ ?? getCardEconomy(c)) : null;
                const cardBorder =
                  c.kind === "construction"
                    ? "border-amber-400/50"
                    : displayIsActive
                      ? "border-white/10"
                      : "border-red-400/60";
                return (
              <article key={c.key} className={`rounded-2xl border bg-gradient-to-br from-white/5 to-transparent p-4 flex flex-col gap-4 shadow-lg shadow-black/30 ${cardBorder}`}>
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/30">{c.iconUrl ? <img src={c.iconUrl} alt="" className="h-full w-full object-cover" /> : <Factory size={16} />}</div>
                      <div>
                      <div className="flex items-center gap-2 text-white/80 text-sm font-semibold">
                        <span>{c.buildingName || c.buildingId}</span>
                        {c.kind === "built" && (
                          <span className="inline-flex items-center rounded-full border border-white/15 bg-black/40 px-2 py-0.5 text-[10px] font-semibold text-white/70">
                            Ур. {c.level}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-white/45">Стоимость: {fmt(c.costConstruction)}</div>
                      {!displayIsActive && (
                        <Tooltip content={displayInactiveReasons.join(", ")} placement="top">
                          <span className="mt-1 inline-flex rounded-full border border-red-400/40 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-200">Неактивное</span>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                  {c.kind === "construction" ? (
                    <Tooltip content="Отменить строительство">
                      <button
                        type="button"
                        onClick={() =>
                          setCancelConfirmTarget({
                            key: c.key,
                            source: "queued",
                            buildingName: c.buildingName,
                            provinceName: c.provinceName,
                            provinceId: c.provinceId,
                            queueId: c.queueId,
                          })
                        }
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-white/60 transition hover:border-red-400/40 hover:text-red-300"
                      >
                        <X size={14} />
                      </button>
                    </Tooltip>
                  ) : (
                    <Tooltip content="Снести один уровень постройки (стоимость в очках строительства)">
                      <button
                        type="button"
                        onClick={() =>
                          setDemolishConfirmTarget({
                            key: c.key,
                            provinceId: c.provinceId,
                            buildingId: c.buildingId,
                            instanceId: c.instanceId,
                            buildingName: c.buildingName,
                            provinceName: c.provinceName,
                            demolitionCostConstruction: Math.ceil(
                              (Math.max(1, Math.floor(c.costConstruction)) * demolitionCostConstructionPercent) / 100,
                            ),
                          })
                        }
                        disabled={demolishingCardKey === c.key}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-white/60 transition hover:border-red-400/40 hover:text-red-300 disabled:opacity-40"
                      >
                        {demolishingCardKey === c.key ? "..." : <Trash2 size={14} />}
                      </button>
                    </Tooltip>
                  )}
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
                  {c.kind === "built" && <div className="flex items-center gap-2"><Hammer size={13} /><span className="text-white/40">Уровень:</span><span>{c.level}</span></div>}
                  <div className="flex items-center gap-2"><MapPin size={13} /><span className="text-white/40">Провинция:</span><span>{c.provinceName}</span></div>
                  <div className="flex items-center gap-2"><Building2 size={13} /><span className="text-white/40">Страна:</span><span>{countryById.get(c.provinceOwnerCountryId)?.name ?? (c.provinceOwnerCountryId || "—")}</span></div>
                  <div className="flex items-center gap-2"><Factory size={13} /><span className="text-white/40">Владелец:</span><span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/35 px-2 py-0.5 text-white/80">{c.ownerLogo ? <img src={c.ownerLogo} alt="" className="h-3.5 w-3.5 rounded object-cover border border-white/10" /> : null}{c.ownerLabel}</span></div>
                  {c.kind === "built" && <div className="flex items-center gap-2"><Users size={13} /><span className="text-white/40">Рабочие:</span><span>{fmt(c.workersEmployed)} / {fmt(c.workersDemand)}</span></div>}
                </div>
                {c.kind === "built" && (
                  <div className="rounded-xl border border-white/10 bg-black/30">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenEconomyByCardKey((prev) => ({
                          ...prev,
                          [c.key]: !prev[c.key],
                        }))
                      }
                      className="flex w-full items-center justify-between px-3 py-2 text-xs text-white/80"
                    >
                      <span>Экономика</span>
                      <div className="flex items-center gap-2">
                        <Tooltip content={`Производительность: ${econData?.productivity ?? 0}%. Показывает, какую долю от максимальной мощности здание отрабатывает за ход.`}>
                          <span className="inline-flex min-h-[22px] items-center justify-center gap-1.5 rounded-md border border-white/15 bg-black/40 px-2 py-1">
                            <span className="text-[10px] font-semibold text-white/75">Производительность: {econData?.productivity ?? 0}%</span>
                            <span className="h-1.5 w-14 overflow-hidden rounded-full border border-white/15 bg-black/60">
                              <span
                                className="block h-full bg-emerald-400/75"
                                style={{ width: `${Math.max(0, Math.min(100, econData?.productivity ?? 0))}%` }}
                              />
                            </span>
                          </span>
                        </Tooltip>
                        <Tooltip content="Накоплено денег у здания">
                          <span className="inline-flex min-h-[22px] items-center justify-center gap-1 rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[11px] font-bold leading-none text-white/75">
                            {resourceIcons.ducats ? (
                              <img src={resourceIcons.ducats} alt="" className="h-3.5 w-3.5 shrink-0 self-center object-contain" />
                            ) : (
                              <Coins size={11} />
                            )}
                            {formatCompact(econData?.storageAmount ?? 0)}
                          </span>
                        </Tooltip>
                        <Tooltip content="Финансовый результат здания за ход (прибыль или убыток)">
                          <span
                            className={`inline-flex min-h-[22px] items-center justify-center rounded-md border px-2 py-1 text-[11px] font-bold leading-none ${
                              (econData?.netPerTurn ?? 0) >= 0
                                ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                                : "border-red-400/40 bg-red-500/15 text-red-300"
                            }`}
                          >
                            <span className="inline-flex items-center justify-center gap-1">
                              {resourceIcons.ducats ? (
                                <img src={resourceIcons.ducats} alt="" className="h-3.5 w-3.5 shrink-0 self-center object-contain" />
                              ) : (
                                <Coins size={11} />
                              )}
                              <span>
                                {(econData?.netPerTurn ?? 0) >= 0 ? "+" : ""}
                                {formatCompact(econData?.netPerTurn ?? 0)}
                              </span>
                            </span>
                          </span>
                        </Tooltip>
                        {openEconomyByCardKey[c.key] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </div>
                    </button>
                    <AnimatePresence initial={false}>
                      {openEconomyByCardKey[c.key] && econData && (
                          <motion.div
                            key={`${c.key}-economy`}
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className="overflow-hidden"
                          >
                          <div className="space-y-2 border-t border-white/10 px-3 py-2 text-xs text-white/70">
                          <div className="space-y-1 rounded-md border border-white/15 bg-black/25 p-2">
                            <div className="inline-flex items-center gap-1.5 font-semibold text-white/50">
                              <Package size={12} className="shrink-0" />
                              <span>Склад</span>
                            </div>
                            {econData.stockRows.length === 0 ? (
                              <div className="text-white/50">пусто</div>
                            ) : (
                              <div className="space-y-1">
                                {econData.stockRows.map((row, idx) => (
                                  <div key={`${c.key}-stock-${idx}`} className="rounded-md border border-white/20 bg-white/[0.03] px-2 py-1 text-white/70">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="inline-flex items-center gap-1.5 text-white/75">
                                        {row.goodLogoUrl ? (
                                          <img src={row.goodLogoUrl} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" />
                                        ) : (
                                          <Package size={11} className="shrink-0 text-white/60" />
                                        )}
                                        <span className="font-semibold">{row.goodName}</span>
                                      </div>
                                      <div className="ml-auto flex flex-wrap items-center justify-end gap-1 text-[10px]">
                                        <span className="inline-flex items-center rounded-md border border-white/20 bg-white/10 px-1.5 py-0.5 font-bold text-white/70">
                                          В наличии: {formatCompact(row.available)}
                                        </span>
                                        <span className="inline-flex items-center rounded-md border border-white/20 bg-white/10 px-1.5 py-0.5 font-bold text-white/75">
                                          Пришло: {formatCompact(row.incoming)}
                                        </span>
                                        <span className="inline-flex items-center rounded-md border border-white/20 bg-white/10 px-1.5 py-0.5 font-bold text-white/75">
                                          Ушло: {formatCompact(row.outgoing)}
                                        </span>
                                        <span className="inline-flex items-center rounded-md border border-white/20 bg-white/10 px-1.5 py-0.5 font-bold text-white/80">
                                          Остаток: {formatCompact(row.remainder)}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="space-y-1 rounded-md border border-white/15 bg-black/25 p-2">
                            <div className="inline-flex items-center gap-1.5 font-semibold text-white/50">
                              <ArrowUpRight size={12} className="shrink-0" />
                              <span>Торговля за ход</span>
                            </div>
                            {econData.trade.length === 0 && <div className="text-white/50">пусто</div>}
                            {econData.trade.map((item, idx) => {
                              const isBuy = item.kind === "buy";
                              const rowClass = isBuy
                                ? "rounded-md border border-red-400/40 bg-red-500/10 px-2 py-1 text-white/70"
                                : "rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-white/70";
                              const titleClass = isBuy ? "text-red-300" : "text-emerald-300";
                              const pillClass = isBuy
                                ? "inline-flex items-center rounded-md border border-red-400/45 bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-200"
                                : "inline-flex items-center rounded-md border border-emerald-400/45 bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-200";
                              return (
                                <div key={`${c.key}-trade-${idx}`} className={rowClass}>
                                  <div className="flex items-center justify-between gap-2">
                                    <Tooltip content={isBuy ? "Покупка входных товаров за ход" : "Продажа выходных товаров за ход"}>
                                      <div className={`inline-flex items-center gap-1.5 font-semibold ${titleClass}`}>
                                        {item.goodLogoUrl ? (
                                          <img src={item.goodLogoUrl} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" />
                                        ) : isBuy ? (
                                          <ArrowDownLeft size={12} className="shrink-0" />
                                        ) : (
                                          <ArrowUpRight size={12} className="shrink-0" />
                                        )}
                                        <span>{item.goodName}</span>
                                      </div>
                                    </Tooltip>
                                    <div className="ml-auto flex items-center justify-end gap-1.5">
                                      <Tooltip content="Объем торговой операции за ход">
                                        <span className={pillClass}>Объем: {formatCompact(item.amount)}</span>
                                      </Tooltip>
                                      <Tooltip content={isBuy ? "Расход на закупку за ход" : "Доход от продажи за ход"}>
                                        <span className={pillClass}>
                                          {isBuy ? "Расход: " : "Доход: "}
                                          {formatCompact(item.total)} дукат
                                        </span>
                                      </Tooltip>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <div className="space-y-1 rounded-md border border-white/15 bg-black/25 p-2">
                            <div className="inline-flex items-center gap-1.5 font-semibold text-white/50">
                              <Factory size={12} className="shrink-0" />
                              <span>Производство</span>
                            </div>
                            {econData.outputs.length === 0 && <div className="text-white/50">нет выходных товаров</div>}
                            {econData.outputs.map((output, idx) => (
                              <div
                                key={`${c.key}-output-${idx}`}
                                className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-white/70"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <Tooltip content="Выходной товар, который производит здание">
                                    <div className="inline-flex items-center gap-1.5 font-semibold text-emerald-300">
                                      {output.goodLogoUrl ? (
                                        <img src={output.goodLogoUrl} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" />
                                      ) : (
                                        <Package size={12} className="shrink-0 text-emerald-300" />
                                      )}
                                      <span>{output.goodName}</span>
                                    </div>
                                  </Tooltip>
                                  <div className="ml-auto flex items-center justify-end gap-1.5">
                                    <Tooltip content="Фактический объем производства за ход">
                                      <span className="inline-flex items-center rounded-md border border-emerald-400/45 bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-200">
                                        Фактически: {formatCompact(output.factual)}
                                      </span>
                                    </Tooltip>
                                    <Tooltip content="Максимально возможный объем производства за ход">
                                      <span className="inline-flex items-center rounded-md border border-emerald-400/45 bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-200">
                                        Максимально: {formatCompact(output.max)}
                                      </span>
                                    </Tooltip>
                                    <Tooltip content="Доход от продажи выходного товара за ход">
                                      <span className="inline-flex items-center rounded-md border border-emerald-400/45 bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-200">
                                        Доход: {formatCompact(output.income)} дукат
                                      </span>
                                    </Tooltip>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="space-y-1 rounded-md border border-white/15 bg-black/25 p-2">
                            <div className="inline-flex items-center gap-1.5 font-semibold text-white/50">
                              <ArrowDownLeft size={12} className="shrink-0" />
                              <span>Потребление</span>
                            </div>
                            {econData.inputs.length === 0 && <div className="text-white/50">нет входных товаров</div>}
                            {econData.inputs.map((input, idx) => (
                              <div
                                key={`${c.key}-input-${idx}`}
                                className="rounded-md border border-red-400/40 bg-red-500/10 px-2 py-1 text-white/70"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <Tooltip content="Входной товар, который здание закупает для производства">
                                    <div className="inline-flex items-center gap-1.5 font-semibold text-red-300">
                                      {input.goodLogoUrl ? (
                                        <img src={input.goodLogoUrl} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" />
                                      ) : (
                                        <Package size={12} className="shrink-0 text-red-300" />
                                      )}
                                      <span>{input.goodName}</span>
                                    </div>
                                  </Tooltip>
                                  <div className="ml-auto flex items-center justify-end gap-1.5">
                                    <Tooltip content="Фактический объем закупки за ход">
                                      <span className="inline-flex items-center rounded-md border border-red-400/45 bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-200">
                                        Фактически: {formatCompact(input.factual)}
                                      </span>
                                    </Tooltip>
                                    <Tooltip content="Максимально возможный объем закупки за ход">
                                      <span className="inline-flex items-center rounded-md border border-red-400/45 bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-200">
                                        Максимально: {formatCompact(input.max)}
                                      </span>
                                    </Tooltip>
                                    <Tooltip content="Стоимость закупки входного товара за ход">
                                      <span className="inline-flex items-center rounded-md border border-red-400/45 bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-200">
                                        Затраты: {formatCompact(input.cost)} дукат
                                      </span>
                                    </Tooltip>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="space-y-1 rounded-md border border-white/15 bg-black/25 p-2">
                            <div className="inline-flex items-center gap-1.5 font-semibold text-white/50">
                              <Coins size={12} className="shrink-0" />
                              <span>Финансы</span>
                            </div>
                            <div className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-white/70">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-emerald-300">Доход от продаж</span>
                                <span className="inline-flex items-center rounded-md border border-emerald-400/45 bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-200">
                                  +{formatCompact(econData.outputRevenue)} дукат
                                </span>
                              </div>
                            </div>
                            <div className="rounded-md border border-red-400/40 bg-red-500/10 px-2 py-1 text-white/70">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-red-300">Закупка товаров</span>
                                <span className="inline-flex items-center rounded-md border border-red-400/45 bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-200">
                                  -{formatCompact(econData.inputCost)} дукат
                                </span>
                              </div>
                            </div>
                            <div className="rounded-md border border-red-400/40 bg-red-500/10 px-2 py-1 text-white/70">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-red-300">Зарплаты</span>
                                <span className="inline-flex items-center rounded-md border border-red-400/45 bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-200">
                                  -{formatCompact(econData.wagesCost)} дукат
                                </span>
                              </div>
                            </div>
                            <div
                              className={`rounded-md border px-2 py-1 text-white/70 ${
                                econData.netPerTurn >= 0
                                  ? "border-emerald-400/40 bg-emerald-500/10"
                                  : "border-red-400/40 bg-red-500/10"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className={econData.netPerTurn >= 0 ? "font-semibold text-emerald-300" : "font-semibold text-red-300"}>
                                  Итог за ход
                                </span>
                                <span
                                  className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${
                                    econData.netPerTurn >= 0
                                      ? "border-emerald-400/45 bg-emerald-500/20 text-emerald-200"
                                      : "border-red-400/45 bg-red-500/20 text-red-200"
                                  }`}
                                >
                                  {econData.netPerTurn >= 0 ? "+" : ""}
                                  {formatCompact(econData.netPerTurn)} дукат
                                </span>
                              </div>
                            </div>
                          </div>
                          </div>
                          </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </article>
                );
              })()
            ))}
            {filteredCards.length === 0 && (
              <div className="col-span-full rounded-lg border border-dashed border-white/15 bg-black/20 p-4 text-sm text-white/50">
                По выбранным фильтрам ничего не найдено.
              </div>
            )}
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

            <div className="min-h-0 flex flex-1 flex-col gap-4">
              <section className="rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="mb-2 text-xs uppercase tracking-wide text-white/45">Общие параметры строительства</div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <label className="flex flex-col gap-1 text-xs text-white/65">
                    <Tooltip content="Страна, в провинциях которой планируется строительство. По умолчанию выбрана ваша страна.">
                      <span>Страна строительства</span>
                    </Tooltip>
                    <CustomSelect
                      value={buildCountryId}
                      onChange={setBuildCountryId}
                      options={buildCountryOptions.map((country) => ({ value: country.id, label: country.name }))}
                      placeholder="Выберите страну"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-white/65">
                    <Tooltip content="Выбранная провинция применяется ко всем добавляемым проектам из списка ниже.">
                      <span>Провинция</span>
                    </Tooltip>
                    <CustomSelect
                      value={provinceId}
                      onChange={setProvinceId}
                      options={buildProvinces.map((p) => ({ value: p.id, label: p.name }))}
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
                        options={ownerCountryOptions.map((country) => ({
                          value: country.id,
                          label: country.name,
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
                  <div className="mb-2 flex items-center justify-between gap-2 px-1">
                    <div className="text-xs uppercase tracking-wide text-white/45">Доступные здания</div>
                    <div className="flex items-center gap-1.5">
                      <Tooltip content="Очки строительства страны (без текстовой плашки).">
                        <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/35 px-2 py-1 text-[11px] text-white/75">
                          {resourceIcons.construction ? (
                            <img src={resourceIcons.construction} alt="" className="h-3.5 w-3.5 object-contain" />
                          ) : (
                            <Hammer size={12} className="text-emerald-300" />
                          )}
                          <span className="font-bold text-white/60">{formatCompact(availableConstruction)}</span>
                        </div>
                      </Tooltip>
                      <Tooltip content="Дукаты страны (без текстовой плашки).">
                        <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/35 px-2 py-1 text-[11px] text-white/75">
                          {resourceIcons.ducats ? (
                            <img src={resourceIcons.ducats} alt="" className="h-3.5 w-3.5 object-contain" />
                          ) : (
                            <Coins size={12} className="text-amber-300" />
                          )}
                          <span className="font-bold text-white/60">{formatCompact(availableDucats)}</span>
                        </div>
                      </Tooltip>
                    </div>
                  </div>
                  <div className="arc-scrollbar min-h-0 flex-1 space-y-2 overflow-auto pr-1 pt-1">
                    {buildableBuildingCards.map(({ building, availability }) => {
                      const costConstruction = Math.max(1, Math.floor(Number(building.costConstruction ?? 100)));
                      const costDucats = Math.max(0, Math.floor(Number(building.costDucats ?? 0)));
                      const canAdd = availability.available;
                      const cardClass = canAdd
                        ? "relative z-0 h-[124px] rounded-lg border border-emerald-400/55 bg-[#0f1a13] p-2 shadow-[0_0_0_1px_rgba(16,185,129,0.1)] transition-all duration-150 hover:z-10 hover:-translate-y-0.5 hover:border-emerald-300/80 hover:shadow-[0_8px_24px_rgba(16,185,129,0.15)]"
                        : "relative z-0 h-[124px] rounded-lg border border-red-400/55 bg-[#1a1010] p-2 shadow-[0_0_0_1px_rgba(248,113,113,0.08)] transition-all duration-150 hover:z-10 hover:-translate-y-0.5 hover:border-red-300/80 hover:shadow-[0_8px_24px_rgba(248,113,113,0.14)]";
                      return (
                        <div key={building.id} className={cardClass}>
                          <div className="h-full overflow-hidden rounded-md flex items-stretch">
                            <div className={`flex w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black ${canAdd ? "border border-emerald-400/40" : "border border-red-400/40"}`}>
                              {building.logoUrl ? (
                                <img src={building.logoUrl} alt="" className="h-[72px] w-[72px] object-contain" />
                              ) : (
                                <Factory size={30} className="text-white/60" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1 p-3">
                            <div className="flex h-full items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-white/90">{building.name}</div>
                                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-white/40">
                                  <Hammer size={10} className="text-white/40" />
                                  <span>Стоимость строительства</span>
                                </div>
                                <div className="text-[11px] text-white/55">
                                  <div className="flex items-center gap-1">
                                    {resourceIcons.construction ? (
                                      <img src={resourceIcons.construction} alt="" className="h-3.5 w-3.5 object-contain" />
                                    ) : (
                                      <Hammer size={12} className="text-emerald-300" />
                                    )}
                                    <span className="text-white/40">{formatCompact(costConstruction)}</span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {resourceIcons.ducats ? (
                                      <img src={resourceIcons.ducats} alt="" className="h-3.5 w-3.5 object-contain" />
                                    ) : (
                                      <Coins size={12} className="text-amber-300" />
                                    )}
                                    <span className="text-white/40">{formatCompact(costDucats)}</span>
                                  </div>
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
                                    {canAdd ? <Plus size={20} /> : <Lock size={18} />}
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
                  <div className="mb-2 flex items-center justify-between gap-2 px-1">
                    <div className="text-xs uppercase tracking-wide text-white/45">Очередь строительства</div>
                    <Tooltip content="Количество проектов в очереди строительства (включая pending текущего хода).">
                      <div className="inline-flex items-center gap-1 rounded-md border border-amber-400/55 bg-[#14100a] px-2 py-0.5 text-[11px] font-bold text-amber-300">
                        <Hammer size={11} className="text-amber-300" />
                        <span>{formatCompact(constructionQueue.length)}</span>
                      </div>
                    </Tooltip>
                  </div>
                  {constructionQueue.length === 0 && (
                    <div className="rounded-lg border border-dashed border-white/15 bg-black/20 p-3 text-xs text-white/45">
                      Очередь пуста
                    </div>
                  )}
                  {constructionQueue.length > 0 && (
                    <div className="arc-scrollbar arc-scrollbar-construction min-h-0 flex-1 space-y-2 overflow-auto pr-1 pt-1">
                      {constructionQueue.map((card) => (
                        <div key={card.key} className={constructionCardClass}>
                          <div className="h-full overflow-hidden rounded-md flex items-stretch">
                            <div className="flex w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-amber-400/40 bg-black">
                              {card.iconUrl ? (
                                <img src={card.iconUrl} alt="" className="h-[72px] w-[72px] object-contain" />
                              ) : (
                                <Factory size={30} className="text-white/60" />
                              )}
                            </div>
                            <div className="min-w-0 flex h-full flex-1 flex-col p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-white/90">{card.buildingName}</div>
                                  <div className="text-[11px] text-white/55">{card.provinceName}</div>
                                </div>
                              </div>
                              <div className="mt-auto flex items-center gap-0.5">
                                <div className="w-9 shrink-0 text-[11px] leading-none text-amber-300/90">{card.progressPercent}%</div>
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
                              <div className="mt-1 text-[11px] text-white/55">
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
                                    setCancelConfirmTarget(
                                      card.source === "pending"
                                        ? {
                                            key: card.key,
                                            source: "pending",
                                            buildingName: card.buildingName,
                                            provinceName: card.provinceName,
                                            orderId: card.orderId,
                                          }
                                        : {
                                            key: card.key,
                                            source: "queued",
                                            buildingName: card.buildingName,
                                            provinceName: card.provinceName,
                                            provinceId: card.provinceId,
                                            queueId: card.queueId,
                                          },
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

      <Dialog open={Boolean(cancelConfirmTarget)} onClose={() => setCancelConfirmTarget(null)} className="relative z-[208]">
        <motion.div aria-hidden="true" className="fixed inset-0 bg-black/65 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="glass panel-border w-full max-w-md rounded-2xl bg-[#0b111b] p-4 shadow-2xl">
            <div className="rounded-lg border border-amber-400/55 bg-[#14100a] p-3 shadow-[0_0_0_1px_rgba(245,158,11,0.08)]">
              <Dialog.Title className="text-sm font-semibold text-white">Отменить строительство?</Dialog.Title>
              <div className="mt-2 text-xs text-white/70">
                <div>
                  Здание: <span className="text-white/90">{cancelConfirmTarget?.buildingName ?? "—"}</span>
                </div>
                <div>
                  Провинция: <span className="text-white/90">{cancelConfirmTarget?.provinceName ?? "—"}</span>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCancelConfirmTarget(null)}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-white/15 bg-black/35 px-3 text-xs font-semibold text-white/75 hover:border-white/30"
                >
                  Нет
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!cancelConfirmTarget) return;
                    if (cancelConfirmTarget.source === "pending" && cancelConfirmTarget.orderId) {
                      void cancelBuildQueueItem({
                        key: cancelConfirmTarget.key,
                        source: "pending",
                        orderId: cancelConfirmTarget.orderId,
                      });
                    } else if (
                      cancelConfirmTarget.source === "queued" &&
                      cancelConfirmTarget.provinceId &&
                      cancelConfirmTarget.queueId
                    ) {
                      void cancelBuildQueueItem({
                        key: cancelConfirmTarget.key,
                        source: "queued",
                        provinceId: cancelConfirmTarget.provinceId,
                        queueId: cancelConfirmTarget.queueId,
                      });
                    }
                    setCancelConfirmTarget(null);
                  }}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-amber-400/55 bg-amber-500/20 px-3 text-xs font-semibold text-amber-200 hover:bg-amber-500/30"
                >
                  Да
                </button>
              </div>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>

      <Dialog open={Boolean(demolishConfirmTarget)} onClose={() => setDemolishConfirmTarget(null)} className="relative z-[208]">
        <motion.div aria-hidden="true" className="fixed inset-0 bg-black/65 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="glass panel-border w-full max-w-md rounded-2xl bg-[#0b111b] p-4 shadow-2xl">
            <div className="rounded-lg border border-red-400/55 bg-[#160d0d] p-3 shadow-[0_0_0_1px_rgba(248,113,113,0.08)]">
              <Dialog.Title className="text-sm font-semibold text-white">Снести постройку?</Dialog.Title>
              <div className="mt-2 text-xs text-white/70">
                <div>
                  Здание: <span className="text-white/90">{demolishConfirmTarget?.buildingName ?? "—"}</span>
                </div>
                <div>
                  Провинция: <span className="text-white/90">{demolishConfirmTarget?.provinceName ?? "—"}</span>
                </div>
                <div className="mt-1">
                  Стоимость сноса:{" "}
                  <span className="text-white/90">
                    {formatCompact(demolishConfirmTarget?.demolitionCostConstruction ?? 0)} очков строительства
                  </span>
                </div>
                <div>
                  Доступно: <span className="text-white/90">{formatCompact(availableConstruction)}</span>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDemolishConfirmTarget(null)}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-white/15 bg-black/35 px-3 text-xs font-semibold text-white/75 hover:border-white/30"
                >
                  Нет
                </button>
                <button
                  type="button"
                  disabled={(demolishConfirmTarget?.demolitionCostConstruction ?? 0) > availableConstruction}
                  onClick={() => {
                    if (!demolishConfirmTarget) return;
                    void demolishBuiltCard({
                      key: demolishConfirmTarget.key,
                      provinceId: demolishConfirmTarget.provinceId,
                      buildingId: demolishConfirmTarget.buildingId,
                      instanceId: demolishConfirmTarget.instanceId,
                    });
                    setDemolishConfirmTarget(null);
                  }}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-red-400/55 bg-red-500/20 px-3 text-xs font-semibold text-red-200 hover:bg-red-500/30 disabled:opacity-40"
                >
                  Да
                </button>
              </div>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </Dialog>
  );
}
