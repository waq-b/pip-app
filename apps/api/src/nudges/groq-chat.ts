import type { Chat } from "../research/types.js";

/**
 * The one place an LLM is called over the network (Phase 5 decision 6): Groq's
 * OpenAI-compatible chat completions with a strict JSON schema. It lives
 * outside `research/` on purpose — the research module never holds a key or
 * makes a request; it's handed this function.
 *
 * Zero Data Retention is switched on in Groq's console. Nothing here logs the
 * prompt, the answer or the key.
 */
const URL = "https://api.groq.com/openai/v1/chat/completions";

export class LlmUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`LLM unavailable (${reason})`);
    this.name = "LlmUnavailableError";
  }
}

/** The longest Pip waits for Groq's per-minute limit to clear before giving up on a build's words. */
export const MAX_RETRY_WAIT_MS = 20_000;

/**
 * How long Groq asks us to wait after a 429: `retry-after` in seconds, or its
 * `x-ratelimit-reset-*` durations ("7.66s", "1m2.5s", "120ms"). Null when it
 * doesn't say — then Pip doesn't guess, and falls back to its own words.
 */
export function retryAfterMs(headers: Headers): number | null {
  const seconds = Number(headers.get("retry-after"));
  if (headers.get("retry-after") !== null && Number.isFinite(seconds)) return seconds * 1000;
  const reset =
    headers.get("x-ratelimit-reset-tokens") ?? headers.get("x-ratelimit-reset-requests");
  const match = reset?.match(/^(?:(\d+)m)?(?:([\d.]+)s)?(?:(\d+)ms)?$/);
  if (!reset || !match || match[0] === "") return null;
  return (Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 1000 + Number(match[3] ?? 0);
}

export function groqChat(options: {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Injected in tests, so a 429 doesn't make them wait. */
  sleep?: (ms: number) => Promise<void>;
}): Chat {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  if (!options.apiKey) throw new Error("Groq needs GROQ_API_KEY");

  return async (request) => {
    const send = () =>
      doFetch(URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          temperature: 0.2,
          reasoning_effort: "low",
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: request.schema.name, strict: true, schema: request.schema.schema },
          },
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });

    let response: Response;
    try {
      response = await send();
      // Over Groq's per-minute limit: wait as long as it asks, once, if that's not long.
      if (response.status === 429) {
        const wait = retryAfterMs(response.headers);
        if (wait !== null && wait <= MAX_RETRY_WAIT_MS) {
          await sleep(wait);
          response = await send();
        }
      }
    } catch {
      throw new LlmUnavailableError("unreachable");
    }
    if (!response.ok) throw new LlmUnavailableError(String(response.status));
    let body: { model?: unknown; choices?: { message?: { content?: unknown } }[] };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      throw new LlmUnavailableError("not JSON");
    }
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new LlmUnavailableError("no content");
    return { content, model: typeof body.model === "string" ? body.model : request.model };
  };
}
