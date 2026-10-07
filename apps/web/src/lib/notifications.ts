import type {
  NotificationItemView,
  NotificationSettings,
  NotificationSettingsView,
  NotificationsView,
} from "@finance-app/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "./api";

/**
 * The bell (DESIGN §10.3): what Pip told you over the last 30 days — the
 * nudge log, Side Bet's limit alerts and connection gaps — with read state.
 * Nothing here sends anything; these are switches and a list.
 */

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiGet<NotificationsView>("/notifications"),
    enabled,
  });
}

/** Marks rows read straight away on screen, then tells the server. */
export function useMarkRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (items: Pick<NotificationItemView, "kind" | "id">[]) =>
      apiPost<NotificationsView>("/notifications/read", {
        items: items.map(({ kind, id }) => ({ kind, id })),
      }),
    onMutate: (items) => {
      const keys = new Set(items.map((item) => `${item.kind}:${item.id}`));
      client.setQueryData<NotificationsView>(["notifications"], (view) => {
        if (!view) return view;
        const next = view.items.map((item) =>
          keys.has(`${item.kind}:${item.id}`) ? { ...item, read: true } : item,
        );
        return { items: next, unread: next.filter((item) => !item.read).length };
      });
    },
    onSuccess: (view) => client.setQueryData(["notifications"], view),
  });
}

/**
 * One switch at a time, shown at once: the bell's foot and Setup read the same
 * cache, so they can't disagree ("neither is the real one", DESIGN §10.3).
 */
export function useSwitch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: Partial<NotificationSettings>) =>
      apiPut<NotificationSettingsView>("/notification-settings", change),
    onMutate: (change) => {
      const before = client.getQueryData<NotificationSettingsView>(["notification-settings"]);
      if (before) {
        client.setQueryData(["notification-settings"], {
          ...before,
          settings: { ...before.settings, ...change },
        });
      }
      return { before };
    },
    onError: (_error, _change, context) => {
      if (context?.before) client.setQueryData(["notification-settings"], context.before);
    },
    onSuccess: (view) => client.setQueryData(["notification-settings"], view),
  });
}

export interface JobStatus {
  lastCheckedAt?: string;
  stale: boolean;
}

/** "Pip last checked prices and news 12 min ago" . */
export function useJobStatus() {
  return useQuery({ queryKey: ["status"], queryFn: () => apiGet<JobStatus>("/status") });
}

// ─── Grouping and words ──────────────────────────────────────────────────────

const LONDON = "Europe/London";
const dayOf = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: LONDON }).format(date);

export type Section = "Today" | "This week" | "Earlier";

/** Today (London), the last seven days, and the rest of the 30. */
export function sectionOf(iso: string, now = new Date()): Section {
  const at = new Date(iso);
  if (dayOf(at) === dayOf(now)) return "Today";
  return now.getTime() - at.getTime() < 7 * 86_400_000 ? "This week" : "Earlier";
}

export function grouped(
  items: NotificationItemView[],
  now = new Date(),
): { section: Section; items: NotificationItemView[] }[] {
  const order: Section[] = ["Today", "This week", "Earlier"];
  return order
    .map((section) => ({
      section,
      items: items.filter((item) => sectionOf(item.at, now) === section),
    }))
    .filter((group) => group.items.length > 0);
}
