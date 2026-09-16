import type { AccountKind, Connection, ConnectResult } from "@finance-app/shared";
import { and, count, eq } from "drizzle-orm";
import { credentialContext } from "../crypto/reseal.js";
import type { SecretBox } from "../crypto/secrets.js";
import { dailyValues, holdings, providerCredentials } from "../db/schema.js";
import { asUser, type Db } from "../db/user-scope.js";
import {
  T212AuthError,
  T212PermissionError,
  type T212AccountSummary,
  type T212Position,
} from "../providers/t212/client.js";
import { assertPounds, NotInPoundsError } from "../providers/t212/rows.js";
import type { ConnectionService, ConnectionUser } from "../routes/connections.js";
import { bucketForAccountKind } from "../valuation/value.js";
import { pollCredential, type Credential, type T212ClientFor } from "./poll.js";

/**
 * Connecting for real (Phase 2): Trading 212 accounts, validated against the
 * practice API, sealed at rest, polled straight away. Kraken arrives in Phase 4.
 *
 * Nothing is stored unless the key works and can see what Pip needs. Writes go
 * through the privileged connection after the guard has verified the user;
 * listing reads as the user, so RLS applies.
 */

const DISPLAY: Record<AccountKind, string> = {
  isa: "Trading 212 ISA",
  invest: "Trading 212 Invest",
};

export interface LiveConnectionOptions {
  db: Db;
  box: SecretBox;
  keyVersion: number;
  clientFor: T212ClientFor;
  /** Called after a successful connect — e.g. to start rebuilding history. Not awaited. */
  onConnected?: (credential: Credential) => void;
  now?: () => Date;
}

export function liveConnectionService(options: LiveConnectionOptions): ConnectionService {
  const now = options.now ?? (() => new Date());

  return {
    async list(user) {
      const rows = await asUser(options.db, user.authUserId, async (tx) => {
        const credentials = await tx
          .select({
            id: providerCredentials.id,
            provider: providerCredentials.provider,
            accountKind: providerCredentials.accountKind,
            status: providerCredentials.status,
            lastPolledAt: providerCredentials.lastPolledAt,
          })
          .from(providerCredentials);
        const counts = await tx
          .select({ credentialId: holdings.credentialId, held: count() })
          .from(holdings)
          .groupBy(holdings.credentialId);
        return credentials.map((row) => ({
          ...row,
          held: counts.find((c) => c.credentialId === row.id)?.held ?? 0,
        }));
      });

      const accounts: Connection[] = (["isa", "invest"] as const).map((kind) => {
        const row = rows.find((r) => r.provider === "trading212" && r.accountKind === kind);
        return {
          id: `trading212:${kind}`,
          provider: "trading212",
          accountKind: kind,
          displayName: DISPLAY[kind],
          status: row ? (row.status as Connection["status"]) : "not_connected",
          feeds: [bucketForAccountKind(kind)],
          holdingsSeen: row ? row.held : undefined,
          lastReadAt: row?.lastPolledAt?.toISOString(),
          available: true,
          permissionsVerified: false,
        };
      });
      return [
        ...accounts,
        {
          id: "kraken",
          provider: "kraken",
          displayName: "Kraken",
          status: "not_connected",
          feeds: ["Degen"],
          available: false,
          permissionsVerified: true,
        },
      ];
    },

    async connect(user, provider, request): Promise<ConnectResult> {
      if (provider !== "trading212") {
        return {
          outcome: "not_available_yet",
          provider,
          message: "Kraken isn't connected yet. Side Bet arrives in a later update.",
        };
      }
      const accountKind = request.accountKind!;
      const name = DISPLAY[accountKind];
      if (!request.key || !request.secret) {
        return {
          outcome: "invalid_key",
          provider,
          accountKind,
          message: `Trading 212 needs both the key and the secret. Nothing is connected, and nothing was changed.`,
        };
      }

      // Validate before storing anything.
      const t212 = options.clientFor(request.key, request.secret);
      let prefetched: { summary: T212AccountSummary; positions: T212Position[] };
      try {
        const summary = await t212.accountSummary();
        assertPounds(summary.currency);
        prefetched = { summary, positions: await t212.positions() };
      } catch (error) {
        return failure(error, accountKind, name);
      }

      const credential = await store(
        options,
        user,
        accountKind,
        request.key,
        request.secret,
        prefetched.summary.currency,
        now(),
      );
      const polled = await pollCredential(
        options.db,
        options.box,
        credential,
        () => t212,
        now(),
        prefetched,
      );
      if (polled.outcome !== "polled") return failure(polled, accountKind, name);

      options.onConnected?.(credential);
      return {
        outcome: "connected",
        provider,
        accountKind,
        message: `Connected. Pip is reading your ${name} account.`,
      };
    },

    async disconnect(user, provider, accountKind) {
      if (provider !== "trading212" || !accountKind) return;
      await options.db.transaction(async (tx) => {
        await tx
          .delete(providerCredentials)
          .where(
            and(
              eq(providerCredentials.userId, user.userId),
              eq(providerCredentials.provider, provider),
              eq(providerCredentials.accountKind, accountKind),
            ),
          );
        // That pot's history came from this account; without it, it would be a lie.
        await tx
          .delete(dailyValues)
          .where(
            and(
              eq(dailyValues.userId, user.userId),
              eq(dailyValues.bucket, bucketForAccountKind(accountKind)),
            ),
          );
      });
    },
  };
}

async function store(
  options: LiveConnectionOptions,
  user: ConnectionUser,
  accountKind: AccountKind,
  key: string,
  secret: string,
  accountCurrency: string,
  at: Date,
): Promise<Credential> {
  const base = { userId: user.userId, provider: "trading212", accountKind };
  const sealed = {
    sealedKey: options.box.seal(key, credentialContext(base, "key")),
    sealedSecret: options.box.seal(secret, credentialContext(base, "secret")),
    keyVersion: options.keyVersion,
    status: "live",
    accountCurrency,
    lastVerifiedAt: at,
    backfillStatus: "pending",
    historyStartsOn: null,
  };
  const [row] = await options.db
    .insert(providerCredentials)
    .values({ ...base, ...sealed })
    .onConflictDoUpdate({
      target: [
        providerCredentials.userId,
        providerCredentials.provider,
        providerCredentials.accountKind,
      ],
      set: sealed,
    })
    .returning();
  return row!;
}

function failure(error: unknown, accountKind: AccountKind, name: string): ConnectResult {
  const provider = "trading212";
  if (error instanceof T212AuthError || (isOutcome(error) && error.outcome === "invalid_key")) {
    return {
      outcome: "invalid_key",
      provider,
      accountKind,
      message: `Trading 212 doesn't recognise that key. Check the key and secret are from the same key, with no stray spaces. Nothing is connected, and nothing was changed.`,
    };
  }
  if (
    error instanceof T212PermissionError ||
    (isOutcome(error) && error.outcome === "missing_permission")
  ) {
    const permission =
      error instanceof T212PermissionError
        ? error.permission
        : (error as unknown as { permission: string }).permission;
    return {
      outcome: "missing_permission",
      provider,
      accountKind,
      missingPermission: permission,
      message: `That key can't see your ${permission}. Make a new key with Account data, Portfolio, Metadata and History ticked. Nothing is connected.`,
    };
  }
  if (error instanceof NotInPoundsError || (isOutcome(error) && error.outcome === "not_pounds")) {
    return {
      outcome: "not_pounds",
      provider,
      accountKind,
      message: `That account isn't in pounds. Pip only works in pounds for now, so it didn't connect ${name}.`,
    };
  }
  return {
    outcome: "unavailable",
    provider,
    accountKind,
    message: `Trading 212 isn't answering right now. Nothing is connected — try again in a minute.`,
  };
}

function isOutcome(value: unknown): value is { outcome: string } {
  return typeof value === "object" && value !== null && "outcome" in value;
}
