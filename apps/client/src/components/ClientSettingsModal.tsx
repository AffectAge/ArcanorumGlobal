import { Dialog } from "@headlessui/react";
import { Save, Sliders, X } from "lucide-react";
import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  retentionTurns: number;
  onClose: () => void;
  onSaveRetentionTurns: (turns: number) => void;
};

export function ClientSettingsModal({ open, retentionTurns, onClose, onSaveRetentionTurns }: Props) {
  const [draftRetentionTurns, setDraftRetentionTurns] = useState(retentionTurns);

  useEffect(() => {
    if (open) {
      setDraftRetentionTurns(retentionTurns);
    }
  }, [open, retentionTurns]);

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[126]">
      <div className="fixed inset-0 bg-black/55" aria-hidden="true" />
      <div className="fixed inset-0 grid place-items-center p-4">
        <Dialog.Panel className="glass panel-border w-full max-w-xl rounded-2xl p-4">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="font-display text-2xl tracking-wide text-arc-accent">Настройки клиента</Dialog.Title>
            <button onClick={onClose} className="panel-border inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:text-arc-accent">
              <X size={16} />
            </button>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm text-slate-200">
              <Sliders size={15} className="text-arc-accent" />
              Журнал событий
            </div>
            <label className="mb-1 block text-xs text-slate-300">Хранить события за последние (ходов)</label>
            <input
              type="number"
              min={1}
              value={draftRetentionTurns}
              onChange={(e) => setDraftRetentionTurns(Math.max(1, Number(e.target.value) || 1))}
              className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
            />
            <p className="mt-2 text-xs text-slate-500">Журнал автоматически очищает события старше указанного количества ходов.</p>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => {
                onSaveRetentionTurns(draftRetentionTurns);
                onClose();
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black"
            >
              <Save size={14} />
              Сохранить
            </button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
