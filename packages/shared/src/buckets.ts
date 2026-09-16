export const BUCKETS = ["Base", "Medium", "Degen"] as const;

export type Bucket = (typeof BUCKETS)[number];

/**
 * The accent scope a pot paints itself with (DESIGN.md §3). The scope name is
 * what the theme keys off; it is not a colour value, so nothing here needs
 * changing if the palette does.
 */
export type BucketScope = "fnd" | "pick" | "bet";

export interface BucketMeta {
  /**
   * What the UI calls this pot. The internal ids (Base/Medium/Degen) never
   * reach a screen, and the display names never reach the API or the database.
   */
  displayName: string;
  scope: BucketScope;
  /**
   * Named in the read-only footer: "To buy or sell, use {provider} — Pip just
   * keeps score."
   */
  provider: string;
}

export const BUCKET_META: Record<Bucket, BucketMeta> = {
  Base: { displayName: "Foundation", scope: "fnd", provider: "Trading 212" },
  Medium: { displayName: "Handpicked", scope: "pick", provider: "Trading 212" },
  Degen: { displayName: "Side Bet", scope: "bet", provider: "Kraken" },
};

export function displayNameFor(bucket: Bucket): string {
  return BUCKET_META[bucket].displayName;
}
