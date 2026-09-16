import {
  BUCKET_META,
  displayNameFor,
  type Bucket,
  type Pence,
  type Percent,
} from "@finance-app/shared";
import { formatPercent, formatPounds } from "../lib/format";
import { shadeFor } from "./shades";

const RADIUS = 46;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Each pot's identity colour, which a pot scope must not change. */
const SEED_COLOUR = {
  fnd: "var(--pip-seed-fnd)",
  pick: "var(--pip-seed-pick)",
  bet: "var(--pip-seed-bet)",
} as const;

export interface AllocationSlice {
  bucket: Bucket;
  percent: Percent;
  /** When given, the money is shown before the share — pounds before percent. */
  amount?: Pence;
}

/**
 * How the whole splits across the three pots. The target is stated in words
 * underneath — never drawn as a second, fainter ring (DESIGN.md §7).
 */
export function AllocationRing({
  slices,
  targetSentence,
  centre,
  size = 112,
}: {
  slices: AllocationSlice[];
  targetSentence: string;
  centre?: { value: string; caption: string };
  size?: number;
}) {
  let travelled = 0;
  const arcs = slices.map((slice) => {
    const length = (slice.percent / 100) * CIRCUMFERENCE;
    const arc = {
      slice,
      dasharray: `${length.toFixed(1)} ${CIRCUMFERENCE.toFixed(1)}`,
      dashoffset: (-travelled).toFixed(1),
    };
    travelled += length;
    return arc;
  });

  const description = slices
    .map((slice) => `${displayNameFor(slice.bucket)} ${formatPercent(slice.percent)}`)
    .join(", ");

  return (
    <div className="flex items-center gap-5">
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        role="img"
        aria-label={`How it splits: ${description}`}
        className="flex-none"
      >
        <circle cx={60} cy={60} r={RADIUS} fill="none" className="stroke-sunk" strokeWidth={14} />
        <g transform="rotate(-90 60 60)">
          {arcs.map(({ slice, dasharray, dashoffset }) => (
            <circle
              key={slice.bucket}
              cx={60}
              cy={60}
              r={RADIUS}
              fill="none"
              strokeWidth={14}
              strokeDasharray={dasharray}
              strokeDashoffset={dashoffset}
              style={{ stroke: SEED_COLOUR[BUCKET_META[slice.bucket].scope] }}
              data-bucket={slice.bucket}
            />
          ))}
        </g>
        {centre ? (
          <>
            <text x={60} y={56} textAnchor="middle" className="font-heading fill-ink" fontSize={21}>
              {centre.value}
            </text>
            <text
              x={60}
              y={72}
              textAnchor="middle"
              className="fill-ink2"
              fontSize={9.5}
              fontWeight={700}
            >
              {centre.caption}
            </text>
          </>
        ) : null}
      </svg>

      <div className="flex flex-1 flex-col gap-2">
        {slices.map((slice) => (
          <div key={slice.bucket} className="flex items-center gap-2 text-[12.5px]">
            <span
              aria-hidden
              className="h-[9px] w-[9px] flex-none rounded-full"
              style={{ backgroundColor: SEED_COLOUR[BUCKET_META[slice.bucket].scope] }}
            />
            <span className="flex-1 font-semibold">{displayNameFor(slice.bucket)}</span>
            <span className="font-bold">
              {slice.amount !== undefined ? (
                <>
                  {formatPounds(slice.amount, { whole: true })}
                  <span className="text-ink3 font-semibold"> · </span>
                </>
              ) : null}
              {formatPercent(slice.percent)}
            </span>
          </div>
        ))}
        <p className="text-ink2 m-0 text-[11.5px] leading-snug font-medium">{targetSentence}</p>
      </div>
    </div>
  );
}

/** What's inside one pot, as one bar. Shades of the pot's own accent. */
export function StackedBar({
  segments,
}: {
  segments: { id: string; label: string; percent: Percent }[];
}) {
  return (
    <div
      role="img"
      aria-label={segments.map((s) => `${s.label} ${formatPercent(s.percent)}`).join(", ")}
      className="flex h-[11px] gap-0.5 overflow-hidden rounded-full"
    >
      {segments.map((segment, index) => (
        <div
          key={segment.id}
          className="bg-acc"
          style={{ width: `${segment.percent}%`, opacity: shadeFor(index) }}
        />
      ))}
    </div>
  );
}
