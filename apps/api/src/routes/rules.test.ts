import {
  BUCKETS,
  type BucketDetail,
  type PortfolioSummary,
  type RulesView,
} from "@finance-app/shared";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { memoryRulesStore } from "../rules/store.js";
import { testAuth } from "../test-support/auth.js";

const auth = testAuth();
const SIGNED_IN = auth.headersFor("test@example.com", "Waqar");

function setup() {
  const store = memoryRulesStore();
  const app = buildApp({ ...auth.options, rulesStore: store });
  const put = (payload: unknown, headers: Record<string, string> = SIGNED_IN) =>
    app.inject({ method: "PUT", url: "/rules", headers, payload: payload as object });
  return { store, put };
}

describe("PUT /rules", () => {
  it("needs a session", async () => {
    const { put } = setup();
    expect((await put({ handpickedTarget: 25, sideBetCap: 5 }, {})).statusCode).toBe(401);
  });

  it("saves a valid shape and says when", async () => {
    const { put } = setup();
    const response = await put({ handpickedTarget: 30, sideBetCap: 8 });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { settings: unknown; lastChangedAt: string };
    expect(body.settings).toEqual({ handpickedTarget: 30, sideBetCap: 8 });
    expect(Number.isNaN(Date.parse(body.lastChangedAt))).toBe(false);
  });

  it.each([
    ["a cap above 20%", { handpickedTarget: 25, sideBetCap: 21 }, "cap_out_of_range"],
    ["a negative cap", { handpickedTarget: 25, sideBetCap: -1 }, "cap_out_of_range"],
    ["a shape over 100", { handpickedTarget: 85, sideBetCap: 20 }, "shape_over_100"],
    ["a negative target", { handpickedTarget: -5, sideBetCap: 5 }, "target_out_of_range"],
    ["fractions", { handpickedTarget: 25.5, sideBetCap: 5 }, "whole_numbers_needed"],
    ["numbers as text", { handpickedTarget: "25", sideBetCap: "5" }, "whole_numbers_needed"],
    ["nothing", {}, "whole_numbers_needed"],
  ])("refuses %s, whatever the screen allowed", async (_label, payload, error) => {
    const { put } = setup();
    const response = await put(payload);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
  });

  it("accepts the edges: a 20% cap, a 0% cap, and nothing left for Foundation", async () => {
    const { put } = setup();
    expect((await put({ handpickedTarget: 25, sideBetCap: 20 })).statusCode).toBe(200);
    expect((await put({ handpickedTarget: 25, sideBetCap: 0 })).statusCode).toBe(200);
    expect((await put({ handpickedTarget: 80, sideBetCap: 20 })).statusCode).toBe(200);
  });

  it("keeps each person's rules to themselves", async () => {
    const { store, put } = setup();
    await put({ handpickedTarget: 40, sideBetCap: 10 });
    const other = { userId: "someone-else", authUserId: "x" };
    expect((await store.get(other)).settings).toEqual({ handpickedTarget: 25, sideBetCap: 5 });
  });
});

describe("one engine, one answer", () => {
  it("gives /rules, /portfolio and /buckets/:id identical rule results for identical input", async () => {
    const store = memoryRulesStore();
    const app = buildApp({ ...auth.options, rulesStore: store });
    const get = async <T>(url: string) => {
      const response = await app.inject({ method: "GET", url, headers: SIGNED_IN });
      expect(response.statusCode).toBe(200);
      return response.json() as T;
    };

    // Once over the default 5% cap, once back under a raised one.
    for (const cap of [5, 10]) {
      const saved = await app.inject({
        method: "PUT",
        url: "/rules",
        headers: SIGNED_IN,
        payload: { handpickedTarget: 25, sideBetCap: cap },
      });
      expect(saved.statusCode).toBe(200);

      const view = await get<RulesView>("/rules");
      const summary = await get<PortfolioSummary>("/portfolio");
      for (const bucket of BUCKETS) {
        const rule = view.rules.find((r) => r.bucket === bucket)!;
        const card = summary.buckets.find((b) => b.bucket === bucket)!;
        const pot = await get<BucketDetail>(`/buckets/${bucket}`);
        expect({ status: card.ruleStatus, overBy: card.overBy }).toEqual({
          status: rule.status,
          overBy: rule.overBy,
        });
        expect({ status: pot.ruleStatus, overBy: pot.overBy }).toEqual({
          status: rule.status,
          overBy: rule.overBy,
        });
      }
      expect(summary.rulesNeedAttention).toBe(view.needsAttention);
      expect(summary.verdict.includes("Side Bet needs a look")).toBe(view.needsAttention);
      expect(view.needsAttention).toBe(cap === 5);
    }
  });
});
