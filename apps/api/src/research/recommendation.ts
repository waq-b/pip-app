import {
  displayNameFor,
  type Bucket,
  type Pence,
  type Recommendation,
  type RecommendationTrigger,
} from "@finance-app/shared";
import type { NudgeDraft, PlanForWriter } from "./types.js";
import { percentText, wholePounds } from "./words.js";

/**
 * The recommendation brief (phase-6.md decision 14, CLAUDE.md hard line 12).
 * Personal research only. Code has already decided the trigger, the course
 * and every pound; this file only turns them into words:
 *
 *   the fact (title) → Pip's take (course and pounds, shown from the row's
 *   own fields) → why → what a disciplined investor typically does → the
 *   trade-off → "Your call."
 *
 * The template here is the whole brief when there's no writer, and the
 * fallback whenever the writer's answer fails the guard.
 */

export const YOUR_CALL = "Your call.";

export interface RecommendationBriefInput {
  trigger: RecommendationTrigger;
  course: Recommendation;
  /** Pounds that would follow the course, from code. */
  amountPence: Pence | null;
  bucket: Bucket;
  /** "Side Bet", "Nvidia", "Handpicked". */
  name: string;
  /** The figures the trigger read, as `readTriggers` froze them. */
  facts: {
    valuePence?: Pence;
    limitPence?: Pence;
    costPence?: Pence;
    multiple?: number;
    movePercent?: number;
    movePence?: Pence;
    moveLine?: number;
    driftPoints?: number;
    sideBetPastLimit?: boolean;
  };
  /** Present for a writer; the template doesn't use it. */
  plan?: PlanForWriter | null;
}

/** The parts of a brief between the take and "Your call.". */
export interface BriefParts {
  why: string;
  typical: string;
  tradeoff: string;
}

/** Outside an ISA a sale can be taxed; Foundation lives in the ISA. */
const taxNote = (bucket: Bucket) =>
  bucket === "Base" ? "" : " Outside an ISA, a sale can count towards capital gains tax.";

const multipleText = (multiple: number) =>
  `${Number.isInteger(multiple) ? multiple.toFixed(0) : multiple.toFixed(1)}×`;

/** Joins the parts into the body every brief ends the same way. */
export function briefBody(parts: BriefParts): string {
  return `${parts.why} ${parts.typical} ${parts.tradeoff} ${YOUR_CALL}`;
}

/** The fact the brief is about, pounds first. Always code's words. */
export function briefTitle(input: RecommendationBriefInput): string {
  const f = input.facts;
  switch (input.trigger) {
    case "side_bet_over_limit":
      return `Side Bet is worth ${wholePounds(f.valuePence ?? 0)}, past its ${wholePounds(f.limitPence ?? 0)} limit`;
    case "holding_multiple":
      return `${input.name} is worth ${multipleText(f.multiple ?? 0)} what you put in`;
    case "pot_off_target": {
      const points = Math.round(Math.abs(f.driftPoints ?? 0));
      return `${input.name} is ${points} points ${(f.driftPoints ?? 0) > 0 ? "over" : "under"} its target`;
    }
    case "urgent_move": {
      const up = (f.movePence ?? f.movePercent ?? 0) >= 0;
      return f.movePence !== undefined
        ? `${input.name} is ${up ? "up" : "down"} ${wholePounds(f.movePence)} today`
        : `${input.name} moved a long way today`;
    }
  }
}

/** Pip's own words for the reasons: no writer, or the writer's answer failed. */
export function templateParts(input: RecommendationBriefInput): BriefParts {
  const f = input.facts;
  const amount = wholePounds(input.amountPence ?? 0);
  switch (input.trigger) {
    case "side_bet_over_limit":
      return {
        why: `Its value has grown past 10% of your net assets — the limit you set with the FCA's guide. Taking ${amount} out would bring it back to the limit.`,
        typical:
          "A disciplined investor usually takes some profit when a punt outgrows its limit, so a small bet stays small.",
        tradeoff: `If it keeps climbing, the ${amount} you take out won't climb with it.${taxNote("Degen")}`,
      };
    case "holding_multiple":
      return {
        why: `You put in ${wholePounds(f.costPence ?? 0)} and it's worth ${wholePounds(f.valuePence ?? 0)} now. Taking your ${amount} stake out leaves the rest riding on gains alone.`,
        typical:
          "A disciplined investor often takes their stake out at a multiple like this: whatever happens next, the money they put in is back with them.",
        tradeoff: `If it keeps going, less of it is going with it.${taxNote(input.bucket)}`,
      };
    case "pot_off_target": {
      const over = (f.driftPoints ?? 0) > 0;
      const other = displayNameFor(over ? "Base" : "Medium");
      const into = over ? other : input.name;
      return {
        why: over
          ? `It's ${amount} more than your own target for it. Pointing new money at ${into} evens it back out.`
          : `It's ${amount} short of your own target for it. Pointing new money at ${into} evens it back out.`,
        typical:
          "Evening it out with new money, rather than moving what's already there, is how disciplined investors keep to their own shape.",
        tradeoff: `It takes longer, and ${over ? input.name : other} stays heavier until it's done.`,
      };
    }
    case "urgent_move": {
      const line =
        f.moveLine !== undefined ? ` — more than twice the ${f.moveLine}% line you set` : "";
      const moved =
        f.movePercent !== undefined ? `That's ${percentText(f.movePercent)} in a day${line}.` : "";
      if (input.course === "take_some_profit") {
        const also = f.multiple
          ? `It's also worth ${multipleText(f.multiple)} what you put in, so taking your ${amount} stake out still stands.`
          : "Side Bet is also past its limit, so taking some profit still stands.";
        return {
          why: `${moved} ${also}`.trim(),
          typical:
            "A big day doesn't change the discipline: a disciplined investor takes some profit at a multiple, not because of one day.",
          tradeoff: `If it keeps going, less of it is going with it.${taxNote(input.bucket)}`,
        };
      }
      return {
        why: `${moved} One day on its own isn't a reason to act.`.trim(),
        typical:
          "Disciplined investors tend to hold through a day like this and check whether the reasons they bought it still stand.",
        tradeoff: "Holding means riding out more days like this one.",
      };
    }
  }
}

/** A brief keeps its parts, so the Monday email can lay them out one per row. */
export type BriefDraft = NudgeDraft & { parts: BriefParts };

export function recommendationTemplate(input: RecommendationBriefInput): BriefDraft {
  const parts = templateParts(input);
  return {
    parts,
    title: briefTitle(input),
    body: briefBody(parts),
    citedIds: [],
    model: "template",
    promptVersion: null,
  };
}

/** Pip's take in a line, for a push: the course and its pounds. */
export function takeLine(course: Recommendation, amountPence: Pence | null): string {
  const amount = amountPence ? ` — ${wholePounds(amountPence)}` : "";
  switch (course) {
    case "hold":
      return "Pip's take: hold.";
    case "take_some_profit":
      return `Pip's take: take some profit${amount}.`;
    case "rebalance":
      return `Pip's take: even it back out${amount}.`;
  }
}
