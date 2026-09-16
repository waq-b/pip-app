import { describe, expect, it } from "vitest";
import { BUCKETS, BUCKET_META, displayNameFor, type Bucket } from "./buckets";

describe("BUCKETS", () => {
  it("has exactly the three buckets CLAUDE.md defines, in order", () => {
    expect(BUCKETS).toEqual(["Base", "Medium", "Degen"]);
  });
});

describe("BUCKET_META", () => {
  it("covers every bucket", () => {
    expect(Object.keys(BUCKET_META).sort()).toEqual([...BUCKETS].sort());
  });

  it("maps each bucket to the display name DESIGN.md gives it", () => {
    expect(displayNameFor("Base")).toBe("Foundation");
    expect(displayNameFor("Medium")).toBe("Handpicked");
    expect(displayNameFor("Degen")).toBe("Side Bet");
  });

  it("gives each bucket its own accent scope", () => {
    const scopes = BUCKETS.map((b) => BUCKET_META[b].scope);
    expect(new Set(scopes).size).toBe(BUCKETS.length);
  });

  it("routes Base and Medium to Trading 212, and Degen to Kraken", () => {
    expect(BUCKET_META.Base.provider).toBe("Trading 212");
    expect(BUCKET_META.Medium.provider).toBe("Trading 212");
    expect(BUCKET_META.Degen.provider).toBe("Kraken");
  });

  it("never leaks an internal id as a display name", () => {
    for (const bucket of BUCKETS) {
      expect(BUCKET_META[bucket].displayName).not.toBe(bucket);
    }
  });

  it("keeps display names out of the bucket ids", () => {
    // Guards the decision in phase-1.md: renaming a pot in the UI must never
    // require an API or database change.
    const ids: Bucket[] = [...BUCKETS];
    expect(ids).not.toContain("Foundation" as unknown as Bucket);
  });
});
