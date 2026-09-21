import { URGENT_PUSH_DAILY_MAX } from "@finance-app/shared";
import type { Notifier } from "../notify/notify.js";
import {
  displayNameFor,
  type NudgeResponse,
  type NudgeView,
  type Recommendation,
  type RecommendationTrigger,
  type TrustSettings,
  type WeekResponse,
  type WeekView,
} from "@finance-app/shared";
import { OPENING_TEMPLATE, templateFor, type TemplateFacts } from "../research/templates.js";
import type { NudgeWriter } from "../research/writer.js";
import type { NewsNudgeInput, NotMaterial, NudgeDraft } from "../research/types.js";
import type { ReadUser } from "../read/model.js";
import {
  capRoomCheck,
  exclusionsCheck,
  independentSourcesCheck,
  resultsQuietCheck,
  stageA,
  type NewsItem,
  type TrustCheck,
} from "../rules/trust.js";
import { londonDay } from "../sync/poll.js";
import {
  buildCandidates,
  type BuildCounts,
  type Candidate,
  type CalendarItem,
} from "./candidates.js";
import { gather, type GatherDeps, type Gathered } from "./gather.js";
import { prepareRecommendations, recommendationRow } from "./recommendations.js";
import type { TriggerStateStore } from "./triggers.js";
import { recommendationTemplate, takeLine, type BriefParts } from "../research/recommendation.js";
import { renderWeekEmail, SEALED_R1 } from "./email.js";
import type { NewNudge, NudgeStore, StoredNudge, StoredWeek } from "./store.js";

/**
 * Building and reading "Your week" (Phase 5 task 7).
 *
 * Build: gather → candidates (trust rules, budgets) → words (the research
 * module; the LLM only for shown news for personalised users) → re-check
 * independent sources on the reports the writer actually cited → log every
 * nudge, shown or held back.
 *
 * Read: today's trust rules are applied again to what was stored, so a rule
 * made stricter hides a nudge straight away. A rule loosened doesn't bring
 * one back until the next build (decision 3).
 */

export interface NudgeUser extends ReadUser {
  personalResearch: boolean;
  /** Where Monday's email goes. Without it, the week is built and nobody is emailed. */
  email?: string;
}

export interface NudgeServiceDeps extends GatherDeps {
  store: NudgeStore;
  writer: NudgeWriter;
  /** Pushes urgent notes (Phase 6). Without it they're logged and wait for the week. */
  notifier?: Notifier;
  /** Where each recommendation trigger stands. Without it, no recommendations are made. */
  triggers?: TriggerStateStore;
}

const DAY_MS = 86_400_000;

/** The Monday of the London week `day` falls in. */
export function mondayOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const back = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}

/** The weekly build is due from 07:00 UTC on the Monday (08:00 in summer). */
export const WEEKLY_FROM_UTC_HOUR = 7;

interface StoredFacts {
  type: string;
  reports?: (Omit<NewsItem, "publishedAt"> & { publishedAt: string | Date })[];
  citedIds?: string[];
  resultsDates?: string[];
  ownNewsroomDomains?: string[];
  capBroken?: boolean;
  name?: string;
  shortName?: string;
  move?: { percent: number; pence: number };
  counts?: BuildCounts;
  next?: CalendarItem | null;
  amountPence?: number | null;
}

const reportsOf = (facts: StoredFacts): NewsItem[] =>
  (facts.reports ?? []).map((r) => ({ ...r, publishedAt: new Date(r.publishedAt) }));

// ─── Build ────────────────────────────────────────────────────────────────────

/** What a shown news note gives the writer. Null for anything Pip words itself. */
function newsInputFor(
  candidate: Candidate,
  gathered: Gathered,
  user: NudgeUser,
): NewsNudgeInput | null {
  // Held-back news gets Pip's own words: no model call for something nobody sees.
  if (candidate.facts.type !== "news" || !candidate.shown) return null;
  const holding = gathered.details.get(candidate.instrumentId!)!;
  const history = gathered.input.holdings.find((h) => h.instrumentId === candidate.instrumentId)!;
  return {
    name: holding.detail.name,
    shortName: holding.detail.ticker,
    bucket: holding.detail.bucket,
    potSharePercent: holding.potSharePercent,
    moves: {
      day: history.moves.day?.percent ?? null,
      week: history.moves.week?.percent ?? null,
      month: history.moves.month?.percent ?? null,
    },
    nextResultsDate:
      history.resultsDates.filter((d) => d >= londonDay(gathered.input.now)).sort()[0] ?? null,
    reports: candidate.facts.reports,
    // Only someone with personal research on gets words written for their plan.
    plan: user.personalResearch ? planOf(gathered) : null,
  };
}

function planOf(gathered: Gathered) {
  return {
    goals: gathered.profile.goals,
    horizonYears: gathered.profile.horizonYears,
    riskWords: gathered.profile.riskWords,
    shape: {
      foundation: 100 - gathered.rules.handpickedTarget,
      handpicked: gathered.rules.handpickedTarget,
    },
  };
}

type Words = { row: Partial<NewNudge>; checks: TrustCheck[]; shown: boolean; citedIds: string[] };

/** A candidate's words: Pip's template, or what the writer gave a news note, checked again. */
function wordsFor(
  candidate: Candidate,
  gathered: Gathered,
  written: NudgeDraft | NotMaterial | null,
): Words {
  const checks = [...candidate.checks];
  let shown = candidate.shown;

  if (written === null) {
    const draft = templateFor(candidate.facts as TemplateFacts, { bucket: candidate.bucket });
    return { row: draft, checks, shown, citedIds: draft.citedIds };
  }

  const facts = candidate.facts as Extract<Candidate["facts"], { type: "news" }>;
  if ("material" in written) {
    const fallback = templateFor(facts as TemplateFacts);
    checks.push({
      rule: "not_material",
      setting: written.model,
      passed: false,
      detail: "The writer judged these reports routine",
    });
    return {
      row: { ...fallback, model: written.model, promptVersion: written.promptVersion },
      checks,
      shown: false,
      citedIds: fallback.citedIds,
    };
  }

  // The words rest on the cited reports, so the independent-sources rule is checked on those.
  const cited = facts.reports.filter((r) => written.citedIds.includes(r.id));
  if (written.model !== "template" && cited.length < facts.reports.length) {
    const recheck = independentSourcesCheck(cited, gathered.trust);
    recheck.detail = `Cited: ${recheck.detail}`;
    checks.push(recheck);
    if (!recheck.passed) shown = false;
  }
  return { row: written, checks, shown, citedIds: written.citedIds };
}

function rowsFor(
  user: NudgeUser,
  gathered: Gathered,
  candidates: Candidate[],
  written: (NudgeDraft | NotMaterial | null)[],
  builtOn: string,
): NewNudge[] {
  return candidates.map((candidate, index) => {
    const words = wordsFor(candidate, gathered, written[index] ?? null);
    const holding = candidate.instrumentId
      ? gathered.details.get(candidate.instrumentId)
      : undefined;
    const holdingInput = gathered.input.holdings.find(
      (h) => h.instrumentId === candidate.instrumentId,
    );
    const pot = candidate.bucket
      ? gathered.input.rules.pots.find((p) => p.bucket === candidate.bucket)
      : undefined;
    return {
      cadence: gathered.input.cadence,
      kind: candidate.kind,
      reason: candidate.reason,
      bucket: candidate.bucket,
      instrumentId: candidate.instrumentId,
      title: words.row.title!,
      body: words.row.body!,
      basis: candidate.basis,
      facts: {
        ...candidate.facts,
        citedIds: words.citedIds,
        resultsDates: holdingInput?.resultsDates ?? [],
        ownNewsroomDomains: holdingInput?.ownNewsroomDomains ?? [],
        capBroken: gathered.input.rules.needsAttention,
      },
      checks: words.checks,
      shown: words.shown,
      model: words.row.model ?? "template",
      promptVersion: words.row.promptVersion ?? null,
      personalised:
        user.personalResearch && candidate.reason === "news" && words.row.model !== "template",
      dedupeKey: candidate.dedupeKey,
      builtOn,
      priceAt: holding ? String(holding.detail.price) : null,
      priceCurrency: holding ? "GBP_PENCE" : null,
      priceSource: holding ? holding.detail.freshness.source : null,
      potShareAt: candidate.kind === "shape" && pot ? String(pot.actualPercent) : null,
      urgent: candidate.urgent,
    };
  });
}

/**
 * Urgent notes go out straight away (Phase 6 decision 3) — for people with
 * personal research on only; everyone else's wait for the week. `notify()`
 * decides the rest: their switches, one push per note however many runs see
 * it, and two urgent pushes a day. A note that doesn't go out because of that
 * cap says so in its checks, so the log never hides why.
 */
export async function pushUrgent(
  deps: NudgeServiceDeps,
  user: NudgeUser,
  rows: NewNudge[],
  builtOn: string,
  now: Date,
): Promise<void> {
  if (!deps.notifier || !user.personalResearch) return;
  // A holding with a recommendation today pushes that, not its move note too.
  const recommended = new Set(
    rows.filter((r) => r.kind === "recommendation" && r.instrumentId).map((r) => r.instrumentId),
  );
  const urgent = rows.filter(
    (r) =>
      r.urgent &&
      r.shown &&
      (r.kind === "recommendation" || !r.instrumentId || !recommended.has(r.instrumentId)),
  );
  for (const row of urgent) {
    // A lock screen is no place for Side Bet's limit: it's net assets ÷ 10.
    const sealed = row.trigger === "side_bet_over_limit";
    const amount = sealed ? null : ((row.facts.amountPence as number | null) ?? null);
    const body = row.recommendation
      ? `${takeLine(row.recommendation as Recommendation, amount)} Your call.`
      : row.body;
    const outcome = await deps.notifier.push(
      {
        userId: user.userId,
        kind: "urgent",
        dedupeKey: `urgent:${row.dedupeKey}:${builtOn}`,
        message: { title: sealed ? SEALED_R1.push : row.title, body, url: "/week" },
      },
      now,
    );
    if (!outcome.sent && outcome.why === "over_budget") {
      await deps.store.addCheck(user, row.dedupeKey, builtOn, {
        rule: "daily_budget",
        setting: `${URGENT_PUSH_DAILY_MAX} urgent pushes a day`,
        passed: false,
        detail: `Not pushed: ${URGENT_PUSH_DAILY_MAX} urgent notes had already gone out today`,
      });
    }
  }
}

/** A quiet result, when nothing ended up shown — including after the writer held news back. */
function quietRow(
  counts: BuildCounts,
  next: CalendarItem | null,
  builtOn: string,
  heldAfterWords: number,
): NewNudge {
  const finalCounts = {
    ...counts,
    heldBack: { ...counts.heldBack, ...(heldAfterWords ? { after_writing: heldAfterWords } : {}) },
  };
  const facts = { type: "quiet" as const, counts: finalCounts, next };
  const draft = templateFor(facts);
  return {
    cadence: "weekly",
    kind: "none",
    reason: "quiet",
    urgent: false,
    bucket: null,
    instrumentId: null,
    title: draft.title,
    body: draft.body,
    basis: null,
    facts,
    checks: [],
    shown: true,
    model: "template",
    promptVersion: null,
    personalised: false,
    dedupeKey: `quiet:week:${builtOn}`,
    builtOn,
    priceAt: null,
    priceCurrency: null,
    priceSource: null,
    potShareAt: null,
  };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/** Today's trust rules against what was stored. Only ever hides; never un-hides. */
export function recheck(
  nudge: StoredNudge,
  settings: TrustSettings,
  exclusions: string[],
): TrustCheck[] {
  const facts = nudge.facts as unknown as StoredFacts;
  const at = nudge.createdAt;
  switch (facts.type) {
    case "news": {
      const reports = reportsOf(facts);
      const cited = facts.citedIds?.length
        ? reports.filter((r) => facts.citedIds!.includes(r.id))
        : reports;
      const { kept } = stageA(cited, {
        now: at,
        cadence: nudge.cadence,
        settings,
        exclusions,
        ownNewsroomDomains: facts.ownNewsroomDomains ?? [],
      });
      return [
        capRoomCheck(nudge.bucket === "Degen", facts.capBroken ?? false),
        exclusionsCheck(exclusions, facts.name ?? "", facts.shortName ?? ""),
        resultsQuietCheck(facts.resultsDates ?? [], at, settings),
        independentSourcesCheck(kept, settings),
      ];
    }
    case "move": {
      const line = nudge.bucket
        ? settings.bigMovePercent[nudge.bucket as keyof TrustSettings["bigMovePercent"]]
        : 0;
      const past = Math.abs(facts.move?.percent ?? 0) >= line;
      return [
        exclusionsCheck(exclusions, facts.name ?? "", facts.shortName ?? ""),
        {
          rule: "big_move",
          setting: line,
          passed: past,
          detail: past ? `Past your ${line}% line` : `Under your ${line}% line now`,
        },
      ];
    }
    case "cap":
    case "drift":
      return [
        exclusionsCheck(exclusions, nudge.bucket ? displayNameFor(nudge.bucket as never) : ""),
      ];
    case "earnings":
      return [exclusionsCheck(exclusions, facts.name ?? "", facts.shortName ?? "")];
    case "isa_year_end":
      return [exclusionsCheck(exclusions, "ISA")];
    case "recommendation":
      return [exclusionsCheck(exclusions, facts.name ?? "", facts.shortName ?? "")];
    default:
      return [];
  }
}

/** What a failed check means, in plain words. */
const HELD_WORDS: Record<string, string> = {
  named_publishers: "Not from a named publisher",
  recency: "Too old",
  independent_sources: "Not enough different publishers",
  results_quiet: "Too close to results",
  cap_room: "Side Bet is over its cap",
  exclusions: "On your exclusions list",
  weekly_budget: "Over your weekly limit",
  daily_budget: "Over your daily limit",
  big_move: "Under your big-move line now",
  not_material: "Routine news",
};

const RULE_WORDS: Record<string, string> = {
  named_publishers: "Named publishers only",
  recency: "Recent news only",
  independent_sources: "Enough different publishers",
  results_quiet: "Quiet around results",
  cap_room: "Side Bet has room under its cap",
  exclusions: "Not on your exclusions list",
  weekly_budget: "Inside your weekly limit",
  daily_budget: "Inside your daily limit",
  big_move: "Past your big-move line",
  not_material: "Something happened, not routine chatter",
};

function toView(nudge: StoredNudge, checks: TrustCheck[]): NudgeView {
  const facts = nudge.facts as unknown as StoredFacts;
  const reports = reportsOf(facts);
  const cited = facts.citedIds?.length
    ? reports.filter((r) => facts.citedIds!.includes(r.id))
    : reports;
  const failed = checks.find((c) => !c.passed);
  return {
    id: nudge.id,
    cadence: nudge.cadence,
    kind: nudge.kind as NudgeView["kind"],
    reason: nudge.reason as NudgeView["reason"],
    bucket: nudge.bucket as NudgeView["bucket"],
    instrumentId: nudge.instrumentId,
    title: nudge.title,
    body: nudge.body,
    basis: nudge.basis,
    sources: cited.map((r) => ({
      publisher: r.publisher,
      headline: r.headline,
      url: r.url,
      publishedAt: r.publishedAt.toISOString(),
    })),
    checks: checks.map((c) => ({
      rule: RULE_WORDS[c.rule] ?? c.rule,
      passed: c.passed,
      detail: c.detail,
    })),
    ...(failed
      ? { heldBackBecause: `${HELD_WORDS[failed.rule] ?? failed.rule} — ${failed.detail}` }
      : {}),
    ...(nudge.kind === "recommendation" && nudge.recommendation
      ? {
          recommendation: {
            course: nudge.recommendation as Recommendation,
            amount: (facts.amountPence as number | null | undefined) ?? null,
          },
        }
      : {}),
    response: nudge.response,
    createdAt: nudge.createdAt.toISOString(),
  };
}

export function weekView(
  week: StoredWeek,
  settings: TrustSettings,
  exclusions: string[],
): WeekView {
  const counts = week.counts as unknown as BuildCounts & { next?: CalendarItem | null };
  const visible: NudgeView[] = [];
  const heldBack: NudgeView[] = [];
  let quiet: StoredNudge | undefined;
  let awarenessShown = 0;

  for (const nudge of week.nudges) {
    if (nudge.kind === "none") {
      quiet = nudge;
      continue;
    }
    if (!nudge.shown) {
      heldBack.push(toView(nudge, nudge.checks));
      continue;
    }
    const now = recheck(nudge, settings, exclusions);
    let checks = [...now, ...nudge.checks.filter((c) => !now.some((n) => n.rule === c.rule))];
    if (nudge.kind === "awareness" && now.every((c) => c.passed)) {
      awarenessShown += 1;
      if (awarenessShown > settings.weeklyBudget) {
        checks = [
          ...checks.filter((c) => c.rule !== "weekly_budget"),
          {
            rule: "weekly_budget",
            setting: settings.weeklyBudget,
            passed: false,
            detail: `Over the ${settings.weeklyBudget} a week you allow`,
          },
        ];
      }
    }
    // A rule that passed at the build but not now takes the nudge off the week.
    const ordered = [...checks].sort((a, b) => Number(a.passed) - Number(b.passed));
    if (ordered.every((c) => c.passed)) visible.push(toView(nudge, checks));
    else heldBack.push(toView(nudge, ordered));
  }

  const next = (quiet?.facts as StoredFacts | undefined)?.next ?? counts.next ?? null;
  if (visible.length === 0) {
    if (quiet) visible.push(toView(quiet, []));
    else {
      const draft = templateFor({ type: "quiet", counts, next });
      visible.push({
        id: `quiet-${week.id}`,
        cadence: "weekly",
        kind: "none",
        reason: "quiet",
        bucket: null,
        instrumentId: null,
        title: draft.title,
        body: `${draft.body} Your trust rules have changed since this week was built.`,
        basis: null,
        sources: [],
        checks: [],
        response: null,
        createdAt: week.builtAt.toISOString(),
      });
    }
  }

  return {
    weekOf: week.weekOf,
    builtAt: week.builtAt.toISOString(),
    opening: week.opening,
    nudges: visible,
    heldBack,
    counts: {
      holdingsChecked: counts.holdingsChecked ?? 0,
      reportsRead: counts.reportsRead ?? 0,
      reportsCounted: counts.reportsCounted ?? 0,
    },
    next,
  };
}

// ─── The service ──────────────────────────────────────────────────────────────

export interface NudgeService {
  /** Builds this week if it's due and not built. */
  buildWeekIfDue(user: NudgeUser, now?: Date): Promise<"built" | "exists" | "not_due">;
  /** Builds today's daily nudges; repeats of anything already logged today are skipped. */
  buildDaily(user: NudgeUser, now?: Date): Promise<number>;
  week(user: NudgeUser, weekOf: string | "latest", now?: Date): Promise<WeekView | null>;
  thisWeek(user: NudgeUser, now?: Date): Promise<WeekResponse>;
  respond(
    user: NudgeUser,
    id: string,
    response: NudgeResponse,
    at?: Date,
  ): Promise<StoredNudge | null>;
}

export function createNudgeService(
  deps: NudgeServiceDeps,
  options: { buildOnRead?: boolean; now?: () => Date } = {},
): NudgeService {
  const clock = options.now ?? (() => new Date());
  /**
   * One build: gather → candidates → **one** request for every word a model
   * writes (news notes, Pip's takes, the week's opening line) → rows. Everyone
   * without personal research on costs no request at all.
   */
  async function build(user: NudgeUser, now: Date, cadence: "weekly" | "daily") {
    const today = londonDay(now);
    const history = await deps.store.history(user, today, mondayOf(today));
    const gathered = await gather(deps, user, now, cadence, history);
    const { candidates, counts, next } = buildCandidates(gathered.input);
    const worded = candidates.filter((c) => c.kind !== "none");

    const newsInputs = worded.map((c) => newsInputFor(c, gathered, user));
    const recommendations =
      cadence === "daily" && user.personalResearch && deps.triggers
        ? await prepareRecommendations({ triggers: deps.triggers }, user, gathered, today, now)
        : [];
    const toWord = recommendations.filter((r) => r.excluded.passed);
    // The opening line reads the titles Pip writes itself; the model adds its own notes.
    const templateTitles = worded
      .filter((c, i) => c.shown && newsInputs[i] === null)
      .map((c) => templateFor(c.facts as TemplateFacts, { bucket: c.bucket }).title);

    const words = await deps.writer.words({
      news: newsInputs.filter((input): input is NewsNudgeInput => input !== null),
      recommendations: toWord.map((r) => r.input),
      opening: cadence === "weekly" && user.personalResearch ? { titles: templateTitles } : null,
    });

    // The answers come back in the order asked; put each beside its candidate.
    const answers = words.news[Symbol.iterator]();
    const written = newsInputs.map((input) => (input === null ? null : answers.next().value!));
    const rows = rowsFor(user, gathered, worded, written, today);
    // Shown by the trust rules but held back once written (not material, or cited too few publishers).
    const heldAfterWords = worded.filter((c, i) => c.shown && !rows[i]!.shown).length;

    for (const prepared of recommendations) {
      const index = toWord.indexOf(prepared);
      rows.push(
        recommendationRow(
          prepared,
          index >= 0 ? words.recommendations[index]! : recommendationTemplate(prepared.input),
          today,
        ),
      );
    }
    const opening = words.opening ?? {
      sentence: OPENING_TEMPLATE,
      model: "template",
      promptVersion: null,
    };
    return { gathered, rows, counts, next, today, heldAfterWords, opening };
  }

  /**
   * Monday's email and its "Your week is ready" push (phase-6.md decision 6).
   * `notify()` checks each switch; the push is one per week by its key.
   */
  async function announceWeek(user: NudgeUser, weekOf: string, gathered: Gathered, now: Date) {
    if (!deps.notifier) return;
    const week = await service.week(user, weekOf, now);
    if (!week) return;
    const recommendation = user.personalResearch ? await latestRecommendation(user, now) : null;
    const email = renderWeekEmail({
      week,
      portfolio: await deps.readModel.portfolio(user, "month"),
      rules: gathered.input.rules,
      recommendation,
      to: user.email ?? "",
      now,
    });
    await deps.notifier.push(
      {
        userId: user.userId,
        kind: "digest",
        dedupeKey: `digest:${weekOf}`,
        message: { ...email.push, url: "/week" },
      },
      now,
    );
    if (user.email) {
      await deps.notifier.email(user.userId, {
        to: user.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
    }
  }

  /** The newest recommendation shown in the last seven days — the email carries one at most. */
  async function latestRecommendation(user: NudgeUser, now: Date) {
    for (let back = 0; back < 7; back += 1) {
      const day = londonDay(new Date(now.getTime() - back * DAY_MS));
      const found = (await deps.store.daily(user, day))
        .filter((n) => n.kind === "recommendation" && n.shown && n.recommendation)
        .at(-1);
      if (!found) continue;
      const facts = found.facts as {
        name?: string;
        amountPence?: number | null;
        brief?: BriefParts;
      };
      if (!facts.brief) continue;
      return {
        trigger: found.trigger as RecommendationTrigger,
        title: found.title,
        course: found.recommendation as Recommendation,
        amountPence: facts.amountPence ?? null,
        name: facts.name ?? "",
        brief: facts.brief,
        createdAt: found.createdAt,
      };
    }
    return null;
  }

  const service: NudgeService = {
    async buildWeekIfDue(user, now = clock()) {
      const today = londonDay(now);
      const weekOf = mondayOf(today);
      const due = Date.parse(`${weekOf}T00:00:00Z`) + WEEKLY_FROM_UTC_HOUR * 3_600_000;
      if (now.getTime() < due) return "not_due";
      if (await deps.store.weekExists(user, weekOf)) return "exists";

      const { gathered, rows, counts, next, heldAfterWords, opening } = await build(
        user,
        now,
        "weekly",
      );
      const shown = rows.filter((row) => row.shown);
      const quiet = shown.length === 0;
      if (quiet) rows.push(quietRow(counts, next, today, heldAfterWords));
      const saved = await deps.store.saveWeek(
        user,
        {
          weekOf,
          // The line was written before Pip knew nothing would survive; a quiet week opens plainly.
          opening: quiet ? OPENING_TEMPLATE : opening.sentence,
          counts: { ...counts, next },
          builtAt: now,
        },
        rows,
      );
      if (!saved) return "exists";
      // Only the run that built the week tells anyone, so it's once a week.
      await announceWeek(user, weekOf, gathered, now);
      return "built";
    },

    async buildDaily(user, now = clock()) {
      const { rows, today } = await build(user, now, "daily");
      const saved = await deps.store.saveDaily(user, rows, now);
      await pushUrgent(deps, user, rows, today, now);
      return saved;
    },

    async week(user, weekOf, now = clock()) {
      if (options.buildOnRead && weekOf === "latest") await service.buildWeekIfDue(user, now);
      const week = await deps.store.week(user, weekOf);
      if (!week) return null;
      const [trust, profile] = await Promise.all([
        deps.trustStore.get(user),
        deps.profileStore.get(user),
      ]);
      return weekView(week, trust.settings, profile.profile.exclusions);
    },

    async thisWeek(user, now = clock()) {
      const week = await service.week(user, "latest", now);
      const [trust, profile, today, weeks] = await Promise.all([
        deps.trustStore.get(user),
        deps.profileStore.get(user),
        deps.store.daily(user, londonDay(now)),
        deps.store.weeks(user),
      ]);
      const todayViews = today
        .filter((n) => n.shown)
        .filter((n) =>
          recheck(n, trust.settings, profile.profile.exclusions).every((c) => c.passed),
        )
        .map((n) => toView(n, n.checks));
      return {
        week,
        today: todayViews,
        pastWeeks: weeks.filter((w) => w !== week?.weekOf),
      };
    },

    async respond(user, id, response, at = clock()) {
      return deps.store.respond(user, id, response, at);
    },
  };
  return service;
}
