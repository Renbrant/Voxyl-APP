// Future Cloudflare Worker API client for the Cloudflare + Clerk migration.
// This is intentionally not wired into the app yet.

export const API_BASE_URL = import.meta.env.VITE_VOXYL_API_URL || "https://api.voxyl.renbrant.com";

function buildUrl(path) {
  return new URL(path.replace(/^\/+/, ""), `${API_BASE_URL.replace(/\/+$/, "")}/`);
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export async function apiFetch(path, options = {}) {
  const { token, headers: optionHeaders, body: optionBody, method = "GET", ...fetchOptions } = options;
  const headers = new Headers({
    "content-type": "application/json",
    ...optionHeaders,
  });

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const body = isPlainObject(optionBody) ? JSON.stringify(optionBody) : optionBody;
  const response = await fetch(buildUrl(path), {
    ...fetchOptions,
    method,
    headers,
    body,
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const error = new Error(data?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export function healthCheck() {
  return apiFetch("/health");
}
