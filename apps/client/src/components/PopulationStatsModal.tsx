import { Dialog } from "@headlessui/react";
import { motion } from "framer-motion";
import { BarChart3, MapPin, Palette, ScrollText, UserRound, X } from "lucide-react";
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

type StatsRow = { id: string; popCount: number; totalSize: number };
type StatsSection = "overview";
type StatsSubsection = "provinces" | "cultures" | "religions" | "races";

const SECTIONS: Array<{ id: StatsSection; label: string; icon: typeof BarChart3 }> = [
  { id: "overview", label: "Обзор страны", icon: BarChart3 },
];

const OVERVIEW_SUBSECTIONS: Array<{ id: StatsSubsection; label: string; icon: typeof MapPin }> = [
  { id: "provinces", label: "Провинции", icon: MapPin },
  { id: "cultures", label: "Культуры", icon: Palette },
  { id: "religions", label: "Религии", icon: ScrollText },
  { id: "races", label: "Расы", icon: UserRound },
];

function SectionList({
  title,
  rows,
  nameById,
}: {
  title: string;
  rows: StatsRow[];
  nameById: Map<string, string>;
}) {
  return (
    <div className="panel-border rounded-xl bg-black/20 p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-white/50">{title}</div>
      <div className="space-y-2">
        {rows.slice(0, 16).map((row) => (
          <div key={row.id} className="rounded-md border border-white/10 bg-black/25 px-2 py-2 text-xs text-slate-200">
            <div className="text-slate-100">{nameById.get(row.id) ?? row.id}</div>
            <div className="text-slate-400">POP: {new Intl.NumberFormat("ru-RU").format(row.popCount)}</div>
            <div className="text-slate-400">Население: {new Intl.NumberFormat("ru-RU").format(row.totalSize)}</div>
          </div>
        ))}
        {rows.length === 0 && <div className="text-xs text-slate-500">Нет данных</div>}
      </div>
    </div>
  );
}

export function PopulationStatsModal({ open, token, countryId, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<PopulationCountryStats | null>(null);
  const [activeSection, setActiveSection] = useState<StatsSection>("overview");
  const [activeSubsection, setActiveSubsection] = useState<StatsSubsection>("provinces");
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

  const renderSection = () => {
    if (!stats) {
      return <div className="text-sm text-slate-400">Статистика недоступна</div>;
    }

    if (activeSection !== "overview") {
      return <div className="text-sm text-slate-400">Раздел недоступен</div>;
    }

    if (activeSubsection === "provinces") {
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="panel-border rounded-xl bg-black/20 p-4 text-sm text-slate-300">
            <div className="mb-2 text-xs uppercase tracking-wide text-white/50">Общая статистика</div>
            <div>Страна: <span className="text-slate-100">{countryNameById.get(countryId) ?? countryId}</span></div>
            <div className="mt-1">POP: <span className="text-slate-100">{new Intl.NumberFormat("ru-RU").format(stats.popCount)}</span></div>
            <div className="mt-1">Население: <span className="text-slate-100">{new Intl.NumberFormat("ru-RU").format(stats.totalSize)}</span></div>
          </div>
          <SectionList title="Распределение по провинциям" rows={stats.byProvince} nameById={provinceNameById} />
        </div>
      );
    }
    if (activeSubsection === "cultures") {
      return <SectionList title="Распределение по культурам" rows={stats.byCulture} nameById={cultureNameById} />;
    }
    if (activeSubsection === "religions") {
      return <SectionList title="Распределение по религиям" rows={stats.byReligion} nameById={religionNameById} />;
    }
    return <SectionList title="Распределение по расам" rows={stats.byRace} nameById={raceNameById} />;
  };

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
                aria-label="Закрыть"
              >
                <X size={16} />
              </button>
            </div>

            {loading ? (
              <div className="text-sm text-slate-300">Загрузка статистики...</div>
            ) : (
              <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[260px_1fr]">
                <aside className="arc-scrollbar panel-border rounded-xl bg-black/25 p-2 overflow-auto">
                  <span className="mb-2 block px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Разделы</span>
                  {SECTIONS.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setActiveSection(section.id)}
                      className={`mb-2 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                        activeSection === section.id
                          ? "border-arc-accent/30 bg-arc-accent/10 text-arc-accent"
                          : "border-white/10 bg-black/20 text-white/70 hover:border-white/15 hover:text-white"
                      }`}
                    >
                      <section.icon size={15} />
                      <span>{section.label}</span>
                    </button>
                  ))}
                </aside>

                <section className="arc-scrollbar panel-border min-h-0 rounded-xl bg-black/25 p-4 overflow-auto">
                  <div className="mb-4 flex items-center gap-5 border-b border-white/10 px-1">
                    {OVERVIEW_SUBSECTIONS.map((subsection) => (
                      <button
                        key={subsection.id}
                        type="button"
                        onClick={() => setActiveSubsection(subsection.id)}
                        className={`inline-flex items-center gap-1.5 pb-2 text-sm transition ${
                          activeSubsection === subsection.id
                            ? "border-b-2 border-arc-accent text-arc-accent"
                            : "border-b-2 border-transparent text-white/60 hover:text-white"
                        }`}
                      >
                        <subsection.icon size={14} />
                        {subsection.label}
                      </button>
                    ))}
                  </div>
                  {renderSection()}
                </section>
              </div>
            )}
          </Dialog.Panel>
        </motion.div>
      </div>
    </Dialog>
  );
}
