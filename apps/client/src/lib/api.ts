import type { Country, LoginPayload, ServerStatus, WorldBase, WsOutMessage } from "@arcanorum/shared";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export const apiBase = API;

export type ContentCulture = {
  id: string;
  name: string;
  description: string;
  color: string;
  logoUrl: string | null;
  malePortraitUrl?: string | null;
  femalePortraitUrl?: string | null;
};
export type ContentEntry = ContentCulture;
export type ContentEntryKind = "cultures" | "religions" | "professions" | "ideologies" | "races";


function withAssetBase(url?: string | null): string | null | undefined {
  if (!url) {
    return url;
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  if (url.startsWith("/")) {
    return `${API}${url}`;
  }

  return url;
}

function normalizeCountry(country: Country): Country {
  return {
    ...country,
    flagUrl: withAssetBase(country.flagUrl),
    crestUrl: withAssetBase(country.crestUrl),
  };
}

function normalizeContentCulture(culture: ContentCulture): ContentCulture {
  return {
    ...culture,
    logoUrl: withAssetBase(culture.logoUrl) ?? null,
    malePortraitUrl: withAssetBase(culture.malePortraitUrl) ?? null,
    femalePortraitUrl: withAssetBase(culture.femalePortraitUrl) ?? null,
  };
}
function normalizeContentEntry(entry: ContentEntry): ContentEntry {
  return normalizeContentCulture(entry);
}

export async function fetchServerStatus(): Promise<{ status: ServerStatus; turnId: number }> {
  const response = await fetch(`${API}/health`);
  if (!response.ok) {
    throw new Error("SERVER_UNAVAILABLE");
  }
  return response.json();
}

export async function fetchCountries(): Promise<Country[]> {
  const response = await fetch(`${API}/countries`);
  if (!response.ok) {
    throw new Error("COUNTRIES_FAILED");
  }
  const countries = (await response.json()) as Country[];
  return countries.map(normalizeCountry);
}

export async function fetchWorldSnapshot(token: string): Promise<{ worldBase: WorldBase; turnId: number; worldStateVersion: number }> {
  const response = await fetch(`${API}/world/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error ?? "WORLD_SNAPSHOT_FAILED");
  }
  return response.json();
}

export async function fetchContentCultures(): Promise<ContentCulture[]> {
  const response = await fetch(`${API}/content/cultures`);
  if (!response.ok) {
    throw new Error("CONTENT_CULTURES_FAILED");
  }
  const data = (await response.json()) as { cultures?: ContentCulture[] };
  return (data.cultures ?? []).map(normalizeContentCulture);
}

export async function fetchContentEntries(kind: ContentEntryKind): Promise<ContentEntry[]> {
  const response = await fetch(`${API}/content/entries/${encodeURIComponent(kind)}`);
  if (!response.ok) {
    throw new Error("CONTENT_ENTRIES_FAILED");
  }
  const data = (await response.json()) as { items?: ContentEntry[] };
  return (data.items ?? []).map(normalizeContentEntry);
}

export async function adminFetchContentEntries(token: string, kind: ContentEntryKind): Promise<ContentEntry[]> {
  const response = await fetch(`${API}/admin/content/entries/${encodeURIComponent(kind)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "ADMIN_CONTENT_ENTRIES_FAILED");
  }
  const data = (await response.json()) as { items?: ContentEntry[] };
  return (data.items ?? []).map(normalizeContentEntry);
}

export async function adminCreateContentEntry(
  token: string,
  kind: ContentEntryKind,
  payload: { name: string; description?: string; color: string },
) {
  const response = await fetch(`${API}/admin/content/entries/${encodeURIComponent(kind)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "ADMIN_CREATE_CONTENT_ENTRY_FAILED");
  }
  const data = (await response.json()) as { item: ContentEntry; items: ContentEntry[] };
  return { item: normalizeContentEntry(data.item), items: data.items.map(normalizeContentEntry) };
}

export async function adminUpdateContentEntry(
  token: string,
  kind: ContentEntryKind,
  entryId: string,
  payload: { name: string; description?: string; color: string },
) {
  const response = await fetch(`${API}/admin/content/entries/${encodeURIComponent(kind)}/${encodeURIComponent(entryId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "ADMIN_UPDATE_CONTENT_ENTRY_FAILED");
  }
  const data = (await response.json()) as { item: ContentEntry; items: ContentEntry[] };
  return { item: normalizeContentEntry(data.item), items: data.items.map(normalizeContentEntry) };
}

export async function adminUploadContentEntryLogo(token: string, kind: ContentEntryKind, entryId: string, file: File) {
  const formData = new FormData();
  formData.set("cultureLogo", file);
  const response = await fetch(
    `${API}/admin/content/entries/${encodeURIComponent(kind)}/${encodeURIComponent(entryId)}/logo`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    },
  );
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "ADMIN_UPLOAD_CONTENT_ENTRY_LOGO_FAILED");
  }
  const data = (await response.json()) as { item: ContentEntry; items: ContentEntry[] };
  return { item: normalizeContentEntry(data.item), items: data.items.map(normalizeContentEntry) };
}

export async function adminDeleteContentEntryLogo(token: string, kind: ContentEntryKind, entryId: string) {
  const response = await fetch(
    `${API}/admin/content/entries/${encodeURIComponent(kind)}/${encodeURIComponent(entryId)}/logo`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "ADMIN_DELETE_CONTENT_ENTRY_LOGO_FAILED");
  }
  const data = (await response.json()) as { item: ContentEntry; items: ContentEntry[] };
  return { item: normalizeContentEntry(data.item), items: data.items.map(normalizeContentEntry) };
}

export async function adminDeleteContentEntry(token: string, kind: ContentEntryKind, entryId: string) {
  const response = await fetch(`${API}/admin/content/entries/${encodeURIComponent(kind)}/${encodeURIComponent(entryId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "ADMIN_DELETE_CONTENT_ENTRY_FAILED");
  }
  const data = (await response.json()) as { items: ContentEntry[] };
  return { items: data.items.map(normalizeContentEntry) };
}

export async function adminUploadRacePortrait(
  token: string,
  entryId: string,
  slot: "male" | "female",
  file: File,
) {
  const formData = new FormData();
  formData.set("racePortrait", file);
  const response = await fetch(
    `${API}/admin/content/entries/races/${encodeURIComponent(entryId)}/portraits/${encodeURIComponent(slot)}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    },
  );
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "ADMIN_UPLOAD_RACE_PORTRAIT_FAILED");
  }
  const data = (await response.json()) as { item: ContentEntry; items: ContentEntry[] };
  return { item: normalizeContentEntry(data.item), items: data.items.map(normalizeContentEntry) };
}

export async function adminDeleteRacePortrait(token: string, entryId: string, slot: "male" | "female") {
  const response = await fetch(
    `${API}/admin/content/entries/races/${encodeURIComponent(entryId)}/portraits/${encodeURIComponent(slot)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "ADMIN_DELETE_RACE_PORTRAIT_FAILED");
  }
  const data = (await response.json()) as { item: ContentEntry; items: ContentEntry[] };
  return { item: normalizeContentEntry(data.item), items: data.items.map(normalizeContentEntry) };
}

export async function login(payload: LoginPayload): Promise<{ token: string; playerId: string; countryId: string; isAdmin: boolean; turnId: number; clientSettings?: { eventLogRetentionTurns: number } }> {
  const response = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json();
    if (err?.error === "ACCOUNT_LOCKED") {
      const reasonText = typeof err?.lockReason === "string" && err.lockReason.trim() ? err.lockReason.trim() : null;
      const encodedReasonText = reasonText ? encodeURIComponent(reasonText) : null;
      if (typeof err?.blockedUntilTurn === "number") {
        throw new Error(`ACCOUNT_LOCKED_TURN_${err.blockedUntilTurn}${encodedReasonText ? `__REASON__${encodedReasonText}` : ""}`);
      }

      if (typeof err?.blockedUntilAt === "string") {
        throw new Error(`ACCOUNT_LOCKED_TIME_${err.blockedUntilAt}${encodedReasonText ? `__REASON__${encodedReasonText}` : ""}`);
      }

      if (err?.reason === "PERMANENT") {
        throw new Error(`ACCOUNT_LOCKED_PERMANENT${encodedReasonText ? `__REASON__${encodedReasonText}` : ""}`);
      }
    }
    if (err?.error === "REGISTRATION_PENDING_APPROVAL") {
      throw new Error("REGISTRATION_PENDING_APPROVAL");
    }

    throw new Error(err.error ?? "LOGIN_FAILED");
  }

  return response.json();
}

export async function register(payload: {
  countryName: string;
  countryColor: string;
  password: string;
  flagFile?: File | null;
  crestFile?: File | null;
}): Promise<Country> {
  const formData = new FormData();
  formData.set("countryName", payload.countryName);
  formData.set("countryColor", payload.countryColor);
  formData.set("password", payload.password);

  if (payload.flagFile) {
    formData.set("flag", payload.flagFile);
  }

  if (payload.crestFile) {
    formData.set("crest", payload.crestFile);
  }

  const response = await fetch(`${API}/auth/register`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "REGISTER_FAILED");
  }

  const country = (await response.json()) as Country;
  return normalizeCountry(country);
}


export async function adminUpdateCountry(
  token: string,
  countryId: string,
  payload: {
    countryName?: string;
    countryColor?: string;
    isAdmin?: boolean;
    ignoreUntilTurn?: number | null;
    flagFile?: File | null;
    crestFile?: File | null;
  },
): Promise<Country> {
  const formData = new FormData();

  if (payload.countryName != null) {
    formData.set("countryName", payload.countryName);
  }
  if (payload.countryColor != null) {
    formData.set("countryColor", payload.countryColor);
  }
  if (payload.isAdmin != null) {
    formData.set("isAdmin", String(payload.isAdmin));
  }
  if (payload.ignoreUntilTurn !== undefined) {
    formData.set("ignoreUntilTurn", payload.ignoreUntilTurn == null ? "0" : String(payload.ignoreUntilTurn));
  }
  if (payload.flagFile) {
    formData.set("flag", payload.flagFile);
  }
  if (payload.crestFile) {
    formData.set("crest", payload.crestFile);
  }

  const response = await fetch(`${API}/admin/countries/${countryId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "COUNTRY_UPDATE_FAILED");
  }

  return normalizeCountry((await response.json()) as Country);
}

export async function adminDeleteCountry(token: string, countryId: string): Promise<void> {
  const response = await fetch(`${API}/admin/countries/${countryId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "COUNTRY_DELETE_FAILED");
  }
}


export async function adminSetCountryPunishment(
  token: string,
  countryId: string,
  payload:
    | { action: "unlock"; reasonText?: string }
    | { action: "permanent"; reasonText?: string }
    | { action: "turns"; turns: number; reasonText?: string }
    | { action: "time"; blockedUntilAt: string; reasonText?: string },
): Promise<Country> {
  const response = await fetch(`${API}/admin/countries/${countryId}/punishments`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "PUNISHMENT_UPDATE_FAILED");
  }

  return normalizeCountry((await response.json()) as Country);
}

export type TurnStatusItem = {
  id: string;
  name: string;
  color?: string;
  flagUrl?: string | null;
  status: "ready" | "waiting" | "blocked" | "ignored";
  blockedReason: "PERMANENT" | "TURN" | "TIME" | null;
  blockedUntilTurn: number | null;
  blockedUntilAt: string | null;
  ignoreUntilTurn: number | null;
  online: boolean;
  lastLoginAt: string | null;
};

export type UiNotificationItem = Extract<WsOutMessage, { type: "UI_NOTIFY" }>["notification"];

export async function fetchTurnStatus(): Promise<{ turnId: number; readyCount: number; requiredCount: number; countries: TurnStatusItem[] }> {
  const response = await fetch(`${API}/turn/status`);
  if (!response.ok) {
    throw new Error("TURN_STATUS_FAILED");
  }
  const data = (await response.json()) as { turnId: number; readyCount: number; requiredCount: number; countries: TurnStatusItem[] };
  return {
    ...data,
    countries: data.countries.map((c) => ({ ...c, flagUrl: withAssetBase(c.flagUrl) ?? null })),
  };
}

export async function fetchPendingUiNotifications(token: string): Promise<UiNotificationItem[]> {
  const response = await fetch(`${API}/notifications/ui/pending`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "UI_NOTIFICATIONS_PENDING_FAILED");
  }
  const data = (await response.json()) as { notifications: UiNotificationItem[] };
  return data.notifications;
}

export async function markUiNotificationViewed(token: string, notificationId: string): Promise<void> {
  const response = await fetch(`${API}/notifications/ui/${encodeURIComponent(notificationId)}/viewed`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 404) {
    const err = await response.json();
    throw new Error(err.error ?? "UI_NOTIFICATION_VIEW_FAILED");
  }
}

export type GameSettings = {
  economy: {
    baseDucatsPerTurn: number;
    baseGoldPerTurn: number;
  };
  colonization: {
    maxActiveColonizations: number;
    pointsPerTurn: number;
    pointsCostPer1000Km2: number;
    ducatsCostPer1000Km2: number;
  };
  customization: {
    renameDucats: number;
    recolorDucats: number;
    flagDucats: number;
    crestDucats: number;
    provinceRenameDucats: number;
  };
  registration: {
    requireAdminApproval: boolean;
  };
  eventLog: {
    retentionTurns: number;
  };
  turnTimer: {
    enabled: boolean;
    secondsPerTurn: number;
    currentTurnStartedAtMs?: number;
  };
  map: {
    showAntarctica: boolean;
    backgroundImageUrl: string | null;
  };
  resourceIcons: {
    culture: string | null;
    science: string | null;
    religion: string | null;
    colonization: string | null;
    ducats: string | null;
    gold: string | null;
  };
};

export type CustomizationPrices = GameSettings["customization"];
export type ResourceIconsMap = GameSettings["resourceIcons"];
export type CivilopediaEntry = {
  id: string;
  category: string;
  title: string;
  summary: string;
  keywords: string[];
  imageUrl: string | null;
  relatedEntryIds: string[];
  sections: Array<{ title: string; paragraphs: string[] }>;
};

function normalizeResourceIcons(icons?: Partial<ResourceIconsMap> | null): ResourceIconsMap {
  return {
    culture: withAssetBase(icons?.culture) ?? null,
    science: withAssetBase(icons?.science) ?? null,
    religion: withAssetBase(icons?.religion) ?? null,
    colonization: withAssetBase(icons?.colonization) ?? null,
    ducats: withAssetBase(icons?.ducats) ?? null,
    gold: withAssetBase(icons?.gold) ?? null,
  };
}

function normalizeMapSettings(map?: Partial<GameSettings["map"]> | null): GameSettings["map"] {
  return {
    showAntarctica: typeof map?.showAntarctica === "boolean" ? map.showAntarctica : true,
    backgroundImageUrl: withAssetBase(map?.backgroundImageUrl) ?? null,
  };
}

export async function fetchPublicCustomizationPrices(): Promise<CustomizationPrices> {
  const response = await fetch(`${API}/game-settings/public`);
  if (!response.ok) {
    throw new Error("PUBLIC_GAME_SETTINGS_FAILED");
  }

  const data = (await response.json()) as { customization: CustomizationPrices };
  return data.customization;
}

export type ProvinceIndexItem = {
  id: string;
  name: string;
  areaKm2: number;
};

export async function fetchProvinceIndex(): Promise<ProvinceIndexItem[]> {
  const response = await fetch(`${API}/provinces/index`);
  if (!response.ok) {
    throw new Error("PROVINCE_INDEX_FAILED");
  }
  const data = (await response.json()) as { provinces: ProvinceIndexItem[] };
  return data.provinces;
}

export async function fetchPublicGameUiSettings(): Promise<Pick<GameSettings, "economy" | "colonization" | "customization" | "eventLog" | "turnTimer" | "map" | "resourceIcons">> {
  const response = await fetch(`${API}/game-settings/public`);
  if (!response.ok) {
    throw new Error("PUBLIC_GAME_SETTINGS_FAILED");
  }
  const data = (await response.json()) as Pick<GameSettings, "economy" | "colonization" | "customization" | "eventLog" | "turnTimer" | "map" | "resourceIcons">;
  return {
    ...data,
    map: normalizeMapSettings(data.map),
    resourceIcons: normalizeResourceIcons(data.resourceIcons),
  };
}

export async function fetchCivilopedia(): Promise<{ categories: string[]; entries: CivilopediaEntry[] }> {
  const response = await fetch(`${API}/civilopedia`);
  if (!response.ok) throw new Error("CIVILOPEDIA_FAILED");
  const data = (await response.json()) as { civilopedia?: { categories?: string[]; entries?: CivilopediaEntry[] } };
  return {
    categories: data.civilopedia?.categories ?? [],
    entries: (data.civilopedia?.entries ?? []).map((entry) => ({
      ...entry,
      imageUrl: withAssetBase(entry.imageUrl) ?? null,
    })),
  };
}

export async function fetchAdminCivilopedia(token: string): Promise<{ categories: string[]; entries: CivilopediaEntry[] }> {
  const response = await fetch(`${API}/admin/civilopedia`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "ADMIN_CIVILOPEDIA_FAILED");
  }
  const data = (await response.json()) as { civilopedia?: { categories?: string[]; entries?: CivilopediaEntry[] } };
  return {
    categories: data.civilopedia?.categories ?? [],
    entries: (data.civilopedia?.entries ?? []).map((entry) => ({
      ...entry,
      imageUrl: withAssetBase(entry.imageUrl) ?? null,
    })),
  };
}

export async function updateAdminCivilopedia(
  token: string,
  payload: { categories: string[]; entries: CivilopediaEntry[] },
): Promise<{ categories: string[]; entries: CivilopediaEntry[] }> {
  const response = await fetch(`${API}/admin/civilopedia`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "ADMIN_CIVILOPEDIA_UPDATE_FAILED");
  }
  const data = (await response.json()) as { civilopedia?: { categories?: string[]; entries?: CivilopediaEntry[] } };
  return {
    categories: data.civilopedia?.categories ?? [],
    entries: (data.civilopedia?.entries ?? []).map((entry) => ({
      ...entry,
      imageUrl: withAssetBase(entry.imageUrl) ?? null,
    })),
  };
}

export async function uploadCivilopediaImage(token: string, file: File): Promise<{ imageUrl: string }> {
  const formData = new FormData();
  formData.set("civilopediaImage", file);
  const response = await fetch(`${API}/admin/civilopedia/image`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "CIVILOPEDIA_IMAGE_UPLOAD_FAILED");
  }
  const data = (await response.json()) as { imageUrl: string };
  return { imageUrl: withAssetBase(data.imageUrl) ?? data.imageUrl };
}

export async function uploadCivilopediaInlineImage(token: string, file: File): Promise<{ imageUrl: string }> {
  const formData = new FormData();
  formData.set("civilopediaImage", file);
  const response = await fetch(`${API}/admin/civilopedia/inline-image`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "CIVILOPEDIA_INLINE_IMAGE_UPLOAD_FAILED");
  }
  const data = (await response.json()) as { imageUrl: string };
  return { imageUrl: withAssetBase(data.imageUrl) ?? data.imageUrl };
}

export async function fetchGameSettings(token: string): Promise<GameSettings> {
  const response = await fetch(`${API}/admin/game-settings`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "GAME_SETTINGS_FAILED");
  }

  const data = (await response.json()) as GameSettings;
  return {
    ...data,
    map: normalizeMapSettings(data.map),
    resourceIcons: normalizeResourceIcons(data.resourceIcons),
  };
}

export async function updateGameSettings(
  token: string,
  payload: {
    economy?: { baseDucatsPerTurn?: number; baseGoldPerTurn?: number };
    colonization?: { maxActiveColonizations?: number; pointsPerTurn?: number; pointsCostPer1000Km2?: number; ducatsCostPer1000Km2?: number };
    customization?: { renameDucats?: number; recolorDucats?: number; flagDucats?: number; crestDucats?: number; provinceRenameDucats?: number };
    registration?: { requireAdminApproval?: boolean };
    eventLog?: { retentionTurns?: number };
    turnTimer?: { enabled?: boolean; secondsPerTurn?: number };
    map?: { showAntarctica?: boolean; backgroundImageUrl?: string | null };
  },
): Promise<GameSettings> {
  const response = await fetch(`${API}/admin/game-settings`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "GAME_SETTINGS_UPDATE_FAILED");
  }

  const data = (await response.json()) as GameSettings;
  return {
    ...data,
    map: normalizeMapSettings(data.map),
    resourceIcons: normalizeResourceIcons(data.resourceIcons),
  };
}

export async function adminReviewRegistration(
  token: string,
  countryId: string,
  approve: boolean,
): Promise<{ ok: true; approved: boolean; country?: Country; countryId?: string }> {
  const response = await fetch(`${API}/admin/registrations/${countryId}/review`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ approve }),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "REGISTRATION_REVIEW_FAILED");
  }
  const data = (await response.json()) as { ok: true; approved: boolean; country?: Country; countryId?: string };
  return {
    ...data,
    country: data.country ? normalizeCountry(data.country) : undefined,
  };
}

export async function adminBroadcastUiNotification(
  token: string,
  payload: {
    category: "system" | "politics" | "economy";
    title: string;
    message: string;
  },
): Promise<void> {
  const response = await fetch(`${API}/admin/ui-notifications`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "ADMIN_UI_NOTIFICATION_FAILED");
  }
}

export async function adminUploadResourceIcons(
  token: string,
  files: Partial<Record<keyof ResourceIconsMap, File | null>>,
): Promise<{ resourceIcons: ResourceIconsMap }> {
  const formData = new FormData();
  (Object.entries(files) as Array<[keyof ResourceIconsMap, File | null | undefined]>).forEach(([key, file]) => {
    if (file) {
      formData.set(key, file);
    }
  });

  const response = await fetch(`${API}/admin/resource-icons`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "RESOURCE_ICONS_UPDATE_FAILED");
  }

  const data = (await response.json()) as { resourceIcons: ResourceIconsMap };
  return {
    resourceIcons: normalizeResourceIcons(data.resourceIcons),
  };
}

export async function adminUploadUiBackground(token: string, file: File): Promise<{ map: GameSettings["map"] }> {
  const formData = new FormData();
  formData.set("uiBackground", file);

  const response = await fetch(`${API}/admin/ui-background`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "UI_BACKGROUND_UPDATE_FAILED");
  }
  const data = (await response.json()) as { map: GameSettings["map"] };
  return { map: normalizeMapSettings(data.map) };
}

export async function updateOwnCountryCustomization(
  token: string,
  payload: {
    countryName?: string;
    countryColor?: string;
    flagFile?: File | null;
    crestFile?: File | null;
  },
): Promise<{ country: Country; chargedDucats: number; resources: { ducats: number } }> {
  const formData = new FormData();
  if (payload.countryName != null) {
    formData.set("countryName", payload.countryName);
  }
  if (payload.countryColor != null) {
    formData.set("countryColor", payload.countryColor);
  }
  if (payload.flagFile) {
    formData.set("flag", payload.flagFile);
  }
  if (payload.crestFile) {
    formData.set("crest", payload.crestFile);
  }

  const response = await fetch(`${API}/country/customization`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "COUNTRY_CUSTOMIZATION_FAILED");
  }

  const data = (await response.json()) as { country: Country; chargedDucats: number; resources: { ducats: number } };
  return {
    ...data,
    country: normalizeCountry(data.country),
  };
}

export type AdminProvinceItem = {
  id: string;
  name: string;
  areaKm2: number;
  ownerCountryId: string | null;
  colonizationCost: number;
  colonizationDisabled: boolean;
  manualCost?: boolean;
  colonyProgressByCountry: Record<string, number>;
};

export async function startCountryColonization(token: string, provinceId: string): Promise<void> {
  const response = await fetch(`${API}/country/colonization/start`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ provinceId }),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "COLONIZATION_START_FAILED");
  }
}

export async function cancelCountryColonization(token: string, provinceId: string): Promise<void> {
  const response = await fetch(`${API}/country/colonization/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ provinceId }),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "COLONIZATION_CANCEL_FAILED");
  }
}

export async function renameOwnedProvince(
  token: string,
  payload: { provinceId: string; provinceName: string },
): Promise<{ provinceId: string; provinceName: string; chargedDucats: number; resources: { ducats: number } }> {
  const response = await fetch(`${API}/country/province-rename`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "PROVINCE_RENAME_FAILED");
  }
  return (await response.json()) as { provinceId: string; provinceName: string; chargedDucats: number; resources: { ducats: number } };
}

export async function fetchAdminProvinces(token: string): Promise<AdminProvinceItem[]> {
  const response = await fetch(`${API}/admin/provinces`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "ADMIN_PROVINCES_FAILED");
  }
  const data = (await response.json()) as { provinces: AdminProvinceItem[] };
  return data.provinces;
}

export async function adminUpdateProvince(
  token: string,
  provinceId: string,
  payload: {
    colonizationCost?: number;
    colonizationDisabled?: boolean;
    ownerCountryId?: string | null;
    resetColonizationCostToAuto?: boolean;
  },
): Promise<AdminProvinceItem> {
  const response = await fetch(`${API}/admin/provinces/${encodeURIComponent(provinceId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "ADMIN_PROVINCE_UPDATE_FAILED");
  }
  const data = (await response.json()) as { province: AdminProvinceItem };
  return data.province;
}

export async function adminResetProvinceColonizationCostToAuto(token: string, provinceId: string): Promise<AdminProvinceItem> {
  return adminUpdateProvince(token, provinceId, { resetColonizationCostToAuto: true });
}

export async function adminRecalculateAutoProvinceCosts(token: string): Promise<{ updatedCount: number }> {
  const response = await fetch(`${API}/admin/provinces/recalculate-auto-costs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "ADMIN_RECALCULATE_AUTO_PROVINCE_COSTS_FAILED");
  }
  const data = (await response.json()) as { ok: true; updatedCount: number };
  return { updatedCount: data.updatedCount };
}
