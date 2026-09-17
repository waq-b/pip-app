import { URGENT_PUSH_DAILY_MAX, type PushKind } from "@finance-app/shared";
import type { EmailMessage, EmailSender, PushMessage, PushSender } from "./senders.js";
import type { NotificationStore } from "./store.js";

/**
 * Whether to send, and to which devices. Everything here is a rule the phase
 * plan settled (decision 1): the user's switches, one push per event, and at
 * most two urgent pushes a day. A notification is information — it never asks
 * for a decision and tapping it only opens Pip (hard lines 1 and 2).
 */

export interface PushRequest {
  userId: string;
  kind: PushKind;
  /** The event this is about: `limit:80:<window>`, `urgent:<nudge id>`, `digest:<Monday>`. */
  dedupeKey: string;
  message: PushMessage;
}

export type PushOutcome =
  | { sent: true; devices: number; delivered: number }
  | { sent: false; why: "switched_off" | "already_sent" | "over_budget" | "no_devices" };

export interface Notifier {
  push(request: PushRequest, now: Date): Promise<PushOutcome>;
  email(
    userId: string,
    message: EmailMessage,
  ): Promise<{ sent: boolean; why?: "switched_off" | "failed" }>;
}

/** The London day, which is what the budgets and the logs count in. */
export function londonDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
}

const switchFor = {
  limit: (settings: { pushLimit: boolean }) => settings.pushLimit,
  urgent: (settings: { pushUrgent: boolean }) => settings.pushUrgent,
  digest: (settings: { pushDigest: boolean }) => settings.pushDigest,
} as const;

export function createNotifier(options: {
  store: NotificationStore;
  push: PushSender;
  email: EmailSender;
  /** Logged, never thrown: a push failing must not fail the job that asked for it. */
  onError?: (error: unknown, context: Record<string, unknown>) => void;
}): Notifier {
  const { store, push, email } = options;
  const report = options.onError ?? (() => {});

  return {
    async push(request, now) {
      const { userId, kind, dedupeKey, message } = request;
      const settings = await store.settingsFor(userId);
      if (!settings.push || !switchFor[kind](settings)) return { sent: false, why: "switched_off" };

      const day = londonDay(now);
      if (kind === "urgent") {
        const alreadyToday = await store.countSent(userId, "urgent", day);
        if (alreadyToday >= URGENT_PUSH_DAILY_MAX) return { sent: false, why: "over_budget" };
      }

      // Claimed before anything is sent, so two overlapping runs can't both send.
      if (!(await store.claimPush(userId, kind, dedupeKey, day))) {
        return { sent: false, why: "already_sent" };
      }

      const devices = await store.devicesFor(userId);
      if (devices.length === 0) {
        // Nothing was sent, so the event stays unclaimed for when a device appears.
        await store.releasePush(userId, kind, dedupeKey);
        return { sent: false, why: "no_devices" };
      }

      const delivered: string[] = [];
      const failed: string[] = [];
      for (const device of devices) {
        const result = await push.send(device, message);
        if (result.ok) {
          delivered.push(device.id);
          continue;
        }
        failed.push(device.id);
        // 404 or 410: that subscription is gone, so the row goes with it.
        if (result.gone) await store.forgetEndpoint(device.endpoint);
        else report(new Error(result.detail), { kind, deviceId: device.id });
      }

      await store.markDelivered(delivered, now);
      await store.markFailed(failed, now);
      await store.recordAttempt(userId, kind, dedupeKey, {
        tried: devices.length,
        delivered: delivered.length,
      });

      return { sent: true, devices: devices.length, delivered: delivered.length };
    },

    async email(userId, message) {
      const settings = await store.settingsFor(userId);
      if (!settings.email) return { sent: false, why: "switched_off" };
      const result = await email.send(message);
      if (!result.ok) {
        report(new Error(result.detail), { to: "redacted" });
        return { sent: false, why: "failed" };
      }
      return { sent: true };
    },
  };
}
