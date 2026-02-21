import { Tab } from "@headlessui/react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { colord } from "colord";
import { LoaderCircle, Server } from "lucide-react";
import { fetchCountries, fetchServerStatus, login, register } from "../lib/api";
import type { Country, ServerStatus } from "@arcanorum/shared";
import { toast } from "sonner";

const loginSchema = z.object({
  countryId: z.string().min(1, "Выберите страну"),
  password: z.string().min(1, "Введите пароль"),
  rememberMe: z.boolean(),
});

const registerSchema = z
  .object({
    countryName: z.string().min(2, "Минимум 2 символа"),
    countryColor: z.string().min(1),
    flagUrl: z.string().url("Неверный URL").optional().or(z.literal("")),
    crestUrl: z.string().url("Неверный URL").optional().or(z.literal("")),
    password: z.string().min(8, "Минимум 8 символов"),
    confirmPassword: z.string().min(1),
  })
  .superRefine((val, ctx) => {
    if (val.password !== val.confirmPassword) {
      ctx.addIssue({ code: "custom", message: "Пароли не совпадают", path: ["confirmPassword"] });
    }

    const parsed = colord(val.countryColor);
    if (!parsed.isValid()) {
      ctx.addIssue({ code: "custom", message: "Цвет должен быть валидным", path: ["countryColor"] });
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
};

type Props = {
  onSuccess: (payload: AuthSuccess) => void;
};

const statusMeta: Record<ServerStatus, { text: string; cls: string }> = {
  online: { text: "Онлайн", cls: "bg-emerald-400" },
  offline: { text: "Оффлайн", cls: "bg-rose-400" },
  maintenance: { text: "Технические работы", cls: "bg-amber-400" },
};

export function AuthPanel({ onSuccess }: Props) {
  const [countries, setCountries] = useState<Country[]>([]);
  const [serverStatus, setServerStatus] = useState<ServerStatus>("offline");
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(8);
  const [submitting, setSubmitting] = useState(false);

  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { countryId: "", password: "", rememberMe: true },
  });

  const registerForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { countryName: "", countryColor: "#22c55e", flagUrl: "", crestUrl: "", password: "", confirmPassword: "" },
  });

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
    if (!loading) {
      setLoadingProgress(100);
      return;
    }

    const timer = setInterval(() => {
      setLoadingProgress((prev) => (prev >= 92 ? prev : prev + 4));
    }, 120);

    return () => clearInterval(timer);
  }, [loading]);

  const loginPassword = loginForm.watch("password");
  const passwordChecks = useMemo(() => {
    return {
      length: loginPassword.length >= 8,
      complexity: /[A-Z]/.test(loginPassword) && /\d/.test(loginPassword) && /[^A-Za-z0-9]/.test(loginPassword),
    };
  }, [loginPassword]);

  const submitLogin = loginForm.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const result = await login(values);
      const country = countries.find((c) => c.id === result.countryId);
      if (!country) {
        throw new Error("COUNTRY_NOT_FOUND");
      }

      toast.success("Успешный вход");
      onSuccess({
        ...result,
        countryName: country.name,
        countryColor: country.color,
        flagUrl: country.flagUrl,
        crestUrl: country.crestUrl,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "LOGIN_FAILED";
      const text = msg === "INVALID_PASSWORD" ? "Неверный пароль" : msg === "ACCOUNT_LOCKED" ? "Аккаунт заблокирован" : "Сервер недоступен";
      toast.error(text);
    } finally {
      setSubmitting(false);
    }
  });

  const submitRegister = registerForm.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const normalizedColor = colord(values.countryColor).toHex();
      const country = await register({
        countryName: values.countryName,
        countryColor: normalizedColor,
        flagUrl: values.flagUrl,
        crestUrl: values.crestUrl,
        password: values.password,
      });
      setCountries((prev) => [...prev, country]);
      toast.success("Страна создана, теперь войдите");
    } catch {
      toast.error("Ошибка регистрации");
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <div className="glass panel-border relative z-20 w-[min(92vw,560px)] rounded-2xl p-6 shadow-2xl">
      <div className="mb-4 text-center">
        <div className="font-display text-5xl tracking-[0.2em]">ARCANORUM</div>
        <div className="mt-2 text-xs text-slate-400">client v0.1.0</div>
      </div>

      <div className="mb-4 flex items-center justify-center gap-2 text-xs text-slate-300">
        <Server size={14} />
        <span className={`h-2.5 w-2.5 rounded-full ${statusMeta[serverStatus].cls} ${serverStatus === "online" ? "pulse-status" : ""}`} />
        {statusMeta[serverStatus].text}
      </div>

      {loading ? (
        <div className="rounded-lg bg-black/30 p-4 text-sm text-slate-300">
          <div className="mb-2 flex items-center justify-center gap-2">
            <LoaderCircle className="animate-spin" size={16} />
            Загрузка игры...
          </div>
          <div className="h-2 w-full overflow-hidden rounded bg-white/10">
            <div className="h-full rounded bg-arc-accent transition-all duration-300" style={{ width: `${loadingProgress}%` }} />
          </div>
          <div className="mt-1 text-center text-xs text-slate-400">{loadingProgress}%</div>
        </div>
      ) : (
        <Tab.Group>
          <Tab.List className="mb-4 flex border-b border-white/10">
            {["🔐 Вход", "🆕 Регистрация"].map((tab) => (
              <Tab
                key={tab}
                className={({ selected }) =>
                  `w-1/2 px-3 py-2 text-sm outline-none transition ${selected ? "border-b-2 border-arc-accent text-arc-accent" : "text-slate-300 hover:text-white"}`
                }
              >
                {tab}
              </Tab>
            ))}
          </Tab.List>

          <Tab.Panels>
            <Tab.Panel>
              <form onSubmit={submitLogin} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-300">Выбор страны</label>
                  <select className="w-full rounded-lg bg-black/30 px-3 py-2 text-sm" {...loginForm.register("countryId")}>
                    <option value="">Выберите страну</option>
                    {countries.map((country) => (
                      <option key={country.id} value={country.id}>
                        {country.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-slate-300">Пароль</label>
                  <input type="password" className="w-full rounded-lg bg-black/30 px-3 py-2 text-sm" {...loginForm.register("password")} />
                  <div className="mt-2 flex gap-2 text-xs">
                    <span className={passwordChecks.length ? "text-emerald-400" : "text-slate-400"}>Длина {passwordChecks.length ? "✅" : "•"}</span>
                    <span className={passwordChecks.complexity ? "text-emerald-400" : "text-slate-400"}>Сложность {passwordChecks.complexity ? "✅" : "•"}</span>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input type="checkbox" {...loginForm.register("rememberMe")} />
                  Запомнить меня
                </label>

                <button disabled={submitting} className="w-full rounded-lg bg-arc-accent px-3 py-2 text-sm font-semibold text-black disabled:opacity-60">
                  {submitting ? "Вход..." : "Войти"}
                </button>
              </form>
            </Tab.Panel>

            <Tab.Panel>
              <form onSubmit={submitRegister} className="space-y-3">
                <input placeholder="Название страны" className="w-full rounded-lg bg-black/30 px-3 py-2 text-sm" {...registerForm.register("countryName")} />
                <input placeholder="#22c55e" className="w-full rounded-lg bg-black/30 px-3 py-2 text-sm" {...registerForm.register("countryColor")} />
                <input placeholder="URL флага" className="w-full rounded-lg bg-black/30 px-3 py-2 text-sm" {...registerForm.register("flagUrl")} />
                <input placeholder="URL герба" className="w-full rounded-lg bg-black/30 px-3 py-2 text-sm" {...registerForm.register("crestUrl")} />
                <input type="password" placeholder="Пароль" className="w-full rounded-lg bg-black/30 px-3 py-2 text-sm" {...registerForm.register("password")} />
                <input type="password" placeholder="Повтор пароля" className="w-full rounded-lg bg-black/30 px-3 py-2 text-sm" {...registerForm.register("confirmPassword")} />
                <button disabled={submitting} className="w-full rounded-lg bg-arc-accent px-3 py-2 text-sm font-semibold text-black disabled:opacity-60">
                  {submitting ? "Создание..." : "Создать страну"}
                </button>
              </form>
            </Tab.Panel>
          </Tab.Panels>
        </Tab.Group>
      )}
    </div>
  );
}
