import { displayNameFor, type Bucket, type Pence } from "@finance-app/shared";
import type { NudgeDraft } from "./types.js";
import { inDays, listOf, percentText, plural, shortDate, wholePounds } from "./words.js";

/**
 * Pip's own sentences — for every nudge that isn't news, for news when the
 * reader doesn't have personal research on, and whenever an LLM draft fails
 * the guard. Deterministic, pounds before percent, no advice.
 *
 * `TemplateFacts` mirrors the candidate facts the build hands over
 * (`nudges/candidates.ts`); a type test there keeps the two in step.
 */

export type TemplateFacts =
  | {
      type: "cap";
      bucket: Bucket;
      overBy: { percent: number; pence: Pence };
      /** Since Phase 6 the limit is in pounds, so one amount brings it back. */
      fixIt: { outOfSideBetPence: Pence } | null;
      starterLimit: boolean;
    }
  | {
      type: "drift";
      bucket: Bucket;
      actualPercent: number;
      judgedAgainstPercent: number;
      driftPoints: number;
    }
  | { type: "earnings"; name: string; shortName: string; onDate: string; daysAway: number }
  | { type: "isa_year_end"; onDate: string; daysAway: number }
  | { type: "net_assets_review"; reviewedAt: string; monthsAgo: number }
  | {
      type: "move";
      name: string;
      shortName: string;
      bucket?: Bucket;
      period: "day" | "week";
      move: { percent: number; pence: Pence };
      threshold: number;
    }
  | {
      type: "news";
      name: string;
      shortName: string;
      reports: { id: string; publisher: string; publishedAt: Date }[];
      /** One name per organisation, when the build has worked that out. */
      publishers?: string[];
    }
  | {
      type: "quiet";
      counts: {
        holdingsChecked: number;
        reportsRead: number;
        reportsCounted: number;
        heldBack: Partial<Record<string, number>>;
      };
      next: { what: string; onDate: string } | null;
    };

const draft = (title: string, body: string, citedIds: string[] = []): NudgeDraft => ({
  title,
  body,
  citedIds,
  model: "template",
  promptVersion: null,
});

function distinctPublishers(reports: { publisher: string }[]): string[] {
  return [...new Set(reports.map((report) => report.publisher))];
}

export function templateFor(
  facts: TemplateFacts,
  context: { bucket?: Bucket | null } = {},
): NudgeDraft {
  switch (facts.type) {
    case "cap": {
      const line = facts.starterLimit ? "its starter limit" : "its limit";
      const title = `Side Bet has reached ${line}`;
      const amounts = facts.fixIt
        ? ` Taking ${wholePounds(facts.fixIt.outOfSideBetPence)} out of Side Bet would bring it back under.`
        : "";
      return draft(
        title,
        `You've put in ${wholePounds(facts.overBy.pence)} more than ${line} over the last year.${amounts} You'd do that at your broker.`,
      );
    }
    case "drift": {
      const name = displayNameFor(facts.bucket);
      const direction = facts.driftPoints > 0 ? "over" : "under";
      const points = Math.round(Math.abs(facts.driftPoints));
      return draft(
        `${name} has drifted ${points} points ${direction}`,
        `It's ${percentText(facts.actualPercent)} of what Pip can see, against the ${percentText(facts.judgedAgainstPercent)} you set. Nothing's broken — a drifting target is just worth knowing about.`,
      );
    }
    case "earnings":
      return draft(
        `${facts.name} reports results on ${shortDate(facts.onDate)}`,
        `${inDays(facts.daysAway)}. It's a date on the calendar, not a prediction — share prices can move around results days.`,
      );
    case "net_assets_review":
      return draft(
        "Time to check your net assets",
        `You last gave them ${facts.monthsAgo} months ago, and they set Side Bet's limit — the FCA's 10% guide. Update them in Setup if they've changed. Pip only counts Side Bet, not anything high-risk you hold elsewhere.`,
      );
    case "isa_year_end":
      return draft(
        `The ISA year ends on ${shortDate(facts.onDate)}`,
        `${inDays(facts.daysAway)}. Money meant for this tax year's ISA allowance has to be in by then; next year's allowance starts the day after.`,
      );
    case "move": {
      const up = facts.move.pence >= 0;
      const when = facts.period === "day" ? "today" : "this week";
      const bucket = facts.bucket ?? context.bucket;
      const line = bucket ? ` for ${displayNameFor(bucket)}` : "";
      return draft(
        `${facts.name} is ${up ? "up" : "down"} ${wholePounds(facts.move.pence)} ${when}`,
        `That's ${percentText(facts.move.percent)}, past the ${facts.threshold}% line you set${line}. Big moves happen; this is here so it isn't a surprise.`,
      );
    }
    case "news": {
      const publishers = facts.publishers ?? distinctPublishers(facts.reports);
      const named =
        publishers.length > 3
          ? `${publishers.slice(0, 3).join(", ")} and ${plural(publishers.length - 3, "more")}`
          : listOf(publishers);
      return draft(
        `${facts.name} was in the news`,
        `${plural(facts.reports.length, "report")} from ${plural(publishers.length, "named publisher")}: ${named}. The links are below.`,
        facts.reports.map((report) => report.id),
      );
    }
    case "quiet": {
      const { holdingsChecked, reportsRead, heldBack } = facts.counts;
      const held = Object.values(heldBack).reduce<number>((sum, n) => sum + (n ?? 0), 0);
      const checked = `Pip checked ${plural(holdingsChecked, "holding")} and read ${plural(reportsRead, "news report")}`;
      const through =
        held > 0
          ? `${plural(held, "thing")} didn't get past your trust rules.`
          : "Nothing got past your trust rules.";
      const next = facts.next
        ? ` Next on the calendar: ${facts.next.what}, ${shortDate(facts.next.onDate)}.`
        : "";
      return draft("Nothing needs you this week.", `${checked}. ${through}${next}`);
    }
  }
}

export const OPENING_TEMPLATE = "Here's your week.";
