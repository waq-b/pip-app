import { describe, expect, it } from "vitest";
import {
  changeTone,
  formatChange,
  formatPercent,
  formatPounds,
  formatSignedPounds,
  MINUS,
  splitPounds,
} from "./format";

describe("formatPounds", () => {
  it("formats pence as pounds with commas", () => {
    expect(formatPounds(1_143_018)).toBe("£11,430.18");
  });

  it("can drop the pence", () => {
    expect(formatPounds(78_000, { whole: true })).toBe("£780");
  });

  it("uses a true minus sign, not a hyphen", () => {
    expect(formatPounds(-3_420)).toBe(`${MINUS}£34.20`);
    expect(formatPounds(-3_420)).not.toContain("-");
  });
});

describe("formatSignedPounds", () => {
  it("marks gains and losses", () => {
    expect(formatSignedPounds(2_580)).toBe("+£25.80");
    expect(formatSignedPounds(-3_420)).toBe(`${MINUS}£34.20`);
  });

  it("gives zero no sign, because nothing moved", () => {
    expect(formatSignedPounds(0)).toBe("£0.00");
  });
});

describe("splitPounds", () => {
  it("splits the hero number so the pence can be set smaller", () => {
    expect(splitPounds(1_143_018)).toEqual({ whole: "£11,430", fraction: ".18" });
  });

  it("pads single-digit pence", () => {
    expect(splitPounds(100_005)).toEqual({ whole: "£1,000", fraction: ".05" });
  });

  it("truncates the pounds rather than rounding them up", () => {
    expect(splitPounds(1_143_099)).toEqual({ whole: "£11,430", fraction: ".99" });
  });
});

describe("formatPercent", () => {
  it("drops needless decimals", () => {
    expect(formatPercent(56)).toBe("56%");
    expect(formatPercent(0.23)).toBe("0.23%");
  });

  it("can sign a gain, and always signs a loss", () => {
    expect(formatPercent(0.23, { signed: true })).toBe("+0.23%");
    expect(formatPercent(-4.2)).toBe(`${MINUS}4.2%`);
  });
});

describe("formatChange", () => {
  it("always puts the money before the percentage", () => {
    const text = formatChange({ amount: 2_580, percent: 0.23, direction: "up" });

    expect(text).toBe("+£25.80 · +0.23%");
    expect(text.indexOf("£")).toBeLessThan(text.indexOf("%"));
  });

  it("carries the loss through both halves", () => {
    expect(formatChange({ amount: -3_420, percent: -4.2, direction: "down" })).toBe(
      `${MINUS}£34.20 · ${MINUS}4.2%`,
    );
  });
});

describe("changeTone", () => {
  it("colours gains, losses and stillness differently — and stillness is never green", () => {
    expect(changeTone({ direction: "up" })).toBe("text-up");
    expect(changeTone({ direction: "down" })).toBe("text-dn");
    expect(changeTone({ direction: "flat" })).toBe("text-ink3");
  });
});
