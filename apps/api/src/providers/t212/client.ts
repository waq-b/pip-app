/**
 * Trading 212, read-only, practice account only (design rules 1, 3).
 *
 * Every request is a GET to an allowlisted path. There is no code path to an
 * order or pies endpoint, and `live` isn't a valid environment until Phase 8.
 * Responses are checked for the fields Pip relies on, so a beta API renaming
 * something fails loudly here instead of producing a wrong number later.
 */

export const T212_BASE_URLS = { demo: "https://demo.trading212.com/api/v0" } as const;
export type T212Env = keyof typeof T212_BASE_URLS;

// ─── Response shapes Pip relies on (verified 2026-09-16) ─────────────────────

export interface T212AccountSummary {
  id: number;
  currency: string;
  totalValue: number;
  cash: { availableToTrade: number; reservedForOrders: number; inPies: number };
  investments: { currentValue: number; totalCost: number };
}

export interface T212Position {
  instrument: { ticker: string; name: string; isin: string; currency: string };
  quantity: number;
  averagePricePaid: number;
  /** Ignored for display — prices come from market data (design rule 7). */
  currentPrice: number;
  walletImpact: { currency: string; totalCost: number; currentValue: number };
  createdAt: string;
}

export interface T212Instrument {
  ticker: string;
  type: string;
  workingScheduleId: number;
  isin: string;
  currencyCode: string;
  name: string;
  shortName: string;
}

export interface T212Exchange {
  id: number;
  name: string;
  workingSchedules: { id: number; timeEvents: { date: string; type: string }[] }[];
}

export interface T212Fill {
  orderId: string;
  fillId: string;
  ticker: string;
  side: "BUY" | "SELL";
  status: string;
  quantity: number;
  price: number;
  filledAt: string;
  walletCurrency: string;
  netValue: number;
  /** Fees and taxes in wallet currency, as positive amounts. */
  fees: number;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export type T212Permission = "Account data" | "Portfolio" | "Metadata" | "History";

/** The key or secret isn't recognised (401). Retrying won't help. */
export class T212AuthError extends Error {
  constructor() {
    super("Trading 212 didn't recognise the key");
    this.name = "T212AuthError";
  }
}

/**
 * The key lacks a permission Pip needs. T212 answers these with a bare 403 —
 * no body — so the permission is inferred from the endpoint that refused.
 */
export class T212PermissionError extends Error {
  constructor(readonly permission: T212Permission) {
    super(`Trading 212 key is missing the "${permission}" permission`);
    this.name = "T212PermissionError";
  }
}

/** T212 is down, rate-limiting past our patience, or unreachable. Worth retrying later. */
export class T212UnavailableError extends Error {
  constructor(readonly status?: number) {
    super(status ? `Trading 212 answered ${status}` : "Trading 212 couldn't be reached");
    this.name = "T212UnavailableError";
  }
}

/** A response didn't have the shape Pip relies on — the beta API changed. */
export class T212ShapeError extends Error {
  constructor(what: string) {
    super(`Unexpected Trading 212 response: ${what}`);
    this.name = "T212ShapeError";
  }
}

// ─── Client ───────────────────────────────────────────────────────────────────

const ALLOWED_PATHS: { pattern: RegExp; permission: T212Permission }[] = [
  { pattern: /^\/equity\/account\/summary$/, permission: "Account data" },
  { pattern: /^\/equity\/positions$/, permission: "Portfolio" },
  { pattern: /^\/equity\/metadata\/(instruments|exchanges)$/, permission: "Metadata" },
  { pattern: /^\/equity\/history\/orders(\?[\w=&%.-]*)?$/, permission: "History" },
];

export interface T212ClientOptions {
  key: string;
  secret: string;
  env: T212Env;
  fetch?: typeof fetch;
  /** Injected so tests don't actually wait out rate limits. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Retries after a 429 before giving up. */
  maxRateLimitRetries?: number;
}

export interface T212Client {
  accountSummary(): Promise<T212AccountSummary>;
  positions(): Promise<T212Position[]>;
  instruments(): Promise<T212Instrument[]>;
  exchanges(): Promise<T212Exchange[]>;
  /** Every filled order, newest first, following T212's cursor pages. */
  fills(options?: { pageSize?: number; maxPages?: number }): AsyncGenerator<T212Fill>;
}

export function createT212Client(options: T212ClientOptions): T212Client {
  if (options.env !== "demo") {
    // design rule 3: paper before live. Phase 8 adds live, read-only.
    throw new Error("Only the Trading 212 practice environment is allowed in Phase 2");
  }
  if (!options.key || !options.secret) throw new T212AuthError();

  const base = T212_BASE_URLS[options.env];
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const maxRetries = options.maxRateLimitRetries ?? 2;
  const authorization = `Basic ${Buffer.from(`${options.key}:${options.secret}`).toString("base64")}`;
  /** When each endpoint's rate-limit window reopens, from T212's own headers. */
  const reopensAt = new Map<string, number>();

  async function get(path: string): Promise<unknown> {
    const allowed = ALLOWED_PATHS.find(({ pattern }) => pattern.test(path));
    if (!allowed) throw new Error(`Refusing Trading 212 path ${path}`);
    const bucket = path.split("?")[0]!;

    for (let attempt = 0; ; attempt++) {
      const waitMs = (reopensAt.get(bucket) ?? 0) - now();
      if (waitMs > 0) await sleep(waitMs);

      let response: Response;
      try {
        response = await doFetch(base + path, {
          method: "GET",
          headers: { Authorization: authorization, Accept: "application/json" },
        });
      } catch {
        throw new T212UnavailableError();
      }

      const remaining = response.headers.get("x-ratelimit-remaining");
      const reset = Number(response.headers.get("x-ratelimit-reset"));
      if (remaining === "0" && Number.isFinite(reset) && reset > 0) {
        reopensAt.set(bucket, reset * 1000);
      }

      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new T212ShapeError(`${bucket} wasn't JSON`);
        }
      }
      if (response.status === 401) throw new T212AuthError();
      if (response.status === 403) throw new T212PermissionError(allowed.permission);
      if (response.status === 429 && attempt < maxRetries) {
        const retryAt = Number.isFinite(reset) && reset > 0 ? reset * 1000 : now() + 5_000;
        reopensAt.set(bucket, Math.max(retryAt, now() + 1_000));
        continue;
      }
      throw new T212UnavailableError(response.status);
    }
  }

  return {
    async accountSummary() {
      return parseSummary(await get("/equity/account/summary"));
    },
    async positions() {
      return list(await get("/equity/positions"), "positions").map(parsePosition);
    },
    async instruments() {
      return list(await get("/equity/metadata/instruments"), "instruments").map(parseInstrument);
    },
    async exchanges() {
      return list(await get("/equity/metadata/exchanges"), "exchanges").map(parseExchange);
    },
    async *fills({ pageSize = 50, maxPages = 1_000 } = {}) {
      let path: string | null = `/equity/history/orders?limit=${pageSize}`;
      for (let page = 0; path && page < maxPages; page++) {
        const body = record(await get(path), "order history");
        for (const item of list(body.items, "order history items")) {
          const fill = parseFill(item);
          if (fill) yield fill;
        }
        const next = body.nextPagePath;
        if (next !== null && next !== undefined && typeof next !== "string") {
          throw new T212ShapeError("order history nextPagePath");
        }
        path = next ? next.replace(/^\/api\/v0/, "") : null;
      }
    },
  };
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new T212ShapeError(what);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new T212ShapeError(what);
  return value;
}

function num(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new T212ShapeError(what);
  return value;
}

function str(value: unknown, what: string): string {
  if (typeof value !== "string" || value === "") throw new T212ShapeError(what);
  return value;
}

function parseSummary(value: unknown): T212AccountSummary {
  const body = record(value, "account summary");
  const cash = record(body.cash, "account summary cash");
  const investments = record(body.investments, "account summary investments");
  return {
    id: num(body.id, "account id"),
    currency: str(body.currency, "account currency"),
    totalValue: num(body.totalValue, "account totalValue"),
    cash: {
      availableToTrade: num(cash.availableToTrade, "cash.availableToTrade"),
      reservedForOrders: num(cash.reservedForOrders, "cash.reservedForOrders"),
      inPies: num(cash.inPies, "cash.inPies"),
    },
    investments: {
      currentValue: num(investments.currentValue, "investments.currentValue"),
      totalCost: num(investments.totalCost, "investments.totalCost"),
    },
  };
}

function parsePosition(value: unknown): T212Position {
  const body = record(value, "position");
  const instrument = record(body.instrument, "position instrument");
  const wallet = record(body.walletImpact, "position walletImpact");
  return {
    instrument: {
      ticker: str(instrument.ticker, "position ticker"),
      name: str(instrument.name, "position name"),
      isin: str(instrument.isin, "position isin"),
      currency: str(instrument.currency, "position currency"),
    },
    quantity: num(body.quantity, "position quantity"),
    averagePricePaid: num(body.averagePricePaid, "position averagePricePaid"),
    currentPrice: num(body.currentPrice, "position currentPrice"),
    walletImpact: {
      currency: str(wallet.currency, "walletImpact currency"),
      totalCost: num(wallet.totalCost, "walletImpact totalCost"),
      currentValue: num(wallet.currentValue, "walletImpact currentValue"),
    },
    createdAt: str(body.createdAt, "position createdAt"),
  };
}

function parseInstrument(value: unknown): T212Instrument {
  const body = record(value, "instrument");
  return {
    ticker: str(body.ticker, "instrument ticker"),
    type: str(body.type, "instrument type"),
    workingScheduleId: num(body.workingScheduleId, "instrument workingScheduleId"),
    isin: str(body.isin, "instrument isin"),
    currencyCode: str(body.currencyCode, "instrument currencyCode"),
    name: str(body.name, "instrument name"),
    shortName: typeof body.shortName === "string" ? body.shortName : str(body.ticker, "ticker"),
  };
}

function parseExchange(value: unknown): T212Exchange {
  const body = record(value, "exchange");
  return {
    id: num(body.id, "exchange id"),
    name: str(body.name, "exchange name"),
    workingSchedules: list(body.workingSchedules, "exchange workingSchedules").map((schedule) => {
      const s = record(schedule, "working schedule");
      return {
        id: num(s.id, "working schedule id"),
        timeEvents: list(s.timeEvents, "timeEvents").map((event) => {
          const e = record(event, "time event");
          return { date: str(e.date, "time event date"), type: str(e.type, "time event type") };
        }),
      };
    }),
  };
}

/** A filled order becomes a fill; anything unfilled (cancelled, rejected) is skipped. */
function parseFill(value: unknown): T212Fill | null {
  const body = record(value, "order history item");
  const order = record(body.order, "order");
  if (body.fill === null || body.fill === undefined) return null;
  const fill = record(body.fill, "fill");
  const wallet = record(fill.walletImpact, "fill walletImpact");
  const side = str(order.side, "order side");
  if (side !== "BUY" && side !== "SELL") throw new T212ShapeError(`order side ${side}`);
  const taxes = wallet.taxes === undefined ? [] : list(wallet.taxes, "fill taxes");
  const fees = taxes.reduce<number>((sum, tax) => {
    const t = record(tax, "fill tax");
    return sum + Math.abs(num(t.quantity, "fill tax quantity"));
  }, 0);

  return {
    orderId: String(num(order.id, "order id")),
    fillId: String(num(fill.id, "fill id")),
    ticker: str(order.ticker, "order ticker"),
    side,
    status: str(order.status, "order status"),
    quantity: Math.abs(num(fill.quantity, "fill quantity")),
    price: num(fill.price, "fill price"),
    filledAt: str(fill.filledAt, "fill filledAt"),
    walletCurrency: str(wallet.currency, "fill wallet currency"),
    netValue: num(wallet.netValue, "fill netValue"),
    fees,
  };
}
