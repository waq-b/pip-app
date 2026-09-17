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

export function groqChat(options: {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Chat {
  const doFetch = options.fetch ?? fetch;
  if (!options.apiKey) throw new Error("Groq needs GROQ_API_KEY");

  return async (request) => {
    let response: Response;
    try {
      response = await doFetch(URL, {
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
