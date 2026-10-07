/**
 * Kraken spot, read-only (design rules 1, 3).
 *
 * Kraken has no practice mode, so this reads a real account — which is why the
 * client can only call three methods, all reads: the key's own permissions,
 * balances and the ledger. There is no code path to orders, withdrawals,
 * deposits or earn. Responses are checked for the fields Pip relies on.
 */
import { createHash, createHmac } from "node:crypto";

export const KRAKEN_BASE_URL = "https://api.kraken.com";

// ─── Response shapes Pip relies on (verified 2026-09-16) ─────────────────────

export interface KrakenKeyInfo {
  /** e.g. `query-funds`, `query-ledger`. */
  permissions: string[];
  ipAllowlist: string[];
}

export interface KrakenBalance {
  /** Kraken's asset name as it appears in balances: `XXBT`, `ZGBP`, `DOT.S`. */
  asset: string;
  balance: number;
  /** Held for open orders; still owned. */
  holdTrade: number;
}

export interface KrakenLedgerEntry {
  id: string;
  refid: string;
  time: Date;
  /** `trade`, `deposit`, `withdrawal`, `staking`, `transfer`, `earn`, … */
  type: string;
  subtype: string;
  asset: string;
  /** Signed change, before the fee. */
  amount: number;
  fee: number;
  /** The asset's balance after this entry. */
  balance: number;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export type KrakenPermission = "Query Funds" | "Query Ledger Entries";

/** The key isn't recognised or the signature is wrong. Retrying won't help. */
export class KrakenAuthError extends Error {
  constructor() {
    super("Kraken didn't recognise the key");
    this.name = "KrakenAuthError";
  }
}

/** The key lacks a permission Pip needs (`EGeneral:Permission denied`). */
export class KrakenPermissionError extends Error {
  constructor(readonly permission: KrakenPermission | null) {
    super(permission ? `Kraken key is missing "${permission}"` : "Kraken refused the key");
    this.name = "KrakenPermissionError";
  }
}

/** Kraken is down, throttling past our patience, or unreachable. Worth retrying later. */
export class KrakenUnavailableError extends Error {
  constructor(detail: string) {
    super(`Kraken unavailable: ${detail}`);
    this.name = "KrakenUnavailableError";
  }
}

/** A response didn't have the shape Pip relies on. */
export class KrakenShapeError extends Error {
  constructor(what: string) {
    super(`Unexpected Kraken response: ${what}`);
    this.name = "KrakenShapeError";
  }
}

// ─── Client ───────────────────────────────────────────────────────────────────

/** The only private methods Pip calls, with their rate-limit cost and permission. */
const METHODS = {
  GetApiKeyInfo: { cost: 1, permission: null },
  BalanceEx: { cost: 1, permission: "Query Funds" },
  Ledgers: { cost: 2, permission: "Query Ledger Entries" },
} as const satisfies Record<string, { cost: number; permission: KrakenPermission | null }>;
type Method = keyof typeof METHODS;

/** Starter tier: the counter tops out at 15 and drains a third of a point a second. */
const COUNTER_MAX = 15;
const DECAY_PER_SECOND = 0.33;
const LEDGER_PAGE = 50;

export interface KrakenClientOptions {
  key: string;
  /** The private key, base64, as Kraken shows it. */
  secret: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxRateLimitRetries?: number;
}

export interface KrakenClient {
  keyInfo(): Promise<KrakenKeyInfo>;
  balances(): Promise<KrakenBalance[]>;
  /** Every ledger entry, newest first, following Kraken's offset pages. */
  ledger(options?: { maxPages?: number }): AsyncGenerator<KrakenLedgerEntry>;
}

export function createKrakenClient(options: KrakenClientOptions): KrakenClient {
  if (!options.key || !options.secret) throw new KrakenAuthError();
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const maxRetries = options.maxRateLimitRetries ?? 2;

  let lastNonce = 0;
  let counter = 0;
  let counterAt = now();
  /** Calls go one at a time: nonces must arrive in order. */
  let queue: Promise<unknown> = Promise.resolve();

  function drain(): void {
    const t = now();
    counter = Math.max(0, counter - ((t - counterAt) / 1000) * DECAY_PER_SECOND);
    counterAt = t;
  }

  async function call(method: Method, params: Record<string, string> = {}): Promise<unknown> {
    const run = queue.then(() => send(method, params));
    queue = run.catch(() => undefined);
    return run;
  }

  async function send(method: Method, params: Record<string, string>): Promise<unknown> {
    const { cost, permission } = METHODS[method];
    for (let attempt = 0; ; attempt++) {
      drain();
      if (counter + cost > COUNTER_MAX) {
        await sleep(((counter + cost - COUNTER_MAX) / DECAY_PER_SECOND) * 1000);
        drain();
      }
      counter += cost;

      lastNonce = Math.max(now() * 1000, lastNonce + 1);
      const nonce = String(lastNonce);
      const body = new URLSearchParams({ nonce, ...params }).toString();
      const path = `/0/private/${method}`;

      let response: Response;
      try {
        response = await doFetch(KRAKEN_BASE_URL + path, {
          method: "POST",
          headers: {
            "API-Key": options.key,
            "API-Sign": signRequest(path, nonce, body, options.secret),
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body,
        });
      } catch {
        throw new KrakenUnavailableError("unreachable");
      }
      if (!response.ok) throw new KrakenUnavailableError(`HTTP ${response.status}`);

      let json: Record<string, unknown>;
      try {
        json = record(await response.json(), method);
      } catch {
        throw new KrakenShapeError(`${method} wasn't JSON`);
      }
      const errors = Array.isArray(json.error) ? json.error.map(String) : [];
      if (errors.length === 0) return json.result;

      const first = errors[0]!;
      if (first.startsWith("EAPI:Invalid key") || first.startsWith("EAPI:Invalid signature")) {
        throw new KrakenAuthError();
      }
      if (first.startsWith("EGeneral:Permission denied")) {
        throw new KrakenPermissionError(permission);
      }
      if (
        (first.startsWith("EAPI:Rate limit") || first.startsWith("EService:Throttled")) &&
        attempt < maxRetries
      ) {
        counter = COUNTER_MAX;
        counterAt = now();
        await sleep(5_000);
        continue;
      }
      // Error text is Kraken's and carries nothing secret.
      throw new KrakenUnavailableError(first);
    }
  }

  return {
    async keyInfo() {
      const body = record(await call("GetApiKeyInfo"), "key info");
      return {
        permissions: strings(body.permissions, "key permissions"),
        ipAllowlist:
          body.ip_allowlist === undefined ? [] : strings(body.ip_allowlist, "ip_allowlist"),
      };
    },
    async balances() {
      const body = record(await call("BalanceEx"), "balances");
      return Object.entries(body).map(([asset, value]) => {
        const entry = record(value, `balance ${asset}`);
        return {
          asset,
          balance: decimal(entry.balance, `balance ${asset}`),
          holdTrade:
            entry.hold_trade === undefined ? 0 : decimal(entry.hold_trade, `hold ${asset}`),
        };
      });
    },
    async *ledger({ maxPages = 1_000 } = {}) {
      let offset = 0;
      for (let page = 0; page < maxPages; page++) {
        const body = record(await call("Ledgers", { ofs: String(offset) }), "ledger");
        const count = decimal(body.count, "ledger count");
        const entries = Object.entries(record(body.ledger, "ledger entries"));
        for (const [id, value] of entries) yield parseLedgerEntry(id, value);
        offset += entries.length;
        if (entries.length < LEDGER_PAGE || offset >= count) return;
      }
    },
  };
}

/** `API-Sign`: HMAC-SHA512 of path + SHA-256(nonce + body), keyed with the decoded private key. */
export function signRequest(path: string, nonce: string, body: string, secret: string): string {
  const digest = createHash("sha256")
    .update(nonce + body)
    .digest();
  return createHmac("sha512", Buffer.from(secret, "base64"))
    .update(Buffer.concat([Buffer.from(path), digest]))
    .digest("base64");
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new KrakenShapeError(what);
  }
  return value as Record<string, unknown>;
}

function strings(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new KrakenShapeError(what);
  }
  return value as string[];
}

/** Kraken sends amounts as decimal strings (and counts as numbers). */
function decimal(value: unknown, what: string): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new KrakenShapeError(what);
  return n;
}

function parseLedgerEntry(id: string, value: unknown): KrakenLedgerEntry {
  const body = record(value, `ledger entry ${id}`);
  const text = (field: string) => {
    const v = body[field];
    if (typeof v !== "string") throw new KrakenShapeError(`ledger ${field}`);
    return v;
  };
  return {
    id,
    refid: text("refid"),
    time: new Date(decimal(body.time, "ledger time") * 1000),
    type: text("type"),
    subtype: typeof body.subtype === "string" ? body.subtype : "",
    asset: text("asset"),
    amount: decimal(body.amount, "ledger amount"),
    fee: decimal(body.fee, "ledger fee"),
    balance: decimal(body.balance, "ledger balance"),
  };
}
