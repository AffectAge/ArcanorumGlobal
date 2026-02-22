import { Dialog } from "@headlessui/react";
import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { fetchTurnStatus, type TurnStatusItem } from "../lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
};

type TurnStatusPayload = {
  turnId: number;
  readyCount: number;
  requiredCount: number;
  countries: TurnStatusItem[];
};

function statusText(item: TurnStatusItem): string {
  if (item.status === "ready") {
    return "Готова";
  }

  if (item.status === "waiting") {
    return "Ожидает";
  }

  if (item.blockedReason === "PERMANENT") {
    return "Заблокирована бессрочно";
  }

  if (item.blockedReason === "TURN" && item.blockedUntilTurn != null) {
    return `Заблокирована до хода #${item.blockedUntilTurn}`;
  }

  if (item.blockedReason === "TIME" && item.blockedUntilAt) {
    return `Заблокирована до ${new Date(item.blockedUntilAt).toLocaleString()}`;
  }

  return "Заблокирована";
}

function statusClass(item: TurnStatusItem): string {
  if (item.status === "ready") {
    return "bg-emerald-500/15 text-emerald-300 border-emerald-400/30";
  }

  if (item.status === "waiting") {
    return "bg-slate-500/15 text-slate-300 border-slate-400/30";
  }

  return "bg-rose-500/15 text-rose-300 border-rose-400/30";
}

export function TurnStatusModal({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<TurnStatusPayload | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchTurnStatus();
        if (!cancelled) {
          setPayload(data);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    const timer = setInterval(load, 1500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open]);

  const sorted = useMemo(() => {
    if (!payload) {
      return [];
    }

    const rank = (status: TurnStatusItem["status"]): number => (status === "waiting" ? 0 : status === "ready" ? 1 : status === "ignored" ? 2 : 3);
    return [...payload.countries].sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));
  }, [payload]);

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[130]">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" />
      <div className="fixed inset-0 flex items-start justify-center p-4 pt-24">
        <Dialog.Panel className="glass panel-border w-full max-w-2xl rounded-xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <Dialog.Title className="text-sm font-semibold text-slate-100">Готовность стран к ходу</Dialog.Title>
              <p className="mt-1 text-xs text-slate-400">
                Ход #{payload?.turnId ?? "-"} • Готово {payload?.readyCount ?? 0}/{payload?.requiredCount ?? 0}
              </p>
            </div>
            <button
              onClick={onClose}
              className="panel-border inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/5 text-slate-200 transition hover:text-arc-accent"
              aria-label="Закрыть"
            >
              <X size={14} />
            </button>
          </div>

          {loading && !payload ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-300">
              <LoaderCircle size={16} className="animate-spin" />
              Загрузка статусов...
            </div>
          ) : (
            <div className="arc-scrollbar max-h-[55vh] space-y-2 overflow-auto pr-1">
              {sorted.map((item) => (
                <div key={item.id} className="panel-border flex items-center justify-between rounded-lg bg-black/25 px-3 py-2">
                  <div className="flex items-center gap-2">
                    {item.flagUrl ? (
                      <img src={item.flagUrl} alt="" className="h-4 w-6 rounded-sm object-cover" />
                    ) : (
                      <span
                        className="h-3.5 w-3.5 rounded-full border border-white/10"
                        style={{ backgroundColor: item.color ?? "#94a3b8" }}
                      />
                    )}
                    <div className="text-sm text-slate-100">{item.name}</div>
                  </div>
                  <div className={`rounded-md border px-2 py-1 text-xs ${statusClass(item)}`}>{statusText(item)}</div>
                </div>
              ))}
            </div>
          )}
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
