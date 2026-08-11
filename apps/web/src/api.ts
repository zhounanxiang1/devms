export type ApiError = {
  message: string;
  details?: unknown;
};

const API_BASE = "/api";

export function getToken() {
  return localStorage.getItem("dms_token") || "";
}

export function setToken(token: string) {
  localStorage.setItem("dms_token", token);
}

export function clearToken() {
  localStorage.removeItem("dms_token");
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
