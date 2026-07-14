export const API_BASE_URL = import.meta.env.VITE_VOXYL_API_URL || "https://api.voxyl.renbrant.com/api";

let authTokenGetter = null;

export function setAuthTokenGetter(getter) {
  authTokenGetter = typeof getter === "function" ? getter : null;
}

function devAuthLog(message, details = {}) {
  if (!import.meta.env.DEV) return;
  console.debug(`[VOXYL API] ${message}`, details);
}

function getCallerHint() {
  if (!import.meta.env.DEV) return undefined;
  const stack = new Error().stack || "";
  return stack
    .split("\n")
    .slice(2)
    .find((line) => !line.includes("voxylApiClient"))
    ?.trim();
}

function normalizePath(path) {
  return String(path || "")
    .replace(/^\/+/, "")
    .replace(/^api\/+/, "");
}

function buildUrl(path, params) {
  const url = new URL(normalizePath(path), `${API_BASE_URL.replace(/\/+$/, "")}/`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  });
  return url;
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export async function apiFetch(path, options = {}) {
  const { token, headers: optionHeaders, body: optionBody, method = "GET", params, ...fetchOptions } = options;
  const headers = new Headers(optionHeaders);

  const authToken = token === undefined ? await getClerkToken() : token;
  if (authToken) {
    headers.set("authorization", `Bearer ${authToken}`);
  }
  devAuthLog("request", {
    path,
    method,
    hasToken: Boolean(authToken),
  });

  const body = isPlainObject(optionBody) ? JSON.stringify(optionBody) : optionBody;
  if (body !== undefined && !(body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(buildUrl(path, params), {
    ...fetchOptions,
    method,
    headers,
    body,
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : null;
  devAuthLog("response", {
    path,
    status: response.status,
  });

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

export async function getClerkToken() {
  try {
    if (authTokenGetter) {
      return await authTokenGetter();
    }
    const session = window.Clerk?.session;
    if (session?.getToken) {
      return await session.getToken();
    }
  } catch {}
  return null;
}

function withDataEnvelope(data) {
  return data && Object.prototype.hasOwnProperty.call(data, "data") ? data : { data };
}

function entityPath(entityName, id) {
  const name = String(entityName || "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  return id ? `/entities/${name}/${encodeURIComponent(id)}` : `/entities/${name}`;
}

function normalizeEntityItem(data) {
  return data?.playlist || data?.item || data?.data || data;
}

function createEntityClient(entityName) {
  return {
    list(sort, limit) {
      return apiFetch(entityPath(entityName), { params: { sort, limit } }).then((data) => data?.items || data?.data || data?.playlists || data || []);
    },
    filter(filters = {}, sort, limit) {
      const params = { ...filters, sort, limit };
      const path = entityName === "Playlist" && !filters.id ? "/playlists" : entityPath(entityName);
      return apiFetch(path, { params }).then((data) => data?.items || data?.data || data?.playlists || data || []);
    },
    get(id) {
      const path = entityName === "Playlist" ? `/playlists/${encodeURIComponent(id)}` : entityPath(entityName, id);
      return apiFetch(path).then(normalizeEntityItem);
    },
    create(payload) {
      return apiFetch(entityPath(entityName), { method: "POST", body: payload }).then(normalizeEntityItem);
    },
    update(id, payload) {
      return apiFetch(entityPath(entityName, id), { method: "PATCH", body: payload }).then(normalizeEntityItem);
    },
    delete(id) {
      return apiFetch(entityPath(entityName, id), { method: "DELETE" });
    },
  };
}

const entityNames = [
  "Block",
  "EpisodeProgress",
  "Follow",
  "Playlist",
  "PlaylistEpisodesCache",
  "PlaylistLike",
  "PodcastLike",
  "PodcastPlay",
  "Referral",
  "Report",
  "User",
];

export const voxylApi = {
  auth: {
    async isAuthenticated() {
      return Boolean(await getClerkToken());
    },
    async me() {
      const token = await getClerkToken();
      devAuthLog("/me token check", {
        caller: getCallerHint(),
        hasToken: Boolean(token),
        clerkLoaded: Boolean(window.Clerk?.loaded),
        clerkSignedIn: Boolean(window.Clerk?.session),
      });
      if (!token) {
        const error = new Error("Clerk token is not ready");
        error.status = 0;
        error.code = "CLERK_TOKEN_NOT_READY";
        throw error;
      }
      const data = await apiFetch("/me", { token });
      return data?.user || data;
    },
    async updateMe(payload) {
      const data = await apiFetch("/me", { method: "PATCH", body: payload });
      return data?.user || data;
    },
    redirectToLogin(fromUrl = window.location.href) {
      return window.Clerk?.redirectToSignIn?.({ redirectUrl: fromUrl }) || Promise.resolve();
    },
    logout(redirectUrl) {
      return window.Clerk?.signOut?.({ redirectUrl: redirectUrl || "/" }) || Promise.resolve();
    },
    setToken() {},
  },
  entities: Object.fromEntries(entityNames.map((name) => [name, createEntityClient(name)])),
  functions: {
    invoke(name, payload = {}) {
      return apiFetch(`/functions/${name}`, { method: "POST", body: payload }).then(withDataEnvelope);
    },
  },
  integrations: {
    Core: {
      UploadFile({ file }) {
        const formData = new FormData();
        formData.append("file", file);
        return apiFetch("/files/upload", { method: "POST", body: formData });
      },
      GenerateImage(payload) {
        return apiFetch("/images/generate", { method: "POST", body: payload });
      },
    },
  },
  users: {
    inviteUser(email, role) {
      return apiFetch("/users/invite", { method: "POST", body: { email, role } });
    },
  },
};
