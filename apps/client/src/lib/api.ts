import type { Country, LoginPayload, ServerStatus } from "@arcanorum/shared";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export const apiBase = API;


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

export async function login(payload: LoginPayload): Promise<{ token: string; playerId: string; countryId: string; isAdmin: boolean; turnId: number; clientSettings?: { eventLogRetentionTurns: number } }> {
  const response = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json();
    if (err?.error === "ACCOUNT_LOCKED") {
      if (typeof err?.blockedUntilTurn === "number") {
        throw new Error(`ACCOUNT_LOCKED_TURN_${err.blockedUntilTurn}`);
      }

      if (typeof err?.blockedUntilAt === "string") {
        throw new Error(`ACCOUNT_LOCKED_TIME_${err.blockedUntilAt}`);
      }

      if (err?.reason === "PERMANENT") {
        throw new Error("ACCOUNT_LOCKED_PERMANENT");
      }
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
    | { action: "unlock" }
    | { action: "permanent" }
    | { action: "turns"; turns: number }
    | { action: "time"; blockedUntilAt: string },
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
};

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
    resourceIcons: normalizeResourceIcons(data.resourceIcons),
  };
}

export async function updateGameSettings(
  token: string,
  payload: {
    economy?: { baseDucatsPerTurn?: number; baseGoldPerTurn?: number };
    colonization?: { maxActiveColonizations?: number; pointsPerTurn?: number; pointsCostPer1000Km2?: number; ducatsCostPer1000Km2?: number };
    customization?: { renameDucats?: number; recolorDucats?: number; flagDucats?: number; crestDucats?: number };
    eventLog?: { retentionTurns?: number };
    turnTimer?: { enabled?: boolean; secondsPerTurn?: number };
    map?: { showAntarctica?: boolean };
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
    resourceIcons: normalizeResourceIcons(data.resourceIcons),
  };
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


