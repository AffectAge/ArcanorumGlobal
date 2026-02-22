import { Dialog } from "@headlessui/react";
import { Monitor, Save, Sliders, X } from "lucide-react";
import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  showMapControls: boolean;
  onClose: () => void;
  onSave: (settings: { showMapControls: boolean }) => void;
};

export function ClientSettingsModal({ open, showMapControls, onClose, onSave }: Props) {
  const [draftShowMapControls, setDraftShowMapControls] = useState(showMapControls);
  const [activeCategory, setActiveCategory] = useState<"interface">("interface");

  useEffect(() => {
    if (open) {
      setDraftShowMapControls(showMapControls);
    }
  }, [open, showMapControls]);

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[126]">
      <div className="fixed inset-0 bg-black/55" aria-hidden="true" />
      <div className="fixed inset-0">
        <Dialog.Panel className="glass panel-border h-full w-full rounded-none p-4">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="font-display text-2xl tracking-wide text-arc-accent">Настройки клиента</Dialog.Title>
            <button onClick={onClose} className="panel-border inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:text-arc-accent">
              <X size={16} />
            </button>
          </div>

          <div className="grid h-[calc(100vh-92px)] gap-4 md:grid-cols-[240px_1fr]">
            <aside className="arc-scrollbar panel-border overflow-auto rounded-xl bg-black/25 p-2">
              <button
                type="button"
                onClick={() => setActiveCategory("interface")}
                className={`mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                  activeCategory === "interface" ? "bg-arc-accent/20 text-arc-accent" : "text-slate-300 hover:text-white"
                }`}
              >
                <Monitor size={15} />
                Интерфейс
              </button>
              <div className="px-3 py-2 text-xs text-slate-500">
                Настройки сохраняются локально отдельно для каждой страны.
              </div>
            </aside>

            <section className="arc-scrollbar panel-border overflow-auto rounded-xl bg-black/25 p-4">
              <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm text-slate-200">
                    <Monitor size={15} className="text-arc-accent" />
                    Интерфейс
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                    <div>
                      <div className="text-sm text-slate-100">Панель управления картой</div>
                      <div className="text-xs text-slate-500">Кнопки зума, сброса и блокировки карты в правом нижнем углу</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDraftShowMapControls((v) => !v)}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full border transition ${
                        draftShowMapControls
                          ? "border-emerald-400/50 bg-emerald-500/20"
                          : "border-white/10 bg-white/5"
                      }`}
                      aria-pressed={draftShowMapControls}
                      aria-label={draftShowMapControls ? "Выключить панель управления картой" : "Включить панель управления картой"}
                    >
                      <span
                        className={`h-5 w-5 rounded-full transition ${
                          draftShowMapControls
                            ? "translate-x-6 bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.45)]"
                            : "translate-x-1 bg-white/60"
                        }`}
                      />
                    </button>
                  </label>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm text-slate-200">
                    <Sliders size={15} className="text-arc-accent" />
                    Описание
                  </div>
                  <p className="text-xs text-slate-500">
                    Эти параметры не влияют на серверную игру и применяются только в вашем браузере.
                  </p>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      onSave({ showMapControls: draftShowMapControls });
                      onClose();
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black"
                  >
                    <Save size={14} />
                    Сохранить
                  </button>
                </div>
              </div>
            </section>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
