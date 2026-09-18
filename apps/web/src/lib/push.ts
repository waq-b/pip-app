import type { NotificationSettings, NotificationSettingsView } from "@finance-app/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "./api";

/**
 * Push on this device (phase-6.md decision 5, DESIGN §10.2–10.4).
 *
 * The OS prompt is only ever asked from a tap — Pip's own sheet first, then
 * "Turn on for this device" — never on load. On an iPhone or iPad, web push
 * only works in the app added to the Home Screen, so a Safari tab gets the
 * Add to Home Screen row instead of a button.
 *
 * Every open, Pip checks this device's subscription against the server and
 * quietly mends it where the browser allows; otherwise the device row says
 * "Notifications stopped on this device" and offers the button again.
 */

export type DeviceState =
  /** The server can't push (stub mode, or no VAPID pair yet). */
  | "server_off"
  /** This browser has no web push. */
  | "unsupported"
  /** iPhone or iPad in a browser tab: add to the Home Screen first. */
  | "needs_install"
  /** Permission denied: only the phone's settings can undo it. */
  | "blocked"
  /** Never turned on here. */
  | "off"
  /** Was on, and the subscription went missing. */
  | "stopped"
  | "on";

export interface PushEnvironment {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
  supported: boolean;
  permission: NotificationPermission | "unsupported";
}

export function currentEnvironment(): PushEnvironment {
  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  const standalone =
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone,
    supported,
    permission: supported ? Notification.permission : "unsupported",
  };
}

/** iPadOS reports itself as a Mac; touch gives it away. */
export function isAppleMobile(env: Pick<PushEnvironment, "userAgent" | "maxTouchPoints">): boolean {
  return (
    /iPhone|iPad|iPod/.test(env.userAgent) ||
    (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1)
  );
}

/** The name the device row and Setup show — never anything more identifying. */
export function deviceLabel(env: Pick<PushEnvironment, "userAgent" | "maxTouchPoints">): string {
  const ua = env.userAgent;
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux computer";
  return "This device";
}

/** What can be done here before looking at any subscription. */
export function baseState(env: PushEnvironment, vapidKey: string | null): DeviceState | null {
  if (!vapidKey) return "server_off";
  if (isAppleMobile(env) && !env.standalone) return "needs_install";
  if (!env.supported) return "unsupported";
  if (env.permission === "denied") return "blocked";
  return null;
}

/** The VAPID key as the browser wants it. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64url}${"=".repeat((4 - (base64url.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready;
}

async function tellServer(subscription: PushSubscription, env: PushEnvironment) {
  const json = subscription.toJSON();
  return apiPost<NotificationSettingsView>("/push/subscriptions", {
    endpoint: json.endpoint,
    keys: json.keys,
    label: deviceLabel(env),
  });
}

/**
 * "Turn on for this device" and the sheet's primary button. Must be called
 * straight from the tap: Safari only shows the prompt for a user gesture, so
 * `requestPermission` comes before anything else is awaited.
 */
export async function turnOnThisDevice(vapidKey: string): Promise<DeviceState> {
  const env = currentEnvironment();
  const early = baseState(env, vapidKey);
  if (early) return early;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const reg = await registration();
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(vapidKey),
    }));
  await tellServer(subscription, env);
  return "on";
}

export async function turnOffThisDevice(): Promise<void> {
  const reg = await registration();
  const subscription = await reg.pushManager.getSubscription();
  if (!subscription) return;
  await apiDelete("/push/subscriptions", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);
  await subscription.unsubscribe();
}

/**
 * The open-time check. With permission still granted, a subscription either
 * side lost is mended quietly: the browser allows a subscribe without a tap
 * once permission is granted. Anything else is reported, not asked.
 */
export async function checkThisDevice(
  vapidKey: string | null,
  env: PushEnvironment = currentEnvironment(),
): Promise<DeviceState> {
  const early = baseState(env, vapidKey);
  if (early) return early;
  if (env.permission !== "granted") return "off";
  const reg = await registration();
  let subscription = await reg.pushManager.getSubscription();
  if (subscription) {
    const { known } = await apiGet<{ known: boolean }>(
      `/push/subscriptions/this-device?endpoint=${encodeURIComponent(subscription.endpoint)}`,
    );
    if (known) return "on";
  } else {
    // Granted but gone: the browser or the push service dropped it.
    subscription = await reg.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey!) })
      .catch(() => null);
    if (!subscription) return "stopped";
  }
  try {
    await tellServer(subscription, env);
    return "on";
  } catch {
    return "stopped";
  }
}

/** What the device row says for each state (DESIGN §10.4). */
export const DEVICE_WORDS: Record<DeviceState | "checking", string> = {
  checking: "Checking this device…",
  server_off: "Pip can't send pushes yet.",
  unsupported: "This browser can't show notifications from Pip.",
  needs_install: "",
  blocked: "Blocked in this device's settings. Allow notifications for Pip there to turn them on.",
  off: "Off on this device.",
  stopped: "Notifications stopped on this device.",
  on: "On for this device.",
};

/** The push subtitle the bell's foot uses too (DESIGN §10.3). */
export function deviceWords(state: DeviceState | "checking"): string {
  return state === "needs_install" ? "Add Pip to your Home Screen first" : DEVICE_WORDS[state];
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useNotificationSettings(enabled = true) {
  return useQuery({
    queryKey: ["notification-settings"],
    queryFn: () => apiGet<NotificationSettingsView>("/notification-settings"),
    enabled,
  });
}

export function useSaveNotificationSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: Partial<NotificationSettings> & { answered?: boolean }) =>
      apiPut<NotificationSettingsView>("/notification-settings", change),
    onSuccess: (view) => client.setQueryData(["notification-settings"], view),
  });
}

/**
 * This device's state, checked once per open (the shell mounts it on every
 * signed-in screen) and after every turn-on. The check never prompts.
 */
export function useThisDevice(enabled = true) {
  const client = useQueryClient();
  const settings = useNotificationSettings(enabled);
  const vapidKey = settings.data?.vapidPublicKey;
  const check = useQuery({
    queryKey: ["this-device", vapidKey ?? null],
    queryFn: () => checkThisDevice(vapidKey ?? null).catch((): DeviceState => "stopped"),
    enabled: settings.data !== undefined,
    staleTime: Infinity,
    retry: false,
  });

  const [turningOn, setTurningOn] = useState(false);
  // A plain call, not a mutation: the permission prompt has to start inside
  // the tap, before anything is awaited.
  const turnOn = () => {
    if (!vapidKey) return;
    setTurningOn(true);
    void turnOnThisDevice(vapidKey)
      .catch((): DeviceState => "stopped")
      .then(async (state) => {
        client.setQueryData(["this-device", vapidKey], state);
        await client.invalidateQueries({ queryKey: ["notification-settings"] });
      })
      .finally(() => setTurningOn(false));
  };

  return {
    state: (check.data ?? "checking") as DeviceState | "checking",
    turnOn,
    turningOn,
  };
}
