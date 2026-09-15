export const BUCKETS = ["Base", "Medium", "Degen"] as const;

export type Bucket = (typeof BUCKETS)[number];
