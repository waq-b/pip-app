import type { Pence, Percent, RuleKind } from "@finance-app/shared";
import { formatPercent, formatPounds } from "../lib/format";
import { NotAdviceLabel } from "./not-advice-label";

export interface ProgressCapBarProps {
  label: string;
  actualPercent: Percent;
  targetPercent: Percent;
  kind: RuleKind;
  /**
   * What the bar's full width represents. A target reads naturally against
   * 100%; a 5% cap would be an invisible sliver on that scale, so Side Bet
   * passes something closer to its own size.
   */
  scaleMax?: Percent;
  /** When a cap is breached, how far over in money — pounds before percent. */
  overByAmount?: Pence;
}

/**
 * Where you are against a line you set. The fill is where you are, the ink tick
 * is your line. Over a cap, the track picks up the Side Bet hatch and the figure
 * turns red — the only red in the app (DESIGN.md §7).
 */
export function ProgressCapBar({
  label,
  actualPercent,
  targetPercent,
  kind,
  scaleMax = 100,
  overByAmount,
}: ProgressCapBarProps) {
  const isOver = kind === "cap" && actualPercent > targetPercent;
  const fill = clamp((actualPercent / scaleMax) * 100);
  const tick = clamp((targetPercent / scaleMax) * 100);

  const overBy = actualPercent - targetPercent;
  const figure = isOver
    ? `${formatPercent(actualPercent)} · ${formatPercent(overBy)} over cap${
        overByAmount ? ` · ${formatPounds(overByAmount, { whole: true })}` : ""
      }`
    : `${formatPercent(actualPercent)} · ${kind === "cap" ? "cap" : "target"} ${formatPercent(targetPercent)}`;

  return (
    <div>
      <div className="mb-2 flex justify-between text-xs font-semibold">
        <span>{label}</span>
        <span className={isOver ? "text-dn font-bold" : "text-ink2"}>{figure}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={actualPercent}
        aria-valuemin={0}
        aria-valuemax={scaleMax}
        className={`bg-sunk relative h-[9px] rounded-full ${isOver ? "hatch" : ""}`}
        data-over={isOver || undefined}
      >
        <div
          className="bg-acc absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${fill}%` }}
        />
        <div
          aria-hidden
          className="bg-ink absolute -inset-y-1 w-0.5 rounded-sm"
          style={{ left: `${tick}%` }}
        />
      </div>
      {isOver ? (
        <div className="mt-2">
          <NotAdviceLabel />
        </div>
      ) : null}
    </div>
  );
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}
