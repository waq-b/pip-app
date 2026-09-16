import type { Bucket, Pence } from "@finance-app/shared";

/**
 * Trading providers answer one question: what does this user hold, and how much
 * cash (CLAUDE.md s4)? Prices and history of value come from the market layer,
 * never from here.
 *
 * `placeOrder` does not exist and must not be added before Phase 8 is
 * explicitly unparked (hard line 1).
 */
export interface Position {
  /** Stable id used in URLs and as the market-data seed. */
  id: string;
  /** What a person calls it: "Nvidia", not "NVDA". */
  name: string;
  ticker: string;
  /** Plain-English sub-line: "Chips for AI". */
  subtitle: string;
  /** Units held. Fractional shares and crypto are normal, so this is a float. */
  quantity: number;
  /** Money is integer pence everywhere, so nothing rounds in transit. */
  averagePrice: Pence;
  value: Pence;
}

export interface CashBalance {
  currency: string;
  amount: Pence;
}

export interface HistoryEntry {
  /** ISO date. */
  date: string;
  type: "deposit" | "buy";
  amount: Pence;
  /** Present on a buy: which holding the money went into. */
  instrumentId?: string;
}

export interface Provider {
  bucket: Bucket;
  getPositions(): Promise<Position[]>;
  getCash(): Promise<CashBalance>;
  getHistory(): Promise<HistoryEntry[]>;
}
