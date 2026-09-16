import { describe, expect, it } from "vitest";
import { bucketForAccountKind, MissingPriceError, poundsPerUnit, toPencePounds } from "./value.js";

const fx = new Map([
  ["USD", 1.3452],
  ["EUR", 1.1655],
]);

describe("valuing a holding in pounds", () => {
  it("takes pence as a hundredth of a pound", () => {
    // 56.857 Greggs at 1,749p = £994.43
    expect(toPencePounds(56.85714285, 1749, "GBX", fx)).toBe(99_443);
  });

  it("converts dollars and euros at the GBP rate", () => {
    expect(toPencePounds(12.49015855, 215.405, "USD", fx)).toBe(200_003);
    expect(toPencePounds(0.83273192, 1398.2, "EUR", fx)).toBe(99_899);
  });

  it("leaves pounds alone", () => {
    expect(poundsPerUnit("GBP", fx)).toBe(1);
    expect(toPencePounds(7.24270297, 137.98, "GBP", fx)).toBe(99_935);
  });

  it("refuses to guess an exchange rate it doesn't have", () => {
    expect(() => poundsPerUnit("CHF", fx)).toThrow(MissingPriceError);
  });

  it("puts ISA money in Foundation and Invest money in Handpicked", () => {
    expect(bucketForAccountKind("isa")).toBe("Base");
    expect(bucketForAccountKind("invest")).toBe("Medium");
    expect(() => bucketForAccountKind("sipp")).toThrow();
  });
});
