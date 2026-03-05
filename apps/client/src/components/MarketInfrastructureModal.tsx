import { Dialog } from "@headlessui/react";
import { motion } from "framer-motion";
import { Globe2, X } from "lucide-react";

type InfraRow = {
  provinceId: string;
  capacity: number;
  required: number;
  coverage: number;
};

type SharedInfraRow = {
  marketId: string;
  marketName: string;
  capacity: number;
  consumed: number;
  available: number;
  capacityByCategory?: Record<string, number>;
  consumedByCategory?: Record<string, number>;
  availableByCategory?: Record<string, number>;
};

type Props = {
  open: boolean;
  onClose: () => void;
  infraRows: InfraRow[];
  sharedInfraRows: SharedInfraRow[];
  showShared: boolean;
  formatNumber: (value: number) => string;
  formatCompact: (value: number) => string;
  infrastructureCategoryNamesById: Record<string, string>;
};

export function MarketInfrastructureModal({
  open,
  onClose,
  infraRows,
  sharedInfraRows,
  showShared,
  formatNumber,
  formatCompact,
  infrastructureCategoryNamesById,
}: Props) {
  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} className="fixed inset-0 z-[178]">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      <div className="absolute inset-4 flex items-center justify-center">
        <Dialog.Panel
          as={motion.div}
          initial={{ opacity: 0, y: 12, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="panel-border arc-scrollbar h-[min(92vh,920px)] w-[min(92vw,920px)] overflow-auto rounded-2xl bg-[#0b111b] p-4"
        >
          <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <h3 className="text-lg font-semibold text-white">Инфраструктура рынков</h3>
              <p className="text-xs text-white/60">Провинциальная и shared инфраструктура</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/35 text-white/70"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-3">
            <div className="panel-border rounded-xl bg-black/25 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white/80">
                <Globe2 size={14} className="text-arc-accent" />
                Инфраструктура провинций
              </div>
              <div className="space-y-1">
                {infraRows.map((row) => (
                  <div
                    key={row.provinceId}
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      row.coverage < 1 ? "border-amber-400/35 bg-amber-500/10" : "border-white/10 bg-black/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white/80">{row.provinceId}</span>
                      <span className={`font-semibold ${row.coverage < 1 ? "text-amber-200" : "text-emerald-200"}`}>
                        {(row.coverage * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-1 text-white/55">
                      {formatNumber(row.capacity)} / {formatNumber(row.required)}
                    </div>
                  </div>
                ))}
                {infraRows.length === 0 && <div className="text-xs text-white/50">Нет данных по инфраструктуре.</div>}
              </div>
            </div>

            {showShared && (
              <div className="panel-border rounded-xl bg-black/25 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white/80">
                  <Globe2 size={14} className="text-cyan-300" />
                  Shared инфраструктура рынков
                </div>
                <div className="space-y-1">
                  {sharedInfraRows.map((row) => (
                    <div key={row.marketId} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-white/80">{row.marketName}</span>
                        <span className="text-cyan-200">{formatCompact(row.available)}</span>
                      </div>
                      <div className="mt-1 text-white/55">
                        Доступно: {formatCompact(row.available)} / {formatCompact(row.capacity)}
                      </div>
                      <div className="text-white/55">Потреблено за ход: {formatCompact(row.consumed)}</div>
                      {Object.keys(row.availableByCategory ?? {}).length > 0 && (
                        <div className="mt-1 rounded border border-white/10 bg-black/25 p-1.5">
                          <div className="mb-1 text-[10px] text-white/50">По категориям</div>
                          <div className="space-y-0.5">
                            {Object.entries(row.availableByCategory ?? {})
                              .sort((a, b) => a[0].localeCompare(b[0], "ru"))
                              .map(([categoryId, available]) => {
                                const cap = Number(row.capacityByCategory?.[categoryId] ?? 0);
                                const consumed = Number(row.consumedByCategory?.[categoryId] ?? 0);
                                return (
                                  <div key={`${row.marketId}-${categoryId}`} className="flex items-center justify-between gap-2 text-[10px]">
                                    <span className="text-white/70">{infrastructureCategoryNamesById[categoryId] ?? categoryId}</span>
                                    <span className="text-white/55">
                                      {formatCompact(available)} / {formatCompact(cap)} · {formatCompact(consumed)}
                                    </span>
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {sharedInfraRows.length === 0 && (
                    <div className="text-xs text-white/50">Нет данных по shared инфраструктуре.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}

