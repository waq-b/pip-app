import type { MonthlyContribution } from "@finance-app/shared";
import { formatPounds } from "../lib/format";

const STUB_HEIGHT = 4;

/**
 * Compare months. The value sits above each bar so nobody has to read a scale,
 * and a month with nothing in it is a stub at 40% opacity — never a gap, which
 * would read as missing data rather than as zero (DESIGN.md §7).
 */
export function BarChart({
  bars,
  caption,
  maxBarHeight = 72,
}: {
  bars: MonthlyContribution[];
  caption: string;
  maxBarHeight?: number;
}) {
  const largest = Math.max(0, ...bars.map((bar) => bar.amount));

  return (
    <figure className="m-0">
      <div role="list" className="flex items-end gap-2" style={{ height: maxBarHeight + 24 }}>
        {bars.map((bar, index) => {
          const isZero = bar.amount <= 0;
          const barHeight = isZero
            ? STUB_HEIGHT
            : Math.max(STUB_HEIGHT, (bar.amount / (largest || 1)) * maxBarHeight);
          const money = formatPounds(bar.amount, { whole: true });

          return (
            <div
              key={`${bar.label}-${index}`}
              role="listitem"
              aria-label={`${bar.label}: ${isZero ? "nothing in" : money}`}
              data-zero={isZero || undefined}
              className={`flex flex-1 flex-col items-center gap-1.5 ${isZero ? "opacity-40" : ""}`}
            >
              <span aria-hidden className="text-ink2 text-[10.5px] font-bold">
                {isZero ? "—" : money}
              </span>
              <span
                aria-hidden
                className="bg-acc w-full rounded-t-[7px]"
                style={{ height: barHeight }}
              />
            </div>
          );
        })}
      </div>

      <div aria-hidden className="mt-1.5 flex gap-2">
        {bars.map((bar, index) => (
          <span
            key={`${bar.label}-${index}`}
            className="text-ink3 flex-1 text-center text-[10.5px] font-bold"
          >
            {bar.label}
          </span>
        ))}
      </div>

      <figcaption className="text-ink2 mt-3 text-[12.5px] leading-normal font-medium">
        {caption}
      </figcaption>
    </figure>
  );
}
