import {
  BUCKETS,
  displayNameFor,
  type Bucket,
  type BucketFreshness,
  type PriceFreshness,
} from "@finance-app/shared";
import type { ProvenanceState } from "../components/provenance";

/**
 * The staleness ladder (DESIGN.md §5): turns raw freshness into one voice.
 *
 * - under an hour → green, silent
 * - 1–6 hours → amber line naming the pots, age chips beside what they feed
 * - over 6 hours, or a failed fetch → red card with Try again; amber stands down
 * - markets closed → green, always
 *
 * Three pots amber at once is no longer "some pots are late", so it goes red.
 * Pure: every screen asks the same function, so they can never disagree.
 */
export type Rung = "fresh" | "amber" | "red" | "closed";

const HOUR = 60 * 60 * 1000;
const AMBER_FROM_HOURS = 1;
const RED_AFTER_HOURS = 6;

export interface PotStaleness {
  bucket: Bucket;
  rung: Rung;
  hours: number;
  freshness: PriceFreshness;
}

export interface Ladder {
  state: ProvenanceState;
  /** The provenance line. */
  line: string;
  pots: PotStaleness[];
  /** Pots whose figures carry an age chip. */
  chipped: Partial<Record<Bucket, number>>;
  /** Pots whose figures dim, because the feed is gone rather than late. */
  dimmed: Bucket[];
  /** Present when the red card shows. */
  card?: { heading: string; body: string };
}

export function rungFor(freshness: PriceFreshness, now: number): Rung {
  const hours = ageHours(freshness, now);
  if (freshness.failed) return "red";
  if (freshness.marketsClosed) return "closed";
  if (hours > RED_AFTER_HOURS) return "red";
  if (hours >= AMBER_FROM_HOURS) return "amber";
  return "fresh";
}

/**
 * `single` is for screens about one pot or one holding, where naming the pot is
 * noise: "Price is 2 hours old" rather than "Side Bet is 2 hours old".
 */
export function ladder(
  entries: BucketFreshness[],
  options: { now?: number; single?: "Price" | "Prices" } = {},
): Ladder {
  const now = options.now ?? Date.now();
  const pots = entries.map(({ bucket, freshness }) => ({
    bucket,
    freshness,
    hours: ageHours(freshness, now),
    rung: rungFor(freshness, now),
  }));
  const source = [...new Set(entries.map((entry) => entry.freshness.source))].join(" · ");
  const of = (rung: Rung) => pots.filter((pot) => pot.rung === rung);
  const red = of("red");
  const amber = of("amber");
  const fresh = of("fresh");
  const closed = of("closed");
  const allAmber = !options.single && amber.length === BUCKETS.length;

  if (red.length > 0 || allAmber) {
    const late = allAmber ? amber : red;
    return {
      state: "red",
      line: `${source} · not updating`,
      pots,
      chipped: chips(late),
      dimmed: late.map((pot) => pot.bucket),
      card: redCard(late, pots.length, options.single),
    };
  }

  if (amber.length > 0) {
    const oldest = Math.max(...amber.map((pot) => pot.hours));
    const age = hoursOld(oldest);
    let line: string;
    if (options.single) {
      line = `${options.single} ${options.single === "Price" ? "is" : "are"} ${age}`;
    } else {
      line = `${names(amber)} ${amber.length === 1 ? "is" : "are"} ${age}`;
      if (fresh.length > 0) {
        const rest =
          fresh.length === 1 && closed.length === 0
            ? displayNameFor(fresh[0]!.bucket)
            : "everything else";
        line += ` · ${rest} updated ${minutesAgo(fresh)}`;
      }
    }
    return { state: "amber", line, pots, chipped: chips(amber), dimmed: [] };
  }

  if (fresh.length === 0 && closed.length > 0) {
    const day = WEEKDAYS[new Date(closed[0]!.freshness.asOf).getDay()];
    return {
      state: "closed",
      line: `${source} · Prices from ${day}'s close`,
      pots,
      chipped: {},
      dimmed: [],
    };
  }

  return {
    state: "fresh",
    line: `${source} · updated ${minutesAgo(fresh)}`,
    pots,
    chipped: {},
    dimmed: [],
  };
}

function redCard(
  late: PotStaleness[],
  total: number,
  single: "Price" | "Prices" | undefined,
): { heading: string; body: string } {
  const oldest = Math.max(...late.map((pot) => pot.hours));

  if (single) {
    const at = new Date(Math.min(...late.map((pot) => Date.parse(pot.freshness.asOf))));
    return {
      heading: `${single === "Price" ? "The price isn't" : "Prices aren't"} coming through`,
      body: `This is the last figure Pip saw, at ${clock(at)}. What you own hasn't changed — only what Pip can see of it.`,
    };
  }

  if (late.length === total) {
    const allFailed = late.every((pot) => pot.freshness.failed) && oldest < AMBER_FROM_HOURS;
    return {
      heading: allFailed ? "Prices aren't coming through" : `All prices are ${hoursOld(oldest)}`,
      body: "These are the last figures Pip saw. What you own hasn't changed — only what Pip can see of it.",
    };
  }

  const who = names(late);
  const one = late.length === 1;
  if (agoText(oldest) === "just now") {
    // A feed that failed moments ago: "from just now" would read as fresh.
    return {
      heading: `${who} ${one ? "isn't" : "aren't"} updating`,
      body: `Your ${who} ${one ? "number is the last one" : "numbers are the last ones"} Pip saw. Everything else is live.`,
    };
  }
  return {
    heading: `${who} ${late.length === 1 ? "isn't" : "aren't"} updating`,
    body: `Your ${who} ${late.length === 1 ? "number is" : "numbers are"} from ${agoText(oldest)}. Everything else is live.`,
  };
}

function chips(pots: PotStaleness[]): Partial<Record<Bucket, number>> {
  return Object.fromEntries(
    pots.filter((pot) => pot.hours >= AMBER_FROM_HOURS).map((pot) => [pot.bucket, pot.hours]),
  );
}

function names(pots: PotStaleness[]): string {
  const list = pots.map((pot) => displayNameFor(pot.bucket));
  return list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

function ageHours(freshness: PriceFreshness, now: number): number {
  return Math.max(0, (now - Date.parse(freshness.asOf)) / HOUR);
}

function hoursOld(hours: number): string {
  const whole = Math.max(1, Math.floor(hours));
  return `${whole} hour${whole === 1 ? "" : "s"} old`;
}

/** The oldest of the fresh pots, so "updated 4 min ago" is never flattering. */
function minutesAgo(pots: PotStaleness[]): string {
  if (pots.length === 0) return "just now";
  const minutes = Math.floor(Math.max(...pots.map((pot) => pot.hours)) * 60);
  return minutes < 1 ? "just now" : `${minutes} min ago`;
}

function agoText(hours: number): string {
  if (hours < AMBER_FROM_HOURS) {
    const minutes = Math.floor(hours * 60);
    return minutes < 1 ? "just now" : `${minutes} min ago`;
  }
  const whole = Math.floor(hours);
  return `${whole} hour${whole === 1 ? "" : "s"} ago`;
}

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
