import type { Bucket } from "@finance-app/shared";
import type { CashBalance, HistoryEntry, Position, Provider } from "../provider.js";

/**
 * The sample holdings from the design handover, with one correction: the
 * prototype's activity feed had ISA money buying Rolls-Royce, but Rolls-Royce
 * sits in Handpicked (the Invest account). Money never crosses pots, in
 * fixtures any more than in real life (CLAUDE.md hard line 11).
 */
const POSITIONS: Record<Bucket, Position[]> = {
  Base: [
    {
      id: "vanguard-ftse-global-all-cap",
      name: "Vanguard FTSE Global All Cap",
      ticker: "VAFTGAG",
      subtitle: "A slice of nearly everything",
      quantity: 2348,
      averagePrice: 200,
      value: 512_000,
    },
    {
      id: "vanguard-sp-500",
      name: "Vanguard S&P 500 (VUAG)",
      ticker: "VUAG",
      subtitle: "The 500 biggest US companies",
      quantity: 23.1,
      averagePrice: 8_490,
      value: 218_000,
    },
    {
      id: "cash-waiting",
      name: "Cash, waiting",
      ticker: "GBP",
      subtitle: "Next month's buy",
      quantity: 940,
      averagePrice: 100,
      value: 94_000,
    },
  ],
  Medium: [
    {
      id: "nvidia",
      name: "Nvidia",
      ticker: "NVDA",
      subtitle: "Chips for AI",
      quantity: 5.04,
      averagePrice: 11_520,
      value: 72_000,
    },
    {
      id: "apple",
      name: "Apple",
      ticker: "AAPL",
      subtitle: "Phones, laptops",
      quantity: 3.05,
      averagePrice: 17_310,
      value: 56_000,
    },
    {
      id: "asml",
      name: "ASML",
      ticker: "ASML",
      subtitle: "Machines that make chips",
      quantity: 0.7,
      averagePrice: 63_090,
      value: 43_000,
    },
    {
      id: "greggs",
      name: "Greggs",
      ticker: "GRG",
      subtitle: "Sausage rolls",
      quantity: 15.4,
      averagePrice: 2_420,
      value: 38_000,
    },
    {
      id: "rolls-royce",
      name: "Rolls-Royce",
      ticker: "RR",
      subtitle: "Aero engines",
      quantity: 53.9,
      averagePrice: 521,
      value: 32_000,
    },
  ],
  Degen: [
    {
      id: "bitcoin",
      name: "Bitcoin",
      ticker: "BTC",
      subtitle: "The big one",
      quantity: 0.0088,
      averagePrice: 3_022_727,
      value: 43_000,
    },
    {
      id: "ethereum",
      name: "Ethereum",
      ticker: "ETH",
      subtitle: "The second one",
      quantity: 0.103,
      averagePrice: 163_106,
      value: 22_000,
    },
    {
      id: "solana",
      name: "Solana",
      ticker: "SOL",
      subtitle: "A faster, riskier one",
      quantity: 1.1,
      averagePrice: 13_432,
      value: 13_000,
    },
  ],
};

const CASH: Record<Bucket, CashBalance> = {
  Base: { currency: "GBP", amount: 94_000 },
  Medium: { currency: "GBP", amount: 0 },
  Degen: { currency: "GBP", amount: 0 },
};

// Declared before HISTORY on purpose: HISTORY is built at module load, and a
// const read before its own initialiser throws rather than reading undefined.
const MONTHS = ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"];

/** Six months of "money in", matching the design's bar chart. */
const HISTORY: Record<Bucket, HistoryEntry[]> = {
  Base: monthlyDeposits([14_000, 14_000, 14_000, 14_000, 14_000, 14_000]),
  Medium: monthlyDeposits([5_000, 5_000, 5_000, 6_000, 5_000, 5_000]),
  // Nothing new since June: the pot reached the line its owner set.
  Degen: monthlyDeposits([1_000, 1_000, 1_000, 0, 0, 0]),
};

function monthlyDeposits(amounts: number[]): HistoryEntry[] {
  return amounts.map((amount, index) => ({
    date: MONTHS[index]!,
    type: "deposit" as const,
    amount,
  }));
}

export class StubProvider implements Provider {
  constructor(public readonly bucket: Bucket) {}

  async getPositions(): Promise<Position[]> {
    return POSITIONS[this.bucket].map((position) => ({ ...position }));
  }

  async getCash(): Promise<CashBalance> {
    return { ...CASH[this.bucket] };
  }

  async getHistory(): Promise<HistoryEntry[]> {
    return HISTORY[this.bucket].map((entry) => ({ ...entry }));
  }
}

/** Every holding across every pot, for instrument lookup by id. */
export function allStubPositions(): { bucket: Bucket; position: Position }[] {
  return (Object.keys(POSITIONS) as Bucket[]).flatMap((bucket) =>
    POSITIONS[bucket].map((position) => ({ bucket, position: { ...position } })),
  );
}
