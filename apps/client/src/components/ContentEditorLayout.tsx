import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type ContentCategoryNavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  enabled: boolean;
};

export type ContentSectionTab = {
  id: string;
  label: string;
};

type Props = {
  categories: ContentCategoryNavItem[];
  activeCategoryId: string;
  listTitle: string;
  listSearchValue: string;
  onListSearchChange: (value: string) => void;
  listSearchPlaceholder: string;
  onCreateItem: () => void;
  createItemLabel: string;
  createItemDisabled?: boolean;
  listContent: ReactNode;
  sectionTabs: ContentSectionTab[];
  activeSectionId: string;
  onSectionChange: (id: string) => void;
  headerTitle: string;
  headerSubtitle?: string;
  headerActions?: ReactNode;
  editorContent: ReactNode;
  previewContent: ReactNode;
};

export function ContentEditorLayout({
  categories,
  activeCategoryId,
  listTitle,
  listSearchValue,
  onListSearchChange,
  listSearchPlaceholder,
  onCreateItem,
  createItemLabel,
  createItemDisabled = false,
  listContent,
  sectionTabs,
  activeSectionId,
  onSectionChange,
  headerTitle,
  headerSubtitle,
  headerActions,
  editorContent,
  previewContent,
}: Props) {
  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="min-h-0 rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Категории</div>
        <div className="mt-2 space-y-2">
          {categories.map((category) => {
            const Icon = category.icon;
            const isActive = category.id === activeCategoryId;
            return (
              <button
                key={category.id}
                type="button"
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
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{listTitle}</div>
          <input
            value={listSearchValue}
            onChange={(e) => onListSearchChange(e.target.value)}
            placeholder={listSearchPlaceholder}
            className="mb-2 w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/30"
          />
          <button
            type="button"
            onClick={onCreateItem}
            disabled={createItemDisabled}
            className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-arc-accent px-3 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
          >
            {createItemLabel}
          </button>
          <div className="arc-scrollbar max-h-[calc(100%-6.75rem)] space-y-2 overflow-auto pr-1">{listContent}</div>
        </section>

        <div className="grid min-h-0 gap-4 lg:grid-rows-[auto_auto_minmax(0,1fr)]">
          <div className="flex items-center gap-5 border-b border-white/10 px-1">
            {sectionTabs.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => onSectionChange(section.id)}
                className={`pb-2 text-sm transition ${
                  activeSectionId === section.id
                    ? "border-b-2 border-arc-accent text-arc-accent"
                    : "border-b-2 border-transparent text-white/60 hover:text-white"
                }`}
              >
                {section.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <div>
              <div className="text-sm font-semibold text-white">{headerTitle}</div>
              {headerSubtitle ? <div className="mt-1 text-xs text-white/55">{headerSubtitle}</div> : null}
            </div>
            <div className="flex items-center gap-2">{headerActions}</div>
          </div>

          <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="arc-scrollbar min-h-0 overflow-auto pr-1">{editorContent}</div>
            <aside className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Предпросмотр</div>
              {previewContent}
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

