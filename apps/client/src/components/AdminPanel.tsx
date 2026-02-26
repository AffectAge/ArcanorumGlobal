import { Dialog } from "@headlessui/react";
import { Listbox } from "@headlessui/react";
import { useEffect, useMemo, useState } from "react";
import { BellRing, Check, ChevronDown, Flag, Map as MapIcon, Palette, RotateCcw, Shield, Trash2, Upload, Users, X } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import type { Country } from "@arcanorum/shared";
import {
  adminFetchContentEntries,
  adminFetchPopulationTuning,
  adminBroadcastUiNotification,
  adminDeleteCountry,
  adminGeneratePopulationBaseline,
  adminResetProvinceColonizationCostToAuto,
  adminSetCountryPunishment,
  adminUpdatePopulationTuning,
  adminUpdateCountry,
  adminUpdateProvince,
  fetchAdminProvinces,
  fetchCountries,
  type AdminProvinceItem,
  type ContentEntry,
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
  { id: "population", label: "Население", icon: Users },
  { id: "notifications", label: "Рассылка уведомлений", icon: BellRing },
] as const;

export function AdminPanel({ open, token, currentCountryId, onClose, onSessionCountryUpdated, initialProvinceId }: Props) {
  const [activeCategory, setActiveCategory] = useState<(typeof categories)[number]["id"]>("countries");
  const [countrySection, setCountrySection] = useState<"general" | "punishments">("general");
  const [populationSection, setPopulationSection] = useState<"tuning" | "generation">("tuning");
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
  const [populationRaces, setPopulationRaces] = useState<ContentEntry[]>([]);
  const [populationCultures, setPopulationCultures] = useState<ContentEntry[]>([]);
  const [populationReligions, setPopulationReligions] = useState<ContentEntry[]>([]);
  const [populationProfessions, setPopulationProfessions] = useState<ContentEntry[]>([]);
  const [populationIdeologies, setPopulationIdeologies] = useState<ContentEntry[]>([]);
  const [popRaceId, setPopRaceId] = useState("");
  const [popCultureId, setPopCultureId] = useState("");
  const [popReligionId, setPopReligionId] = useState("");
  const [popProfessionId, setPopProfessionId] = useState("");
  const [popIdeologyId, setPopIdeologyId] = useState("");
  const [popPopulationPerProvince, setPopPopulationPerProvince] = useState(40000);
  const [popLowerSharePercent, setPopLowerSharePercent] = useState(78);
  const [popMiddleSharePercent, setPopMiddleSharePercent] = useState(18);
  const [popUpperSharePercent, setPopUpperSharePercent] = useState(4);
  const [popProvinceScope, setPopProvinceScope] = useState<"all" | "ownedOnly">("all");
  const [popReplaceExisting, setPopReplaceExisting] = useState(true);
  const [popBirthRateShiftPermille, setPopBirthRateShiftPermille] = useState(0);
  const [popDeathRateShiftPermille, setPopDeathRateShiftPermille] = useState(0);
  const [popMergeBucketWealthX100, setPopMergeBucketWealthX100] = useState(1000);
  const [popMergeBucketLoyalty, setPopMergeBucketLoyalty] = useState(100);
  const [popMergeBucketRadicalism, setPopMergeBucketRadicalism] = useState(100);
  const [popMergeBucketEmployment, setPopMergeBucketEmployment] = useState(100);
  const [popMergeBucketMigrationDesire, setPopMergeBucketMigrationDesire] = useState(100);
  const [popMergeBucketBirthRatePermille, setPopMergeBucketBirthRatePermille] = useState(5);
  const [popMergeBucketDeathRatePermille, setPopMergeBucketDeathRatePermille] = useState(5);

  const selectedCountry = useMemo(() => countries.find((c) => c.id === selectedCountryId) ?? null, [countries, selectedCountryId]);
  const selectedProvince = useMemo(() => provinces.find((p) => p.id === selectedProvinceId) ?? null, [provinces, selectedProvinceId]);
  const selectedProvinceOwner = useMemo(() => countries.find((c) => c.id === provinceOwnerCountryId) ?? null, [countries, provinceOwnerCountryId]);
  const filteredProvinces = useMemo(() => {
    const q = provinceSearch.trim().toLowerCase();
    if (!q) return provinces;
    return provinces.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  }, [provinceSearch, provinces]);

  const populationGenerationPreview = useMemo(() => {
    const targetProvinceCount = provinces.filter((p) => (popProvinceScope === "ownedOnly" ? Boolean(p.ownerCountryId) : true)).length;
    const populationPerProvince = Math.max(1, Math.floor(popPopulationPerProvince || 1));
    const totalPopulation = targetProvinceCount * populationPerProvince;
    const sumShares = popLowerSharePercent + popMiddleSharePercent + popUpperSharePercent;
    const popGroupsPerProvince = sumShares > 0 ? [popLowerSharePercent, popMiddleSharePercent, popUpperSharePercent].filter((v) => v > 0).length : 0;
    const estimatedPopGroups = targetProvinceCount * popGroupsPerProvince;
    return { targetProvinceCount, populationPerProvince, totalPopulation, sumShares, estimatedPopGroups };
  }, [provinces, popProvinceScope, popPopulationPerProvince, popLowerSharePercent, popMiddleSharePercent, popUpperSharePercent]);

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
      adminFetchContentEntries(token, "races"),
      adminFetchContentEntries(token, "cultures"),
      adminFetchContentEntries(token, "religions"),
      adminFetchContentEntries(token, "professions"),
      adminFetchContentEntries(token, "ideologies"),
      adminFetchPopulationTuning(token),
    ])
      .then(([countryList, provinceList, races, cultures, religions, professions, ideologies, populationTuning]) => {
        if (cancelled) {
          return;
        }
        setCountries(countryList);
        setProvinces(provinceList);
        setPopulationRaces(races);
        setPopulationCultures(cultures);
        setPopulationReligions(religions);
        setPopulationProfessions(professions);
        setPopulationIdeologies(ideologies);
        setPopRaceId((prev) => prev || races[0]?.id || "");
        setPopCultureId((prev) => prev || cultures[0]?.id || "");
        setPopReligionId((prev) => prev || religions[0]?.id || "");
        setPopProfessionId((prev) => prev || professions[0]?.id || "");
        setPopIdeologyId((prev) => prev || ideologies[0]?.id || "");
        setPopBirthRateShiftPermille(populationTuning.birthRateShiftPermille);
        setPopDeathRateShiftPermille(populationTuning.deathRateShiftPermille);
        setPopMergeBucketWealthX100(populationTuning.mergeBuckets?.wealthX100 ?? 1000);
        setPopMergeBucketLoyalty(populationTuning.mergeBuckets?.loyalty ?? 100);
        setPopMergeBucketRadicalism(populationTuning.mergeBuckets?.radicalism ?? 100);
        setPopMergeBucketEmployment(populationTuning.mergeBuckets?.employment ?? 100);
        setPopMergeBucketMigrationDesire(populationTuning.mergeBuckets?.migrationDesire ?? 100);
        setPopMergeBucketBirthRatePermille(populationTuning.mergeBuckets?.birthRatePermille ?? 5);
        setPopMergeBucketDeathRatePermille(populationTuning.mergeBuckets?.deathRatePermille ?? 5);
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

  const generatePopulationBaseline = async () => {
    if (!popRaceId || !popCultureId || !popReligionId || !popProfessionId || !popIdeologyId) {
      toast.error("Заполните справочники населения (раса/культура/религия/профессия/идеология)");
      return;
    }
    const sum = popLowerSharePercent + popMiddleSharePercent + popUpperSharePercent;
    if (sum <= 0) {
      toast.error("Сумма долей страт должна быть больше 0");
      return;
    }
    setSaving(true);
    try {
      const result = await adminGeneratePopulationBaseline(token, {
        raceId: popRaceId,
        cultureId: popCultureId,
        religionId: popReligionId,
        professionId: popProfessionId,
        ideologyId: popIdeologyId,
        populationPerProvince: Math.max(1, Math.floor(popPopulationPerProvince || 1)),
        lowerSharePercent: Math.max(0, Math.floor(popLowerSharePercent || 0)),
        middleSharePercent: Math.max(0, Math.floor(popMiddleSharePercent || 0)),
        upperSharePercent: Math.max(0, Math.floor(popUpperSharePercent || 0)),
        provinceScope: popProvinceScope,
        replaceExisting: popReplaceExisting,
      });
      toast.success(
        `Базовое население сгенерировано: провинций ${result.provincesAffected}, POP-групп ${result.popGroupCount}`,
      );
    } catch (err) {
      const code = err instanceof Error ? err.message : "ADMIN_POPULATION_GENERATE_FAILED";
      if (code.startsWith("INVALID_")) {
        toast.error("Проверьте выбранные справочники населения");
      } else {
        toast.error("Не удалось сгенерировать базовое население");
      }
    } finally {
      setSaving(false);
    }
  };

  const savePopulationTuning = async () => {
    setSaving(true);
    try {
      const tuning = await adminUpdatePopulationTuning(token, {
        birthRateShiftPermille: Math.max(-200, Math.min(200, Math.floor(popBirthRateShiftPermille || 0))),
        deathRateShiftPermille: Math.max(-200, Math.min(200, Math.floor(popDeathRateShiftPermille || 0))),
        mergeBuckets: {
          wealthX100: Math.max(1, Math.floor(popMergeBucketWealthX100 || 1)),
          loyalty: Math.max(1, Math.floor(popMergeBucketLoyalty || 1)),
          radicalism: Math.max(1, Math.floor(popMergeBucketRadicalism || 1)),
          employment: Math.max(1, Math.floor(popMergeBucketEmployment || 1)),
          migrationDesire: Math.max(1, Math.floor(popMergeBucketMigrationDesire || 1)),
          birthRatePermille: Math.max(1, Math.floor(popMergeBucketBirthRatePermille || 1)),
          deathRatePermille: Math.max(1, Math.floor(popMergeBucketDeathRatePermille || 1)),
        },
      });
      setPopBirthRateShiftPermille(tuning.birthRateShiftPermille);
      setPopDeathRateShiftPermille(tuning.deathRateShiftPermille);
      setPopMergeBucketWealthX100(tuning.mergeBuckets.wealthX100);
      setPopMergeBucketLoyalty(tuning.mergeBuckets.loyalty);
      setPopMergeBucketRadicalism(tuning.mergeBuckets.radicalism);
      setPopMergeBucketEmployment(tuning.mergeBuckets.employment);
      setPopMergeBucketMigrationDesire(tuning.mergeBuckets.migrationDesire);
      setPopMergeBucketBirthRatePermille(tuning.mergeBuckets.birthRatePermille);
      setPopMergeBucketDeathRatePermille(tuning.mergeBuckets.deathRatePermille);
      toast.success("Заглушка демографии сохранена");
    } catch {
      toast.error("Не удалось сохранить заглушку демографии");
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

              {activeCategory === "population" && (
                <div className="panel-border rounded-xl bg-black/25 p-3">
                  <div className="mb-2 px-1 text-[11px] uppercase tracking-wide text-white/45">Раздел населения</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setPopulationSection("tuning")}
                      className={`inline-flex items-center border-b px-1 py-1.5 text-xs font-medium transition ${
                        populationSection === "tuning"
                          ? "border-arc-accent text-arc-accent"
                          : "border-transparent text-slate-300 hover:text-white"
                      }`}
                    >
                      Демография и merge
                    </button>
                    <button
                      type="button"
                      onClick={() => setPopulationSection("generation")}
                      className={`inline-flex items-center border-b px-1 py-1.5 text-xs font-medium transition ${
                        populationSection === "generation"
                          ? "border-emerald-300 text-emerald-300"
                          : "border-transparent text-slate-300 hover:text-white"
                      }`}
                    >
                      Генерация базового населения
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

                  {activeCategory === "population" && (
                    <div className="space-y-4 rounded-lg border border-white/10 bg-black/25 p-4">
                      {populationSection === "tuning" && (
                      <div className="space-y-3 rounded-lg border border-white/10 bg-black/20 p-3">
                        <div className="flex items-center gap-2 text-sm text-slate-200">
                          <Users size={16} className="text-arc-accent" />
                          Заглушка демографии
                        </div>
                        <div className="text-xs text-slate-400">
                          Глобальный сдвиг рождаемости и смертности для всех POP-групп. Применяется на резолве хода.
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs text-slate-300">Сдвиг рождаемости (‰)</label>
                            <input
                              type="number"
                              min={-200}
                              max={200}
                              value={popBirthRateShiftPermille}
                              onChange={(e) => setPopBirthRateShiftPermille(Math.max(-200, Math.min(200, Number(e.target.value) || 0)))}
                              className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-slate-300">Сдвиг смертности (‰)</label>
                            <input
                              type="number"
                              min={-200}
                              max={200}
                              value={popDeathRateShiftPermille}
                              onChange={(e) => setPopDeathRateShiftPermille(Math.max(-200, Math.min(200, Number(e.target.value) || 0)))}
                              className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100"
                            />
                          </div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-black/15 p-3">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-300">Точная настройка merge-бакетов POP</div>
                          <div className="mb-3 text-[11px] text-slate-400">
                            Чем больше шаг, тем сильнее сжатие POP-групп и ниже нагрузка на сервер.
                          </div>
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">wealthX100</label>
                              <input type="number" min={1} value={popMergeBucketWealthX100} onChange={(e) => setPopMergeBucketWealthX100(Math.max(1, Number(e.target.value) || 1))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100" />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">loyalty</label>
                              <input type="number" min={1} max={1000} value={popMergeBucketLoyalty} onChange={(e) => setPopMergeBucketLoyalty(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100" />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">radicalism</label>
                              <input type="number" min={1} max={1000} value={popMergeBucketRadicalism} onChange={(e) => setPopMergeBucketRadicalism(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100" />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">employment</label>
                              <input type="number" min={1} max={1000} value={popMergeBucketEmployment} onChange={(e) => setPopMergeBucketEmployment(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100" />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">migrationDesire</label>
                              <input type="number" min={1} max={1000} value={popMergeBucketMigrationDesire} onChange={(e) => setPopMergeBucketMigrationDesire(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100" />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">birthRatePermille</label>
                              <input type="number" min={1} max={200} value={popMergeBucketBirthRatePermille} onChange={(e) => setPopMergeBucketBirthRatePermille(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100" />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">deathRatePermille</label>
                              <input type="number" min={1} max={200} value={popMergeBucketDeathRatePermille} onChange={(e) => setPopMergeBucketDeathRatePermille(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100" />
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={savePopulationTuning}
                            disabled={saving}
                            className="rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
                          >
                            Сохранить заглушку
                          </button>
                          <div className="text-xs text-slate-400">
                            {popBirthRateShiftPermille === popDeathRateShiftPermille
                              ? "Нейтрально: рост зависит от базовых ставок POP-групп"
                              : popBirthRateShiftPermille > popDeathRateShiftPermille
                                ? "Ожидается ускорение роста населения"
                                : "Ожидается замедление роста / спад населения"}
                          </div>
                        </div>
                      </div>
                      )}

                      {populationSection === "generation" && (
                      <>
                      <div className="flex items-center gap-2 text-sm text-slate-200">
                        <Users size={16} className="text-arc-accent" />
                        Генерация базового населения мира
                      </div>
                      <div className="text-xs text-slate-400">
                        Создаёт агрегированные POP-группы по провинциям с выбранными справочниками (раса, культура, религия, профессия, идеология).
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {[
                          ["Раса", popRaceId, setPopRaceId, populationRaces],
                          ["Культура", popCultureId, setPopCultureId, populationCultures],
                          ["Религия", popReligionId, setPopReligionId, populationReligions],
                          ["Профессия", popProfessionId, setPopProfessionId, populationProfessions],
                          ["Идеология", popIdeologyId, setPopIdeologyId, populationIdeologies],
                        ].map(([label, value, setter, items]) => (
                          <div key={String(label)}>
                            <label className="mb-1 block text-xs text-slate-300">{String(label)}</label>
                            <select
                              value={String(value)}
                              onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                              className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100"
                            >
                              {Array.isArray(items) && items.length > 0 ? (
                                items.map((entry) => (
                                  <option key={entry.id} value={entry.id}>
                                    {entry.name}
                                  </option>
                                ))
                              ) : (
                                <option value="">Нет записей</option>
                              )}
                            </select>
                          </div>
                        ))}
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Население на провинцию</label>
                          <input
                            type="number"
                            min={1}
                            value={popPopulationPerProvince}
                            onChange={(e) => setPopPopulationPerProvince(Math.max(1, Number(e.target.value) || 1))}
                            className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Низший %</label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={popLowerSharePercent}
                            onChange={(e) => setPopLowerSharePercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                            className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Средний %</label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={popMiddleSharePercent}
                            onChange={(e) => setPopMiddleSharePercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                            className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Высший %</label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={popUpperSharePercent}
                            onChange={(e) => setPopUpperSharePercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                            className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100"
                          />
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Область генерации</label>
                          <select
                            value={popProvinceScope}
                            onChange={(e) => setPopProvinceScope(e.target.value as "all" | "ownedOnly")}
                            className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100"
                          >
                            <option value="all">Все провинции мира</option>
                            <option value="ownedOnly">Только провинции с владельцем</option>
                          </select>
                        </div>
                        <label className="mt-6 inline-flex items-center gap-2 text-xs text-slate-300">
                          <input
                            type="checkbox"
                            checked={popReplaceExisting}
                            onChange={(e) => setPopReplaceExisting(e.target.checked)}
                            className="accent-arc-accent"
                          />
                          Заменить существующее население в выбранных провинциях
                        </label>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                          <div className="text-[11px] text-white/45">Провинций</div>
                          <div className="mt-1 text-sm font-semibold text-white">{new Intl.NumberFormat("ru-RU").format(populationGenerationPreview.targetProvinceCount)}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                          <div className="text-[11px] text-white/45">Население / провинция</div>
                          <div className="mt-1 text-sm font-semibold text-white">{new Intl.NumberFormat("ru-RU").format(populationGenerationPreview.populationPerProvince)}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                          <div className="text-[11px] text-white/45">Итого население (оценка)</div>
                          <div className="mt-1 text-sm font-semibold text-white">{new Intl.NumberFormat("ru-RU").format(populationGenerationPreview.totalPopulation)}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                          <div className="text-[11px] text-white/45">POP-групп (оценка)</div>
                          <div className="mt-1 text-sm font-semibold text-white">{new Intl.NumberFormat("ru-RU").format(populationGenerationPreview.estimatedPopGroups)}</div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-300">
                        Сумма долей: <span className="text-slate-100">{populationGenerationPreview.sumShares}%</span>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={generatePopulationBaseline}
                          disabled={saving}
                          className="rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
                        >
                          Сгенерировать базовое население
                        </button>
                      </div>
                      </>
                      )}
                    </div>
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

