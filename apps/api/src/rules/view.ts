import {
  BUCKETS,
  displayNameFor,
  type Bucket,
  type BucketRule,
  type OverBy,
  type RulesView,
  type RuleStatus,
} from "@finance-app/shared";
import type { RulesEvaluation } from "./engine.js";
import type { StoredRules } from "./store.js";

/**
 * Turning the engine's answer into what the screens read. Both read models
 * (sample data and real accounts) go through here, so `/rules`, `/portfolio`
 * and `/buckets/:id` can't tell different stories.
 */

/** The flags a pot carries on Pots and on its own page. */
export function ruleFlagFor(
  evaluation: RulesEvaluation,
  bucket: Bucket,
): { ruleStatus: RuleStatus; overBy?: OverBy } {
  const pot = evaluation.pots.find((p) => p.bucket === bucket)!;
  return {
    ruleStatus: pot.status,
    ...(pot.overBy
      ? { overBy: { percent: pot.overBy.percent, amount: pot.overBy.amountPence } }
      : {}),
  };
}

export function rulesView(
  evaluation: RulesEvaluation,
  stored: StoredRules,
  monthlySplit: RulesView["monthlySplit"],
  unavailablePlain: (bucket: Bucket) => string,
): RulesView {
  const rules: BucketRule[] = BUCKETS.map((bucket) => {
    const pot = evaluation.pots.find((p) => p.bucket === bucket)!;
    const available = pot.status !== "unavailable";
    return {
      bucket,
      kind: pot.kind,
      targetPercent: pot.linePercent,
      actualPercent: pot.actualPercent,
      available,
      status: pot.status,
      judgedAgainstPercent: pot.judgedAgainstPercent,
      ...(pot.driftPoints === null ? {} : { driftPoints: pot.driftPoints }),
      ...(pot.overBy
        ? { overBy: { percent: pot.overBy.percent, amount: pot.overBy.amountPence } }
        : {}),
      plain: available ? plainFor(pot, evaluation.scaled) : unavailablePlain(bucket),
    };
  });

  return {
    rules,
    settings: stored.settings,
    ...(stored.updatedAt ? { lastChangedAt: stored.updatedAt.toISOString() } : {}),
    needsAttention: evaluation.needsAttention,
    leftOut: evaluation.leftOut,
    ...(evaluation.fixIt
      ? {
          fixIt: {
            outOfSideBet: evaluation.fixIt.outOfSideBetPence,
            intoOtherPots: evaluation.fixIt.intoOtherPotsPence,
          },
        }
      : {}),
    monthlySplit,
  };
}

function plainFor(pot: RulesEvaluation["pots"][number], scaled: boolean): string {
  const name = displayNameFor(pot.bucket);
  const actual = percentPlain(pot.actualPercent);
  if (pot.kind === "cap") {
    return pot.status === "over_cap"
      ? `${name} is ${actual} of your money — over the ${pot.linePercent}% cap you set.`
      : `${name} is ${actual} of your money, under the ${pot.linePercent}% cap you set.`;
  }
  const against = scaled
    ? `${percentPlain(pot.judgedAgainstPercent)} — your ${pot.linePercent}% scaled to the pots Pip can see`
    : `the ${pot.linePercent}% you set`;
  if (pot.status === "drifted" && pot.driftPoints !== null) {
    const points = percentPlain(Math.abs(pot.driftPoints)).replace("%", "");
    const way = pot.driftPoints > 0 ? "above" : "below";
    return `${name} is ${actual} of your money, ${points} points ${way} ${against}.`;
  }
  return `${name} is ${actual} of your money, against ${against}.`;
}

function percentPlain(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}
