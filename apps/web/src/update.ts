import { registerSW } from "virtual:pwa-register";

/** Longest the launch splash waits for the update check, so a slow network never holds the app. */
export const CHECK_MS = 3000;
/** If applying an update hasn't reloaded the page by now, show the app anyway. */
const RELOAD_GRACE_MS = 5000;

/**
 * Opening the app: look for a new version before showing it (ported from
 * Terpa). If one is already waiting, or arrives within CHECK_MS, it's applied
 * and the page reloads into it with the splash up throughout. Otherwise the app
 * carries on as it is, and an update found later waits for the next launch
 * rather than reloading the page mid-use.
 *
 * Without this an installed app kept running the old build after a deploy —
 * on iPhone often for a relaunch or two (found with sign-in by code,
 * 2026-09-17).
 *
 * Resolves when the app should be shown. Off in dev, without service workers,
 * and offline.
 */
export function checkForUpdate(
  enabled = !import.meta.env.DEV && "serviceWorker" in navigator && navigator.onLine,
): Promise<void> {
  if (!enabled) return Promise.resolve();
  return new Promise((resolve) => {
    let launching = true;
    const show = () => {
      if (!launching) return;
      launching = false;
      resolve();
    };
    const timer = setTimeout(show, CHECK_MS);
    const updateSW = registerSW({
      immediate: true,
      // A new version is installed and waiting. Take it only while the splash is up.
      onNeedRefresh() {
        if (!launching) return;
        launching = false;
        clearTimeout(timer);
        setTimeout(resolve, RELOAD_GRACE_MS);
        void updateSW(true);
      },
      // First install: nothing older to replace.
      onOfflineReady: show,
      onRegisteredSW(_url, registration) {
        if (!registration?.active) return show(); // first visit: nothing to update from
        if (registration.waiting) return; // onNeedRefresh takes it from here
        registration.update().then(() => {
          if (!registration.installing && !registration.waiting) show();
        }, show);
      },
      onRegisterError: show,
    });
  });
}

/** Shortest time the launch splash shows, so it doesn't just flash. */
export const SPLASH_MIN_MS = 600;

/** Checks for an update behind the static splash in index.html, then fades it out. */
export function launch(check: () => Promise<void> = checkForUpdate): Promise<void> {
  return Promise.all([check(), new Promise((resolve) => setTimeout(resolve, SPLASH_MIN_MS))]).then(
    () => {
      const splash = document.getElementById("splash");
      if (!splash) return;
      splash.classList.add("is-leaving");
      setTimeout(() => splash.remove(), 400);
    },
  );
}
