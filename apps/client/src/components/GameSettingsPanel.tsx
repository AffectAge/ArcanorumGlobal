import { Dialog } from "@headlessui/react";
import { useEffect, useState } from "react";
import { Coins, Flag, Save, X } from "lucide-react";
import { toast } from "sonner";
import { fetchGameSettings, updateGameSettings } from "../lib/api";

type Props = {
  open: boolean;
  token: string;
  onClose: () => void;
};

const categories = [
  { id: "economy", label: "Экономика" },
  { id: "colonization", label: "Колонизация" },
] as const;

export function GameSettingsPanel({ open, token, onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState<(typeof categories)[number]["id"]>("economy");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [baseDucatsPerTurn, setBaseDucatsPerTurn] = useState(5);
  const [baseGoldPerTurn, setBaseGoldPerTurn] = useState(10);
  const [maxActiveColonizations, setMaxActiveColonizations] = useState(3);
  const [colonizationPointsPerTurn, setColonizationPointsPerTurn] = useState(30);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchGameSettings(token)
      .then((settings) => {
        if (cancelled) {
          return;
        }
        setBaseDucatsPerTurn(settings.economy.baseDucatsPerTurn);
        setBaseGoldPerTurn(settings.economy.baseGoldPerTurn);
        setMaxActiveColonizations(settings.colonization.maxActiveColonizations);
        setColonizationPointsPerTurn(settings.colonization.pointsPerTurn);
      })
      .catch(() => {
        if (!cancelled) {
          toast.error("Не удалось загрузить настройки игры");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, token]);

  const saveEconomy = async () => {
    setSaving(true);
    try {
      const updated = await updateGameSettings(token, {
        economy: {
          baseDucatsPerTurn: Math.max(0, Math.floor(baseDucatsPerTurn)),
          baseGoldPerTurn: Math.max(0, Math.floor(baseGoldPerTurn)),
        },
      });

      setBaseDucatsPerTurn(updated.economy.baseDucatsPerTurn);
      setBaseGoldPerTurn(updated.economy.baseGoldPerTurn);
      toast.success("Настройки экономики сохранены");
    } catch {
      toast.error("Не удалось сохранить настройки экономики");
    } finally {
      setSaving(false);
    }
  };

  const saveColonization = async () => {
    setSaving(true);
    try {
      const updated = await updateGameSettings(token, {
        colonization: {
          maxActiveColonizations: Math.max(1, Math.floor(maxActiveColonizations)),
        },
      });

      setMaxActiveColonizations(updated.colonization.maxActiveColonizations);
      setColonizationPointsPerTurn(updated.colonization.pointsPerTurn);
      toast.success("Настройки колонизации сохранены");
    } catch {
      toast.error("Не удалось сохранить настройки колонизации");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[125]">
      <div className="fixed inset-0 bg-black/55" aria-hidden="true" />
      <div className="fixed inset-0">
        <Dialog.Panel className="glass panel-border h-full w-full rounded-none p-4">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="font-display text-2xl tracking-wide text-arc-accent">Настройки игры</Dialog.Title>
            <button onClick={onClose} className="panel-border inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:text-arc-accent">
              <X size={16} />
            </button>
          </div>

          <div className="grid h-[calc(100vh-92px)] gap-4 md:grid-cols-[260px_1fr]">
            <aside className="panel-border overflow-auto rounded-xl bg-black/25 p-2">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`mb-2 block w-full rounded-lg px-3 py-2 text-left text-sm transition ${activeCategory === cat.id ? "bg-arc-accent/20 text-arc-accent" : "text-slate-300 hover:text-white"}`}
                >
                  {cat.label}
                </button>
              ))}
            </aside>

            <section className="panel-border overflow-auto rounded-xl bg-black/25 p-4">
              {loading ? (
                <div className="text-sm text-slate-400">Загрузка настроек...</div>
              ) : (
                <div className="space-y-4">
                  {activeCategory === "economy" && (
                    <div className="space-y-4 rounded-lg border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm text-slate-200">
                        <Coins size={15} className="text-arc-accent" />
                        Базовый доход за каждый резолв хода
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Дукаты / ход</label>
                          <input
                            type="number"
                            min={0}
                            value={baseDucatsPerTurn}
                            onChange={(e) => setBaseDucatsPerTurn(Math.max(0, Number(e.target.value) || 0))}
                            className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Золото / ход</label>
                          <input
                            type="number"
                            min={0}
                            value={baseGoldPerTurn}
                            onChange={(e) => setBaseGoldPerTurn(Math.max(0, Number(e.target.value) || 0))}
                            className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                          />
                        </div>
                      </div>

                      <button
                        onClick={saveEconomy}
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
                      >
                        <Save size={14} />
                        Сохранить
                      </button>
                    </div>
                  )}

                  {activeCategory === "colonization" && (
                    <div className="space-y-4 rounded-lg border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm text-slate-200">
                        <Flag size={15} className="text-arc-accent" />
                        Лимиты колонизации
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Макс. одновременных колонизаций</label>
                          <input
                            type="number"
                            min={1}
                            value={maxActiveColonizations}
                            onChange={(e) => setMaxActiveColonizations(Math.max(1, Number(e.target.value) || 1))}
                            className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs text-slate-300">Прирост очков колонизации / ход</label>
                          <input
                            type="number"
                            min={0}
                            value={colonizationPointsPerTurn}
                            onChange={(e) => setColonizationPointsPerTurn(Math.max(0, Number(e.target.value) || 0))}
                            className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm"
                          />
                        </div>
                      </div>

                      <button
                        onClick={saveColonization}
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
                      >
                        <Save size={14} />
                        Сохранить
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}

