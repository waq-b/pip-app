import type { JobName } from "@finance-app/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { SecretBox } from "../crypto/secrets.js";
import { holdings, providerCredentials } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { collectFacts } from "../facts/collect.js";
import type { FactsAdapter } from "../facts/types.js";
import { fillOutcomes } from "../nudges/outcomes.js";
import { noJobRecorder, type JobRecorder } from "./runs.js";
import { checkLimitAlerts } from "../rules/limit-alerts.js";
import type { SideBetLimitReader } from "../rules/side-bet.js";
import type { Notifier } from "../notify/notify.js";
import type { NudgeService } from "../nudges/service.js";
import { users } from "../db/schema.js";
import { refreshDue, type PricedInstrument } from "../market/refresh.js";
import type { withFallback } from "../market/sources/fallback.js";
import { backfillHistory } from "../sync/backfill.js";
import { backfillKrakenHistory } from "../sync/kraken-history.js";
import { recordConnectionGaps, type GapOutcome } from "../notify/gaps.js";
import { pollKraken, type CoinDirectory, type KrakenClientFor } from "../sync/kraken.js";
import {
  credentialsDue,
  londonDay,
  pollCredential,
  snapshotDailyValues,
  type T212ClientFor,
} from "../sync/poll.js";

/**
 * One scheduled refresh (Phase 2 task 11), fired by `pg_cron` through
 * `POST /jobs/refresh`. Every step is idempotent and skips what's already
 * fresh, so running it twice, or alongside a user's refresh-on-read, is
 * harmless. A step failing never stops the others.
 *
 * 1. Poll accounts not polled in the last 25 minutes.
 * 2. Rebuild history for one account still waiting for it.
 * 3. Refresh prices that are due, for everything anyone holds.
 * 4. Save today's pot values for everyone with a live account.
 * 5. Collect facts — news and results dates — for what's held (Phase 5), from
 *    whichever sources are due and within budget.
 * 6. Build "Your week" for everyone with a live account once it's due (from
 *    07:00 UTC Monday), and today's daily nudges from 07:00 UTC — after facts,
 *    so a week is built from the freshest reports.
 * 7. Fill in what happened 7 and 30 days after each nudge, from cached closes.
 *
 * Each step records a `job_runs` row of its own (Phase 6 decision 7), so a kind
 * of work going stale or failing is visible without anything asking the API.
 */

type Market = ReturnType<typeof withFallback>;

export interface RefreshJobDeps {
  db: Db;
  box: SecretBox;
  clientFor: T212ClientFor;
  kraken?: { clientFor: KrakenClientFor; directory: CoinDirectory };
  marketFor: (instrument: PricedInstrument | null) => Market;
  /** Facts sources (Phase 5). Without them, no facts are collected. */
  facts?: FactsAdapter[];
  /** Phase 5 nudges. Without it, no weeks are built. */
  nudges?: NudgeService;
  /** Side Bet's limit, for its 80% and 100% alerts (Phase 6). */
  sideBetLimits?: SideBetLimitReader;
  /** Sends the limit push. Without it the alert is still recorded. */
  notifier?: Notifier;
  /**
   * Records what ran (Phase 6). Every step writes a row, which is what the
   * freshness check inside Supabase reads — nothing pings the API.
   */
  runs?: JobRecorder;
  now?: () => Date;
}

export interface RefreshJobSummary {
  polled: number;
  /** Connection gaps opened and closed this run (bell rows, never pushes). */
  gaps: GapOutcome;
  backfilled: number;
  pricesRefreshed: number;
  pricesFailed: number;
  snapshots: number;
  /** Side Bet limit alerts raised this run (80% and 100%). */
  limitAlerts: number;
  /** Facts sources read, reports newly stored, results dates written. */
  facts: { read: number; stored: number; events: number };
  /** Weeks built this run, and daily nudges newly logged. */
  nudges: { weeks: number; daily: number };
  /** Nudge outcomes filled in this run. */
  outcomes: number;
  errors: string[];
}

const POLL_EVERY_MS = 25 * 60_000;

export function createRefreshJob(deps: RefreshJobDeps) {
  const now = deps.now ?? (() => new Date());
  let running: Promise<RefreshJobSummary> | null = null;

  async function runOnce(): Promise<RefreshJobSummary> {
    const at = now();
    const summary: RefreshJobSummary = {
      polled: 0,
      gaps: { opened: 0, closed: 0 },
      backfilled: 0,
      pricesRefreshed: 0,
      pricesFailed: 0,
      snapshots: 0,
      limitAlerts: 0,
      facts: { read: 0, stored: 0, events: 0 },
      nudges: { weeks: 0, daily: 0 },
      outcomes: 0,
      errors: [],
    };
    const recorder = deps.runs ?? noJobRecorder();
    const whole = await recorder.start("refresh", at);

    /**
     * A step records its own run when it maps to a kind of work the freshness
     * check watches. `poll` and `prices` do; `backfill` and `snapshots` follow
     * the run as a whole.
     */
    const step = async (name: string, work: () => Promise<void>, job?: JobName) => {
      const run = job ? await recorder.start(job, now()) : null;
      try {
        await work();
        await run?.finish();
      } catch {
        summary.errors.push(name);
        await run?.finish({}, [name]);
      }
    };

    await step(
      "poll",
      async () => {
        for (const credential of await credentialsDue(deps.db, at, POLL_EVERY_MS)) {
          const outcome =
            credential.provider === "kraken"
              ? deps.kraken
                ? await pollKraken(
                    deps.db,
                    deps.box,
                    credential,
                    deps.kraken.clientFor,
                    deps.kraken.directory,
                    at,
                  )
                : null
              : await pollCredential(deps.db, deps.box, credential, deps.clientFor, at);
          if (outcome?.outcome === "polled") summary.polled += 1;
        }
        // An account that hasn't answered for hours becomes a bell row, never
        // a push: only the figure's age has changed.
        summary.gaps = await recordConnectionGaps(deps.db, at);
      },
      "poll",
    );

    await step("backfill", async () => {
      const [waiting] = await deps.db
        .select()
        .from(providerCredentials)
        .where(
          and(
            eq(providerCredentials.status, "live"),
            eq(providerCredentials.backfillStatus, "pending"),
          ),
        )
        .limit(1);
      if (!waiting) return;
      if (waiting.provider === "kraken" && !deps.kraken) return;
      const outcome =
        waiting.provider === "kraken"
          ? await backfillKrakenHistory(
              deps.db,
              waiting,
              deps.kraken!.directory,
              deps.marketFor,
              at,
            )
          : await backfillHistory(deps.db, deps.box, waiting, deps.clientFor, deps.marketFor, at);
      if (outcome.outcome !== "failed") summary.backfilled += 1;
    });

    await step(
      "prices",
      async () => {
        const held = await deps.db.selectDistinct({ id: holdings.instrumentId }).from(holdings);
        const result = await refreshDue(
          deps.db,
          deps.marketFor,
          held.map((row) => row.id),
          at,
        );
        summary.pricesRefreshed = result.refreshed.length;
        summary.pricesFailed = result.failed.length;
      },
      "prices",
    );

    await step("snapshots", async () => {
      const owners = await deps.db
        .selectDistinct({ userId: providerCredentials.userId })
        .from(providerCredentials)
        .where(inArray(providerCredentials.status, ["live"]));
      const day = londonDay(at);
      for (const { userId } of owners) {
        const result = await snapshotDailyValues(deps.db, userId, day);
        summary.snapshots += result.written.length;
      }
    });

    // Side Bet's limit is judged on money in, so this runs after the poll that
    // reads the Kraken ledger — never on a price.
    await step("limits", async () => {
      if (!deps.sideBetLimits) return;
      const owners = await deps.db
        .selectDistinct({ userId: providerCredentials.userId })
        .from(providerCredentials)
        .where(inArray(providerCredentials.status, ["live"]));
      for (const { userId } of owners) {
        const sideBet = await deps.sideBetLimits.read({ userId }, at);
        const outcomes = await checkLimitAlerts(
          { db: deps.db, ...(deps.notifier ? { notifier: deps.notifier } : {}) },
          { userId },
          sideBet,
          at,
        );
        summary.limitAlerts += outcomes.filter((o) => o.action === "alerted").length;
      }
    });

    await step(
      "facts",
      async () => {
        if (!deps.facts?.length) return;
        const result = await collectFacts({ db: deps.db, adapters: deps.facts, now: at });
        summary.facts = { read: result.read, stored: result.stored, events: result.events };
      },
      "facts",
    );

    await step("nudges", async () => {
      if (!deps.nudges) return;
      const weekly = await recorder.start("weekly_build", now());
      const daily = await recorder.start("daily_build", now());
      const failures: string[] = [];
      const people = await deps.db
        .selectDistinct({
          userId: users.id,
          authUserId: users.authUserId,
          personalResearch: users.personalResearch,
          email: users.email,
        })
        .from(users)
        .innerJoin(providerCredentials, eq(providerCredentials.userId, users.id))
        .where(eq(providerCredentials.status, "live"));
      for (const person of people) {
        if (!person.authUserId) continue;
        const user = { ...person, authUserId: person.authUserId };
        // One person's failure doesn't stop anyone else's week.
        try {
          if ((await deps.nudges.buildWeekIfDue(user, at)) === "built") summary.nudges.weeks += 1;
          if (at.getUTCHours() >= 7) summary.nudges.daily += await deps.nudges.buildDaily(user, at);
        } catch {
          summary.errors.push(`nudges:${person.userId}`);
          failures.push(`nudges:${person.userId}`);
        }
      }
      // The two builds are watched separately: a Monday that never built is a
      // different failure from a quiet day with no daily notes.
      await weekly.finish({ weeks: summary.nudges.weeks }, failures);
      await daily.finish({ daily: summary.nudges.daily }, failures);
    });

    await step(
      "outcomes",
      async () => {
        summary.outcomes = (await fillOutcomes(deps.db, at)).filled;
      },
      "outcomes",
    );

    await whole.finish({ ...summary }, summary.errors);
    await recorder.cleanUp(at).catch(() => 0);
    return summary;
  }

  return {
    /** Runs the job, or joins the run already in progress rather than starting a second. */
    run(): Promise<RefreshJobSummary> {
      running ??= runOnce().finally(() => {
        running = null;
      });
      return running;
    },
  };
}
