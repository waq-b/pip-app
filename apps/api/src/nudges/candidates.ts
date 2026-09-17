import {
  displayNameFor,
  type Bucket,
  type NudgeCadence,
  type NudgeKind,
  type NudgeReason,
  type Pence,
  type TrustSettings,
} from "@finance-app/shared";
import type { RulesEvaluation } from "../rules/engine.js";
import {
  basisFor,
  capRoomCheck,
  exclusionsCheck,
  independentPublishers,
  independentSourcesCheck,
  resultsQuietCheck,
  stageA,
  type NewsItem,
  type TrustCheck,
  type TrustRuleId,
} from "../rules/trust.js";

/**
 * Candidate nudges (Phase 5 task 5): everything that might be worth saying
 * this week or today, built from numbers and facts Pip already has, each
 * checked against the user's trust rules, then trimmed to the budgets. Pure —
 * the build (task 7) gathers the input and the research module writes the
 * words. Nothing here produces text a reader sees beyond the basis line and
 * check details, and nothing can act on anything.
 */

const DAY_MS = 86_400_000;

/** A results date this close counts as "on the calendar". */
export const CALENDAR_LEAD_DAYS = { weekly: 7, daily: 2 } as const;
/** The ISA year-end is mentioned in the fortnight before 5 April. */
export const ISA_YEAR_END_LEAD_DAYS = { weekly: 14, daily: 2 } as const;
/** A broken cap is a daily nudge at most once in this long. */
export const CAP_DAILY_REPEAT_DAYS = 7;

export interface MoveFigures {
  percent: number;
  pence: Pence;
}

export interface HoldingInput {
  instrumentId: string;
  name: string;
  shortName: string;
  bucket: Bucket;
  /** Price moves, null when there isn't history for the period. */
  moves: { day: MoveFigures | null; week: MoveFigures | null; month: MoveFigures | null };
  /** Reports linked to this holding (all of them — stage A decides which count). */
  news: NewsItem[];
  /** Results dates, `YYYY-MM-DD`, past and future. */
  resultsDates: string[];
  /** The company's own newsroom domains; they count as named for this holding only. */
  ownNewsroomDomains: string[];
}

/** What's already been shown, for daily budgets and repeats. */
export interface NudgeHistory {
  dailyShownToday: number;
  dailyShownThisWeek: number;
  lastCapNudgeAt: Date | null;
  /** Keys of calendar and move nudges already shown as daily ones (see `dedupeKey`). */
  shownKeys: string[];
}

export interface CandidateInput {
  now: Date;
  cadence: NudgeCadence;
  settings: TrustSettings;
  exclusions: string[];
  rules: RulesEvaluation;
  holdings: HoldingInput[];
  history: NudgeHistory;
  /**
   * When the user last reviewed their net assets, and whether a year has
   * passed (Phase 6). Null when they've never given them — Setup's own row
   * asks for those, so Pip doesn't nag in the week as well.
   */
  netAssets?: { reviewedAt: Date; dueReview: boolean } | null;
}

export interface Candidate {
  kind: NudgeKind;
  reason: NudgeReason;
  bucket: Bucket | null;
  instrumentId: string | null;
  /** The figures and reports it's built from, frozen into the log. */
  facts: CandidateFacts;
  checks: TrustCheck[];
  shown: boolean;
  /** The first rule that held it back. */
  heldBackBy: TrustRuleId | null;
  basis: string | null;
  /** Same key → same nudge, for daily repeats. */
  dedupeKey: string;
}

export type CandidateFacts =
  | {
      type: "cap";
      bucket: Bucket;
      overBy: { percent: number; pence: Pence };
      fixIt: RulesEvaluation["fixIt"];
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
      period: "day" | "week";
      move: MoveFigures;
      threshold: number;
    }
  | {
      type: "news";
      name: string;
      shortName: string;
      reports: NewsItem[];
      /** One name per organisation, best-known first as seen (`independentPublishers`). */
      publishers: string[];
    }
  | { type: "quiet"; counts: BuildCounts; next: CalendarItem | null };

export interface CalendarItem {
  what: string;
  onDate: string;
}

export interface BuildCounts {
  holdingsChecked: number;
  /** Every report linked to a holding inside the fetch window. */
  reportsRead: number;
  /** Reports that passed stage A. */
  reportsCounted: number;
  /** Candidates held back, per rule that held them. */
  heldBack: Partial<Record<TrustRuleId, number>>;
}

export interface CandidateBuild {
  candidates: Candidate[];
  counts: BuildCounts;
  next: CalendarItem | null;
}

const dayOf = (date: Date) => date.toISOString().slice(0, 10);
const daysBetween = (from: Date, day: string) =>
  Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${dayOf(from)}T00:00:00Z`)) / DAY_MS);

/** The next 5 April on or after today. */
export function nextIsaYearEnd(now: Date): string {
  const year = now.getUTCFullYear();
  const thisYear = `${year}-04-05`;
  return daysBetween(now, thisYear) >= 0 ? thisYear : `${year + 1}-04-05`;
}

export const dedupeKey = (reason: NudgeReason, subject: string, when: string) =>
  `${reason}:${subject}:${when}`;

function candidate(fields: Omit<Candidate, "shown" | "heldBackBy">): Candidate {
  const failed = fields.checks.find((check) => !check.passed);
  return { ...fields, shown: !failed, heldBackBy: failed?.rule ?? null };
}

export function buildCandidates(input: CandidateInput): CandidateBuild {
  const { now, cadence, settings, exclusions, rules, holdings, history } = input;
  const candidates: Candidate[] = [];
  const counts: BuildCounts = {
    holdingsChecked: holdings.length,
    reportsRead: 0,
    reportsCounted: 0,
    heldBack: {},
  };
  const potName = (bucket: Bucket) => displayNameFor(bucket);

  // ── Shape: from the Phase 4 engine's numbers.
  const sideBet = rules.pots.find((pot) => pot.bucket === "Degen")!;
  if (sideBet.overBy) {
    const repeat =
      cadence === "daily" &&
      history.lastCapNudgeAt !== null &&
      now.getTime() - history.lastCapNudgeAt.getTime() < CAP_DAILY_REPEAT_DAYS * DAY_MS;
    if (!repeat) {
      candidates.push(
        candidate({
          kind: "shape",
          reason: "cap",
          bucket: "Degen",
          instrumentId: null,
          facts: {
            type: "cap",
            bucket: "Degen",
            overBy: { percent: sideBet.overBy.percent, pence: sideBet.overBy.amountPence },
            fixIt: rules.fixIt,
            starterLimit: sideBet.limit?.starter ?? true,
          },
          checks: [exclusionsCheck(exclusions, potName("Degen"))],
          basis: null,
          dedupeKey: dedupeKey("cap", "Degen", dayOf(now)),
        }),
      );
    }
  }
  // ── The yearly net-assets check (Phase 6). Weekly only: it's a housekeeping
  // reminder, not something that needs anyone's day interrupted.
  if (cadence === "weekly" && input.netAssets?.dueReview) {
    const reviewedAt = input.netAssets.reviewedAt;
    const monthsAgo = Math.floor(
      (now.getTime() - reviewedAt.getTime()) / (30 * 24 * 60 * 60 * 1000),
    );
    candidates.push(
      candidate({
        kind: "calendar",
        reason: "net_assets_review",
        bucket: "Degen",
        instrumentId: null,
        facts: {
          type: "net_assets_review",
          reviewedAt: reviewedAt.toISOString().slice(0, 10),
          monthsAgo,
        },
        checks: [exclusionsCheck(exclusions, "Side Bet")],
        basis: null,
        dedupeKey: dedupeKey("net_assets_review", "Degen", dayOf(now)),
      }),
    );
  }

  if (cadence === "weekly") {
    for (const pot of rules.pots) {
      if (pot.status !== "drifted" || pot.driftPoints === null) continue;
      candidates.push(
        candidate({
          kind: "shape",
          reason: "drift",
          bucket: pot.bucket,
          instrumentId: null,
          facts: {
            type: "drift",
            bucket: pot.bucket,
            actualPercent: pot.actualPercent,
            judgedAgainstPercent: pot.judgedAgainstPercent,
            driftPoints: pot.driftPoints,
          },
          checks: [exclusionsCheck(exclusions, potName(pot.bucket))],
          basis: null,
          dedupeKey: dedupeKey("drift", pot.bucket, dayOf(now)),
        }),
      );
    }
  }

  // ── Calendar: results dates and the ISA year-end — facts, not predictions.
  const upcoming: CalendarItem[] = [];
  for (const holding of holdings) {
    for (const onDate of holding.resultsDates) {
      const daysAway = daysBetween(now, onDate);
      if (daysAway < 0) continue;
      upcoming.push({ what: `${holding.name} results`, onDate });
      if (daysAway > CALENDAR_LEAD_DAYS[cadence]) continue;
      const key = dedupeKey("earnings", holding.instrumentId, onDate);
      if (cadence === "daily" && history.shownKeys.includes(key)) continue;
      candidates.push(
        candidate({
          kind: "calendar",
          reason: "earnings",
          bucket: holding.bucket,
          instrumentId: holding.instrumentId,
          facts: {
            type: "earnings",
            name: holding.name,
            shortName: holding.shortName,
            onDate,
            daysAway,
          },
          checks: [exclusionsCheck(exclusions, holding.name, holding.shortName)],
          basis: null,
          dedupeKey: key,
        }),
      );
    }
  }
  const foundation = rules.pots.find((pot) => pot.bucket === "Base")!;
  if (foundation.status !== "unavailable") {
    const onDate = nextIsaYearEnd(now);
    const daysAway = daysBetween(now, onDate);
    upcoming.push({ what: "ISA year end", onDate });
    const key = dedupeKey("isa_year_end", "Base", onDate);
    if (
      daysAway <= ISA_YEAR_END_LEAD_DAYS[cadence] &&
      !(cadence === "daily" && history.shownKeys.includes(key))
    ) {
      candidates.push(
        candidate({
          kind: "calendar",
          reason: "isa_year_end",
          bucket: "Base",
          instrumentId: null,
          facts: { type: "isa_year_end", onDate, daysAway },
          checks: [exclusionsCheck(exclusions, "ISA")],
          basis: null,
          dedupeKey: key,
        }),
      );
    }
  }
  upcoming.sort((a, b) => a.onDate.localeCompare(b.onDate));

  // ── Awareness: big moves, and news from named publishers.
  for (const holding of holdings) {
    const period = cadence === "daily" ? "day" : "week";
    const move = holding.moves[period];
    const threshold = settings.bigMovePercent[holding.bucket];
    const isSideBet = holding.bucket === "Degen";
    const holdingChecks = () => [
      capRoomCheck(isSideBet, rules.needsAttention),
      exclusionsCheck(exclusions, holding.name, holding.shortName),
    ];

    if (move && Math.abs(move.percent) >= threshold) {
      const key = dedupeKey("move", holding.instrumentId, dayOf(now));
      if (!(cadence === "daily" && history.shownKeys.includes(key))) {
        candidates.push(
          candidate({
            kind: "awareness",
            reason: "move",
            bucket: holding.bucket,
            instrumentId: holding.instrumentId,
            facts: {
              type: "move",
              name: holding.name,
              shortName: holding.shortName,
              period,
              move,
              threshold,
            },
            checks: holdingChecks(),
            basis: null,
            dedupeKey: key,
          }),
        );
      }
    }

    // News is a weekly nudge only (decision 4).
    if (cadence !== "weekly") continue;
    counts.reportsRead += holding.news.length;
    const { kept } = stageA(holding.news, {
      now,
      cadence,
      settings,
      exclusions,
      ownNewsroomDomains: holding.ownNewsroomDomains,
    });
    counts.reportsCounted += kept.length;
    if (kept.length === 0) continue;
    candidates.push(
      candidate({
        kind: "awareness",
        reason: "news",
        bucket: holding.bucket,
        instrumentId: holding.instrumentId,
        facts: {
          type: "news",
          name: holding.name,
          shortName: holding.shortName,
          reports: kept,
          publishers: independentPublishers(kept).map((report) => report.publisher),
        },
        checks: [
          ...holdingChecks(),
          resultsQuietCheck(holding.resultsDates, now, settings),
          independentSourcesCheck(kept, settings),
        ],
        basis: basisFor(kept),
        dedupeKey: dedupeKey("news", holding.instrumentId, dayOf(now)),
      }),
    );
  }

  applyBudgets(candidates, input);

  for (const held of candidates.filter((c) => !c.shown)) {
    counts.heldBack[held.heldBackBy!] = (counts.heldBack[held.heldBackBy!] ?? 0) + 1;
  }

  const next = upcoming[0] ?? null;
  if (cadence === "weekly" && !candidates.some((c) => c.shown)) {
    candidates.push({
      kind: "none",
      reason: "quiet",
      bucket: null,
      instrumentId: null,
      facts: { type: "quiet", counts: structuredClone(counts), next },
      checks: [],
      shown: true,
      heldBackBy: null,
      basis: null,
      dedupeKey: dedupeKey("quiet", "week", dayOf(now)),
    });
  }

  return { candidates, counts, next };
}

/** Rank for the awareness budget: better backed first, then newer, then bigger moves. */
function awarenessRank(c: Candidate): [number, number, number] {
  if (c.facts.type === "news") {
    const reports = c.facts.reports;
    return [independentPublishers(reports).length, reports[0]!.publishedAt.getTime(), 0];
  }
  if (c.facts.type === "move") return [0, 0, Math.abs(c.facts.move.percent)];
  return [0, 0, 0];
}

const DAILY_PRIORITY: Record<string, number> = { cap: 0, earnings: 1, isa_year_end: 2, move: 3 };

/**
 * Weekly: awareness nudges beyond the weekly budget are held back, best
 * backed kept; shape and calendar nudges never count and are never dropped.
 * Daily: everything counts against today's and this week's daily budget, in
 * order cap → results → ISA → moves.
 */
function applyBudgets(candidates: Candidate[], input: CandidateInput) {
  const { cadence, settings, history } = input;
  const hold = (c: Candidate, check: TrustCheck) => {
    c.checks.push(check);
    if (c.shown) {
      c.shown = false;
      c.heldBackBy = check.rule;
    }
  };

  if (cadence === "weekly") {
    const awareness = candidates
      .filter((c) => c.kind === "awareness" && c.shown)
      .sort((a, b) => {
        const [x, y] = [awarenessRank(a), awarenessRank(b)];
        return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
      });
    awareness.forEach((c, index) => {
      const within = index < settings.weeklyBudget;
      const check: TrustCheck = {
        rule: "weekly_budget",
        setting: settings.weeklyBudget,
        passed: within,
        detail: within
          ? `${index + 1} of up to ${settings.weeklyBudget} this week`
          : `Over the ${settings.weeklyBudget} a week you allow`,
      };
      if (within) c.checks.push(check);
      else hold(c, check);
    });
    return;
  }

  const left = Math.max(
    0,
    Math.min(
      settings.dailyBudgetPerDay - history.dailyShownToday,
      settings.dailyBudgetPerWeek - history.dailyShownThisWeek,
    ),
  );
  const daily = candidates
    .filter((c) => c.shown)
    .sort((a, b) => (DAILY_PRIORITY[a.reason] ?? 9) - (DAILY_PRIORITY[b.reason] ?? 9));
  daily.forEach((c, index) => {
    const within = index < left;
    const check: TrustCheck = {
      rule: "daily_budget",
      setting: `${settings.dailyBudgetPerDay} a day, ${settings.dailyBudgetPerWeek} a week`,
      passed: within,
      detail: within ? "Inside your daily limit" : "Over your daily limit",
    };
    if (within) c.checks.push(check);
    else hold(c, check);
  });
}
