import type { RuleSettings } from "@finance-app/shared";

/**
 * Checking a shape someone asks for. The API enforces the limits — never the
 * screen (hard line 11) — so this runs on every save, whatever sent it.
 *
 * Since Phase 6 the shape is one number: Handpicked's target, with Foundation
 * the rest. Side Bet isn't in the shape — it has a limit in pounds, which
 * follows from net assets and can't be typed in here.
 */

export type RuleSettingsError = "whole_numbers_needed" | "target_out_of_range";

export function parseRuleSettings(
  body: unknown,
): { ok: true; settings: RuleSettings } | { ok: false; error: RuleSettingsError } {
  const input = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const { handpickedTarget } = input;
  if (!Number.isInteger(handpickedTarget)) return { ok: false, error: "whole_numbers_needed" };
  const target = handpickedTarget as number;
  // Foundation is the remainder, so it can't go below nothing.
  if (target < 0 || target > 100) return { ok: false, error: "target_out_of_range" };
  return { ok: true, settings: { handpickedTarget: target } };
}
