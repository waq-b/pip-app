import type { Breakpoint } from "./use-breakpoint";

/**
 * Copy shifts with the pointer (DESIGN.md §8): "Tap any holding" becomes
 * "Click any holding", and "took your phone" becomes "took your laptop". The
 * screens read these rather than hard-coding either word.
 */
export interface PointerWords {
  /** "tap" or "click". */
  verb: string;
  /** Sentence-initial form. */
  Verb: string;
  /** What appearance follows: "your phone" or "your computer". */
  device: string;
  /** What someone could pick up: "your phone" or "your laptop". */
  carried: string;
}

export function pointerWords(breakpoint: Breakpoint): PointerWords {
  if (breakpoint === "phone") {
    return { verb: "tap", Verb: "Tap", device: "your phone", carried: "your phone" };
  }

  return { verb: "click", Verb: "Click", device: "your computer", carried: "your laptop" };
}
