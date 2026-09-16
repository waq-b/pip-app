/**
 * The mark, in code rather than as an imported asset so it can pick its own cut
 * (DESIGN.md §3): below 48px the radii compress and the centres push out, or
 * the third seed dissolves. The SVG files remain the source of truth for
 * favicons and app icons.
 */
const STANDARD = [
  { cx: 19, cy: 20, r: 13, fill: "#7a8a5e" },
  { cx: 36.5, cy: 25, r: 10, fill: "#c67139" },
  { cx: 27, cy: 41.5, r: 6.5, fill: "#c0392c" },
];

const SMALL = [
  { cx: 18, cy: 19, r: 13.5, fill: "#7a8a5e" },
  { cx: 38, cy: 24.5, r: 11.5, fill: "#c67139" },
  { cx: 27, cy: 43, r: 9, fill: "#c0392c" },
];

export const SMALL_CUT_BELOW = 48;

export function PipMark({ size = 56, className }: { size?: number; className?: string }) {
  const seeds = size < SMALL_CUT_BELOW ? SMALL : STANDARD;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      className={className}
      role="img"
      aria-label="Pip"
    >
      {seeds.map((seed) => (
        <circle key={seed.fill} cx={seed.cx} cy={seed.cy} r={seed.r} fill={seed.fill} />
      ))}
    </svg>
  );
}
