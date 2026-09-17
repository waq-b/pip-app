/**
 * The design board's sample data, used by the preview build and the tests.
 * Made-up numbers and a made-up reader — never real holdings.
 */
import type { AlertInput, Recommendation, WeekDigestInput } from "./index.js";
import { MARK_PATH, PIP_URL } from "./supabase.js";

const markUrl = `${PIP_URL}${MARK_PATH}`;
const email = "sam.okoro@example.com";
const setupUrl = `${PIP_URL}/setup`;
const weekUrl = `${PIP_URL}/week`;

export const signIn = {
  code: "41860237",
  signInUrl: `${PIP_URL}/`,
  email,
  markUrl,
  expiryMinutes: 10,
};

const sideBetRecommendation: Recommendation = {
  title: "Side Bet is over your line. Pip would leave it.",
  aside: "One a week, at most",
  fact: "Side Bet is £780 — 6.8% of everything, against the 5% you set. It got there by rising, not by you paying in; the Kraken standing order has been paused since June.",
  take: "Do nothing this week. Let the other two pots grow into it.",
  why: "£140 a month is going into Foundation. At this rate the pot is back under 5% by early November without you selling anything — and 1.8 points over on £11,430 is £200 of exposure, not a problem.",
  discipline:
    "Rebalances with new money first and only sells when the drift is large or persistent — commonly a 5-point band, reviewed quarterly rather than weekly.",
  tradeOff:
    "Waiting means a hotter pot for another six weeks, and crypto can halve in that time. Selling £200 of Bitcoin fixes it today, but it's a disposal — capital gains, fees, and you'd be selling the thing that worked.",
  closing:
    "Pip can't act on this and won't ask again next week unless the number changes. There's no button here on purpose.",
  sources: [
    "Kraken balances, 21 Sep 06:40",
    "Trading 212 holdings feed",
    "Your own 5% cap, set 4 Jun",
  ],
  href: weekUrl,
};

const threePots: WeekDigestInput["pots"] = [
  {
    pot: "foundation",
    value: "£8,240",
    sharePercent: 72,
    change: { text: "£96 this week", direction: "up" },
    line: "72% of you, 2 over its 70% line",
    status: "2 over",
  },
  {
    pot: "handpicked",
    value: "£2,410",
    sharePercent: 21,
    change: { text: "£58 this week", direction: "up" },
    line: "21% of you, 4 under its 25% line",
    status: "4 under",
  },
  {
    pot: "sideBet",
    value: "£780",
    sharePercent: 7,
    change: { text: "£5 this week", direction: "up" },
    line: "6.8% of you, over your own 5% cap",
    status: "over its cap at 6.8%",
    capLabel: "Capped at 5%",
    overCap: true,
  },
];

const base = {
  range: "Mon 14 – Sun 20 Sep",
  pricesAsAt: "Sunday 20 Sep, 23:00",
  email,
  markUrl,
  weekUrl,
  setupUrl,
};

export const weekOneThing: WeekDigestInput = {
  ...base,
  subjectVerdict: "one thing worth a look",
  preheader: "Up £163. Side Bet is still a bit over its line — nothing urgent.",
  verdict: ["One thing worth a look.", "Nothing urgent."],
  total: {
    label: "Everything, Sunday night",
    value: "£11,430",
    change: { text: "£163 this week  ·  +1.4%", direction: "up" },
    note: "£140 of that was your own payment in. The market did the other £23.",
  },
  pots: threePots,
  potsNote:
    "Percentages are of your whole £11,430. The legal ceiling on Side Bet is 10% of your net assets — you're well inside that; 5% is the line you drew yourself.",
  recommendation: sideBetRecommendation,
  nudges: [
    {
      kind: "calendar",
      title: "Nvidia reports on Wednesday",
      body: "It's a third of Handpicked, so Wednesday evening will move your number more than usual. Nothing to do; it's just worth knowing before you look.",
      sources: ["Nvidia investor relations calendar", "Trading 212 holdings feed"],
      checks: [
        "Date confirmed by the company itself",
        "You actually hold it, in size",
        "No price prediction made",
      ],
      href: weekUrl,
    },
  ],
  checked: {
    summary:
      "Three stories about your holdings came from a single unverified source, so they didn't make it in. Pip would rather send you less.",
    stats: [
      { value: "41", label: "reports and filings read" },
      { value: "12", label: "sources, 9 of them primary" },
      { value: "9 of 9", label: "holdings covered" },
      { value: "3", label: "things held back by trust rules", heldBack: true },
    ],
  },
  calendar: [
    { label: "Nvidia results", date: "Wed 23 Sep" },
    { label: "Your ISA payment, £140", date: "Thu 1 Oct" },
    { label: "Greggs half-year update", date: "Sat 3 Oct" },
  ],
};

export const weekQuiet: WeekDigestInput = {
  ...base,
  range: "Mon 21 – Sun 27 Sep",
  pricesAsAt: "Sunday 27 Sep, 23:00",
  subjectVerdict: "nothing needs you",
  preheader: "Up £164. Every pot is where it should be.",
  verdict: ["Nothing needs you this week."],
  intro:
    "Your payment went in, the pots are where they should be, and nothing Pip read was worth your Monday. That's the job done, not an empty inbox.",
  total: {
    label: "Everything, Sunday night",
    value: "£11,594",
    change: { text: "£164 this week  ·  +1.4%", direction: "up" },
  },
  pots: [
    {
      pot: "foundation",
      value: "£8,390",
      sharePercent: 72,
      change: { text: "£150 this week", direction: "up" },
      line: "72% of you",
      status: "on its line",
    },
    {
      pot: "handpicked",
      value: "£2,440",
      sharePercent: 21,
      change: { text: "£30 this week", direction: "up" },
      line: "21% of you",
      status: "2 under",
    },
    {
      pot: "sideBet",
      value: "£764",
      sharePercent: 5,
      change: { text: "£16 this week", direction: "down" },
      line: "4.8% of you",
      status: "inside its cap at 4.8%",
    },
  ],
  nudges: [],
  checked: {
    summary:
      "Pip read 38 reports across 11 sources and found nothing that passed its own checks. Two stories were dropped for a single unverified source.",
  },
  calendar: [{ label: "Your ISA payment, £140", date: "Thu 1 Oct" }],
  nextUp: "your £140 ISA payment on Thu 1 Oct. Nothing else in the diary.",
};

export const weekFourThings: WeekDigestInput = {
  ...weekOneThing,
  subjectVerdict: "four things to look at",
  verdict: ["Four things to look at.", "One of them matters."],
  nudges: [
    {
      kind: "awareness",
      title: "ASML fell 6% on export rules",
      body: "£13 to you. Two sources, both primary. No action suggested.",
      href: weekUrl,
    },
    {
      kind: "calendar",
      title: "Nvidia reports Wednesday",
      body: "A third of Handpicked. Expect a bigger swing than usual midweek.",
      href: weekUrl,
    },
    {
      kind: "shape",
      title: "Handpicked has drifted 4 under",
      body: "Your next two payments already lean this way. Nothing to do.",
      href: weekUrl,
    },
    {
      kind: "awareness",
      title: "Greggs trading update",
      body: "Sales up 3%. One primary source.",
      href: weekUrl,
    },
  ],
};

export const weekMissingPot: WeekDigestInput = {
  ...weekOneThing,
  subjectVerdict: "one pot is missing",
  preheader: "Pip can't see Side Bet this week, so the total is two pots.",
  verdict: ["One pot is missing, so this total isn't your total."],
  total: {
    label: "Two pots, Sunday night",
    value: "£10,650",
    change: { text: "£154 this week  ·  Side Bet not counted", direction: "up" },
  },
  pots: [
    threePots[0]!,
    threePots[1]!,
    {
      pot: "sideBet",
      missing: {
        body: "Your Kraken key expired on 12 Sep, so Pip hasn't seen this pot in nine days. The last figure it had was £780 — treat it as a guess, not a balance. Percentages above are of £10,650, not your real total, and the cap check is paused until it reconnects.",
        link: { href: setupUrl, label: "Reconnect Kraken in Pip" },
      },
    },
  ],
  potsNote:
    "Pip would rather show you two honest pots than three where one is stale. No nudge this week mentions Side Bet, because Pip can't see it.",
  recommendation: undefined,
};

export const weekStalePrices: WeekDigestInput = {
  ...weekOneThing,
  stale: {
    lead: "Prices here are from Friday 18 Sep.",
    body: "Pip's market feed dropped out over the weekend, so this week's change is calculated to Friday's close rather than Sunday's. Your balances are right; the last two days are missing.",
  },
  total: {
    label: "Everything, Friday close",
    value: "£11,402",
    asAt: "as at Fri",
    change: { text: "£135 to Friday  ·  +1.2%", direction: "up" },
    note: "No nudge in this email depends on a price from the missing window. Two were held back for exactly that reason.",
  },
  pricesAsAt: "Friday 18 Sep, close",
};

const alertBase = { setupUrl, markUrl };

export const alertLimit80: AlertInput = {
  ...alertBase,
  subject: "Side Bet is at 80% of its cap",
  preheader: "Growth got it there, not money in. Nothing to do.",
  chip: { label: "Side Bet · 80%", tone: "sideBet" },
  title: "Side Bet is four fifths of the way to its cap",
  limit: {
    caption: "£760 of your £950 ceiling · 80%",
    percent: 80,
    footnote: "100% is 5% of everything you hold — the line you drew yourself",
  },
  paragraphs: [
    "Bitcoin had a good fortnight — that's what moved it, not anything you did. Nothing needs doing at 80%; Pip is telling you now so 100% isn't a surprise.",
  ],
  link: { href: `${PIP_URL}/rules`, label: "See Side Bet in Pip" },
  advice: true,
};

export const alertCapByGrowth: AlertInput = {
  ...alertBase,
  subject: "Side Bet hit its 5% cap",
  preheader: "It grew there — you haven't paid in since June.",
  chip: { label: "Side Bet · at the line", tone: "foundation" },
  title: "Side Bet hit its cap by growing. Nicely done.",
  paragraphs: [
    "£950, which is exactly the 5% you set. You haven't paid in since June — this is Bitcoin up 62% since January doing it on its own.",
    "Nothing needs doing today. If it keeps climbing, Monday's email will lay out the choice properly.",
  ],
  link: { href: `${PIP_URL}/rules`, label: "See Side Bet in Pip" },
  advice: true,
};

export const alertUrgentMove: AlertInput = {
  ...alertBase,
  subject: "Nvidia fell 11% — £79 to you",
  preheader: "Guidance came in below expectations. Pip isn't suggesting anything.",
  chip: { label: "Awareness · today", tone: "amber" },
  title: "Nvidia fell 11% this afternoon",
  fact: {
    label: "What it means for you",
    value: "£79",
    direction: "down",
    note: "Your whole portfolio is down £64 today — 0.6%",
  },
  paragraphs: [
    "Guidance for next quarter came in below what analysts expected. It's a third of Handpicked, which is why you're hearing about it at all — an 11% day in something you hold at 2% wouldn't get an email.",
  ],
  sources: ["Nvidia Q3 guidance, filed 17:02", "Reuters, 17:19", "Yahoo Finance price, 17:31"],
  notSuggesting: {
    lead: "Pip isn't suggesting anything.",
    body: "One bad quarter is not a thesis. This is here so you're not surprised tomorrow.",
  },
  link: { href: weekUrl, label: "See Nvidia in Pip" },
  advice: true,
};

export const alertPushStopped: AlertInput = {
  ...alertBase,
  subject: "Pip can't reach your phone",
  preheader: "Open Pip on that phone once and it sorts itself out.",
  chip: { label: "Notifications", tone: "amber" },
  title: "Pip can't reach your phone any more",
  paragraphs: [
    "Push notifications to Sam's iPhone stopped working on 19 Sep. This happens on its own — a reinstall, an iOS update, or the app not being opened for a while. Nothing is wrong with your account and no money is affected.",
    "Until it's fixed, cap alerts will only appear on the bell inside Pip and in Monday's email. Open Pip on that phone once and it sorts itself out.",
  ],
  link: { href: setupUrl, label: "Check notifications in Setup" },
  advice: false,
};

export const recommendationAlone = {
  subject: "Pip has a recommendation",
  preheader: "Side Bet is over your line. Pip would leave it.",
  sentAt: "Thu 18 Sep, 08:10",
  recommendation: { ...sideBetRecommendation, aside: "Didn't wait for Monday" },
  email,
  markUrl,
  setupUrl,
};

export const waitlist = { markUrl };

export const youreIn = {
  markUrl,
  signInUrl: `${PIP_URL}/`,
  codeLength: 8,
  netAssetsFallback: "£2,000",
};
