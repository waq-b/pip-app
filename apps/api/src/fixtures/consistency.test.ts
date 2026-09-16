import { describe, expect, it } from "vitest";
import { stubSeriesAnchors } from "../market/stub/anchors.js";
import { buildSeries, priceFor } from "../market/stub/index.js";
import { allStubPositions } from "../providers/stub/index.js";
import { INSTRUMENT_FIXTURES } from "./portfolio.js";

/**
 * Stub data is still data someone reads. A screen that says "+£4.10 · +2.9%"
 * about £720 is wrong on its face, so the fixtures have to agree with themselves.
 */
describe("stub holdings agree with themselves", () => {
  const holdings = allStubPositions().map(({ position }) => ({
    position,
    fixture: INSTRUMENT_FIXTURES[position.id]!,
  }));

  const impliedPercent = (amount: number, value: number) => (amount / (value - amount)) * 100;

  it("has a fixture for every holding", () => {
    for (const { position, fixture } of holdings) expect(fixture, position.id).toBeDefined();
  });

  it("states today's percent to match today's pounds", () => {
    for (const { position, fixture } of holdings) {
      const implied = impliedPercent(fixture.today.amount, position.value);
      expect(Math.abs(fixture.today.percent - implied), position.id).toBeLessThan(0.1);
    }
  });

  it("states since-you-bought to match what was paid", () => {
    for (const { position, fixture } of holdings) {
      const gain = position.value - position.quantity * position.averagePrice;
      expect(Math.abs(fixture.sinceBought.amount - gain), position.id).toBeLessThan(
        position.value * 0.015,
      );

      const implied = impliedPercent(fixture.sinceBought.amount, position.value);
      expect(Math.abs(fixture.sinceBought.percent - implied), position.id).toBeLessThan(0.5);
    }
  });

  it("values each holding at its market price", () => {
    for (const { position } of holdings) {
      const priced = position.quantity * priceFor(position.id);
      expect(Math.abs(priced - position.value), position.id).toBeLessThan(position.value * 0.01);
    }
  });

  it("starts the All chart at the price paid and the Day chart at this morning's price", () => {
    const anchors = stubSeriesAnchors();
    const now = new Date("2026-09-16T10:00:00Z");

    for (const { position } of holdings) {
      const all = buildSeries(position.id, "all", now, anchors[position.id]!.boughtAt);
      expect(all[0]!.value, position.id).toBe(position.averagePrice);
      expect(all.at(-1)!.value, position.id).toBe(priceFor(position.id));

      const day = buildSeries(position.id, "day", now, anchors[position.id]!.openedAt);
      expect(day[0]!.value, position.id).toBe(anchors[position.id]!.openedAt);
    }
  });
});
