import type { SeriesPoint } from "@finance-app/shared";
import { useId, type ReactNode } from "react";
import { areaPath, smoothPath } from "./chart-geometry";

const WIDTH = 320;
const HEIGHT = 120;

export interface LineChartProps {
  series: SeriesPoint[];
  /**
   * Required, because there is no chart without a sentence (DESIGN.md §4.4).
   * It is also the chart's accessible description.
   */
  caption: string;
  from: string;
  to?: string;
  /** 120 on a phone; the desktop layouts draw it taller. */
  height?: number;
  /** Shown instead of the drawing when there isn't enough history to draw. */
  emptyMessage?: string;
  /** The provenance line, which every chart carries. */
  footer?: ReactNode;
}

/**
 * Value or price over a chosen span. No gridlines and no y-axis: the caption
 * says in words what the line did.
 */
export function LineChart({
  series,
  caption,
  from,
  to = "Today",
  height = 120,
  emptyMessage = "Can't draw the chart right now",
  footer,
}: LineChartProps) {
  // Two charts on one screen must not share a gradient, or the second one
  // silently paints with the first one's colour.
  const gradientId = `pip-fill-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const values = series.map((point) => point.value);
  const canDraw = values.length >= 2;

  return (
    <figure className="m-0">
      {canDraw ? (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          width="100%"
          height={height}
          preserveAspectRatio="none"
          role="img"
          aria-label={caption}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--pip-acc)", stopOpacity: 0.42 }} />
              <stop offset="100%" style={{ stopColor: "var(--pip-acc)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <path d={areaPath(values, WIDTH, HEIGHT)} fill={`url(#${gradientId})`} />
          <path
            d={smoothPath(values, WIDTH, HEIGHT)}
            fill="none"
            className="stroke-acc"
            strokeWidth={2.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            // The drawing stretches to fill its width; the line shouldn't thin
            // or thicken with it.
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : (
        <div
          className="bg-sunk text-ink2 grid place-items-center rounded-[14px] px-4 text-center text-[12.5px] leading-snug font-semibold"
          style={{ height }}
        >
          {emptyMessage}
        </div>
      )}

      {canDraw ? (
        <div className="text-ink3 mt-1 flex justify-between text-[11px] font-semibold">
          <span>{from}</span>
          <span>{to}</span>
        </div>
      ) : null}

      <figcaption className="text-ink2 mt-2.5 text-[12.5px] leading-normal">{caption}</figcaption>

      {footer ? <div className="mt-3">{footer}</div> : null}
    </figure>
  );
}
