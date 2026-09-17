import { BUCKET_META, type NudgeView } from "@finance-app/shared";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { Skeleton } from "../components/skeleton";
import { useWeek } from "../lib/week";
import { ICON_STROKE } from "../shell/nav";

const GLYPH: Record<NudgeView["kind"], string> = {
  none: "✓",
  shape: "!",
  calendar: "◷",
  awareness: "↗",
};

/**
 * Your week on Pots, in the slot the design gives "What changed" (Phase 5 Q4).
 * Rows are the design's glyph · text · when, ending with its own "That's the
 * lot." — a quiet week reads as a result, not an empty state (DESIGN.md §4.3).
 * The whole card opens the week.
 */
export function WeekCard() {
  const week = useWeek();

  return (
    <section>
      <div className="mb-[11px] flex items-center justify-between">
        <h2 className="font-heading m-0 text-[19px] font-normal">Your week</h2>
        <span className="text-ink2 text-xs font-medium">
          {week.data?.week ? "This week" : "Every Monday"}
        </span>
      </div>
      {week.isPending ? (
        <Skeleton height={180} rounded="rounded-[26px]" />
      ) : week.isError ? (
        <p className="bg-card text-ink2 m-0 rounded-[26px] px-5 py-4 text-[13px] font-medium">
          Couldn't load your week. Everything above is still current.
        </p>
      ) : !week.data.week ? (
        <p className="bg-card text-ink2 m-0 rounded-[26px] px-5 py-4 text-[13px] leading-normal font-medium">
          Your first week arrives on Monday morning, by 8am.
        </p>
      ) : (
        <Link
          to="/week"
          className="bg-card text-ink block rounded-[26px] px-[18px] pt-0.5 pb-1.5 no-underline"
        >
          <ul className="m-0 list-none p-0">
            {[...week.data.today, ...week.data.week.nudges].map((nudge) => {
              const scope = nudge.bucket ? `pot-${BUCKET_META[nudge.bucket].scope}` : "";
              return (
                <li
                  key={nudge.id}
                  className={`${scope} border-line flex items-start gap-3 border-b py-[15px]`}
                >
                  <span
                    aria-hidden
                    className="bg-tint text-aink grid h-8 w-8 flex-none place-items-center rounded-full text-[15px] font-extrabold"
                  >
                    {GLYPH[nudge.kind]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm leading-snug font-medium">{nudge.title}</div>
                    <div className="text-ink3 mt-0.5 text-[11.5px] font-medium">
                      {nudge.cadence === "daily"
                        ? "Today"
                        : nudge.kind === "none"
                          ? nudge.body
                          : "This week"}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-ink2 m-0 flex items-center justify-center gap-1 py-4 text-center text-[13px] font-medium">
            {week.data.week.nudges.some((n) => n.kind === "none")
              ? "That's the lot. Quiet week."
              : "That's the lot."}
            <ChevronRight size={15} strokeWidth={ICON_STROKE} aria-hidden />
          </p>
        </Link>
      )}
    </section>
  );
}
