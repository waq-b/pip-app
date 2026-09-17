import {
  DEFAULT_RULES,
  DRIFT_THRESHOLD_POINTS,
  SIDE_BET_STARTER_LIMIT_PENCE,
  type Bucket,
} from "@finance-app/shared";
import { describe, expect, it } from "vitest";
import { evaluateRules, shapeOf, type PotInput, type SideBetInput } from "./engine.js";

const pots = (values: Partial<Record<Bucket, number | null>>): PotInput[] =>
  (["Base", "Medium", "Degen"] as const).map((bucket) => ({
    bucket,
    connected: values[bucket] !== undefined && values[bucket] !== null,
    valuePence: values[bucket] ?? 0,
  }));

/** The starter limit and nothing put in, unless a test says otherwise. */
const sideBet = (input: Partial<SideBetInput> = {}): SideBetInput => ({
  limitPence: SIDE_BET_STARTER_LIMIT_PENCE,
  moneyInPence: 0,
  starterLimit: true,
  ...input,
});

const pot = (result: ReturnType<typeof evaluateRules>, bucket: Bucket) =>
  result.pots.find((p) => p.bucket === bucket)!;

describe("the shape", () => {
  it("is Foundation and Handpicked only — Side Bet sits outside it", () => {
    expect(shapeOf(DEFAULT_RULES)).toEqual({ Base: 75, Medium: 25 });
    expect(shapeOf({ handpickedTarget: 30 })).toEqual({ Base: 70, Medium: 30 });
  });

  it("uses a named five-point drift threshold", () => {
    expect(DRIFT_THRESHOLD_POINTS).toBe(5);
  });
});

describe("targets", () => {
  it("find nothing wrong when both pots sit on their line", () => {
    const result = evaluateRules(
      pots({ Base: 75_000, Medium: 25_000, Degen: 5_000 }),
      DEFAULT_RULES,
      sideBet(),
    );
    expect(result).toMatchObject({
      totalPence: 105_000,
      needsAttention: false,
      fixIt: null,
      scaled: false,
      leftOut: [],
    });
    expect(result.pots.map((p) => [p.bucket, p.status, p.driftPoints])).toEqual([
      ["Base", "ok", 0],
      ["Medium", "ok", 0],
      ["Degen", "ok", null],
    ]);
  });

  it("are judged against the pots in the shape, so Side Bet's size never drags them off", () => {
    const small = evaluateRules(
      pots({ Base: 75_000, Medium: 25_000, Degen: 1_000 }),
      DEFAULT_RULES,
      sideBet(),
    );
    const large = evaluateRules(
      pots({ Base: 75_000, Medium: 25_000, Degen: 50_000 }),
      DEFAULT_RULES,
      sideBet(),
    );
    expect(pot(small, "Medium")).toMatchObject({ status: "ok", driftPoints: 0 });
    expect(pot(large, "Medium")).toMatchObject({ status: "ok", driftPoints: 0 });
    // The share of everything still shrinks as Side Bet grows — that's a fact, not a drift.
    expect(pot(large, "Medium").actualPercent).toBeLessThan(pot(small, "Medium").actualPercent);
  });

  it("drift at five points either way", () => {
    const over = evaluateRules(
      pots({ Base: 70_000, Medium: 30_000, Degen: 0 }),
      DEFAULT_RULES,
      sideBet(),
    );
    expect(pot(over, "Medium")).toMatchObject({ status: "drifted", driftPoints: 5 });
    expect(pot(over, "Base")).toMatchObject({ status: "drifted", driftPoints: -5 });

    const under = evaluateRules(
      pots({ Base: 74_000, Medium: 26_000, Degen: 0 }),
      DEFAULT_RULES,
      sideBet(),
    );
    expect(pot(under, "Medium")).toMatchObject({ status: "ok" });
  });

  it("are scaled over the pots Pip can see when one isn't connected", () => {
    const result = evaluateRules(pots({ Base: 75_000, Degen: 1_000 }), DEFAULT_RULES, sideBet());
    expect(result).toMatchObject({ scaled: true, leftOut: ["Medium"] });
    expect(pot(result, "Base")).toMatchObject({ judgedAgainstPercent: 100, status: "ok" });
    expect(pot(result, "Medium")).toMatchObject({ status: "unavailable" });
  });

  it("aren't scaled just because Side Bet isn't connected — it was never in the shape", () => {
    const result = evaluateRules(pots({ Base: 75_000, Medium: 25_000 }), DEFAULT_RULES, sideBet());
    expect(result).toMatchObject({ scaled: false, leftOut: ["Degen"] });
    expect(pot(result, "Base")).toMatchObject({ judgedAgainstPercent: 75, status: "ok" });
  });
});

describe("Side Bet's limit", () => {
  const potsWithSideBet = (value: number) => pots({ Base: 75_000, Medium: 25_000, Degen: value });

  it("is judged on money in, less taken out — not on what Side Bet is worth", () => {
    // Worth far more than the limit, but only a little has gone in: nothing is wrong.
    const result = evaluateRules(
      potsWithSideBet(900_000),
      DEFAULT_RULES,
      sideBet({ moneyInPence: 10_000 }),
    );
    expect(pot(result, "Degen")).toMatchObject({
      status: "ok",
      overBy: null,
      limit: {
        limit: SIDE_BET_STARTER_LIMIT_PENCE,
        moneyIn: 10_000,
        value: 900_000,
        usedPercent: 28.57,
        starter: true,
        grownBy: 890_000,
      },
    });
    expect(result.needsAttention).toBe(false);
  });

  it("warns at 80% of the limit and reads as reached at 100%", () => {
    const near = evaluateRules(
      potsWithSideBet(28_000),
      DEFAULT_RULES,
      sideBet({ moneyInPence: 28_000 }),
    );
    expect(pot(near, "Degen")).toMatchObject({ status: "near_limit", overBy: null });
    expect(near.needsAttention).toBe(false);

    const reached = evaluateRules(
      potsWithSideBet(35_000),
      DEFAULT_RULES,
      sideBet({ moneyInPence: 35_000 }),
    );
    expect(pot(reached, "Degen")).toMatchObject({ status: "over_limit" });
    expect(reached.needsAttention).toBe(true);
  });

  it("says what taking that much out would bring back under", () => {
    const result = evaluateRules(
      potsWithSideBet(60_000),
      DEFAULT_RULES,
      sideBet({ moneyInPence: 40_000 }),
    );
    expect(pot(result, "Degen").overBy).toEqual({ percent: 14.29, amountPence: 5_000 });
    expect(result.fixIt).toEqual({ outOfSideBetPence: 5_000 });
  });

  it("uses the real limit once net assets are set", () => {
    const result = evaluateRules(
      potsWithSideBet(100_000),
      DEFAULT_RULES,
      sideBet({ limitPence: 640_000, moneyInPence: 100_000, starterLimit: false }),
    );
    expect(pot(result, "Degen")).toMatchObject({
      status: "ok",
      limit: { limit: 640_000, usedPercent: 15.63, starter: false },
    });
  });

  it("has nothing to say when Side Bet isn't connected", () => {
    const result = evaluateRules(pots({ Base: 75_000, Medium: 25_000 }), DEFAULT_RULES, sideBet());
    expect(pot(result, "Degen")).toMatchObject({ status: "unavailable", limit: null });
    expect(result.needsAttention).toBe(false);
  });

  it("doesn't claim growth when Side Bet is worth less than went in", () => {
    const result = evaluateRules(
      potsWithSideBet(5_000),
      DEFAULT_RULES,
      sideBet({ moneyInPence: 20_000 }),
    );
    expect(pot(result, "Degen").limit).toMatchObject({ value: 5_000, moneyIn: 20_000 });
    expect(pot(result, "Degen").limit!.grownBy).toBeUndefined();
  });
});

describe("with nothing anywhere", () => {
  it("judges no drift, because there's no shape to judge", () => {
    const result = evaluateRules(pots({ Base: 0, Medium: 0, Degen: 0 }), DEFAULT_RULES, sideBet());
    expect(result.totalPence).toBe(0);
    expect(result.pots.every((p) => p.status === "ok")).toBe(true);
    expect(pot(result, "Base").driftPoints).toBeNull();
  });
});
