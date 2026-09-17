/**
 * The shape a user sets (Phase 4, changed in Phase 6). One number is chosen —
 * Handpicked's target — and Foundation is the rest, so the shape adds up to
 * 100. Side Bet is not in the shape at all: it has a limit in pounds instead
 * (`notifications.ts`, the FCA's 10% guide), because a percentage of a total
 * that moves with prices flickers, and because the limit is about how much of
 * your own money you have put at risk. The limits live here so the API (which
 * enforces them) and the web app (which shows them) can't disagree.
 */

/** Whole percent. */
export interface RuleSettings {
  handpickedTarget: number;
}

export const DEFAULT_RULES: RuleSettings = { handpickedTarget: 25 };

/** A pot this many percentage points or more from its target has drifted. */
export const DRIFT_THRESHOLD_POINTS = 5;
