import {
  block,
  card,
  chip,
  definitionRows,
  divider,
  emailDocument,
  footer,
  heading,
  link,
  linkRow,
  masthead,
  paragraph,
  sources,
} from "../components.js";
import { html, type Html } from "../html.js";
import { lines, wrap, type Email } from "../text.js";

/**
 * A recommendation's six parts, always in this order (design rule 9:
 * reasoning and trade-offs, always the reader's call). Only ever built for
 * personal_research users; code decides the take, the model only words it.
 */
export type Recommendation = {
  title: string;
  /** Beside the chip, e.g. "One a week, at most". */
  aside: string;
  fact: string;
  take: string;
  why: string;
  discipline: string;
  tradeOff: string;
  /** Under "Your call.", e.g. "Pip can't act on this and won't ask again…". */
  closing: string;
  sources?: readonly string[];
  href: string;
};

/** The digest card. Never shortened to make room. */
export function recommendationCard(r: Recommendation, side = 28): Html {
  const pad = (top: number, bottom = 0) => `${top}px ${side}px ${bottom}px`;
  return card(
    html`${block(pad(22), chip("Recommendation", "ink", r.aside))} ${heading(r.title, pad(14))}
    ${block(
      pad(16),
      definitionRows(
        [
          { label: "The fact", value: r.fact, strong: true },
          { label: "Pip's take", value: r.take, strong: true },
          { label: "Why", value: r.why },
          { label: "What a disciplined investor usually does", value: r.discipline },
          { label: "The trade-off", value: r.tradeOff },
        ],
        side === 28 ? 150 : 140,
      ),
    )}
    ${divider(pad(2))} ${heading("Your call.", pad(16), 19)}
    ${paragraph(r.closing, pad(6), 13.5, "ink3")}
    ${r.sources?.length ? sources(r.sources, side) : ""}
    ${linkRow(r.href, "See in Pip", pad(18, 24))}`,
    { strong: true },
  );
}

export function recommendationText(r: Recommendation): string {
  return lines(
    `[RECOMMENDATION]\n${r.title.toUpperCase()}`,
    `THE FACT\n${wrap(r.fact)}`,
    `PIP'S TAKE\n${wrap(r.take)}`,
    `WHY\n${wrap(r.why)}`,
    `WHAT A DISCIPLINED INVESTOR USUALLY DOES\n${wrap(r.discipline)}`,
    `THE TRADE-OFF\n${wrap(r.tradeOff)}`,
    `YOUR CALL.\n${wrap(r.closing)}`,
    r.sources?.length ? wrap(`Sources: ${r.sources.join("; ")}.`) : "",
    `See in Pip: ${r.href}`,
  ).trimEnd();
}

export type RecommendationEmailInput = {
  subject: string;
  preheader: string;
  /** Masthead date, e.g. "Thu 18 Sep, 08:10". */
  sentAt: string;
  recommendation: Recommendation;
  email: string;
  markUrl: string;
  setupUrl: string;
};

/** The digest card sent alone, when waiting for Monday would cost something. */
export function recommendationEmail(input: RecommendationEmailInput): Email {
  const r = input.recommendation;
  const body = html`${masthead(input.markUrl, { right: input.sentAt })} ${recommendationCard(r, 22)}
  ${footer({
    advice: true,
    lines: [
      "Pip is read-only and can't buy, sell or move anything. Nothing here is personal advice or a recommendation to deal.",
      html`Sent to ${input.email}. ${link(input.setupUrl, "Manage in Setup")} &middot; Pip, London`,
    ],
  })}`;
  const text = lines(
    `PIP — ${input.sentAt}`,
    recommendationText(r),
    `--\nINFORMATION, NOT ADVICE. ${wrap("Pip is read-only and can't buy, sell or move anything.")}\nManage alerts: ${input.setupUrl}\nPip, London.`,
  );
  return {
    subject: input.subject,
    preheader: input.preheader,
    html: emailDocument({ title: input.subject, preheader: input.preheader, body }),
    text,
  };
}
