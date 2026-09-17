import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { testAuth } from "./test-support/auth.js";
import { rewriteForWebApp } from "./web.js";

function builtWebApp() {
  const dir = mkdtempSync(join(tmpdir(), "pip-web-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>Pip</title>");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "index-abc123.js"), "console.log('pip')");
  writeFileSync(join(dir, "favicon.svg"), "<svg/>");
  return dir;
}

describe("one origin for the web app and the API", () => {
  it("sends /api/* to the API and everything else to the web app", () => {
    expect(rewriteForWebApp("/api/portfolio?tf=day")).toBe("/portfolio?tf=day");
    expect(rewriteForWebApp("/api/health")).toBe("/health");
    expect(rewriteForWebApp("/rules")).toBe("/app/rules");
    expect(rewriteForWebApp("/")).toBe("/app/");
    expect(rewriteForWebApp("/apiary")).toBe("/app/apiary");
  });

  const app = () => buildApp({ ...testAuth().options, webAppDir: builtWebApp() });

  it("serves the app at any client-side route, so reloading /rules works", async () => {
    const response = await app().inject({ method: "GET", url: "/rules" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("<title>Pip</title>");
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.headers["x-frame-options"]).toBe("DENY");
  });

  it("sends app pages on the old address to the new domain, keeping the path and query", async () => {
    const moved = () =>
      buildApp({
        ...testAuth().options,
        webAppDir: builtWebApp(),
        canonicalHost: "pip.example.com",
      });

    const response = await moved().inject({
      method: "GET",
      url: "/rules?tf=day",
      headers: { host: "pip-old.example.net" },
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://pip.example.com/rules?tf=day");

    const onTheNewDomain = await moved().inject({
      method: "GET",
      url: "/rules",
      headers: { host: "pip.example.com" },
    });
    expect(onTheNewDomain.statusCode).toBe(200);
  });

  it("leaves the API alone on the old address, so the scheduled job keeps working", async () => {
    const response = await buildApp({
      ...testAuth().options,
      webAppDir: builtWebApp(),
      canonicalHost: "pip.example.com",
    }).inject({ method: "GET", url: "/api/health", headers: { host: "pip-old.example.net" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("serves fingerprinted assets as immutable", async () => {
    const response = await app().inject({ method: "GET", url: "/assets/index-abc123.js" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toMatch(/immutable/);
  });

  it("keeps every API route behind the guard", async () => {
    const response = await app().inject({ method: "GET", url: "/api/portfolio" });
    expect(response.statusCode).toBe(401);
    expect((await app().inject({ method: "GET", url: "/api/health" })).json()).toEqual({
      status: "ok",
    });
  });

  it("never serves a file outside the built app", async () => {
    const response = await app().inject({ method: "GET", url: "/..%2f..%2fetc%2fpasswd" });
    expect(response.body).not.toContain("root:");
    expect(response.body).toContain("<title>Pip</title>");
  });
});
