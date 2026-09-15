import type { Bucket } from "@finance-app/shared";

export interface Position {
  symbol: string;
  quantity: number;
  averagePrice: number;
}

export interface CashBalance {
  currency: string;
  amount: number;
}

export interface HistoryEntry {
  date: string;
  type: string;
  amount: number;
}

export interface Provider {
  bucket: Bucket;
  getPositions(): Promise<Position[]>;
  getCash(): Promise<CashBalance>;
  getHistory(): Promise<HistoryEntry[]>;
}
