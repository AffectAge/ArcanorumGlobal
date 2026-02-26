import { Dialog } from "@headlessui/react";
import { motion } from "framer-motion";
import { Palette, Plus, ScrollText, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  adminCreateCulture,
  adminDeleteCulture,
  adminDeleteCultureLogo,
  adminFetchContentCultures,
  adminUpdateCulture,
  adminUploadCultureLogo,
  type ContentCulture,
} from "../lib/api";

type Props = {
  open: boolean;
  token: string;
  onClose: () => void;
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

export function ContentPanel({ open, token, onClose }: Props) {
  const [activeCategory] = useState<"cultures">("cultures");
  const [cultureSection, setCultureSection] = useState<"general" | "branding">("general");
  const [cultures, setCultures] = useState<ContentCulture[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCultureId, setSelectedCultureId] = useState<string>("");
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState("#4ade80");
  const [draftLogoUrl, setDraftLogoUrl] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string>("");

  const filteredCultures = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cultures;
    return cultures.filter((c) => c.name.toLowerCase().includes(q));
  }, [cultures, search]);

  const selectedCulture = useMemo(
    () => cultures.find((c) => c.id === selectedCultureId) ?? null,
    [cultures, selectedCultureId],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    adminFetchContentCultures(token)
      .then((items) => {
        if (cancelled) return;
        setCultures(items);
        setSelectedCultureId((prev) => prev || items[0]?.id || "");
      })
      .catch(() => {
        if (!cancelled) toast.error("Не удалось загрузить культуры");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, token]);

  useEffect(() => {
    if (!open) return;
    if (!selectedCultureId && cultures[0]) {
      setSelectedCultureId(cultures[0].id);
    }
  }, [open, cultures, selectedCultureId]);

  useEffect(() => {
    if (!selectedCulture) {
      setDraftName("");
      setDraftColor("#4ade80");
      setDraftLogoUrl(null);
      setSavedSnapshot("");
      return;
    }
    setDraftName(selectedCulture.name);
    setDraftColor(selectedCulture.color);
    setDraftLogoUrl(selectedCulture.logoUrl);
    setSavedSnapshot(JSON.stringify(selectedCulture));
  }, [selectedCulture]);

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedCulture) return false;
    return (
      JSON.stringify({
        id: selectedCulture.id,
        name: draftName.trim(),
        color: draftColor,
        logoUrl: draftLogoUrl,
      }) !== savedSnapshot
    );
  }, [draftColor, draftLogoUrl, draftName, savedSnapshot, selectedCulture]);

  const createCulture = async () => {
    setSaving(true);
    try {
      const nextNameBase = "Новая культура";
      let name = nextNameBase;
      let i = 2;
      const used = new Set(cultures.map((c) => c.name.trim().toLowerCase()));
      while (used.has(name.toLowerCase())) {
        name = `${nextNameBase} ${i++}`;
      }
      const result = await adminCreateCulture(token, { name, color: "#a78bfa" });
      setCultures(result.cultures);
      setSelectedCultureId(result.culture.id);
      toast.success("Культура создана");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "ADMIN_CREATE_CULTURE_FAILED";
      if (msg === "CULTURE_NAME_EXISTS") toast.error("Название культуры уже используется");
      else toast.error("Не удалось создать культуру");
    } finally {
      setSaving(false);
    }
  };

  const saveCulture = async () => {
    if (!selectedCulture) return;
    const name = draftName.trim();
    if (!name) {
      toast.error("Введите название культуры");
      return;
    }
    if (cultures.some((c) => c.id !== selectedCulture.id && c.name.trim().toLowerCase() === name.toLowerCase())) {
      toast.error("Название культуры должно быть уникальным");
      return;
    }
    const color = /^#[0-9A-Fa-f]{6}$/.test(draftColor) ? draftColor : "#4ade80";
    setSaving(true);
    try {
      const result = await adminUpdateCulture(token, selectedCulture.id, { name, color });
      setCultures(result.cultures);
      setSavedSnapshot(JSON.stringify(result.culture));
      toast.success("Культура сохранена");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "ADMIN_UPDATE_CULTURE_FAILED";
      if (msg === "CULTURE_NAME_EXISTS") toast.error("Название культуры уже используется");
      else toast.error("Не удалось сохранить культуру");
    } finally {
      setSaving(false);
    }
  };

  const deleteCulture = async () => {
    if (!selectedCulture) return;
    setSaving(true);
    try {
      const result = await adminDeleteCulture(token, selectedCulture.id);
      setCultures(result.cultures);
      setSelectedCultureId(result.cultures[0]?.id ?? "");
      toast.success("Культура удалена");
    } catch {
      toast.error("Не удалось удалить культуру");
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File | null) => {
    if (!file || !selectedCulture) return;
    try {
      await validateLogo64(file);
      setSaving(true);
      const result = await adminUploadCultureLogo(token, selectedCulture.id, file);
      setCultures(result.cultures);
      setDraftLogoUrl(result.culture.logoUrl);
      setSavedSnapshot(JSON.stringify(result.culture));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "LOGO_INVALID";
      if (msg === "LOGO_TOO_LARGE") toast.error("Логотип должен быть максимум 64x64");
      else if (msg === "IMAGE_DIMENSIONS_TOO_LARGE") toast.error("Логотип должен быть максимум 64x64");
      else toast.error("Не удалось загрузить логотип");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[205]">
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
                <div className="mt-1 text-xs text-white/60">Создание и редактирование игрового контента</div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="panel-border inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-slate-300 transition hover:text-arc-accent"
                aria-label="Закрыть"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
              <aside className="min-h-0 rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Категории</div>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg border border-arc-accent/30 bg-arc-accent/10 px-3 py-2 text-left text-sm text-arc-accent"
                >
                  <Palette size={15} />
                  <span>Культуры</span>
                </button>
                <div className="mt-2 space-y-2">
                  <button type="button" disabled className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-left text-sm text-white/35">
                    <ScrollText size={15} />
                    <span>Религии (скоро)</span>
                  </button>
                  <button type="button" disabled className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-left text-sm text-white/35">
                    <Sparkles size={15} />
                    <span>Технологии (скоро)</span>
                  </button>
                </div>

              </aside>

              <div className="grid min-h-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                <section className="min-h-0 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Список культур</div>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Поиск культуры"
                    className="mb-2 w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/30"
                  />
                  <button
                    type="button"
                    onClick={() => void createCulture()}
                    disabled={saving}
                    className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-arc-accent px-3 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
                  >
                    <Plus size={15} />
                    Создать культуру
                  </button>

                  <div className="arc-scrollbar max-h-[calc(100%-6.75rem)] space-y-2 overflow-auto pr-1">
                    {loading ? (
                      <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/60">Загрузка культур...</div>
                    ) : filteredCultures.map((culture) => (
                      <button
                        key={culture.id}
                        type="button"
                        onClick={() => setSelectedCultureId(culture.id)}
                        className={`flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left transition ${
                          selectedCultureId === culture.id
                            ? "border-arc-accent/30 bg-arc-accent/10"
                            : "border-white/10 bg-black/20 hover:border-white/15"
                        }`}
                      >
                        <div
                          className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-[#131a22]"
                          style={{ boxShadow: `0 0 0 1px ${culture.color}33 inset` }}
                        >
                          {culture.logoUrl ? (
                            <img src={culture.logoUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-xs font-semibold" style={{ color: culture.color }}>
                              {culture.name.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-white">{culture.name}</div>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="inline-block h-2.5 w-2.5 rounded-full border border-white/20" style={{ backgroundColor: culture.color }} />
                            <span className="text-[10px] text-white/50">{culture.color}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>

                <div className="grid min-h-0 gap-4 lg:grid-rows-[auto_auto_minmax(0,1fr)]">
                <div className="flex items-center gap-5 border-b border-white/10 px-1">
                  <button
                    type="button"
                    onClick={() => setCultureSection("general")}
                    className={`pb-2 text-sm transition ${
                      cultureSection === "general"
                        ? "border-b-2 border-arc-accent text-arc-accent"
                        : "border-b-2 border-transparent text-white/60 hover:text-white"
                    }`}
                  >
                    Основная информация
                  </button>
                  <button
                    type="button"
                    onClick={() => setCultureSection("branding")}
                    className={`pb-2 text-sm transition ${
                      cultureSection === "branding"
                        ? "border-b-2 border-arc-accent text-arc-accent"
                        : "border-b-2 border-transparent text-white/60 hover:text-white"
                    }`}
                  >
                    Логотип и стиль
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{selectedCulture ? selectedCulture.name : "Новая культура"}</div>
                    <div className="mt-1 text-xs text-white/55">
                      {activeCategory === "cultures" ? "Раздел создания и редактирования культур" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasUnsavedChanges && (
                      <span className="rounded-md border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
                        Есть несохранённые изменения
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void saveCulture()}
                      disabled={!selectedCulture || saving}
                      className="inline-flex h-10 items-center justify-center rounded-lg bg-arc-accent px-4 text-sm font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Сохранить
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteCulture()}
                      disabled={!selectedCulture || saving}
                      className="panel-border inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-rose-500/10 px-3 text-sm text-rose-300 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                      Удалить
                    </button>
                  </div>
                </div>

                <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="arc-scrollbar min-h-0 space-y-4 overflow-auto pr-1">
                    {cultureSection === "general" && (
                      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Основные данные</div>
                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
                          <label className="block">
                            <div className="mb-1 text-xs text-white/60">Название</div>
                            <input
                              value={draftName}
                              onChange={(e) => setDraftName(e.target.value)}
                              placeholder="Название культуры"
                              className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/30"
                            />
                          </label>
                          <div>
                            <div className="mb-1 text-xs text-white/60">Цвет</div>
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
                      </section>
                    )}

                    {cultureSection === "branding" && (
                      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Логотип</div>
                        <div className="flex flex-wrap items-start gap-4">
                          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[#131a22]">
                            {draftLogoUrl ? (
                              <img src={draftLogoUrl} alt="Логотип культуры" className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-xs font-semibold" style={{ color: draftColor }}>
                                {draftName.trim().slice(0, 1).toUpperCase() || "К"}
                              </span>
                            )}
                          </div>
                          <div className="flex min-w-[220px] flex-1 flex-col gap-2">
                            <label className="panel-border inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-white/5 px-3 text-sm text-white transition hover:text-arc-accent">
                              <Upload size={14} />
                              Загрузить логотип
                              <input
                                type="file"
                                accept="image/png,image/svg+xml,image/webp,image/jpeg"
                                className="hidden"
                                onChange={(e) => void uploadLogo(e.target.files?.[0] ?? null)}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!selectedCulture) return;
                                try {
                                  setSaving(true);
                                  const result = await adminDeleteCultureLogo(token, selectedCulture.id);
                                  setCultures(result.cultures);
                                  setDraftLogoUrl(result.culture.logoUrl);
                                  setSavedSnapshot(JSON.stringify(result.culture));
                                } catch {
                                  toast.error("Не удалось удалить логотип");
                                } finally {
                                  setSaving(false);
                                }
                              }}
                              disabled={!selectedCulture || saving}
                              className="panel-border inline-flex h-10 items-center justify-center rounded-lg bg-white/5 px-3 text-sm text-white/80 transition hover:text-rose-300"
                            >
                              Удалить логотип
                            </button>
                            <div className="text-xs text-white/50">Максимум 64x64. Рекомендуется PNG или SVG.</div>
                          </div>
                        </div>
                      </section>
                    )}
                  </div>

                  <aside className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Предпросмотр</div>
                    <div className="space-y-3">
                      <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                        <div className="mb-2 text-[11px] text-white/50">Плашка культуры</div>
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
                            <div className="truncate text-sm text-white">{draftName.trim() || "Название культуры"}</div>
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
                          {draftName.trim() || "Название культуры"}
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
    </Dialog>
  );
}
