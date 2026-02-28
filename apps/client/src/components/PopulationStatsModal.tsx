import { Dialog } from "@headlessui/react";
import { motion } from "framer-motion";
import { BarChart3, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  fetchContentEntries,
  fetchCountries,
  fetchPopulationCountryStats,
  fetchProvinceIndex,
  type ContentEntry,
  type PopulationCountryStats,
  type ProvinceIndexItem,
} from "../lib/api";

type Props = {
  open: boolean;
  token: string;
  countryId: string;
  onClose: () => void;
};

function TopList({
  title,
  rows,
  nameById,
}: {
  title: string;
  rows: Array<{ id: string; popCount: number; totalSize: number }>;
  nameById: Map<string, string>;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-white/55">{title}</div>
      <div className="space-y-2 text-xs">
        {rows.slice(0, 8).map((row) => (
          <div key={row.id} className="rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-slate-200">
            <div className="text-slate-100">{nameById.get(row.id) ?? row.id}</div>
            <div className="text-slate-400">POP: {new Intl.NumberFormat("ru-RU").format(row.popCount)}</div>
            <div className="text-slate-400">Население: {new Intl.NumberFormat("ru-RU").format(row.totalSize)}</div>
          </div>
        ))}
        {rows.length === 0 && <div className="text-slate-500">Нет данных</div>}
      </div>
    </div>
  );
}

export function PopulationStatsModal({ open, token, countryId, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<PopulationCountryStats | null>(null);
  const [countries, setCountries] = useState<Array<{ id: string; name: string }>>([]);
  const [cultures, setCultures] = useState<ContentEntry[]>([]);
  const [religions, setReligions] = useState<ContentEntry[]>([]);
  const [races, setRaces] = useState<ContentEntry[]>([]);
  const [provinces, setProvinces] = useState<ProvinceIndexItem[]>([]);

  const countryNameById = useMemo(() => new Map(countries.map((item) => [item.id, item.name] as const)), [countries]);
  const cultureNameById = useMemo(() => new Map(cultures.map((item) => [item.id, item.name] as const)), [cultures]);
  const religionNameById = useMemo(() => new Map(religions.map((item) => [item.id, item.name] as const)), [religions]);
  const raceNameById = useMemo(() => new Map(races.map((item) => [item.id, item.name] as const)), [races]);
  const provinceNameById = useMemo(() => new Map(provinces.map((item) => [item.id, item.name] as const)), [provinces]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchPopulationCountryStats(token, countryId),
      fetchCountries(),
      fetchContentEntries("cultures"),
      fetchContentEntries("religions"),
      fetchContentEntries("races"),
      fetchProvinceIndex(),
    ])
      .then(([statsData, countriesData, culturesData, religionsData, racesData, provincesData]) => {
        if (cancelled) return;
        setStats(statsData);
        setCountries(countriesData.map((item) => ({ id: item.id, name: item.name })));
        setCultures(culturesData);
        setReligions(religionsData);
        setRaces(racesData);
        setProvinces(provincesData);
      })
      .catch(() => {
        if (!cancelled) {
          toast.error("Не удалось загрузить статистику населения");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [countryId, open, token]);

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[206]">
      <motion.div
        aria-hidden="true"
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
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
                <Dialog.Title className="font-display text-2xl tracking-wide text-arc-accent">Статистика населения</Dialog.Title>
                <div className="mt-1 text-xs text-white/60">{countryNameById.get(countryId) ?? countryId}</div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="panel-border inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-slate-300 transition hover:text-arc-accent"
              >
                <X size={16} />
              </button>
            </div>

            {loading ? (
              <div className="text-sm text-slate-300">Загрузка статистики...</div>
            ) : !stats ? (
              <div className="text-sm text-slate-400">Статистика недоступна</div>
            ) : (
              <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[360px_1fr]">
                <aside className="arc-scrollbar panel-border min-h-0 overflow-auto rounded-xl bg-black/25 p-3">
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <div className="mb-2 inline-flex items-center gap-2 text-sm text-slate-200">
                      <Users size={15} className="text-arc-accent" />
                      Общая статистика
                    </div>
                    <div className="space-y-1 text-xs text-slate-300">
                      <div>POP: <span className="text-slate-100">{new Intl.NumberFormat("ru-RU").format(stats.popCount)}</span></div>
                      <div>Население: <span className="text-slate-100">{new Intl.NumberFormat("ru-RU").format(stats.totalSize)}</span></div>
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
                    <div className="mb-2 inline-flex items-center gap-2 text-sm text-slate-200">
                      <BarChart3 size={15} className="text-arc-accent" />
                      Топ провинций
                    </div>
                    <div className="space-y-2 text-xs">
                      {stats.byProvince.slice(0, 10).map((row) => (
                        <div key={row.id} className="rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-slate-200">
                          <div className="text-slate-100">{provinceNameById.get(row.id) ?? row.id}</div>
                          <div className="text-slate-400">POP: {new Intl.NumberFormat("ru-RU").format(row.popCount)}</div>
                          <div className="text-slate-400">Население: {new Intl.NumberFormat("ru-RU").format(row.totalSize)}</div>
                        </div>
                      ))}
                      {stats.byProvince.length === 0 && <div className="text-slate-500">Нет данных</div>}
                    </div>
                  </div>
                </aside>

                <section className="arc-scrollbar panel-border min-h-0 overflow-auto rounded-xl bg-black/25 p-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <TopList title="По культурам" rows={stats.byCulture} nameById={cultureNameById} />
                    <TopList title="По религиям" rows={stats.byReligion} nameById={religionNameById} />
                    <TopList title="По расам" rows={stats.byRace} nameById={raceNameById} />
                  </div>
                </section>
              </div>
            )}
          </Dialog.Panel>
        </motion.div>
      </div>
    </Dialog>
  );
}
