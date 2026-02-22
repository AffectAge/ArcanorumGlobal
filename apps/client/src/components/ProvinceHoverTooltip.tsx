import { Crown, Flag, Sparkles } from "lucide-react";

type ColonizerRow = {
  countryId: string;
  countryName: string;
  countryColor: string;
  percent: number;
  hasQueuedOrder: boolean;
};

type Props = {
  open: boolean;
  x: number;
  y: number;
  provinceName: string;
  areaKm2: number | null;
  ownerName: string;
  colonizers: ColonizerRow[];
};

function formatKm2(areaKm2: number | null): string | null {
  if (areaKm2 == null || !Number.isFinite(areaKm2) || areaKm2 <= 0) return null;
  return `${new Intl.NumberFormat("ru-RU").format(Math.round(areaKm2))} км²`;
}

export function ProvinceHoverTooltip({ open, x, y, provinceName, areaKm2, ownerName, colonizers }: Props) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute z-40 min-w-[220px] max-w-[320px] rounded-xl"
      style={{ left: x + 14, top: y + 14 }}
    >
      <div className="glass panel-border rounded-xl bg-[#0b111b]/90 px-3 py-2 shadow-2xl backdrop-blur-xl">
        <div className="text-sm font-semibold text-white">{provinceName}</div>
        {formatKm2(areaKm2) && <div className="mt-1 text-xs text-white/55">Площадь: {formatKm2(areaKm2)}</div>}
        <div className="mt-1 flex items-center gap-1.5 text-xs text-white/75">
          <Crown size={13} className="text-amber-300" />
          <span>Владелец: {ownerName}</span>
        </div>

        {colonizers.length > 0 && (
          <div className="mt-2 border-t border-white/10 pt-2">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/55">
              <Flag size={12} className="text-emerald-300" />
              <span>Колонизация</span>
            </div>
            <div className="space-y-1.5">
              {colonizers.map((row) => (
                <div key={row.countryId} className="flex items-center justify-between gap-2 rounded-md bg-white/5 px-2 py-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: row.countryColor }} />
                    <span className="truncate text-xs text-white/85">{row.countryName}</span>
                    {row.hasQueuedOrder && <Sparkles size={11} className="text-cyan-300" />}
                  </span>
                  <span className="text-xs font-semibold text-emerald-300">{row.percent.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
