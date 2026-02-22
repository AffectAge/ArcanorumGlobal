import { Dialog } from "@headlessui/react";
import { motion } from "framer-motion";
import {
  BookOpen,
  Flag,
  Globe,
  Landmark,
  ListChecks,
  Plus,
  Save,
  Search,
  Timer,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  fetchAdminCivilopedia,
  fetchCivilopedia,
  type CivilopediaEntry,
  updateAdminCivilopedia,
  uploadCivilopediaImage,
  uploadCivilopediaInlineImage,
} from "../lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  isAdmin?: boolean;
  adminToken?: string | null;
  initialIntent?:
    | { type: "open-entry"; entryId: string }
    | { type: "province"; provinceId: string; provinceName: string; createIfMissing: boolean }
    | null;
  onIntentHandled?: () => void;
};

type KnownCategoryId = "basics" | "colonization" | "map" | "turns" | "journal" | "economy";

const CATEGORY_META: Record<KnownCategoryId, { label: string; icon: LucideIcon }> = {
  basics: { label: "Основы", icon: BookOpen },
  colonization: { label: "Колонизация", icon: Flag },
  map: { label: "Карта", icon: Globe },
  turns: { label: "Ходы и таймер", icon: Timer },
  journal: { label: "Журнал событий", icon: ListChecks },
  economy: { label: "Ресурсы и экономика", icon: Landmark },
};

const categoryOrder: KnownCategoryId[] = ["basics", "colonization", "map", "turns", "journal", "economy"];

function getCategoryMeta(category: string): { label: string; icon: LucideIcon } {
  return CATEGORY_META[category as KnownCategoryId] ?? { label: category || "Другое", icon: BookOpen };
}

function makeEmptyEntry(): CivilopediaEntry {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 10)}`,
    category: "basics",
    title: "Новая статья",
    summary: "",
    keywords: [],
    imageUrl: null,
    relatedEntryIds: [],
    sections: [{ title: "Содержание", paragraphs: [""] }],
  };
}

type DraftState = {
  id: string;
  category: string;
  title: string;
  summary: string;
  keywordsCsv: string;
  relatedCsv: string;
  imageUrl: string;
  sectionsJson: string;
};

function toDraft(entry: CivilopediaEntry): DraftState {
  return {
    id: entry.id,
    category: entry.category,
    title: entry.title,
    summary: entry.summary,
    keywordsCsv: entry.keywords.join(", "),
    relatedCsv: entry.relatedEntryIds.join(", "),
    imageUrl: entry.imageUrl ?? "",
    sectionsJson: JSON.stringify(entry.sections, null, 2),
  };
}

function fromDraft(draft: DraftState, fallback?: CivilopediaEntry): CivilopediaEntry {
  let sections = fallback?.sections ?? [{ title: "Содержание", paragraphs: [""] }];
  try {
    const parsed = JSON.parse(draft.sectionsJson) as unknown;
    if (Array.isArray(parsed)) {
      const normalized = parsed
        .map((raw) => {
          if (!raw || typeof raw !== "object") return null;
          const r = raw as Record<string, unknown>;
          const title = typeof r.title === "string" && r.title.trim() ? r.title.trim() : "Раздел";
          const paragraphs = Array.isArray(r.paragraphs)
            ? r.paragraphs.filter((p): p is string => typeof p === "string").map((p) => p.trim()).filter(Boolean)
            : [];
          if (paragraphs.length === 0) return null;
          return { title, paragraphs };
        })
        .filter((v): v is { title: string; paragraphs: string[] } => Boolean(v));
      if (normalized.length > 0) sections = normalized;
    }
  } catch {
    // keep previous sections
  }
  return {
    id: draft.id.trim() || fallback?.id || makeEmptyEntry().id,
    category: draft.category.trim() || "basics",
    title: draft.title.trim() || "Без названия",
    summary: draft.summary.trim(),
    keywords: draft.keywordsCsv
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    imageUrl: draft.imageUrl.trim() || null,
    relatedEntryIds: draft.relatedCsv
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    sections,
  };
}

export function CivilopediaModal({
  open,
  onClose,
  isAdmin = false,
  adminToken = null,
  initialIntent = null,
  onIntentHandled,
}: Props) {
  const [entries, setEntries] = useState<CivilopediaEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("basics");
  const [selectedEntryId, setSelectedEntryId] = useState("");
  const [adminEditMode, setAdminEditMode] = useState(false);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [loadedSessionKey, setLoadedSessionKey] = useState<string | null>(null);
  const [newCategoryInput, setNewCategoryInput] = useState("");
  const [inlineTokenHint, setInlineTokenHint] = useState("");

  const sessionKey = isAdmin && adminToken ? `admin:${adminToken}` : "public";

  useEffect(() => {
    if (!open) return;
    if (loadedSessionKey === sessionKey && entries.length > 0) return;
    let cancelled = false;
    setLoading(true);
    const loader = isAdmin && adminToken ? fetchAdminCivilopedia(adminToken) : fetchCivilopedia();
    loader
      .then((data) => {
        if (cancelled) return;
        setEntries(data.entries);
        setCategories(data.categories);
        setLoadedSessionKey(sessionKey);
        if (data.entries.length > 0) {
          setSelectedEntryId((prev) => prev || data.entries[0].id);
          setActiveCategory((prev) => prev || data.entries[0].category);
        }
      })
      .catch(() => {
        if (!cancelled) toast.error("Не удалось загрузить Хранилище знаний");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isAdmin, adminToken, loadedSessionKey, sessionKey, entries.length]);

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (activeCategory && entry.category !== activeCategory) return false;
      if (!q) return true;
      const hay = [entry.id, entry.title, entry.summary, ...entry.keywords].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [entries, activeCategory, query]);

  const selectedEntry = useMemo(
    () => entries.find((e) => e.id === selectedEntryId) ?? filteredEntries[0] ?? entries[0] ?? null,
    [entries, filteredEntries, selectedEntryId],
  );

  useEffect(() => {
    if (!open || !selectedEntry) return;
    setDraft((prev) => (prev && prev.id === selectedEntry.id ? prev : toDraft(selectedEntry)));
  }, [open, selectedEntry]);

  const relatedEntries = useMemo(() => {
    if (!selectedEntry) return [];
    const byId = new Map(entries.map((e) => [e.id, e]));
    return selectedEntry.relatedEntryIds.map((id) => byId.get(id)).filter((v): v is CivilopediaEntry => Boolean(v));
  }, [entries, selectedEntry]);

  const groupedCategories = useMemo(() => {
    const all = new Set(categories);
    for (const e of entries) all.add(e.category);
    for (const id of categoryOrder) all.add(id);
    return [...all];
  }, [categories, entries]);

  const persistEntries = async (nextEntries: CivilopediaEntry[], nextCategories = categories) => {
    if (!isAdmin || !adminToken) return;
    setSaving(true);
    try {
      const result = await updateAdminCivilopedia(adminToken, { categories: nextCategories, entries: nextEntries });
      setEntries(result.entries);
      setCategories(result.categories);
      toast.success("Хранилище знаний сохранено");
    } catch (error) {
      toast.error("Не удалось сохранить Хранилище знаний", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const saveSelectedDraft = async () => {
    if (!draft || !selectedEntry) return;
    const nextEntry = fromDraft(draft, selectedEntry);
    const nextEntries = entries.map((entry) => (entry.id === selectedEntry.id ? nextEntry : entry));
    await persistEntries(nextEntries);
    setSelectedEntryId(nextEntry.id);
  };

  const createEntry = async () => {
    const next = makeEmptyEntry();
    const nextEntries = [next, ...entries];
    setEntries(nextEntries);
    setSelectedEntryId(next.id);
    setActiveCategory(next.category);
    setDraft(toDraft(next));
    if (isAdmin && adminToken) {
      await persistEntries(nextEntries);
    }
  };

  const deleteSelectedEntry = async () => {
    if (!selectedEntry) return;
    const nextEntries = entries.filter((entry) => entry.id !== selectedEntry.id);
    setEntries(nextEntries);
    setSelectedEntryId(nextEntries[0]?.id ?? "");
    if (isAdmin && adminToken) {
      await persistEntries(nextEntries);
    }
  };

  const uploadImageForSelected = async (file: File) => {
    if (!isAdmin || !adminToken || !draft) return;
    try {
      const result = await uploadCivilopediaImage(adminToken, file);
      setDraft({ ...draft, imageUrl: result.imageUrl });
      toast.success("Изображение загружено");
    } catch (error) {
      toast.error("Не удалось загрузить изображение", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const uploadInlineImage = async (file: File) => {
    if (!isAdmin || !adminToken) return;
    try {
      const result = await uploadCivilopediaInlineImage(adminToken, file);
      const token = `[img:${result.imageUrl}|64]`;
      setInlineTokenHint(token);
      toast.success("Inline-изображение загружено", {
        description: "Токен вставлен в подсказку ниже. Вставьте его в текст абзаца.",
      });
    } catch (error) {
      toast.error("Не удалось загрузить inline-изображение", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  useEffect(() => {
    if (!open || loading || !initialIntent) return;
    if (entries.length === 0 && !(initialIntent.type === "province" && initialIntent.createIfMissing && isAdmin)) return;

    const handle = async () => {
      if (initialIntent.type === "open-entry") {
        const found = entries.find((e) => e.id === initialIntent.entryId);
        if (found) {
          setActiveCategory(found.category);
          setSelectedEntryId(found.id);
        }
        onIntentHandled?.();
        return;
      }

      const provinceArticleId = `province:${initialIntent.provinceId}`;
      const existing = entries.find((e) => e.id === provinceArticleId);
      if (existing) {
        setActiveCategory(existing.category);
        setSelectedEntryId(existing.id);
        onIntentHandled?.();
        return;
      }

      if (!initialIntent.createIfMissing || !isAdmin || !adminToken) {
        toast.error("Статья о провинции не найдена");
        onIntentHandled?.();
        return;
      }

      const category = "Провинции";
      const nextEntry: CivilopediaEntry = {
        id: provinceArticleId,
        category,
        title: `Провинция: ${initialIntent.provinceName}`,
        summary: `Справочная статья по провинции ${initialIntent.provinceName}.`,
        keywords: ["провинция", initialIntent.provinceName, initialIntent.provinceId],
        imageUrl: null,
        relatedEntryIds: ["map-modes", "colonization-race"],
        sections: [
          {
            title: "Общая информация",
            paragraphs: [
              `Провинция: [color:#67e8f9]${initialIntent.provinceName}[/color]`,
              `ID провинции: ${initialIntent.provinceId}`,
              "Заполните описание, стратегическую ценность, особенности колонизации и исторические заметки.",
            ],
          },
        ],
      };
      const nextEntries = [nextEntry, ...entries];
      const nextCategories = categories.includes(category) ? categories : [...categories, category];
      setEntries(nextEntries);
      setCategories(nextCategories);
      setActiveCategory(category);
      setSelectedEntryId(nextEntry.id);
      setDraft(toDraft(nextEntry));
      await persistEntries(nextEntries, nextCategories);
      onIntentHandled?.();
    };

    void handle();
  }, [open, loading, initialIntent, entries, isAdmin, adminToken, categories, onIntentHandled]);

  const addCategory = async () => {
    const value = newCategoryInput.trim();
    if (!value) return;
    if (categories.includes(value)) {
      setActiveCategory(value);
      setNewCategoryInput("");
      return;
    }
    const nextCategories = [...categories, value];
    setCategories(nextCategories);
    setActiveCategory(value);
    setNewCategoryInput("");
    if (isAdmin && adminToken) {
      await persistEntries(entries, nextCategories);
    }
  };

  const removeCategory = async (category: string) => {
    if (entries.some((e) => e.category === category)) {
      toast.error("Нельзя удалить категорию", { description: "Сначала перенесите или удалите статьи из этой категории" });
      return;
    }
    const nextCategories = categories.filter((c) => c !== category);
    setCategories(nextCategories);
    if (activeCategory === category) {
      setActiveCategory(nextCategories[0] ?? "basics");
    }
    if (isAdmin && adminToken) {
      await persistEntries(entries, nextCategories);
    }
  };

  const renderInlineParagraph = (text: string) => {
    const nodes: ReactNode[] = [];
    let remaining = text;
    let key = 0;
    const tokenRegex = /\[img:([^\]|]+)(?:\|(\d{1,3}))?\]|\[color:(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\]([\s\S]*?)\[\/color\]/;
    while (remaining.length > 0) {
      const match = tokenRegex.exec(remaining);
      if (!match || match.index < 0) {
        nodes.push(<Fragment key={`t-${key++}`}>{remaining}</Fragment>);
        break;
      }
      if (match.index > 0) {
        nodes.push(<Fragment key={`t-${key++}`}>{remaining.slice(0, match.index)}</Fragment>);
      }
      if (match[1]) {
        const url = match[1];
        const size = Math.max(12, Math.min(64, Number(match[2] || 64)));
        nodes.push(
          <img
            key={`img-${key++}`}
            src={url}
            alt=""
            className="mx-1 inline-block rounded align-middle object-cover"
            style={{ width: size, height: size }}
          />,
        );
      } else if (match[3]) {
        nodes.push(
          <span key={`c-${key++}`} style={{ color: match[3] }} className="font-medium">
            {match[4]}
          </span>,
        );
      }
      remaining = remaining.slice(match.index + match[0].length);
    }
    return nodes;
  };

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[128]">
      <motion.div aria-hidden="true" className="fixed inset-0 bg-black/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16, ease: "easeOut" }} />
      <div className="fixed inset-0">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.18, ease: "easeOut" }} className="h-full w-full">
          <Dialog.Panel className="glass panel-border h-full w-full rounded-none p-4">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <Dialog.Title className="font-display text-2xl tracking-wide text-arc-accent">Хранилище знаний</Dialog.Title>
                <div className="text-xs text-white/50">Справочник по механикам и интерфейсу игры</div>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setAdminEditMode((v) => !v)}
                    className={`panel-border inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs ${adminEditMode ? "bg-rose-500/20 text-rose-300" : "bg-white/5 text-white/80"}`}
                  >
                    {adminEditMode ? "Режим редактирования" : "Редактировать"}
                  </button>
                )}
                <button onClick={onClose} className="panel-border inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:text-arc-accent">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className={`grid h-[calc(100vh-92px)] gap-4 ${adminEditMode && isAdmin ? "xl:grid-cols-[220px_320px_1fr_360px]" : "lg:grid-cols-[220px_320px_1fr]"}`}>
              <aside className="arc-scrollbar panel-border overflow-auto rounded-xl bg-black/25 p-2">
                {groupedCategories.map((category) => {
                  const meta = getCategoryMeta(category);
                  const Icon = meta.icon;
                  const active = activeCategory === category;
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setActiveCategory(category)}
                      className={`mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                        active ? "bg-arc-accent/20 text-arc-accent" : "text-slate-300 hover:text-white"
                      }`}
                    >
                      <Icon size={15} />
                      {meta.label}
                    </button>
                  );
                })}
              </aside>

              <section className="arc-scrollbar panel-border overflow-auto rounded-xl bg-black/25 p-3">
                <div className="mb-3 relative">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Поиск по статьям..."
                    className="w-full rounded-lg border border-white/10 bg-black/35 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-arc-accent/50"
                  />
                </div>
                {adminEditMode && isAdmin && (
                  <button onClick={createEntry} disabled={saving} className="mb-3 inline-flex items-center gap-2 rounded-lg bg-emerald-500/20 px-3 py-2 text-xs text-emerald-200 disabled:opacity-60">
                    <Plus size={14} />
                    Новая статья
                  </button>
                )}
                <div className="space-y-2">
                  {loading ? (
                    <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-sm text-white/55">Загрузка...</div>
                  ) : filteredEntries.length === 0 ? (
                    <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-sm text-white/55">Ничего не найдено</div>
                  ) : (
                    filteredEntries.map((entry) => {
                      const active = selectedEntry?.id === entry.id;
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => setSelectedEntryId(entry.id)}
                          className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                            active ? "border-arc-accent/40 bg-arc-accent/10" : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/5"
                          }`}
                        >
                          <div className={`text-sm font-semibold ${active ? "text-arc-accent" : "text-white/90"}`}>{entry.title}</div>
                          <div className="mt-1 text-xs text-white/55">{entry.summary}</div>
                          <div className="mt-2 text-[10px] text-white/35">{entry.id}</div>
                        </button>
                      );
                    })
                  )}
                </div>
              </section>

              <article className="arc-scrollbar panel-border overflow-auto rounded-xl bg-black/25 p-4">
                {selectedEntry ? (
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-xs text-white/55">
                      {(() => {
                        const Icon = getCategoryMeta(selectedEntry.category).icon;
                        return <Icon size={14} className="text-arc-accent" />;
                      })()}
                      <span>{getCategoryMeta(selectedEntry.category).label}</span>
                    </div>
                    <h2 className="font-display text-2xl tracking-wide text-white">{selectedEntry.title}</h2>
                    <p className="mt-2 text-sm text-white/65">{selectedEntry.summary}</p>

                    {selectedEntry.imageUrl && (
                      <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                        <img src={selectedEntry.imageUrl} alt="" className="max-h-[260px] w-full object-cover" />
                      </div>
                    )}

                    {selectedEntry.keywords.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {selectedEntry.keywords.map((keyword) => (
                          <button
                            key={keyword}
                            type="button"
                            onClick={() => setQuery(keyword)}
                            className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70 hover:border-arc-accent/40 hover:text-arc-accent"
                          >
                            #{keyword}
                          </button>
                        ))}
                      </div>
                    )}

                    {relatedEntries.length > 0 && (
                      <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="mb-2 text-xs uppercase tracking-wide text-white/45">Связанные статьи</div>
                        <div className="flex flex-wrap gap-2">
                          {relatedEntries.map((related) => (
                            <button
                              key={related.id}
                              type="button"
                              onClick={() => {
                                setActiveCategory(related.category);
                                setSelectedEntryId(related.id);
                              }}
                              className="rounded-lg border border-arc-accent/20 bg-arc-accent/5 px-2 py-1 text-xs text-arc-accent hover:bg-arc-accent/10"
                            >
                              {related.title}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-5 space-y-4">
                      {selectedEntry.sections.map((section) => (
                        <section key={`${selectedEntry.id}-${section.title}`} className="rounded-xl border border-white/10 bg-black/20 p-4">
                          <h3 className="mb-2 text-sm font-semibold text-arc-accent">{section.title}</h3>
                          <div className="space-y-2 text-sm leading-relaxed text-white/80">
                            {section.paragraphs.map((paragraph, idx) => (
                              <p key={idx}>{renderInlineParagraph(paragraph)}</p>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-white/55">Выберите статью слева</div>
                )}
              </article>

              {adminEditMode && isAdmin && (
                <aside className="arc-scrollbar panel-border overflow-auto rounded-xl bg-black/25 p-4">
                  {draft ? (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="mb-2 text-xs text-white/60">Категории статей</div>
                        <div className="mb-2 flex flex-wrap gap-2">
                          {categories.map((category) => (
                            <div key={category} className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/80">
                              <button type="button" onClick={() => setActiveCategory(category)} className="hover:text-arc-accent">
                                {category}
                              </button>
                              <button
                                type="button"
                                onClick={() => void removeCategory(category)}
                                className="text-rose-300 hover:text-rose-200"
                                title="Удалить категорию"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input
                            value={newCategoryInput}
                            onChange={(e) => setNewCategoryInput(e.target.value)}
                            placeholder="Новая категория"
                            className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                          />
                          <button onClick={() => void addCategory()} className="inline-flex h-9 items-center gap-1 rounded-lg bg-emerald-500/20 px-3 text-xs text-emerald-200">
                            <Plus size={13} />
                            Добавить
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-white/90">Редактор статьи (Хранилище знаний)</div>
                        {selectedEntry && (
                          <button onClick={deleteSelectedEntry} disabled={saving} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/20 text-rose-300 disabled:opacity-60">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-white/60">ID</label>
                        <input value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-white/60">Категория</label>
                        <div className="flex gap-2">
                          <select
                            value={draft.category}
                            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                            className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                          >
                            {groupedCategories.map((category) => (
                              <option key={category} value={category}>
                                {category}
                              </option>
                            ))}
                          </select>
                          <input
                            value={draft.category}
                            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                            className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                            placeholder="Или введите вручную"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-white/60">Заголовок</label>
                        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-white/60">Краткое описание</label>
                        <textarea value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} rows={3} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-white/60">Теги (через запятую)</label>
                        <input value={draft.keywordsCsv} onChange={(e) => setDraft({ ...draft, keywordsCsv: e.target.value })} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-white/60">Связанные статьи (ID через запятую)</label>
                        <input value={draft.relatedCsv} onChange={(e) => setDraft({ ...draft, relatedCsv: e.target.value })} className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm" />
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="mb-2 text-xs text-white/60">Изображение статьи</div>
                        <div className="mb-2 text-[11px] text-white/45">Обложка статьи: максимум 1024x1024</div>
                        {draft.imageUrl ? (
                          <img src={draft.imageUrl} alt="" className="mb-2 max-h-32 w-full rounded-lg object-cover" />
                        ) : (
                          <div className="mb-2 flex h-20 items-center justify-center rounded-lg border border-dashed border-white/10 text-xs text-white/40">
                            Нет изображения
                          </div>
                        )}
                        <input
                          type="text"
                          value={draft.imageUrl}
                          onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
                          placeholder="URL изображения"
                          className="mb-2 w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                        />
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10">
                          <Upload size={13} />
                          Загрузить
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void uploadImageForSelected(file);
                              e.currentTarget.value = "";
                            }}
                          />
                        </label>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="mb-2 text-xs text-white/60">Inline-изображения 64x64 в тексте</div>
                        <div className="mb-2 text-[11px] text-white/45">Лимит загрузки: максимум 64x64</div>
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10">
                          <Upload size={13} />
                          Загрузить 64x64
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void uploadInlineImage(file);
                              e.currentTarget.value = "";
                            }}
                          />
                        </label>
                        <div className="mt-2 text-[11px] text-white/45">
                          Используйте в тексте: <code>[img:URL|64]</code>
                        </div>
                        <div className="mt-1 text-[11px] text-white/45">
                          Цветные слова: <code>[color:#22c55e]текст[/color]</code>
                        </div>
                        {inlineTokenHint && (
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(inlineTokenHint).catch(() => undefined);
                              toast.success("Токен скопирован");
                            }}
                            className="mt-2 block w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-left font-mono text-[11px] text-emerald-200 hover:border-emerald-400/30"
                          >
                            {inlineTokenHint}
                          </button>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-white/60">Секции (JSON)</label>
                        <textarea
                          value={draft.sectionsJson}
                          onChange={(e) => setDraft({ ...draft, sectionsJson: e.target.value })}
                          rows={14}
                          className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 font-mono text-xs"
                        />
                      </div>
                      <div className="text-[11px] text-white/45">
                        Формат секций: массив объектов вида {"{ title, paragraphs: [..] }"}.
                      </div>
                      <button onClick={saveSelectedDraft} disabled={saving || !selectedEntry} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">
                        <Save size={14} />
                        Сохранить статью
                      </button>
                    </div>
                  ) : (
                    <div className="text-sm text-white/55">Выберите статью для редактирования</div>
                  )}
                </aside>
              )}
            </div>
          </Dialog.Panel>
        </motion.div>
      </div>
    </Dialog>
  );
}
