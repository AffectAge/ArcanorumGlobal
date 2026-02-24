import { Listbox, Tab } from "@headlessui/react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { colord } from "colord";
import { Check, LoaderCircle, LogIn, Palette, Ruler, Server, ShieldCheck, Sparkles, Upload, UserPlus } from "lucide-react";
import { fetchCountries, fetchServerStatus, login, register } from "../lib/api";
import type { Country, ServerStatus } from "@arcanorum/shared";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { Tooltip } from "./Tooltip";

const REMEMBER_LOGIN_KEY = "arc.auth.rememberedLogin";

const loginSchema = z.object({
  countryId: z.string().min(1, "Выберите страну"),
  password: z.string().min(1, "Введите пароль"),
  rememberMe: z.boolean(),
});

const registerSchema = z
  .object({
    countryName: z.string().min(2, "Минимум 2 символа"),
    countryColor: z.string().min(1),
    password: z.string().min(8, "Минимум 8 символов"),
    confirmPassword: z.string().min(1, "Повторите пароль"),
  })
  .superRefine((val, ctx) => {
    if (val.password !== val.confirmPassword) {
      ctx.addIssue({ code: "custom", message: "Пароли не совпадают", path: ["confirmPassword"] });
    }

    const parsed = colord(val.countryColor);
    if (!parsed.isValid()) {
      ctx.addIssue({ code: "custom", message: "Введите валидный HEX-цвет", path: ["countryColor"] });
    }
  });

export type AuthSuccess = {
  token: string;
  countryId: string;
  playerId: string;
  countryName: string;
  countryColor: string;
  flagUrl?: string | null;
  crestUrl?: string | null;
  turnId: number;
  isAdmin: boolean;
  clientSettings?: {
    eventLogRetentionTurns: number;
  };
};

type Props = {
  onSuccess: (payload: AuthSuccess) => void;
};

const statusMeta: Record<ServerStatus, { text: string; cls: string }> = {
  online: { text: "Онлайн", cls: "bg-emerald-400" },
  offline: { text: "Оффлайн", cls: "bg-rose-400" },
  maintenance: { text: "Технические работы", cls: "bg-amber-400" },
};

const presetColors = ["#4ade80", "#22d3ee", "#60a5fa", "#f59e0b", "#ef4444", "#a78bfa"];

function FieldError({ text }: { text?: string }) {
  if (!text) {
    return null;
  }

  return <p className="mt-1 text-xs text-rose-300">{text}</p>;
}

function FileField({
  label,
  file,
  onChange,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-300">{label}</label>
      <label className="panel-border flex cursor-pointer items-center gap-2 rounded-lg bg-black/35 px-3 py-2 text-sm text-slate-200 transition hover:border-arc-accent/40">
        <Upload size={15} className="text-arc-accent" />
        <span className="truncate">{file ? file.name : "Выбрать изображение"}</span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        />
      </label>
      <p className="mt-1 text-xs text-slate-500">PNG, JPG, WEBP до 4MB, максимум 256x256</p>
    </div>
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

export function AuthPanel({ onSuccess }: Props) {
  const [countries, setCountries] = useState<Country[]>([]);
  const [serverStatus, setServerStatus] = useState<ServerStatus>("offline");
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(8);
  const [submitting, setSubmitting] = useState(false);
  const [flagFile, setFlagFile] = useState<File | null>(null);
  const [crestFile, setCrestFile] = useState<File | null>(null);
  const [flagPreviewUrl, setFlagPreviewUrl] = useState<string | null>(null);
  const [crestPreviewUrl, setCrestPreviewUrl] = useState<string | null>(null);
  const [registrationPendingModal, setRegistrationPendingModal] = useState<{ open: boolean; countryName: string }>({
    open: false,
    countryName: "",
  });

  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { countryId: "", password: "", rememberMe: true },
  });

  const registerForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { countryName: "", countryColor: "#4ade80", password: "", confirmPassword: "" },
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(REMEMBER_LOGIN_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<z.infer<typeof loginSchema>>;
      if (typeof parsed.countryId === "string") {
        loginForm.setValue("countryId", parsed.countryId);
      }
      if (typeof parsed.password === "string") {
        loginForm.setValue("password", parsed.password);
      }
      if (typeof parsed.rememberMe === "boolean") {
        loginForm.setValue("rememberMe", parsed.rememberMe);
      }
    } catch {
      // ignore malformed localStorage
    }
  }, [loginForm]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [status, countriesList] = await Promise.all([fetchServerStatus(), fetchCountries()]);
        if (!mounted) {
          return;
        }
        setServerStatus(status.status);
        setCountries(countriesList);
      } catch {
        if (mounted) {
          setServerStatus("offline");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

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

  useEffect(() => {
    if (!loading) {
      setLoadingProgress(100);
      return;
    }

    const timer = setInterval(() => {
      setLoadingProgress((prev) => (prev >= 92 ? prev : prev + 4));
    }, 120);

    return () => clearInterval(timer);
  }, [loading]);

  const selectedCountryId = loginForm.watch("countryId");
  const selectedCountry = countries.find((c) => c.id === selectedCountryId);
  const loginPassword = loginForm.watch("password");
  const registerPassword = registerForm.watch("password");
  const registerColor = registerForm.watch("countryColor");

  const passwordChecks = useMemo(() => {
    return {
      length: loginPassword.length >= 8,
      complexity: /[A-Z]/.test(loginPassword) && /\d/.test(loginPassword) && /[^A-Za-z0-9]/.test(loginPassword),
    };
  }, [loginPassword]);

  const registerPasswordChecks = useMemo(() => {
    return {
      length: registerPassword.length >= 8,
      complexity: /[A-Z]/.test(registerPassword) && /\d/.test(registerPassword) && /[^A-Za-z0-9]/.test(registerPassword),
    };
  }, [registerPassword]);

  const submitLogin = loginForm.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const result = await login(values);
      const country = countries.find((c) => c.id === result.countryId);
      if (!country) {
        throw new Error("COUNTRY_NOT_FOUND");
      }

      toast.success("Успешный вход");
      try {
        if (values.rememberMe) {
          localStorage.setItem(
            REMEMBER_LOGIN_KEY,
            JSON.stringify({
              countryId: values.countryId,
              password: values.password,
              rememberMe: true,
            }),
          );
        } else {
          localStorage.removeItem(REMEMBER_LOGIN_KEY);
        }
      } catch {
        // ignore storage errors
      }
      onSuccess({
        ...result,
        countryName: country.name,
        countryColor: country.color,
        flagUrl: country.flagUrl,
        crestUrl: country.crestUrl,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "LOGIN_FAILED";
      const [msgCode, lockReasonRaw] = msg.split("__REASON__");
      const lockReasonText = lockReasonRaw ? decodeURIComponent(lockReasonRaw) : "";
      let text = "Сервер недоступен";

      if (msgCode === "INVALID_PASSWORD") {
        text = "Неверный пароль";
      } else if (msgCode === "REGISTRATION_PENDING_APPROVAL") {
        text = "Регистрация ожидает подтверждения администратора";
      } else if (msgCode === "ACCOUNT_LOCKED_PERMANENT" || msgCode === "ACCOUNT_LOCKED") {
        text = "Аккаунт заблокирован бессрочно";
      } else if (msgCode.startsWith("ACCOUNT_LOCKED_TURN_")) {
        const turn = msgCode.replace("ACCOUNT_LOCKED_TURN_", "");
        text = `Аккаунт заблокирован до хода #${turn}`;
      } else if (msgCode.startsWith("ACCOUNT_LOCKED_TIME_")) {
        const raw = msgCode.replace("ACCOUNT_LOCKED_TIME_", "");
        const when = new Date(raw);
        text = Number.isNaN(when.getTime())
          ? `Аккаунт заблокирован до ${raw}`
          : `Аккаунт заблокирован до ${when.toLocaleString()}`;
      }
      toast.error(text, lockReasonText ? { description: `Причина: ${lockReasonText}` } : undefined);
    } finally {
      setSubmitting(false);
    }
  });

  const submitRegister = registerForm.handleSubmit(async (values) => {
    if (flagFile && !(await isImageWithinMaxSize(flagFile))) {
      toast.error("Флаг должен быть максимум 256x256");
      return;
    }

    if (crestFile && !(await isImageWithinMaxSize(crestFile))) {
      toast.error("Герб должен быть максимум 256x256");
      return;
    }

    setSubmitting(true);
    try {
      const normalizedColor = colord(values.countryColor).toHex();
      const country = await register({
        countryName: values.countryName,
        countryColor: normalizedColor,
        password: values.password,
        flagFile,
        crestFile,
      });
      setCountries((prev) => [...prev, country]);
      setFlagFile(null);
      setCrestFile(null);
      registerForm.reset({ countryName: "", countryColor: "#4ade80", password: "", confirmPassword: "" });
      if (country.isRegistrationApproved === false) {
        setRegistrationPendingModal({ open: true, countryName: country.name });
        toast.success("Заявка на регистрацию отправлена администраторам");
      } else {
        toast.success("Страна создана, теперь войдите");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "REGISTER_FAILED";
      if (msg === "IMAGE_DIMENSIONS_TOO_LARGE") {
        toast.error("Изображение должно быть максимум 256x256");
      } else if (msg === "FILE_TOO_LARGE") {
        toast.error("Файл слишком большой (до 4MB)");
      } else if (msg === "ONLY_IMAGES") {
        toast.error("Разрешены только изображения");
      } else {
        toast.error("Ошибка регистрации");
      }
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <motion.div layout transition={{ layout: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } }} className="glass panel-border relative z-20 w-[min(94vw,620px)] rounded-2xl p-6 shadow-2xl">
      <AnimatePresence>
        {registrationPendingModal.open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-black/65 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              className="glass panel-border w-full max-w-[28rem] rounded-xl border-arc-accent/20 bg-[#0b111b] p-4 shadow-2xl"
            >
              <div className="mb-2 flex items-center justify-center gap-2 text-center text-sm font-semibold text-arc-accent">
                <ShieldCheck size={15} />
                <span>Заявка на регистрацию отправлена</span>
              </div>
              <div className="mb-1 text-xs text-slate-200">
                Страна <span className="text-white">{registrationPendingModal.countryName}</span> отправлена на подтверждение администраторам.
              </div>
              <div className="mb-4 text-xs text-slate-400">
                Вы сможете войти в игру после одобрения заявки.
              </div>
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setRegistrationPendingModal({ open: false, countryName: "" })}
                  className="inline-flex items-center justify-center rounded-lg bg-arc-accent px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110"
                >
                  Буду ждать
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="font-display text-5xl tracking-[0.18em]">ARCANORUM</div>
          <div className="mt-1 text-xs text-slate-500">client v0.1.0</div>
        </div>
        <div className="panel-border flex items-center gap-2 rounded-lg bg-black/30 px-3 py-2 text-xs text-slate-300">
          <Server size={14} />
          <span className={`h-2.5 w-2.5 rounded-full ${statusMeta[serverStatus].cls} ${serverStatus === "online" ? "pulse-status" : ""}`} />
          {statusMeta[serverStatus].text}
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl bg-black/30 p-4 text-sm text-slate-300">
          <div className="mb-2 flex items-center justify-center gap-2">
            <LoaderCircle className="animate-spin" size={16} />
            Загрузка игры...
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded bg-white/10">
            <div className="h-full rounded bg-arc-accent transition-all duration-300" style={{ width: `${loadingProgress}%` }} />
          </div>
          <div className="mt-1 text-center text-xs text-slate-500">{loadingProgress}%</div>
        </div>
      ) : (
        <Tab.Group>
          <Tab.List className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-black/30 p-1">
            <Tab
              className={({ selected }) =>
                `inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm outline-none transition ${selected ? "bg-arc-accent/20 text-arc-accent" : "text-slate-300 hover:text-white"}`
              }
            >
              <LogIn size={15} />
              Вход
            </Tab>
            <Tab
              className={({ selected }) =>
                `inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm outline-none transition ${selected ? "bg-arc-accent/20 text-arc-accent" : "text-slate-300 hover:text-white"}`
              }
            >
              <UserPlus size={15} />
              Регистрация
            </Tab>
          </Tab.List>

          <motion.div layout transition={{ layout: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } }} className="overflow-hidden">
            <Tab.Panels>
            <Tab.Panel>
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              <form onSubmit={submitLogin} className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs text-slate-300">Страна</label>
                  <Listbox
                    value={selectedCountryId}
                    onChange={(value: string) => loginForm.setValue("countryId", value, { shouldDirty: true, shouldValidate: true })}
                  >
                    <div className="relative">
                      <Listbox.Button className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 pr-10 text-left text-sm text-slate-100 outline-none transition hover:border-white/20 focus:border-arc-accent/60">
                        {selectedCountry ? selectedCountry.name : "Выберите страну"}
                      </Listbox.Button>
                      <Listbox.Options className="arc-scrollbar panel-border absolute z-30 mt-2 max-h-56 w-full overflow-auto rounded-lg bg-arc-panel/95 p-1 text-sm shadow-2xl outline-none">
                        <Listbox.Option
                          value=""
                          className={({ active }) => `relative cursor-pointer rounded-md px-3 py-2 pr-9 transition ${active ? "bg-arc-accent/15 text-arc-accent" : "text-slate-300"}`}
                        >
                          {({ selected }) => (
                            <>
                              <span className={selected ? "text-arc-accent" : ""}>Выберите страну</span>
                              {selected && <Check size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-arc-accent" />}
                            </>
                          )}
                        </Listbox.Option>
                        {countries.map((country) => (
                          <Listbox.Option
                            key={country.id}
                            value={country.id}
                            className={({ active }) => `relative cursor-pointer rounded-md px-3 py-2 pr-9 transition ${active ? "bg-arc-accent/15 text-arc-accent" : "text-slate-300"}`}
                          >
                            {({ selected }) => (
                              <>
                                <span className={selected ? "text-arc-accent" : ""}>{country.name}</span>
                                {selected && <Check size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-arc-accent" />}
                              </>
                            )}
                          </Listbox.Option>
                        ))}
                      </Listbox.Options>
                    </div>
                  </Listbox>
                  <FieldError text={loginForm.formState.errors.countryId?.message} />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-slate-300">Пароль</label>
                  <input type="password" className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm outline-none transition focus:border-arc-accent/60" {...loginForm.register("password")} />
                  <FieldError text={loginForm.formState.errors.password?.message} />
                  <div className="mt-2 flex gap-2">
                    <Tooltip
                      content={
                        passwordChecks.length
                          ? "Длина пароля подходит (минимум 8 символов)"
                          : "Нужно минимум 8 символов"
                      }
                    >
                      <span
                        className={`group inline-flex h-7 w-7 items-center justify-center rounded-lg border bg-white/5 transition ${
                          passwordChecks.length
                            ? "border-emerald-400/40 text-emerald-500 shadow-[0_0_14px_rgba(110,231,183,0.2)]"
                            : "border-white/10 text-slate-500"
                        }`}
                        aria-label="Проверка длины пароля"
                      >
                        <Ruler size={14} />
                      </span>
                    </Tooltip>
                    <Tooltip
                      content={
                        passwordChecks.complexity
                          ? "Сложность пароля подходит (буквы и цифры)"
                          : "Добавьте буквы и цифры для сложности"
                      }
                    >
                      <span
                        className={`group inline-flex h-7 w-7 items-center justify-center rounded-lg border bg-white/5 transition ${
                          passwordChecks.complexity
                            ? "border-emerald-400/40 text-emerald-500 shadow-[0_0_14px_rgba(110,231,183,0.2)]"
                            : "border-white/10 text-slate-500"
                        }`}
                        aria-label="Проверка сложности пароля"
                      >
                        <Sparkles size={14} />
                      </span>
                    </Tooltip>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input type="checkbox" className="accent-arc-accent" {...loginForm.register("rememberMe")} />
                  Запомнить меня
                </label>

                <button disabled={submitting} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-arc-accent px-3 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-60">
                  <ShieldCheck size={15} />
                  {submitting ? "Вход..." : "Войти"}
                </button>
              </form>
              </motion.div>
            </Tab.Panel>

            <Tab.Panel>
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              <form onSubmit={submitRegister} className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs text-slate-300">Название страны</label>
                  <input className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm outline-none transition focus:border-arc-accent/60" {...registerForm.register("countryName")} />
                  <FieldError text={registerForm.formState.errors.countryName?.message} />
                </div>

                <div>
                  <label className="mb-1 flex items-center gap-2 text-xs text-slate-300">
                    <Palette size={13} /> Цвет страны
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={colord(registerColor).isValid() ? colord(registerColor).toHex() : "#4ade80"}
                      onChange={(e) => registerForm.setValue("countryColor", e.target.value, { shouldDirty: true, shouldValidate: true })}
                      className="panel-border h-10 w-12 cursor-pointer rounded-lg bg-black/35 p-1"
                    />
                    <input
                      className="flex-1 rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm outline-none transition focus:border-arc-accent/60"
                      placeholder="#4ade80"
                      {...registerForm.register("countryColor")}
                    />
                    <span
                      className="panel-border h-9 w-9 rounded-md"
                      style={{ backgroundColor: colord(registerColor).isValid() ? colord(registerColor).toHex() : "#111827" }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {presetColors.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => registerForm.setValue("countryColor", color, { shouldDirty: true, shouldValidate: true })}
                        className="panel-border h-6 w-6 rounded-full transition hover:scale-110"
                        style={{ backgroundColor: color }}
                        aria-label={`Выбрать ${color}`}
                      />
                    ))}
                  </div>
                  <FieldError text={registerForm.formState.errors.countryColor?.message} />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <FileField label="Флаг" file={flagFile} onChange={setFlagFile} />
                  <FileField label="Герб" file={crestFile} onChange={setCrestFile} />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="panel-border rounded-lg bg-black/25 p-2">
                    <div className="mb-2 text-xs text-slate-400">Предпросмотр флага</div>
                    <div className="h-20 overflow-hidden rounded-md bg-black/30">
                      {flagPreviewUrl ? (
                        <img src={flagPreviewUrl} alt="flag preview" className="h-full w-full object-contain p-1" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-slate-500">Не выбран</div>
                      )}
                    </div>
                  </div>
                  <div className="panel-border rounded-lg bg-black/25 p-2">
                    <div className="mb-2 text-xs text-slate-400">Предпросмотр герба</div>
                    <div className="h-20 overflow-hidden rounded-md bg-black/30">
                      {crestPreviewUrl ? (
                        <img src={crestPreviewUrl} alt="crest preview" className="h-full w-full object-contain p-1" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-slate-500">Не выбран</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-slate-300">Пароль</label>
                    <input type="password" className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm outline-none transition focus:border-arc-accent/60" {...registerForm.register("password")} />
                    <FieldError text={registerForm.formState.errors.password?.message} />
                    <div className="mt-2 flex gap-2">
                      <Tooltip
                        content={
                          registerPasswordChecks.length
                            ? "Длина пароля подходит (минимум 8 символов)"
                            : "Нужно минимум 8 символов"
                        }
                      >
                        <span
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border bg-white/5 transition ${
                            registerPasswordChecks.length
                              ? "border-emerald-400/40 text-emerald-500 shadow-[0_0_14px_rgba(110,231,183,0.2)]"
                              : "border-white/10 text-slate-500"
                          }`}
                          aria-label="Проверка длины пароля"
                        >
                          <Ruler size={14} />
                        </span>
                      </Tooltip>
                      <Tooltip
                        content={
                          registerPasswordChecks.complexity
                            ? "Сложность пароля подходит (буквы, цифры и спецсимвол)"
                            : "Добавьте заглавную букву, цифру и спецсимвол"
                        }
                      >
                        <span
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border bg-white/5 transition ${
                            registerPasswordChecks.complexity
                              ? "border-emerald-400/40 text-emerald-500 shadow-[0_0_14px_rgba(110,231,183,0.2)]"
                              : "border-white/10 text-slate-500"
                          }`}
                          aria-label="Проверка сложности пароля"
                        >
                          <Sparkles size={14} />
                        </span>
                      </Tooltip>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-300">Повтор пароля</label>
                    <input type="password" className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm outline-none transition focus:border-arc-accent/60" {...registerForm.register("confirmPassword")} />
                    <FieldError text={registerForm.formState.errors.confirmPassword?.message} />
                  </div>
                </div>

                <button disabled={submitting} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-arc-accent px-3 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-60">
                  <UserPlus size={15} />
                  {submitting ? "Создание..." : "Создать страну"}
                </button>
              </form>
              </motion.div>
            </Tab.Panel>
          </Tab.Panels>
          </motion.div>
        </Tab.Group>
      )}
    </motion.div>
  );
}
