import type { RulesView } from "@finance-app/shared";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";

export function useRules(enabled = true) {
  return useQuery({
    queryKey: ["rules"],
    queryFn: () => apiGet<RulesView>("/rules"),
    enabled,
  });
}

/** Side Bet over its cap is the only thing that lights the dot on Rules. */
export function someRuleNeedsALook(rules: RulesView | undefined): boolean {
  return Boolean(rules?.rules.some((rule) => rule.overBy));
}
