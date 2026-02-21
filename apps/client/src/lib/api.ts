import type { Country, LoginPayload, RegisterPayload, ServerStatus } from "@arcanorum/shared";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export const apiBase = API;

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
  return response.json();
}

export async function login(payload: LoginPayload): Promise<{ token: string; playerId: string; countryId: string; turnId: number }> {
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

export async function register(payload: RegisterPayload): Promise<Country> {
  const response = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error ?? "REGISTER_FAILED");
  }

  return response.json();
}
