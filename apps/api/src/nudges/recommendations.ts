import type { Bucket } from "@finance-app/shared";
import {
  recommendationTemplate,
  type RecommendationBriefInput,
} from "../research/recommendation.js";
import type { NudgeWriter } from "../research/writer.js";
import { exclusionsCheck } from "../rules/trust.js";
import type { Gathered } from "./gather.js";
import type { NewNudge } from "./store.js";
import {
  evaluateRecommendations,
  type RecommendationHit,
  type TriggerInput,
  type TriggerStateStore,
} from "./triggers.js";

/**
 * Recommendations on the daily path (phase-6.md decision 14): the build's
 * own numbers → the triggers → one brief per confirmed crossing, logged as a
 * `recommendation` nudge. Personal research only — the caller checks.
 */

/** The triggers' input, from the same numbers every screen shows. */
export function triggerInputFrom(gathered: Gathered, now: Date, day: string): TriggerInput {
  const { rules } = gathered.input;
  const sideBet = rules.pots.find((pot) => pot.bucket === "Degen")?.limit ?? null;

  const holdings: TriggerInput["holdings"] = [...gathered.details.values()].map(({ detail }) => {
    const moved = !(detail.today.amount === 0 && detail.today.percent === 0);
    return {
      instrumentId: detail.id,
      name: detail.name,
      bucket: detail.bucket,
      valuePence: detail.value,
      // What went in is today's value less the gain since bought, when it's known.
      costPence: detail.sinceBoughtUnavailable ? null : detail.value - detail.sinceBought.amount,
      dayMovePercent: moved ? detail.today.percent : null,
      dayMovePence: moved ? detail.today.amount : null,
      moveLine: gathered.trust.bigMovePercent[detail.bucket],
    };
  });

  // Foundation and Handpicked are judged as shares of the two of them.
  const inShape = rules.pots.filter((pot) => pot.bucket !== "Degen");
  const inShapePence =
    (rules.totalPence * inShape.reduce((sum, p) => sum + p.actualPercent, 0)) / 100;
  const pots: TriggerInput["pots"] = inShape
    .filter((pot) => pot.status !== "unavailable")
    .map((pot) => ({
      bucket: pot.bucket as "Base" | "Medium",
      driftPoints: pot.driftPoints,
      offTargetPence: Math.round(((pot.driftPoints ?? 0) * inShapePence) / 100),
    }));

  return {
    now,
    day,
    // The starter limit isn't 10% of anything, so R1 waits for net assets.
    sideBet:
      sideBet && !sideBet.starter ? { valuePence: sideBet.value, limitPence: sideBet.limit } : null,
    holdings,
    pots,
  };
}

function briefInput(hit: RecommendationHit, gathered: Gathered): RecommendationBriefInput {
  const { profile } = gathered;
  return {
    trigger: hit.trigger,
    course: hit.recommendation,
    amountPence: hit.amountPence,
    bucket: hit.bucket,
    name: hit.name,
    facts: hit.facts,
    plan: {
      goals: profile.goals,
      horizonYears: profile.horizonYears,
      riskWords: profile.riskWords,
      shape: {
        foundation: 100 - gathered.rules.handpickedTarget,
        handpicked: gathered.rules.handpickedTarget,
      },
    },
  };
}

export async function recommendationRows(
  deps: { triggers: TriggerStateStore; writer: NudgeWriter },
  user: { userId: string },
  gathered: Gathered,
  builtOn: string,
  now: Date,
): Promise<NewNudge[]> {
  const hits = await evaluateRecommendations(
    deps.triggers,
    user.userId,
    triggerInputFrom(gathered, now, builtOn),
  );
  const rows: NewNudge[] = [];
  for (const hit of hits) {
    const holding = hit.instrumentId ? gathered.details.get(hit.instrumentId) : undefined;
    // Something on their exclusions list is logged, never shown or pushed —
    // and never sent to a writer.
    const excluded = exclusionsCheck(
      gathered.input.exclusions,
      hit.name,
      holding?.detail.ticker ?? "",
    );
    const input = briefInput(hit, gathered);
    const words = excluded.passed
      ? await deps.writer.recommendation(input)
      : recommendationTemplate(input);
    rows.push({
      cadence: "daily",
      kind: "recommendation",
      reason: hit.trigger,
      bucket: hit.bucket as Bucket,
      instrumentId: hit.instrumentId,
      title: words.title,
      body: words.body,
      basis: null,
      facts: {
        type: "recommendation",
        name: hit.name,
        shortName: holding?.detail.ticker ?? "",
        amountPence: hit.amountPence,
        eventId: hit.eventId,
        brief: words.parts,
        ...hit.facts,
      },
      checks: [excluded],
      shown: excluded.passed,
      model: words.model,
      promptVersion: words.promptVersion,
      personalised: true,
      // One brief per crossing, however many runs see it.
      dedupeKey: `rec:${hit.eventId}`,
      builtOn,
      priceAt: holding ? String(holding.detail.price) : null,
      priceCurrency: holding ? "GBP_PENCE" : null,
      priceSource: holding ? holding.detail.freshness.source : null,
      potShareAt: null,
      urgent: hit.urgent,
      recommendation: hit.recommendation,
      trigger: hit.trigger,
    });
  }
  return rows;
}
