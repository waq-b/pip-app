import type { Connection, ConnectResult, ProviderId } from "@finance-app/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost } from "./api";

const KEY = ["connections"] as const;

/** The providers Pip supports, in the order Setup lists them. */
export const PROVIDERS: { id: ProviderId; name: string; initial: string; steps: string }[] = [
  {
    id: "trading212",
    name: "Trading 212",
    initial: "T",
    steps: "Open Trading 212 → Settings → API",
  },
  { id: "kraken", name: "Kraken", initial: "K", steps: "Open Kraken → Settings → API" },
];

export function providerInfo(id: ProviderId) {
  return PROVIDERS.find((provider) => provider.id === id)!;
}

export function useConnections() {
  return useQuery({ queryKey: KEY, queryFn: () => apiGet<Connection[]>("/connections") });
}

/**
 * Phase 1 stores nothing server-side, so a refetch would undo what the person
 * just did. The outcome is written into the cache instead; Phase 2's real
 * storage makes the server's answer agree.
 */
function useSetStatus() {
  const client = useQueryClient();
  return (provider: ProviderId, status: Connection["status"]) =>
    client.setQueryData<Connection[]>(KEY, (current) =>
      current?.map((connection) =>
        connection.provider === provider
          ? {
              ...connection,
              status,
              lastReadAt: status === "live" ? new Date().toISOString() : undefined,
            }
          : connection,
      ),
    );
}

export function useConnect(provider: ProviderId) {
  const setStatus = useSetStatus();
  return useMutation({
    mutationFn: (key: string) => apiPost<ConnectResult>(`/connections/${provider}`, { key }),
    onSuccess: (result) => {
      if (result.outcome === "connected") setStatus(provider, "live");
    },
  });
}

export function useDisconnect(provider: ProviderId) {
  const setStatus = useSetStatus();
  return useMutation({
    mutationFn: () => apiDelete<unknown>(`/connections/${provider}`),
    onSuccess: () => setStatus(provider, "not_connected"),
  });
}

/** Shows a pasted key back without holding on to it: "kr-live-9…8814". */
export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 12) return "•".repeat(Math.max(trimmed.length, 1));
  return `${trimmed.slice(0, 9)}…${trimmed.slice(-4)}`;
}

/** "Trading 212 doesn't recognise that key. Usually…" → heading and body. */
export function splitMessage(message: string): { heading: string; body: string } {
  const end = message.indexOf(". ");
  if (end === -1) return { heading: message.replace(/\.$/, ""), body: "" };
  return { heading: message.slice(0, end), body: message.slice(end + 2) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "4 min ago", "3 hours ago", "on 12 Sep". */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const date = new Date(iso);
  return `on ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}
