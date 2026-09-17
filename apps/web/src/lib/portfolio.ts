import {
  DRIFT_THRESHOLD_POINTS,
  displayNameFor,
  type BucketSummary,
  type PortfolioSummary,
  type Timeframe,
} from "@finance-app/shared";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";

/** The home timeframe pills (DESIGN.md §7). */
export const TIMEFRAMES: { id: Timeframe; label: string; words: string }[] = [
  { id: "day", label: "Today", words: "today" },
  { id: "month", label: "This month", words: "this month" },
  { id: "all", label: "All time", words: "all time" },
];

export function usePortfolio(timeframe: Timeframe) {
  return useQuery({
    queryKey: ["portfolio", timeframe],
    queryFn: () => apiGet<PortfolioSummary>(`/portfolio?tf=${timeframe}`),
    // Switching timeframe keeps the last numbers on screen until the new ones
    // land, rather than flashing back to skeletons.
    placeholderData: (previous) => previous,
  });
}

/**
 * The target stated in words, never as a second ring (DESIGN.md §7):
 * "You asked for 70 / 25 / 5. You're at 72 / 21 / 7."
 */
export function targetSentence(buckets: BucketSummary[]): string {
  const asked = buckets.map((bucket) => Math.round(bucket.targetPercent)).join(" / ");
  const actual = buckets.map((bucket) => Math.round(bucket.shareOfTotal)).join(" / ");
  const drifted = buckets.filter((bucket) => bucket.ruleStatus === "drifted");
  const drift = drifted.length
    ? ` ${listNames(drifted.map((bucket) => displayNameFor(bucket.bucket)))} ${
        drifted.length === 1 ? "has" : "have"
      } drifted ${DRIFT_THRESHOLD_POINTS} points or more from ${drifted.length === 1 ? "its target" : "their targets"}.`
    : "";
  return `You asked for ${asked}. You're at ${actual}.${drift}`;
}

function listNames(names: string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** A first-run account has pots, but nothing in any of them yet. */
export function isEmptyPortfolio(portfolio: PortfolioSummary): boolean {
  return portfolio.total === 0 && portfolio.buckets.every((bucket) => bucket.value === 0);
}
