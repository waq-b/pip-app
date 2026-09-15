import { describe, expect, it } from "vitest";
import { BUCKETS } from "./buckets";

describe("BUCKETS", () => {
  it("has exactly the three buckets CLAUDE.md defines, in order", () => {
    expect(BUCKETS).toEqual(["Base", "Medium", "Degen"]);
  });
});
