import { BUCKETS, type Bucket } from "@finance-app/shared";
import { describe, expect, it } from "vitest";
import { allStubPositions, StubProvider } from "./index.js";

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

  it("hands out copies, so a caller can't mutate the fixtures", async () => {
    const provider = new StubProvider("Medium");
    const first = await provider.getPositions();
    first[0]!.value = 1;

    const second = await provider.getPositions();
    expect(second[0]!.value).not.toBe(1);
  });
});

describe("bucket integrity", () => {
  it("never lists the same holding in two pots", async () => {
    const seen = new Map<string, Bucket>();

    for (const { bucket, position } of allStubPositions()) {
      expect(seen.has(position.id), `${position.id} appears in two pots`).toBe(false);
      seen.set(position.id, bucket);
    }
  });

  it("keeps Rolls-Royce in Handpicked, not in the ISA", async () => {
    // The design prototype's feed had ISA money buying Rolls-Royce. It doesn't
    // here, and it must never start doing so (hard line 11).
    const found = allStubPositions().find(({ position }) => position.id === "rolls-royce");

    expect(found?.bucket).toBe("Medium");
  });

  it("gives every pot holdings, so no screen is accidentally empty", async () => {
    for (const bucket of BUCKETS) {
      await expect(new StubProvider(bucket).getPositions()).resolves.not.toHaveLength(0);
    }
  });

  it("stops topping up Side Bet once it reached its line", async () => {
    const history = await new StubProvider("Degen").getHistory();

    expect(history.at(-1)?.amount).toBe(0);
  });
});
