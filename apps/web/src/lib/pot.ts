import { BUCKETS, type Bucket, type BucketDetail } from "@finance-app/shared";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";

/** A pot id from the URL, or undefined if it isn't one. Display names don't count. */
export function parseBucket(value: string | undefined): Bucket | undefined {
  return BUCKETS.find((bucket) => bucket === value);
}

export function useBucketDetail(bucket: Bucket | undefined) {
  return useQuery({
    queryKey: ["bucket", bucket],
    queryFn: () => apiGet<BucketDetail>(`/buckets/${bucket}`),
    enabled: bucket !== undefined,
  });
}
