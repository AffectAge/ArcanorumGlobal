import { Dialog } from "@headlessui/react";
import { motion } from "framer-motion";
import { Briefcase, Flame, Palette, ScrollText, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  adminCreateContentEntry,
  adminDeleteContentEntry,
  adminDeleteContentEntryLogo,
  adminDeleteRacePortrait,
  adminFetchContentEntries,
  adminUpdateContentEntry,
  adminUploadContentEntryLogo,
  adminUploadRacePortrait,
  type ContentEntry,
  type ContentEntryKind,
} from "../lib/api";
import { ContentEditorLayout } from "./ContentEditorLayout";

type Props = {
  open: boolean;
  token: string;
  onClose: () => void;
};

type EditableContentKind = "cultures" | "races" | "religions" | "professions" | "ideologies";
type ContentSectionId = "general" | "branding";

function SafePreviewImage({
  src,
  alt,
  className,
  fallback,
}: {
  src?: string | null;
  alt: string;
  className: string;
  fallback: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return <>{fallback}</>;
  }

  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}

const CONTENT_UI_SCHEMA = {
  categories: [
    {
      id: "cultures",
      label: "Культуры",
      icon: Palette,
      enabled: true,
      sections: [
        { id: "general", label: "Основная информация" },
        { id: "branding", label: "Логотип и стиль" },
      ] as const,
    },
    {
      id: "races",
      label: "Расы",
      icon: Sparkles,
      enabled: true,
      sections: [
        { id: "general", label: "Основная информация" },
        { id: "branding", label: "Логотип и стиль" },
      ] as const,
    },
    {
      id: "religions",
      label: "Религии",
      icon: ScrollText,
      enabled: true,
      sections: [
        { id: "general", label: "Основная информация" },
        { id: "branding", label: "Логотип и стиль" },
      ] as const,
    },
    {
      id: "professions",
      label: "Профессии",
      icon: Briefcase,
      enabled: true,
      sections: [
        { id: "general", label: "Основная информация" },
        { id: "branding", label: "Логотип и стиль" },
      ] as const,
    },
    {
      id: "ideologies",
      label: "Идеологии",
      icon: Flame,
      enabled: true,
      sections: [
        { id: "general", label: "Основная информация" },
        { id: "branding", label: "Логотип и стиль" },
      ] as const,
    },
    { id: "technologies", label: "Технологии (скоро)", icon: Sparkles, enabled: false, sections: [] as const },
  ] as const,
} as const;

const CONTENT_KIND_META: Record<EditableContentKind, {
  single: string;
  singleLower: string;
  plural: string;
  listTitle: string;
  searchPlaceholder: string;
  createLabel: string;
  emptyLetter: string;
  sectionSubtitle: string;
}> = {
  cultures: {
    single: "Культура",
    singleLower: "культура",
    plural: "Культуры",
    listTitle: "Список культур",
    searchPlaceholder: "Поиск культуры",
    createLabel: "Создать культуру",
    emptyLetter: "К",
    sectionSubtitle: "Раздел создания и редактирования культур",
  },
  races: {
    single: "Раса",
    singleLower: "раса",
    plural: "Расы",
    listTitle: "Список рас",
    searchPlaceholder: "Поиск расы",
    createLabel: "Создать расу",
    emptyLetter: "Р",
    sectionSubtitle: "Раздел создания и редактирования рас",
  },
  religions: {
    single: "Религия",
    singleLower: "религия",
    plural: "Религии",
    listTitle: "Список религий",
    searchPlaceholder: "Поиск религии",
    createLabel: "Создать религию",
    emptyLetter: "Р",
    sectionSubtitle: "Раздел создания и редактирования религий",
  },
  professions: {
    single: "Профессия",
    singleLower: "профессия",
    plural: "Профессии",
    listTitle: "Список профессий",
    searchPlaceholder: "Поиск профессии",
    createLabel: "Создать профессию",
    emptyLetter: "П",
    sectionSubtitle: "Раздел создания и редактирования профессий",
  },
  ideologies: {
    single: "Идеология",
    singleLower: "идеология",
    plural: "Идеологии",
    listTitle: "Список идеологий",
    searchPlaceholder: "Поиск идеологии",
    createLabel: "Создать идеологию",
    emptyLetter: "И",
    sectionSubtitle: "Раздел создания и редактирования идеологий",
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

async function validatePortrait89x100(file: File): Promise<void> {
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
        reject(new Error("PORTRAIT_TOO_LARGE"));
        return;
      }
      resolve();
    };
    img.onerror = () => reject(new Error("IMAGE_INVALID"));
    img.src = dataUrl;
  });
}

export function ContentPanel({ open, token, onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState<EditableContentKind>("cultures");
  const [entitySection, setEntitySection] = useState<ContentSectionId>("general");
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
  const [savedSnapshot, setSavedSnapshot] = useState<string>("");

  const activeMeta = CONTENT_KIND_META[activeCategory];

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((c) => c.name.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q));
  }, [entries, search]);

  const selectedEntry = useMemo(
    () => entries.find((c) => c.id === selectedEntryId) ?? null,
    [entries, selectedEntryId],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    adminFetchContentEntries(token, activeCategory as ContentEntryKind)
      .then((items) => {
        if (cancelled) return;
        setEntries(items);
        setSelectedEntryId((prev) => (items.some((x) => x.id === prev) ? prev : items[0]?.id || ""));
      })
      .catch(() => {
        if (!cancelled) toast.error(`Не удалось загрузить ${activeMeta.plural.toLowerCase()}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, token, activeCategory, activeMeta.plural]);

  useEffect(() => {
    if (!open) return;
    if (!selectedEntryId && entries[0]) {
      setSelectedEntryId(entries[0].id);
    }
  }, [open, entries, selectedEntryId]);

  useEffect(() => {
    if (!selectedEntry) {
      setDraftName("");
      setDraftDescription("");
      setDraftColor("#4ade80");
      setDraftLogoUrl(null);
      setDraftMalePortraitUrl(null);
      setDraftFemalePortraitUrl(null);
      setSavedSnapshot("");
      return;
    }
    setDraftName(selectedEntry.name);
    setDraftDescription(selectedEntry.description ?? "");
    setDraftColor(selectedEntry.color);
    setDraftLogoUrl(selectedEntry.logoUrl);
    setDraftMalePortraitUrl(selectedEntry.malePortraitUrl ?? null);
    setDraftFemalePortraitUrl(selectedEntry.femalePortraitUrl ?? null);
    setSavedSnapshot(JSON.stringify(selectedEntry));
  }, [selectedEntry]);

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedEntry) return false;
    return (
      JSON.stringify({
        id: selectedEntry.id,
        name: draftName.trim(),
        description: draftDescription.trim(),
        color: draftColor,
        logoUrl: draftLogoUrl,
        malePortraitUrl: draftMalePortraitUrl,
        femalePortraitUrl: draftFemalePortraitUrl,
      }) !== savedSnapshot
    );
  }, [
    draftColor,
    draftDescription,
    draftFemalePortraitUrl,
    draftLogoUrl,
    draftMalePortraitUrl,
    draftName,
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
      const nextNameBase = `Новая ${activeMeta.singleLower}`;
      let name = nextNameBase;
      let i = 2;
      const used = new Set(entries.map((c) => c.name.trim().toLowerCase()));
      while (used.has(name.toLowerCase())) {
        name = `${nextNameBase} ${i++}`;
      }
      const result = await adminCreateContentEntry(token, activeCategory as ContentEntryKind, {
        name,
        description: "",
        color: "#a78bfa",
      });
      setEntries(result.items);
      setSelectedEntryId(result.item.id);
      toast.success(`${activeMeta.single} создана`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "ADMIN_CREATE_CONTENT_ENTRY_FAILED";
      if (msg === "CULTURE_NAME_EXISTS" || msg === "CONTENT_NAME_EXISTS") {
        toast.error(`Название (${activeMeta.singleLower}) уже используется`);
      } else {
        toast.error(`Не удалось создать: ${activeMeta.singleLower}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const saveEntry = async () => {
    if (!selectedEntry) return;
    const name = draftName.trim();
    if (!name) {
      toast.error(`Введите название (${activeMeta.singleLower})`);
      return;
    }
    if (entries.some((c) => c.id !== selectedEntry.id && c.name.trim().toLowerCase() === name.toLowerCase())) {
      toast.error(`Название (${activeMeta.singleLower}) должно быть уникальным`);
      return;
    }
    const color = /^#[0-9A-Fa-f]{6}$/.test(draftColor) ? draftColor : "#4ade80";
    setSaving(true);
    try {
      const result = await adminUpdateContentEntry(token, activeCategory as ContentEntryKind, selectedEntry.id, {
        name,
        description: draftDescription.trim(),
        color,
      });
      setEntries(result.items);
      setSavedSnapshot(JSON.stringify(result.item));
      toast.success(`${activeMeta.single} сохранена`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "ADMIN_UPDATE_CONTENT_ENTRY_FAILED";
      if (msg === "CULTURE_NAME_EXISTS" || msg === "CONTENT_NAME_EXISTS") {
        toast.error(`Название (${activeMeta.singleLower}) уже используется`);
      } else {
        toast.error(`Не удалось сохранить: ${activeMeta.singleLower}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async () => {
    if (!selectedEntry) return;
    setSaving(true);
    try {
      const result = await adminDeleteContentEntry(token, activeCategory as ContentEntryKind, selectedEntry.id);
      setEntries(result.items);
      setSelectedEntryId(result.items[0]?.id ?? "");
      setDeleteConfirmOpen(false);
      toast.success(`${activeMeta.single} удалена`);
    } catch {
      toast.error(`Не удалось удалить: ${activeMeta.singleLower}`);
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File | null) => {
    if (!file || !selectedEntry) return;
    try {
      await validateLogo64(file);
      setSaving(true);
      const result = await adminUploadContentEntryLogo(token, activeCategory as ContentEntryKind, selectedEntry.id, file);
      setEntries(result.items);
      setDraftLogoUrl(result.item.logoUrl);
      setSavedSnapshot(JSON.stringify(result.item));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "LOGO_INVALID";
      if (msg === "LOGO_TOO_LARGE") toast.error("Логотип должен быть максимум 64x64");
      else if (msg === "IMAGE_DIMENSIONS_TOO_LARGE") toast.error("Логотип должен быть максимум 64x64");
      else toast.error("Не удалось загрузить логотип");
    } finally {
      setSaving(false);
    }
  };

  const uploadRacePortrait = async (slot: "male" | "female", file: File | null) => {
    if (!file || !selectedEntry || activeCategory !== "races") return;
    try {
      await validatePortrait89x100(file);
      setSaving(true);
      const result = await adminUploadRacePortrait(token, selectedEntry.id, slot, file);
      setEntries(result.items);
      setSavedSnapshot(JSON.stringify(result.item));
      setDraftMalePortraitUrl(result.item.malePortraitUrl ?? null);
      setDraftFemalePortraitUrl(result.item.femalePortraitUrl ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "PORTRAIT_INVALID";
      if (msg === "PORTRAIT_TOO_LARGE" || msg === "IMAGE_DIMENSIONS_TOO_LARGE") {
        toast.error("Портрет должен быть максимум 89x100");
      } else {
        toast.error("Не удалось загрузить портрет");
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteRacePortrait = async (slot: "male" | "female") => {
    if (!selectedEntry || activeCategory !== "races") return;
    try {
      setSaving(true);
      const result = await adminDeleteRacePortrait(token, selectedEntry.id, slot);
      setEntries(result.items);
      setSavedSnapshot(JSON.stringify(result.item));
      setDraftMalePortraitUrl(result.item.malePortraitUrl ?? null);
      setDraftFemalePortraitUrl(result.item.femalePortraitUrl ?? null);
    } catch {
      toast.error("Не удалось удалить портрет");
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
                <div className="mt-1 text-xs text-white/60">Создание и редактирование игрового контента</div>
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

            <ContentEditorLayout
              categories={CONTENT_UI_SCHEMA.categories.map((c) => ({ id: c.id, label: c.label, icon: c.icon, enabled: c.enabled }))}
              activeCategoryId={activeCategory}
              onCategorySelect={(id) => {
                const category = CONTENT_UI_SCHEMA.categories.find((c) => c.id === id);
                if (!category?.enabled || id === activeCategory || id === "technologies") return;
                setActiveCategory(id as EditableContentKind);
                setEntitySection("general");
                setSearch("");
              }}
              listTitle={activeMeta.listTitle}
              listSearchValue={search}
              onListSearchChange={setSearch}
              listSearchPlaceholder={activeMeta.searchPlaceholder}
              onCreateItem={() => void createEntry()}
              createItemLabel={activeMeta.createLabel}
              createItemDisabled={saving}
              listContent={
                loading ? (
                  <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/60">
                    Загрузка: {activeMeta.plural.toLowerCase()}...
                  </div>
                ) : (
                  filteredEntries.map((culture) => (
                    <button
                      key={culture.id}
                      type="button"
                      onClick={() => setSelectedEntryId(culture.id)}
                      className={`flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left transition ${
                        selectedEntryId === culture.id
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
                  ))
                )
              }
              sectionTabs={
                (CONTENT_UI_SCHEMA.categories.find((c) => c.id === activeCategory)?.sections ?? []).map((s) => ({ id: s.id, label: s.label }))
              }
              activeSectionId={entitySection}
              onSectionChange={(id) => setEntitySection(id as ContentSectionId)}
              headerTitle={selectedEntry ? selectedEntry.name : `Новая ${activeMeta.singleLower}`}
              headerSubtitle={activeMeta.sectionSubtitle}
              headerActions={
                <>
                  {hasUnsavedChanges && (
                    <span className="rounded-md border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
                      Есть несохранённые изменения
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void saveEntry()}
                    disabled={!selectedEntry || saving}
                    className="inline-flex h-10 items-center justify-center rounded-lg bg-arc-accent px-4 text-sm font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Сохранить
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmOpen(true)}
                    disabled={!selectedEntry || saving}
                    className="panel-border inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-rose-500/10 px-3 text-sm text-rose-300 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                    Удалить
                  </button>
                </>
              }
              editorContent={
                <div className="space-y-4">
                    {entitySection === "general" && (
                      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Основные данные</div>
                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
                          <label className="block">
                            <div className="mb-1 text-xs text-white/60">Название</div>
                            <input
                              value={draftName}
                              onChange={(e) => setDraftName(e.target.value)}
                              placeholder={`Название (${activeMeta.singleLower})`}
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
                        <label className="mt-4 block">
                          <div className="mb-1 text-xs text-white/60">Описание</div>
                          <textarea
                            value={draftDescription}
                            onChange={(e) => setDraftDescription(e.target.value)}
                            placeholder={`Краткое описание (${activeMeta.singleLower}) для механик и UI`}
                            maxLength={5000}
                            rows={5}
                            className="w-full resize-y rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/30"
                          />
                          <div className="mt-1 text-right text-[11px] text-white/45">{draftDescription.length}/5000</div>
                        </label>
                      </section>
                    )}

                    {entitySection === "branding" && (
                      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Логотип</div>
                        <div className="flex flex-wrap items-start gap-4">
                          <div className="flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[#131a22]">
                            {draftLogoUrl ? (
                              <img src={draftLogoUrl} alt={`Логотип (${activeMeta.singleLower})`} className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-xs font-semibold" style={{ color: draftColor }}>
                                {draftName.trim().slice(0, 1).toUpperCase() || activeMeta.emptyLetter}
                              </span>
                            )}
                          </div>
                          <div className="min-w-[220px] flex-1">
                            <div className="flex min-h-[88px] flex-col justify-center gap-2">
                              <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-arc-accent px-3 text-sm font-semibold text-black transition hover:brightness-110">
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
                                  if (!selectedEntry) return;
                                  try {
                                    setSaving(true);
                                    const result = await adminDeleteContentEntryLogo(
                                      token,
                                      activeCategory as ContentEntryKind,
                                      selectedEntry.id,
                                    );
                                    setEntries(result.items);
                                    setDraftLogoUrl(result.item.logoUrl);
                                    setSavedSnapshot(JSON.stringify(result.item));
                                  } catch {
                                    toast.error("Не удалось удалить логотип");
                                  } finally {
                                    setSaving(false);
                                  }
                                }}
                                disabled={!selectedEntry || saving}
                                className="panel-border inline-flex h-10 items-center justify-center rounded-lg bg-rose-500/10 px-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Удалить логотип
                              </button>
                            </div>
                            <div className="text-xs text-white/50">Максимум 64x64. Рекомендуется PNG или SVG.</div>
                          </div>
                        </div>

                        {activeCategory === "races" && (
                          <>
                            <div className="my-4 h-px bg-white/10" />
                            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                              Портреты расы
                            </div>
                            <div className="grid gap-4 lg:grid-cols-2">
                              {([
                                { slot: "male", label: "Портрет мужчины", url: draftMalePortraitUrl },
                                { slot: "female", label: "Портрет женщины", url: draftFemalePortraitUrl },
                              ] as const).map((portrait) => (
                                <div key={portrait.slot} className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                                  <div className="mb-2 text-xs text-white/65">{portrait.label}</div>
                                  <div className="flex gap-3">
                                    <div className="flex h-[112px] w-[112px] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/20">
                                      {portrait.url ? (
                                        <SafePreviewImage
                                          src={portrait.url}
                                          alt={portrait.label}
                                          className="h-full w-full object-contain"
                                          fallback={<span className="text-xs text-white/45">Нет</span>}
                                        />
                                      ) : (
                                        <span className="text-xs text-white/45">Нет</span>
                                      )}
                                    </div>
                                    <div className="flex min-h-[112px] min-w-0 flex-1 flex-col justify-center gap-2">
                                      <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-arc-accent px-3 text-sm font-semibold text-black transition hover:brightness-110">
                                        <Upload size={14} />
                                        Загрузить
                                        <input
                                          type="file"
                                          accept="image/png,image/webp,image/jpeg"
                                          className="hidden"
                                          onChange={(e) => void uploadRacePortrait(portrait.slot, e.target.files?.[0] ?? null)}
                                        />
                                      </label>
                                      <button
                                        type="button"
                                        onClick={() => void deleteRacePortrait(portrait.slot)}
                                        disabled={saving || !selectedEntry}
                                        className="panel-border inline-flex h-10 items-center justify-center rounded-lg bg-rose-500/10 px-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        Удалить
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="mt-2 text-xs text-white/50">Портреты: максимум 89x100. Рекомендуется PNG/JPG/WebP.</div>
                          </>
                        )}
                      </section>
                    )}
                </div>
              }
              previewContent={
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
                                {draftName.trim().slice(0, 1).toUpperCase() || activeMeta.emptyLetter}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm text-white">{draftName.trim() || `Название (${activeMeta.singleLower})`}</div>
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
                          {draftName.trim() || `Название (${activeMeta.singleLower})`}
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
                                  {draftName.trim().slice(0, 1).toUpperCase() || activeMeta.emptyLetter}
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm text-white">Пример страны</div>
                              <div className="mt-1 inline-flex items-center gap-2 rounded-full border px-2 py-1 text-[10px]" style={{ borderColor: `${draftColor}66`, color: draftColor, background: `${draftColor}10` }}>
                                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: draftColor }} />
                                {draftName.trim() || activeMeta.single}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                        <div className="mb-2 text-[11px] text-white/50">Описание</div>
                        <div className="text-xs leading-5 text-white/75">
                          {draftDescription.trim() || `Описание (${activeMeta.singleLower}) будет отображаться здесь.`}
                        </div>
                      </div>
                      {activeCategory === "races" && (
                        <div className="rounded-xl border border-white/10 bg-[#131a22] p-3">
                          <div className="mb-2 text-[11px] text-white/50">Портреты</div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                              <div className="mb-1 text-[10px] text-white/50">Мужчина</div>
                              <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md border border-white/10 bg-black/20">
                                {draftMalePortraitUrl ? (
                                  <SafePreviewImage
                                    src={draftMalePortraitUrl}
                                    alt="Портрет мужчины"
                                    className="h-full w-full object-contain"
                                    fallback={<span className="text-[10px] text-white/40">Нет</span>}
                                  />
                                ) : (
                                  <span className="text-[10px] text-white/40">Нет</span>
                                )}
                              </div>
                            </div>
                            <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                              <div className="mb-1 text-[10px] text-white/50">Женщина</div>
                              <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md border border-white/10 bg-black/20">
                                {draftFemalePortraitUrl ? (
                                  <SafePreviewImage
                                    src={draftFemalePortraitUrl}
                                    alt="Портрет женщины"
                                    className="h-full w-full object-contain"
                                    fallback={<span className="text-[10px] text-white/40">Нет</span>}
                                  />
                                ) : (
                                  <span className="text-[10px] text-white/40">Нет</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                </div>
              }
            />
          </Dialog.Panel>
        </motion.div>
      </div>

      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} className="relative z-[206]">
        <motion.div aria-hidden="true" className="fixed inset-0 bg-black/55 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
        <div className="fixed inset-0 z-[207] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.99 }} className="w-full max-w-md">
            <Dialog.Panel className="glass panel-border rounded-2xl bg-[#0b111b] p-4 shadow-2xl">
              <Dialog.Title className="text-base font-semibold text-white">Удалить {activeMeta.singleLower}?</Dialog.Title>
              <div className="mt-2 text-sm text-white/70">
                {activeMeta.single} <span className="font-semibold text-white">«{selectedEntry?.name ?? "Без названия"}»</span> будет удалена.
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
              <div className="mt-2 text-sm text-white/70">Есть несохранённые изменения в выбранном элементе контента.</div>
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
