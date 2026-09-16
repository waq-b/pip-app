import type { BucketSummary, RulesView } from "@finance-app/shared";
import { describe, expect, it } from "vitest";
import { targetSentence } from "./portfolio";
import { someRuleNeedsALook } from "./rules";

const flat = { amount: 0, percent: 0, direction: "flat" as const };
const pot = (overrides: Partial<BucketSummary>): BucketSummary => ({
  bucket: "Base",
  value: 0,
  change: flat,
  blurb: "",
  shareOfTotal: 0,
  targetPercent: 0,
  series: [],
  ...overrides,
});

describe("the shape sentence", () => {
  it("says where you are against what you asked for", () => {
    expect(
      targetSentence([
        pot({ bucket: "Base", targetPercent: 70, shareOfTotal: 72 }),
        pot({ bucket: "Medium", targetPercent: 25, shareOfTotal: 21 }),
        pot({ bucket: "Degen", targetPercent: 5, shareOfTotal: 7 }),
      ]),
    ).toBe("You asked for 70 / 25 / 5. You're at 72 / 21 / 7.");
  });

  it("adds a calm line naming drifted pots, from the engine's answer", () => {
    expect(
      targetSentence([
        pot({ bucket: "Base", targetPercent: 70, shareOfTotal: 80, ruleStatus: "drifted" }),
        pot({ bucket: "Medium", targetPercent: 25, shareOfTotal: 15, ruleStatus: "drifted" }),
        pot({ bucket: "Degen", targetPercent: 5, shareOfTotal: 5, ruleStatus: "ok" }),
      ]),
    ).toBe(
      "You asked for 70 / 25 / 5. You're at 80 / 15 / 5. Foundation and Handpicked have drifted 5 points or more from their targets.",
    );
  });
});

describe("the red dot on Rules", () => {
  const rules = (overrides: Partial<RulesView>): RulesView => ({
    rules: [],
    monthlySplit: { total: 0, perBucket: [] },
    ...overrides,
  });

  it("follows the engine when it has answered", () => {
    expect(someRuleNeedsALook(rules({ needsAttention: true }))).toBe(true);
    expect(someRuleNeedsALook(rules({ needsAttention: false }))).toBe(false);
  });

  it("never lights for drift alone", () => {
    expect(
      someRuleNeedsALook(
        rules({
          needsAttention: false,
          rules: [
            {
              bucket: "Base",
              kind: "target",
              targetPercent: 70,
              actualPercent: 90,
              plain: "",
              status: "drifted",
            },
          ],
        }),
      ),
    ).toBe(false);
  });
});
