/**
 * The only way the app talks to its own API. Requests go to the same origin —
 * Vite proxies them in dev — so the session cookie is sent normally rather than
 * cross-site.
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

/**
 * Its own class because the app responds to it differently from every other
 * failure: not an error to show, a sign-in to go to.
 */
export class UnauthenticatedError extends ApiError {
  constructor(code = "unauthenticated") {
    super(401, code, "Not signed in");
    this.name = "UnauthenticatedError";
  }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, { ...init, method: "GET" });
}

export async function apiPost<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return request<T>(path, {
    ...init,
    method: "POST",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function apiDelete<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, { ...init, method: "DELETE" });
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    // Without this the session cookie is simply not sent, and every route 401s.
    credentials: "include",
    headers: { accept: "application/json", ...(init.headers ?? {}) },
  });

  if (response.status === 401) {
    throw new UnauthenticatedError(await errorCode(response));
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      await errorCode(response),
      `Request failed with ${response.status}`,
    );
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
