/**
 * Appearance follows the device unless someone has chosen otherwise
 * (DESIGN.md §7, Setup). The choice is a per-device convenience, so it lives in
 * localStorage rather than on the server — and every access is wrapped, because
 * storage throws in private mode rather than returning null.
 */
export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "pip.appearance";

export function readThemeChoice(storage: Storage | undefined = safeStorage()): ThemeChoice {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function storeThemeChoice(
  choice: ThemeChoice,
  storage: Storage | undefined = safeStorage(),
): void {
  try {
    if (choice === "system") storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // A viewer who blocks storage still gets a working theme for this visit.
  }
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === "system") return prefersDark ? "dark" : "light";
  return choice;
}

/**
 * Only ever writes the attribute for an explicit choice. Leaving it off for
 * "system" is what lets the CSS media query stay in charge, so the app follows
 * the device live rather than at page load.
 */
export function applyThemeChoice(choice: ThemeChoice, root: HTMLElement): void {
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

export function prefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
