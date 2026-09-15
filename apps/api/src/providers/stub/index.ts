import type { Bucket } from "@finance-app/shared";
import type { CashBalance, HistoryEntry, Position, Provider } from "../provider.js";

const FAKE_POSITIONS: Record<Bucket, Position[]> = {
  Base: [{ symbol: "VWRP.L", quantity: 42, averagePrice: 98.5 }],
  Medium: [{ symbol: "AAPL", quantity: 3, averagePrice: 172.1 }],
  Degen: [{ symbol: "BTC", quantity: 0.01, averagePrice: 52000 }],
};

const FAKE_CASH: Record<Bucket, CashBalance> = {
  Base: { currency: "GBP", amount: 120.5 },
  Medium: { currency: "GBP", amount: 45.0 },
  Degen: { currency: "GBP", amount: 10.0 },
};

export class StubProvider implements Provider {
  constructor(public readonly bucket: Bucket) {}

  async getPositions(): Promise<Position[]> {
    return [...FAKE_POSITIONS[this.bucket]];
  }

  async getCash(): Promise<CashBalance> {
    return { ...FAKE_CASH[this.bucket] };
  }

  async getHistory(): Promise<HistoryEntry[]> {
    return [{ date: "2026-09-01", type: "deposit", amount: 100 }];
  }
}
