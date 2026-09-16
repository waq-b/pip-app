import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import appShellSource from "./app-shell.tsx?raw";
import navSource from "./nav.ts?raw";
import { PipMark, SMALL_CUT_BELOW } from "./pip-mark";
import pipMarkSource from "./pip-mark.tsx?raw";

function radii(size: number): number[] {
  const { container } = render(<PipMark size={size} />);
  return [...container.querySelectorAll("circle")].map((circle) =>
    Number(circle.getAttribute("r")),
  );
}

describe("PipMark", () => {
  it("always draws all three seeds", () => {
    for (const size of [16, 26, 47, 48, 180]) {
      expect(radii(size)).toHaveLength(3);
    }
  });

  it("switches to the small cut below 48px, so the third seed survives", () => {
    expect(radii(SMALL_CUT_BELOW - 1)).toEqual([13.5, 11.5, 9]);
    expect(radii(26)).toEqual([13.5, 11.5, 9]);
  });

  it("keeps the standard cut from 48px up", () => {
    expect(radii(SMALL_CUT_BELOW)).toEqual([13, 10, 6.5]);
    expect(radii(180)).toEqual([13, 10, 6.5]);
  });

  it("takes its colours from the theme, so it changes palette in dark mode", () => {
    const { container } = render(<PipMark size={26} />);
    const fills = [...container.querySelectorAll("circle")].map((c) => c.getAttribute("fill"));

    expect(fills).toEqual(["var(--pip-seed-fnd)", "var(--pip-seed-pick)", "var(--pip-seed-bet)"]);
  });
});

describe("no hex colours in components", () => {
  /**
   * DESIGN.md §3: every colour is a token. Enforced across the shell rather
   * than trusted, because two slipped through before this test existed — both
   * of them breaking dark mode. Sources come in via Vite's `?raw` so the test
   * needs no Node APIs, which the browser app's types deliberately lack.
   */
  const HEX = /#[0-9a-f]{3,8}\b/i;

  it.each([
    ["app-shell.tsx", appShellSource],
    ["pip-mark.tsx", pipMarkSource],
    ["nav.ts", navSource],
  ])("%s carries no hex value", (_file, source) => {
    expect(source).not.toMatch(HEX);
  });
});
