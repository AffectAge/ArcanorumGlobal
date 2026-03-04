import { Dialog } from "@headlessui/react";
import { motion } from "framer-motion";
import { Globe2, LogOut, ShieldAlert, X } from "lucide-react";
import type { MarketCatalogItem, MarketInvite } from "../lib/api";
import { CustomSelect } from "./CustomSelect";

type Props = {
  open: boolean;
  onClose: () => void;
  countryId: string;
  currentMarket: MarketCatalogItem | null;
  pendingLeave: boolean;
  onLeave: () => void;
  incomingInvites: MarketInvite[];
  pendingInviteActionId: string | null;
  onInviteAction: (inviteId: string, action: "accept" | "reject") => void;
  selectableMarkets: MarketCatalogItem[];
  selectedMarketId: string;
  onSelectMarket: (marketId: string) => void;
  selectedMarket: MarketCatalogItem | null;
  pendingJoin: boolean;
  onJoin: () => void;
};

export function CurrentMarketMembershipModal({
  open,
  onClose,
  countryId,
  currentMarket,
  pendingLeave,
  onLeave,
  incomingInvites,
  pendingInviteActionId,
  onInviteAction,
  selectableMarkets,
  selectedMarketId,
  onSelectMarket,
  selectedMarket,
  pendingJoin,
  onJoin,
}: Props) {
  if (!open) return null;

  const isOwner = Boolean(currentMarket && currentMarket.ownerCountryId === countryId);

  return (
    <Dialog open={open} onClose={onClose} className="fixed inset-0 z-[179]">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      <div className="absolute inset-4 flex items-center justify-center">
        <Dialog.Panel
          as={motion.div}
          initial={{ opacity: 0, y: 12, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="panel-border w-[min(92vw,700px)] rounded-2xl bg-[#0b111b] p-4"
        >
          <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <h3 className="text-lg font-semibold text-white">Текущее членство</h3>
              <p className="text-xs text-white/60">Информация о текущем рынке и выход из него</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/35 text-white/70"
            >
              <X size={16} />
            </button>
          </div>

          {!currentMarket ? (
            <div className="rounded-lg border border-dashed border-white/15 bg-black/20 p-4 text-sm text-white/55">
              Ваша страна сейчас не состоит в рынке.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white/75">
                <div className="font-semibold text-white/90">{currentMarket.name}</div>
                <div className="mt-1 text-xs text-white/60">
                  Видимость: {currentMarket.visibility} · Участников: {currentMarket.membersCount}
                </div>
                <div className="mt-1 text-xs text-white/60">Владелец: {currentMarket.ownerCountryName}</div>
              </div>

              {isOwner ? (
                <div className="rounded-lg border border-amber-400/35 bg-amber-500/10 p-3 text-xs text-amber-200">
                  <div className="mb-1 inline-flex items-center gap-1.5 font-semibold">
                    <ShieldAlert size={13} /> Вы владелец рынка
                  </div>
                  <div>Для выхода сначала передайте владение рынком в модалке «Управление».</div>
                </div>
              ) : (
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={pendingLeave}
                    onClick={onLeave}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/20 px-3 text-xs font-semibold text-amber-200 disabled:opacity-50"
                  >
                    <LogOut size={13} /> Выйти из рынка
                  </button>
                </div>
              )}

              <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="mb-2 text-sm font-semibold text-white/85">Входящие приглашения</div>
                <div className="space-y-2">
                  {incomingInvites.map((invite) => (
                    <div key={invite.id} className="rounded-lg border border-white/10 bg-black/25 p-2 text-xs text-white/70">
                      <div className="font-semibold text-white/85">{invite.marketName ?? invite.marketId}</div>
                      <div className="text-white/50">От: {invite.fromCountryName ?? invite.fromCountryId}</div>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={pendingInviteActionId === invite.id}
                          onClick={() => onInviteAction(invite.id, "accept")}
                          className="h-7 rounded-md border border-emerald-400/40 bg-emerald-500/20 px-2 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-500/30 disabled:opacity-50"
                        >
                          Принять
                        </button>
                        <button
                          type="button"
                          disabled={pendingInviteActionId === invite.id}
                          onClick={() => onInviteAction(invite.id, "reject")}
                          className="h-7 rounded-md border border-red-400/40 bg-red-500/20 px-2 text-[11px] font-semibold text-red-200 transition hover:bg-red-500/30 disabled:opacity-50"
                        >
                          Отклонить
                        </button>
                      </div>
                    </div>
                  ))}
                  {incomingInvites.length === 0 && <div className="text-xs text-white/45">Приглашений нет.</div>}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white/85">
                  <Globe2 size={14} className="text-cyan-300" />
                  Рынки мира
                </div>
                <div className="space-y-2">
                  <CustomSelect
                    value={selectedMarketId}
                    onChange={onSelectMarket}
                    options={selectableMarkets.map((market) => ({
                      value: market.id,
                      label: `${market.name} [${market.visibility}]`,
                    }))}
                    placeholder="Выберите рынок"
                    buttonClassName="h-9 text-xs"
                  />
                  {selectedMarket && (
                    <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[11px] text-white/65">
                      Владелец: {selectedMarket.ownerCountryName} · Участников: {selectedMarket.membersCount}
                      {selectedMarket.hasPendingJoinRequest ? " · Запрос уже отправлен" : ""}
                    </div>
                  )}
                </div>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    disabled={pendingJoin || !selectedMarket || selectedMarket.hasPendingJoinRequest}
                    onClick={onJoin}
                    className="h-9 rounded-lg border border-cyan-400/40 bg-cyan-500/20 px-3 text-xs font-semibold text-cyan-200 disabled:opacity-50"
                  >
                    {selectedMarket?.visibility === "private" ? "Отправить запрос" : "Вступить"}
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-white/50">
                  Публичный рынок: мгновенное вступление. Приватный рынок: отправка запроса владельцу.
                </div>
              </div>
            </div>
          )}
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
