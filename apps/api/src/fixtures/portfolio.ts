import type {
  ActivityEntry,
  Bucket,
  Change,
  Connection,
  Pence,
  Percent,
  Timeframe,
} from "@finance-app/shared";

/**
 * The words and numbers the design handover supplies, which the trading and
 * market layers don't own: blurbs, plain-English lines, captions, the feed and
 * the rules a user has set.
 *
 * Corrections from DESIGN.md §6 are applied here, not left for the UI: nothing
 * claims Pip moves money, and no entry crosses pots.
 */

export const TOTAL_VALUE: Pence = 1_143_018;

export const TOTAL_CHANGE: Record<Timeframe, Change> = {
  day: { amount: 2_580, percent: 0.23, direction: "up" },
  month: { amount: 12_040, percent: 1.1, direction: "up" },
  all: { amount: 113_000, percent: 11.0, direction: "up" },
};

const TIMEFRAME_WORDS: Record<Timeframe, string> = {
  day: "today",
  month: "this month",
  all: "all time",
};

export interface BucketFixture {
  value: Pence;
  shareOfTotal: Percent;
  targetPercent: Percent;
  /** Degen's line is a hard cap; the others are targets to drift around. */
  isCap: boolean;
  blurb: string;
  plain: string;
  chartFrom: string;
  chartCaption: string;
  moneyInCaption: string;
  rulePlain: string;
  change: Record<Timeframe, Change>;
}

export const BUCKET_FIXTURES: Record<Bucket, BucketFixture> = {
  Base: {
    value: 824_000,
    shareOfTotal: 72,
    targetPercent: 70,
    isCap: false,
    blurb: "Your ISA, dripping into world index funds",
    plain:
      "Boring on purpose. It owns a slice of about 7,000 companies, so no single one can hurt you much.",
    chartFrom: "Mar 2024",
    chartCaption:
      "Two dips along the way, both recovered within a month. This is what normal looks like.",
    moneyInCaption: "Same £140 every month since April. That regularity is doing most of the work.",
    rulePlain: "It's 2% over target, which is nothing to worry about.",
    change: {
      day: { amount: 1_140, percent: 0.14, direction: "up" },
      month: { amount: 9_620, percent: 1.2, direction: "up" },
      all: { amount: 64_000, percent: 8.4, direction: "up" },
    },
  },
  Medium: {
    value: 241_000,
    shareOfTotal: 21,
    targetPercent: 25,
    isCap: false,
    blurb: "Five companies you chose yourself",
    plain:
      "Fewer companies means bigger swings — up and down. Nvidia alone is a third of this pot.",
    chartFrom: "Aug 2024",
    chartCaption: "Bumpier than Foundation, and that is the trade you made by picking your own.",
    moneyInCaption: "Steady £50 a month, with one £60 month when you bought Rolls-Royce.",
    rulePlain: "A bit under target. The monthly payments you've set up lean this way already.",
    change: {
      day: { amount: 910, percent: 0.38, direction: "up" },
      month: { amount: 5_840, percent: 2.5, direction: "up" },
      all: { amount: 21_000, percent: 9.5, direction: "up" },
    },
  },
  Degen: {
    value: 78_000,
    shareOfTotal: 6.8,
    targetPercent: 5,
    isCap: true,
    blurb: "The fun money. Capped, fenced off, and left alone past its limit",
    plain:
      "Assume you could lose the lot. That is the deal you made with this pot, and £780 is a sum you can shrug at.",
    chartFrom: "Jan 2025",
    chartCaption:
      "Up 56% overall, and it has been down 40% twice on the way. Both are normal here.",
    moneyInCaption: "Nothing new has gone in since June, once it reached the line you set.",
    rulePlain: "Over the line you set. Nothing new has gone in since June.",
    change: {
      day: { amount: 530, percent: 0.68, direction: "up" },
      month: { amount: -3_420, percent: -4.2, direction: "down" },
      all: { amount: 28_000, percent: 56, direction: "up" },
    },
  },
};

/** How far over its cap Side Bet currently sits — the only red thing in the app. */
export const DEGEN_OVER_BY = { percent: 1.8, amount: 20_800 };

/**
 * The hero line. Money first, and it only says "nothing needs you" when that's
 * true — a breached cap is named instead (DESIGN.md §4.3).
 */
export function verdictFor(timeframe: Timeframe, somethingNeedsALook: boolean): string {
  const change = TOTAL_CHANGE[timeframe];
  const direction = change.direction === "down" ? "Down" : "Up";
  const money = formatPounds(Math.abs(change.amount));
  const when = TIMEFRAME_WORDS[timeframe];
  const tail = somethingNeedsALook ? "Side Bet needs a look." : "Nothing needs you.";

  return `${direction} ${money} ${when}. ${tail}`;
}

function formatPounds(pence: Pence): string {
  const pounds = pence / 100;
  return `£${pounds % 1 === 0 ? pounds.toFixed(0) : pounds.toFixed(2)}`;
}

export interface InstrumentFixture {
  /** How much of it is held, formatted — units vary too much to compute here. */
  quantity: string;
  today: Change;
  sinceBought: Change;
  shareOfBucket: Percent;
  /**
   * Hand-written in Phase 1 and shown under the not-advice label. The Phase 6
   * research module owns this text later, and keeps it generic for anyone other
   * than Waqar (CLAUDE.md hard line 12).
   */
  note: string;
}

export const INSTRUMENT_FIXTURES: Record<string, InstrumentFixture> = {
  "vanguard-ftse-global-all-cap": {
    quantity: "2,348 units",
    today: { amount: 710, percent: 0.14, direction: "up" },
    sinceBought: { amount: 41_800, percent: 8.9, direction: "up" },
    shareOfBucket: 62,
    note: "A slice of nearly 7,000 companies in one line. No single one can hurt you much.",
  },
  "vanguard-sp-500": {
    quantity: "23.1 units",
    today: { amount: 430, percent: 0.2, direction: "up" },
    sinceBought: { amount: 21_900, percent: 11.2, direction: "up" },
    shareOfBucket: 27,
    note: "The 500 biggest US companies. Overlaps with the fund above, which is fine.",
  },
  "cash-waiting": {
    quantity: "£940",
    today: { amount: 0, percent: 0, direction: "flat" },
    sinceBought: { amount: 0, percent: 0, direction: "flat" },
    shareOfBucket: 11,
    note: "Next month's buy, sitting still. Not invested yet, not lost.",
  },
  nvidia: {
    quantity: "5.04 shares",
    today: { amount: 410, percent: 0.6, direction: "up" },
    sinceBought: { amount: 13_900, percent: 24, direction: "up" },
    shareOfBucket: 30,
    note: "Makes the chips that AI runs on. Swings hard in both directions — a third of your Handpicked pot sits here.",
  },
  apple: {
    quantity: "3.05 shares",
    today: { amount: 90, percent: 0.2, direction: "up" },
    sinceBought: { amount: 3_170, percent: 6, direction: "up" },
    shareOfBucket: 23,
    note: "Phones and laptops. About as steady as a single company gets.",
  },
  asml: {
    quantity: "0.70 shares",
    today: { amount: -320, percent: -0.7, direction: "down" },
    sinceBought: { amount: -1_330, percent: -3, direction: "down" },
    shareOfBucket: 18,
    note: "Builds the machines that make chips. One customer sneezes and the price moves.",
  },
  greggs: {
    quantity: "15.4 shares",
    today: { amount: 110, percent: 0.3, direction: "up" },
    sinceBought: { amount: 750, percent: 2, direction: "up" },
    shareOfBucket: 16,
    note: "Sausage rolls. Genuinely a fine business.",
  },
  "rolls-royce": {
    quantity: "53.9 shares",
    today: { amount: 240, percent: 0.8, direction: "up" },
    sinceBought: { amount: 3_930, percent: 14, direction: "up" },
    shareOfBucket: 13,
    note: "Aeroplane engines, not the cars. Up 14% since you bought.",
  },
  bitcoin: {
    quantity: "0.0088 BTC",
    today: { amount: 380, percent: 0.9, direction: "up" },
    sinceBought: { amount: 16_500, percent: 62, direction: "up" },
    shareOfBucket: 55,
    note: "The big one. Assume you could lose the lot — that is the deal you made with this pot.",
  },
  ethereum: {
    quantity: "0.103 ETH",
    today: { amount: 120, percent: 0.6, direction: "up" },
    sinceBought: { amount: 5_200, percent: 31, direction: "up" },
    shareOfBucket: 28,
    note: "The second one. Same rules: money you can shrug at.",
  },
  solana: {
    quantity: "1.10 SOL",
    today: { amount: 30, percent: 0.3, direction: "up" },
    sinceBought: { amount: -1_770, percent: -12, direction: "down" },
    shareOfBucket: 17,
    note: "Faster and riskier again. Down 12% since you bought — normal for this corner.",
  },
};

/**
 * Last week, in plain English. The prototype had ISA money buying Rolls-Royce;
 * it's the Invest account, and the wording says so (hard line 11).
 */
export const ACTIVITY: ActivityEntry[] = [
  {
    id: "activity-1",
    bucket: "Base",
    kind: "money_in",
    text: "£140 of your ISA bought Vanguard FTSE Global All Cap",
    when: "Monday · automatic",
  },
  {
    id: "activity-2",
    bucket: "Medium",
    kind: "up",
    text: "Nvidia up 6% — that's £41 to you",
    when: "Tuesday",
  },
  {
    id: "activity-3",
    bucket: "Degen",
    kind: "alert",
    text: "Side Bet crept 1.8% over its 5% cap",
    when: "Wednesday · needs a look",
  },
  {
    id: "activity-4",
    bucket: "Base",
    kind: "milestone",
    text: "You crossed £11,000. First time.",
    when: "Thursday",
  },
  {
    id: "activity-5",
    bucket: "Medium",
    kind: "money_in",
    text: "£60 of your Invest account bought Rolls-Royce",
    when: "Friday · automatic",
  },
];

/** What the user pays in monthly, as set up at their broker. Pip only reads it. */
export const MONTHLY_SPLIT = {
  total: 20_000,
  perBucket: [
    { bucket: "Base" as Bucket, amount: 14_000, percent: 70 },
    { bucket: "Medium" as Bucket, amount: 5_000, percent: 25 },
    { bucket: "Degen" as Bucket, amount: 1_000, percent: 5 },
  ],
};

/**
 * Phase 1 shows connections but stores no keys — Phase 2 brings encrypted
 * storage. Coinbase appears in the prototype and is deliberately absent.
 * Last-read times are relative to the request, so Setup always reads like the
 * design ("synced 4 min ago") rather than ageing with the clock.
 */
export function connectionsAt(now: Date): Connection[] {
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
  return [
    {
      provider: "trading212",
      displayName: "Trading 212",
      status: "live",
      feeds: ["Base", "Medium"],
      holdingsSeen: 8,
      lastReadAt: minutesAgo(4),
    },
    {
      provider: "kraken",
      displayName: "Kraken",
      status: "live",
      feeds: ["Degen"],
      holdingsSeen: 3,
      lastReadAt: minutesAgo(11),
    },
  ];
}
