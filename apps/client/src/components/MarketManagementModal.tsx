import { Dialog } from "@headlessui/react";
import { motion } from "framer-motion";
import { Crown, ImagePlus, Save, Send, ShieldCheck, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  createMarketInvite,
  fetchCountries,
  fetchMarketDetails,
  fetchMarketInvites,
  respondMarketInvite,
  transferMarketOwner,
  updateMarket,
  type MarketDetails,
  type MarketInvite,
} from "../lib/api";
import { CustomSelect } from "./CustomSelect";
import { Tooltip } from "./Tooltip";

type Props = {
  open: boolean;
  onClose: () => void;
  token: string;
  countryId: string;
  marketId: string | null;
  onUpdated?: () => void;
};

export function MarketManagementModal({ open, onClose, token, countryId, marketId, onUpdated }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [marketDetails, setMarketDetails] = useState<MarketDetails | null>(null);
  const [outgoingInvites, setOutgoingInvites] = useState<MarketInvite[]>([]);
  const [countries, setCountries] = useState<Array<{ id: string; name: string; flagUrl?: string | null }>>([]);

  const [marketNameEdit, setMarketNameEdit] = useState("");
  const [marketVisibilityEdit, setMarketVisibilityEdit] = useState<"public" | "private">("public");
  const [marketLogoFile, setMarketLogoFile] = useState<File | null>(null);

  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteTargetCountryId, setInviteTargetCountryId] = useState("");
  const [transferOwnerCountryId, setTransferOwnerCountryId] = useState("");

  const [pendingInvite, setPendingInvite] = useState(false);
  const [pendingCancelInviteId, setPendingCancelInviteId] = useState<string | null>(null);
  const [pendingTransferOwner, setPendingTransferOwner] = useState(false);

  const load = async () => {
    if (!marketId) return;
    setLoading(true);
    try {
      const [details, invites, allCountries] = await Promise.all([
        fetchMarketDetails(token, marketId),
        fetchMarketInvites(token, marketId),
        fetchCountries(),
      ]);
      setMarketDetails(details.market);
      setOutgoingInvites(invites.invites ?? []);
      setCountries(allCountries);
      setMarketNameEdit(details.market.name);
      setMarketVisibilityEdit(details.market.visibility);
      setMarketLogoFile(null);
      setTransferOwnerCountryId(details.market.members.find((member) => !member.isOwner)?.countryId ?? "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить управление рынком");
      setMarketDetails(null);
      setOutgoingInvites([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !marketId) return;
    void load();
  }, [open, marketId]);

  const isOwner = marketDetails?.ownerCountryId === countryId;

  const inviteOptions = useMemo(() => {
    const memberIds = new Set(marketDetails?.memberCountryIds ?? []);
    const pendingTargets = new Set(
      outgoingInvites.filter((invite) => invite.status === "pending").map((invite) => invite.toCountryId),
    );
    const q = inviteSearch.trim().toLowerCase();
    return countries
      .filter((country) => !memberIds.has(country.id))
      .filter((country) => !pendingTargets.has(country.id))
      .filter((country) => {
        if (!q) return true;
        return country.name.toLowerCase().includes(q) || country.id.toLowerCase().includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((country) => ({ value: country.id, label: `${country.name} (${country.id})` }));
  }, [countries, inviteSearch, marketDetails?.memberCountryIds, outgoingInvites]);

  useEffect(() => {
    if (!inviteOptions.some((option) => option.value === inviteTargetCountryId)) {
      setInviteTargetCountryId(inviteOptions[0]?.value ?? "");
    }
  }, [inviteOptions, inviteTargetCountryId]);

  const transferOwnerOptions = useMemo(
    () =>
      (marketDetails?.members ?? [])
        .filter((member) => !member.isOwner)
        .map((member) => ({ value: member.countryId, label: `${member.countryName} (${member.countryId})` })),
    [marketDetails?.members],
  );

  useEffect(() => {
    if (!transferOwnerOptions.some((option) => option.value === transferOwnerCountryId)) {
      setTransferOwnerCountryId(transferOwnerOptions[0]?.value ?? "");
    }
  }, [transferOwnerOptions, transferOwnerCountryId]);

  const saveMarket = async () => {
    if (!marketId || !isOwner) return;
    setSaving(true);
    try {
      const updated = await updateMarket(token, marketId, {
        name: marketNameEdit,
        visibility: marketVisibilityEdit,
        logoFile: marketLogoFile,
      });
      setMarketDetails(updated.market);
      setMarketLogoFile(null);
      toast.success("Параметры рынка обновлены");
      onUpdated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить рынок");
    } finally {
      setSaving(false);
    }
  };

  const sendInvite = async () => {
    if (!marketId || !isOwner || !inviteTargetCountryId) return;
    setPendingInvite(true);
    try {
      await createMarketInvite(token, marketId, { toCountryId: inviteTargetCountryId });
      toast.success("Приглашение отправлено");
      await load();
      onUpdated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить приглашение");
    } finally {
      setPendingInvite(false);
    }
  };

  const cancelInvite = async (inviteId: string) => {
    setPendingCancelInviteId(inviteId);
    try {
      await respondMarketInvite(token, inviteId, "cancel");
      toast.success("Приглашение отменено");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отменить приглашение");
    } finally {
      setPendingCancelInviteId(null);
    }
  };

  const transferOwner = async () => {
    if (!marketId || !isOwner || !transferOwnerCountryId) return;
    setPendingTransferOwner(true);
    try {
      const updated = await transferMarketOwner(token, marketId, transferOwnerCountryId);
      setMarketDetails(updated.market);
      toast.success("Владелец рынка изменен");
      onUpdated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось передать владение");
    } finally {
      setPendingTransferOwner(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} className="fixed inset-0 z-[180]">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      <div className="absolute inset-4 flex items-center justify-center">
        <Dialog.Panel
          as={motion.div}
          initial={{ opacity: 0, y: 12, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="panel-border arc-scrollbar h-[min(92vh,920px)] w-[min(92vw,920px)] overflow-auto rounded-2xl bg-[#0b111b] p-4"
        >
          <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <h3 className="text-lg font-semibold text-white">Управление рынком</h3>
              <p className="text-xs text-white/60">Параметры рынка, исходящие приглашения и передача владения</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/35 text-white/70"
            >
              <X size={16} />
            </button>
          </div>

          {loading ? (
            <div className="text-sm text-white/60">Загрузка...</div>
          ) : !marketDetails ? (
            <div className="rounded-lg border border-dashed border-white/15 bg-black/20 p-4 text-sm text-white/55">
              Рынок не найден или нет доступа.
            </div>
          ) : !isOwner ? (
            <div className="rounded-lg border border-amber-400/35 bg-amber-500/10 p-4 text-sm text-amber-200">
              Управление доступно только владельцу рынка.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="mb-2 text-sm font-semibold text-white/80">Параметры рынка</div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Название</label>
                    <input
                      value={marketNameEdit}
                      onChange={(event) => setMarketNameEdit(event.target.value)}
                      className="panel-border h-9 w-full rounded-lg bg-black/35 px-3 text-sm text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Видимость</label>
                    <CustomSelect
                      value={marketVisibilityEdit}
                      onChange={(value) => setMarketVisibilityEdit(value as "public" | "private")}
                      options={[
                        { value: "public", label: "Публичный" },
                        { value: "private", label: "Приватный" },
                      ]}
                      buttonClassName="h-9 text-xs"
                    />
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <label className="panel-border inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-black/35 px-3 text-xs text-white/75 hover:border-arc-accent/40">
                    <ImagePlus size={13} />
                    Логотип
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => setMarketLogoFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void saveMarket()}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-3 text-xs font-semibold text-emerald-200 disabled:opacity-50"
                  >
                    <Save size={13} /> Сохранить
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white/80">
                  <UserPlus size={14} className="text-arc-accent" />
                  Отправить приглашение
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_220px_auto]">
                  <input
                    value={inviteSearch}
                    onChange={(event) => setInviteSearch(event.target.value)}
                    placeholder="Поиск страны"
                    className="panel-border h-9 rounded-lg bg-black/35 px-3 text-sm text-white outline-none"
                  />
                  <CustomSelect
                    value={inviteTargetCountryId}
                    onChange={setInviteTargetCountryId}
                    options={inviteOptions}
                    placeholder="Выберите страну"
                    buttonClassName="h-9 text-xs"
                  />
                  <Tooltip content="Отправить приглашение в рынок">
                    <button
                      type="button"
                      disabled={pendingInvite || !inviteTargetCountryId}
                      onClick={() => void sendInvite()}
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-3 text-emerald-200 disabled:opacity-50"
                    >
                      <Send size={14} />
                    </button>
                  </Tooltip>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="mb-2 text-sm font-semibold text-white/80">История исходящих приглашений</div>
                <div className="space-y-1">
                  {outgoingInvites.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-white/80">{invite.toCountryName ?? invite.toCountryId}</div>
                        <div className="text-white/50">
                          Статус: {invite.status} · Истекает: {new Date(invite.expiresAt).toLocaleDateString("ru-RU")}
                        </div>
                      </div>
                      {invite.status === "pending" ? (
                        <button
                          type="button"
                          disabled={pendingCancelInviteId === invite.id}
                          onClick={() => void cancelInvite(invite.id)}
                          className="h-8 rounded-lg border border-red-400/40 bg-red-500/20 px-3 text-[11px] font-semibold text-red-200 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      ) : (
                        <span className="rounded-md border border-white/10 bg-black/35 px-2 py-1 text-[11px] text-white/50">—</span>
                      )}
                    </div>
                  ))}
                  {outgoingInvites.length === 0 && <div className="text-xs text-white/45">Исходящих приглашений пока нет.</div>}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white/80">
                  <Crown size={14} className="text-amber-300" />
                  Передача владения рынком
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
                  <CustomSelect
                    value={transferOwnerCountryId}
                    onChange={setTransferOwnerCountryId}
                    options={transferOwnerOptions}
                    placeholder="Выберите нового владельца"
                    buttonClassName="h-9 text-xs"
                  />
                  <Tooltip content="Передать право управления рынком выбранной стране">
                    <button
                      type="button"
                      disabled={pendingTransferOwner || !transferOwnerCountryId}
                      onClick={() => void transferOwner()}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/20 px-3 text-xs font-semibold text-amber-200 disabled:opacity-50"
                    >
                      <ShieldCheck size={13} /> Передать
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>
          )}
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
