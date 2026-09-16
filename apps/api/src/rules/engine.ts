import {
  BUCKETS,
  DRIFT_THRESHOLD_POINTS,
  type Bucket,
  type Pence,
  type RuleSettings,
} from "@finance-app/shared";

/**
 * The rules engine (Phase 4): the one place that decides whether a pot has
 * drifted from its target or Side Bet has broken its cap. Pure — no I/O, no
 * clock — so every route that asks gets the same answer for the same input.
 * It only ever describes; nothing here can move money (hard lines 1, 2, 11).
 *
 * Decisions (docs/phases/phase-4.md):
 * - Foundation's target is 100 − Handpicked's target − Side Bet's cap.
 * - A pot's share is its value (investments + cash) over every connected pot's.
 * - Targets are judged against the connected pots only: their shape is scaled
 *   so it adds up to 100 over what Pip can see. Side Bet's cap is never scaled.
 * - A target has drifted at `DRIFT_THRESHOLD_POINTS` or more either way.
 * - The cap is broken when Side Bet is over it by any amount.
 */

export interface PotInput {
  bucket: Bucket;
  connected: boolean;
  /** Investments plus cash, pence. */
  valuePence: Pence;
}

export type RuleStatus = "ok" | "drifted" | "over_cap" | "unavailable";

export interface PotRuleResult {
  bucket: Bucket;
  kind: "target" | "cap";
  /** The line as set: a target for Foundation and Handpicked, the cap for Side Bet. */
  linePercent: number;
  /** The target it's judged against once scaled over connected pots; for Side Bet, the cap itself. */
  judgedAgainstPercent: number;
  /** Share of everything connected, to 2 dp. 0 when not connected. */
  actualPercent: number;
  status: RuleStatus;
  /** Actual − judged-against, percentage points to 2 dp (targets only). */
  driftPoints: number | null;
  /** Side Bet over its cap: by how much, in points and pounds. */
  overBy: { percent: number; amountPence: Pence } | null;
}

export interface RulesEvaluation {
  totalPence: Pence;
  pots: PotRuleResult[];
  /** Pots left out of the shape because they aren't connected (empty when none is). */
  leftOut: Bucket[];
  /** True when the shape was rescaled because some pot isn't connected. */
  scaled: boolean;
  /** A cap is broken: the red dot, the verdict, the banner. */
  needsAttention: boolean;
  /**
   * When the cap is broken, the two amounts that would bring Side Bet back to
   * it — arithmetic, not advice, shown with equal weight.
   */
  fixIt: {
    /** Leaving Side Bet (and Pip's pots altogether). */
    outOfSideBetPence: Pence;
    /** New money into Foundation and Handpicked. Null when the cap is 0 — no amount would do. */
    intoOtherPotsPence: Pence | null;
  } | null;
}

/** The shape as set, in whole percent per pot. */
export function shapeOf(settings: RuleSettings): Record<Bucket, number> {
  return {
    Base: 100 - settings.handpickedTarget - settings.sideBetCap,
    Medium: settings.handpickedTarget,
    Degen: settings.sideBetCap,
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function evaluateRules(potInputs: PotInput[], settings: RuleSettings): RulesEvaluation {
  const shape = shapeOf(settings);
  const byBucket = new Map(potInputs.map((pot) => [pot.bucket, pot]));
  const connected = BUCKETS.filter((bucket) => byBucket.get(bucket)?.connected);
  const leftOut = BUCKETS.filter((bucket) => !byBucket.get(bucket)?.connected);
  const total = connected.reduce((sum, bucket) => sum + byBucket.get(bucket)!.valuePence, 0);
  const connectedShape = connected.reduce((sum, bucket) => sum + shape[bucket], 0);

  const pots = BUCKETS.map((bucket): PotRuleResult => {
    const pot = byBucket.get(bucket);
    const kind = bucket === "Degen" ? "cap" : "target";
    const linePercent = shape[bucket];
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
      };
    }
    const exactShare = total === 0 ? 0 : (pot.valuePence * 100) / total;

    if (kind === "cap") {
      // Integer comparison so a share of exactly the cap isn't "over" by a rounding error.
      const over = pot.valuePence * 100 > settings.sideBetCap * total;
      return {
        bucket,
        kind,
        linePercent,
        judgedAgainstPercent: linePercent,
        actualPercent: round2(exactShare),
        status: over ? "over_cap" : "ok",
        driftPoints: null,
        overBy: over
          ? {
              percent: round2(exactShare - settings.sideBetCap),
              amountPence: pot.valuePence - Math.floor((settings.sideBetCap * total) / 100),
            }
          : null,
      };
    }

    const judgedAgainst = connectedShape === 0 ? 0 : (linePercent * 100) / connectedShape;
    const drift = exactShare - judgedAgainst;
    // With nothing in any pot there's no shape to judge.
    const drifted = total > 0 && Math.abs(drift) >= DRIFT_THRESHOLD_POINTS - 1e-9;
    return {
      bucket,
      kind,
      linePercent,
      judgedAgainstPercent: round2(judgedAgainst),
      actualPercent: round2(exactShare),
      status: drifted ? "drifted" : "ok",
      driftPoints: total === 0 ? null : round2(drift),
      overBy: null,
    };
  });

  const sideBet = pots.find((pot) => pot.bucket === "Degen")!;
  const needsAttention = sideBet.status === "over_cap";
  let fixIt: RulesEvaluation["fixIt"] = null;
  if (needsAttention) {
    const value = byBucket.get("Degen")!.valuePence;
    const cap = settings.sideBetCap;
    fixIt = {
      // (value − x) / (total − x) = cap / 100  →  x = (100·value − cap·total) / (100 − cap)
      outOfSideBetPence: Math.ceil((100 * value - cap * total) / (100 - cap)),
      // value / (total + y) = cap / 100  →  y = 100·value / cap − total
      intoOtherPotsPence: cap === 0 ? null : Math.ceil((100 * value) / cap - total),
    };
  }

  return {
    totalPence: total,
    pots,
    leftOut: connected.length === 0 ? [] : leftOut,
    scaled: connected.length > 0 && leftOut.length > 0,
    needsAttention,
    fixIt,
  };
}
