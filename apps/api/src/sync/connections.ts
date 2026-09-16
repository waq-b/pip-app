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
import {
  pollKraken,
  type CoinDirectory,
  type KrakenClientFor,
  type KrakenPollOutcome,
} from "./kraken.js";
import { pollCredential, type Credential, type T212ClientFor } from "./poll.js";
import { KrakenAuthError, KrakenPermissionError } from "../providers/kraken/client.js";
import { checkKrakenPermissions, type PermissionCheck } from "../providers/kraken/permissions.js";

/**
 * Connecting for real: Trading 212 accounts (Phase 2), validated against the
 * practice API, and Kraken (Phase 3), whose key must prove it can't move money
 * — both sealed at rest and polled straight away.
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
  /** Kraken, when configured. Setup offers it once the web side is ready (Phase 3 task 8). */
  kraken?: { clientFor: KrakenClientFor; directory: CoinDirectory };
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
      const kraken = rows.find((r) => r.provider === "kraken");
      return [
        ...accounts,
        {
          id: "kraken",
          provider: "kraken",
          displayName: "Kraken",
          status: kraken ? (kraken.status as Connection["status"]) : "not_connected",
          feeds: ["Degen"],
          holdingsSeen: kraken ? kraken.held : undefined,
          lastReadAt: kraken?.lastPolledAt?.toISOString(),
          available: false,
          permissionsVerified: true,
        },
      ];
    },

    async connect(user, provider, request): Promise<ConnectResult> {
      if (provider === "kraken") {
        if (!options.kraken) {
          return {
            outcome: "not_available_yet",
            provider,
            message: "Kraken isn't connected yet. Side Bet arrives in a later update.",
          };
        }
        return connectKraken(options, options.kraken, user, request.key, request.secret, now());
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

    async disconnect(user, provider, requestedKind) {
      const accountKind = provider === "kraken" ? "spot" : requestedKind;
      if (!accountKind) return;
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

async function connectKraken(
  options: LiveConnectionOptions,
  kraken: NonNullable<LiveConnectionOptions["kraken"]>,
  user: ConnectionUser,
  key: string,
  secret: string | undefined,
  at: Date,
): Promise<ConnectResult> {
  const provider = "kraken";
  if (!key || !secret) {
    return {
      outcome: "invalid_key",
      provider,
      message:
        "Kraken needs both the API key and the private key. Nothing is connected, and nothing was changed.",
    };
  }

  // Validate before storing anything: the key must exist and be unable to move money.
  try {
    const check = checkKrakenPermissions(
      (await kraken.clientFor(key, secret).keyInfo()).permissions,
    );
    if (!check.ok)
      return krakenFailure({
        outcome: check.forbidden.length ? "too_much_access" : "missing_permission",
        check,
      } as KrakenPollOutcome);
  } catch (error) {
    return krakenFailure(error);
  }

  const credential = await store(options, user, "spot", key, secret, "GBP", at, "kraken");
  const polled = await pollKraken(
    options.db,
    options.box,
    credential,
    kraken.clientFor,
    kraken.directory,
    at,
  );
  if (polled.outcome !== "polled") {
    // Nothing half-connected is left behind.
    await options.db.delete(providerCredentials).where(eq(providerCredentials.id, credential.id));
    return krakenFailure(polled);
  }
  options.onConnected?.(credential);
  return {
    outcome: "connected",
    provider,
    message: "Connected. Pip checked: this key cannot place orders or withdraw.",
  };
}

const KRAKEN_PERMISSION_NAMES: Record<string, string> = {
  "query-funds": "Query funds",
  "query-ledger": "Query ledger entries",
  "query-open-trades": "Query open orders & trades",
  "query-closed-trades": "Query closed orders & trades",
  "export-data": "Export data",
  "add-funds": "Deposit",
  "withdraw-funds": "Withdraw",
  "earn-funds": "Earn",
  "modify-trades": "Create & modify orders",
  "close-trades": "Cancel & close orders",
  "create-ws-token": "WebSocket interface",
  "add-withdraw-address": "Add withdrawal addresses",
  "update-withdraw-address": "Update withdrawal addresses",
};

const permissionName = (id: string) => KRAKEN_PERMISSION_NAMES[id] ?? id;

function krakenFailure(error: unknown): ConnectResult {
  const provider = "kraken";
  const outcome = isOutcome(error) ? error.outcome : undefined;
  if (outcome === "too_much_access") {
    const check = (error as { check: PermissionCheck }).check;
    return {
      outcome: "too_much_access",
      provider,
      message: `That key can do too much. Pip only accepts Kraken keys that can look, so it won't store this one. Make a key with only Query funds and Query ledger entries ticked.`,
      permissions: [
        ...["query-funds", "query-ledger"].map((id) => ({
          name: permissionName(id),
          granted: !check.missing.includes(id),
          required: true,
        })),
        ...check.forbidden.map((id) => ({
          name: permissionName(id),
          granted: true,
          required: false,
        })),
      ],
    };
  }
  if (error instanceof KrakenAuthError || outcome === "invalid_key") {
    return {
      outcome: "invalid_key",
      provider,
      message: `Kraken doesn't recognise that key. Check the API key and private key are from the same key, with no stray spaces — and if the key has an IP restriction, that it allows Pip. Nothing is connected, and nothing was changed.`,
    };
  }
  if (error instanceof KrakenPermissionError || outcome === "missing_permission") {
    const missing =
      outcome === "missing_permission" && "check" in (error as object)
        ? permissionName((error as { check: PermissionCheck }).check.missing[0]!)
        : error instanceof KrakenPermissionError
          ? (error.permission ?? "Query funds")
          : permissionName((error as { permission?: string }).permission ?? "query-funds");
    return {
      outcome: "missing_permission",
      provider,
      missingPermission: missing,
      message: `That key can't see your ${missing}. Make a key with only Query funds and Query ledger entries ticked. Nothing is connected.`,
    };
  }
  return {
    outcome: "unavailable",
    provider,
    message: `Kraken isn't answering right now. Nothing is connected — try again in a minute.`,
  };
}

async function store(
  options: LiveConnectionOptions,
  user: ConnectionUser,
  accountKind: AccountKind | "spot",
  key: string,
  secret: string,
  accountCurrency: string,
  at: Date,
  provider: "trading212" | "kraken" = "trading212",
): Promise<Credential> {
  const base = { userId: user.userId, provider, accountKind };
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
