import { describe, expect, it } from "vitest";

/**
 * DESIGN.md §3: every colour is a token. Globbed rather than listed, so a
 * component added later is covered without anyone remembering to add it here.
 * Sources arrive via Vite's `?raw`, so the test needs no Node APIs.
 */
const HEX = /#[0-9a-f]{3,8}\b/i;

const sources = import.meta.glob<string>("./*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

const components = Object.entries(sources).filter(([path]) => !path.includes(".test."));

describe("no hex colours in components", () => {
  it("actually found the components, rather than passing vacuously", () => {
    expect(components.length).toBeGreaterThanOrEqual(9);
  });

  it.each(components)("%s carries no hex value", (_path, source) => {
    expect(source).not.toMatch(HEX);
  });
});
