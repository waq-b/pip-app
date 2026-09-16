import type {
  ActivityEntry,
  Bucket,
  BucketDetail,
  InstrumentDetail,
  PortfolioSummary,
  PriceRange,
  RulesView,
  Timeframe,
} from "@finance-app/shared";

/** The signed-in person a read is for. */
export interface ReadUser {
  /** Allowlist row id. */
  userId: string;
  /** Verified Supabase id — reads run as this user, so RLS applies. */
  authUserId: string;
}

/**
 * Everything the screens read, in one interface with two implementations:
 * the design's sample data (`stub.ts`) and real accounts valued with market
 * data (`live.ts`). Routes don't know which they have.
 */
export interface ReadModel {
  portfolio(user: ReadUser, timeframe: Timeframe): Promise<PortfolioSummary>;
  bucket(user: ReadUser, bucket: Bucket, timeframe: Timeframe): Promise<BucketDetail>;
  /** Null when the user doesn't hold it — a 404. */
  instrument(user: ReadUser, id: string, range: PriceRange): Promise<InstrumentDetail | null>;
  rules(user: ReadUser): Promise<RulesView>;
  activity(user: ReadUser): Promise<ActivityEntry[]>;
}
