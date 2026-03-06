import { Dialog } from "@headlessui/react";
import { AnimatePresence, motion } from "framer-motion";
import { Briefcase, Building2, ChevronDown, ChevronRight, Factory, FileText, Flame, Package, Palette, Plus, ScrollText, Sticker, Trash2, Upload, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Tooltip } from "./Tooltip";
import { CustomSelect } from "./CustomSelect";
import {
  adminCreateContentEntry,
  adminDeleteContentEntry,
  adminDeleteContentEntryLogo,
  adminDeleteRacePortrait,
  adminFetchContentEntries,
  adminUpdateContentEntry,
  adminUploadContentEntryLogo,
  adminUploadRacePortrait,
  fetchCountries,
  fetchWorldSnapshot,
  type ContentEntry,
  type ContentEntryKind,
} from "../lib/api";

type Props = {
  open: boolean;
  token: string;
  onClose: () => void;
};

const CONTENT_UI_SCHEMA = {
  categories: [
    {
      id: "cultures",
      label: "Культуры",
      icon: Palette,
      enabled: true,
      sections: [
        { id: "general", label: "Основная информация", icon: FileText },
        { id: "branding", label: "Логотип и стиль", icon: Sticker },
      ] as const,
    },
    {
      id: "religions",
      label: "Религии",
      icon: ScrollText,
      enabled: true,
      sections: [
        { id: "general", label: "Основная информация", icon: FileText },
        { id: "branding", label: "Логотип и стиль", icon: Sticker },
      ] as const,
    },
    {
      id: "races",
      label: "Расы",
      icon: UserRound,
      enabled: true,
      sections: [
        { id: "general", label: "Основная информация", icon: FileText },
        { id: "branding", label: "Логотип и стиль", icon: Sticker },
      ] as const,
    },
    {
      id: "resourceCategories",
      label: "Категории инфраструктуры",
      icon: Package,
      enabled: true,
      sections: [
        { id: "general", label: "Основная информация", icon: FileText },
        { id: "branding", label: "Логотип и стиль", icon: Sticker },
      ] as const,
    },
    {
      id: "professions",
      label: "Профессии",
      icon: Briefcase,
      enabled: true,
      sections: [
        { id: "general", label: "Основная информация", icon: FileText },
        { id: "economy", label: "Экономика профессии", icon: Factory },
        { id: "branding", label: "Логотип и стиль", icon: Sticker },
      ] as const,
    },
    {
      id: "ideologies",
      label: "Идеологии",
      icon: Flame,
      enabled: true,
      sections: [
        { id: "general", label: "Основная информация", icon: FileText },
        { id: "branding", label: "Логотип и стиль", icon: Sticker },
      ] as const,
    },
    {
      id: "buildings",
      label: "Здания",
      icon: Building2,
      enabled: true,
      sections: [
        { id: "general", label: "Основная информация", icon: FileText },
        { id: "economy", label: "Экономика и производство", icon: Factory },
        { id: "criteria", label: "Критерии", icon: ScrollText },
        { id: "branding", label: "Логотип и стиль", icon: Sticker },
      ] as const,
    },
    {
      id: "goods",
      label: "Товары",
      icon: Package,
      enabled: true,
      sections: [
        { id: "general", label: "Основная информация", icon: FileText },
        { id: "economy", label: "Экономика товара", icon: Factory },
        { id: "branding", label: "Логотип и стиль", icon: Sticker },
      ] as const,
    },
    {
      id: "companies",
      label: "Компании",
      icon: Briefcase,
      enabled: true,
      sections: [
        { id: "general", label: "Основная информация", icon: FileText },
        { id: "branding", label: "Логотип и стиль", icon: Sticker },
      ] as const,
    },
    {
      id: "industries",
      label: "Отрасли",
      icon: Factory,
      enabled: true,
      sections: [
        { id: "general", label: "Основная информация", icon: FileText },
        { id: "branding", label: "Логотип и стиль", icon: Sticker },
      ] as const,
    },
  ] as const,
} as const;
type PanelCategory = ContentEntryKind;
type PanelSection = "general" | "economy" | "criteria" | "branding";
type GoodFlowDraft = { goodId: string; amount: string };
type WorkforceRequirementDraft = { professionId: string; workers: string };
type CountryBuildLimitDraft = { countryId: string; limit: string };
type CategoryAmountDraft = { categoryId: string; amount: string };

const CATEGORY_META: Record<
  PanelCategory,
  { singular: string; createBaseName: string; createLabel: string; namePlaceholder: string; descriptionPlaceholder: string; sectionTitle: string }
> = {
  cultures: {
    singular: "культура",
    createBaseName: "Новая культура",
    createLabel: "Создать культуру",
    namePlaceholder: "Название культуры",
    descriptionPlaceholder: "Краткое описание культуры",
    sectionTitle: "Раздел создания и редактирования культур",
  },
  races: {
    singular: "раса",
    createBaseName: "Новая раса",
    createLabel: "Создать расу",
    namePlaceholder: "Название расы",
    descriptionPlaceholder: "Краткое описание расы",
    sectionTitle: "Раздел создания и редактирования рас",
  },
  resourceCategories: {
    singular: "категория инфраструктуры",
    createBaseName: "Новая категория инфраструктуры",
    createLabel: "Создать категорию",
    namePlaceholder: "Название категории инфраструктуры",
    descriptionPlaceholder: "Краткое описание категории инфраструктуры",
    sectionTitle: "Раздел создания и редактирования категорий инфраструктуры",
  },
  religions: {
    singular: "религия",
    createBaseName: "Новая религия",
    createLabel: "Создать религию",
    namePlaceholder: "Название религии",
    descriptionPlaceholder: "Краткое описание религии",
    sectionTitle: "Раздел создания и редактирования религий",
  },
  professions: {
    singular: "профессия",
    createBaseName: "Новая профессия",
    createLabel: "Создать профессию",
    namePlaceholder: "Название профессии",
    descriptionPlaceholder: "Краткое описание профессии",
    sectionTitle: "Раздел создания и редактирования профессий",
  },
  ideologies: {
    singular: "идеология",
    createBaseName: "Новая идеология",
    createLabel: "Создать идеологию",
    namePlaceholder: "Название идеологии",
    descriptionPlaceholder: "Краткое описание идеологии",
    sectionTitle: "Раздел создания и редактирования идеологий",
  },
  buildings: {
    singular: "здание",
    createBaseName: "Новое здание",
    createLabel: "Создать здание",
    namePlaceholder: "Название здания",
    descriptionPlaceholder: "Краткое описание здания",
    sectionTitle: "Раздел создания и редактирования зданий",
  },
  goods: {
    singular: "товар",
    createBaseName: "Новый товар",
    createLabel: "Создать товар",
    namePlaceholder: "Название товара",
    descriptionPlaceholder: "Краткое описание товара",
    sectionTitle: "Раздел создания и редактирования товаров",
  },
  companies: {
    singular: "компания",
    createBaseName: "Новая компания",
    createLabel: "Создать компанию",
    namePlaceholder: "Название компании",
    descriptionPlaceholder: "Краткое описание компании",
    sectionTitle: "Раздел создания и редактирования компаний",
  },
  industries: {
    singular: "отрасль",
    createBaseName: "Новая отрасль",
    createLabel: "Создать отрасль",
    namePlaceholder: "Название отрасли",
    descriptionPlaceholder: "Краткое описание отрасли",
    sectionTitle: "Раздел создания и редактирования отраслей",
  },
};

async function validateLogo64(file: File): Promise<void> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("READ_FAILED"));
    reader.readAsDataURL(file);
  });
  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.width > 64 || img.height > 64) {
        reject(new Error("LOGO_TOO_LARGE"));
        return;
      }
      resolve();
    };
    img.onerror = () => reject(new Error("IMAGE_INVALID"));
    img.src = dataUrl;
  });
}

async function validateRacePortrait(file: File): Promise<void> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("READ_FAILED"));
    reader.readAsDataURL(file);
  });
  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.width > 89 || img.height > 100) {
        reject(new Error("RACE_PORTRAIT_TOO_LARGE"));
        return;
      }
      resolve();
    };
    img.onerror = () => reject(new Error("IMAGE_INVALID"));
    img.src = dataUrl;
  });
}

function normalizeGoodFlowsDraft(rows: GoodFlowDraft[]): Array<{ goodId: string; amount: number }> {
  return rows
    .map((row) => ({
      goodId: row.goodId.trim(),
      amount: Number(row.amount),
    }))
    .filter((row) => row.goodId.length > 0 && Number.isFinite(row.amount) && row.amount > 0)
    .map((row) => ({ ...row, amount: Number(row.amount.toFixed(3)) }));
}

function normalizeWorkforceDraft(rows: WorkforceRequirementDraft[]): Array<{ professionId: string; workers: number }> {
  return rows
    .map((row) => ({
      professionId: row.professionId.trim(),
      workers: Number(row.workers),
    }))
    .filter((row) => row.professionId.length > 0 && Number.isFinite(row.workers) && row.workers > 0)
    .map((row) => ({ ...row, workers: Math.floor(row.workers) }));
}

function normalizeCountryIdsDraft(rows: string[]): string[] {
  return [...new Set(rows.map((row) => row.trim()).filter((row) => row.length > 0))];
}

function normalizeCountryBuildLimitsDraft(
  rows: CountryBuildLimitDraft[],
): Array<{ countryId: string; limit: number }> {
  const dedup = new Map<string, number>();
  for (const row of rows) {
    const countryId = row.countryId.trim();
    const limit = Number(row.limit);
    if (!countryId || !Number.isFinite(limit) || limit <= 0) continue;
    dedup.set(countryId, Math.max(1, Math.floor(limit)));
  }
  return [...dedup.entries()].map(([countryId, limit]) => ({ countryId, limit }));
}

function normalizeCategoryAmountDraft(rows: CategoryAmountDraft[]): Record<string, number> {
  const dedup = new Map<string, number>();
  for (const row of rows) {
    const categoryId = row.categoryId.trim();
    const amount = Number(row.amount);
    if (!categoryId || !Number.isFinite(amount) || amount <= 0) continue;
    dedup.set(categoryId, Number(amount.toFixed(3)));
  }
  return Object.fromEntries(dedup.entries());
}

export function ContentPanel({ open, token, onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState<PanelCategory>("cultures");
  const [contentSection, setContentSection] = useState<PanelSection>("general");
  const [entries, setEntries] = useState<ContentEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedEntryId, setSelectedEntryId] = useState<string>("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftColor, setDraftColor] = useState("#4ade80");
  const [draftLogoUrl, setDraftLogoUrl] = useState<string | null>(null);
  const [draftMalePortraitUrl, setDraftMalePortraitUrl] = useState<string | null>(null);
  const [draftFemalePortraitUrl, setDraftFemalePortraitUrl] = useState<string | null>(null);
  const [draftBasePrice, setDraftBasePrice] = useState("1");
  const [draftMinPrice, setDraftMinPrice] = useState("0.1");
  const [draftMaxPrice, setDraftMaxPrice] = useState("10");
  const [draftInfraPerUnit, setDraftInfraPerUnit] = useState("1");
  const [draftResourceCategoryId, setDraftResourceCategoryId] = useState("");
  const [draftBaseWage, setDraftBaseWage] = useState("1");
  const [draftCostConstruction, setDraftCostConstruction] = useState("100");
  const [draftCostDucats, setDraftCostDucats] = useState("10");
  const [draftStartingDucats, setDraftStartingDucats] = useState("0");
  const [draftInfrastructureUse, setDraftInfrastructureUse] = useState("0");
  const [draftInputs, setDraftInputs] = useState<GoodFlowDraft[]>([]);
  const [draftOutputs, setDraftOutputs] = useState<GoodFlowDraft[]>([]);
  const [draftWorkforceRequirements, setDraftWorkforceRequirements] = useState<WorkforceRequirementDraft[]>([]);
  const [draftMarketInfrastructureByCategory, setDraftMarketInfrastructureByCategory] = useState<CategoryAmountDraft[]>([]);
  const [draftAllowedCountryIds, setDraftAllowedCountryIds] = useState<string[]>([]);
  const [draftDeniedCountryIds, setDraftDeniedCountryIds] = useState<string[]>([]);
  const [draftCountryBuildLimits, setDraftCountryBuildLimits] = useState<CountryBuildLimitDraft[]>([]);
  const [draftGlobalBuildLimit, setDraftGlobalBuildLimit] = useState("");
  const [allowCountrySearch, setAllowCountrySearch] = useState("");
  const [denyCountrySearch, setDenyCountrySearch] = useState("");
  const [criteriaCountriesOpen, setCriteriaCountriesOpen] = useState(false);
  const [criteriaLimitsOpen, setCriteriaLimitsOpen] = useState(false);
  const [goodsEconomyOpen, setGoodsEconomyOpen] = useState(false);
  const [buildingCostOpen, setBuildingCostOpen] = useState(false);
  const [buildingInputsOpen, setBuildingInputsOpen] = useState(false);
  const [buildingOutputsOpen, setBuildingOutputsOpen] = useState(false);
  const [buildingWorkforceOpen, setBuildingWorkforceOpen] = useState(false);
  const [buildingMarketInfraOpen, setBuildingMarketInfraOpen] = useState(false);
  const [goodsOptions, setGoodsOptions] = useState<ContentEntry[]>([]);
  const [resourceCategoryOptions, setResourceCategoryOptions] = useState<ContentEntry[]>([]);
  const [professionOptions, setProfessionOptions] = useState<ContentEntry[]>([]);
  const [countryOptions, setCountryOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [worldBuildingUsage, setWorldBuildingUsage] = useState<{
    globalByBuildingId: Record<string, number>;
    byCountryByBuildingId: Record<string, Record<string, number>>;
  }>({ globalByBuildingId: {}, byCountryByBuildingId: {} });
  const [savedSnapshot, setSavedSnapshot] = useState<string>("");
  const buildSnapshot = (entry: ContentEntry) =>
    JSON.stringify({
      id: entry.id,
      name: entry.name.trim(),
      description: (entry.description ?? "").trim(),
      color: entry.color,
      logoUrl: entry.logoUrl ?? null,
      malePortraitUrl: entry.malePortraitUrl ?? null,
      femalePortraitUrl: entry.femalePortraitUrl ?? null,
      basePrice: entry.basePrice ?? null,
      minPrice: entry.minPrice ?? null,
      maxPrice: entry.maxPrice ?? null,
      infraPerUnit: entry.infraPerUnit ?? null,
      infrastructureCostPerUnit: entry.infrastructureCostPerUnit ?? null,
      resourceCategoryId: entry.resourceCategoryId ?? null,
      baseWage: entry.baseWage ?? null,
      costConstruction: entry.costConstruction ?? null,
      costDucats: entry.costDucats ?? null,
      startingDucats: entry.startingDucats ?? null,
      infrastructureUse: entry.infrastructureUse ?? null,
      inputs: (entry.inputs ?? []).map((row) => ({ goodId: row.goodId, amount: Number(row.amount.toFixed(3)) })),
      outputs: (entry.outputs ?? []).map((row) => ({ goodId: row.goodId, amount: Number(row.amount.toFixed(3)) })),
      workforceRequirements: (entry.workforceRequirements ?? []).map((row) => ({
        professionId: row.professionId,
        workers: Math.floor(row.workers),
      })),
      marketInfrastructureByCategory: Object.fromEntries(
        Object.entries(entry.marketInfrastructureByCategory ?? {}).map(([categoryId, amount]) => [
          categoryId,
          Number(Number(amount).toFixed(3)),
        ]),
      ),
      allowedCountryIds: normalizeCountryIdsDraft(entry.allowedCountryIds ?? []),
      deniedCountryIds: normalizeCountryIdsDraft(entry.deniedCountryIds ?? []),
      countryBuildLimits: normalizeCountryBuildLimitsDraft(
        (entry.countryBuildLimits ?? []).map((row) => ({ countryId: row.countryId, limit: String(row.limit) })),
      ),
      globalBuildLimit:
        typeof entry.globalBuildLimit === "number" && Number.isFinite(entry.globalBuildLimit)
          ? Math.max(1, Math.floor(entry.globalBuildLimit))
          : null,
    });
  const buildDraftSnapshot = () =>
    JSON.stringify({
      id: selectedEntry?.id ?? "",
      name: draftName.trim(),
      description: draftDescription.trim(),
      color: draftColor,
      logoUrl: draftLogoUrl,
      malePortraitUrl: draftMalePortraitUrl,
      femalePortraitUrl: draftFemalePortraitUrl,
      basePrice:
        activeCategory === "goods"
          ? Number.isFinite(Number(draftBasePrice))
            ? Number(Number(draftBasePrice).toFixed(3))
            : null
          : null,
      minPrice:
        activeCategory === "goods"
          ? Number.isFinite(Number(draftMinPrice))
            ? Number(Number(draftMinPrice).toFixed(3))
            : null
          : null,
      maxPrice:
        activeCategory === "goods"
          ? Number.isFinite(Number(draftMaxPrice))
            ? Number(Number(draftMaxPrice).toFixed(3))
            : null
          : null,
      infraPerUnit:
        activeCategory === "goods"
          ? Number.isFinite(Number(draftInfraPerUnit))
            ? Number(Math.max(0, Number(draftInfraPerUnit)).toFixed(3))
            : null
          : null,
      infrastructureCostPerUnit:
        activeCategory === "goods"
          ? Number.isFinite(Number(draftInfraPerUnit))
            ? Number(Math.max(0.01, Number(draftInfraPerUnit)).toFixed(3))
            : null
          : null,
      resourceCategoryId: activeCategory === "goods" ? draftResourceCategoryId.trim() || null : null,
      baseWage:
        activeCategory === "professions"
          ? Number.isFinite(Number(draftBaseWage))
            ? Number(Number(draftBaseWage).toFixed(3))
            : null
          : null,
      costConstruction:
        activeCategory === "buildings"
          ? Number.isFinite(Number(draftCostConstruction))
            ? Math.max(1, Math.floor(Number(draftCostConstruction)))
            : null
          : null,
      costDucats:
        activeCategory === "buildings"
          ? Number.isFinite(Number(draftCostDucats))
            ? Number(Math.max(0, Number(draftCostDucats)).toFixed(3))
            : null
          : null,
      startingDucats:
        activeCategory === "buildings"
          ? Number.isFinite(Number(draftStartingDucats))
            ? Number(Math.max(0, Number(draftStartingDucats)).toFixed(3))
            : null
          : null,
      infrastructureUse:
        activeCategory === "buildings"
          ? Number.isFinite(Number(draftInfrastructureUse))
            ? Number(Math.max(0, Number(draftInfrastructureUse)).toFixed(3))
            : null
          : null,
      inputs: activeCategory === "buildings" ? normalizeGoodFlowsDraft(draftInputs) : [],
      outputs: activeCategory === "buildings" ? normalizeGoodFlowsDraft(draftOutputs) : [],
      workforceRequirements: activeCategory === "buildings" ? normalizeWorkforceDraft(draftWorkforceRequirements) : [],
      marketInfrastructureByCategory:
        activeCategory === "buildings" ? normalizeCategoryAmountDraft(draftMarketInfrastructureByCategory) : {},
      allowedCountryIds: activeCategory === "buildings" ? normalizeCountryIdsDraft(draftAllowedCountryIds) : [],
      deniedCountryIds: activeCategory === "buildings" ? normalizeCountryIdsDraft(draftDeniedCountryIds) : [],
      countryBuildLimits: activeCategory === "buildings" ? normalizeCountryBuildLimitsDraft(draftCountryBuildLimits) : [],
      globalBuildLimit:
        activeCategory === "buildings"
          ? Number.isFinite(Number(draftGlobalBuildLimit))
            ? Math.max(1, Math.floor(Number(draftGlobalBuildLimit)))
            : null
          : null,
    });

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((c) => c.name.toLowerCase().includes(q));
  }, [entries, search]);

  const selectedEntry = useMemo(
    () => entries.find((c) => c.id === selectedEntryId) ?? null,
    [entries, selectedEntryId],
  );

  const allowedCountryIdsNormalized = useMemo(
    () => normalizeCountryIdsDraft(draftAllowedCountryIds),
    [draftAllowedCountryIds],
  );
  const deniedCountryIdsNormalized = useMemo(
    () => normalizeCountryIdsDraft(draftDeniedCountryIds),
    [draftDeniedCountryIds],
  );
  const conflictingCountryIds = useMemo(() => {
    const denySet = new Set(deniedCountryIdsNormalized);
    return allowedCountryIdsNormalized.filter((countryId) => denySet.has(countryId));
  }, [allowedCountryIdsNormalized, deniedCountryIdsNormalized]);
  const conflictingCountryNames = useMemo(
    () =>
      conflictingCountryIds.map(
        (countryId) => countryOptions.find((country) => country.id === countryId)?.name ?? countryId,
      ),
    [conflictingCountryIds, countryOptions],
  );
  const filteredAllowCountryOptions = useMemo(() => {
    const q = allowCountrySearch.trim().toLowerCase();
    if (!q) return countryOptions;
    return countryOptions.filter(
      (country) =>
        country.name.toLowerCase().includes(q) || country.id.toLowerCase().includes(q),
    );
  }, [countryOptions, allowCountrySearch]);
  const filteredDenyCountryOptions = useMemo(() => {
    const q = denyCountrySearch.trim().toLowerCase();
    if (!q) return countryOptions;
    return countryOptions.filter(
      (country) =>
        country.name.toLowerCase().includes(q) || country.id.toLowerCase().includes(q),
    );
  }, [countryOptions, denyCountrySearch]);
  const selectedBuildingGlobalUsage = useMemo(() => {
    if (!selectedEntry) return 0;
    return Math.max(0, Math.floor(worldBuildingUsage.globalByBuildingId[selectedEntry.id] ?? 0));
  }, [selectedEntry, worldBuildingUsage.globalByBuildingId]);
  const selectedBuildingUsageByCountry = useMemo(() => {
    if (!selectedEntry) return {};
    return worldBuildingUsage.byCountryByBuildingId[selectedEntry.id] ?? {};
  }, [selectedEntry, worldBuildingUsage.byCountryByBuildingId]);

  const categoryMeta = CATEGORY_META[activeCategory];

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    adminFetchContentEntries(token, activeCategory)
      .then((items) => {
        if (cancelled) return;
        setEntries(items);
        setSelectedEntryId(items[0]?.id ?? "");
      })
      .catch(() => {
        if (!cancelled) toast.error("Не удалось загрузить контент");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeCategory, open, token]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      adminFetchContentEntries(token, "goods"),
      adminFetchContentEntries(token, "resourceCategories"),
      adminFetchContentEntries(token, "professions"),
      fetchCountries(),
    ])
      .then(([goods, resourceCategories, professions, countries]) => {
        if (cancelled) return;
        setGoodsOptions(goods);
        setResourceCategoryOptions(resourceCategories);
        setProfessionOptions(professions);
        setCountryOptions(countries.map((country) => ({ id: country.id, name: country.name })));
      })
      .catch(() => {
        if (cancelled) return;
        setGoodsOptions([]);
        setResourceCategoryOptions([]);
        setProfessionOptions([]);
        setCountryOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, token]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchWorldSnapshot(token)
      .then((snapshot) => {
        if (cancelled) return;
        const globalByBuildingId: Record<string, number> = {};
        const byCountryByBuildingId: Record<string, Record<string, number>> = {};

        const addUsage = (buildingId: string, countryId: string | null, amount: number) => {
          if (!buildingId || amount <= 0) return;
          globalByBuildingId[buildingId] = (globalByBuildingId[buildingId] ?? 0) + amount;
          if (!countryId) return;
          if (!byCountryByBuildingId[buildingId]) {
            byCountryByBuildingId[buildingId] = {};
          }
          byCountryByBuildingId[buildingId][countryId] =
            (byCountryByBuildingId[buildingId][countryId] ?? 0) + amount;
        };

        for (const [provinceId, instances] of Object.entries(snapshot.worldBase.provinceBuildingsByProvince ?? {})) {
          const ownerCountryId = snapshot.worldBase.provinceOwner?.[provinceId] ?? null;
          for (const instance of instances ?? []) {
            addUsage(instance.buildingId, ownerCountryId, 1);
          }
        }

        for (const [provinceId, queue] of Object.entries(snapshot.worldBase.provinceConstructionQueueByProvince ?? {})) {
          const ownerCountryId = snapshot.worldBase.provinceOwner?.[provinceId] ?? null;
          for (const project of queue ?? []) {
            addUsage(project.buildingId, ownerCountryId, 1);
          }
        }

        setWorldBuildingUsage({ globalByBuildingId, byCountryByBuildingId });
      })
      .catch(() => {
        if (cancelled) return;
        setWorldBuildingUsage({ globalByBuildingId: {}, byCountryByBuildingId: {} });
      });

    return () => {
      cancelled = true;
    };
  }, [open, token]);

  useEffect(() => {
    if (!open) return;
    if (!selectedEntryId && entries[0]) {
      setSelectedEntryId(entries[0].id);
    }
  }, [entries, open, selectedEntryId]);

  useEffect(() => {
    if (!selectedEntry) {
      setDraftName("");
      setDraftDescription("");
      setDraftColor("#4ade80");
      setDraftLogoUrl(null);
      setDraftMalePortraitUrl(null);
      setDraftFemalePortraitUrl(null);
      setDraftBasePrice("1");
      setDraftMinPrice("0.1");
      setDraftMaxPrice("10");
      setDraftInfraPerUnit("1");
      setDraftResourceCategoryId("");
      setDraftBaseWage("1");
      setDraftCostConstruction("100");
      setDraftCostDucats("10");
      setDraftStartingDucats("0");
      setDraftInfrastructureUse("0");
      setDraftInputs([]);
      setDraftOutputs([]);
      setDraftWorkforceRequirements([]);
      setDraftMarketInfrastructureByCategory([]);
      setDraftAllowedCountryIds([]);
      setDraftDeniedCountryIds([]);
      setDraftCountryBuildLimits([]);
      setDraftGlobalBuildLimit("");
      setSavedSnapshot("");
      return;
    }
    setDraftName(selectedEntry.name);
    setDraftDescription(selectedEntry.description ?? "");
    setDraftColor(selectedEntry.color);
    setDraftLogoUrl(selectedEntry.logoUrl);
    setDraftMalePortraitUrl(selectedEntry.malePortraitUrl ?? null);
    setDraftFemalePortraitUrl(selectedEntry.femalePortraitUrl ?? null);
    setDraftBasePrice(
      typeof selectedEntry.basePrice === "number" && Number.isFinite(selectedEntry.basePrice)
        ? String(selectedEntry.basePrice)
        : "1",
    );
    setDraftMinPrice(
      typeof selectedEntry.minPrice === "number" && Number.isFinite(selectedEntry.minPrice)
        ? String(selectedEntry.minPrice)
        : "0.1",
    );
    setDraftMaxPrice(
      typeof selectedEntry.maxPrice === "number" && Number.isFinite(selectedEntry.maxPrice)
        ? String(selectedEntry.maxPrice)
        : "10",
    );
    setDraftInfraPerUnit(
      typeof selectedEntry.infrastructureCostPerUnit === "number" && Number.isFinite(selectedEntry.infrastructureCostPerUnit)
        ? String(selectedEntry.infrastructureCostPerUnit)
        : typeof selectedEntry.infraPerUnit === "number" && Number.isFinite(selectedEntry.infraPerUnit)
          ? String(selectedEntry.infraPerUnit)
        : "1",
    );
    setDraftResourceCategoryId(
      typeof selectedEntry.resourceCategoryId === "string" ? selectedEntry.resourceCategoryId : "",
    );
    setDraftBaseWage(
      typeof selectedEntry.baseWage === "number" && Number.isFinite(selectedEntry.baseWage)
        ? String(selectedEntry.baseWage)
        : "1",
    );
    setDraftCostConstruction(
      typeof selectedEntry.costConstruction === "number" && Number.isFinite(selectedEntry.costConstruction)
        ? String(Math.max(1, Math.floor(selectedEntry.costConstruction)))
        : "100",
    );
    setDraftCostDucats(
      typeof selectedEntry.costDucats === "number" && Number.isFinite(selectedEntry.costDucats)
        ? String(Math.max(0, selectedEntry.costDucats))
        : "10",
    );
    setDraftStartingDucats(
      typeof selectedEntry.startingDucats === "number" && Number.isFinite(selectedEntry.startingDucats)
        ? String(Math.max(0, selectedEntry.startingDucats))
        : "0",
    );
    setDraftInfrastructureUse(
      typeof selectedEntry.infrastructureUse === "number" && Number.isFinite(selectedEntry.infrastructureUse)
        ? String(Math.max(0, selectedEntry.infrastructureUse))
        : "0",
    );
    setDraftInputs((selectedEntry.inputs ?? []).map((row) => ({ goodId: row.goodId, amount: String(row.amount) })));
    setDraftOutputs((selectedEntry.outputs ?? []).map((row) => ({ goodId: row.goodId, amount: String(row.amount) })));
    setDraftWorkforceRequirements(
      (selectedEntry.workforceRequirements ?? []).map((row) => ({
        professionId: row.professionId,
        workers: String(row.workers),
      })),
    );
    setDraftMarketInfrastructureByCategory(
      Object.entries(selectedEntry.marketInfrastructureByCategory ?? {}).map(([categoryId, amount]) => ({
        categoryId,
        amount: String(amount),
      })),
    );
    setDraftAllowedCountryIds(normalizeCountryIdsDraft(selectedEntry.allowedCountryIds ?? []));
    setDraftDeniedCountryIds(normalizeCountryIdsDraft(selectedEntry.deniedCountryIds ?? []));
    setDraftCountryBuildLimits(
      (selectedEntry.countryBuildLimits ?? []).map((row) => ({
        countryId: row.countryId,
        limit: String(Math.max(1, Math.floor(row.limit))),
      })),
    );
    setDraftGlobalBuildLimit(
      typeof selectedEntry.globalBuildLimit === "number" && Number.isFinite(selectedEntry.globalBuildLimit)
        ? String(Math.max(1, Math.floor(selectedEntry.globalBuildLimit)))
        : "",
    );
    setCriteriaCountriesOpen(false);
    setCriteriaLimitsOpen(false);
    setGoodsEconomyOpen(false);
    setBuildingCostOpen(false);
    setBuildingInputsOpen(false);
    setBuildingOutputsOpen(false);
    setBuildingWorkforceOpen(false);
    setBuildingMarketInfraOpen(false);
    setAllowCountrySearch("");
    setDenyCountrySearch("");
    setSavedSnapshot(buildSnapshot(selectedEntry));
  }, [selectedEntry]);

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedEntry) return false;
    return buildDraftSnapshot() !== savedSnapshot;
  }, [
    activeCategory,
    draftBasePrice,
    draftMinPrice,
    draftMaxPrice,
    draftInfraPerUnit,
    draftResourceCategoryId,
    draftBaseWage,
    draftCostConstruction,
    draftCostDucats,
    draftStartingDucats,
    draftInfrastructureUse,
    draftMarketInfrastructureByCategory,
    draftColor,
    draftDescription,
    draftFemalePortraitUrl,
    draftInputs,
    draftLogoUrl,
    draftMalePortraitUrl,
    draftName,
    draftOutputs,
    draftWorkforceRequirements,
    draftAllowedCountryIds,
    draftDeniedCountryIds,
    draftCountryBuildLimits,
    draftGlobalBuildLimit,
    savedSnapshot,
    selectedEntry,
  ]);

  const requestClose = () => {
    if (saving) return;
    if (hasUnsavedChanges) {
      setCloseConfirmOpen(true);
      return;
    }
    onClose();
  };

  const createEntry = async () => {
    setSaving(true);
    try {
      const nextNameBase = categoryMeta.createBaseName;
      let name = nextNameBase;
      let i = 2;
      const used = new Set(entries.map((c) => c.name.trim().toLowerCase()));
      while (used.has(name.toLowerCase())) {
        name = `${nextNameBase} ${i++}`;
      }
      const result = await adminCreateContentEntry(token, activeCategory, {
        name,
        description: "",
        color: "#a78bfa",
        basePrice: activeCategory === "goods" ? 1 : undefined,
        minPrice: activeCategory === "goods" ? 0.1 : undefined,
        maxPrice: activeCategory === "goods" ? 10 : undefined,
        infraPerUnit: activeCategory === "goods" ? 1 : undefined,
        infrastructureCostPerUnit: activeCategory === "goods" ? 1 : undefined,
        resourceCategoryId: activeCategory === "goods" ? null : undefined,
        baseWage: activeCategory === "professions" ? 1 : undefined,
        costConstruction: activeCategory === "buildings" ? 100 : undefined,
        costDucats: activeCategory === "buildings" ? 10 : undefined,
        startingDucats: activeCategory === "buildings" ? 0 : undefined,
        infrastructureUse: activeCategory === "buildings" ? 0 : undefined,
        inputs: activeCategory === "buildings" ? [] : undefined,
        outputs: activeCategory === "buildings" ? [] : undefined,
        workforceRequirements: activeCategory === "buildings" ? [] : undefined,
        marketInfrastructureByCategory: activeCategory === "buildings" ? {} : undefined,
        allowedCountryIds: activeCategory === "buildings" ? [] : undefined,
        deniedCountryIds: activeCategory === "buildings" ? [] : undefined,
        countryBuildLimits: activeCategory === "buildings" ? [] : undefined,
        globalBuildLimit: activeCategory === "buildings" ? null : undefined,
      });
      setEntries(result.items);
      setSelectedEntryId(result.item.id);
      if (activeCategory === "goods") {
        setGoodsOptions(result.items);
      }
      if (activeCategory === "resourceCategories") {
        setResourceCategoryOptions(result.items);
      }
      if (activeCategory === "professions") {
        setProfessionOptions(result.items);
      }
      toast.success(`${categoryMeta.singular[0].toUpperCase()}${categoryMeta.singular.slice(1)} создана`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "ADMIN_CREATE_CONTENT_ENTRY_FAILED";
      if (msg === "CONTENT_NAME_EXISTS") toast.error("Название уже используется");
      else toast.error("Не удалось создать запись");
    } finally {
      setSaving(false);
    }
  };

  const saveEntry = async () => {
    if (!selectedEntry) return;
    const name = draftName.trim();
    if (!name) {
      toast.error("Введите название");
      return;
    }
    if (entries.some((c) => c.id !== selectedEntry.id && c.name.trim().toLowerCase() === name.toLowerCase())) {
      toast.error("Название должно быть уникальным");
      return;
    }
    const color = /^#[0-9A-Fa-f]{6}$/.test(draftColor) ? draftColor : "#4ade80";
    const payload = {
      name,
      description: draftDescription.trim(),
      color,
      basePrice: activeCategory === "goods" ? Math.max(0, Number(draftBasePrice || "0")) : undefined,
      minPrice: activeCategory === "goods" ? Math.max(0, Number(draftMinPrice || "0")) : undefined,
      maxPrice: activeCategory === "goods" ? Math.max(0, Number(draftMaxPrice || "0")) : undefined,
      infraPerUnit: activeCategory === "goods" ? Math.max(0, Number(draftInfraPerUnit || "0")) : undefined,
      infrastructureCostPerUnit: activeCategory === "goods" ? Math.max(0.01, Number(draftInfraPerUnit || "0.01")) : undefined,
      resourceCategoryId: activeCategory === "goods" ? (draftResourceCategoryId.trim() || null) : undefined,
      baseWage: activeCategory === "professions" ? Math.max(0, Number(draftBaseWage || "0")) : undefined,
      costConstruction: activeCategory === "buildings" ? Math.max(1, Math.floor(Number(draftCostConstruction || "100"))) : undefined,
      costDucats: activeCategory === "buildings" ? Math.max(0, Number(draftCostDucats || "10")) : undefined,
      startingDucats: activeCategory === "buildings" ? Math.max(0, Number(draftStartingDucats || "0")) : undefined,
      infrastructureUse: activeCategory === "buildings" ? Math.max(0, Number(draftInfrastructureUse || "0")) : undefined,
      inputs: activeCategory === "buildings" ? normalizeGoodFlowsDraft(draftInputs) : undefined,
      outputs: activeCategory === "buildings" ? normalizeGoodFlowsDraft(draftOutputs) : undefined,
      workforceRequirements: activeCategory === "buildings" ? normalizeWorkforceDraft(draftWorkforceRequirements) : undefined,
      marketInfrastructureByCategory:
        activeCategory === "buildings" ? normalizeCategoryAmountDraft(draftMarketInfrastructureByCategory) : undefined,
      allowedCountryIds: activeCategory === "buildings" ? normalizeCountryIdsDraft(draftAllowedCountryIds) : undefined,
      deniedCountryIds: activeCategory === "buildings" ? normalizeCountryIdsDraft(draftDeniedCountryIds) : undefined,
      countryBuildLimits:
        activeCategory === "buildings" ? normalizeCountryBuildLimitsDraft(draftCountryBuildLimits) : undefined,
      globalBuildLimit:
        activeCategory === "buildings"
          ? Number.isFinite(Number(draftGlobalBuildLimit))
            ? Math.max(1, Math.floor(Number(draftGlobalBuildLimit)))
            : null
          : undefined,
    };
    if (
      activeCategory === "goods" &&
      (!Number.isFinite(payload.basePrice ?? Number.NaN) ||
        !Number.isFinite(payload.minPrice ?? Number.NaN) ||
        !Number.isFinite(payload.maxPrice ?? Number.NaN) ||
        !Number.isFinite(payload.infraPerUnit ?? Number.NaN) ||
        !Number.isFinite(payload.infrastructureCostPerUnit ?? Number.NaN))
    ) {
      toast.error("Параметры экономики товара должны быть числами");
      return;
    }
    if (activeCategory === "goods" && (payload.maxPrice ?? 0) < (payload.minPrice ?? 0)) {
      toast.error("Максимальная цена не может быть меньше минимальной");
      return;
    }
    if (activeCategory === "professions" && !Number.isFinite(payload.baseWage ?? Number.NaN)) {
      toast.error("Базовая зарплата должна быть числом");
      return;
    }
    if (
      activeCategory === "buildings" &&
      (!Number.isFinite(payload.costConstruction ?? Number.NaN) ||
        !Number.isFinite(payload.costDucats ?? Number.NaN) ||
        !Number.isFinite(payload.startingDucats ?? Number.NaN) ||
        !Number.isFinite(payload.infrastructureUse ?? Number.NaN))
    ) {
      toast.error("Параметры строительства должны быть числами");
      return;
    }
    setSaving(true);
    try {
      const result = await adminUpdateContentEntry(token, activeCategory, selectedEntry.id, payload);
      setEntries(result.items);
      setSavedSnapshot(buildSnapshot(result.item));
      if (activeCategory === "goods") {
        setGoodsOptions(result.items);
      }
      if (activeCategory === "resourceCategories") {
        setResourceCategoryOptions(result.items);
      }
      if (activeCategory === "professions") {
        setProfessionOptions(result.items);
      }
      toast.success("Изменения сохранены");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "ADMIN_UPDATE_CONTENT_ENTRY_FAILED";
      if (msg === "CONTENT_NAME_EXISTS") toast.error("Название уже используется");
      else toast.error("Не удалось сохранить запись");
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async () => {
    if (!selectedEntry) return;
    setSaving(true);
    try {
      const result = await adminDeleteContentEntry(token, activeCategory, selectedEntry.id);
      setEntries(result.items);
      setSelectedEntryId(result.items[0]?.id ?? "");
      if (activeCategory === "goods") {
        setGoodsOptions(result.items);
      }
      if (activeCategory === "resourceCategories") {
        setResourceCategoryOptions(result.items);
      }
      if (activeCategory === "professions") {
        setProfessionOptions(result.items);
      }
      setDeleteConfirmOpen(false);
      toast.success("Запись удалена");
    } catch {
      toast.error("Не удалось удалить запись");
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File | null) => {
    if (!file || !selectedEntry) return;
    try {
      await validateLogo64(file);
      setSaving(true);
      const result = await adminUploadContentEntryLogo(token, activeCategory, selectedEntry.id, file);
      setEntries(result.items);
      setDraftLogoUrl(result.item.logoUrl);
      setSavedSnapshot(buildSnapshot(result.item));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "LOGO_INVALID";
      if (msg === "LOGO_TOO_LARGE") toast.error("Логотип должен быть максимум 64x64");
      else if (msg === "IMAGE_DIMENSIONS_TOO_LARGE") toast.error("Логотип должен быть максимум 64x64");
      else toast.error("Не удалось загрузить логотип");
    } finally {
      setSaving(false);
    }
  };

  const uploadRacePortraitSlot = async (slot: "male" | "female", file: File | null) => {
    if (!file || !selectedEntry || activeCategory !== "races") return;
    try {
      await validateRacePortrait(file);
      setSaving(true);
      const result = await adminUploadRacePortrait(token, selectedEntry.id, slot, file);
      setEntries(result.items);
      setSavedSnapshot(buildSnapshot(result.item));
      setDraftMalePortraitUrl(result.item.malePortraitUrl ?? null);
      setDraftFemalePortraitUrl(result.item.femalePortraitUrl ?? null);
      toast.success(`Портрет (${slot === "male" ? "мужской" : "женский"}) загружен`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "RACE_PORTRAIT_INVALID";
      if (msg === "RACE_PORTRAIT_TOO_LARGE" || msg === "IMAGE_DIMENSIONS_TOO_LARGE") {
        toast.error("Портрет должен быть максимум 89x100");
      } else {
        toast.error("Не удалось загрузить портрет");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={requestClose} className="relative z-[205]">
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
                <Dialog.Title className="font-display text-2xl tracking-wide text-arc-accent">Панель контента</Dialog.Title>
                <Tooltip content="Здесь настраиваются данные контента. Изменения применяются после нажатия «Сохранить».">
                  <span className="mt-1 block text-xs text-white/60">Создание и редактирование игрового контента</span>
                </Tooltip>
              </div>
              <button
                type="button"
                onClick={requestClose}
                className="panel-border inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-slate-300 transition hover:text-arc-accent"
                aria-label="Закрыть"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
              <aside className="min-h-0 rounded-xl border border-white/10 bg-black/20 p-3">
                <Tooltip content="Выберите тип контента для создания и редактирования записей.">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">Категории</span>
                </Tooltip>
                <div className="mt-2 space-y-2">
                  {CONTENT_UI_SCHEMA.categories.map((category) => {
                    const Icon = category.icon;
                    const isActive = category.id === activeCategory;
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => {
                          if (!category.enabled) return;
                          setActiveCategory(category.id as PanelCategory);
                          setContentSection("general");
                          setSearch("");
                        }}
                        disabled={!category.enabled}
                        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
                          !category.enabled
                            ? "border-white/10 bg-black/20 text-white/35"
                            : isActive
                              ? "border-arc-accent/30 bg-arc-accent/10 text-arc-accent"
                              : "border-white/10 bg-black/20 text-white/70"
                        }`}
                      >
                        <Icon size={15} />
                        <span>{category.label}</span>
                      </button>
                    );
                  })}
                </div>

              </aside>

              <div className="grid min-h-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                <section className="min-h-0 rounded-xl border border-white/10 bg-black/20 p-3">
                  <Tooltip content="Выберите запись из списка, чтобы редактировать её данные и оформление.">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Список: {CONTENT_UI_SCHEMA.categories.find((c) => c.id === activeCategory)?.label ?? "Контент"}
                    </span>
                  </Tooltip>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={`Поиск: ${categoryMeta.singular}`}
                    className="mb-2 w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/30"
                  />
                  <button
                    type="button"
                    onClick={() => void createEntry()}
                    disabled={saving}
                    className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-arc-accent px-3 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
                  >
                    <Plus size={15} />
                    {categoryMeta.createLabel}
                  </button>

                  <div className="arc-scrollbar max-h-[calc(100%-6.75rem)] space-y-2 overflow-auto pr-1">
                    {loading ? (
                      <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/60">Загрузка...</div>
                    ) : filteredEntries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setSelectedEntryId(entry.id)}
                        className={`flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left transition ${
                          selectedEntryId === entry.id
                            ? "border-arc-accent/30 bg-arc-accent/10"
                            : "border-white/10 bg-black/20 hover:border-white/15"
                        }`}
                      >
                        <div
                          className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-[#131a22]"
                          style={{ boxShadow: `0 0 0 1px ${entry.color}33 inset` }}
                        >
                          {entry.logoUrl ? (
                            <img src={entry.logoUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-xs font-semibold" style={{ color: entry.color }}>
                              {entry.name.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-white">{entry.name}</div>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="inline-block h-2.5 w-2.5 rounded-full border border-white/20" style={{ backgroundColor: entry.color }} />
                            <span className="text-[10px] text-white/50">{entry.color}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>

                <div className="grid min-h-0 gap-4 lg:grid-rows-[auto_auto_minmax(0,1fr)]">
                <div className="flex items-center gap-5 border-b border-white/10 px-1">
                  {CONTENT_UI_SCHEMA.categories
                    .find((c) => c.id === activeCategory)
                    ?.sections.map((section) => {
                      const SectionIcon = section.icon;
                      return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => setContentSection(section.id)}
                        className={`inline-flex items-center gap-1.5 pb-2 text-sm transition ${
                          contentSection === section.id
                            ? "border-b-2 border-arc-accent text-arc-accent"
                            : "border-b-2 border-transparent text-white/60 hover:text-white"
                        }`}
                      >
                        <SectionIcon size={14} />
                        {section.label}
                      </button>
                      );
                    })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{selectedEntry ? selectedEntry.name : categoryMeta.createBaseName}</div>
                    <div className="mt-1 text-xs text-white/55">
                      {categoryMeta.sectionTitle}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasUnsavedChanges && (
                      <span className="rounded-md border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
                        Есть несохранённые изменения
                      </span>
                    )}
                    <Tooltip content="Сохраняет все изменения в выбранной культуре">
                      <button
                        type="button"
                        onClick={() => void saveEntry()}
                        disabled={!selectedEntry || saving}
                        className="inline-flex h-10 items-center justify-center rounded-lg bg-arc-accent px-4 text-sm font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Сохранить
                      </button>
                    </Tooltip>
                    <Tooltip content="Полностью удаляет выбранную культуру">
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmOpen(true)}
                        disabled={!selectedEntry || saving}
                        className="panel-border inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-rose-500/10 px-3 text-sm text-rose-300 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                        Удалить
                      </button>
                    </Tooltip>
                  </div>
                </div>

                <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="arc-scrollbar min-h-0 space-y-4 overflow-auto pr-1">
                    {contentSection === "general" && (
                      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <Tooltip content="Название, цвет и описание используются в интерфейсе и игровых списках.">
                          <span className="mb-3 block text-xs font-semibold uppercase tracking-wide text-slate-400">Основные данные</span>
                        </Tooltip>
                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
                          <label className="block">
                            <Tooltip content="Уникальное имя записи. Используется в карточках, фильтрах и справочниках.">
                              <span className="mb-1 block text-xs text-white/60">Название</span>
                            </Tooltip>
                            <input
                              value={draftName}
                              onChange={(e) => setDraftName(e.target.value)}
                              placeholder={categoryMeta.namePlaceholder}
                              className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/30"
                            />
                          </label>
                          <div>
                            <Tooltip content="Основной акцентный цвет записи для чипов, маркеров и предпросмотра.">
                              <span className="mb-1 block text-xs text-white/60">Цвет</span>
                            </Tooltip>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={/^#[0-9A-Fa-f]{6}$/.test(draftColor) ? draftColor : "#4ade80"}
                                onChange={(e) => setDraftColor(e.target.value)}
                                className="h-10 w-12 rounded border border-white/10 bg-black/35 p-1"
                              />
                              <input
                                value={draftColor}
                                onChange={(e) => setDraftColor(e.target.value)}
                                placeholder="#4ade80"
                                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/30"
                              />
                            </div>
                          </div>
                        </div>
                        <label className="mt-4 block">
                          <Tooltip content="Короткий текст для админ-панели и связанных UI-блоков.">
                            <span className="mb-1 block text-xs text-white/60">Описание</span>
                          </Tooltip>
                          <textarea
                            value={draftDescription}
                            onChange={(e) => setDraftDescription(e.target.value)}
                            placeholder={categoryMeta.descriptionPlaceholder}
                            maxLength={5000}
                            rows={5}
                            className="w-full resize-y rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/30"
                          />
                          <div className="mt-1 text-right text-[11px] text-white/45">{draftDescription.length}/5000</div>
                        </label>

                      </section>
                    )}

                    {contentSection === "economy" && activeCategory === "buildings" && (
                      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <div className="space-y-4">
                          <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                            <button
                              type="button"
                              onClick={() => setBuildingCostOpen((v) => !v)}
                              className="mb-2 flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-left"
                            >
                              <Tooltip content="Базовые затраты на добавление одного уровня здания в очередь строительства.">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Стоимость строительства</div>
                              </Tooltip>
                              {buildingCostOpen ? (
                                <ChevronDown size={14} className="text-white/60" />
                              ) : (
                                <ChevronRight size={14} className="text-white/60" />
                              )}
                            </button>
                            <AnimatePresence initial={false}>
                            {buildingCostOpen ? (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                              className="overflow-hidden"
                            >
                            <div className="grid grid-cols-1 gap-2 pt-1 md:grid-cols-4">
                              <label className="block">
                                <Tooltip content="Сколько очков строительства требуется на завершение проекта.">
                                  <span className="mb-1 block text-xs text-white/60">Очки строительства</span>
                                </Tooltip>
                                <input
                                  value={draftCostConstruction}
                                  onChange={(e) => setDraftCostConstruction(e.target.value)}
                                  inputMode="numeric"
                                  placeholder="100"
                                  className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/30"
                                />
                              </label>
                              <label className="block">
                                <Tooltip content="Сколько дукатов суммарно спишется при полном завершении проекта.">
                                  <span className="mb-1 block text-xs text-white/60">Дукаты</span>
                                </Tooltip>
                                <input
                                  value={draftCostDucats}
                                  onChange={(e) => setDraftCostDucats(e.target.value)}
                                  inputMode="decimal"
                                  placeholder="10"
                                  className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/30"
                                />
                              </label>
                              <label className="block">
                                <Tooltip content="Стартовый капитал здания, начисляемый сразу после завершения строительства.">
                                  <span className="mb-1 block text-xs text-white/60">Стартовые дукаты</span>
                                </Tooltip>
                                <input
                                  value={draftStartingDucats}
                                  onChange={(e) => setDraftStartingDucats(e.target.value)}
                                  inputMode="decimal"
                                  placeholder="0"
                                  className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/30"
                                />
                              </label>
                              <label className="block">
                                <Tooltip content="Нагрузка здания на инфраструктуру провинции. Влияет на доступный объем торговли и продуктивность.">
                                  <span className="mb-1 block text-xs text-white/60">Инфраструктура</span>
                                </Tooltip>
                                <input
                                  value={draftInfrastructureUse}
                                  onChange={(e) => setDraftInfrastructureUse(e.target.value)}
                                  inputMode="decimal"
                                  placeholder="0"
                                  className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/30"
                                />
                              </label>
                            </div>
                            </motion.div>
                            ) : null}
                            </AnimatePresence>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => setBuildingInputsOpen((v) => !v)}
                                className="flex min-w-0 flex-1 items-center justify-between rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-left"
                              >
                                <Tooltip content="Товары, которые здание потребляет каждый ход при производстве.">
                                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Входные товары</div>
                                </Tooltip>
                                {buildingInputsOpen ? (
                                  <ChevronDown size={14} className="text-white/60" />
                                ) : (
                                  <ChevronRight size={14} className="text-white/60" />
                                )}
                              </button>
                              {buildingInputsOpen && (
                                <Tooltip content="Добавить новую строку входного товара.">
                                  <button
                                    type="button"
                                    onClick={() => setDraftInputs((prev) => [...prev, { goodId: goodsOptions[0]?.id ?? "", amount: "1" }])}
                                    className="rounded-md border border-emerald-400/35 bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-500/30"
                                  >
                                    Добавить
                                  </button>
                                </Tooltip>
                              )}
                            </div>
                            <AnimatePresence initial={false}>
                            {buildingInputsOpen ? (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                              className="overflow-hidden"
                            >
                            <div className="space-y-2 pt-1">
                              {draftInputs.map((row, index) => (
                                <div key={`input-${index}`} className="grid grid-cols-[minmax(0,1fr)_110px_32px] gap-2">
                                  <CustomSelect
                                    value={row.goodId}
                                    onChange={(value) =>
                                      setDraftInputs((prev) => prev.map((r, i) => (i === index ? { ...r, goodId: value } : r)))
                                    }
                                    options={[
                                      { value: "", label: "Выберите товар" },
                                      ...goodsOptions.map((option) => ({ value: option.id, label: option.name })),
                                    ]}
                                    buttonClassName="h-[42px]"
                                  />
                                  <input
                                    value={row.amount}
                                    onChange={(e) =>
                                      setDraftInputs((prev) => prev.map((r, i) => (i === index ? { ...r, amount: e.target.value } : r)))
                                    }
                                    inputMode="decimal"
                                    placeholder="0"
                                    className="rounded-lg border border-white/10 bg-black/35 px-2 py-2 text-sm text-white outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setDraftInputs((prev) => prev.filter((_, i) => i !== index))}
                                    className="rounded-lg border border-rose-400/30 bg-rose-500/10 text-xs text-rose-200"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                              {draftInputs.length === 0 && <div className="text-xs text-white/45">Нет входных товаров</div>}
                            </div>
                            </motion.div>
                            ) : null}
                            </AnimatePresence>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => setBuildingOutputsOpen((v) => !v)}
                                className="flex min-w-0 flex-1 items-center justify-between rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-left"
                              >
                                <Tooltip content="Товары, которые здание производит каждый ход.">
                                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Выходные товары</div>
                                </Tooltip>
                                {buildingOutputsOpen ? (
                                  <ChevronDown size={14} className="text-white/60" />
                                ) : (
                                  <ChevronRight size={14} className="text-white/60" />
                                )}
                              </button>
                              {buildingOutputsOpen && (
                                <Tooltip content="Добавить новую строку выходного товара.">
                                  <button
                                    type="button"
                                    onClick={() => setDraftOutputs((prev) => [...prev, { goodId: goodsOptions[0]?.id ?? "", amount: "1" }])}
                                    className="rounded-md border border-emerald-400/35 bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-500/30"
                                  >
                                    Добавить
                                  </button>
                                </Tooltip>
                              )}
                            </div>
                            <AnimatePresence initial={false}>
                            {buildingOutputsOpen ? (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                              className="overflow-hidden"
                            >
                            <div className="space-y-2 pt-1">
                              {draftOutputs.map((row, index) => (
                                <div key={`output-${index}`} className="grid grid-cols-[minmax(0,1fr)_110px_32px] gap-2">
                                  <CustomSelect
                                    value={row.goodId}
                                    onChange={(value) =>
                                      setDraftOutputs((prev) => prev.map((r, i) => (i === index ? { ...r, goodId: value } : r)))
                                    }
                                    options={[
                                      { value: "", label: "Выберите товар" },
                                      ...goodsOptions.map((option) => ({ value: option.id, label: option.name })),
                                    ]}
                                    buttonClassName="h-[42px]"
                                  />
                                  <input
                                    value={row.amount}
                                    onChange={(e) =>
                                      setDraftOutputs((prev) => prev.map((r, i) => (i === index ? { ...r, amount: e.target.value } : r)))
                                    }
                                    inputMode="decimal"
                                    placeholder="0"
                                    className="rounded-lg border border-white/10 bg-black/35 px-2 py-2 text-sm text-white outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setDraftOutputs((prev) => prev.filter((_, i) => i !== index))}
                                    className="rounded-lg border border-rose-400/30 bg-rose-500/10 text-xs text-rose-200"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                              {draftOutputs.length === 0 && <div className="text-xs text-white/45">Нет выходных товаров</div>}
                            </div>
                            </motion.div>
                            ) : null}
                            </AnimatePresence>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => setBuildingWorkforceOpen((v) => !v)}
                                className="flex min-w-0 flex-1 items-center justify-between rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-left"
                              >
                                <Tooltip content="Требуемые профессии и количество рабочих мест по каждой профессии.">
                                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Профессии и рабочие места</div>
                                </Tooltip>
                                {buildingWorkforceOpen ? (
                                  <ChevronDown size={14} className="text-white/60" />
                                ) : (
                                  <ChevronRight size={14} className="text-white/60" />
                                )}
                              </button>
                              {buildingWorkforceOpen && (
                                <Tooltip content="Добавить новую строку требования по профессии.">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDraftWorkforceRequirements((prev) => [
                                        ...prev,
                                        { professionId: professionOptions[0]?.id ?? "", workers: "100" },
                                      ])
                                    }
                                    className="rounded-md border border-emerald-400/35 bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-500/30"
                                  >
                                    Добавить
                                  </button>
                                </Tooltip>
                              )}
                            </div>
                            <AnimatePresence initial={false}>
                            {buildingWorkforceOpen ? (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                              className="overflow-hidden"
                            >
                            <div className="space-y-2 pt-1">
                              {draftWorkforceRequirements.map((row, index) => (
                                <div key={`workforce-${index}`} className="grid grid-cols-[minmax(0,1fr)_110px_32px] gap-2">
                                  <CustomSelect
                                    value={row.professionId}
                                    onChange={(value) =>
                                      setDraftWorkforceRequirements((prev) =>
                                        prev.map((r, i) => (i === index ? { ...r, professionId: value } : r)),
                                      )
                                    }
                                    options={[
                                      { value: "", label: "Выберите профессию" },
                                      ...professionOptions.map((option) => ({ value: option.id, label: option.name })),
                                    ]}
                                    buttonClassName="h-[42px]"
                                  />
                                  <input
                                    value={row.workers}
                                    onChange={(e) =>
                                      setDraftWorkforceRequirements((prev) =>
                                        prev.map((r, i) => (i === index ? { ...r, workers: e.target.value } : r)),
                                      )
                                    }
                                    inputMode="numeric"
                                    placeholder="0"
                                    className="rounded-lg border border-white/10 bg-black/35 px-2 py-2 text-sm text-white outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setDraftWorkforceRequirements((prev) => prev.filter((_, i) => i !== index))}
                                    className="rounded-lg border border-rose-400/30 bg-rose-500/10 text-xs text-rose-200"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                              {draftWorkforceRequirements.length === 0 && <div className="text-xs text-white/45">Нет требований по профессиям</div>}
                            </div>
                            </motion.div>
                            ) : null}
                            </AnimatePresence>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => setBuildingMarketInfraOpen((v) => !v)}
                                className="flex min-w-0 flex-1 items-center justify-between rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-left"
                              >
                                <Tooltip content="Вклад здания в общую инфраструктуру рынка по категориям. Используется для внешней торговли между рынками.">
                                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Инфраструктура рынка</div>
                                </Tooltip>
                                {buildingMarketInfraOpen ? (
                                  <ChevronDown size={14} className="text-white/60" />
                                ) : (
                                  <ChevronRight size={14} className="text-white/60" />
                                )}
                              </button>
                              {buildingMarketInfraOpen && (
                                <Tooltip content="Добавить категорию инфраструктуры, которую генерирует это здание.">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDraftMarketInfrastructureByCategory((prev) => [
                                        ...prev,
                                        { categoryId: "", amount: "1" },
                                      ])
                                    }
                                    className="rounded-md border border-emerald-400/35 bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-500/30"
                                  >
                                    Добавить
                                  </button>
                                </Tooltip>
                              )}
                            </div>
                            <AnimatePresence initial={false}>
                            {buildingMarketInfraOpen ? (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                              className="overflow-hidden"
                            >
                            <div className="space-y-2 pt-1">
                              {draftMarketInfrastructureByCategory.map((row, index) => (
                                <div key={`market-infra-${index}`} className="grid grid-cols-[minmax(0,1fr)_110px_32px] gap-2">
                                  <CustomSelect
                                    value={row.categoryId}
                                    onChange={(value) =>
                                      setDraftMarketInfrastructureByCategory((prev) =>
                                        prev.map((r, i) => (i === index ? { ...r, categoryId: value } : r)),
                                      )
                                    }
                                    options={[
                                      { value: "", label: "Выберите категорию" },
                                      ...resourceCategoryOptions.map((option) => ({ value: option.id, label: option.name })),
                                    ]}
                                    buttonClassName="h-[42px]"
                                  />
                                  <input
                                    value={row.amount}
                                    onChange={(e) =>
                                      setDraftMarketInfrastructureByCategory((prev) =>
                                        prev.map((r, i) => (i === index ? { ...r, amount: e.target.value } : r)),
                                      )
                                    }
                                    inputMode="decimal"
                                    placeholder="0"
                                    className="rounded-lg border border-white/10 bg-black/35 px-2 py-2 text-sm text-white outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDraftMarketInfrastructureByCategory((prev) => prev.filter((_, i) => i !== index))
                                    }
                                    className="rounded-lg border border-rose-400/30 bg-rose-500/10 text-xs text-rose-200"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                              {draftMarketInfrastructureByCategory.length === 0 && (
                                <div className="text-xs text-white/45">Нет категорий инфраструктуры рынка</div>
                              )}
                            </div>
                            </motion.div>
                            ) : null}
                            </AnimatePresence>
                          </div>

                        </div>
                      </section>
                    )}

                    {contentSection === "criteria" && activeCategory === "buildings" && (
                      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <div className="space-y-4">
                          <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                            <button
                              type="button"
                              onClick={() => setCriteriaCountriesOpen((v) => !v)}
                              className="mb-2 flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-left"
                            >
                              <Tooltip content="Настройка стран, которые могут или не могут строить это здание.">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Условия стран</div>
                              </Tooltip>
                              {criteriaCountriesOpen ? (
                                <ChevronDown size={14} className="text-white/60" />
                              ) : (
                                <ChevronRight size={14} className="text-white/60" />
                              )}
                            </button>
                            <AnimatePresence initial={false}>
                            {criteriaCountriesOpen ? (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                              className="overflow-hidden"
                            >
                            <div className="grid gap-3 md:grid-cols-2 pt-1">
                              <div>
                                <Tooltip content="Мультивыбор: если список не пуст, строить смогут только страны из него (кроме явно запрещенных).">
                                  <div className="mb-1 text-[11px] text-emerald-300/90">
                                    Разрешенные страны ({allowedCountryIdsNormalized.length})
                                  </div>
                                </Tooltip>
                                <input
                                  value={allowCountrySearch}
                                  onChange={(e) => setAllowCountrySearch(e.target.value)}
                                  placeholder="Поиск страны..."
                                  className="mb-2 w-full rounded-lg border border-white/10 bg-black/35 px-2 py-2 text-xs text-white outline-none transition focus:border-arc-accent/30"
                                />
                                <div className="arc-scrollbar max-h-40 space-y-1 overflow-auto pr-1">
                                  {filteredAllowCountryOptions.map((country) => {
                                    const selected = allowedCountryIdsNormalized.includes(country.id);
                                    return (
                                      <button
                                        key={`allow-country-${country.id}`}
                                        type="button"
                                        onClick={() =>
                                          setDraftAllowedCountryIds((prev) =>
                                            prev.includes(country.id)
                                              ? prev.filter((id) => id !== country.id)
                                              : [...prev, country.id],
                                          )
                                        }
                                        className={`flex w-full items-center justify-between rounded-lg border px-2 py-1.5 text-left text-xs ${
                                          selected
                                            ? "border-emerald-400/45 bg-emerald-500/15 text-emerald-200"
                                            : "border-white/10 bg-black/25 text-white/70"
                                        }`}
                                      >
                                        <span className="truncate">{country.name}</span>
                                        <span className={selected ? "text-emerald-200" : "text-white/35"}>{selected ? "✓" : "○"}</span>
                                      </button>
                                    );
                                  })}
                                  {filteredAllowCountryOptions.length === 0 && (
                                    <div className="rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-xs text-white/45">
                                      Страны не найдены
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div>
                                <Tooltip content="Страны из этого списка не смогут строить здание, даже если они есть в разрешенных.">
                                  <div className="mb-1 text-[11px] text-red-300/90">
                                    Запрещенные страны ({deniedCountryIdsNormalized.length})
                                  </div>
                                </Tooltip>
                                <input
                                  value={denyCountrySearch}
                                  onChange={(e) => setDenyCountrySearch(e.target.value)}
                                  placeholder="Поиск страны..."
                                  className="mb-2 w-full rounded-lg border border-white/10 bg-black/35 px-2 py-2 text-xs text-white outline-none transition focus:border-arc-accent/30"
                                />
                                <div className="arc-scrollbar max-h-40 space-y-1 overflow-auto pr-1">
                                  {filteredDenyCountryOptions.map((country) => {
                                    const selected = deniedCountryIdsNormalized.includes(country.id);
                                    return (
                                      <button
                                        key={`deny-country-${country.id}`}
                                        type="button"
                                        onClick={() =>
                                          setDraftDeniedCountryIds((prev) =>
                                            prev.includes(country.id)
                                              ? prev.filter((id) => id !== country.id)
                                              : [...prev, country.id],
                                          )
                                        }
                                        className={`flex w-full items-center justify-between rounded-lg border px-2 py-1.5 text-left text-xs ${
                                          selected
                                            ? "border-red-400/45 bg-red-500/15 text-red-200"
                                            : "border-white/10 bg-black/25 text-white/70"
                                        }`}
                                      >
                                        <span className="truncate">{country.name}</span>
                                        <span className={selected ? "text-red-200" : "text-white/35"}>{selected ? "✓" : "○"}</span>
                                      </button>
                                    );
                                  })}
                                  {filteredDenyCountryOptions.length === 0 && (
                                    <div className="rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-xs text-white/45">
                                      Страны не найдены
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                            {conflictingCountryNames.length > 0 && (
                              <div className="mt-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">
                                Конфликт критериев: страна одновременно в allow и deny: {conflictingCountryNames.join(", ")}
                              </div>
                            )}
                            <div className="mt-2 text-[11px] text-white/45">
                              Если список разрешенных пуст, строить могут все страны, кроме запрещенных.
                            </div>
                            </motion.div>
                            ) : null}
                            </AnimatePresence>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                            <button
                              type="button"
                              onClick={() => setCriteriaLimitsOpen((v) => !v)}
                              className="mb-2 flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-left"
                            >
                              <Tooltip content="Лимиты работают как cap на текущее количество построенных и строящихся зданий.">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Лимиты количества</div>
                              </Tooltip>
                              {criteriaLimitsOpen ? (
                                <ChevronDown size={14} className="text-white/60" />
                              ) : (
                                <ChevronRight size={14} className="text-white/60" />
                              )}
                            </button>
                            <AnimatePresence initial={false}>
                            {criteriaLimitsOpen ? (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                              className="overflow-hidden"
                            >
                            <div className="mb-3">
                              <label className="block">
                                <Tooltip content="Пусто = без ограничений. Справа показан текущий счётчик: использовано/лимит.">
                                  <span className="mb-1 block text-xs text-white/60">
                                    Глобальный лимит (для всего мира):{" "}
                                    <span className="text-amber-300/90">
                                      {selectedBuildingGlobalUsage}/
                                      {Number.isFinite(Number(draftGlobalBuildLimit))
                                        ? Math.max(1, Math.floor(Number(draftGlobalBuildLimit)))
                                        : "∞"}
                                    </span>
                                  </span>
                                </Tooltip>
                                <input
                                  value={draftGlobalBuildLimit}
                                  onChange={(e) => setDraftGlobalBuildLimit(e.target.value)}
                                  inputMode="numeric"
                                  placeholder="Пусто = без лимита"
                                  className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/30"
                                />
                              </label>
                            </div>
                            <div className="mb-2 flex items-center justify-between">
                              <Tooltip content="Лимит на конкретную страну. Формат счётчика: текущее значение/лимит.">
                                <div className="text-xs text-white/60">Лимиты для конкретных государств</div>
                              </Tooltip>
                              <button
                                type="button"
                                onClick={() => setDraftCountryBuildLimits((prev) => [...prev, { countryId: "", limit: "1" }])}
                                className="rounded-md border border-emerald-400/35 bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-500/30"
                              >
                                Добавить лимит
                              </button>
                            </div>
                            <div className="space-y-2">
                              {draftCountryBuildLimits.map((row, index) => (
                                <div key={`country-limit-${index}`} className="grid grid-cols-[minmax(0,1fr)_120px_32px] gap-2">
                                  <CustomSelect
                                    value={row.countryId}
                                    onChange={(value) =>
                                      setDraftCountryBuildLimits((prev) =>
                                        prev.map((item, i) => (i === index ? { ...item, countryId: value } : item)),
                                      )
                                    }
                                    options={[
                                      { value: "", label: "Выберите страну" },
                                      ...countryOptions.map((country) => ({ value: country.id, label: country.name })),
                                    ]}
                                    buttonClassName="h-[42px]"
                                  />
                                  <input
                                    value={row.limit}
                                    onChange={(e) =>
                                      setDraftCountryBuildLimits((prev) =>
                                        prev.map((item, i) => (i === index ? { ...item, limit: e.target.value } : item)),
                                      )
                                    }
                                    inputMode="numeric"
                                    placeholder="1"
                                    className="rounded-lg border border-white/10 bg-black/35 px-2 py-2 text-sm text-white outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setDraftCountryBuildLimits((prev) => prev.filter((_, i) => i !== index))}
                                    className="rounded-lg border border-rose-400/30 bg-rose-500/10 text-xs text-rose-200"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                              {draftCountryBuildLimits.map((row, index) => {
                                const used = row.countryId ? Math.max(0, Math.floor(selectedBuildingUsageByCountry[row.countryId] ?? 0)) : 0;
                                const limit = Number.isFinite(Number(row.limit))
                                  ? Math.max(1, Math.floor(Number(row.limit)))
                                  : null;
                                return (
                                  <div key={`country-limit-usage-${index}`} className="text-[11px] text-white/50">
                                    {(countryOptions.find((country) => country.id === row.countryId)?.name ?? row.countryId ?? "Страна")}:
                                    {" "}
                                    <span className="text-amber-300/90">{used}/{limit ?? "∞"}</span>
                                  </div>
                                );
                              })}
                              {draftCountryBuildLimits.length === 0 && (
                                <div className="text-xs text-white/45">Нет лимитов по странам</div>
                              )}
                            </div>
                            </motion.div>
                            ) : null}
                            </AnimatePresence>
                          </div>
                        </div>
                      </section>
                    )}

                    {contentSection === "economy" && activeCategory === "goods" && (
                      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                          <button
                            type="button"
                            onClick={() => setGoodsEconomyOpen((v) => !v)}
                            className="mb-2 flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-left"
                          >
                            <Tooltip content="Параметры товара для экономической модели до подключения полноценного рынка.">
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Экономика товара</div>
                            </Tooltip>
                            {goodsEconomyOpen ? (
                              <ChevronDown size={14} className="text-white/60" />
                            ) : (
                              <ChevronRight size={14} className="text-white/60" />
                            )}
                          </button>
                          <AnimatePresence initial={false}>
                          {goodsEconomyOpen ? (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                              className="overflow-hidden"
                            >
                              <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
                                <label className="block">
                                  <Tooltip content="Базовая цена единицы товара. Сейчас используется как заглушка для расчетов.">
                                    <span className="mb-1 block text-xs text-white/60">Базовая цена</span>
                                  </Tooltip>
                                  <input
                                    value={draftBasePrice}
                                    onChange={(e) => setDraftBasePrice(e.target.value)}
                                    inputMode="decimal"
                                    placeholder="1"
                                    className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/30"
                                  />
                                </label>
                                <label className="block">
                                  <Tooltip content="Минимальная граница цены товара на рынке.">
                                    <span className="mb-1 block text-xs text-white/60">Мин. цена</span>
                                  </Tooltip>
                                  <input
                                    value={draftMinPrice}
                                    onChange={(e) => setDraftMinPrice(e.target.value)}
                                    inputMode="decimal"
                                    placeholder="0.1"
                                    className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/30"
                                  />
                                </label>
                                <label className="block">
                                  <Tooltip content="Максимальная граница цены товара на рынке.">
                                    <span className="mb-1 block text-xs text-white/60">Макс. цена</span>
                                  </Tooltip>
                                  <input
                                    value={draftMaxPrice}
                                    onChange={(e) => setDraftMaxPrice(e.target.value)}
                                    inputMode="decimal"
                                    placeholder="10"
                                    className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/30"
                                  />
                                </label>
                                <label className="block">
                                  <Tooltip content="Сколько инфраструктуры расходуется на перевозку 1 единицы товара (покупка или продажа).">
                                    <span className="mb-1 block text-xs text-white/60">Инфра за 1 ед.</span>
                                  </Tooltip>
                                  <input
                                    value={draftInfraPerUnit}
                                    onChange={(e) => setDraftInfraPerUnit(e.target.value)}
                                    inputMode="decimal"
                                    placeholder="1"
                                    className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/30"
                                  />
                                </label>
                                <label className="block">
                                  <Tooltip content="Категория инфраструктуры для логистических лимитов. Если пусто, инфраструктура не ограничивает торговлю этим товаром.">
                                    <span className="mb-1 block text-xs text-white/60">Категория инфраструктуры</span>
                                  </Tooltip>
                                  <CustomSelect
                                    value={draftResourceCategoryId}
                                    onChange={setDraftResourceCategoryId}
                                    options={[
                                      { value: "", label: "Без категории" },
                                      ...resourceCategoryOptions.map((option) => ({ value: option.id, label: option.name })),
                                    ]}
                                    buttonClassName="h-[42px]"
                                  />
                                </label>
                              </div>
                              <Tooltip content="После внедрения рынка это значение будет стартовой/референсной ценой.">
                                <div className="mt-1 text-[11px] text-white/45">Используется как заглушка цены до внедрения рынка.</div>
                              </Tooltip>
                            </motion.div>
                          ) : null}
                          </AnimatePresence>
                        </div>
                      </section>
                    )}

                    {contentSection === "economy" && activeCategory === "professions" && (
                      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                          <Tooltip content="Базовая зарплата за одного работника профессии за ход. Используется при расчете затрат зданий.">
                            <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                              Экономика профессии
                            </span>
                          </Tooltip>
                          <label className="block">
                            <Tooltip content="Базовая ставка оплаты труда для этой профессии.">
                              <span className="mb-1 block text-xs text-white/60">Базовая зарплата</span>
                            </Tooltip>
                            <input
                              value={draftBaseWage}
                              onChange={(e) => setDraftBaseWage(e.target.value)}
                              inputMode="decimal"
                              placeholder="1"
                              className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/30"
                            />
                          </label>
                        </div>
                      </section>
                    )}

                    {contentSection === "branding" && (
                      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <Tooltip content="Логотип показывается в списках и карточках. Максимальный размер файла: 64x64.">
                          <span className="mb-3 block text-xs font-semibold uppercase tracking-wide text-slate-400">Логотип</span>
                        </Tooltip>
                        <div className="flex flex-wrap items-start gap-4">
                          <div className="flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[#131a22]">
                            {draftLogoUrl ? (
                              <img src={draftLogoUrl} alt="Логотип записи" className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-xs font-semibold" style={{ color: draftColor }}>
                                {draftName.trim().slice(0, 1).toUpperCase() || "К"}
                              </span>
                            )}
                          </div>
                          <div className="flex min-w-[220px] flex-1 flex-col gap-2">
                            <Tooltip content="Поддерживаются PNG, SVG, WEBP и JPEG. Размер изображения не больше 64x64.">
                              <label className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-arc-accent px-3 text-sm font-semibold text-black transition hover:brightness-110">
                                <Upload size={14} />
                                Загрузить логотип
                                <input
                                  type="file"
                                  accept="image/png,image/svg+xml,image/webp,image/jpeg"
                                  className="hidden"
                                  onChange={(e) => void uploadLogo(e.target.files?.[0] ?? null)}
                                />
                              </label>
                            </Tooltip>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!selectedEntry) return;
                                try {
                                  setSaving(true);
                                  const result = await adminDeleteContentEntryLogo(token, activeCategory, selectedEntry.id);
                                  setEntries(result.items);
                                  setDraftLogoUrl(result.item.logoUrl);
                                  setSavedSnapshot(buildSnapshot(result.item));
                                } catch {
                                  toast.error("Не удалось удалить логотип");
                                } finally {
                                  setSaving(false);
                                }
                              }}
                              disabled={!selectedEntry || saving}
                              className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 text-sm font-semibold text-rose-200 transition hover:border-rose-300/50 hover:bg-rose-400/15 disabled:opacity-50"
                            >
                              Удалить логотип
                            </button>
                            <div className="text-xs text-white/50">Максимум 64x64. Рекомендуется PNG или SVG.</div>
                          </div>
                        </div>
                        {activeCategory === "races" && (
                          <div className="mt-4 border-t border-white/10 pt-4">
                            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Портреты расы</div>
                            <div className="grid gap-4 md:grid-cols-2">
                              {([
                                { slot: "male", label: "Мужской портрет", url: draftMalePortraitUrl },
                                { slot: "female", label: "Женский портрет", url: draftFemalePortraitUrl },
                              ] as const).map((portrait) => (
                                <div key={portrait.slot} className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                                  <div className="mb-2 text-[11px] text-white/60">{portrait.label}</div>
                                  <div className="mb-3 flex h-[100px] w-[89px] items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/30">
                                    {portrait.url ? (
                                      <img src={portrait.url} alt={portrait.label} className="h-full w-full object-cover" />
                                    ) : (
                                      <span className="text-[10px] text-white/45">89x100</span>
                                    )}
                                  </div>
                                  <div className="flex flex-col gap-2">
                                    <label className="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-arc-accent px-3 text-xs font-semibold text-black transition hover:brightness-110">
                                      <Upload size={13} />
                                      Загрузить
                                      <input
                                        type="file"
                                        accept="image/png,image/webp,image/jpeg"
                                        className="hidden"
                                        onChange={(e) => void uploadRacePortraitSlot(portrait.slot, e.target.files?.[0] ?? null)}
                                      />
                                    </label>
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        if (!selectedEntry) return;
                                        try {
                                          setSaving(true);
                                          const result = await adminDeleteRacePortrait(token, selectedEntry.id, portrait.slot);
                                          setEntries(result.items);
                                          setSavedSnapshot(buildSnapshot(result.item));
                                          setDraftMalePortraitUrl(result.item.malePortraitUrl ?? null);
                                          setDraftFemalePortraitUrl(result.item.femalePortraitUrl ?? null);
                                        } catch {
                                          toast.error("Не удалось удалить портрет");
                                        } finally {
                                          setSaving(false);
                                        }
                                      }}
                                      disabled={!selectedEntry || saving}
                                      className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 text-xs font-semibold text-rose-200 transition hover:border-rose-300/50 hover:bg-rose-400/15 disabled:opacity-50"
                                    >
                                      Удалить
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="mt-2 text-xs text-white/50">Размер портретов: максимум 89x100.</div>
                          </div>
                        )}
                      </section>
                    )}
                  </div>

                  <aside className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Предпросмотр</div>
                    <div className="space-y-3">
                      <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                        <div className="mb-2 text-[11px] text-white/50">Строка списка</div>
                        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-2">
                          <div
                            className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border border-white/10"
                            style={{ backgroundColor: `${draftColor}22` }}
                          >
                            {draftLogoUrl ? (
                              <img src={draftLogoUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-xs font-semibold" style={{ color: draftColor }}>
                                {draftName.trim().slice(0, 1).toUpperCase() || "К"}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm text-white">{draftName.trim() || "Название"}</div>
                            <div className="mt-1 flex items-center gap-2">
                              <span className="inline-block h-2.5 w-2.5 rounded-full border border-white/20" style={{ backgroundColor: draftColor }} />
                              <span className="text-[10px] text-white/50">{draftColor}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                        <div className="mb-2 text-[11px] text-white/50">Чип</div>
                        <div
                          className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs"
                          style={{ borderColor: `${draftColor}88`, color: draftColor, background: `${draftColor}10` }}
                        >
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: draftColor }}
                          />
                                {draftName.trim() || "Название"}
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                        <div className="mb-2 text-[11px] text-white/50">Карточка страны</div>
                        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-12 rounded bg-white/10" />
                            <div
                              className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-white/10"
                              style={{ backgroundColor: `${draftColor}22` }}
                            >
                              {draftLogoUrl ? (
                                <img src={draftLogoUrl} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <span className="text-xs font-semibold" style={{ color: draftColor }}>
                                  {draftName.trim().slice(0, 1).toUpperCase() || "К"}
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm text-white">Пример страны</div>
                              <div className="mt-1 inline-flex items-center gap-2 rounded-full border px-2 py-1 text-[10px]" style={{ borderColor: `${draftColor}66`, color: draftColor, background: `${draftColor}10` }}>
                                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: draftColor }} />
                                {draftName.trim() || categoryMeta.singular}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                        <div className="mb-2 text-[11px] text-white/50">Описание</div>
                        <div className="text-xs leading-5 text-white/75">
                          {draftDescription.trim() || "Описание будет отображаться здесь."}
                        </div>
                      </div>
                    </div>
                  </aside>
                </div>
              </div>
              </div>
            </div>
          </Dialog.Panel>
        </motion.div>
      </div>

      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} className="relative z-[206]">
        <motion.div aria-hidden="true" className="fixed inset-0 bg-black/55 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
        <div className="fixed inset-0 z-[207] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.99 }} className="w-full max-w-md">
            <Dialog.Panel className="glass panel-border rounded-2xl bg-[#0b111b] p-4 shadow-2xl">
              <Dialog.Title className="text-base font-semibold text-white">Удалить запись?</Dialog.Title>
              <div className="mt-2 text-sm text-white/70">
                Запись <span className="font-semibold text-white">«{selectedEntry?.name ?? "Без названия"}»</span> будет удалена.
              </div>
              <div className="mt-1 text-xs text-white/45">Это действие удалит и логотип, если он загружен.</div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmOpen(false)}
                  className="panel-border inline-flex h-10 items-center justify-center rounded-lg bg-white/5 px-3 text-sm text-white/80 transition hover:text-white"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => void deleteEntry()}
                  disabled={saving}
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-rose-500/90 px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                >
                  Удалить
                </button>
              </div>
            </Dialog.Panel>
          </motion.div>
        </div>
      </Dialog>

      <Dialog open={closeConfirmOpen} onClose={() => setCloseConfirmOpen(false)} className="relative z-[206]">
        <motion.div aria-hidden="true" className="fixed inset-0 bg-black/55 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
        <div className="fixed inset-0 z-[207] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.99 }} className="w-full max-w-md">
            <Dialog.Panel className="glass panel-border rounded-2xl bg-[#0b111b] p-4 shadow-2xl">
              <Dialog.Title className="text-base font-semibold text-white">Закрыть панель контента?</Dialog.Title>
              <div className="mt-2 text-sm text-white/70">Есть несохранённые изменения в выбранной записи.</div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCloseConfirmOpen(false)}
                  className="panel-border inline-flex h-10 items-center justify-center rounded-lg bg-white/5 px-3 text-sm text-white/80 transition hover:text-white"
                >
                  Остаться
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCloseConfirmOpen(false);
                    onClose();
                  }}
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-rose-500/90 px-4 text-sm font-semibold text-white transition hover:brightness-110"
                >
                  Закрыть без сохранения
                </button>
              </div>
            </Dialog.Panel>
          </motion.div>
        </div>
      </Dialog>
    </Dialog>
  );
}
