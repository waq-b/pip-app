import {
  block,
  card,
  chip,
  emailDocument,
  factBox,
  footer,
  heading,
  limitBar,
  link,
  linkRow,
  mark,
  paragraph,
  sources,
  type Change,
} from "../components.js";
import { html, raw } from "../html.js";
import { light, type Tone } from "../theme.js";
import { lines, textBar, wrap, type Email } from "../text.js";

/**
 * One template, four fills: limit at 80%, cap reached, an urgent move, push
 * stopped. Short and identical in shape: chip, headline, the fact in a box,
 * two or three sentences, one link, footer.
 */
export type AlertInput = {
  subject: string;
  preheader: string;
  chip: { label: string; tone: Tone };
  title: string;
  limit?: { caption: string; percent: number; footnote: string };
  fact?: { label: string; value: string; direction: Change["direction"]; note?: string };
  paragraphs: readonly string[];
  sources?: readonly string[];
  /** Mandatory on any alert triggered by a price. */
  notSuggesting?: { lead: string; body: string };
  link: { href: string; label: string };
  /** Anything mentioning a holding, a price or a nudge carries the label. */
  advice: boolean;
  setupUrl: string;
  markUrl: string;
};

const SIDE = 22;

export function alertEmail(input: AlertInput): Email {
  const chipRow = input.limit
    ? html`<table
        role="presentation"
        cellpadding="0"
        cellspacing="0"
        border="0"
        width="100%"
        style="border-collapse:collapse"
      >
        <tr>
          <td>${chip(input.chip.label, input.chip.tone)}</td>
          <td align="right" valign="middle" width="18">${mark(input.markUrl, 18)}</td>
        </tr>
      </table>`
    : chip(input.chip.label, input.chip.tone);

  const body = html`${card(
    html`${block(`20px ${SIDE}px 0`, chipRow)} ${heading(input.title, `13px ${SIDE}px 0`, 22)}
    ${input.limit ? block(`14px ${SIDE}px 0`, limitBar(input.limit)) : ""}
    ${input.fact ? block(`14px ${SIDE}px 0`, factBox(input.fact)) : ""}
    ${input.paragraphs.map((p) => paragraph(p, `14px ${SIDE}px 0`))}
    ${input.sources?.length ? sources(input.sources, SIDE) : ""}
    ${input.notSuggesting ? paragraph(html`<strong class="pe-ink2" style="color:${raw(light.ink2)}">${input.notSuggesting.lead}</strong> ${input.notSuggesting.body}`, `14px ${SIDE}px 0`, 13.5, "ink3") : ""}
    ${linkRow(input.link.href, input.link.label, `16px ${SIDE}px 22px`)}`,
    { spaced: false },
  )}
  ${footer({
    advice: input.advice,
    lines: [
      input.advice
        ? html`Pip is read-only and can't buy or sell. ${link(input.setupUrl, "Manage in Setup")}
          &middot; Pip, London`
        : html`${link(input.setupUrl, "Manage in Setup")} &middot; Pip, London`,
    ],
  })}`;

  const text = lines(
    `PIP — ${input.chip.label.toUpperCase()}`,
    input.title.toUpperCase(),
    input.limit &&
      `${input.limit.caption.replace(/\s*·\s*/, " (")})\n${textBar(input.limit.percent)}\n${wrap(input.limit.footnote)}`,
    input.fact &&
      `${input.fact.label.toUpperCase()}\n${input.fact.direction === "down" ? "Down " : input.fact.direction === "up" ? "Up " : ""}${input.fact.value}${input.fact.note ? `\n${wrap(input.fact.note)}` : ""}`,
    ...input.paragraphs.map((p) => wrap(p)),
    input.sources?.length ? wrap(`Sources: ${input.sources.join("; ")}.`) : "",
    input.notSuggesting && wrap(`${input.notSuggesting.lead} ${input.notSuggesting.body}`),
    `${input.link.label}:\n${input.link.href}`,
    `--\n${input.advice ? `INFORMATION, NOT ADVICE. ${wrap("Pip is read-only and can't buy or sell.")}\n` : ""}Manage alerts: ${input.setupUrl}\nPip, London.`,
  );

  return {
    subject: input.subject,
    preheader: input.preheader,
    html: emailDocument({ title: input.subject, preheader: input.preheader, body }),
    text,
  };
}
