import {
  BUCKETS,
  DRIFT_THRESHOLD_POINTS,
  LIMIT_ALERT_SHARES,
  type Bucket,
  type Pence,
  type RuleSettings,
  type SideBetLimit,
} from "@finance-app/shared";

/**
 * The rules engine (Phase 4, reshaped in Phase 6): the one place that decides
 * whether a pot has drifted from its target, or Side Bet has reached its
 * limit. Pure — no I/O, no clock — so every route that asks gets the same
 * answer for the same input. It only ever describes; nothing here can move
 * money (design rules 1, 2, 8).
 *
 * Decisions:
 * - The shape is Foundation and Handpicked only: Foundation's target is
 *   100 − Handpicked's. Side Bet sits outside it.
 * - A pot's share is its value (investments + cash) over every connected pot's.
 * - Targets are judged against the connected pots only: their shape is scaled
 *   so it adds up to 100 over what Pip can see.
 * - A target has drifted at `DRIFT_THRESHOLD_POINTS` or more either way.
 * - **Side Bet is judged on money in, less taken out, over 12 months against a
 *   limit in pounds** — the FCA's 10% guide on net assets, or the starter limit
 *   until they're set. Money in only moves when money moves, so prices can't
 *   push it over. What Side Bet is *worth* is the growth line, never red.
 */

export interface PotInput {
  bucket: Bucket;
  connected: boolean;
  /** Investments plus cash, pence. */
  valuePence: Pence;
}

/** What Side Bet is judged against, worked out before the engine runs. */
export interface SideBetInput {
  limitPence: Pence;
  /** Money in minus money taken out, over the last 12 months. Never below zero. */
  moneyInPence: Pence;
  /** True while net assets aren't set and the flat starter limit applies. */
  starterLimit: boolean;
}

export type RuleStatus = "ok" | "drifted" | "near_limit" | "over_limit" | "unavailable";

export interface PotRuleResult {
  bucket: Bucket;
  kind: "target" | "cap";
  /** The target as set. Meaningless for Side Bet, which has a limit instead. */
  linePercent: number;
  /** The target it's judged against once scaled over connected pots. */
  judgedAgainstPercent: number;
  /** Share of everything connected, to 2 dp. 0 when not connected. */
  actualPercent: number;
  status: RuleStatus;
  /** Actual − judged-against, percentage points to 2 dp (targets only). */
  driftPoints: number | null;
  /** Side Bet past its limit: by how much, in points of the limit and in pounds. */
  overBy: { percent: number; amountPence: Pence } | null;
  /** Side Bet only: the limit and what it's judged against. */
  limit: SideBetLimit | null;
}

export interface RulesEvaluation {
  totalPence: Pence;
  pots: PotRuleResult[];
  /** Pots left out of the shape because they aren't connected (empty when none is). */
  leftOut: Bucket[];
  /** True when the shape was rescaled because some pot isn't connected. */
  scaled: boolean;
  /** Side Bet has reached its limit: the red dot, the verdict, the banner. */
  needsAttention: boolean;
  /**
   * When Side Bet is past its limit, what taking that much out would bring it
   * back under — arithmetic, not advice, and Pip can't do it.
   */
  fixIt: { outOfSideBetPence: Pence } | null;
}

/** The shape as set, in whole percent. Side Bet isn't in it. */
export function shapeOf(settings: RuleSettings): Record<"Base" | "Medium", number> {
  return { Base: 100 - settings.handpickedTarget, Medium: settings.handpickedTarget };
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const [WARN_SHARE] = LIMIT_ALERT_SHARES;

export function evaluateRules(
  potInputs: PotInput[],
  settings: RuleSettings,
  sideBet: SideBetInput,
): RulesEvaluation {
  const shape = shapeOf(settings);
  const byBucket = new Map(potInputs.map((pot) => [pot.bucket, pot]));
  const connected = BUCKETS.filter((bucket) => byBucket.get(bucket)?.connected);
  const leftOut = BUCKETS.filter((bucket) => !byBucket.get(bucket)?.connected);
  const total = connected.reduce((sum, bucket) => sum + byBucket.get(bucket)!.valuePence, 0);
  // Side Bet is outside the shape, so only the two targets are scaled.
  const inShape = connected.filter((bucket) => bucket !== "Degen");
  const shapeTotal = inShape.reduce((sum, bucket) => sum + shape[bucket as "Base" | "Medium"], 0);
  const inShapeTotal = inShape.reduce((sum, bucket) => sum + byBucket.get(bucket)!.valuePence, 0);

  const pots = BUCKETS.map((bucket): PotRuleResult => {
    const pot = byBucket.get(bucket);
    const isSideBet = bucket === "Degen";
    const kind = isSideBet ? "cap" : "target";
    const linePercent = isSideBet ? 0 : shape[bucket as "Base" | "Medium"];
    if (!pot?.connected) {
      return {
        bucket,
        kind,
        linePercent,
        judgedAgainstPercent: linePercent,
        actualPercent: 0,
        status: "unavailable",
        driftPoints: null,
        overBy: null,
        limit: null,
      };
    }
    const exactShare = total === 0 ? 0 : (pot.valuePence * 100) / total;

    if (isSideBet) {
      const used = sideBet.limitPence === 0 ? 0 : (sideBet.moneyInPence * 100) / sideBet.limitPence;
      const over = sideBet.moneyInPence >= sideBet.limitPence;
      const near = !over && used >= WARN_SHARE * 100 - 1e-9;
      const grown = pot.valuePence - sideBet.moneyInPence;
      return {
        bucket,
        kind,
        linePercent,
        judgedAgainstPercent: linePercent,
        actualPercent: round2(exactShare),
        status: over ? "over_limit" : near ? "near_limit" : "ok",
        driftPoints: null,
        overBy: over
          ? {
              percent: round2(used - 100),
              amountPence: sideBet.moneyInPence - sideBet.limitPence,
            }
          : null,
        limit: {
          limit: sideBet.limitPence,
          moneyIn: sideBet.moneyInPence,
          value: pot.valuePence,
          usedPercent: round2(used),
          starter: sideBet.starterLimit,
          ...(grown > 0 ? { grownBy: grown } : {}),
        },
      };
    }

    const judgedAgainst = shapeTotal === 0 ? 0 : (linePercent * 100) / shapeTotal;
    // Targets are shares of the pots in the shape, so Side Bet's size never
    // drags Foundation and Handpicked off their targets.
    const shareOfShape = inShapeTotal === 0 ? 0 : (pot.valuePence * 100) / inShapeTotal;
    const drift = shareOfShape - judgedAgainst;
    // With nothing in either pot there's no shape to judge.
    const drifted = inShapeTotal > 0 && Math.abs(drift) >= DRIFT_THRESHOLD_POINTS - 1e-9;
    return {
      bucket,
      kind,
      linePercent,
      judgedAgainstPercent: round2(judgedAgainst),
      actualPercent: round2(exactShare),
      status: drifted ? "drifted" : "ok",
      driftPoints: inShapeTotal === 0 ? null : round2(drift),
      overBy: null,
      limit: null,
    };
  });

  const sideBetResult = pots.find((pot) => pot.bucket === "Degen")!;
  const needsAttention = sideBetResult.status === "over_limit";

  return {
    totalPence: total,
    pots,
    leftOut: connected.length === 0 ? [] : leftOut,
    scaled: connected.length > 0 && leftOut.filter((bucket) => bucket !== "Degen").length > 0,
    needsAttention,
    // Taking money out of Side Bet reduces money in, less taken out, pound for pound.
    fixIt: needsAttention ? { outOfSideBetPence: sideBet.moneyInPence - sideBet.limitPence } : null,
  };
}
