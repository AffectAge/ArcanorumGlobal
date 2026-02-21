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

export async function login(payload: LoginPayload): Promise<{ token: string; playerId: string; countryId: string; isAdmin: boolean; turnId: number }> {
  const response = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json();
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
