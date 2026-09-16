import { beforeEach, describe, expect, it } from "vitest";
import {
  applyThemeChoice,
  readThemeChoice,
  resolveTheme,
  storeThemeChoice,
  THEME_STORAGE_KEY,
} from "./theme";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

/** Storage throws rather than returning null in a locked-down browser. */
const hostileStorage = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
  removeItem: () => {
    throw new Error("denied");
  },
} as unknown as Storage;

describe("resolveTheme", () => {
  it("follows the device when nobody has chosen", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("obeys an explicit choice whatever the device says", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("the stored choice", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("defaults to following the device", () => {
    expect(readThemeChoice(storage)).toBe("system");
  });

  it("round-trips an explicit choice", () => {
    storeThemeChoice("dark", storage);
    expect(readThemeChoice(storage)).toBe("dark");
  });

  it("forgets the choice when you go back to following the device", () => {
    storeThemeChoice("dark", storage);
    storeThemeChoice("system", storage);

    expect(storage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(readThemeChoice(storage)).toBe("system");
  });

  it("ignores a value it doesn't recognise", () => {
    storage.setItem(THEME_STORAGE_KEY, "neon");
    expect(readThemeChoice(storage)).toBe("system");
  });

  it("survives a browser that refuses storage", () => {
    expect(() => storeThemeChoice("dark", hostileStorage)).not.toThrow();
    expect(readThemeChoice(hostileStorage)).toBe("system");
  });
});

describe("applyThemeChoice", () => {
  it("leaves the attribute off for system, so the media query stays in charge", () => {
    const root = document.createElement("html");
    root.setAttribute("data-theme", "dark");

    applyThemeChoice("system", root);

    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("pins the attribute for an explicit choice", () => {
    const root = document.createElement("html");

    applyThemeChoice("dark", root);
    expect(root.getAttribute("data-theme")).toBe("dark");

    applyThemeChoice("light", root);
    expect(root.getAttribute("data-theme")).toBe("light");
  });
});
