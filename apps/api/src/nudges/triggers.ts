import {
  CONFIRM_MIN_GAP_MS,
  HOLDING_MULTIPLE,
  HOLDING_REARM_MULTIPLE,
  R1_MARGIN_POINTS,
  R3_DRIFT_POINTS,
  R3_REARM_POINTS,
  URGENT_MOVE_MULTIPLIER,
  type Bucket,
  type Pence,
  type Recommendation,
  type RecommendationState,
  type RecommendationTrigger,
} from "@finance-app/shared";

/**
 * When Pip recommends a course of action (phase-6.md decision 14, CLAUDE.md
 * hard line 12). For Waqar only — personal research on — and never a
 * forecast: every trigger here is about what is true *now*, measured against
 * his own rules and ordinary discipline.
 *
 * Code decides everything that matters: whether a trigger fired, what the
 * recommended course is, and every amount. The writer only explains it
 * (hard line 2). This file is pure — no clock, no database — so the same
 * facts always give the same answer.
 *
 * | #  | Trigger                              | Default          | Push |
 * | R1 | Side Bet's value past 10% of net assets (+0.5 points, confirmed) | take some profit | yes |
 * | R2 | A holding worth 3× what went in      | take some profit (your stake) | yes |
 * | R3 | Handpicked 5+ points over / Foundation 5+ under, confirmed | rebalance | no |
 * | R4 | A holding past twice its pot's move line today | hold | yes |
 */

export interface TriggerInput {
  now: Date;
  /** The London day, for R4's one-per-holding-per-day. */
  day: string;
  /** Null until net assets are set: the starter limit isn't 10% of anything. */
  sideBet: { valuePence: Pence; limitPence: Pence } | null;
  holdings: {
    instrumentId: string;
    name: string;
    bucket: Bucket;
    valuePence: Pence;
    /** Null when what was paid isn't known yet. */
    costPence: Pence | null;
    dayMovePercent: number | null;
    /** The pot's own big-move line, in percent. */
    moveLine: number;
  }[];
  /** Foundation and Handpicked, judged against their targets. */
  pots: { bucket: "Base" | "Medium"; driftPoints: number | null; offTargetPence: Pence }[];
}

export interface StoredTriggerState {
  trigger: RecommendationTrigger;
  subject: string;
  state: RecommendationState;
  eventId: string | null;
  since: Date;
}

export interface RecommendationHit {
  trigger: RecommendationTrigger;
  subject: string;
  recommendation: Recommendation;
  /** What code worked out: the pounds that would follow the recommendation. */
  amountPence: Pence | null;
  bucket: Bucket;
  instrumentId: string | null;
  name: string;
  /** Pushed straight away (R1, R2, R4); R3 waits in the bell and the week. */
  urgent: boolean;
  /** The figures the brief is built from, frozen into the log. */
  facts: Record<string, unknown>;
}

/** Whether a condition is on or off this refresh, and whether it's clearly off. */
interface Reading {
  on: boolean;
  /** Clearly back — the re-arm line, not just below the trigger line. */
  clear: boolean;
}

export interface Transition {
  next: Pick<StoredTriggerState, "state" | "since"> & { newEvent: boolean };
  /** True the moment a crossing is confirmed: that's when one brief is made. */
  fire: boolean;
}

/**
 * The calmer rule as a state machine. With `confirm`, a condition has to be
 * seen on two refreshes at least `CONFIRM_MIN_GAP_MS` apart before it counts,
 * and has to be clearly gone on two before the trigger can fire again. Without
 * it (R2, R4), one sighting fires and the re-arm line does the calming.
 */
export function step(
  current: Pick<StoredTriggerState, "state" | "since"> | null,
  reading: Reading,
  confirm: boolean,
  now: Date,
): Transition {
  const state = current?.state ?? "clear";
  const since = current?.since ?? now;
  const settled = now.getTime() - since.getTime() >= CONFIRM_MIN_GAP_MS;
  const stay = { state, since, newEvent: false };
  const to = (next: RecommendationState, fire = false, newEvent = false): Transition => ({
    next: { state: next, since: now, newEvent },
    fire,
  });

  switch (state) {
    case "clear":
      if (!reading.on) return { next: stay, fire: false };
      return confirm ? to("pending") : to("fired", true, true);
    case "pending":
      if (!reading.on) return to("clear");
      return settled ? to("fired", true, true) : { next: stay, fire: false };
    case "fired":
      if (!reading.clear) return { next: stay, fire: false };
      return confirm ? to("pending_clear") : to("clear");
    case "pending_clear":
      if (!reading.clear) return to("fired");
      return settled ? to("clear") : { next: stay, fire: false };
  }
}

const pounds = (pence: Pence) => Math.round(pence / 100);

/** Every trigger's reading this refresh, before state is consulted. */
export function readTriggers(input: TriggerInput) {
  const readings: {
    trigger: RecommendationTrigger;
    subject: string;
    reading: Reading;
    confirm: boolean;
    hit: Omit<RecommendationHit, "trigger" | "subject">;
  }[] = [];

  // R1 — Side Bet's value past 10% of net assets. Measured on value, so it
  // flickers with prices: past by half a point, twice, before it counts.
  let sideBetPast = false;
  if (input.sideBet && input.sideBet.limitPence > 0) {
    const { valuePence, limitPence } = input.sideBet;
    // The limit is 10% of net assets, so the value's share is 10 × value / limit.
    const sharePoints = (10 * valuePence) / limitPence;
    sideBetPast = sharePoints >= 10 + R1_MARGIN_POINTS;
    readings.push({
      trigger: "side_bet_over_limit",
      subject: "Degen",
      reading: { on: sideBetPast, clear: sharePoints <= 10 - R1_MARGIN_POINTS },
      confirm: true,
      hit: {
        recommendation: "take_some_profit",
        amountPence: Math.max(0, valuePence - limitPence),
        bucket: "Degen",
        instrumentId: null,
        name: "Side Bet",
        urgent: true,
        facts: {
          valuePounds: pounds(valuePence),
          limitPounds: pounds(limitPence),
          sharePoints: Math.round(sharePoints * 10) / 10,
        },
      },
    });
  }

  const multiples = new Map<string, number>();
  for (const holding of input.holdings) {
    // R2 — worth three times what went in. Take your stake out and let the rest ride.
    if (holding.costPence !== null && holding.costPence > 0) {
      const multiple = holding.valuePence / holding.costPence;
      multiples.set(holding.instrumentId, multiple);
      readings.push({
        trigger: "holding_multiple",
        subject: holding.instrumentId,
        reading: { on: multiple >= HOLDING_MULTIPLE, clear: multiple < HOLDING_REARM_MULTIPLE },
        confirm: false,
        hit: {
          recommendation: "take_some_profit",
          amountPence: holding.costPence,
          bucket: holding.bucket,
          instrumentId: holding.instrumentId,
          name: holding.name,
          urgent: true,
          facts: {
            valuePounds: pounds(holding.valuePence),
            costPounds: pounds(holding.costPence),
            multiple: Math.round(multiple * 10) / 10,
          },
        },
      });
    }

    // R4 — a move past twice the pot's own line today. The default is to hold:
    // one day isn't a reason. Unless R1 or R2 is also true for this holding,
    // in which case theirs is the recommendation.
    const move = holding.dayMovePercent;
    if (move !== null && Math.abs(move) >= holding.moveLine * URGENT_MOVE_MULTIPLIER) {
      const multiple = multiples.get(holding.instrumentId) ?? 0;
      const alsoMultiple = multiple >= HOLDING_MULTIPLE;
      const alsoSideBet = holding.bucket === "Degen" && sideBetPast;
      readings.push({
        trigger: "urgent_move",
        // One per holding per day: a new day is a new subject.
        subject: `${holding.instrumentId}:${input.day}`,
        reading: { on: true, clear: false },
        confirm: false,
        hit: {
          recommendation: alsoMultiple || alsoSideBet ? "take_some_profit" : "hold",
          amountPence: alsoMultiple ? holding.costPence : null,
          bucket: holding.bucket,
          instrumentId: holding.instrumentId,
          name: holding.name,
          urgent: true,
          facts: {
            movePercent: Math.round(move * 10) / 10,
            moveLine: holding.moveLine,
            ...(alsoMultiple ? { multiple: Math.round(multiple * 10) / 10 } : {}),
            ...(alsoSideBet ? { sideBetPastLimit: true } : {}),
          },
        },
      });
    }
  }

  // R3 — Handpicked over its target, or Foundation under, by five points on
  // two refreshes. Rebalance: point new money at the other pot.
  for (const pot of input.pots) {
    if (pot.driftPoints === null) continue;
    const off = pot.bucket === "Medium" ? pot.driftPoints : -pot.driftPoints;
    readings.push({
      trigger: "pot_off_target",
      subject: pot.bucket,
      reading: { on: off >= R3_DRIFT_POINTS, clear: Math.abs(pot.driftPoints) <= R3_REARM_POINTS },
      confirm: true,
      hit: {
        recommendation: "rebalance",
        amountPence: Math.abs(pot.offTargetPence),
        bucket: pot.bucket,
        instrumentId: null,
        name: pot.bucket === "Medium" ? "Handpicked" : "Foundation",
        urgent: false,
        facts: { driftPoints: Math.round(pot.driftPoints * 10) / 10 },
      },
    });
  }

  return readings;
}

export interface TriggerStateStore {
  load(userId: string): Promise<StoredTriggerState[]>;
  save(userId: string, state: StoredTriggerState, now: Date): Promise<void>;
}

/**
 * One refresh's worth of recommendations for one person: reads every trigger,
 * moves its state on, saves it, and returns a hit only where a crossing was
 * confirmed this time — so one crossing makes one brief.
 */
export async function evaluateRecommendations(
  store: TriggerStateStore,
  userId: string,
  input: TriggerInput,
): Promise<(RecommendationHit & { eventId: string })[]> {
  const existing = new Map(
    (await store.load(userId)).map((row) => [`${row.trigger}|${row.subject}`, row]),
  );
  const hits: (RecommendationHit & { eventId: string })[] = [];

  for (const { trigger, subject, reading, confirm, hit } of readTriggers(input)) {
    const current = existing.get(`${trigger}|${subject}`) ?? null;
    const { next, fire } = step(current, reading, confirm, input.now);
    const eventId = next.newEvent ? crypto.randomUUID() : (current?.eventId ?? null);
    const stillCounts = next.state === "fired" || next.state === "pending_clear";
    await store.save(
      userId,
      {
        trigger,
        subject,
        state: next.state,
        eventId: stillCounts ? eventId : null,
        since: next.since,
      },
      input.now,
    );
    if (fire && eventId) hits.push({ trigger, subject, ...hit, eventId });
  }
  return hits;
}

export function memoryTriggerStateStore(): TriggerStateStore & {
  rows: Map<string, StoredTriggerState>;
} {
  const rows = new Map<string, StoredTriggerState>();
  const key = (userId: string, row: { trigger: string; subject: string }) =>
    `${userId}|${row.trigger}|${row.subject}`;
  return {
    rows,
    async load(userId) {
      return [...rows.entries()].filter(([k]) => k.startsWith(`${userId}|`)).map(([, row]) => row);
    },
    async save(userId, state) {
      rows.set(key(userId, state), state);
    },
  };
}
