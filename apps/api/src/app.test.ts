import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("GET /health", () => {
  it("returns ok without touching any provider or database", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
