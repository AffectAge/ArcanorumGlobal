import { Dialog } from "@headlessui/react";
import { Listbox } from "@headlessui/react";
import { useEffect, useMemo, useState } from "react";
import { BellRing, Check, ChevronDown, Flag, Map as MapIcon, Palette, RotateCcw, Shield, Trash2, Upload, Users, X } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import type { Country } from "@arcanorum/shared";
import {
  adminBroadcastUiNotification,
  adminClearPopulation,
  adminCreatePopulationPop,
  adminDeletePopulationPop,
  adminDeleteCountry,
  adminFetchPopulation,
  adminGeneratePopulation,
  adminResetProvinceColonizationCostToAuto,
  adminSetCountryPunishment,
  adminUpdateCountry,
  adminUpdatePopulationPop,
  adminUpdateProvince,
  fetchContentEntries,
  fetchAdminProvinces,
  fetchCountries,
  type AdminProvinceItem,
  type ContentEntry,
  type PopulationItem,
  type PopulationSummaryItem,
} from "../lib/api";

type Props = {
  open: boolean;
  token: string;
  currentCountryId: string;
  onClose: () => void;
  onSessionCountryUpdated: (country: Country) => void;
  initialProvinceId?: string | null;
};

const categories = [
  { id: "countries", label: "Управление странами", icon: Flag },
  { id: "provinces", label: "Провинции / Колонизация", icon: MapIcon },
  { id: "population", label: "Управление населением", icon: Users },
  { id: "notifications", label: "Рассылка уведомлений", icon: BellRing },
] as const;

export function AdminPanel({ open, token, currentCountryId, onClose, onSessionCountryUpdated, initialProvinceId }: Props) {
  const [activeCategory, setActiveCategory] = useState<(typeof categories)[number]["id"]>("countries");
  const [countrySection, setCountrySection] = useState<"general" | "punishments">("general");
  const [countries, setCountries] = useState<Country[]>([]);
  const [provinces, setProvinces] = useState<AdminProvinceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [selectedCountryId, setSelectedCountryId] = useState<string>("");
  const [countryName, setCountryName] = useState("");
  const [countryColor, setCountryColor] = useState("#4ade80");
  const [isAdmin, setIsAdmin] = useState(false);
  const [flagFile, setFlagFile] = useState<File | null>(null);
  const [crestFile, setCrestFile] = useState<File | null>(null);
  const [flagPreviewUrl, setFlagPreviewUrl] = useState<string | null>(null);
  const [crestPreviewUrl, setCrestPreviewUrl] = useState<string | null>(null);
  const [turnsToBlock, setTurnsToBlock] = useState(3);
  const [blockUntilAt, setBlockUntilAt] = useState("");
  const [punishmentReasonText, setPunishmentReasonText] = useState("");
  const [ignoreUntilTurn, setIgnoreUntilTurn] = useState(0);
  const [selectedProvinceId, setSelectedProvinceId] = useState<string>("");
  const [provinceOwnerCountryId, setProvinceOwnerCountryId] = useState<string>("");
  const [provinceColonizationCost, setProvinceColonizationCost] = useState(100);
  const [provinceColonizationDisabled, setProvinceColonizationDisabled] = useState(false);
  const [provinceSearch, setProvinceSearch] = useState("");
  const [broadcastCategory, setBroadcastCategory] = useState<"system" | "politics" | "economy">("system");
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [populationSummary, setPopulationSummary] = useState<PopulationSummaryItem[]>([]);
  const [populationTotal, setPopulationTotal] = useState(0);
  const [populationGenerateCount, setPopulationGenerateCount] = useState(100);
  const [populationGenerateMinSize, setPopulationGenerateMinSize] = useState(100);
  const [populationGenerateMaxSize, setPopulationGenerateMaxSize] = useState(2000);
  const [populationGenerateProvinceMode, setPopulationGenerateProvinceMode] = useState<"all" | "single">("all");
  const [populationGenerateProvinceId, setPopulationGenerateProvinceId] = useState("");
  const [populationGenerateTraitsMode, setPopulationGenerateTraitsMode] = useState<"random" | "fixed">("random");
  const [populationGenerateCultureId, setPopulationGenerateCultureId] = useState("");
  const [populationGenerateReligionId, setPopulationGenerateReligionId] = useState("");
  const [populationGenerateRaceId, setPopulationGenerateRaceId] = useState("");
  const [populationItems, setPopulationItems] = useState<PopulationItem[]>([]);
  const [populationSearch, setPopulationSearch] = useState("");
  const [selectedPopulationId, setSelectedPopulationId] = useState<number | null>(null);
  const [populationDraft, setPopulationDraft] = useState<{
    countryId: string;
    provinceId: string;
    size: number;
    cultureId: string;
    religionId: string;
    raceId: string;
  }>({
    countryId: "",
    provinceId: "",
    size: 1000,
    cultureId: "",
    religionId: "",
    raceId: "",
  });
  const [contentCultures, setContentCultures] = useState<ContentEntry[]>([]);
  const [contentReligions, setContentReligions] = useState<ContentEntry[]>([]);
  const [contentRaces, setContentRaces] = useState<ContentEntry[]>([]);

  const selectedCountry = useMemo(() => countries.find((c) => c.id === selectedCountryId) ?? null, [countries, selectedCountryId]);
  const selectedProvince = useMemo(() => provinces.find((p) => p.id === selectedProvinceId) ?? null, [provinces, selectedProvinceId]);
  const selectedProvinceOwner = useMemo(() => countries.find((c) => c.id === provinceOwnerCountryId) ?? null, [countries, provinceOwnerCountryId]);
  const filteredProvinces = useMemo(() => {
    const q = provinceSearch.trim().toLowerCase();
    if (!q) return provinces;
    return provinces.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  }, [provinceSearch, provinces]);
  const selectedPopulation = useMemo(
    () => populationItems.find((item) => item.id === selectedPopulationId) ?? null,
    [populationItems, selectedPopulationId],
  );
  const filteredPopulation = useMemo(() => {
    const q = populationSearch.trim().toLowerCase();
    if (!q) return populationItems;
    return populationItems.filter((item) => {
      const countryName = countries.find((country) => country.id === item.countryId)?.name ?? item.countryId;
      const provinceName = provinces.find((province) => province.id === item.provinceId)?.name ?? item.provinceId;
      return (
        String(item.id).toLowerCase().includes(q) ||
        countryName.toLowerCase().includes(q) ||
        provinceName.toLowerCase().includes(q)
      );
    });
  }, [countries, populationItems, populationSearch, provinces]);

  const punishmentStatus = useMemo(() => {
    if (!selectedCountry) {
      return "";
    }

    if (selectedCountry.isLocked) {
      return "Перманентная блокировка входа";
    }

    if (selectedCountry.blockedUntilTurn) {
      return `Блокировка до хода #${selectedCountry.blockedUntilTurn}`;
    }

    if (selectedCountry.blockedUntilAt) {
      return `Блокировка до ${new Date(selectedCountry.blockedUntilAt).toLocaleString()}`;
    }


    if (selectedCountry.ignoreUntilTurn) {
      return `Не учитывать при пропуске хода до #${selectedCountry.ignoreUntilTurn}`;
    }

    return "Ограничений нет";
  }, [selectedCountry]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetchCountries(),
      fetchAdminProvinces(token),
      fetchContentEntries("cultures"),
      fetchContentEntries("religions"),
      fetchContentEntries("races"),
    ])
      .then(([countryList, provinceList, culturesList, religionsList, racesList]) => {
        if (cancelled) {
          return;
        }
        setCountries(countryList);
        setProvinces(provinceList);
        setContentCultures(culturesList);
        setContentReligions(religionsList);
        setContentRaces(racesList);
        if (!selectedCountryId && countryList.length > 0) {
          setSelectedCountryId(countryList[0].id);
        }
        if (!selectedProvinceId && provinceList.length > 0) {
          setSelectedProvinceId(provinceList[0].id);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, token]);

  useEffect(() => {
    if (!selectedCountry) {
      return;
    }
    setCountryName(selectedCountry.name);
    setCountryColor(selectedCountry.color);
    setIsAdmin(Boolean(selectedCountry.isAdmin));
    setFlagFile(null);
    setCrestFile(null);
    setFlagPreviewUrl(selectedCountry.flagUrl ?? null);
    setCrestPreviewUrl(selectedCountry.crestUrl ?? null);
    setIgnoreUntilTurn(selectedCountry.ignoreUntilTurn ?? 0);
    setPunishmentReasonText(selectedCountry.lockReason ?? "");
  }, [selectedCountryId, selectedCountry]);

  useEffect(() => {
    if (!selectedProvince) {
      return;
    }
    setProvinceOwnerCountryId(selectedProvince.ownerCountryId ?? "");
    setProvinceColonizationCost(selectedProvince.colonizationCost);
    setProvinceColonizationDisabled(selectedProvince.colonizationDisabled);
  }, [selectedProvince]);

  useEffect(() => {
    if (!selectedPopulation) {
      setPopulationDraft((prev) => ({
        ...prev,
        countryId: countries[0]?.id ?? "",
        provinceId: provinces[0]?.id ?? "",
        cultureId: contentCultures[0]?.id ?? "",
        religionId: contentReligions[0]?.id ?? "",
        raceId: contentRaces[0]?.id ?? "",
      }));
      return;
    }
    setPopulationDraft({
      countryId: selectedPopulation.countryId,
      provinceId: selectedPopulation.provinceId,
      size: selectedPopulation.size,
      cultureId: selectedPopulation.cultureId,
      religionId: selectedPopulation.religionId,
      raceId: selectedPopulation.raceId,
    });
  }, [contentCultures, contentRaces, contentReligions, countries, provinces, selectedPopulation]);

  useEffect(() => {
    if (!populationGenerateProvinceId && provinces.length > 0) {
      setPopulationGenerateProvinceId(provinces[0].id);
    }
    if (!populationGenerateCultureId && contentCultures.length > 0) {
      setPopulationGenerateCultureId(contentCultures[0].id);
    }
    if (!populationGenerateReligionId && contentReligions.length > 0) {
      setPopulationGenerateReligionId(contentReligions[0].id);
    }
    if (!populationGenerateRaceId && contentRaces.length > 0) {
      setPopulationGenerateRaceId(contentRaces[0].id);
    }
  }, [
    contentCultures,
    contentReligions,
    contentRaces,
    populationGenerateCultureId,
    populationGenerateProvinceId,
    populationGenerateRaceId,
    populationGenerateReligionId,
    provinces,
  ]);

  useEffect(() => {
    if (!open || !initialProvinceId) {
      return;
    }
    setActiveCategory("provinces");
    setSelectedProvinceId(initialProvinceId);
  }, [initialProvinceId, open]);

  useEffect(() => {
    if (!flagFile) {
      return;
    }
    const url = URL.createObjectURL(flagFile);
    setFlagPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [flagFile]);

  useEffect(() => {
    if (!crestFile) {
      return;
    }
    const url = URL.createObjectURL(crestFile);
    setCrestPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [crestFile]);

  const saveCountry = async () => {
    if (!selectedCountry) {
      return;
    }

    setSaving(true);
    try {
      const updated = await adminUpdateCountry(token, selectedCountry.id, {
        countryName,
        countryColor,
        isAdmin,
        flagFile,
        crestFile,
      });

      setCountries((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      if (updated.id === currentCountryId) {
        onSessionCountryUpdated(updated);
      }
      toast.success("Страна обновлена");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "COUNTRY_UPDATE_FAILED";
      if (msg === "IMAGE_DIMENSIONS_TOO_LARGE") {
        toast.error("Изображение должно быть максимум 256x256");
      } else {
        toast.error("Не удалось обновить страну");
      }
    } finally {
      setSaving(false);
    }
  };

  const applyPunishment = async (payload: { action: "unlock" } | { action: "permanent" } | { action: "turns"; turns: number } | { action: "time"; blockedUntilAt: string }) => {
    if (!selectedCountry) {
      return;
    }

    setSaving(true);
    try {
      const updated = await adminSetCountryPunishment(token, selectedCountry.id, {
        ...payload,
        reasonText: punishmentReasonText.trim() || undefined,
      });
      setCountries((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      if (updated.id === currentCountryId) {
        onSessionCountryUpdated(updated);
      }
      toast.success("Наказание обновлено");
    } catch {
      toast.error("Не удалось применить наказание");
    } finally {
      setSaving(false);
    }
  };


  const saveIgnoreUntilTurn = async (value: number | null) => {
    if (!selectedCountry) {
      return;
    }

    setSaving(true);
    try {
      const updated = await adminUpdateCountry(token, selectedCountry.id, { ignoreUntilTurn: value });
      setCountries((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      if (updated.id === currentCountryId) {
        onSessionCountryUpdated(updated);
      }
      setIgnoreUntilTurn(updated.ignoreUntilTurn ?? 0);
      toast.success("Исключение из пропуска хода обновлено");
    } catch {
      toast.error("Не удалось обновить исключение");
    } finally {
      setSaving(false);
    }
  };

  const deleteCountry = async () => {
    if (!selectedCountry) {
      return;
    }

    const confirmed = window.confirm(`Удалить страну ${selectedCountry.name}?`);
    if (!confirmed) {
      return;
    }

    setSaving(true);
    try {
      await adminDeleteCountry(token, selectedCountry.id);
      setCountries((prev) => prev.filter((c) => c.id !== selectedCountry.id));
      const next = countries.find((c) => c.id !== selectedCountry.id);
      setSelectedCountryId(next?.id ?? "");
      toast.success("Страна удалена");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "COUNTRY_DELETE_FAILED";
      if (msg === "CANNOT_DELETE_SELF") {
        toast.error("Нельзя удалить страну, под которой вы вошли");
      } else {
        toast.error("Не удалось удалить страну");
      }
    } finally {
      setSaving(false);
    }
  };

  const saveProvince = async () => {
    if (!selectedProvince) {
      return;
    }
    setSaving(true);
    try {
      const updated = await adminUpdateProvince(token, selectedProvince.id, {
        colonizationCost: Math.max(1, Math.floor(provinceColonizationCost)),
        colonizationDisabled: provinceColonizationDisabled,
        ownerCountryId: provinceOwnerCountryId.trim() === "" ? null : provinceOwnerCountryId,
      });
      setProvinces((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      toast.success("Провинция обновлена");
    } catch {
      toast.error("Не удалось обновить провинцию");
    } finally {
      setSaving(false);
    }
  };

  const resetProvinceCostToAuto = async () => {
    if (!selectedProvince) return;
    setSaving(true);
    try {
      const updated = await adminResetProvinceColonizationCostToAuto(token, selectedProvince.id);
      setProvinces((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      toast.success("Цена провинции сброшена к авто");
    } catch {
      toast.error("Не удалось сбросить цену к авто");
    } finally {
      setSaving(false);
    }
  };

  const sendBroadcastNotification = async () => {
    const title = broadcastTitle.trim();
    const message = broadcastMessage.trim();
    if (!title || !message) {
      toast.error("Заполните заголовок и текст уведомления");
      return;
    }
    setSaving(true);
    try {
      await adminBroadcastUiNotification(token, {
        category: broadcastCategory,
        title,
        message,
      });
      setBroadcastTitle("");
      setBroadcastMessage("");
      toast.success("Уведомление отправлено всем игрокам");
    } catch {
      toast.error("Не удалось отправить уведомление");
    } finally {
      setSaving(false);
    }
  };

  const refreshPopulationSummary = async () => {
    const data = await adminFetchPopulation(token, { limit: 500, offset: 0 });
    setPopulationSummary(data.summaryByCountry ?? []);
    setPopulationTotal(data.total ?? 0);
    setPopulationItems(data.items ?? []);
    if (data.items?.length && !data.items.some((item) => item.id === selectedPopulationId)) {
      setSelectedPopulationId(data.items[0].id);
    }
    if (!data.items?.length) {
      setSelectedPopulationId(null);
    }
  };

  const generatePopulation = async () => {
    if (populationGenerateProvinceMode === "single" && !populationGenerateProvinceId) {
      toast.error("Выберите провинцию для генерации");
      return;
    }
    if (
      populationGenerateTraitsMode === "fixed" &&
      (!populationGenerateCultureId || !populationGenerateReligionId || !populationGenerateRaceId)
    ) {
      toast.error("Для фиксированных атрибутов выберите культуру, религию и расу");
      return;
    }
    setSaving(true);
    try {
      const result = await adminGeneratePopulation(token, {
        count: Math.max(1, Math.floor(populationGenerateCount)),
        minSize: Math.max(1, Math.floor(populationGenerateMinSize)),
        maxSize: Math.max(1, Math.floor(populationGenerateMaxSize)),
        provinceId: populationGenerateProvinceMode === "single" ? populationGenerateProvinceId : undefined,
        cultureId: populationGenerateTraitsMode === "fixed" ? populationGenerateCultureId : undefined,
        religionId: populationGenerateTraitsMode === "fixed" ? populationGenerateReligionId : undefined,
        raceId: populationGenerateTraitsMode === "fixed" ? populationGenerateRaceId : undefined,
      });
      await refreshPopulationSummary();
      toast.success(`Сгенерировано POP: ${result.createdCount}`);
    } catch {
      toast.error("Не удалось сгенерировать население");
    } finally {
      setSaving(false);
    }
  };

  const clearPopulation = async () => {
    const confirmed = window.confirm("Удалить всё население (все POP) из мира?");
    if (!confirmed) return;
    setSaving(true);
    try {
      const result = await adminClearPopulation(token);
      setPopulationSummary(result.summaryByCountry ?? []);
      setPopulationTotal(result.total ?? 0);
      setPopulationItems([]);
      setSelectedPopulationId(null);
      toast.success(`Удалено POP: ${result.removedCount}`);
    } catch {
      toast.error("Не удалось удалить всё население");
    } finally {
      setSaving(false);
    }
  };

  const createPopulationPop = async () => {
    if (
      !populationDraft.countryId ||
      !populationDraft.provinceId ||
      !populationDraft.cultureId ||
      !populationDraft.religionId ||
      !populationDraft.raceId
    ) {
      toast.error("Заполните все поля POP");
      return;
    }
    setSaving(true);
    try {
      await adminCreatePopulationPop(token, {
        countryId: populationDraft.countryId,
        provinceId: populationDraft.provinceId,
        size: Math.max(1, Math.floor(populationDraft.size)),
        cultureId: populationDraft.cultureId,
        religionId: populationDraft.religionId,
        raceId: populationDraft.raceId,
      });
      await refreshPopulationSummary();
      toast.success("POP создан");
    } catch {
      toast.error("Не удалось создать POP");
    } finally {
      setSaving(false);
    }
  };

  const savePopulationPop = async () => {
    if (!selectedPopulation) return;
    setSaving(true);
    try {
      await adminUpdatePopulationPop(token, selectedPopulation.id, {
        countryId: populationDraft.countryId,
        provinceId: populationDraft.provinceId,
        size: Math.max(1, Math.floor(populationDraft.size)),
        cultureId: populationDraft.cultureId,
        religionId: populationDraft.religionId,
        raceId: populationDraft.raceId,
      });
      await refreshPopulationSummary();
      toast.success("POP обновлен");
    } catch {
      toast.error("Не удалось обновить POP");
    } finally {
      setSaving(false);
    }
  };

  const deletePopulationPop = async () => {
    if (!selectedPopulation) return;
    const confirmed = window.confirm("Удалить выбранный POP?");
    if (!confirmed) return;
    setSaving(true);
    try {
      await adminDeletePopulationPop(token, selectedPopulation.id);
      await refreshPopulationSummary();
      toast.success("POP удален");
    } catch {
      toast.error("Не удалось удалить POP");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!open || activeCategory !== "population") return;
    let cancelled = false;
    refreshPopulationSummary().catch(() => {
      if (!cancelled) {
        toast.error("Не удалось загрузить население");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeCategory, open, token]);

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[120]">
      <motion.div
        aria-hidden="true"
        className="fixed inset-0 bg-black/55"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
      />
      <div className="fixed inset-0">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="h-full w-full"
        >
        <Dialog.Panel className="glass panel-border h-full w-full rounded-none p-4">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="font-display text-2xl tracking-wide text-arc-accent">Панель администратора</Dialog.Title>
            <button onClick={onClose} className="panel-border inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:text-arc-accent">
              <X size={16} />
            </button>
          </div>

          <div className="grid h-[calc(100vh-92px)] gap-4 md:grid-cols-[260px_1fr]">
            <aside className="arc-scrollbar panel-border rounded-xl bg-black/25 p-2 overflow-auto">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`mb-2 block w-full rounded-lg px-3 py-2 text-left text-sm transition ${activeCategory === cat.id ? "bg-arc-accent/20 text-arc-accent" : "text-slate-300 hover:text-white"}`}
                >
                  <span className="inline-flex items-center gap-2">
                    <cat.icon size={14} />
                    <span>{cat.label}</span>
                  </span>
                </button>
              ))}
            </aside>

            <div className="flex min-h-0 flex-col gap-3">
              {activeCategory === "countries" && selectedCountry && (
                <div className="panel-border rounded-xl bg-black/25 p-3">
                  <div className="mb-2 px-1 text-[11px] uppercase tracking-wide text-white/45">Раздел управления страной</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setCountrySection("general")}
                      className={`inline-flex items-center border-b px-1 py-1.5 text-xs font-medium transition ${
                        countrySection === "general"
                          ? "border-arc-accent text-arc-accent"
                          : "border-transparent text-slate-300 hover:text-white"
                      }`}
                    >
                      Основная информация
                    </button>
                    <button
                      type="button"
                      onClick={() => setCountrySection("punishments")}
                      className={`inline-flex items-center border-b px-1 py-1.5 text-xs font-medium transition ${
                        countrySection === "punishments"
                          ? "border-rose-300 text-rose-300"
                          : "border-transparent text-slate-300 hover:text-white"
                      }`}
                    >
                      Наказания
                    </button>
                  </div>
                </div>
              )}

              <section className="arc-scrollbar panel-border min-h-0 rounded-xl bg-black/25 p-4 overflow-auto">
                {loading ? (
                  <div className="text-sm text-slate-400">Загрузка стран...</div>
                ) : (
                  <div className="space-y-4">
                  {activeCategory === "provinces" && (
                    <>
                      <div>
                        <label className="mb-1 block text-xs text-slate-300">Провинция</label>
                        <input
                          value={provinceSearch}
                          onChange={(e) => setProvinceSearch(e.target.value)}
                          placeholder="Поиск по названию или ID..."
                          className="mb-2 w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100"
                        />
                        <Listbox value={selectedProvinceId} onChange={setSelectedProvinceId}>
                          <div className="relative">
                            <Listbox.Button className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 pr-10 text-left text-sm text-slate-100">
                              {selectedProvince ? `${selectedProvince.name} (${selectedProvince.id})` : "Выберите провинцию"}
                              <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            </Listbox.Button>
                            <Listbox.Options className="arc-scrollbar panel-border absolute z-30 mt-2 max-h-72 w-full overflow-auto rounded-lg bg-arc-panel/95 p-1 text-sm shadow-2xl outline-none">
                              {filteredProvinces.map((province) => (
                                <Listbox.Option
                                  key={province.id}
                                  value={province.id}
                                  className={({ active }) => `relative cursor-pointer rounded-md px-3 py-2 pr-9 transition ${active ? "bg-arc-accent/15 text-arc-accent" : "text-slate-300"}`}
                                >
                                  {({ selected }) => (
                                    <>
                                      <div className={selected ? "text-arc-accent" : ""}>{province.name}</div>
                                      <div className="text-[11px] text-slate-400">{province.id}</div>
                                      {selected && <Check size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-arc-accent" />}
                                    </>
                                  )}
                                </Listbox.Option>
                              ))}
                              {filteredProvinces.length === 0 && (
                                <div className="px-3 py-2 text-xs text-slate-400">Ничего не найдено</div>
                              )}
                            </Listbox.Options>
                          </div>
                        </Listbox>
                        <div className="mt-2 text-xs text-slate-400">
                          Автоматические цены рассчитываются по площади и глобальным ставкам колонизации.
                        </div>
                      </div>

                      {selectedProvince && (
                        <div className="space-y-4 rounded-lg border border-white/10 bg-black/25 p-3">
                          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-300">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                              <span>ID: <span className="text-slate-100">{selectedProvince.id}</span></span>
                              <span>
                                Площадь: <span className="text-slate-100">{new Intl.NumberFormat("ru-RU").format(Math.round(selectedProvince.areaKm2 ?? 0))} км²</span>
                              </span>
                            </div>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">Стоимость колонизации</label>
                              <input
                                type="number"
                                min={1}
                                value={provinceColonizationCost}
                                onChange={(e) => setProvinceColonizationCost(Math.max(1, Number(e.target.value) || 1))}
                                className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                              />
                              <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 ${
                                    selectedProvince.manualCost
                                      ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
                                      : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                                  }`}
                                >
                                  {selectedProvince.manualCost ? "Ручная цена" : "Авто (по площади)"}
                                </span>
                              </div>
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">Владелец</label>
                              <Listbox value={provinceOwnerCountryId} onChange={setProvinceOwnerCountryId}>
                                <div className="relative">
                                  <Listbox.Button className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 pr-10 text-left text-sm text-slate-100">
                                    {provinceOwnerCountryId ? (selectedProvinceOwner?.name ?? provinceOwnerCountryId) : "Нейтральная провинция"}
                                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                  </Listbox.Button>
                                  <Listbox.Options className="arc-scrollbar panel-border absolute z-30 mt-2 max-h-64 w-full overflow-auto rounded-lg bg-arc-panel/95 p-1 text-sm shadow-2xl outline-none">
                                    <Listbox.Option
                                      value=""
                                      className={({ active }) => `relative cursor-pointer rounded-md px-3 py-2 pr-9 transition ${active ? "bg-arc-accent/15 text-arc-accent" : "text-slate-300"}`}
                                    >
                                      {({ selected }) => (
                                        <>
                                          <span className={selected ? "text-arc-accent" : ""}>Нейтральная провинция</span>
                                          {selected && <Check size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-arc-accent" />}
                                        </>
                                      )}
                                    </Listbox.Option>
                                    {countries.map((country) => (
                                      <Listbox.Option
                                        key={country.id}
                                        value={country.id}
                                        className={({ active }) => `relative cursor-pointer rounded-md px-3 py-2 pr-9 transition ${active ? "bg-arc-accent/15 text-arc-accent" : "text-slate-300"}`}
                                      >
                                        {({ selected }) => (
                                          <>
                                            <div className="flex items-center gap-2">
                                              {country.flagUrl ? (
                                                <img src={country.flagUrl} alt="" className="h-4 w-5 rounded-sm object-cover" />
                                              ) : (
                                                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: country.color }} />
                                              )}
                                              <span className={selected ? "text-arc-accent" : ""}>{country.name}</span>
                                            </div>
                                            {selected && <Check size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-arc-accent" />}
                                          </>
                                        )}
                                      </Listbox.Option>
                                    ))}
                                  </Listbox.Options>
                                </div>
                              </Listbox>
                            </div>
                          </div>

                          <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                            <input
                              type="checkbox"
                              checked={provinceColonizationDisabled}
                              onChange={(e) => setProvinceColonizationDisabled(e.target.checked)}
                              className="accent-arc-accent"
                            />
                            Запретить колонизацию (прогресс будет сброшен)
                          </label>

                          <div className="rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-slate-300">
                            <div>Участников гонки: {Object.keys(selectedProvince.colonyProgressByCountry ?? {}).length}</div>
                            {Object.entries(selectedProvince.colonyProgressByCountry ?? {}).slice(0, 8).map(([countryId, progress]) => (
                              <div key={countryId} className="flex items-center justify-between">
                                <span>{countries.find((c) => c.id === countryId)?.name ?? countryId}</span>
                                <span>{progress.toFixed(1)}</span>
                              </div>
                            ))}
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={resetProvinceCostToAuto}
                              disabled={saving || !selectedProvince}
                              className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 transition hover:bg-emerald-400/15 disabled:opacity-60"
                            >
                              <RotateCcw size={14} />
                              Сбросить цену к авто (по площади)
                            </button>
                            <button onClick={saveProvince} disabled={saving} className="rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">
                              Сохранить провинцию
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {activeCategory === "notifications" && (
                    <div className="space-y-4 rounded-lg border border-white/10 bg-black/25 p-4">
                      <div className="flex items-center gap-2 text-sm text-slate-200">
                        <BellRing size={16} className="text-arc-accent" />
                        Рассылка UI-уведомления всем игрокам
                      </div>
                      <div className="text-xs text-slate-400">
                        Уведомления категории <span className="text-amber-300">registration</span> зарезервированы для заявок на регистрацию и по-прежнему отправляются только администраторам.
                      </div>

                      <div>
                        <label className="mb-1 block text-xs text-slate-300">Категория</label>
                        <Listbox value={broadcastCategory} onChange={setBroadcastCategory}>
                          <div className="relative">
                            <Listbox.Button className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 pr-10 text-left text-sm text-slate-100">
                              {broadcastCategory === "system" ? "Система" : broadcastCategory === "politics" ? "Политика" : "Экономика"}
                              <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            </Listbox.Button>
                            <Listbox.Options className="arc-scrollbar panel-border absolute z-30 mt-2 max-h-56 w-full overflow-auto rounded-lg bg-arc-panel/95 p-1 text-sm shadow-2xl outline-none">
                              {[
                                { id: "system", label: "Система" },
                                { id: "politics", label: "Политика" },
                                { id: "economy", label: "Экономика" },
                              ].map((option) => (
                                <Listbox.Option
                                  key={option.id}
                                  value={option.id}
                                  className={({ active }) => `relative cursor-pointer rounded-md px-3 py-2 pr-9 transition ${active ? "bg-arc-accent/15 text-arc-accent" : "text-slate-300"}`}
                                >
                                  {({ selected }) => (
                                    <>
                                      <span className={selected ? "text-arc-accent" : ""}>{option.label}</span>
                                      {selected && <Check size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-arc-accent" />}
                                    </>
                                  )}
                                </Listbox.Option>
                              ))}
                            </Listbox.Options>
                          </div>
                        </Listbox>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs text-slate-300">Заголовок</label>
                        <input
                          value={broadcastTitle}
                          onChange={(e) => setBroadcastTitle(e.target.value.slice(0, 120))}
                          placeholder="Например: Важное объявление"
                          className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100"
                        />
                        <div className="mt-1 text-[11px] text-slate-500">{broadcastTitle.length}/120</div>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs text-slate-300">Текст</label>
                        <textarea
                          value={broadcastMessage}
                          onChange={(e) => setBroadcastMessage(e.target.value.slice(0, 500))}
                          rows={4}
                          placeholder="Текст уведомления для всех игроков"
                          className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100"
                        />
                        <div className="mt-1 text-[11px] text-slate-500">{broadcastMessage.length}/500</div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={sendBroadcastNotification}
                          disabled={saving || !broadcastTitle.trim() || !broadcastMessage.trim()}
                          className="rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
                        >
                          Отправить уведомление всем
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setBroadcastTitle("");
                            setBroadcastMessage("");
                            setBroadcastCategory("system");
                          }}
                          disabled={saving}
                          className="rounded-lg bg-slate-600/20 px-4 py-2 text-sm font-semibold text-slate-200 disabled:opacity-60"
                        >
                          Очистить
                        </button>
                      </div>
                    </div>
                  )}

                  {activeCategory === "population" && (
                    <div className="space-y-4 rounded-lg border border-white/10 bg-black/25 p-4">
                      <div className="flex items-center gap-2 text-sm text-slate-200">
                        <Users size={16} className="text-arc-accent" />
                        Управление населением
                      </div>
                      <div className="text-xs text-slate-400">
                        Полное управление POP: генерация, создание, редактирование и удаление.
                      </div>

                      <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-300">
                        Всего POP: <span className="text-slate-100">{new Intl.NumberFormat("ru-RU").format(populationTotal)}</span>
                      </div>

                      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Охват провинций</div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setPopulationGenerateProvinceMode("all")}
                            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                              populationGenerateProvinceMode === "all"
                                ? "border-arc-accent/30 bg-arc-accent/10 text-arc-accent"
                                : "border-white/10 bg-black/25 text-slate-300 hover:text-white"
                            }`}
                          >
                            Все провинции мира
                          </button>
                          <button
                            type="button"
                            onClick={() => setPopulationGenerateProvinceMode("single")}
                            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                              populationGenerateProvinceMode === "single"
                                ? "border-arc-accent/30 bg-arc-accent/10 text-arc-accent"
                                : "border-white/10 bg-black/25 text-slate-300 hover:text-white"
                            }`}
                          >
                            Одна провинция
                          </button>
                        </div>
                        {populationGenerateProvinceMode === "single" && (
                          <div className="mt-3">
                            <label className="mb-1 block text-xs text-slate-300">Провинция для генерации</label>
                            <select
                              value={populationGenerateProvinceId}
                              onChange={(e) => setPopulationGenerateProvinceId(e.target.value)}
                              className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                            >
                              {provinces.map((province) => (
                                <option key={province.id} value={province.id}>{province.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>

                      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Комбинации культуры / религии / расы</div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setPopulationGenerateTraitsMode("random")}
                            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                              populationGenerateTraitsMode === "random"
                                ? "border-arc-accent/30 bg-arc-accent/10 text-arc-accent"
                                : "border-white/10 bg-black/25 text-slate-300 hover:text-white"
                            }`}
                          >
                            Случайные комбинации
                          </button>
                          <button
                            type="button"
                            onClick={() => setPopulationGenerateTraitsMode("fixed")}
                            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                              populationGenerateTraitsMode === "fixed"
                                ? "border-arc-accent/30 bg-arc-accent/10 text-arc-accent"
                                : "border-white/10 bg-black/25 text-slate-300 hover:text-white"
                            }`}
                          >
                            Фиксированные атрибуты
                          </button>
                        </div>
                        {populationGenerateTraitsMode === "fixed" && (
                          <div className="mt-3 grid gap-3 md:grid-cols-3">
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">Культура</label>
                              <select
                                value={populationGenerateCultureId}
                                onChange={(e) => setPopulationGenerateCultureId(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                              >
                                {contentCultures.map((entry) => (
                                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">Религия</label>
                              <select
                                value={populationGenerateReligionId}
                                onChange={(e) => setPopulationGenerateReligionId(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                              >
                                {contentReligions.map((entry) => (
                                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">Раса</label>
                              <select
                                value={populationGenerateRaceId}
                                onChange={(e) => setPopulationGenerateRaceId(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                              >
                                {contentRaces.map((entry) => (
                                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Количество</label>
                          <input
                            type="number"
                            min={1}
                            max={5000}
                            value={populationGenerateCount}
                            onChange={(e) => setPopulationGenerateCount(Math.max(1, Number(e.target.value) || 1))}
                            className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Min размер</label>
                          <input
                            type="number"
                            min={1}
                            value={populationGenerateMinSize}
                            onChange={(e) => setPopulationGenerateMinSize(Math.max(1, Number(e.target.value) || 1))}
                            className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Max размер</label>
                          <input
                            type="number"
                            min={1}
                            value={populationGenerateMaxSize}
                            onChange={(e) => setPopulationGenerateMaxSize(Math.max(1, Number(e.target.value) || 1))}
                            className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={generatePopulation}
                          disabled={saving}
                          className="rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
                        >
                          Сгенерировать население
                        </button>
                        <button
                          type="button"
                          onClick={clearPopulation}
                          disabled={saving}
                          className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-300 disabled:opacity-60"
                        >
                          Удалить всё население
                        </button>
                        <button
                          type="button"
                          onClick={createPopulationPop}
                          disabled={saving}
                          className="rounded-lg border border-arc-accent/30 bg-arc-accent/10 px-4 py-2 text-sm font-semibold text-arc-accent disabled:opacity-60"
                        >
                          Создать POP
                        </button>
                      </div>

                      <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
                        <div className="space-y-3">
                          <input
                            value={populationSearch}
                            onChange={(e) => setPopulationSearch(e.target.value)}
                            placeholder="Поиск POP по стране/провинции/ID"
                            className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100"
                          />
                          <div className="arc-scrollbar max-h-[420px] space-y-2 overflow-auto rounded-lg border border-white/10 bg-black/20 p-2">
                            {filteredPopulation.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => setSelectedPopulationId(item.id)}
                                className={`w-full rounded-md border px-2 py-2 text-left text-xs transition ${
                                  selectedPopulationId === item.id
                                    ? "border-arc-accent/50 bg-arc-accent/10 text-arc-accent"
                                    : "border-white/10 bg-black/25 text-slate-200 hover:border-white/25"
                                }`}
                              >
                                <div className="text-slate-100">{countries.find((country) => country.id === item.countryId)?.name ?? item.countryId}</div>
                                <div className="text-slate-400">{provinces.find((province) => province.id === item.provinceId)?.name ?? item.provinceId}</div>
                                <div className="text-slate-500">Размер: {new Intl.NumberFormat("ru-RU").format(item.size)}</div>
                              </button>
                            ))}
                            {filteredPopulation.length === 0 && <div className="text-xs text-slate-500">POP не найден</div>}
                          </div>
                        </div>

                        <div className="space-y-3 rounded-lg border border-white/10 bg-black/20 p-3">
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">Страна</label>
                              <select
                                value={populationDraft.countryId}
                                onChange={(e) => setPopulationDraft((prev) => ({ ...prev, countryId: e.target.value }))}
                                className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                              >
                                {countries.map((country) => (
                                  <option key={country.id} value={country.id}>{country.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">Провинция</label>
                              <select
                                value={populationDraft.provinceId}
                                onChange={(e) => setPopulationDraft((prev) => ({ ...prev, provinceId: e.target.value }))}
                                className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                              >
                                {provinces.map((province) => (
                                  <option key={province.id} value={province.id}>{province.name}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">Культура</label>
                              <select
                                value={populationDraft.cultureId}
                                onChange={(e) => setPopulationDraft((prev) => ({ ...prev, cultureId: e.target.value }))}
                                className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                              >
                                {contentCultures.map((entry) => (
                                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">Религия</label>
                              <select
                                value={populationDraft.religionId}
                                onChange={(e) => setPopulationDraft((prev) => ({ ...prev, religionId: e.target.value }))}
                                className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                              >
                                {contentReligions.map((entry) => (
                                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">Раса</label>
                              <select
                                value={populationDraft.raceId}
                                onChange={(e) => setPopulationDraft((prev) => ({ ...prev, raceId: e.target.value }))}
                                className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                              >
                                {contentRaces.map((entry) => (
                                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">Размер POP</label>
                              <input
                                type="number"
                                min={1}
                                value={populationDraft.size}
                                onChange={(e) => setPopulationDraft((prev) => ({ ...prev, size: Math.max(1, Number(e.target.value) || 1) }))}
                                className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                              />
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={savePopulationPop}
                              disabled={saving || !selectedPopulation}
                              className="rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
                            >
                              Сохранить POP
                            </button>
                            <button
                              type="button"
                              onClick={deletePopulationPop}
                              disabled={saving || !selectedPopulation}
                              className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-300 disabled:opacity-60"
                            >
                              Удалить POP
                            </button>
                          </div>

                          <div className="space-y-2 border-t border-white/10 pt-3">
                            {populationSummary.map((row) => (
                              <div key={row.countryId} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-300">
                                <div className="text-slate-100">{countries.find((c) => c.id === row.countryId)?.name ?? row.countryId}</div>
                                <div>POP: {new Intl.NumberFormat("ru-RU").format(row.popCount)}</div>
                                <div>Население: {new Intl.NumberFormat("ru-RU").format(row.totalSize)}</div>
                              </div>
                            ))}
                            {populationSummary.length === 0 && <div className="text-xs text-slate-500">Нет данных по населению</div>}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeCategory === "countries" && (
                  <>
                  <div>
                    <label className="mb-1 block text-xs text-slate-300">Страна</label>
                    <Listbox value={selectedCountryId} onChange={setSelectedCountryId}>
                      <div className="relative">
                        <Listbox.Button className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 pr-10 text-left text-sm text-slate-100">
                          {selectedCountry?.name ?? "Выберите страну"}
                          <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        </Listbox.Button>
                        <Listbox.Options className="arc-scrollbar panel-border absolute z-30 mt-2 max-h-56 w-full overflow-auto rounded-lg bg-arc-panel/95 p-1 text-sm shadow-2xl outline-none">
                          {countries.map((country) => (
                            <Listbox.Option
                              key={country.id}
                              value={country.id}
                              className={({ active }) => `relative cursor-pointer rounded-md px-3 py-2 pr-9 transition ${active ? "bg-arc-accent/15 text-arc-accent" : "text-slate-300"}`}
                            >
                              {({ selected }) => (
                                <>
                                  <span className={selected ? "text-arc-accent" : ""}>{country.name}</span>
                                  {selected && <Check size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-arc-accent" />}
                                </>
                              )}
                            </Listbox.Option>
                          ))}
                        </Listbox.Options>
                      </div>
                    </Listbox>
                  </div>

                  {selectedCountry && (
                    <>
                      {countrySection === "general" && (
                        <>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Название</label>
                          <input value={countryName} onChange={(e) => setCountryName(e.target.value)} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" />
                        </div>
                        <div>
                          <label className="mb-1 flex items-center gap-2 text-xs text-slate-300"><Palette size={13} /> Цвет</label>
                          <div className="flex items-center gap-2">
                            <input type="color" value={countryColor} onChange={(e) => setCountryColor(e.target.value)} className="panel-border h-10 w-12 rounded-lg bg-black/35 p-1" />
                            <input value={countryColor} onChange={(e) => setCountryColor(e.target.value)} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" />
                          </div>
                        </div>
                      </div>

                      <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                        <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} className="accent-arc-accent" />
                        Страна имеет права администратора
                      </label>

                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="panel-border flex cursor-pointer items-center gap-2 rounded-lg bg-black/35 px-3 py-2 text-sm text-slate-200 transition hover:border-arc-accent/40">
                          <Upload size={15} className="text-arc-accent" />
                          <span className="truncate">{flagFile ? flagFile.name : "Загрузить флаг"}</span>
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => setFlagFile(e.target.files?.[0] ?? null)} />
                        </label>
                        <label className="panel-border flex cursor-pointer items-center gap-2 rounded-lg bg-black/35 px-3 py-2 text-sm text-slate-200 transition hover:border-arc-accent/40">
                          <Upload size={15} className="text-arc-accent" />
                          <span className="truncate">{crestFile ? crestFile.name : "Загрузить герб"}</span>
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => setCrestFile(e.target.files?.[0] ?? null)} />
                        </label>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="panel-border rounded-lg bg-black/25 p-2">
                          <div className="mb-2 text-xs text-slate-400">Флаг</div>
                          <div className="h-24 rounded-md bg-black/35">
                            {flagPreviewUrl ? <img src={flagPreviewUrl} alt="flag" className="h-full w-full object-contain p-1" /> : <div className="flex h-full items-center justify-center text-xs text-slate-500">Нет</div>}
                          </div>
                        </div>
                        <div className="panel-border rounded-lg bg-black/25 p-2">
                          <div className="mb-2 text-xs text-slate-400">Герб</div>
                          <div className="h-24 rounded-md bg-black/35">
                            {crestPreviewUrl ? <img src={crestPreviewUrl} alt="crest" className="h-full w-full object-contain p-1" /> : <div className="flex h-full items-center justify-center text-xs text-slate-500">Нет</div>}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button onClick={saveCountry} disabled={saving} className="rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">
                          Сохранить изменения
                        </button>
                        <button onClick={deleteCountry} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-rose-600/20 px-4 py-2 text-sm font-semibold text-rose-300 disabled:opacity-60">
                          <Trash2 size={14} />
                          Удалить страну
                        </button>
                      </div>
                        </>
                      )}

                      {countrySection === "punishments" && (
                        <div className="space-y-4">
                          <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                            <div className="mb-2 text-[11px] uppercase tracking-wide text-white/45">Текущий статус</div>
                            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-200">
                              <span className="text-white/70">Состояние:</span>{" "}
                              <span className="font-medium text-arc-accent">{punishmentStatus}</span>
                            </div>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                            <div className="mb-3 text-[11px] uppercase tracking-wide text-white/45">Причина для игрока</div>
                            <label className="mb-1 block text-xs text-slate-300">Причина блокировки (необязательно)</label>
                            <textarea
                              value={punishmentReasonText}
                              onChange={(e) => setPunishmentReasonText(e.target.value.slice(0, 300))}
                              rows={3}
                              placeholder="Например: нарушение правил сервера"
                              className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-rose-400/30"
                            />
                            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                              <span>Будет показана игроку при попытке входа</span>
                              <span>{punishmentReasonText.length}/300</span>
                            </div>
                          </div>

                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                              <div className="mb-3 text-[11px] uppercase tracking-wide text-white/45">Блокировка по ходам</div>
                              <div className="flex flex-col gap-3">
                                <div className="w-full">
                                  <label className="mb-1 block text-xs text-slate-300">Количество ходов</label>
                                  <input
                                    type="number"
                                    min={1}
                                    value={turnsToBlock}
                                    onChange={(e) => setTurnsToBlock(Math.max(1, Number(e.target.value) || 1))}
                                    className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm outline-none transition focus:border-rose-400/30"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => applyPunishment({ action: "turns", turns: turnsToBlock })}
                                  disabled={saving}
                                  className="self-start rounded-lg border border-rose-400/20 bg-rose-600/20 px-3 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-600/25 disabled:opacity-60"
                                >
                                  Заблокировать
                                </button>
                              </div>
                            </div>

                            <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                              <div className="mb-3 text-[11px] uppercase tracking-wide text-white/45">Блокировка по времени</div>
                              <div className="flex flex-col gap-3">
                                <div>
                                  <label className="mb-1 block text-xs text-slate-300">До даты и времени</label>
                                  <input
                                    type="datetime-local"
                                    value={blockUntilAt}
                                    onChange={(e) => setBlockUntilAt(e.target.value)}
                                    className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm outline-none transition focus:border-rose-400/30"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => blockUntilAt && applyPunishment({ action: "time", blockedUntilAt: new Date(blockUntilAt).toISOString() })}
                                  disabled={saving || !blockUntilAt}
                                  className="self-start rounded-lg border border-rose-400/20 bg-rose-600/20 px-3 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-600/25 disabled:opacity-60"
                                >
                                  Заблокировать по времени
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                            <div className="mb-3 text-[11px] uppercase tracking-wide text-white/45">Быстрые действия</div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => applyPunishment({ action: "permanent" })}
                                disabled={saving}
                                className="rounded-lg border border-rose-400/25 bg-rose-700/25 px-3 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-700/35 disabled:opacity-60"
                              >
                                Перманентная блокировка
                              </button>
                              <button
                                type="button"
                                onClick={() => applyPunishment({ action: "unlock" })}
                                disabled={saving}
                                className="rounded-lg border border-emerald-400/25 bg-emerald-600/20 px-3 py-2 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-600/25 disabled:opacity-60"
                              >
                                Снять блокировку
                              </button>
                            </div>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                            <div className="mb-3 text-[11px] uppercase tracking-wide text-white/45">Исключение из ожидания хода</div>
                            <div className="mb-2 text-xs text-slate-400">
                              Страна не будет учитываться при проверке готовности к резолву до указанного хода включительно.
                            </div>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                              <div className="min-w-0 flex-1 sm:max-w-[220px]">
                                <label className="mb-1 block text-xs text-slate-300">До хода (включительно)</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={ignoreUntilTurn}
                                  onChange={(e) => setIgnoreUntilTurn(Math.max(0, Number(e.target.value) || 0))}
                                  className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm outline-none transition focus:border-amber-400/30"
                                />
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => saveIgnoreUntilTurn(ignoreUntilTurn <= 0 ? null : ignoreUntilTurn)}
                                  disabled={saving}
                                  className="rounded-lg border border-amber-400/20 bg-amber-600/20 px-3 py-2 text-sm font-semibold text-amber-300 transition hover:bg-amber-600/25 disabled:opacity-60"
                                >
                                  Применить исключение
                                </button>
                                <button
                                  type="button"
                                  onClick={() => saveIgnoreUntilTurn(null)}
                                  disabled={saving}
                                  className="rounded-lg border border-slate-400/20 bg-slate-600/20 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-600/30 disabled:opacity-60"
                                >
                                  Сбросить
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  </>
                  )}
                  </div>
                )}
              </section>
            </div>
          </div>
        </Dialog.Panel>
        </motion.div>
      </div>
    </Dialog>
  );
}
