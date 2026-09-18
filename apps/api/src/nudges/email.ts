import {
  MARK_PATH,
  PIP_URL,
  weekDigestEmail,
  type DigestNudge,
  type DigestPot,
  type Email,
  type Recommendation as RecommendationCard,
  type WeekDigestInput,
} from "@finance-app/emails";
import {
  BUCKETS,
  type Bucket,
  type BucketSummary,
  type NudgeView,
  type Pence,
  type PortfolioSummary,
  type Recommendation,
  type RecommendationTrigger,
  type WeekView,
} from "@finance-app/shared";
import type { BriefParts } from "../research/recommendation.js";
import { takeLine } from "../research/recommendation.js";
import type { RulesEvaluation } from "../rules/engine.js";

/**
 * Monday's email (phase-6.md decision 6): the week Pip just built, laid out
 * with the "Pip Emails" digest template. Pure — the same inputs always give
 * the same email — so it's snapshot-tested and never touches the network.
 *
 * What's left out on purpose: held-back notes (one tap away in Pip), and
 * Side Bet's limit in pounds — it gives net assets away ten times over, and
 * an email passes through Resend (DESIGN §11.1).
 */

export interface WeekEmailInput {
  week: WeekView;
  /** `portfolio(user, "month")`: enough history to say what the week did. */
  portfolio: PortfolioSummary;
  rules: RulesEvaluation;
  /** Personal research only: the week's latest shown recommendation, with its brief. */
  recommendation: {
    trigger: RecommendationTrigger;
    title: string;
    course: Recommendation;
    amountPence: Pence | null;
    name: string;
    brief: BriefParts;
    createdAt: Date;
  } | null;
  to: string;
  now: Date;
  appUrl?: string;
}

const POT: Record<Bucket, "foundation" | "handpicked" | "sideBet"> = {
  Base: "foundation",
  Medium: "handpicked",
  Degen: "sideBet",
};

const LONDON = "Europe/London";
const pounds = (pence: Pence) => `£${Math.round(Math.abs(pence) / 100).toLocaleString("en-GB")}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** London date parts, with "Sep" rather than the "Sept" some ICU builds give. */
function parts(date: Date) {
  const get = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, ...options }).format(date);
  return {
    weekday: get({ weekday: "short" }),
    longWeekday: get({ weekday: "long" }),
    day: get({ day: "numeric" }),
    month: MONTHS[Number(get({ month: "numeric" })) - 1]!,
    time: get({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  };
}
const shortDate = (date: Date) => {
  const p = parts(date);
  return `${p.weekday} ${p.day} ${p.month}`;
};
const shortDay = (iso: string) => shortDate(new Date(`${iso}T12:00:00Z`));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What the pot did over the seven days to its latest point. The history's
 * shape gives the percentage; today's value gives the pounds — the same way
 * a holding's week is worked out for its note (`moveSince`).
 */
function weekChange(values: { value: Pence; series: { at: string; value: number }[] }) {
  const last = values.series[values.series.length - 1];
  if (!last) return null;
  const weekAgo = Date.parse(last.at) - 7 * 86_400_000;
  const from = values.series.filter((point) => Date.parse(point.at) <= weekAgo).at(-1);
  if (!from || from.value <= 0 || last.value <= 0) return null;
  const percent = (last.value / from.value - 1) * 100;
  return { amount: Math.round(values.value - values.value / (1 + percent / 100)), percent };
}

function changeText(change: { amount: Pence; percent: number } | null) {
  if (!change || Math.round(change.amount / 100) === 0) {
    return { text: "Flat this week", direction: "flat" as const };
  }
  const sign = change.amount > 0 ? "+" : "−";
  return {
    text: `${pounds(change.amount)} this week  ·  ${sign}${Math.abs(change.percent).toFixed(1)}%`,
    direction: change.amount > 0 ? ("up" as const) : ("down" as const),
  };
}

/** One line per pot, and the quiet week's one-word status. Never Side Bet's limit in pounds. */
function potWords(pot: RulesEvaluation["pots"][number]): { line: string; status: string } {
  if (pot.kind === "cap") {
    if (pot.status === "over_limit") {
      return {
        line: "Money in has reached its limit. Pip can't stop anything.",
        status: "at its limit",
      };
    }
    if (pot.status === "near_limit") {
      return { line: "Money in is past 80% of its limit.", status: "near its limit" };
    }
    return { line: "Outside the shape, inside its limit.", status: "inside its limit" };
  }
  const drift = pot.driftPoints ?? 0;
  const points = Math.round(Math.abs(drift));
  if (pot.status === "drifted") {
    return {
      line: `${points} points ${drift > 0 ? "over" : "under"} the ${pot.linePercent}% you set`,
      status: `${points} ${drift > 0 ? "over" : "under"}`,
    };
  }
  return { line: `On the ${pot.linePercent}% you set`, status: "on its line" };
}

function pots(input: WeekEmailInput, setupUrl: string): DigestPot[] {
  return BUCKETS.map((bucket): DigestPot => {
    const summary: BucketSummary | undefined = input.portfolio.buckets.find(
      (b) => b.bucket === bucket,
    );
    const rule = input.rules.pots.find((p) => p.bucket === bucket)!;
    if (!summary || summary.status === "not_connected" || rule.status === "unavailable") {
      return {
        pot: POT[bucket],
        missing: {
          body: "Not connected, so it isn't in the total.",
          link: { href: setupUrl, label: "Connect it in Setup" },
        },
      };
    }
    const words = potWords(rule);
    return {
      pot: POT[bucket],
      value: pounds(summary.value),
      sharePercent: Math.round(summary.shareOfTotal),
      change: changeText(weekChange(summary)),
      line: words.line,
      status: words.status,
      ...(bucket === "Degen"
        ? { capLabel: "Has a limit", ...(rule.status === "over_limit" ? { overCap: true } : {}) }
        : {}),
    };
  });
}

const KIND: Partial<Record<NudgeView["kind"], DigestNudge["kind"]>> = {
  calendar: "calendar",
  shape: "shape",
  awareness: "awareness",
};

function nudges(week: WeekView, weekUrl: string): DigestNudge[] {
  return week.nudges.flatMap((nudge) => {
    const kind = KIND[nudge.kind];
    if (!kind) return [];
    const publishers = [...new Set(nudge.sources.map((source) => source.publisher))];
    return [
      {
        kind,
        title: nudge.title,
        body: nudge.body,
        ...(publishers.length ? { sources: publishers.slice(0, 3) } : {}),
        ...(nudge.checks.length
          ? { checks: nudge.checks.filter((c) => c.passed).map((c) => c.rule) }
          : {}),
        href: weekUrl,
      },
    ];
  });
}

/** R1 without a pound that would give the limit away. */
export const SEALED_R1 = {
  fact: "Side Bet's value has grown past its limit — 10% of the net assets you gave Pip.",
  why: "A punt that outgrows its limit stops being small. The pounds are in Pip, where your net assets stay behind the dots.",
  tradeOff:
    "If it keeps climbing, what you take out won't climb with it. Outside an ISA, a sale can count towards capital gains tax.",
  push: "Side Bet has grown past its limit",
};

function recommendationCard(
  rec: NonNullable<WeekEmailInput["recommendation"]>,
  weekUrl: string,
): RecommendationCard {
  // Side Bet's value less the amount is its limit, and the limit is net
  // assets ÷ 10: that one keeps its pounds in Pip, behind the dots.
  const sealed = rec.trigger === "side_bet_over_limit";
  const take = takeLine(rec.course, sealed ? null : rec.amountPence).replace("Pip's take: ", "");
  return {
    title: `Pip's take on ${rec.name}`,
    aside: `From ${shortDate(rec.createdAt)}`,
    fact: sealed ? SEALED_R1.fact : `${rec.title}.`,
    take:
      take.charAt(0).toUpperCase() +
      take.slice(1, -1) +
      (sealed ? " — the part above the limit." : "."),
    why: sealed ? SEALED_R1.why : rec.brief.why,
    discipline: rec.brief.typical,
    tradeOff: sealed ? SEALED_R1.tradeOff : rec.brief.tradeoff,
    closing:
      "Pip can't act on this, and there's no button here on purpose. Moving money happens at your broker.",
    href: weekUrl,
  };
}

/** The Monday email, and the words for its "Your week is ready" push. */
export function renderWeekEmail(
  input: WeekEmailInput,
): Email & { push: { title: string; body: string } } {
  const appUrl = input.appUrl ?? PIP_URL;
  const weekUrl = `${appUrl}/week`;
  const setupUrl = `${appUrl}/setup`;
  const { week, portfolio } = input;

  const items = nudges(week, weekUrl);
  const count = items.length + (input.recommendation ? 1 : 0);
  const quiet = count === 0;
  const thing = plural(count, "thing");

  const monday = new Date(`${week.weekOf}T12:00:00Z`);
  const lastMonday = new Date(monday.getTime() - 7 * 86_400_000);
  const sunday = new Date(monday.getTime() - 86_400_000);
  const from = parts(lastMonday);
  const range = `${from.weekday} ${from.day} – ${shortDate(sunday)}`;

  // The total's week is the pots' weeks added up, in pounds.
  const weeks = portfolio.buckets
    .filter((b) => b.status !== "not_connected")
    .map((b) => ({ value: b.value, change: weekChange(b) }));
  const total = weeks.every((w) => w.change)
    ? (() => {
        const amount = weeks.reduce((sum, w) => sum + w.change!.amount, 0);
        const before = portfolio.total - amount;
        return { amount, percent: before > 0 ? (amount / before) * 100 : 0 };
      })()
    : null;
  const totalChange = changeText(total);
  const moved =
    total && Math.round(total.amount / 100) !== 0
      ? `${total.amount > 0 ? "Up" : "Down"} ${pounds(total.amount)} this week.`
      : "Flat this week.";

  const asOf = portfolio.freshness
    .map((f) => Date.parse(f.freshness.asOf))
    .filter((t) => Number.isFinite(t));
  const pricesAt = new Date(asOf.length ? Math.max(...asOf) : input.now.getTime());

  const next = week.next;
  const digest: WeekDigestInput = {
    subjectVerdict: quiet ? "nothing needs you" : `${thing} worth a look`,
    preheader: quiet ? `${moved} Every pot is where you'd expect.` : `${moved} ${week.opening}`,
    range,
    verdict: quiet ? ["Nothing needs you this week."] : [`${thing} worth a look.`],
    ...(quiet
      ? {
          intro:
            "The pots are where they should be, and nothing Pip read got past your trust rules. That's the job done, not an empty inbox.",
        }
      : {}),
    total: {
      label: "Everything, this morning",
      value: pounds(portfolio.total),
      change: totalChange,
    },
    pots: pots(input, setupUrl),
    potsNote:
      "Foundation and Handpicked are judged against the shape you set. Side Bet sits outside it, with its own limit — in Setup, behind the dots.",
    ...(input.recommendation
      ? { recommendation: recommendationCard(input.recommendation, weekUrl) }
      : {}),
    nudges: items,
    checked: {
      summary:
        week.heldBack.length > 0
          ? `${plural(week.heldBack.length, "thing")} didn't get past your trust rules. They're one tap away in Pip.`
          : "Nothing was held back this week.",
      stats: [
        { value: String(week.counts.reportsRead), label: "reports read" },
        { value: String(week.counts.holdingsChecked), label: "holdings checked" },
        { value: String(week.counts.reportsCounted), label: "got past your trust rules" },
        {
          value: String(week.heldBack.length),
          label: "held back",
          heldBack: week.heldBack.length > 0,
        },
      ],
    },
    calendar: next ? [{ label: next.what, date: shortDay(next.onDate) }] : [],
    ...(next ? { nextUp: `${next.what}, ${shortDay(next.onDate)}.` } : {}),
    pricesAsAt: (() => {
      const p = parts(pricesAt);
      return `${p.longWeekday} ${p.day} ${p.month}, ${p.time}`;
    })(),
    email: input.to,
    markUrl: `${appUrl}${MARK_PATH}`,
    weekUrl,
    setupUrl,
  };

  return {
    ...weekDigestEmail(digest),
    push: {
      title: "Your week is ready",
      body: quiet
        ? "Nothing needs you this week."
        : `${thing[0]!.toUpperCase()}${thing.slice(1)} worth a look.`,
    },
  };
}
