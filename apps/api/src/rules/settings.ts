import { SIDE_BET_CAP_MAX, type RuleSettings } from "@finance-app/shared";

/**
 * Checking a shape someone asks for. The API enforces the limits — never the
 * screen (hard line 11) — so this runs on every save, whatever sent it.
 */

export type RuleSettingsError =
  "whole_numbers_needed" | "cap_out_of_range" | "target_out_of_range" | "shape_over_100";

export function parseRuleSettings(
  body: unknown,
): { ok: true; settings: RuleSettings } | { ok: false; error: RuleSettingsError } {
  const input = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const { handpickedTarget, sideBetCap } = input;
  if (!Number.isInteger(handpickedTarget) || !Number.isInteger(sideBetCap)) {
    return { ok: false, error: "whole_numbers_needed" };
  }
  const target = handpickedTarget as number;
  const cap = sideBetCap as number;
  if (cap < 0 || cap > SIDE_BET_CAP_MAX) return { ok: false, error: "cap_out_of_range" };
  if (target < 0 || target > 100) return { ok: false, error: "target_out_of_range" };
  // Foundation is the remainder, so it can't go below nothing.
  if (target + cap > 100) return { ok: false, error: "shape_over_100" };
  return { ok: true, settings: { handpickedTarget: target, sideBetCap: cap } };
}
