import { Dialog } from "@headlessui/react";
import { Listbox } from "@headlessui/react";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Palette, Shield, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import type { Country } from "@arcanorum/shared";
import { adminDeleteCountry, adminSetCountryPunishment, adminUpdateCountry, adminUpdateProvince, fetchAdminProvinces, fetchCountries, type AdminProvinceItem } from "../lib/api";

type Props = {
  open: boolean;
  token: string;
  currentCountryId: string;
  onClose: () => void;
  onSessionCountryUpdated: (country: Country) => void;
  initialProvinceId?: string | null;
};

const categories = [
  { id: "countries", label: "Управление странами" },
  { id: "provinces", label: "Провинции / Колонизация" },
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
  const [ignoreUntilTurn, setIgnoreUntilTurn] = useState(0);
  const [selectedProvinceId, setSelectedProvinceId] = useState<string>("");
  const [provinceOwnerCountryId, setProvinceOwnerCountryId] = useState<string>("");
  const [provinceColonizationCost, setProvinceColonizationCost] = useState(100);
  const [provinceColonizationDisabled, setProvinceColonizationDisabled] = useState(false);
  const [provinceSearch, setProvinceSearch] = useState("");

  const selectedCountry = useMemo(() => countries.find((c) => c.id === selectedCountryId) ?? null, [countries, selectedCountryId]);
  const selectedProvince = useMemo(() => provinces.find((p) => p.id === selectedProvinceId) ?? null, [provinces, selectedProvinceId]);
  const selectedProvinceOwner = useMemo(() => countries.find((c) => c.id === provinceOwnerCountryId) ?? null, [countries, provinceOwnerCountryId]);
  const filteredProvinces = useMemo(() => {
    const q = provinceSearch.trim().toLowerCase();
    if (!q) return provinces;
    return provinces.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  }, [provinceSearch, provinces]);

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

    Promise.all([fetchCountries(), fetchAdminProvinces(token)])
      .then(([countryList, provinceList]) => {
        if (cancelled) {
          return;
        }
        setCountries(countryList);
        setProvinces(provinceList);
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
      const updated = await adminSetCountryPunishment(token, selectedCountry.id, payload);
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

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[120]">
      <div className="fixed inset-0 bg-black/55" aria-hidden="true" />
      <div className="fixed inset-0">
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
                  {cat.label}
                </button>
              ))}
            </aside>

            <section className="arc-scrollbar panel-border rounded-xl bg-black/25 p-4 overflow-auto">
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
                      </div>

                      {selectedProvince && (
                        <div className="space-y-4 rounded-lg border border-white/10 bg-black/25 p-3">
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

                          <div className="flex gap-2">
                            <button onClick={saveProvince} disabled={saving} className="rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">
                              Сохранить провинцию
                            </button>
                          </div>
                        </div>
                      )}
                    </>
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
                      <div className="flex gap-2 rounded-lg bg-black/30 p-1">
                        <button
                          type="button"
                          onClick={() => setCountrySection("general")}
                          className={`rounded-md px-3 py-1 text-xs transition ${countrySection === "general" ? "bg-arc-accent/20 text-arc-accent" : "text-slate-300 hover:text-white"}`}
                        >
                          Основная информация
                        </button>
                        <button
                          type="button"
                          onClick={() => setCountrySection("punishments")}
                          className={`rounded-md px-3 py-1 text-xs transition ${countrySection === "punishments" ? "bg-rose-500/20 text-rose-300" : "text-slate-300 hover:text-white"}`}
                        >
                          Наказания
                        </button>
                      </div>

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
                        <div className="space-y-4 rounded-lg border border-white/10 bg-black/25 p-3">
                          <div className="text-sm text-slate-200">Текущий статус: <span className="text-arc-accent">{punishmentStatus}</span></div>

                          <div className="flex flex-wrap items-end gap-2">
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">Блок на ходы</label>
                              <input
                                type="number"
                                min={1}
                                value={turnsToBlock}
                                onChange={(e) => setTurnsToBlock(Math.max(1, Number(e.target.value) || 1))}
                                className="w-28 rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => applyPunishment({ action: "turns", turns: turnsToBlock })}
                              disabled={saving}
                              className="rounded-lg bg-rose-600/20 px-3 py-2 text-sm font-semibold text-rose-300 disabled:opacity-60"
                            >
                              Заблокировать на ходы
                            </button>
                          </div>

                          <div className="flex flex-wrap items-end gap-2">
                            <div>
                              <label className="mb-1 block text-xs text-slate-300">Блок до времени</label>
                              <input
                                type="datetime-local"
                                value={blockUntilAt}
                                onChange={(e) => setBlockUntilAt(e.target.value)}
                                className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => blockUntilAt && applyPunishment({ action: "time", blockedUntilAt: new Date(blockUntilAt).toISOString() })}
                              disabled={saving || !blockUntilAt}
                              className="rounded-lg bg-rose-600/20 px-3 py-2 text-sm font-semibold text-rose-300 disabled:opacity-60"
                            >
                              Заблокировать по времени
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => applyPunishment({ action: "permanent" })}
                              disabled={saving}
                              className="rounded-lg bg-rose-700/30 px-3 py-2 text-sm font-semibold text-rose-300 disabled:opacity-60"
                            >
                              Перманентная блокировка
                            </button>
                            <button
                              type="button"
                              onClick={() => applyPunishment({ action: "unlock" })}
                              disabled={saving}
                              className="rounded-lg bg-emerald-600/20 px-3 py-2 text-sm font-semibold text-emerald-300 disabled:opacity-60"
                            >
                              Снять блокировку
                            </button>
                          </div>

                          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                            <div className="mb-2 text-xs text-slate-300">Не учитывать страну при ожидании пропуска хода</div>
                            <div className="flex flex-wrap items-end gap-2">
                              <div>
                                <label className="mb-1 block text-xs text-slate-400">До хода (включительно)</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={ignoreUntilTurn}
                                  onChange={(e) => setIgnoreUntilTurn(Math.max(0, Number(e.target.value) || 0))}
                                  className="w-36 rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => saveIgnoreUntilTurn(ignoreUntilTurn <= 0 ? null : ignoreUntilTurn)}
                                disabled={saving}
                                className="rounded-lg bg-amber-600/20 px-3 py-2 text-sm font-semibold text-amber-300 disabled:opacity-60"
                              >
                                Применить исключение
                              </button>
                              <button
                                type="button"
                                onClick={() => saveIgnoreUntilTurn(null)}
                                disabled={saving}
                                className="rounded-lg bg-slate-600/20 px-3 py-2 text-sm font-semibold text-slate-200 disabled:opacity-60"
                              >
                                Сбросить
                              </button>
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
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}

