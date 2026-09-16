import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiDelete,
  ApiError,
  apiGet,
  apiPost,
  configureApiAuth,
  NotOnTheListError,
  UnauthenticatedError,
} from "./api";

/** Real Response objects, so the client is exercised the way a browser drives it. */
function mockFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const headersOf = (fetchMock: ReturnType<typeof mockFetch>) =>
  fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;

afterEach(() => {
  configureApiAuth(async () => undefined);
});

describe("the API client", () => {
  it("sends the current Supabase token as a bearer token", async () => {
    configureApiAuth(async () => "token-abc");
    const fetchMock = mockFetch({ total: 1 });

    await apiGet("/portfolio");

    expect(headersOf(fetchMock)).toMatchObject({ authorization: "Bearer token-abc" });
  });

  it("reads the token fresh on every request, so a refresh is always used", async () => {
    let token = "first";
    configureApiAuth(async () => token);
    const fetchMock = mockFetch({});

    await apiGet("/me");
    token = "refreshed";
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await apiGet("/me");

    expect((fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>).authorization).toBe(
      "Bearer refreshed",
    );
  });

  it("sends no authorization header when nobody is signed in", async () => {
    const fetchMock = mockFetch({});

    await apiGet("/health");

    expect(headersOf(fetchMock)).not.toHaveProperty("authorization");
  });

  it("returns the parsed body", async () => {
    mockFetch({ total: 1_143_018 });

    await expect(apiGet<{ total: number }>("/portfolio")).resolves.toEqual({ total: 1_143_018 });
  });

  it("sends JSON on a post with a body, and nothing on a post without one", async () => {
    const withBody = mockFetch({ outcome: "connected" });
    await apiPost("/connections/kraken", { key: "abc" });
    expect(withBody.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ key: "abc" }),
    });

    const withoutBody = mockFetch({ status: "added" });
    await apiPost("/waitlist");
    expect(withoutBody.mock.calls[0]?.[1]?.body).toBeUndefined();
  });

  it("can delete", async () => {
    const fetchMock = mockFetch({ status: "disconnected" });

    await apiDelete("/connections/kraken");

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("turns a 401 into its own error, so the app can send you to sign in", async () => {
    mockFetch({ error: "unauthenticated" }, 401);

    await expect(apiGet("/portfolio")).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("turns not_on_the_list into its own error, so the app can show the refusal screen", async () => {
    mockFetch({ error: "not_on_the_list" }, 403);

    await expect(apiGet("/portfolio")).rejects.toBeInstanceOf(NotOnTheListError);
  });

  it("keeps the code the API gave any other failure", async () => {
    mockFetch({ error: "unknown_bucket" }, 404);

    await expect(apiGet("/buckets/nope")).rejects.toMatchObject({
      status: 404,
      code: "unknown_bucket",
    });
  });

  it("still fails usefully when the body isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>nope</html>", { status: 500 })),
    );

    await expect(apiGet("/portfolio")).rejects.toMatchObject({ code: "http_500" });
    await expect(apiGet("/portfolio")).rejects.toBeInstanceOf(ApiError);
  });
});
