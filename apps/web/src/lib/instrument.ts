import type { InstrumentDetail, Pence, PriceRange, SeriesPoint } from "@finance-app/shared";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";
import { formatPounds } from "./format";

/** The instrument chart's range pills (DESIGN.md §7). */
export const RANGES: { id: PriceRange; label: string; period: string }[] = [
  { id: "day", label: "Day", period: "today" },
  { id: "month", label: "Month", period: "over the last month" },
  { id: "year", label: "Year", period: "over the last year" },
  { id: "all", label: "All", period: "since you bought" },
];

export function useInstrument(id: string | undefined, range: PriceRange) {
  return useQuery({
    queryKey: ["instrument", id, range],
    queryFn: () =>
      apiGet<InstrumentDetail>(`/instruments/${encodeURIComponent(id!)}?range=${range}`),
    enabled: id !== undefined,
    // Changing range keeps the last chart up until the new one lands.
    placeholderData: (previous) => previous,
  });
}

/**
 * No chart without a sentence (DESIGN.md §4.4), and the API sends none for a
 * price chart — so say what the price did, in pounds: "The price went from
 * £118.20 to £142.80 over the last month."
 */
export function priceCaption(series: SeriesPoint[], range: PriceRange): string {
  const period = RANGES.find((entry) => entry.id === range)!.period;
  const first = series[0]?.value;
  const last = series[series.length - 1]?.value;
  if (first === undefined || last === undefined) return "";

  if (first === last) return `The price is where it started, ${period}.`;
  return `The price went from ${pounds(first)} to ${pounds(last)} ${period}.`;
}

/** The label under the chart's left edge. */
export function rangeStartLabel(series: SeriesPoint[], range: PriceRange): string {
  if (range === "day") return "This morning";
  if (range === "all") return "Since you bought";

  const first = series[0];
  if (!first) return "";

  const date = new Date(first.at);
  const month = MONTHS[date.getUTCMonth()]!;
  return range === "month" ? `${date.getUTCDate()} ${month}` : `${month} ${date.getUTCFullYear()}`;
}

/**
 * Fixed names rather than `toLocaleDateString`: ICU versions disagree on
 * September ("Sep" vs "Sept"), so the same date could read differently in a
 * browser, in CI and in tests. The design uses three letters.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pounds(amount: Pence): string {
  return formatPounds(amount);
}
