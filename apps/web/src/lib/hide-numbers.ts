import { useSyncExternalStore } from "react";

/**
 * "Hide the numbers" (Setup): blur totals until you tap. A per-device
 * convenience like appearance, so it lives in localStorage — and every access
 * is wrapped, because storage throws in private mode.
 */
export const HIDE_NUMBERS_STORAGE_KEY = "pip.hide-numbers";

const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(HIDE_NUMBERS_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setHideNumbers(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(HIDE_NUMBERS_STORAGE_KEY, "on");
    else window.localStorage.removeItem(HIDE_NUMBERS_STORAGE_KEY);
  } catch {
    // Blocked storage: the switch simply doesn't stick.
  }
  for (const listener of listeners) listener();
}

export function useHideNumbers(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
