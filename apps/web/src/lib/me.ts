import type { MeResponse } from "@finance-app/shared";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";

/**
 * Whether the signed-in person is allowed in. Only asked once there is a
 * session to ask with.
 */
export function useMe(enabled: boolean) {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet<MeResponse>("/me"),
    enabled,
    staleTime: 60_000,
  });
}
