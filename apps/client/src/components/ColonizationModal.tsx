import { Dialog, Listbox } from "@headlessui/react";
import { Check, ChevronDown, Flag, Lock, Settings, Trophy, X } from "lucide-react";
import type { Country } from "@arcanorum/shared";
import { Tooltip } from "./Tooltip";

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
  colonizationIconUrl?: string | null;
  colonizationLimit?: { active: number; max: number } | null;
  colonizedProvinceOptions?: Array<{ id: string; name: string }>;
  selectedColonizedProvinceId?: string | null;
  onSelectColonizedProvince?: (provinceId: string) => void;
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
  colonizationIconUrl,
  colonizationLimit,
  colonizedProvinceOptions = [],
  selectedColonizedProvinceId,
  onSelectColonizedProvince,
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
  const leadersTop3 = participants.slice(0, 3);
  const myProgress = currentCountryId ? (progressByCountry[currentCountryId] ?? 0) : 0;
  const myProgressPct = Math.max(0, Math.min(100, (myProgress / Math.max(1, colonizationCost)) * 100));
  const actionBtnBase =
    "inline-flex h-10 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition disabled:opacity-40";

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[130]">
      <div className="fixed inset-0 bg-black/55" aria-hidden="true" />
      <div className="fixed inset-0">
        <Dialog.Panel className="glass panel-border h-full w-full rounded-none p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-white">
                <Flag size={18} className="text-emerald-300" />
                <span className="truncate">Колонизация: {provinceName ?? provinceId ?? "Провинция"}</span>
              </Dialog.Title>
              {provinceId && <div className="text-xs text-white/50">{provinceId}</div>}
            </div>
            <Tooltip content="Закрыть окно колонизации" placement="left">
              <button onClick={onClose} className="panel-border inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-white/70 hover:text-white">
                <X size={16} />
              </button>
            </Tooltip>
          </div>

          {colonizedProvinceOptions.length > 0 && onSelectColonizedProvince && (
            <div className="mb-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="mb-1 text-xs text-white/55">Показать данные по нашей колонии</div>
              <Listbox value={selectedColonizedProvinceId ?? provinceId ?? ""} onChange={onSelectColonizedProvince}>
                <div className="relative">
                  <Listbox.Button className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 pr-10 text-left text-sm text-white/85">
                    {colonizedProvinceOptions.find((p) => p.id === (selectedColonizedProvinceId ?? provinceId ?? ""))?.name ??
                      colonizedProvinceOptions.find((p) => p.id === (selectedColonizedProvinceId ?? provinceId ?? ""))?.id ??
                      "Выберите провинцию"}
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/50" />
                  </Listbox.Button>
                  <Listbox.Options className="arc-scrollbar panel-border absolute z-20 mt-2 max-h-56 w-full overflow-auto rounded-lg bg-[#0b111b]/95 p-1 text-sm shadow-2xl outline-none">
                    {colonizedProvinceOptions.map((option) => (
                      <Listbox.Option
                        key={option.id}
                        value={option.id}
                        className={({ active }) =>
                          `relative cursor-pointer rounded-md px-3 py-2 pr-8 transition ${
                            active ? "bg-arc-accent/15 text-arc-accent" : "text-white/80"
                          }`
                        }
                      >
                        {({ selected }) => (
                          <>
                            <div className="truncate">{option.name}</div>
                            <div className="text-[11px] text-white/45">{option.id}</div>
                            {selected && <Check size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-arc-accent" />}
                          </>
                        )}
                      </Listbox.Option>
                    ))}
                  </Listbox.Options>
                </div>
              </Listbox>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[420px_1fr]">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-white/50">Стоимость колонизации</div>
              <div className="mt-1 flex items-center gap-2 text-lg font-semibold text-emerald-300">
                {colonizationIconUrl ? (
                  <img src={colonizationIconUrl} alt="" className="h-5 w-5 rounded object-contain" />
                ) : (
                  <Flag size={18} className="text-emerald-300" />
                )}
                <span>{colonizationCost}</span>
              </div>
              <div className="mt-2 text-xs text-white/60">
                Статус:{" "}
                {ownerCountryId
                  ? `занята (${countryById.get(ownerCountryId)?.name ?? ownerCountryId})`
                  : colonizationDisabled
                    ? "запрещено"
                    : "доступно"}
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-white/60">
                <span>Ваш прогресс: {myProgress.toFixed(1)} / {colonizationCost}</span>
                <span className="text-emerald-300">{myProgressPct.toFixed(0)}%</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-white/10">
                <div className="h-full rounded-full bg-emerald-400/85 transition-all" style={{ width: `${myProgressPct}%` }} />
              </div>
              {colonizationLimit && (
                <Tooltip
                  content="Лимит активных колонизаций вашей страны: текущие активные колонии / максимум из настроек игры"
                  placement="top"
                >
                  <div className="mt-2 flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-xs">
                  <span className="text-white/65">Лимит колонизаций</span>
                  <span
                    className={
                      colonizationLimit.active >= colonizationLimit.max
                        ? "text-rose-300"
                        : colonizationLimit.active > 0
                          ? "text-amber-300"
                          : "text-emerald-300"
                    }
                  >
                    {colonizationLimit.active} / {colonizationLimit.max}
                  </span>
                  </div>
                </Tooltip>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-white/50">Лидер гонки</div>
              {leadersTop3.length > 0 ? (
                <div className="mt-1 space-y-1.5">
                  {leadersTop3.map(([countryId, points], index) => {
                    const country = countryById.get(countryId);
                    const pct = Math.max(0, Math.min(100, (points / Math.max(1, colonizationCost)) * 100));
                    return (
                      <div key={countryId} className="flex items-center gap-2 text-sm text-white/85">
                        <Trophy
                          size={15}
                          className={index === 0 ? "text-amber-300" : index === 1 ? "text-slate-300" : "text-orange-300"}
                        />
                        {country?.flagUrl ? (
                          <img src={country.flagUrl} alt="" className="h-4 w-5 rounded-sm object-cover" />
                        ) : (
                          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: country?.color ?? "#94a3b8" }} />
                        )}
                        <span className="truncate">{country?.name ?? countryId}</span>
                        <span className="text-white/50">•</span>
                        <span className="text-emerald-300">
                          {points.toFixed(1)} ({pct.toFixed(0)}%)
                        </span>
                      </div>
                    );
                  })}
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
              <div className="arc-scrollbar max-h-[calc(100vh-22rem)] space-y-2 overflow-auto pr-1">
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
                          {points.toFixed(1)} / {colonizationCost} ({pct.toFixed(0)}%)
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
              <Tooltip content="Открыть редактирование данных провинции (только для админа)" placement="top">
                <button
                  onClick={onOpenAdminProvinceEditor}
                  aria-label="Изменить провинцию (админ)"
                  className={`${actionBtnBase} h-10 w-10 px-0 border-rose-400/30 bg-rose-500/10 text-rose-200 hover:border-rose-300/50 hover:bg-rose-400/15`}
                >
                  <Settings size={16} />
                </button>
              </Tooltip>
            )}
            <Tooltip content={canCancel ? "Остановить участие вашей страны в колонизации этой провинции" : "У вашей страны нет активной колонизации этой провинции"} placement="top">
              <button
                onClick={onCancel}
                disabled={!canCancel || pending}
                className={`${actionBtnBase} border-amber-400/30 bg-amber-500/10 text-amber-200 hover:border-amber-300/50 hover:bg-amber-400/15`}
              >
                Отменить колонизацию
              </button>
            </Tooltip>
            <Tooltip content={canStart ? "Начать колонизацию: провинция добавится в активные колонии страны" : "Начать колонизацию сейчас нельзя (проверьте статус/лимит)"} placement="top">
              <button
                onClick={onStart}
                disabled={!canStart || pending}
                className={`${actionBtnBase} border-emerald-400/40 bg-emerald-500/85 text-black hover:bg-emerald-400`}
              >
                Начать колонизацию
              </button>
            </Tooltip>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
