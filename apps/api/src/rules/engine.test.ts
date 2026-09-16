import { DEFAULT_RULES, DRIFT_THRESHOLD_POINTS, type Bucket } from "@finance-app/shared";
import { describe, expect, it } from "vitest";
import { evaluateRules, shapeOf, type PotInput } from "./engine.js";

const pots = (values: Partial<Record<Bucket, number | null>>): PotInput[] =>
  (["Base", "Medium", "Degen"] as const).map((bucket) => ({
    bucket,
    connected: values[bucket] !== undefined && values[bucket] !== null,
    valuePence: values[bucket] ?? 0,
  }));

const pot = (result: ReturnType<typeof evaluateRules>, bucket: Bucket) =>
  result.pots.find((p) => p.bucket === bucket)!;

describe("the shape", () => {
  it("makes Foundation whatever Handpicked and Side Bet leave", () => {
    expect(shapeOf(DEFAULT_RULES)).toEqual({ Base: 70, Medium: 25, Degen: 5 });
    expect(shapeOf({ handpickedTarget: 30, sideBetCap: 12 })).toEqual({
      Base: 58,
      Medium: 30,
      Degen: 12,
    });
  });

  it("uses a named five-point drift threshold", () => {
    expect(DRIFT_THRESHOLD_POINTS).toBe(5);
  });
});

describe("evaluating rules", () => {
  it("finds nothing wrong when every pot sits on its line", () => {
    const result = evaluateRules(
      pots({ Base: 70_000, Medium: 25_000, Degen: 5_000 }),
      DEFAULT_RULES,
    );
    expect(result).toMatchObject({
      totalPence: 100_000,
      needsAttention: false,
      fixIt: null,
      scaled: false,
      leftOut: [],
    });
    expect(result.pots.map((p) => [p.bucket, p.status, p.actualPercent, p.driftPoints])).toEqual([
      ["Base", "ok", 70, 0],
      ["Medium", "ok", 25, 0],
      ["Degen", "ok", 5, null],
    ]);
  });

  it("doesn't call a Side Bet exactly at its cap over, but does a penny above", () => {
    const at = evaluateRules(pots({ Base: 70_000, Medium: 25_000, Degen: 5_000 }), DEFAULT_RULES);
    expect(pot(at, "Degen")).toMatchObject({ status: "ok", overBy: null });

    const above = evaluateRules(
      pots({ Base: 69_999, Medium: 25_000, Degen: 5_001 }),
      DEFAULT_RULES,
    );
    expect(pot(above, "Degen")).toMatchObject({
      status: "over_cap",
      overBy: { percent: 0, amountPence: 1 },
    });
    expect(above.needsAttention).toBe(true);
  });

  it("states how far over the cap in points and pounds", () => {
    const result = evaluateRules(
      pots({ Base: 70_200, Medium: 23_000, Degen: 6_800 }),
      DEFAULT_RULES,
    );
    expect(pot(result, "Degen")).toMatchObject({
      actualPercent: 6.8,
      overBy: { percent: 1.8, amountPence: 1_800 },
    });
  });

  it("calls a target drifted at exactly five points, either way, and not just under", () => {
    const five = evaluateRules(pots({ Base: 75_000, Medium: 20_000, Degen: 5_000 }), DEFAULT_RULES);
    expect(pot(five, "Base")).toMatchObject({ status: "drifted", driftPoints: 5 });
    expect(pot(five, "Medium")).toMatchObject({ status: "drifted", driftPoints: -5 });

    const under = evaluateRules(
      pots({ Base: 74_990, Medium: 20_010, Degen: 5_000 }),
      DEFAULT_RULES,
    );
    expect(pot(under, "Base")).toMatchObject({ status: "ok", driftPoints: 4.99 });
    expect(under.needsAttention).toBe(false);
  });

  it("never lets drift alone need attention", () => {
    const result = evaluateRules(
      pots({ Base: 95_000, Medium: 1_000, Degen: 4_000 }),
      DEFAULT_RULES,
    );
    expect(pot(result, "Base").status).toBe("drifted");
    expect(result.needsAttention).toBe(false);
  });

  it("judges targets against the connected pots, but never scales the cap", () => {
    // Handpicked not connected: 70 + 5 = 75 → Foundation judged against 93.33.
    const result = evaluateRules(pots({ Base: 93_333, Degen: 6_667 }), DEFAULT_RULES);
    expect(result).toMatchObject({ scaled: true, leftOut: ["Medium"], totalPence: 100_000 });
    expect(pot(result, "Base")).toMatchObject({ judgedAgainstPercent: 93.33, status: "ok" });
    expect(pot(result, "Medium")).toMatchObject({ status: "unavailable", actualPercent: 0 });
    expect(pot(result, "Degen")).toMatchObject({ judgedAgainstPercent: 5, status: "over_cap" });
  });

  it("gives the two amounts that would bring Side Bet back to its cap", () => {
    const value = 6_800;
    const total = 100_000;
    const result = evaluateRules(
      pots({ Base: 70_200, Medium: 23_000, Degen: value }),
      DEFAULT_RULES,
    );
    const { outOfSideBetPence, intoOtherPotsPence } = result.fixIt!;
    expect(outOfSideBetPence).toBe(1_895);
    expect(intoOtherPotsPence).toBe(36_000);
    // Either one really lands on or under the cap.
    expect((value - outOfSideBetPence) / (total - outOfSideBetPence)).toBeLessThanOrEqual(0.05);
    expect(value / (total + intoOtherPotsPence!)).toBeLessThanOrEqual(0.05);
    // And a penny less wouldn't.
    expect((value - (outOfSideBetPence - 1)) / (total - (outOfSideBetPence - 1))).toBeGreaterThan(
      0.05,
    );
  });

  it("with a cap of 0, says only emptying Side Bet would do", () => {
    const result = evaluateRules(pots({ Base: 90_000, Medium: 9_000, Degen: 1_000 }), {
      handpickedTarget: 25,
      sideBetCap: 0,
    });
    expect(result.fixIt).toEqual({ outOfSideBetPence: 1_000, intoOtherPotsPence: null });
  });

  it("finds nothing to judge in empty accounts", () => {
    const result = evaluateRules(pots({ Base: 0, Medium: 0, Degen: 0 }), DEFAULT_RULES);
    expect(result.needsAttention).toBe(false);
    expect(result.pots.map((p) => [p.status, p.actualPercent, p.driftPoints])).toEqual([
      ["ok", 0, null],
      ["ok", 0, null],
      ["ok", 0, null],
    ]);
  });

  it("with nothing connected, every rule is unavailable and nothing is scaled", () => {
    const result = evaluateRules(pots({}), DEFAULT_RULES);
    expect(result).toMatchObject({
      scaled: false,
      leftOut: [],
      needsAttention: false,
      totalPence: 0,
    });
    expect(result.pots.every((p) => p.status === "unavailable")).toBe(true);
  });

  it("gives the same answer for the same input, and doesn't change the input", () => {
    const input = pots({ Base: 70_200, Medium: 23_000, Degen: 6_800 });
    const copy = structuredClone(input);
    expect(evaluateRules(input, DEFAULT_RULES)).toEqual(evaluateRules(copy, DEFAULT_RULES));
    expect(input).toEqual(copy);
  });
});
