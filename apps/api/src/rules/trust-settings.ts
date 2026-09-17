import {
  DEFAULT_TRUST_SETTINGS,
  TRUST_LIMITS,
  type TrustRulesError,
  type TrustSettings,
} from "@finance-app/shared";
import { eq } from "drizzle-orm";
import { trustSettings } from "../db/schema.js";
import { asUser, type Db } from "../db/user-scope.js";
import { domainOf } from "../facts/normalise.js";
import type { ReadUser } from "../read/model.js";

/**
 * The trust rules a user sets (Phase 5 decision 3) — which reports count and
 * how many nudges Pip may show. Limits are enforced here, on the server,
 * whatever the screen allowed; the database checks them again.
 */

const NUMBER_RULES: {
  field: Exclude<keyof TrustSettings, "namedPublishers" | "bigMovePercent">;
  error: TrustRulesError;
}[] = [
  { field: "recencyDays", error: "recency_out_of_range" },
  { field: "minSources", error: "sources_out_of_range" },
  { field: "resultsQuietDays", error: "quiet_days_out_of_range" },
  { field: "weeklyBudget", error: "weekly_budget_out_of_range" },
  { field: "dailyBudgetPerDay", error: "daily_budget_out_of_range" },
  { field: "dailyBudgetPerWeek", error: "daily_budget_out_of_range" },
];

/** A publisher as a bare domain: `https://www.Reuters.com/x` → `reuters.com`. */
export function publisherDomain(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const domain = domainOf(value.trim());
  // Needs a dot and only hostname characters — "reuters" or "a b.com" aren't domains.
  return domain && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

export function parseTrustSettings(
  body: unknown,
): { ok: true; settings: TrustSettings } | { ok: false; error: TrustRulesError } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_body" };
  }
  const input = body as Record<string, unknown>;
  const within = (value: number, limits: { min: number; max: number }) =>
    value >= limits.min && value <= limits.max;

  const moves = input.bigMovePercent as Record<string, unknown> | undefined;
  const numbers = [
    ...NUMBER_RULES.map(({ field }) => input[field]),
    moves?.Base,
    moves?.Medium,
    moves?.Degen,
  ];
  if (!numbers.every((value) => Number.isInteger(value))) {
    return { ok: false, error: "whole_numbers_needed" };
  }
  for (const { field, error } of NUMBER_RULES) {
    if (!within(input[field] as number, TRUST_LIMITS[field])) return { ok: false, error };
  }
  const bigMovePercent = {
    Base: moves!.Base as number,
    Medium: moves!.Medium as number,
    Degen: moves!.Degen as number,
  };
  if (!Object.values(bigMovePercent).every((value) => within(value, TRUST_LIMITS.bigMovePercent))) {
    return { ok: false, error: "big_move_out_of_range" };
  }

  if (!Array.isArray(input.namedPublishers)) return { ok: false, error: "publishers_invalid" };
  const namedPublishers: string[] = [];
  for (const raw of input.namedPublishers) {
    const domain = publisherDomain(raw);
    if (!domain) return { ok: false, error: "publishers_invalid" };
    if (!namedPublishers.includes(domain)) namedPublishers.push(domain);
  }
  if (!within(namedPublishers.length, TRUST_LIMITS.namedPublishers)) {
    return { ok: false, error: "publishers_count" };
  }

  return {
    ok: true,
    settings: {
      namedPublishers,
      recencyDays: input.recencyDays as number,
      minSources: input.minSources as number,
      resultsQuietDays: input.resultsQuietDays as number,
      weeklyBudget: input.weeklyBudget as number,
      dailyBudgetPerDay: input.dailyBudgetPerDay as number,
      dailyBudgetPerWeek: input.dailyBudgetPerWeek as number,
      bigMovePercent,
    },
  };
}

export interface StoredTrustSettings {
  settings: TrustSettings;
  /** Null until the user first saves. */
  updatedAt: Date | null;
}

export interface TrustSettingsStore {
  get(user: ReadUser): Promise<StoredTrustSettings>;
  /** Settings must already be parsed (`parseTrustSettings`). */
  set(user: ReadUser, settings: TrustSettings, at: Date): Promise<StoredTrustSettings>;
}

const defaults = (): StoredTrustSettings => ({
  settings: structuredClone(DEFAULT_TRUST_SETTINGS),
  updatedAt: null,
});

function fromRow(row: typeof trustSettings.$inferSelect): StoredTrustSettings {
  return {
    settings: {
      namedPublishers: row.namedPublishers,
      recencyDays: row.recencyDays,
      minSources: row.minSources,
      resultsQuietDays: row.resultsQuietDays,
      weeklyBudget: row.weeklyBudget,
      dailyBudgetPerDay: row.dailyBudgetPerDay,
      dailyBudgetPerWeek: row.dailyBudgetPerWeek,
      bigMovePercent: { Base: row.bigMoveBase, Medium: row.bigMoveMedium, Degen: row.bigMoveDegen },
    },
    updatedAt: row.updatedAt,
  };
}

/** Reads run as the user (RLS); saves go through the privileged connection, like rules. */
export function dbTrustSettingsStore(db: Db): TrustSettingsStore {
  return {
    async get(user) {
      const [row] = await asUser(db, user.authUserId, (tx) => tx.select().from(trustSettings));
      return row ? fromRow(row) : defaults();
    },
    async set(user, settings, at) {
      const { bigMovePercent, ...rest } = settings;
      const values = {
        ...rest,
        bigMoveBase: bigMovePercent.Base,
        bigMoveMedium: bigMovePercent.Medium,
        bigMoveDegen: bigMovePercent.Degen,
        updatedAt: at,
      };
      await db
        .insert(trustSettings)
        .values({ userId: user.userId, ...values })
        .onConflictDoUpdate({ target: trustSettings.userId, set: values });
      const [row] = await db
        .select()
        .from(trustSettings)
        .where(eq(trustSettings.userId, user.userId));
      return fromRow(row!);
    },
  };
}

/** Stub mode: in memory, per user, for as long as the server runs. */
export function memoryTrustSettingsStore(): TrustSettingsStore {
  const saved = new Map<string, StoredTrustSettings>();
  return {
    async get(user) {
      return saved.get(user.userId) ?? defaults();
    },
    async set(user, settings, at) {
      const stored = { settings: structuredClone(settings), updatedAt: at };
      saved.set(user.userId, stored);
      return stored;
    },
  };
}
