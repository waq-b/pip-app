import "@testing-library/jest-dom/vitest";

/**
 * jsdom has no matchMedia, and the shell decides between the tab bar, the rail
 * and the sidebar with it. This stub answers `(min-width: Npx)` against a width
 * the test sets, and notifies listeners when that width changes.
 */
let viewportWidth = 390;

type Listener = (event: MediaQueryListEvent) => void;
const listeners = new Set<{ query: string; listener: Listener }>();

function matches(query: string): boolean {
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  if (min) return viewportWidth >= Number(min[1]);

  const max = /\(max-width:\s*(\d+)px\)/.exec(query);
  if (max) return viewportWidth <= Number(max[1]);

  return false;
}

export function setViewportWidth(width: number): void {
  viewportWidth = width;
  for (const { query, listener } of listeners) {
    listener({ matches: matches(query), media: query } as MediaQueryListEvent);
  }
}

/** Phone is the reference frame, so every test starts there unless it says otherwise. */
export const PHONE_WIDTH = 390;
export const TABLET_WIDTH = 834;
export const DESKTOP_WIDTH = 1280;

window.matchMedia = ((query: string) => {
  const entry = { query, listener: (() => {}) as Listener };

  return {
    get matches() {
      return matches(query);
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: Listener) => {
      entry.listener = listener;
      listeners.add(entry);
    },
    removeEventListener: () => {
      listeners.delete(entry);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;
}) as typeof window.matchMedia;
