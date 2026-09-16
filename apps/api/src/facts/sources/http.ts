import { FactsSourceError } from "../types.js";

/** Polite, honest user agent; some feeds refuse requests without one. */
export const USER_AGENT = "Pip/0.5 (personal, read-only)";

/**
 * One GET, with failures sorted into the reasons the collector acts on. Nothing
 * from the request (keys included) appears in an error.
 */
export async function getText(
  doFetch: typeof fetch,
  source: string,
  url: string,
  headers: Record<string, string> = {},
): Promise<string> {
  let response: Response;
  try {
    response = await doFetch(url, {
      headers: { "User-Agent": USER_AGENT, ...headers },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new FactsSourceError(source, "unavailable", "unreachable");
  }
  if (response.status === 429 || response.status === 402)
    throw new FactsSourceError(source, "blocked", String(response.status));
  if (response.status === 404) throw new FactsSourceError(source, "not_found", "404");
  if (!response.ok) throw new FactsSourceError(source, "unavailable", String(response.status));
  return response.text();
}

export async function getJson(
  doFetch: typeof fetch,
  source: string,
  url: string,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const text = await getText(doFetch, source, url, headers);
  try {
    return JSON.parse(text);
  } catch {
    throw new FactsSourceError(source, "shape", "not JSON");
  }
}

export const HOUR_MS = 3_600_000;
