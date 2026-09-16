import type { Change, Pence } from "@finance-app/shared";
import { useState } from "react";
import { changeTone, formatPercent, formatSignedPounds, splitPounds } from "../lib/format";
import { useHideNumbers } from "../lib/hide-numbers";

export interface BigNumberProps {
  /** "Everything you own", "What it's worth to you". */
  label: string;
  value: Pence;
  change?: Change;
  /** "today", "this month", "all time". */
  when?: string;
  size?: "phone" | "desktop";
}

/**
 * Answers "how much have I got". One per screen, never two (DESIGN.md §4.2).
 * The pence are set smaller so the pounds carry the weight, and the change
 * leads with money. With "Hide the numbers" on (Setup), the figures stay
 * blurred until tapped, and stay shown for as long as this number is on screen.
 */
export function BigNumber({ label, value, change, when, size = "phone" }: BigNumberProps) {
  const { whole, fraction } = splitPounds(value);
  const isDesktop = size === "desktop";
  const hideNumbers = useHideNumbers();
  const [revealed, setRevealed] = useState(false);
  const blurred = hideNumbers && !revealed;

  const figures = (
    <div>
      <div className="mt-1 flex items-baseline gap-2">
        <span
          className={`font-heading leading-none ${
            isDesktop ? "text-[72px] tracking-[-0.03em]" : "text-[47px] tracking-[-0.025em]"
          }`}
        >
          {whole}
        </span>
        <span className={`text-ink2 font-bold ${isDesktop ? "text-2xl" : "text-base"}`}>
          {fraction}
        </span>
      </div>
      {change ? (
        <div className={`mt-2 font-semibold ${isDesktop ? "text-[15px]" : "text-sm"}`}>
          <span className={changeTone(change)}>{formatSignedPounds(change.amount)}</span>{" "}
          <span className="text-ink3 font-medium">
            · {formatPercent(change.percent, { signed: true })}
            {when ? ` · ${when}` : ""}
          </span>
        </div>
      ) : null}
    </div>
  );

  return (
    <div>
      <div className="text-ink2 text-[12.5px] font-medium">{label}</div>
      {blurred ? (
        <button
          type="button"
          aria-label="Show the numbers"
          onClick={() => setRevealed(true)}
          className="text-ink block cursor-pointer border-0 bg-transparent p-0 text-left"
        >
          <div aria-hidden className="blur-[10px] select-none">
            {figures}
          </div>
        </button>
      ) : (
        figures
      )}
    </div>
  );
}
