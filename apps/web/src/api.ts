export type ApiError = {
  message: string;
  details?: unknown;
};

const API_BASE = "/api";
const TOKEN_KEY = "dms_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token: string, remember = false) {
  clearToken();
  const storage = remember ? localStorage : sessionStorage;
  storage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    let payload: any = {};
    try {
      payload = await response.json();
    } catch {
      payload = { message: response.statusText };
    }
    const error = new Error(payload.message || "请求失败") as Error & ApiError;
    error.details = payload;
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const form = new FormData();
  form.append("file", file);

  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: form
  });

  if (!response.ok) {
    let payload: any = {};
    try {
      payload = await response.json();
    } catch {
      payload = { message: response.statusText };
    }
    const error = new Error(payload.message || "上传失败") as Error & ApiError;
    error.details = payload;
    throw error;
  }
  return response.json() as Promise<T>;
}

export function post<T>(path: string, body: unknown) {
  return api<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function patch<T>(path: string, body: unknown) {
  return api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}
