const API_URL = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  readonly status: number;
  readonly errorCode: string;
  readonly details?: unknown;

  constructor(status: number, errorCode: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
    this.details = details;
  }
}

let selectedOrg: string | null = null;

export function setOrganizationId(orgId: string | null) {
  selectedOrg = orgId;
  if (orgId) localStorage.setItem("ff.org", orgId);
  else localStorage.removeItem("ff.org");
}

export function getOrganizationId(): string | null {
  if (selectedOrg) return selectedOrg;
  const stored = localStorage.getItem("ff.org");
  if (stored) selectedOrg = stored;
  return selectedOrg;
}

export function getAccessToken(): string | null {
  return localStorage.getItem("ff.access");
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem("ff.access", access);
  localStorage.setItem("ff.refresh", refresh);
}

export function clearSession() {
  localStorage.removeItem("ff.access");
  localStorage.removeItem("ff.refresh");
  setOrganizationId(null);
}

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    const refresh = localStorage.getItem("ff.refresh");
    if (!refresh) throw new ApiError(401, "NO_SESSION", "Not signed in");
    refreshPromise = fetch(`${API_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
    })
      .then(async (res) => {
        if (!res.ok) {
          clearSession();
          throw new ApiError(401, "REFRESH_FAILED", "Session expired");
        }
        const data = (await res.json()) as {
          accessToken: string;
          refreshToken: string;
        };
        setTokens(data.accessToken, data.refreshToken);
        return data.accessToken;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("content-type", "application/json");

  if (!options.skipAuth) {
    const token = getAccessToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
    const org = getOrganizationId();
    if (org) headers.set("x-organization-id", org);
  }

  const doFetch = (token?: string): Promise<Response> => {
    const h = new Headers(headers);
    if (token) h.set("authorization", `Bearer ${token}`);
    return fetch(`${API_URL}${path}`, { ...options, headers: h });
  };

  let response = await doFetch(getAccessToken() ?? undefined);

  if (response.status === 401 && !options.skipAuth) {
    const access = await refreshAccessToken().catch(() => null);
    if (access) {
      response = await doFetch(access);
    }
  }

  if (!response.ok) {
    let body: { message?: string; errorCode?: string; details?: unknown } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      /* non-json body */
    }
    throw new ApiError(
      response.status,
      body.errorCode ?? "REQUEST_FAILED",
      body.message ?? response.statusText,
      body.details,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const http = {
  get: <T = unknown>(path: string) => api<T>(path),
  post: <T = unknown>(path: string, body?: unknown) =>
    api<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T = unknown>(path: string, body?: unknown) =>
    api<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T = unknown>(path: string) => api<T>(path, { method: "DELETE" }),
};
