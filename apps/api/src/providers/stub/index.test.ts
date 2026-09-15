import { describe, expect, it } from "vitest";
import { StubProvider } from "./index.js";

describe("StubProvider", () => {
  it("returns fake data for each bucket without any network call", async () => {
    const base = new StubProvider("Base");

    await expect(base.getPositions()).resolves.not.toHaveLength(0);
    await expect(base.getCash()).resolves.toMatchObject({ currency: "GBP" });
    await expect(base.getHistory()).resolves.not.toHaveLength(0);
  });

  it("keeps buckets isolated from one another", async () => {
    const base = new StubProvider("Base");
    const degen = new StubProvider("Degen");

    const [basePositions, degenPositions] = await Promise.all([
      base.getPositions(),
      degen.getPositions(),
    ]);

    expect(basePositions).not.toEqual(degenPositions);
  });
});
