import type { SeriesPoint } from "@finance-app/shared";
import { straightPath } from "./chart-geometry";

/**
 * The shape of the trend at a glance. No axes, no numbers, never tappable on
 * its own — it's punctuation next to a figure, not a chart (DESIGN.md §7), so
 * it's hidden from assistive tech: the figure beside it carries the meaning.
 */
export function Sparkline({
  series,
  width = 62,
  height = 20,
  strokeWidth = 2,
}: {
  series: SeriesPoint[];
  width?: number;
  height?: number;
  strokeWidth?: number;
}) {
  // One point is not a trend, so draw nothing rather than a dot pretending.
  if (series.length < 2) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden
      className="flex-none overflow-visible"
      data-sparkline
    >
      <path
        d={straightPath(
          series.map((point) => point.value),
          width,
          height,
        )}
        className="stroke-acc"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
