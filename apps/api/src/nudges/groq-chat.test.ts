import { describe, expect, it, vi } from "vitest";
import type { TemplateFacts } from "../research/templates.js";
import type { CandidateFacts } from "./candidates.js";
import { groqChat, LlmUnavailableError, retryAfterMs } from "./groq-chat.js";

const request = {
  model: "openai/gpt-oss-120b",
  system: "system words",
  user: "user words",
  schema: { name: "nudge", schema: { type: "object" } },
};

describe("the Groq chat client", () => {
  it("asks for strict JSON with low reasoning, and returns the content and model", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({
            model: "openai/gpt-oss-120b",
            choices: [{ message: { content: '{"material":false}' } }],
          }),
        ),
    );
    const answer = await groqChat({ apiKey: "gsk_secret", fetch })(request);
    expect(answer).toEqual({ content: '{"material":false}', model: "openai/gpt-oss-120b" });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init!.headers).toMatchObject({ authorization: "Bearer gsk_secret" });
    const body = JSON.parse(String(init!.body));
    expect(body).toMatchObject({
      model: "openai/gpt-oss-120b",
      reasoning_effort: "low",
      temperature: 0.2,
      response_format: { type: "json_schema", json_schema: { name: "nudge", strict: true } },
    });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
  });

  it.each([
    ["a 429", new Response("{}", { status: 429 }), "429"],
    ["a 500", new Response("{}", { status: 500 }), "500"],
    ["no content", new Response(JSON.stringify({ choices: [] })), "no content"],
    ["not JSON", new Response("<html>"), "not JSON"],
  ])("says it's unavailable on %s, without the key", async (_label, response, reason) => {
    const error = await groqChat({ apiKey: "gsk_secret", fetch: async () => response })(
      request,
    ).catch((e: Error) => e);
    expect(error).toBeInstanceOf(LlmUnavailableError);
    expect((error as LlmUnavailableError).reason).toBe(reason);
    expect(String(error)).not.toContain("gsk_secret");
  });
});

describe("Groq's per-minute limit", () => {
  const ok = () =>
    new Response(JSON.stringify({ model: "m", choices: [{ message: { content: "{}" } }] }));
  const limited = (headers: Record<string, string>) => new Response("{}", { status: 429, headers });

  it("waits as long as Groq asks, once, then carries on", async () => {
    const waits: number[] = [];
    const responses = [limited({ "retry-after": "7" }), ok()];
    const fetch = vi.fn(async () => responses.shift()!);
    const answer = await groqChat({
      apiKey: "k",
      fetch,
      sleep: async (ms) => void waits.push(ms),
    })(request);
    expect(answer.content).toBe("{}");
    expect(waits).toEqual([7000]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up rather than wait long, or twice", async () => {
    const sleep = vi.fn(async () => undefined);
    const tooLong = groqChat({
      apiKey: "k",
      fetch: async () => limited({ "retry-after": "60" }),
      sleep,
    });
    await expect(tooLong(request)).rejects.toMatchObject({ reason: "429" });
    expect(sleep).not.toHaveBeenCalled();

    const fetch = vi.fn(async () => limited({ "retry-after": "1" }));
    await expect(groqChat({ apiKey: "k", fetch, sleep })(request)).rejects.toMatchObject({
      reason: "429",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ "retry-after": "3" }, 3000],
    [{ "x-ratelimit-reset-tokens": "7.66s" }, 7660],
    [{ "x-ratelimit-reset-requests": "1m2.5s" }, 62_500],
    [{ "x-ratelimit-reset-tokens": "120ms" }, 120],
    [{}, null],
  ])("reads %j as %s ms", (headers, ms) => {
    expect(retryAfterMs(new Headers(headers))).toBe(ms);
  });
});

describe("candidate facts and Pip's templates", () => {
  it("stay in step (a compile-time check)", () => {
    const fits = (facts: CandidateFacts): TemplateFacts => facts;
    expect(typeof fits).toBe("function");
  });
});
