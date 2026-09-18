import { registerSW } from "virtual:pwa-register";

/** Longest the launch splash waits for the update check, so a slow network never holds the app. */
export const CHECK_MS = 3000;
/** If applying an update hasn't reloaded the page by now, show the app anyway. */
const RELOAD_GRACE_MS = 5000;
/**
 * How long the splash waits, all told, when a new version is already
 * downloading at CHECK_MS. A phone can take longer than 3s to fetch a new
 * build; giving up then left it half-installed for a later launch, and a
 * deploy in between restarted it — so an installed iPhone app could stay on
 * the old build for launch after launch (found 2026-09-18).
 */
export const INSTALLING_MAX_MS = 15000;

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
    let registration: ServiceWorkerRegistration | undefined;
    // At CHECK_MS, an update that's already downloading gets its chance to finish.
    let timer = setTimeout(() => {
      if (registration?.installing) timer = setTimeout(show, INSTALLING_MAX_MS - CHECK_MS);
      else show();
    }, CHECK_MS);
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
      onRegisteredSW(_url, found) {
        registration = found;
        if (!found?.active) return show(); // first visit: nothing to update from
        if (found.waiting) return; // onNeedRefresh takes it from here
        found.update().then(() => {
          if (!found.installing && !found.waiting) show();
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
