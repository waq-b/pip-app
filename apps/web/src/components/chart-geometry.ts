/**
 * Pure path maths for the hand-rolled charts (DESIGN.md §7: no chart library).
 * Kept apart from the components so the awkward cases — a flat series, a single
 * point — are tested once, here.
 */

/** Maps values into the drawable height, highest value nearest the top. */
export function normalise(
  values: number[],
  height: number,
  padTop: number,
  padBottom: number,
): number[] {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low;
  const usable = height - padTop - padBottom;

  // A flat series has no span to divide by; draw it level through the middle
  // rather than producing NaN.
  return values.map((value) =>
    span === 0 ? padTop + usable / 2 : padTop + (1 - (value - low) / span) * usable,
  );
}

export function spread(count: number, width: number): number[] {
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, index) => (index / (count - 1)) * width);
}

const round = (value: number) => Math.round(value * 10) / 10;

/** Straight segments — the sparkline is punctuation, not a curve. */
export function straightPath(values: number[], width: number, height: number, pad = 2): string {
  const ys = normalise(values, height, pad, pad);
  const xs = spread(values.length, width);
  return xs.map((x, i) => `${i === 0 ? "M" : "L"}${round(x)} ${round(ys[i]!)}`).join(" ");
}

/** Midpoint cubic curves, matching the prototype's line chart. */
export function smoothPath(
  values: number[],
  width: number,
  height: number,
  padTop = 8,
  padBottom = 12,
): string {
  const ys = normalise(values, height, padTop, padBottom);
  const xs = spread(values.length, width);

  let d = `M${round(xs[0]!)} ${round(ys[0]!)}`;
  for (let i = 1; i < values.length; i++) {
    const control = round((xs[i - 1]! + xs[i]!) / 2);
    d += ` C${control} ${round(ys[i - 1]!)} ${control} ${round(ys[i]!)} ${round(xs[i]!)} ${round(ys[i]!)}`;
  }
  return d;
}

/** The same curve, closed down to the baseline so it can take the gradient fill. */
export function areaPath(values: number[], width: number, height: number): string {
  return `${smoothPath(values, width, height)} L${width} ${height} L0 ${height} Z`;
}
