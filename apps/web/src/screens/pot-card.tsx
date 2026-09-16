import { BUCKET_META, displayNameFor, type BucketSummary } from "@finance-app/shared";
import { Link } from "react-router";
import { ProgressCapBar } from "../components/progress-cap-bar";
import { Sparkline } from "../components/sparkline";
import { changeTone, formatPounds, formatSignedPounds } from "../lib/format";

/**
 * One pot, tappable into its detail. Side Bet is always fenced — hatch and a
 * hard border — so it can never be mistaken for the safe money (DESIGN.md §2).
 */
export function PotCard({
  pot,
  when,
  size = "phone",
}: {
  pot: BucketSummary;
  when: string;
  size?: "phone" | "desktop";
}) {
  const { scope } = BUCKET_META[pot.bucket];
  const isSideBet = scope === "bet";

  return (
    <Link
      to={`/pots/${pot.bucket}`}
      data-pot={pot.bucket}
      className={`pot-${scope} bg-card text-ink flex flex-col gap-3.5 rounded-[26px] border-[1.5px] px-5 py-[18px] no-underline ${
        isSideBet ? "border-acc hatch" : "border-transparent"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span aria-hidden className="bg-acc h-[11px] w-[11px] flex-none rounded-full" />
            <span className="font-heading text-xl tracking-[-0.01em]">
              {displayNameFor(pot.bucket)}
            </span>
          </div>
          <div className="text-ink2 max-w-[190px] text-xs leading-snug">{pot.blurb}</div>
        </div>

        <div className="flex-none text-right">
          <div
            className={`font-heading tracking-[-0.015em] ${size === "desktop" ? "text-[32px]" : "text-2xl"}`}
          >
            {formatPounds(pot.value, { whole: true })}
          </div>
          <div className={`mt-0.5 text-[13.5px] font-bold ${changeTone(pot.change)}`}>
            {formatSignedPounds(pot.change.amount)} · {when}
          </div>
          <div className="mt-1.5 flex justify-end">
            <Sparkline series={pot.series} />
          </div>
        </div>
      </div>

      <ProgressCapBar
        label="Share of your money"
        actualPercent={pot.shareOfTotal}
        targetPercent={pot.targetPercent}
        kind={isSideBet ? "cap" : "target"}
      />
    </Link>
  );
}

/** Tablet buys air, not density: each pot compresses to a single row (DESIGN.md §8). */
export function PotRow({ pot, when }: { pot: BucketSummary; when: string }) {
  const { scope } = BUCKET_META[pot.bucket];
  const isSideBet = scope === "bet";

  return (
    <Link
      to={`/pots/${pot.bucket}`}
      data-pot={pot.bucket}
      className={`pot-${scope} bg-card text-ink flex items-center gap-3.5 rounded-[22px] border-[1.5px] px-[18px] py-[15px] no-underline ${
        isSideBet ? "border-acc hatch" : "border-transparent"
      }`}
    >
      <span aria-hidden className="bg-acc h-[11px] w-[11px] flex-none rounded-full" />
      <span className="font-heading flex-1 text-lg">{displayNameFor(pot.bucket)}</span>
      <span className="font-heading text-[21px]">{formatPounds(pot.value, { whole: true })}</span>
      <span
        className={`min-w-[110px] text-right text-[12.5px] font-bold ${changeTone(pot.change)}`}
      >
        {formatSignedPounds(pot.change.amount)} · {when}
      </span>
    </Link>
  );
}
