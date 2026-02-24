import { Dialog } from "@headlessui/react";
import { motion } from "framer-motion";
import { Check, ShieldAlert, X } from "lucide-react";

type Props = {
  open: boolean;
  pending?: boolean;
  country:
    | {
        id: string;
        name: string;
        color: string;
        flagUrl?: string | null;
        crestUrl?: string | null;
      }
    | null;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
};

export function RegistrationApprovalModal({ open, pending = false, country, onClose, onApprove, onReject }: Props) {
  return (
    <Dialog open={open} onClose={() => !pending && onClose()} className="relative z-[130]">
      <motion.div
        aria-hidden="true"
        className="fixed inset-0 bg-black/55 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: open ? 1 : 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
      />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.985 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="w-full max-w-xl"
        >
          <Dialog.Panel className="glass panel-border rounded-2xl bg-[#0b111b] p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-300">
                <ShieldAlert size={16} />
                <Dialog.Title className="font-semibold">Подтверждение регистрации страны</Dialog.Title>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="panel-border inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:text-arc-accent disabled:opacity-60"
                aria-label="Закрыть"
              >
                <X size={14} />
              </button>
            </div>

            {country ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="mb-2 flex items-center gap-3">
                    {country.flagUrl ? (
                      <img src={country.flagUrl} alt="" className="h-8 w-12 rounded object-cover" />
                    ) : (
                      <span className="h-8 w-8 rounded-full border border-white/10" style={{ backgroundColor: country.color }} />
                    )}
                    {country.crestUrl ? <img src={country.crestUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : null}
                    <div>
                      <div className="text-sm font-semibold text-white">{country.name}</div>
                      <div className="text-xs text-white/55">ID: {country.id}</div>
                    </div>
                  </div>
                  <div className="text-xs text-white/65">Подтвердить регистрацию этой страны и разрешить вход в игру?</div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={onReject}
                    disabled={pending}
                    className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 transition hover:border-rose-300/50 hover:bg-rose-400/15 disabled:opacity-60"
                  >
                    {pending ? "Обработка..." : "Нет"}
                  </button>
                  <button
                    type="button"
                    onClick={onApprove}
                    disabled={pending}
                    className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/35 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-500/55 hover:bg-emerald-400/20 disabled:opacity-60"
                  >
                    <Check size={14} />
                    {pending ? "Обработка..." : "Да"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-white/70">Данные заявки недоступны.</div>
            )}
          </Dialog.Panel>
        </motion.div>
      </div>
    </Dialog>
  );
}

