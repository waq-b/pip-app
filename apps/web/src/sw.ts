/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { parsePush, safePath } from "./sw-message";

/**
 * Pip's service worker (Phase 6 task 7). Built with `injectManifest` so it
 * can take pushes as well as keeping the app offline-ready:
 *
 * - precache the built app, and answer every page load with `index.html`
 *   (never `/api`, which is always the network);
 * - `SKIP_WAITING` from `update.ts`, so a new version still only takes over
 *   behind the launch splash;
 * - `push`: show what the server sent — a title, a body and the screen to open.
 *   It never holds anything that could move money (hard line 1);
 * - `notificationclick`: open that screen, in Pip if it's already open;
 * - `pushsubscriptionchange`: subscribe again with the same key. The worker
 *   has no sign-in, so the app tells the server on its next open.
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[];
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), { denylist: [/^\/api\//] }),
);

self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("push", (event) => {
  const message = parsePush(event.data?.text() ?? null);
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: "/pwa-192.png",
      badge: "/pwa-192.png",
      data: { url: message.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safePath((event.notification.data as { url?: unknown } | null)?.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        await open.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  const change = event as Event & {
    oldSubscription?: PushSubscription | null;
    waitUntil(promise: Promise<unknown>): void;
  };
  const key = change.oldSubscription?.options.applicationServerKey;
  if (!key) return;
  change.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .catch(() => undefined),
  );
});
