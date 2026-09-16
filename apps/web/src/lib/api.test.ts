import { afterEach, describe, expect, it, vi } from "vitest";
import { apiDelete, ApiError, apiGet, apiPost, UnauthenticatedError } from "./api";

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the API client", () => {
  it("always sends the session cookie", async () => {
    const fetchMock = mockFetch({ total: 1 });

    await apiGet("/portfolio");

    expect(fetchMock).toHaveBeenCalledWith(
      "/portfolio",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("returns the parsed body", async () => {
    mockFetch({ total: 1_143_018 });

    await expect(apiGet<{ total: number }>("/portfolio")).resolves.toEqual({ total: 1_143_018 });
  });

  it("sends JSON on a post", async () => {
    const fetchMock = mockFetch({ outcome: "connected" });

    await apiPost("/connections/kraken", { key: "abc" });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ key: "abc" }),
    });
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

  it("keeps the code the API gave the failure", async () => {
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
