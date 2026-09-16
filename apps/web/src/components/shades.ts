/**
 * Holdings inside one pot are shades of that pot's accent. Opacity steps rather
 * than extra colours keep them scope-aware — the same component shades sage in
 * Foundation and clay in Side Bet, and none of it needs a hex value.
 *
 * Its own module so the component files export components only, which keeps
 * fast refresh working.
 */
const SHADE_STEPS = [1, 0.75, 0.55, 0.4, 0.28];

export function shadeFor(index: number): number {
  return SHADE_STEPS[Math.min(index, SHADE_STEPS.length - 1)]!;
}
