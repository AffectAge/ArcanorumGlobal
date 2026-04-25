import { Dialog } from "@headlessui/react";
import { motion } from "framer-motion";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  label?: string;
  placeholder?: string;
  description?: string;
  hint?: string;
  maxLength?: number;
  submitLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  disabledSubmit?: boolean;
  zIndexClassName?: string;
};

export function TextInputModal({
  open,
  onClose,
  title,
  value,
  onChange,
  onSubmit,
  label,
  placeholder,
  description,
  hint,
  maxLength = 80,
  submitLabel = "Сохранить",
  cancelLabel = "Отмена",
  pending = false,
  disabledSubmit = false,
  zIndexClassName = "z-[210]",
}: Props) {
  const canSubmit = !pending && !disabledSubmit;

  return (
    <Dialog open={open} onClose={() => !pending && onClose()} className={`relative ${zIndexClassName}`}>
      <motion.div
        aria-hidden="true"
        className="fixed inset-0 bg-black/65 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.985 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="w-full max-w-lg"
        >
          <Dialog.Panel className="glass panel-border rounded-2xl bg-[#0b111b] p-4 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <Dialog.Title className="font-semibold text-white">{title}</Dialog.Title>
              <button
                type="button"
                onClick={onClose}
                className="panel-border inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:text-arc-accent disabled:opacity-50"
                disabled={pending}
                aria-label="Закрыть"
              >
                <X size={14} />
              </button>
            </div>

            {description ? (
              <div className="mb-3 rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/70">{description}</div>
            ) : null}

            <div>
              {label ? <label className="mb-1 block text-xs text-slate-300">{label}</label> : null}
              <input
                autoFocus
                value={value}
                maxLength={maxLength}
                onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) {
                    e.preventDefault();
                    onSubmit();
                  }
                }}
                className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/40"
                placeholder={placeholder}
              />
              <div className="mt-1 flex items-center justify-between text-[11px]">
                <span className="text-white/45">{hint ?? "Пустое значение сбрасывает поле"}</span>
                <span className={value.trim().length >= maxLength ? "text-amber-300" : "text-white/45"}>
                  {value.length}/{maxLength}
                </span>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/85 transition hover:border-white/20 hover:bg-white/10 disabled:opacity-60"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit}
                className="rounded-lg border border-emerald-400/35 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-500/55 hover:bg-emerald-400/20 disabled:opacity-60"
              >
                {pending ? "Сохранение..." : submitLabel}
              </button>
            </div>
          </Dialog.Panel>
        </motion.div>
      </div>
    </Dialog>
  );
}
