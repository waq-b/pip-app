import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_HISTORY_DAYS,
  type NotificationItemKind,
  type NotificationSettings,
  type PushKind,
} from "@finance-app/shared";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import {
  connectionGaps,
  limitAlerts,
  notificationReads,
  notificationSettings,
  nudges,
  pushDeliveries,
  pushSubscriptions,
} from "../db/schema.js";
import { asUser, type Db } from "../db/user-scope.js";
import type { ReadUser } from "../read/model.js";

/**
 * What Pip needs to know before it sends anything, and what the bell shows
 * afterwards. Reads that belong to a screen run as the user (RLS); the sender
 * and the jobs use the privileged connection, having already been told whose
 * rows they're working on.
 */

export interface StoredSettings extends NotificationSettings {
  /** Null until the first-login sheet has been answered. It's asked once. */
  askedAt: Date | null;
}

export interface Device {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string;
  createdAt: Date;
  lastDeliveredAt: Date | null;
  lastFailedAt: Date | null;
}

/** What a browser may know about its own devices — never the keys. */
export type DeviceSummary = Omit<Device, "endpoint" | "p256dh" | "auth">;

export interface NewDevice {
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string;
}

export interface NotificationItem {
  kind: NotificationItemKind;
  id: string;
  title: string;
  body: string | null;
  /** The pot it's about, when it is about one. */
  bucket: string | null;
  at: Date;
  read: boolean;
  /** Where tapping it goes. */
  url: string;
}

export interface NotificationStore {
  settings(user: ReadUser): Promise<StoredSettings>;
  /** Server-side read for the sender, without a Supabase session. */
  settingsFor(userId: string): Promise<StoredSettings>;
  saveSettings(
    user: ReadUser,
    settings: NotificationSettings,
    options: { answered?: boolean; now: Date },
  ): Promise<StoredSettings>;

  devices(user: ReadUser): Promise<DeviceSummary[]>;
  /** For the sender: everything needed to push. */
  devicesFor(userId: string): Promise<Device[]>;
  /** The same endpoint twice is the same device: its keys and label are updated. */
  addDevice(user: ReadUser, device: NewDevice, now: Date): Promise<DeviceSummary>;
  /** False when that endpoint isn't one of theirs. */
  removeDevice(user: ReadUser, endpoint: string): Promise<boolean>;
  /** Used when a push service says a subscription is gone. */
  forgetEndpoint(endpoint: string): Promise<void>;
  deviceByEndpoint(user: ReadUser, endpoint: string): Promise<DeviceSummary | null>;
  markDelivered(deviceIds: string[], now: Date): Promise<void>;
  markFailed(deviceIds: string[], now: Date): Promise<void>;

  /**
   * Claims this event for this kind of push. False means it's already been
   * sent — that's what makes one event one push, even if two runs overlap.
   */
  claimPush(userId: string, kind: PushKind, dedupeKey: string, day: string): Promise<boolean>;
  recordAttempt(
    userId: string,
    kind: PushKind,
    dedupeKey: string,
    counts: { tried: number; delivered: number },
  ): Promise<void>;
  releasePush(userId: string, kind: PushKind, dedupeKey: string): Promise<void>;
  /** How many pushes of a kind went out on a London day, for the urgent budget. */
  countSent(userId: string, kind: PushKind, day: string): Promise<number>;

  /** The bell: what Pip has told them lately, newest first. */
  feed(user: ReadUser, now: Date): Promise<NotificationItem[]>;
  markRead(
    user: ReadUser,
    items: { kind: NotificationItemKind; id: string }[],
    now: Date,
  ): Promise<void>;
}

const settingsFromRow = (
  row: typeof notificationSettings.$inferSelect | undefined,
): StoredSettings =>
  row
    ? {
        push: row.push,
        pushLimit: row.pushLimit,
        pushUrgent: row.pushUrgent,
        pushDigest: row.pushDigest,
        email: row.email,
        askedAt: row.askedAt,
      }
    : { ...DEFAULT_NOTIFICATION_SETTINGS, askedAt: null };

const summaryOf = (device: Device | typeof pushSubscriptions.$inferSelect): DeviceSummary => ({
  id: device.id,
  label: device.label,
  createdAt: device.createdAt,
  lastDeliveredAt: device.lastDeliveredAt,
  lastFailedAt: device.lastFailedAt,
});

/** A nudge, alert or gap as a row in the bell. */
function itemOf(
  kind: NotificationItemKind,
  row: {
    id: string;
    title: string;
    body: string | null;
    bucket: string | null;
    at: Date;
    url: string;
  },
  read: Set<string>,
): NotificationItem {
  return { kind, ...row, read: read.has(`${kind}:${row.id}`) };
}

export function dbNotificationStore(db: Db): NotificationStore {
  const sinceOf = (now: Date) => new Date(now.getTime() - NOTIFICATION_HISTORY_DAYS * 86_400_000);

  return {
    async settings(user) {
      const [row] = await asUser(db, user.authUserId, (tx) =>
        tx.select().from(notificationSettings),
      );
      return settingsFromRow(row);
    },

    async settingsFor(userId) {
      const [row] = await db
        .select()
        .from(notificationSettings)
        .where(eq(notificationSettings.userId, userId));
      return settingsFromRow(row);
    },

    async saveSettings(user, settings, { answered, now }) {
      const [row] = await db
        .insert(notificationSettings)
        .values({
          userId: user.userId,
          ...settings,
          askedAt: answered ? now : null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: notificationSettings.userId,
          set: {
            ...settings,
            updatedAt: now,
            // The sheet is answered once; a later save never unsets it.
            ...(answered
              ? { askedAt: sql`coalesce(${notificationSettings.askedAt}, ${now})` }
              : {}),
          },
        })
        .returning();
      return settingsFromRow(row);
    },

    async devices(user) {
      const rows = await asUser(db, user.authUserId, (tx) =>
        tx
          .select({
            id: pushSubscriptions.id,
            label: pushSubscriptions.label,
            createdAt: pushSubscriptions.createdAt,
            lastDeliveredAt: pushSubscriptions.lastDeliveredAt,
            lastFailedAt: pushSubscriptions.lastFailedAt,
          })
          .from(pushSubscriptions)
          .orderBy(pushSubscriptions.createdAt),
      );
      return rows;
    },

    async devicesFor(userId) {
      return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    },

    async addDevice(user, device, now) {
      const [row] = await db
        .insert(pushSubscriptions)
        .values({ userId: user.userId, ...device, createdAt: now })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            userId: user.userId,
            p256dh: device.p256dh,
            auth: device.auth,
            label: device.label,
            lastFailedAt: null,
          },
        })
        .returning();
      return summaryOf(row!);
    },

    async removeDevice(user, endpoint) {
      const gone = await db
        .delete(pushSubscriptions)
        .where(
          and(eq(pushSubscriptions.userId, user.userId), eq(pushSubscriptions.endpoint, endpoint)),
        )
        .returning({ id: pushSubscriptions.id });
      return gone.length > 0;
    },

    async forgetEndpoint(endpoint) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    },

    async deviceByEndpoint(user, endpoint) {
      const [row] = await db
        .select()
        .from(pushSubscriptions)
        .where(
          and(eq(pushSubscriptions.userId, user.userId), eq(pushSubscriptions.endpoint, endpoint)),
        );
      return row ? summaryOf(row) : null;
    },

    async markDelivered(deviceIds, now) {
      if (deviceIds.length === 0) return;
      await db
        .update(pushSubscriptions)
        .set({ lastDeliveredAt: now })
        .where(sql`${pushSubscriptions.id} = any(${deviceIds})`);
    },

    async markFailed(deviceIds, now) {
      if (deviceIds.length === 0) return;
      await db
        .update(pushSubscriptions)
        .set({ lastFailedAt: now })
        .where(sql`${pushSubscriptions.id} = any(${deviceIds})`);
    },

    async claimPush(userId, kind, dedupeKey, day) {
      const claimed = await db
        .insert(pushDeliveries)
        .values({ userId, kind, dedupeKey, sentOn: day })
        .onConflictDoNothing()
        .returning({ id: pushDeliveries.id });
      return claimed.length > 0;
    },

    async recordAttempt(userId, kind, dedupeKey, counts) {
      await db
        .update(pushDeliveries)
        .set({ devicesTried: counts.tried, devicesDelivered: counts.delivered })
        .where(
          and(
            eq(pushDeliveries.userId, userId),
            eq(pushDeliveries.kind, kind),
            eq(pushDeliveries.dedupeKey, dedupeKey),
          ),
        );
    },

    async releasePush(userId, kind, dedupeKey) {
      await db
        .delete(pushDeliveries)
        .where(
          and(
            eq(pushDeliveries.userId, userId),
            eq(pushDeliveries.kind, kind),
            eq(pushDeliveries.dedupeKey, dedupeKey),
          ),
        );
    },

    async countSent(userId, kind, day) {
      const rows = await db
        .select({ id: pushDeliveries.id })
        .from(pushDeliveries)
        .where(
          and(
            eq(pushDeliveries.userId, userId),
            eq(pushDeliveries.kind, kind),
            eq(pushDeliveries.sentOn, day),
          ),
        );
      return rows.length;
    },

    async feed(user, now) {
      const since = sinceOf(now);
      return asUser(db, user.authUserId, async (tx) => {
        const [shownNudges, alerts, gaps, marks] = await Promise.all([
          tx
            .select()
            .from(nudges)
            .where(and(eq(nudges.shown, true), gte(nudges.createdAt, since)))
            .orderBy(desc(nudges.createdAt)),
          tx
            .select()
            .from(limitAlerts)
            .where(gte(limitAlerts.alertedAt, since))
            .orderBy(desc(limitAlerts.alertedAt)),
          tx
            .select()
            .from(connectionGaps)
            .where(gte(connectionGaps.startedAt, since))
            .orderBy(desc(connectionGaps.startedAt)),
          tx.select().from(notificationReads),
        ]);

        const read = new Set(marks.map((mark) => `${mark.itemKind}:${mark.itemId}`));
        const items = [
          ...shownNudges.map((row) =>
            itemOf(
              "nudge",
              {
                id: row.id,
                title: row.title,
                body: row.body,
                bucket: row.bucket,
                at: row.createdAt,
                url: "/week",
              },
              read,
            ),
          ),
          ...alerts.map((row) =>
            itemOf(
              "limit_alert",
              {
                id: row.id,
                title:
                  row.threshold === 100
                    ? "Side Bet has reached its limit"
                    : "Side Bet is near its limit",
                body: null,
                bucket: "Degen",
                at: row.alertedAt,
                url: "/rules",
              },
              read,
            ),
          ),
          ...gaps.map((row) =>
            itemOf(
              "connection_gap",
              {
                id: row.id,
                title: `${row.provider === "kraken" ? "Kraken" : "Trading 212"} went quiet`,
                body: null,
                bucket: null,
                at: row.startedAt,
                url: "/setup",
              },
              read,
            ),
          ),
        ];
        return items.sort((a, b) => b.at.getTime() - a.at.getTime());
      });
    },

    async markRead(user, items, now) {
      if (items.length === 0) return;
      await db
        .insert(notificationReads)
        .values(
          items.map((item) => ({
            userId: user.userId,
            itemKind: item.kind,
            itemId: item.id,
            readAt: now,
          })),
        )
        .onConflictDoNothing();
    },
  };
}

/** Open gaps, for the refresh job to close. */
export async function openGaps(db: Db, userId: string) {
  return db
    .select()
    .from(connectionGaps)
    .where(and(eq(connectionGaps.userId, userId), isNull(connectionGaps.endedAt)));
}

/**
 * The same store without a database, for dev and tests. Keeps the same rules:
 * one row per endpoint, one delivery per event, read marks that don't repeat.
 */
export function memoryNotificationStore(): NotificationStore & {
  seedNudge(userId: string, item: Omit<NotificationItem, "kind" | "read">): void;
  deliveries: { userId: string; kind: PushKind; dedupeKey: string; day: string }[];
} {
  const settings = new Map<string, StoredSettings>();
  const devices = new Map<string, Device & { userId: string }>();
  const deliveries: { userId: string; kind: PushKind; dedupeKey: string; day: string }[] = [];
  const reads = new Set<string>();
  const items = new Map<string, NotificationItem[]>();
  let nextId = 1;

  const settingsOf = (userId: string) =>
    settings.get(userId) ?? { ...DEFAULT_NOTIFICATION_SETTINGS, askedAt: null };

  return {
    deliveries,

    seedNudge(userId, item) {
      const list = items.get(userId) ?? [];
      list.push({ kind: "nudge", read: false, ...item });
      items.set(userId, list);
    },

    async settings(user) {
      return settingsOf(user.userId);
    },
    async settingsFor(userId) {
      return settingsOf(userId);
    },
    async saveSettings(user, next, { answered, now }) {
      const previous = settingsOf(user.userId);
      const saved = { ...next, askedAt: previous.askedAt ?? (answered ? now : null) };
      settings.set(user.userId, saved);
      return saved;
    },

    async devices(user) {
      return [...devices.values()]
        .filter((device) => device.userId === user.userId)
        .map((device) => summaryOf(device));
    },
    async devicesFor(userId) {
      return [...devices.values()].filter((device) => device.userId === userId);
    },
    async addDevice(user, device, now) {
      const existing = devices.get(device.endpoint);
      const saved = {
        id: existing?.id ?? `device-${nextId++}`,
        userId: user.userId,
        createdAt: existing?.createdAt ?? now,
        lastDeliveredAt: existing?.lastDeliveredAt ?? null,
        lastFailedAt: null,
        ...device,
      };
      devices.set(device.endpoint, saved);
      return summaryOf(saved);
    },
    async removeDevice(user, endpoint) {
      const device = devices.get(endpoint);
      if (!device || device.userId !== user.userId) return false;
      devices.delete(endpoint);
      return true;
    },
    async forgetEndpoint(endpoint) {
      devices.delete(endpoint);
    },
    async deviceByEndpoint(user, endpoint) {
      const device = devices.get(endpoint);
      return device && device.userId === user.userId ? summaryOf(device) : null;
    },
    async markDelivered(deviceIds, now) {
      for (const device of devices.values()) {
        if (deviceIds.includes(device.id)) device.lastDeliveredAt = now;
      }
    },
    async markFailed(deviceIds, now) {
      for (const device of devices.values()) {
        if (deviceIds.includes(device.id)) device.lastFailedAt = now;
      }
    },

    async claimPush(userId, kind, dedupeKey, day) {
      const already = deliveries.some(
        (row) => row.userId === userId && row.kind === kind && row.dedupeKey === dedupeKey,
      );
      if (already) return false;
      deliveries.push({ userId, kind, dedupeKey, day });
      return true;
    },
    async recordAttempt() {},
    async releasePush(userId, kind, dedupeKey) {
      const index = deliveries.findIndex(
        (row) => row.userId === userId && row.kind === kind && row.dedupeKey === dedupeKey,
      );
      if (index >= 0) deliveries.splice(index, 1);
    },
    async countSent(userId, kind, day) {
      return deliveries.filter(
        (row) => row.userId === userId && row.kind === kind && row.day === day,
      ).length;
    },

    async feed(user, now) {
      const since = now.getTime() - NOTIFICATION_HISTORY_DAYS * 86_400_000;
      return (items.get(user.userId) ?? [])
        .filter((item) => item.at.getTime() >= since)
        .map((item) => ({ ...item, read: reads.has(`${item.kind}:${item.id}`) }))
        .sort((a, b) => b.at.getTime() - a.at.getTime());
    },
    async markRead(_user, marks) {
      for (const mark of marks) reads.add(`${mark.kind}:${mark.id}`);
    },
  };
}
