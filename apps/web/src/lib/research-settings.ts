import type { Profile, ProfileView, TrustRulesView, TrustSettings } from "@finance-app/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "./api";

/** The trust rules (`/trust-rules`). The API enforces every limit. */
export function useTrustRules() {
  return useQuery({
    queryKey: ["trust-rules"],
    queryFn: () => apiGet<TrustRulesView>("/trust-rules"),
  });
}

/** Saves the trust rules once, on Save. Your week reads them, so it's refetched too. */
export function useSaveTrustRules() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: TrustSettings) => apiPut<TrustRulesView>("/trust-rules", settings),
    onSuccess: (view) => {
      client.setQueryData(["trust-rules"], view);
      void client.invalidateQueries({ queryKey: ["week"] });
    },
  });
}

export function useProfile() {
  return useQuery({ queryKey: ["profile"], queryFn: () => apiGet<ProfileView>("/profile") });
}

export function useSaveProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (profile: Profile) => apiPut<ProfileView>("/profile", profile),
    onSuccess: (view) => {
      client.setQueryData(["profile"], view);
      void client.invalidateQueries({ queryKey: ["week"] });
    },
  });
}

/** A publisher typed any way, as the API will store it: `https://www.Reuters.com/x` → `reuters.com`. Null if it can't be one. */
export function publisherDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const host = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname.replace(
      /^www\./,
      "",
    );
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}
