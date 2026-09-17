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
      ...(pot.limit ? { limit: pot.limit } : {}),
      plain: available ? plainFor(pot, evaluation.scaled) : unavailablePlain(bucket),
    };
  });

  return {
    rules,
    settings: stored.settings,
    ...(stored.updatedAt ? { lastChangedAt: stored.updatedAt.toISOString() } : {}),
    needsAttention: evaluation.needsAttention,
    leftOut: evaluation.leftOut,
    ...(evaluation.fixIt ? { fixIt: { outOfSideBet: evaluation.fixIt.outOfSideBetPence } } : {}),
    monthlySplit,
  };
}

function plainFor(pot: RulesEvaluation["pots"][number], scaled: boolean): string {
  const name = displayNameFor(pot.bucket);
  const actual = percentPlain(pot.actualPercent);
  if (pot.kind === "cap") return sideBetPlain(pot, name);
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

/**
 * Side Bet is money in, less taken out, against a limit in pounds — never a
 * share of everything. The limit is "the FCA's 10% guide", never "the law", and
 * Pip says plainly that it only counts what it can see.
 */
function sideBetPlain(pot: RulesEvaluation["pots"][number], name: string): string {
  const limit = pot.limit!;
  const line = limit.starter
    ? `the £${pounds(limit.limit)} starter limit`
    : `your £${pounds(limit.limit)} limit`;
  const moneyIn = `£${pounds(limit.moneyIn)} of ${line}`;
  const grown = limit.grownBy
    ? ` It has grown to £${pounds(limit.value)} — more than you put in. That's good news.`
    : "";

  if (pot.status === "over_limit") {
    return `${name} has reached ${line}: you've put in £${pounds(limit.moneyIn)} over the last year.${grown}`;
  }
  if (pot.status === "near_limit") {
    return `${name} is near ${line}: ${moneyIn} in the last year.${grown}`;
  }
  return `${name} is ${moneyIn}, counting money in less what you've taken out over the last year.${grown}`;
}

/** Whole pounds, with thousands separated — pence never appear on this line. */
function pounds(pence: number): string {
  return Math.round(pence / 100).toLocaleString("en-GB");
}

function percentPlain(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}
