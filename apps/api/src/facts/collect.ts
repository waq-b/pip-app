import { and, eq, lt, sql } from "drizzle-orm";
import {
  factsEvents,
  factsFetches,
  factsNews,
  factsNewsInstruments,
  holdings,
  instruments,
} from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { takeCall } from "../market/budget.js";
import { HEADLINE_MAX, newsId, SNIPPET_MAX } from "./normalise.js";
import { adaptersFor, factsTarget, mentions } from "./targets.js";
import {
  FactsSourceError,
  type FactsAdapter,
  type FactsBudget,
  type FactsTarget,
  type NewsFact,
} from "./types.js";

/**
 * The collector: one step of the scheduled refresh job. For
 * everything anyone holds, it asks each adapter whose coverage includes the
 * holding — when that read is due and the source's daily budget allows — and
 * stores what comes back in the shared facts tables. Every read is isolated: a
 * source that fails is noted and retried later, never stops the rest.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** How far back sources are asked for: the widest recency window a user can set. */
export const FETCH_WINDOW_DAYS = 14;
/** After a failure, leave a source alone this long. */
export const RETRY_AFTER_MS = HOUR_MS;
/** Facts older than this are deleted. */
export const KEEP_DAYS = 90;

export interface CollectDeps {
  db: Db;
  adapters: FactsAdapter[];
  now?: Date;
  /** Waits between calls to sources that refuse bursts. Replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface CollectSummary {
  read: number;
  stored: number;
  events: number;
  overBudget: string[];
  failed: string[];
  deleted: number;
}

/** Everything anyone holds, as facts targets. */
export async function heldTargets(db: Db): Promise<FactsTarget[]> {
  const rows = await db
    .selectDistinct({
      id: instruments.id,
      name: instruments.name,
      shortName: instruments.shortName,
      type: instruments.type,
    })
    .from(holdings)
    .innerJoin(instruments, eq(holdings.instrumentId, instruments.id));
  return rows
    .map(factsTarget)
    .sort((a, b) =>
      a.instrumentId < b.instrumentId ? -1 : a.instrumentId > b.instrumentId ? 1 : 0,
    );
}

async function isDue(
  db: Db,
  key: { source: string; kind: string; target: string },
  everyMs: number,
  now: Date,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(factsFetches)
    .where(
      and(
        eq(factsFetches.source, key.source),
        eq(factsFetches.kind, key.kind),
        eq(factsFetches.target, key.target),
      ),
    );
  if (!row) return true;
  const failedAt = row.lastFailedAt?.getTime();
  const fetchedAt = row.lastFetchedAt?.getTime();
  if (failedAt !== undefined && (fetchedAt === undefined || failedAt > fetchedAt)) {
    return now.getTime() - failedAt >= RETRY_AFTER_MS;
  }
  return fetchedAt === undefined || now.getTime() - fetchedAt >= everyMs;
}

async function record(
  db: Db,
  key: { source: string; kind: string; target: string },
  outcome: "fetched" | "failed",
  now: Date,
) {
  const set = outcome === "fetched" ? { lastFetchedAt: now } : { lastFailedAt: now };
  await db
    .insert(factsFetches)
    .values({ ...key, ...set })
    .onConflictDoUpdate({
      target: [factsFetches.source, factsFetches.kind, factsFetches.target],
      set,
    });
}

/**
 * Takes a call from the adapter's own budget and, if it shares a key with
 * prices, from that counter too — only while enough is left for prices.
 */
async function takeBudget(db: Db, budget: FactsBudget | undefined, now: Date): Promise<boolean> {
  if (!budget) return true;
  if (budget.shared) {
    const { counter, ceiling, keepFree } = budget.shared;
    if (!(await takeCall(db, counter, ceiling - keepFree, now))) return false;
  }
  return takeCall(db, budget.counter, budget.limit, now);
}

async function storeNews(
  db: Db,
  source: string,
  facts: NewsFact[],
  linksFor: (fact: NewsFact) => string[],
): Promise<number> {
  let stored = 0;
  for (const fact of facts) {
    const id = newsId(fact.url);
    const inserted = await db
      .insert(factsNews)
      .values({
        id,
        source,
        publisher: fact.publisher.slice(0, 120),
        publisherDomain: fact.publisherDomain,
        headline: fact.headline.slice(0, HEADLINE_MAX),
        snippet: fact.snippet?.slice(0, SNIPPET_MAX) ?? null,
        url: fact.url,
        publishedAt: fact.publishedAt,
      })
      .onConflictDoNothing()
      .returning({ id: factsNews.id });
    stored += inserted.length;
    const links = linksFor(fact);
    if (links.length > 0) {
      await db
        .insert(factsNewsInstruments)
        .values(links.map((instrumentId) => ({ newsId: id, instrumentId })))
        .onConflictDoNothing();
    }
  }
  return stored;
}

export async function collectFacts(deps: CollectDeps): Promise<CollectSummary> {
  const { db, adapters } = deps;
  const now = deps.now ?? new Date();
  const sleep = deps.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const since = new Date(now.getTime() - FETCH_WINDOW_DAYS * DAY_MS);
  const summary: CollectSummary = {
    read: 0,
    stored: 0,
    events: 0,
    overBudget: [],
    failed: [],
    deleted: 0,
  };
  const targets = await heldTargets(db);
  const lastCallAt = new Map<string, number>();

  /** Due → budget → pause → read → record. Returns what `work` returned, or null. */
  async function attempt<T>(
    adapter: FactsAdapter,
    key: { kind: string; target: string },
    work: () => Promise<T>,
  ): Promise<T | null> {
    const fullKey = { source: adapter.id, ...key };
    const label = `${adapter.id}:${key.target}`;
    if (!(await isDue(db, fullKey, adapter.everyMs, now))) return null;
    if (!(await takeBudget(db, adapter.budget, now))) {
      summary.overBudget.push(label);
      return null;
    }
    if (adapter.pauseMs && lastCallAt.has(adapter.id)) await sleep(adapter.pauseMs);
    lastCallAt.set(adapter.id, Date.now());
    try {
      const result = await work();
      await record(db, fullKey, "fetched", now);
      summary.read += 1;
      return result;
    } catch (error) {
      // A rate limit isn't the source failing; it's tried again on a later run.
      if (!(error instanceof FactsSourceError && error.reason === "blocked")) {
        await record(db, fullKey, "failed", now);
      }
      summary.failed.push(label);
      return null;
    }
  }

  const matchHoldings = (fact: NewsFact) =>
    targets
      .filter((target) => mentions(target, `${fact.headline} ${fact.snippet ?? ""}`))
      .map((target) => target.instrumentId);

  if (targets.length > 0) {
    for (const adapter of adapters) {
      if (adapter.scope !== "feed") continue;
      const facts = await attempt(adapter, { kind: "news", target: adapter.id }, () =>
        adapter.fetch({ since, now }),
      );
      if (facts) summary.stored += await storeNews(db, adapter.id, facts, matchHoldings);
    }

    for (const target of targets) {
      for (const adapter of adaptersFor(target, adapters)) {
        const facts = await attempt(adapter, { kind: "news", target: target.instrumentId }, () =>
          adapter.fetch(target, { since, now }),
        );
        if (facts) {
          summary.stored += await storeNews(db, adapter.id, facts, (fact) => [
            ...new Set([target.instrumentId, ...matchHoldings(fact)]),
          ]);
        }
      }
    }

    for (const adapter of adapters) {
      if (adapter.scope !== "events") continue;
      const covered = targets.filter(
        (target) =>
          adapter.coverage.regions.includes(target.region) &&
          adapter.coverage.assets.includes(target.asset),
      );
      if (covered.length === 0) continue;
      const events = await attempt(adapter, { kind: "events", target: "all" }, () =>
        adapter.fetch(covered, { now }),
      );
      for (const event of events ?? []) {
        await db
          .insert(factsEvents)
          .values({ ...event, source: adapter.id, fetchedAt: now })
          .onConflictDoUpdate({
            target: [factsEvents.instrumentId, factsEvents.kind, factsEvents.onDate],
            set: { detail: event.detail, source: adapter.id, fetchedAt: now },
          });
        summary.events += 1;
      }
    }
  }

  const cutoff = new Date(now.getTime() - KEEP_DAYS * DAY_MS);
  const deleted = await db
    .delete(factsNews)
    .where(lt(factsNews.publishedAt, cutoff))
    .returning({ id: factsNews.id });
  await db.delete(factsEvents).where(lt(factsEvents.onDate, cutoff.toISOString().slice(0, 10)));
  summary.deleted = deleted.length;

  return summary;
}

/** For tests and the job summary: how many reports are linked to a holding. */
export async function newsCountFor(db: Db, instrumentId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(factsNewsInstruments)
    .where(eq(factsNewsInstruments.instrumentId, instrumentId));
  return row?.count ?? 0;
}
