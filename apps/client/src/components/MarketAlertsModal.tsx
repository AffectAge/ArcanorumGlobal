import { Dialog } from "@headlessui/react";
import { motion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import type { MarketOverviewAlert } from "../lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  alerts: MarketOverviewAlert[];
};

export function MarketAlertsModal({ open, onClose, alerts }: Props) {
  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} className="fixed inset-0 z-[178]">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      <div className="absolute inset-4 flex items-center justify-center">
        <Dialog.Panel
          as={motion.div}
          initial={{ opacity: 0, y: 12, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="panel-border arc-scrollbar h-[min(92vh,760px)] w-[min(92vw,780px)] overflow-auto rounded-2xl bg-[#0b111b] p-4"
        >
          <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <h3 className="text-lg font-semibold text-white">Алерты рынка</h3>
              <p className="text-xs text-white/60">События дефицита, перегруза и неактивности зданий</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/35 text-white/70"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-2">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  alert.severity === "critical"
                    ? "border-red-400/35 bg-red-500/10 text-red-100"
                    : "border-amber-400/35 bg-amber-500/10 text-amber-100"
                }`}
              >
                <div className="mb-0.5 inline-flex items-center gap-1.5 font-semibold">
                  <AlertTriangle size={13} />
                  {alert.kind}
                </div>
                <div>{alert.message}</div>
              </div>
            ))}
            {alerts.length === 0 && <div className="text-xs text-white/45">Нет алертов.</div>}
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}

