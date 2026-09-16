import type { Connection, ConnectRequest, ConnectResult, ProviderId } from "@finance-app/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost } from "./api";

const KEY = ["connections"] as const;

/** What Setup says about connecting each provider. The list of accounts comes from the API. */
export const PROVIDER_INFO: Record<
  ProviderId,
  {
    initial: string;
    steps: string[];
    needsSecret: boolean;
    /** What the provider calls the second half of the key. */
    secretLabel: string;
    secretPlaceholder: string;
    permissionNote?: string;
  }
> = {
  trading212: {
    initial: "T",
    steps: [
      "Open Trading 212 → Settings → API (Beta)",
      "Make a key with only Account data, Portfolio, Metadata and History ticked",
      "Paste the key and the secret below",
    ],
    needsSecret: true,
    secretLabel: "API secret",
    secretPlaceholder: "Paste the secret shown with it",
    permissionNote:
      "Pip can't check a Trading 212 key's permissions, and it has no code that can place an order either way.",
  },
  kraken: {
    initial: "K",
    steps: [
      "Open Kraken → Settings → API → Spot trading API, and create a key",
      "Tick only Funds: Query and Data: Query ledger entries — no key password",
      "Paste the API key and the private key below",
    ],
    needsSecret: true,
    secretLabel: "Private key",
    secretPlaceholder: "Paste the private key",
    permissionNote:
      "Pip checks this key can't trade, withdraw or deposit before storing it, and refuses it if it can.",
  },
};

export function useConnections() {
  return useQuery({ queryKey: KEY, queryFn: () => apiGet<Connection[]>("/connections") });
}

/**
 * The outcome is written into the cache straight away, so Setup doesn't flash
 * the old state. In stub mode that's the only record (nothing is stored); with
 * a real account the numbers everywhere else are refetched too.
 */
function useSetStatus() {
  const client = useQueryClient();
  return (id: string, status: Connection["status"]) => {
    client.setQueryData<Connection[]>(KEY, (current) =>
      current?.map((connection) =>
        connection.id === id
          ? {
              ...connection,
              status,
              lastReadAt: status === "live" ? new Date().toISOString() : undefined,
            }
          : connection,
      ),
    );
    void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== KEY[0] });
  };
}

export function useConnect(connection: Connection) {
  const setStatus = useSetStatus();
  return useMutation({
    mutationFn: (input: Omit<ConnectRequest, "accountKind">) =>
      apiPost<ConnectResult>(`/connections/${connection.provider}`, {
        ...input,
        accountKind: connection.accountKind,
      }),
    onSuccess: (result) => {
      if (result.outcome === "connected") setStatus(connection.id, "live");
    },
  });
}

export function useDisconnect(connection: Connection) {
  const setStatus = useSetStatus();
  const query = connection.accountKind ? `?accountKind=${connection.accountKind}` : "";
  return useMutation({
    mutationFn: () => apiDelete<unknown>(`/connections/${connection.provider}${query}`),
    onSuccess: () => setStatus(connection.id, "not_connected"),
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
