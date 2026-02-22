import { Dialog } from "@headlessui/react";
import { useEffect, useMemo, useState } from "react";
import { Coins, Palette, Save, Upload, X } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { fetchPublicCustomizationPrices, type CustomizationPrices, updateOwnCountryCustomization } from "../lib/api";

type Props = {
  open: boolean;
  token: string;
  country: {
    name: string;
    color: string;
    flagUrl?: string | null;
    crestUrl?: string | null;
  };
  currentDucats: number;
  ducatsIconUrl?: string | null;
  onClose: () => void;
  onSaved: (payload: { name: string; color: string; flagUrl?: string | null; crestUrl?: string | null; ducats: number; chargedDucats: number }) => void;
};

const defaultPrices: CustomizationPrices = {
  renameDucats: 20,
  recolorDucats: 10,
  flagDucats: 15,
  crestDucats: 15,
};

function formatCompact(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const units = [
    { n: 1_000_000_000_000, s: "T" },
    { n: 1_000_000_000, s: "B" },
    { n: 1_000_000, s: "M" },
    { n: 1_000, s: "K" },
  ] as const;

  for (const unit of units) {
    if (abs >= unit.n) {
      const scaled = abs / unit.n;
      const text =
        scaled >= 100
          ? Math.floor(scaled).toString()
          : scaled >= 10
            ? scaled.toFixed(1).replace(/\.0$/, "")
            : scaled.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
      return `${sign}${text}${unit.s}`;
    }
  }

  return `${sign}${Math.floor(abs)}`;
}

function DucatValue({ value, iconUrl, className = "" }: { value: number; iconUrl?: string | null; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`.trim()}>
      {iconUrl ? (
        <img src={iconUrl} alt="" className="h-[13px] w-[13px] rounded-sm object-contain" />
      ) : (
        <Coins size={13} className="text-amber-300" />
      )}
      <span>{formatCompact(value)}</span>
    </span>
  );
}

async function isImageWithinMaxSize(file: File, maxSize = 256): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const ok = img.width <= maxSize && img.height <= maxSize;
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}

function FilePicker({ label, file, onChange }: { label: string; file: File | null; onChange: (file: File | null) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-300">{label}</label>
      <label className="panel-border flex cursor-pointer items-center gap-2 rounded-lg bg-black/35 px-3 py-2 text-sm text-slate-200 transition hover:border-arc-accent/40">
        <Upload size={14} className="text-arc-accent" />
        <span className="truncate">{file ? file.name : "Выбрать изображение"}</span>
        <input type="file" accept="image/*" className="hidden" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      </label>
      <p className="mt-1 text-xs text-slate-500">До 4MB, максимум 256x256</p>
    </div>
  );
}

export function CountryCustomizationModal({ open, token, country, currentDucats, ducatsIconUrl, onClose, onSaved }: Props) {
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prices, setPrices] = useState<CustomizationPrices>(defaultPrices);
  const [name, setName] = useState(country.name);
  const [color, setColor] = useState(country.color);
  const [flagFile, setFlagFile] = useState<File | null>(null);
  const [crestFile, setCrestFile] = useState<File | null>(null);
  const [flagPreviewUrl, setFlagPreviewUrl] = useState<string | null>(null);
  const [crestPreviewUrl, setCrestPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setName(country.name);
    setColor(country.color);
    setFlagFile(null);
    setCrestFile(null);
  }, [open, country.color, country.name]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoadingPrices(true);
    fetchPublicCustomizationPrices()
      .then((next) => {
        if (!cancelled) {
          setPrices(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          toast.error("Не удалось загрузить цены кастомизации");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingPrices(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!flagFile) {
      setFlagPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(flagFile);
    setFlagPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [flagFile]);

  useEffect(() => {
    if (!crestFile) {
      setCrestPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(crestFile);
    setCrestPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [crestFile]);

  const normalizedName = name.trim();
  const normalizedColor = color.trim();
  const nameChanged = normalizedName.length >= 2 && normalizedName !== country.name;
  const colorChanged = /^#[0-9a-fA-F]{6}$/.test(normalizedColor) && normalizedColor.toLowerCase() !== country.color.toLowerCase();
  const totalCost = (nameChanged ? prices.renameDucats : 0) + (colorChanged ? prices.recolorDucats : 0) + (flagFile ? prices.flagDucats : 0) + (crestFile ? prices.crestDucats : 0);
  const canAfford = currentDucats >= totalCost;

  const changes = useMemo(
    () => [
      { label: "Переименование", enabled: nameChanged, cost: prices.renameDucats },
      { label: "Смена цвета", enabled: colorChanged, cost: prices.recolorDucats },
      { label: "Смена флага", enabled: Boolean(flagFile), cost: prices.flagDucats },
      { label: "Смена герба", enabled: Boolean(crestFile), cost: prices.crestDucats },
    ],
    [colorChanged, crestFile, flagFile, nameChanged, prices],
  );

  const submit = async () => {
    if (!nameChanged && !colorChanged && !flagFile && !crestFile) {
      toast.error("Нет изменений для сохранения");
      return;
    }

    if (normalizedName.length > 0 && normalizedName.length < 2) {
      toast.error("Название страны должно быть минимум 2 символа");
      return;
    }

    if (normalizedColor && !/^#[0-9a-fA-F]{6}$/.test(normalizedColor)) {
      toast.error("Введите корректный HEX-цвет");
      return;
    }

    if (!canAfford) {
      toast.error(`Недостаточно дукатов: нужно ${totalCost}, доступно ${currentDucats}`);
      return;
    }

    if (flagFile && !(await isImageWithinMaxSize(flagFile))) {
      toast.error("Флаг должен быть максимум 256x256");
      return;
    }
    if (crestFile && !(await isImageWithinMaxSize(crestFile))) {
      toast.error("Герб должен быть максимум 256x256");
      return;
    }

    setSaving(true);
    try {
      const result = await updateOwnCountryCustomization(token, {
        countryName: nameChanged ? normalizedName : undefined,
        countryColor: colorChanged ? normalizedColor : undefined,
        flagFile,
        crestFile,
      });

      onSaved({
        name: result.country.name,
        color: result.country.color,
        flagUrl: result.country.flagUrl,
        crestUrl: result.country.crestUrl,
        ducats: result.resources.ducats,
        chargedDucats: result.chargedDucats,
      });
      toast.success(`Изменения применены (-${result.chargedDucats} дукатов)`);
      onClose();
    } catch (err) {
      const code = err instanceof Error ? err.message : "COUNTRY_CUSTOMIZATION_FAILED";
      if (code === "INSUFFICIENT_DUCATS") {
        toast.error("Недостаточно дукатов");
      } else if (code === "IMAGE_DIMENSIONS_TOO_LARGE") {
        toast.error("Изображение должно быть максимум 256x256");
      } else if (code === "FILE_TOO_LARGE") {
        toast.error("Файл слишком большой (до 4MB)");
      } else if (code === "ONLY_IMAGES") {
        toast.error("Разрешены только изображения");
      } else if (code === "NO_CHANGES") {
        toast.error("Нет изменений для сохранения");
      } else {
        toast.error("Не удалось применить изменения страны");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[130]">
      <motion.div
        aria-hidden="true"
        className="fixed inset-0 bg-black/60"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
      />
      <div className="fixed inset-0 grid place-items-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.99 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="w-full max-w-3xl"
        >
        <Dialog.Panel className="glass panel-border w-full rounded-2xl p-4 md:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <Dialog.Title className="font-display text-2xl tracking-wide text-arc-accent">Кастомизация страны</Dialog.Title>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                <Coins size={13} />
                Доступно: <DucatValue value={currentDucats} iconUrl={ducatsIconUrl} className="font-semibold text-slate-200" />
              </div>
            </div>
            <button onClick={onClose} className="panel-border inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:text-arc-accent">
              <X size={16} />
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-[1.25fr_.85fr]">
            <section className="space-y-4 rounded-xl border border-white/10 bg-black/20 p-4">
              <div>
                <label className="mb-1 block text-xs text-slate-300">Название страны</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm outline-none transition focus:border-arc-accent/60"
                  placeholder="Название страны"
                />
              </div>

              <div>
                <label className="mb-1 flex items-center gap-2 text-xs text-slate-300">
                  <Palette size={13} /> Цвет страны
                </label>
                <div className="flex items-center gap-2">
                  <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#4ade80"} onChange={(e) => setColor(e.target.value)} className="panel-border h-10 w-12 rounded-lg bg-black/35 p-1" />
                  <input
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="flex-1 rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm outline-none transition focus:border-arc-accent/60"
                    placeholder="#4ade80"
                  />
                  <span className="panel-border h-9 w-9 rounded-md" style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#111827" }} />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <FilePicker label="Новый флаг" file={flagFile} onChange={setFlagFile} />
                <FilePicker label="Новый герб" file={crestFile} onChange={setCrestFile} />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="panel-border rounded-lg bg-black/25 p-2">
                  <div className="mb-2 text-xs text-slate-400">Предпросмотр флага</div>
                  <div className="h-24 overflow-hidden rounded-md bg-black/30">
                    {flagPreviewUrl ? (
                      <img src={flagPreviewUrl} alt="flag preview" className="h-full w-full object-contain p-1" />
                    ) : country.flagUrl ? (
                      <img src={country.flagUrl} alt="current flag" className="h-full w-full object-contain p-1 opacity-80" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-slate-500">Не выбран</div>
                    )}
                  </div>
                </div>

                <div className="panel-border rounded-lg bg-black/25 p-2">
                  <div className="mb-2 text-xs text-slate-400">Предпросмотр герба</div>
                  <div className="h-24 overflow-hidden rounded-md bg-black/30">
                    {crestPreviewUrl ? (
                      <img src={crestPreviewUrl} alt="crest preview" className="h-full w-full object-contain p-1" />
                    ) : country.crestUrl ? (
                      <img src={country.crestUrl} alt="current crest" className="h-full w-full object-contain p-1 opacity-80" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-slate-500">Не выбран</div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-semibold text-slate-200">Стоимость изменений</div>
              {loadingPrices && <div className="text-xs text-slate-400">Загрузка цен...</div>}

              <div className="space-y-2 text-sm">
                {changes.map((item) => (
                  <div key={item.label} className={`flex items-center justify-between rounded-lg px-2 py-1 ${item.enabled ? "bg-white/5 text-slate-100" : "text-slate-500"}`}>
                    <span>{item.label}</span>
                    <DucatValue value={item.enabled ? item.cost : 0} iconUrl={ducatsIconUrl} className={item.enabled ? "text-slate-200" : "text-slate-500"} />
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">Итого</span>
                  <strong className="text-arc-accent">
                    <DucatValue value={totalCost} iconUrl={ducatsIconUrl} className="text-arc-accent" />
                  </strong>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs">
                  <span className="text-slate-400">После покупки</span>
                  <DucatValue value={currentDucats - totalCost} iconUrl={ducatsIconUrl} className={canAfford ? "text-slate-300" : "text-rose-300"} />
                </div>
              </div>

              <button
                type="button"
                onClick={submit}
                disabled={saving || totalCost <= 0 || !canAfford}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
              >
                <Save size={14} />
                {saving ? "Сохраняем..." : "Купить и применить"}
              </button>
            </section>
          </div>
        </Dialog.Panel>
        </motion.div>
      </div>
    </Dialog>
  );
}
