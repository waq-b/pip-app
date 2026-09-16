import { useEffect, useState } from "react";

/**
 * The handover's two breakpoints (DESIGN.md §8): the tab bar becomes a rail at
 * 768, and the rail becomes a labelled sidebar at 1120.
 */
export const RAIL_MIN_WIDTH = 768;
export const DESK_MIN_WIDTH = 1120;

export type Breakpoint = "phone" | "tablet" | "desktop";

export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(() => currentBreakpoint());

  useEffect(() => {
    const queries = [
      safeMatchMedia(`(min-width: ${RAIL_MIN_WIDTH}px)`),
      safeMatchMedia(`(min-width: ${DESK_MIN_WIDTH}px)`),
    ];
    const update = () => setBreakpoint(currentBreakpoint());

    for (const query of queries) query?.addEventListener("change", update);
    update();

    return () => {
      for (const query of queries) query?.removeEventListener("change", update);
    };
  }, []);

  return breakpoint;
}

export function currentBreakpoint(): Breakpoint {
  if (safeMatchMedia(`(min-width: ${DESK_MIN_WIDTH}px)`)?.matches) return "desktop";
  if (safeMatchMedia(`(min-width: ${RAIL_MIN_WIDTH}px)`)?.matches) return "tablet";
  return "phone";
}

/** Phone is the reference frame, so an environment without matchMedia gets it. */
function safeMatchMedia(query: string): MediaQueryList | undefined {
  try {
    return window.matchMedia(query);
  } catch {
    return undefined;
  }
}
