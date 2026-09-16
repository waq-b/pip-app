/**
 * The shape a user sets (Phase 4). Two numbers are chosen — Handpicked's target
 * and Side Bet's cap — and Foundation is whatever's left, so the shape always
 * adds up to 100. The limits live here so the API (which enforces them) and the
 * web app (which shows them) can't disagree. Settings they are not.
 */

/** Whole percent. */
export interface RuleSettings {
  handpickedTarget: number;
  sideBetCap: number;
}

export const DEFAULT_RULES: RuleSettings = { handpickedTarget: 25, sideBetCap: 5 };

/** Side Bet is the small, ring-fenced pot: the API refuses a cap above this. */
export const SIDE_BET_CAP_MAX = 20;

/** Above this cap, the stepper shows a calm line about the FCA restricted-investor assumption. Blocks nothing. */
export const SIDE_BET_CAP_NOTE_ABOVE = 10;

/** A pot this many percentage points or more from its target has drifted. */
export const DRIFT_THRESHOLD_POINTS = 5;
