import { BUCKET_META, type ActivityEntry, type ActivityKind } from "@finance-app/shared";

const GLYPH: Record<ActivityKind, string> = {
  money_in: "↓",
  up: "↑",
  down: "↓",
  alert: "!",
  milestone: "★",
};

/**
 * What changed, in plain English. Each entry wears its own pot's colour, and
 * the list ends by saying it has ended — silence is a result (DESIGN.md §4.3).
 */
export function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  return (
    <div className="bg-card rounded-[26px] px-[18px] pt-0.5 pb-1.5">
      <ul className="m-0 list-none p-0">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className={`pot-${BUCKET_META[entry.bucket].scope} border-line flex items-start gap-3 border-b py-[15px]`}
          >
            <span
              aria-hidden
              className="bg-tint text-aink grid h-8 w-8 flex-none place-items-center rounded-full text-[15px] font-extrabold"
            >
              {GLYPH[entry.kind]}
            </span>
            <div className="min-w-0">
              <div className="text-sm leading-snug font-medium">{entry.text}</div>
              <div className="text-ink3 mt-0.5 text-[11.5px] font-medium">{entry.when}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-ink2 m-0 py-4 text-center text-[13px] font-medium">
        {entries.length === 0 ? "Nothing changed. Quiet week." : "That's the lot. Quiet week."}
      </p>
    </div>
  );
}
