/**
 * The only way the app talks to its own API. Every request carries the
 * Supabase access token as a bearer token; the API verifies it and checks the
 * allowlist on every route.
 */

export class ApiError extends Error {
  // Declared rather than taken as constructor parameter properties, which this
  // repo bans via `erasableSyntaxOnly`.
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ApiError";
  }
}

/** Not signed in, or the sign-in has expired: not an error to show, a sign-in to go to. */
export class UnauthenticatedError extends ApiError {
  constructor(code = "unauthenticated") {
    super(401, code, "Not signed in");
    this.name = "UnauthenticatedError";
  }
}

/** Signed in, but not on the allowlist: the refusal screen, not an error. */
export class NotOnTheListError extends ApiError {
  constructor() {
    super(403, "not_on_the_list", "Not on the list");
    this.name = "NotOnTheListError";
  }
}

type TokenGetter = () => Promise<string | undefined>;
let getAccessToken: TokenGetter = async () => undefined;

/** Set by `AuthProvider`. Until then requests go without a token, and the API refuses them. */
export function configureApiAuth(getter: TokenGetter): void {
  getAccessToken = getter;
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, { ...init, method: "GET" });
}

export async function apiPost<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return request<T>(path, {
    ...init,
    method: "POST",
    headers:
      body === undefined
        ? init?.headers
        : { "content-type": "application/json", ...(init?.headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function apiPut<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  return request<T>(path, {
    ...init,
    method: "PUT",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    body: JSON.stringify(body),
  });
}

export async function apiDelete<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, { ...init, method: "DELETE" });
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const token = await getAccessToken();

  // Under `/api` so no API path can collide with a screen (see vite.config.ts).
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 401) {
    throw new UnauthenticatedError(await errorCode(response));
  }

  if (!response.ok) {
    const code = await errorCode(response);
    if (response.status === 403 && code === "not_on_the_list") throw new NotOnTheListError();
    throw new ApiError(response.status, code, `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

/** The API names its failures; fall back to the status when it doesn't. */
async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body?.error === "string" ? body.error : `http_${response.status}`;
  } catch {
    return `http_${response.status}`;
  }
}
