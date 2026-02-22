import { Dialog } from "@headlessui/react";
import { Flag, Lock, Trophy, X } from "lucide-react";
import type { Country } from "@arcanorum/shared";

type Props = {
  open: boolean;
  provinceId: string | null;
  provinceName: string | null;
  ownerCountryId: string | null;
  colonizationCost: number;
  colonizationDisabled: boolean;
  progressByCountry: Record<string, number>;
  currentCountryId: string | null;
  countries: Country[];
  canStart: boolean;
  canCancel: boolean;
  pending?: boolean;
  onClose: () => void;
  onStart: () => void;
  onCancel: () => void;
  canOpenAdminProvinceEditor?: boolean;
  onOpenAdminProvinceEditor?: () => void;
};

export function ColonizationModal({
  open,
  provinceId,
  provinceName,
  ownerCountryId,
  colonizationCost,
  colonizationDisabled,
  progressByCountry,
  currentCountryId,
  countries,
  canStart,
  canCancel,
  pending,
  onClose,
  onStart,
  onCancel,
  canOpenAdminProvinceEditor,
  onOpenAdminProvinceEditor,
}: Props) {
  const countryById = new Map(countries.map((c) => [c.id, c] as const));
  const participants = Object.entries(progressByCountry).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const leader = participants[0] ?? null;
  const myProgress = currentCountryId ? (progressByCountry[currentCountryId] ?? 0) : 0;

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[130]">
      <div className="fixed inset-0 bg-black/55" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="panel-border w-full max-w-xl rounded-2xl bg-[#0b111b]/95 p-4 shadow-2xl backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-white">
                <Flag size={18} className="text-emerald-300" />
                <span className="truncate">Колонизация: {provinceName ?? provinceId ?? "Провинция"}</span>
              </Dialog.Title>
              {provinceId && <div className="text-xs text-white/50">{provinceId}</div>}
            </div>
            <button onClick={onClose} className="panel-border inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-white/70 hover:text-white">
              <X size={16} />
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-white/50">Стоимость колонизации</div>
              <div className="mt-1 text-lg font-semibold text-emerald-300">{colonizationCost}</div>
              <div className="mt-2 text-xs text-white/60">
                Статус:{" "}
                {ownerCountryId
                  ? `занята (${countryById.get(ownerCountryId)?.name ?? ownerCountryId})`
                  : colonizationDisabled
                    ? "запрещено"
                    : "доступно"}
              </div>
              <div className="mt-1 text-xs text-white/60">Ваш прогресс: {myProgress.toFixed(1)}</div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-white/50">Лидер гонки</div>
              {leader ? (
                <div className="mt-1 flex items-center gap-2 text-sm text-white/85">
                  <Trophy size={15} className="text-amber-300" />
                  <span>{countryById.get(leader[0])?.name ?? leader[0]}</span>
                  <span className="text-white/50">•</span>
                  <span className="text-emerald-300">{leader[1].toFixed(1)}</span>
                </div>
              ) : (
                <div className="mt-1 text-sm text-white/50">Нет участников</div>
              )}
              {colonizationDisabled && (
                <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-200">
                  <Lock size={13} />
                  Колонизация запрещена администратором
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="mb-2 text-xs text-white/50">Участники гонки</div>
            {participants.length === 0 ? (
              <div className="text-sm text-white/50">Пока никто не колонизирует эту провинцию</div>
            ) : (
              <div className="space-y-2">
                {participants.map(([countryId, points]) => {
                  const country = countryById.get(countryId);
                  const pct = Math.max(0, Math.min(100, (points / Math.max(1, colonizationCost)) * 100));
                  return (
                    <div key={countryId} className="rounded-lg border border-white/10 bg-black/25 p-2">
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 text-white/80">
                          {country?.flagUrl ? (
                            <img src={country.flagUrl} alt="" className="h-4 w-5 rounded-sm object-cover" />
                          ) : (
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: country?.color ?? "#94a3b8" }} />
                          )}
                          <span>{country?.name ?? countryId}</span>
                        </div>
                        <span className="text-emerald-300">
                          {points.toFixed(1)} / {colonizationCost}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-emerald-400/80 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {canOpenAdminProvinceEditor && onOpenAdminProvinceEditor && (
              <button
                onClick={onOpenAdminProvinceEditor}
                className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-200"
              >
                Изменить провинцию (админ)
              </button>
            )}
            <button onClick={onClose} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
              Закрыть
            </button>
            <button
              onClick={onCancel}
              disabled={!canCancel || pending}
              className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-200 disabled:opacity-40"
            >
              Отменить колонизацию
            </button>
            <button
              onClick={onStart}
              disabled={!canStart || pending}
              className="rounded-lg bg-emerald-500/85 px-3 py-2 text-sm font-semibold text-black disabled:opacity-40"
            >
              Начать колонизацию
            </button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
