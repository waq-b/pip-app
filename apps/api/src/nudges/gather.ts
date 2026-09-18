import {
  BUCKETS,
  type Bucket,
  type InstrumentDetail,
  type NudgeCadence,
  type Profile,
  type RuleSettings,
  type TrustSettings,
} from "@finance-app/shared";
import { and, eq, gte, inArray } from "drizzle-orm";
import { factsEvents, factsNews, factsNewsInstruments } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { FETCH_WINDOW_DAYS } from "../facts/collect.js";
import { newsId } from "../facts/normalise.js";
import { companyFeedFor } from "../facts/sources/rss.js";
import { stubEventsAdapter, stubNewsAdapter } from "../facts/stub.js";
import { factsTarget } from "../facts/targets.js";
import type { ReadModel, ReadUser } from "../read/model.js";
import { evaluateRules, type RulesEvaluation } from "../rules/engine.js";
import type { RulesStore } from "../rules/store.js";
import type { SideBetLimitReader } from "../rules/side-bet.js";
import type { NetAssetsStore } from "../rules/net-assets.js";
import type { TrustSettingsStore } from "../rules/trust-settings.js";
import type { NewsItem } from "../rules/trust.js";
import type { CandidateInput, HoldingInput, MoveFigures, NudgeHistory } from "./candidates.js";
import type { ProfileStore } from "./profile.js";

/**
 * Gathering a build's input (Phase 5 task 7): what the user holds and what it's
 * done from the read model (the same numbers every screen shows), their rules,
 * trust settings and profile, and the stored facts for their holdings.
 */

const DAY_MS = 86_400_000;

/** Facts for a set of holdings, from wherever they're kept. */
export interface FactsReader {
  news(
    holdings: { id: string; name: string; shortName: string; bucket: Bucket }[],
    now: Date,
  ): Promise<Map<string, NewsItem[]>>;
  resultsDates(
    holdings: { id: string; name: string; shortName: string; bucket: Bucket }[],
    now: Date,
  ): Promise<Map<string, string[]>>;
}

/** Real accounts: the shared facts tables the collector fills. */
export function dbFactsReader(db: Db): FactsReader {
  return {
    async news(holdings, now) {
      const ids = holdings.map((h) => h.id);
      const byHolding = new Map<string, NewsItem[]>(ids.map((id) => [id, []]));
      if (ids.length === 0) return byHolding;
      const since = new Date(now.getTime() - FETCH_WINDOW_DAYS * DAY_MS);
      const rows = await db
        .select({
          instrumentId: factsNewsInstruments.instrumentId,
          id: factsNews.id,
          publisher: factsNews.publisher,
          publisherDomain: factsNews.publisherDomain,
          headline: factsNews.headline,
          snippet: factsNews.snippet,
          url: factsNews.url,
          publishedAt: factsNews.publishedAt,
        })
        .from(factsNewsInstruments)
        .innerJoin(factsNews, eq(factsNews.id, factsNewsInstruments.newsId))
        .where(
          and(inArray(factsNewsInstruments.instrumentId, ids), gte(factsNews.publishedAt, since)),
        );
      for (const { instrumentId, ...item } of rows) byHolding.get(instrumentId)!.push(item);
      return byHolding;
    },
    async resultsDates(holdings) {
      const ids = holdings.map((h) => h.id);
      const byHolding = new Map<string, string[]>(ids.map((id) => [id, []]));
      if (ids.length === 0) return byHolding;
      const rows = await db
        .select({ instrumentId: factsEvents.instrumentId, onDate: factsEvents.onDate })
        .from(factsEvents)
        .where(and(inArray(factsEvents.instrumentId, ids), eq(factsEvents.kind, "earnings")));
      for (const row of rows) byHolding.get(row.instrumentId)!.push(row.onDate);
      return byHolding;
    },
  };
}

const typeFor = (bucket: Bucket) => (bucket === "Degen" ? "CRYPTO" : "STOCK");

/** Stub mode: the stub facts, asked for on the spot — no database, no network. */
export function stubFactsReader(): FactsReader {
  const news = stubNewsAdapter();
  const events = stubEventsAdapter();
  const targetsOf = (holdings: { id: string; name: string; shortName: string; bucket: Bucket }[]) =>
    holdings.map((h) =>
      factsTarget({ id: h.id, name: h.name, shortName: h.shortName, type: typeFor(h.bucket) }),
    );
  return {
    async news(holdings, now) {
      const since = new Date(now.getTime() - FETCH_WINDOW_DAYS * DAY_MS);
      const byHolding = new Map<string, NewsItem[]>();
      for (const target of targetsOf(holdings)) {
        const facts = await news.fetch(target, { since, now });
        byHolding.set(
          target.instrumentId,
          facts.map((fact) => ({ ...fact, id: newsId(fact.url) })),
        );
      }
      return byHolding;
    },
    async resultsDates(holdings, now) {
      const byHolding = new Map<string, string[]>(holdings.map((h) => [h.id, []]));
      for (const event of await events.fetch(targetsOf(holdings), { now })) {
        byHolding.get(event.instrumentId)?.push(event.onDate);
      }
      return byHolding;
    },
  };
}

export interface GatherDeps {
  readModel: ReadModel;
  rulesStore: RulesStore;
  /** Side Bet's limit and money in, so the engine judges it the same way here. */
  sideBetLimits: SideBetLimitReader;
  /** When net assets were last reviewed, for the yearly reminder (Phase 6). */
  netAssets?: NetAssetsStore;
  trustStore: TrustSettingsStore;
  profileStore: ProfileStore;
  facts: FactsReader;
}

export interface Gathered {
  input: CandidateInput;
  rules: RuleSettings;
  profile: Profile;
  trust: TrustSettings;
  /** Per holding: the screen's detail (price, provenance) and figures the writer gets. */
  details: Map<string, { detail: InstrumentDetail; potSharePercent: number | null }>;
}

/** Percent and pounds from a price series: the move from the last point at or before `since` to now. */
export function moveSince(
  series: { at: string; value: number }[],
  since: Date,
  price: number,
  value: number,
): MoveFigures | null {
  const before = series.filter((point) => Date.parse(point.at) <= since.getTime());
  const from = before[before.length - 1];
  if (!from || from.value <= 0 || price <= 0) return null;
  const percent = (price / from.value - 1) * 100;
  // The holding's pounds then and now, on the same quantity.
  const pence = Math.round(value - value / (1 + percent / 100));
  return { percent: Math.round(percent * 100) / 100, pence };
}

export async function gather(
  deps: GatherDeps,
  user: ReadUser & { personalResearch?: boolean },
  now: Date,
  cadence: NudgeCadence,
  history: NudgeHistory,
): Promise<Gathered> {
  const [portfolio, storedRules, storedTrust, storedProfile] = await Promise.all([
    deps.readModel.portfolio(user, "day"),
    deps.rulesStore.get(user),
    deps.trustStore.get(user),
    deps.profileStore.get(user),
  ]);

  const connected = new Set(
    portfolio.buckets.filter((b) => b.status !== "not_connected").map((b) => b.bucket),
  );
  const rules: RulesEvaluation = evaluateRules(
    BUCKETS.map((bucket) => ({
      bucket,
      connected: connected.has(bucket),
      valuePence: portfolio.buckets.find((b) => b.bucket === bucket)?.value ?? 0,
    })),
    storedRules.settings,
    await deps.sideBetLimits.read(user, now),
  );

  // Only when they're set: someone who hasn't given them is asked on Setup,
  // not nagged in their week as well.
  const netAssetsStatus = await deps.netAssets?.status(user);
  const netAssets =
    netAssetsStatus?.set && netAssetsStatus.reviewedAt
      ? { reviewedAt: netAssetsStatus.reviewedAt, dueReview: netAssetsStatus.dueReview }
      : null;

  const details: Gathered["details"] = new Map();
  for (const bucket of BUCKETS) {
    if (!connected.has(bucket)) continue;
    const pot = await deps.readModel.bucket(user, bucket, "day");
    const share = rules.pots.find((p) => p.bucket === bucket)?.actualPercent ?? null;
    for (const holding of pot.holdings) {
      if (holding.linkable === false) continue;
      const detail = await deps.readModel.instrument(user, holding.id, "month");
      if (detail) details.set(holding.id, { detail, potSharePercent: share });
    }
  }

  const list = [...details.values()].map(({ detail }) => ({
    id: detail.id,
    name: detail.name,
    shortName: detail.ticker,
    bucket: detail.bucket,
  }));
  const [news, results] = await Promise.all([
    deps.facts.news(list, now),
    deps.facts.resultsDates(list, now),
  ]);

  const holdings: HoldingInput[] = [...details.values()].map(({ detail }) => {
    const target = factsTarget({
      id: detail.id,
      name: detail.name,
      shortName: detail.ticker,
      type: typeFor(detail.bucket),
    });
    const newsroom = companyFeedFor(target);
    return {
      instrumentId: detail.id,
      name: detail.name,
      shortName: detail.ticker,
      bucket: detail.bucket,
      moves: {
        day:
          detail.today.amount === 0 && detail.today.percent === 0
            ? null
            : { percent: detail.today.percent, pence: detail.today.amount },
        week: moveSince(
          detail.series,
          new Date(now.getTime() - 7 * DAY_MS),
          detail.price,
          detail.value,
        ),
        month: moveSince(
          detail.series,
          new Date(now.getTime() - 30 * DAY_MS),
          detail.price,
          detail.value,
        ),
      },
      news: news.get(detail.id) ?? [],
      resultsDates: results.get(detail.id) ?? [],
      ownNewsroomDomains: newsroom ? [newsroom.domain] : [],
    };
  });

  return {
    input: {
      now,
      cadence,
      settings: storedTrust.settings,
      exclusions: storedProfile.profile.exclusions,
      rules,
      holdings,
      history,
      netAssets,
      personalised: user.personalResearch === true,
    },
    rules: storedRules.settings,
    profile: storedProfile.profile,
    trust: storedTrust.settings,
    details,
  };
}
