/**
 * The mark, in code rather than as an imported asset so it can pick its own cut
 * (DESIGN.md §3): below 48px the radii compress and the centres push out, or
 * the third seed dissolves. The SVG files remain the source of truth for
 * favicons and app icons.
 *
 * Colours are theme variables, not hex, so the mark switches to its dark-ground
 * palette with everything else.
 */
const STANDARD = [
  { cx: 19, cy: 20, r: 13, colour: "var(--pip-seed-fnd)" },
  { cx: 36.5, cy: 25, r: 10, colour: "var(--pip-seed-pick)" },
  { cx: 27, cy: 41.5, r: 6.5, colour: "var(--pip-seed-bet)" },
];

const SMALL = [
  { cx: 18, cy: 19, r: 13.5, colour: "var(--pip-seed-fnd)" },
  { cx: 38, cy: 24.5, r: 11.5, colour: "var(--pip-seed-pick)" },
  { cx: 27, cy: 43, r: 9, colour: "var(--pip-seed-bet)" },
];

export const SMALL_CUT_BELOW = 48;

export function PipMark({
  size = 56,
  className,
  outline = false,
}: {
  size?: number;
  className?: string;
  /**
   * The dashed, faded mark: three seeds not yet planted. Used where someone
   * isn't in yet, or a pot is empty (DESIGN.md §7).
   */
  outline?: boolean;
}) {
  const seeds = size < SMALL_CUT_BELOW ? SMALL : STANDARD;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      className={className}
      role="img"
      aria-label="Pip"
      opacity={outline ? 0.55 : undefined}
    >
      {seeds.map((seed) =>
        outline ? (
          <circle
            key={seed.colour}
            cx={seed.cx}
            cy={seed.cy}
            r={seed.r}
            fill="none"
            stroke={seed.colour}
            strokeWidth={2.5}
            strokeDasharray="5 4"
          />
        ) : (
          <circle key={seed.colour} cx={seed.cx} cy={seed.cy} r={seed.r} fill={seed.colour} />
        ),
      )}
    </svg>
  );
}
