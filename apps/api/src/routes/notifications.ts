import type {
  Bucket,
  NotificationItemKind,
  DeviceView,
  NotificationItemView,
  NotificationSettings,
  NotificationSettingsView,
  NotificationsView,
} from "@finance-app/shared";
import { NOTIFICATION_ITEM_KINDS } from "@finance-app/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DeviceSummary, NotificationItem, NotificationStore } from "../notify/store.js";

/**
 * The bell and its switches (Phase 6 decision 4). Behind the auth guard like
 * every route. Nothing here sends anything, and nothing here can move money:
 * these are switches, device rows and a list of what Pip has already said.
 */

const deviceView = (device: DeviceSummary): DeviceView => ({
  id: device.id,
  label: device.label,
  addedAt: device.createdAt.toISOString(),
  ...(device.lastDeliveredAt ? { lastDeliveredAt: device.lastDeliveredAt.toISOString() } : {}),
  ...(device.lastFailedAt ? { lastFailedAt: device.lastFailedAt.toISOString() } : {}),
});

const itemView = (item: NotificationItem): NotificationItemView => ({
  kind: item.kind,
  id: item.id,
  title: item.title,
  ...(item.body ? { body: item.body } : {}),
  ...(item.bucket ? { bucket: item.bucket as Bucket } : {}),
  at: item.at.toISOString(),
  read: item.read,
  url: item.url,
});

/** Switches are booleans and nothing else; anything missing keeps its value. */
function parseSettings(
  body: unknown,
  current: NotificationSettings,
): { ok: true; settings: NotificationSettings; answered: boolean } | { ok: false } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false };
  const input = body as Record<string, unknown>;
  const settings = { ...current };
  for (const key of ["push", "pushLimit", "pushUrgent", "pushDigest", "email"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") return { ok: false };
    settings[key] = value;
  }
  if (input.answered !== undefined && typeof input.answered !== "boolean") return { ok: false };
  return { ok: true, settings, answered: input.answered === true };
}

/** A subscription as the browser's `PushManager` gives it to us. */
function parseSubscription(
  body: unknown,
): { ok: true; endpoint: string; p256dh: string; auth: string; label: string } | { ok: false } {
  if (typeof body !== "object" || body === null) return { ok: false };
  const input = body as Record<string, unknown>;
  const keys = (input.keys ?? {}) as Record<string, unknown>;
  const endpoint = input.endpoint;
  const p256dh = keys.p256dh;
  const auth = keys.auth;
  const label = input.label ?? "This device";
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) return { ok: false };
  if (typeof p256dh !== "string" || !p256dh) return { ok: false };
  if (typeof auth !== "string" || !auth) return { ok: false };
  if (typeof label !== "string" || label.length > 60) return { ok: false };
  return { ok: true, endpoint, p256dh, auth, label: label.trim() || "This device" };
}

type Mark = { kind: NotificationItemKind; id: string };

function parseMarks(body: unknown): { ok: true; items: Mark[] } | { ok: false } {
  if (typeof body !== "object" || body === null) return { ok: false };
  const raw = (body as Record<string, unknown>).items;
  if (!Array.isArray(raw) || raw.length > 200) return { ok: false };
  const items: Mark[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return { ok: false };
    const { kind, id } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !id) return { ok: false };
    if (typeof kind !== "string" || !NOTIFICATION_ITEM_KINDS.includes(kind as never)) {
      return { ok: false };
    }
    items.push({ kind: kind as NotificationItemKind, id });
  }
  return { ok: true, items };
}

export function registerNotificationRoutes(
  app: FastifyInstance,
  options: { store: NotificationStore; now?: () => Date },
): void {
  const now = options.now ?? (() => new Date());
  const store = options.store;
  const userOf = (request: FastifyRequest) => ({
    userId: request.allowedUser!.id,
    authUserId: request.authUser!.authUserId,
  });

  const view = async (request: FastifyRequest): Promise<NotificationSettingsView> => {
    const user = userOf(request);
    const [settings, devices] = await Promise.all([store.settings(user), store.devices(user)]);
    const { askedAt, ...switches } = settings;
    return { settings: switches, devices: devices.map(deviceView), asked: askedAt !== null };
  };

  app.get("/notification-settings", async (request) => view(request));

  app.put("/notification-settings", async (request, reply) => {
    const user = userOf(request);
    const current = await store.settings(user);
    const parsed = parseSettings(request.body, current);
    if (!parsed.ok) return reply.status(400).send({ error: "invalid_body" });
    await store.saveSettings(user, parsed.settings, { answered: parsed.answered, now: now() });
    return view(request);
  });

  app.post("/push/subscriptions", async (request, reply) => {
    const parsed = parseSubscription(request.body);
    if (!parsed.ok) return reply.status(400).send({ error: "invalid_subscription" });
    const { endpoint, p256dh, auth, label } = parsed;
    await store.addDevice(userOf(request), { endpoint, p256dh, auth, label }, now());
    return view(request);
  });

  app.delete("/push/subscriptions", async (request, reply) => {
    const endpoint = (request.body as { endpoint?: unknown } | null)?.endpoint;
    if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
      return reply.status(400).send({ error: "invalid_subscription" });
    }
    const removed = await store.removeDevice(userOf(request), endpoint);
    if (!removed) return reply.status(404).send({ error: "unknown_subscription" });
    return view(request);
  });

  /** Does the server still know this device? The app asks on every open. */
  app.get("/push/subscriptions/this-device", async (request, reply) => {
    const endpoint = (request.query as { endpoint?: string }).endpoint;
    if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
      return reply.status(400).send({ error: "invalid_subscription" });
    }
    const device = await store.deviceByEndpoint(userOf(request), endpoint);
    return { known: device !== null, ...(device ? { device: deviceView(device) } : {}) };
  });

  app.get("/notifications", async (request): Promise<NotificationsView> => {
    const items = await store.feed(userOf(request), now());
    return { items: items.map(itemView), unread: items.filter((item) => !item.read).length };
  });

  app.post("/notifications/read", async (request, reply) => {
    const parsed = parseMarks(request.body);
    if (!parsed.ok) return reply.status(400).send({ error: "invalid_body" });
    await store.markRead(userOf(request), parsed.items, now());
    const items = await store.feed(userOf(request), now());
    return { items: items.map(itemView), unread: items.filter((item) => !item.read).length };
  });
}
