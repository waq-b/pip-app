import { describe, expect, it } from "vitest";
import {
  evaluateRecommendations,
  memoryTriggerStateStore,
  step,
  type TriggerInput,
} from "./triggers.js";

/**
 * When Pip recommends a course of action (phase-6.md decision 14). The point
 * of every test here: one crossing makes one recommendation, and a value that
 * flickers with prices never makes two.
 */

const minutes = (n: number) => n * 60_000;
const at = (offsetMinutes: number) =>
  new Date(Date.parse("2026-09-17T09:00:00Z") + minutes(offsetMinutes));

function input(overrides: Partial<TriggerInput> = {}, now = at(0)): TriggerInput {
  return {
    now,
    day: now.toISOString().slice(0, 10),
    sideBet: null,
    holdings: [],
    pots: [],
    ...overrides,
  };
}

/** Net assets of £64,000 make a £6,400 limit; 10.5% of net assets is £6,720. */
const sideBet = (valuePounds: number) => ({ valuePence: valuePounds * 100, limitPence: 640_000 });

const run = async (
  store: ReturnType<typeof memoryTriggerStateStore>,
  overrides: Partial<TriggerInput>,
  offsetMinutes: number,
) => evaluateRecommendations(store, "user-1", input(overrides, at(offsetMinutes)));

describe("the calmer rule (step)", () => {
  const on = { on: true, clear: false };
  const off = { on: false, clear: true };

  it("fires at once without confirmation", () => {
    expect(step(null, on, false, at(0))).toMatchObject({ fire: true, next: { state: "fired" } });
  });

  it("with confirmation, waits for a second sighting at least 20 minutes on", () => {
    const first = step(null, on, true, at(0));
    expect(first).toMatchObject({ fire: false, next: { state: "pending" } });

    const tooSoon = step(first.next, on, true, at(10));
    expect(tooSoon).toMatchObject({ fire: false, next: { state: "pending" } });

    expect(step(first.next, on, true, at(20))).toMatchObject({
      fire: true,
      next: { state: "fired" },
    });
  });

  it("drops a pending condition that doesn't hold on the next refresh", () => {
    const first = step(null, on, true, at(0));
    expect(step(first.next, off, true, at(30))).toMatchObject({
      fire: false,
      next: { state: "clear" },
    });
  });
});

describe("R1 — Side Bet's value past 10% of net assets", () => {
  it("recommends taking the excess, once, after two refreshes past 10.5%", async () => {
    const store = memoryTriggerStateStore();
    expect(await run(store, { sideBet: sideBet(6_800) }, 0)).toEqual([]);

    const [hit] = await run(store, { sideBet: sideBet(6_800) }, 30);
    expect(hit).toMatchObject({
      trigger: "side_bet_over_limit",
      recommendation: "take_some_profit",
      amountPence: 40_000,
      bucket: "Degen",
      urgent: true,
    });

    // Still past it: the same crossing, so nothing new.
    expect(await run(store, { sideBet: sideBet(7_000) }, 60)).toEqual([]);
  });

  it("doesn't count being a hair over 10%: the half-point margin is the point", async () => {
    const store = memoryTriggerStateStore();
    for (const minute of [0, 30, 60]) {
      expect(await run(store, { sideBet: sideBet(6_700) }, minute)).toEqual([]);
    }
  });

  it("makes one recommendation through a flicker of 10.4 / 10.6 / 10.4 / 10.6 / 10.6", async () => {
    const store = memoryTriggerStateStore();
    // £6,656 is 10.4%, £6,784 is 10.6%.
    const values = [6_656, 6_784, 6_656, 6_784, 6_784];
    const hits = [];
    for (const [i, value] of values.entries()) {
      hits.push(...(await run(store, { sideBet: sideBet(value) }, i * 30)));
    }
    expect(hits).toHaveLength(1);
  });

  it("can speak again only once Side Bet is clearly back under, twice", async () => {
    const store = memoryTriggerStateStore();
    await run(store, { sideBet: sideBet(6_800) }, 0);
    await run(store, { sideBet: sideBet(6_800) }, 30);

    // Under 9.5% on two refreshes clears it; back over 10.5% on two fires again.
    await run(store, { sideBet: sideBet(6_000) }, 60);
    await run(store, { sideBet: sideBet(6_000) }, 90);
    await run(store, { sideBet: sideBet(6_800) }, 120);
    expect(await run(store, { sideBet: sideBet(6_800) }, 150)).toHaveLength(1);
  });

  it("says nothing on the starter limit — it isn't 10% of anything", async () => {
    const store = memoryTriggerStateStore();
    for (const minute of [0, 30]) {
      expect(await run(store, { sideBet: null }, minute)).toEqual([]);
    }
  });
});

describe("R2 — a holding worth three times what went in", () => {
  const nvidia = (valuePounds: number) => ({
    instrumentId: "NVDA_US_EQ",
    name: "Nvidia",
    bucket: "Medium" as const,
    valuePence: valuePounds * 100,
    costPence: 100_000,
    dayMovePercent: null,
    moveLine: 7,
  });

  it("recommends taking the stake out, the first time it's seen", async () => {
    const store = memoryTriggerStateStore();
    const [hit] = await run(store, { holdings: [nvidia(3_000)] }, 0);
    expect(hit).toMatchObject({
      trigger: "holding_multiple",
      recommendation: "take_some_profit",
      amountPence: 100_000,
      instrumentId: "NVDA_US_EQ",
      urgent: true,
    });
    expect(hit!.facts).toMatchObject({ multiple: 3 });
  });

  it("re-arms only under 2.5×", async () => {
    const store = memoryTriggerStateStore();
    await run(store, { holdings: [nvidia(3_000)] }, 0);
    // Dips to 2.6× and back: the same crossing.
    await run(store, { holdings: [nvidia(2_600)] }, 30);
    expect(await run(store, { holdings: [nvidia(3_100)] }, 60)).toEqual([]);
    // Down to 2.4×, then back to 3×: a new crossing.
    await run(store, { holdings: [nvidia(2_400)] }, 90);
    expect(await run(store, { holdings: [nvidia(3_000)] }, 120)).toHaveLength(1);
  });

  it("stays quiet when what was paid isn't known", async () => {
    const store = memoryTriggerStateStore();
    expect(await run(store, { holdings: [{ ...nvidia(9_000), costPence: null }] }, 0)).toEqual([]);
  });
});

describe("R3 — a pot off its target", () => {
  it("fires for Handpicked five points over, after two refreshes, and never pushes", async () => {
    const store = memoryTriggerStateStore();
    const over = { pots: [{ bucket: "Medium" as const, driftPoints: 6, offTargetPence: 60_000 }] };
    expect(await run(store, over, 0)).toEqual([]);
    const [hit] = await run(store, over, 30);
    expect(hit).toMatchObject({
      trigger: "pot_off_target",
      recommendation: "rebalance",
      amountPence: 60_000,
      urgent: false,
    });
  });

  it("fires for Foundation five points under, not over", async () => {
    const store = memoryTriggerStateStore();
    const under = { pots: [{ bucket: "Base" as const, driftPoints: -5, offTargetPence: -50_000 }] };
    await run(store, under, 0);
    expect(await run(store, under, 30)).toHaveLength(1);

    const other = memoryTriggerStateStore();
    const over = { pots: [{ bucket: "Base" as const, driftPoints: 8, offTargetPence: 80_000 }] };
    await run(other, over, 0);
    expect(await run(other, over, 30)).toEqual([]);
  });
});

describe("R4 — a holding past twice its pot's move line today", () => {
  const moving = (percent: number, valuePounds = 1_500) => ({
    instrumentId: "ASMLa_EQ",
    name: "ASML",
    bucket: "Medium" as const,
    valuePence: valuePounds * 100,
    costPence: 100_000,
    dayMovePercent: percent,
    moveLine: 7,
  });

  it("recommends holding — one day isn't a reason — once per holding per day", async () => {
    const store = memoryTriggerStateStore();
    const [hit] = await run(store, { holdings: [moving(-16)] }, 0);
    expect(hit).toMatchObject({ trigger: "urgent_move", recommendation: "hold", urgent: true });
    expect(await run(store, { holdings: [moving(-18)] }, 30)).toEqual([]);

    const tomorrow = new Date("2026-09-18T09:00:00Z");
    const next = await evaluateRecommendations(
      store,
      "user-1",
      input({ holdings: [moving(-15)] }, tomorrow),
    );
    expect(next).toHaveLength(1);
  });

  it("takes R2's side when the holding is also three times its stake", async () => {
    const store = memoryTriggerStateStore();
    const hits = await run(store, { holdings: [moving(15, 3_000)] }, 0);
    const move = hits.find((hit) => hit.trigger === "urgent_move")!;
    expect(move).toMatchObject({ recommendation: "take_some_profit", amountPence: 100_000 });
  });

  it("ignores a move under twice the line", async () => {
    const store = memoryTriggerStateStore();
    expect(await run(store, { holdings: [moving(13.9)] }, 0)).toEqual([]);
  });
});

describe("the state it keeps", () => {
  it("gives each confirmed crossing its own event id, which is what a push is keyed by", async () => {
    const store = memoryTriggerStateStore();
    const nvidia = {
      instrumentId: "NVDA_US_EQ",
      name: "Nvidia",
      bucket: "Medium" as const,
      valuePence: 300_000,
      costPence: 100_000,
      dayMovePercent: null,
      moveLine: 7,
    };
    const [first] = await run(store, { holdings: [nvidia] }, 0);
    await run(store, { holdings: [{ ...nvidia, valuePence: 200_000 }] }, 30);
    const [second] = await run(store, { holdings: [nvidia] }, 60);
    expect(first!.eventId).not.toBe(second!.eventId);
  });
});
