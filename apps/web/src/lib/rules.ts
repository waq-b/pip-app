import type { RulesView } from "@finance-app/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "./api";

export type RuleSettings = NonNullable<RulesView["settings"]>;

export function useRules(enabled = true) {
  return useQuery({
    queryKey: ["rules"],
    queryFn: () => apiGet<RulesView>("/rules"),
    enabled,
  });
}

/**
 * Saves the two numbers the user sets — once, when they press Save. The API
 * checks the limits; on success every screen is refetched, because a rule
 * changes what they all say. On failure nothing is changed.
 */
export function useSaveRules() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: RuleSettings) => apiPut<unknown>("/rules", settings),
    onSuccess: () => client.invalidateQueries(),
  });
}

/** Side Bet over its cap is the only thing that lights the dot on Rules. */
export function someRuleNeedsALook(rules: RulesView | undefined): boolean {
  if (!rules) return false;
  return rules.needsAttention ?? rules.rules.some((rule) => rule.overBy);
}
