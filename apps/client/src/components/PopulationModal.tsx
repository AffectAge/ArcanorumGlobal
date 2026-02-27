import { Dialog } from "@headlessui/react";
import { motion } from "framer-motion";
import { Activity, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  fetchContentEntries,
  fetchPopulationSummaryProvince,
  fetchPopulationSummaryWorld,
  type PopulationSummaryProvince,
  type PopulationSummaryWorld,
} from "../lib/api";

type Props = {
  open: boolean;
  token: string;
  turnId: number;
  selectedProvinceId: string | null;
  onClose: () => void;
};

function fmt(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.max(0, Math.floor(value || 0)));
}

export function PopulationModal({ open, token, turnId, selectedProvinceId, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [world, setWorld] = useState<PopulationSummaryWorld | null>(null);
  const [province, setProvince] = useState<PopulationSummaryProvince | null>(null);
  const [nameByRace, setNameByRace] = useState<Record<string, string>>({});
  const [nameByCulture, setNameByCulture] = useState<Record<string, string>>({});
  const [nameByReligion, setNameByReligion] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchPopulationSummaryWorld(token),
      fetchContentEntries("races"),
      fetchContentEntries("cultures"),
      fetchContentEntries("religions"),
      selectedProvinceId ? fetchPopulationSummaryProvince(token, selectedProvinceId) : Promise.resolve(null),
    ])
      .then(([summary, races, cultures, religions, provinceSummary]) => {
        if (cancelled) return;
        setWorld(summary);
        setProvince(provinceSummary);
        setNameByRace(Object.fromEntries(races.map((item) => [item.id, item.name])));
        setNameByCulture(Object.fromEntries(cultures.map((item) => [item.id, item.name])));
        setNameByReligion(Object.fromEntries(religions.map((item) => [item.id, item.name])));
      })
      .catch(() => {
        if (!cancelled) toast.error("Не удалось загрузить статистику населения");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedProvinceId, token, turnId]);

  const topProvinceGroups = useMemo(() => {
    if (!province) return [];
    return province.groups.slice(0, 12);
  }, [province]);

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[210]">
      <motion.div aria-hidden="true" className="fixed inset-0 bg-black/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
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
                <Dialog.Title className="font-display text-2xl tracking-wide text-arc-accent">Население</Dialog.Title>
                <div className="mt-1 text-xs text-white/60">Агрегированные когорты: раса + культура + религия по провинциям</div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="panel-border inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-slate-300 transition hover:text-arc-accent"
                aria-label="Закрыть"
              >
                <X size={16} />
              </button>
            </div>

            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-white/70">Загрузка...</div>
            ) : !world ? (
              <div className="flex h-full items-center justify-center text-sm text-white/70">Нет данных</div>
            ) : (
              <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
                <aside className="min-h-0 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Сводка мира</div>
                  <div className="grid gap-2">
                    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                      <div className="text-[11px] text-white/50">Всего населения</div>
                      <div className="mt-1 text-xl font-semibold text-white">{fmt(world.totals.population)}</div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                      <div className="text-[11px] text-white/50">Групп (когорт)</div>
                      <div className="mt-1 text-xl font-semibold text-white">{fmt(world.totals.groups)}</div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                      <div className="mb-2 inline-flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-400">
                        <Users size={12} /> Топ рас
                      </div>
                      <div className="space-y-1.5">
                        {world.top.races.slice(0, 8).map((row) => (
                          <div key={row.id} className="flex items-center justify-between text-xs">
                            <span className="truncate text-white/80">{nameByRace[row.id] ?? row.id}</span>
                            <span className="tabular-nums text-white/60">{fmt(row.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                      <div className="mb-2 inline-flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-400">
                        <Activity size={12} /> Топ культур/религий
                      </div>
                      <div className="space-y-1.5">
                        {world.top.cultures.slice(0, 5).map((row) => (
                          <div key={`c-${row.id}`} className="flex items-center justify-between text-xs">
                            <span className="truncate text-white/80">Культура: {nameByCulture[row.id] ?? row.id}</span>
                            <span className="tabular-nums text-white/60">{fmt(row.value)}</span>
                          </div>
                        ))}
                        {world.top.religions.slice(0, 5).map((row) => (
                          <div key={`r-${row.id}`} className="flex items-center justify-between text-xs">
                            <span className="truncate text-white/80">Религия: {nameByReligion[row.id] ?? row.id}</span>
                            <span className="tabular-nums text-white/60">{fmt(row.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </aside>

                <section className="arc-scrollbar min-h-0 overflow-auto rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {province
                      ? `Провинция ${province.provinceId}: ${fmt(province.totalPopulation)}`
                      : "Выберите провинцию на карте для детальной структуры"}
                  </div>
                  {province ? (
                    <div className="space-y-2">
                      {topProvinceGroups.map((group) => (
                        <div key={group.id} className="rounded-lg border border-white/10 bg-black/25 p-3">
                          <div className="text-sm text-white">{fmt(group.size)} жителей</div>
                          <div className="mt-1 text-xs text-white/65">
                            Раса: {nameByRace[group.raceId] ?? group.raceId} | Культура: {nameByCulture[group.cultureId] ?? group.cultureId} | Религия:{" "}
                            {nameByReligion[group.religionId] ?? group.religionId}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-white/10 bg-black/25 p-3 text-sm text-white/65">
                      Выберите любую провинцию на карте, затем откройте окно «Население» для просмотра когорт этой провинции.
                    </div>
                  )}
                </section>
              </div>
            )}
          </Dialog.Panel>
        </motion.div>
      </div>
    </Dialog>
  );
}
