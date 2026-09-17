import {
  amberCallout,
  bigNumber,
  block,
  card,
  checks,
  chip,
  dateList,
  divider,
  emailDocument,
  eyebrow,
  footer,
  heading,
  link,
  linkRow,
  masthead,
  paragraph,
  potLine,
  potRow,
  smallPrint,
  sources,
  type Change,
  type PotRow,
} from "../components.js";
import { html, raw, type Html } from "../html.js";
import { SANS, SERIF, amber, light, potName, type Pot, type Tone } from "../theme.js";
import { RULE, lines, textBar, wrap, type Email } from "../text.js";
import { recommendationCard, recommendationText, type Recommendation } from "./recommendation.js";

export type NudgeKind = "calendar" | "shape" | "awareness";

export type DigestNudge = {
  kind: NudgeKind;
  title: string;
  body: string;
  sources?: readonly string[];
  checks?: readonly string[];
  href: string;
};

export type DigestPot =
  | (PotRow & { /** The quiet week's one-word status, e.g. "on its line". */ status: string })
  | { pot: Pot; missing: { body: string; link: { href: string; label: string } } };

export type WeekDigestInput = {
  /** Verdict for the subject, e.g. "nothing needs you". */
  subjectVerdict: string;
  preheader: string;
  /** e.g. "Mon 14 – Sun 20 Sep" */
  range: string;
  /** Headline verdict; each entry is a line. */
  verdict: readonly string[];
  /** Quiet week only: the sentence under the verdict. */
  intro?: string;
  /** Stale prices: a banner above the number. */
  stale?: { lead: string; body: string };
  total: { label: string; value: string; asAt?: string; change: Change; note?: string };
  pots: readonly DigestPot[];
  potsNote?: string;
  recommendation?: Recommendation;
  nudges: readonly DigestNudge[];
  /** Quiet week: "No nudges." sentence. Busy week: the "What Pip checked" block. */
  checked: {
    summary: string;
    stats?: readonly { value: string; label: string; heldBack?: boolean }[];
  };
  calendar: readonly { label: string; date: string }[];
  /** Quiet week: the "Next up" sentence instead of the calendar card. */
  nextUp?: string;
  pricesAsAt: string;
  email: string;
  markUrl: string;
  weekUrl: string;
  setupUrl: string;
};

/** Four is the ceiling; order never changes. */
export const MAX_NUDGES = 4;
const ORDER: Record<NudgeKind, number> = { calendar: 0, shape: 1, awareness: 2 };
const CHIP: Record<NudgeKind, { label: string; tone: Tone }> = {
  calendar: { label: "Calendar", tone: "handpicked" },
  shape: { label: "Shape", tone: "foundation" },
  awareness: { label: "Awareness", tone: "amber" },
};

function isMissing(p: DigestPot): p is Extract<DigestPot, { missing: unknown }> {
  return "missing" in p;
}

function fullNudge(n: DigestNudge): Html {
  const c = CHIP[n.kind];
  return card(
    html`${block("22px 28px 0", chip(c.label, c.tone))} ${heading(n.title)} ${paragraph(n.body)}
    ${n.sources?.length ? sources(n.sources) : ""} ${n.checks?.length ? checks(n.checks) : ""}
    ${linkRow(n.href, "See in Pip")}`,
  );
}

function shortNudge(n: DigestNudge): Html {
  const c = CHIP[n.kind];
  return card(
    html`${block("16px 18px 0", chip(c.label, c.tone))} ${heading(n.title, "10px 18px 0", 18)}
    ${paragraph(n.body, "6px 18px 0", 14)} ${linkRow(n.href, "See in Pip", "10px 18px 16px")}`,
  );
}

function checkedCard(checked: WeekDigestInput["checked"]): Html {
  const stats = checked.stats ?? [];
  const rows: Html[] = [];
  for (let i = 0; i < stats.length; i += 2) {
    const pair = stats.slice(i, i + 2);
    rows.push(
      html`<tr>
        ${pair.map(
          (s) =>
            html`<td width="50%" valign="top" style="padding-bottom:14px">
              <div
                class="${s.heldBack ? "pe-amber-t" : "pe-ink"}"
                style="font-family:${raw(SERIF)};font-size:24px;color:${raw(s.heldBack ? amber.number : light.ink)}"
              >
                ${s.value}
              </div>
              <div class="pe-ink3" style="font-size:13px;color:${raw(light.ink3)};padding-top:2px">
                ${s.label}
              </div>
            </td>`,
        )}
      </tr>`,
    );
  }
  return card(
    html`${heading("What Pip checked", "22px 28px 0", 19)}
    ${block(
      "14px 28px 0",
      html`<table
        role="presentation"
        cellpadding="0"
        cellspacing="0"
        border="0"
        width="100%"
        style="border-collapse:collapse;font-family:${raw(SANS)}"
      >
        ${rows}
      </table>`,
    )}
    ${smallPrint(checked.summary, "0 28px 24px")}`,
  );
}

/** Monday's email. Order is fixed: verdict, total, pots, what needs you, what Pip checked, what's coming. */
export function weekDigestEmail(input: WeekDigestInput): Email {
  const subject = `Your week: ${input.subjectVerdict}`;
  const items = [...input.nudges].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  const room = MAX_NUDGES - (input.recommendation ? 1 : 0);
  const shown = items.slice(0, room);
  const hidden = items.length - shown.length;
  const quiet = !input.recommendation && items.length === 0;
  const busy = (input.recommendation ? 1 : 0) + shown.length > 2;

  const staleBanner = input.stale
    ? html`<table
        role="presentation"
        cellpadding="0"
        cellspacing="0"
        border="0"
        width="100%"
        class="pe-amber"
        style="border-collapse:collapse;background:${raw(amber.tint)};border:1px solid ${raw(amber.border)};margin-top:14px"
      >
        <tr>
          <td
            class="pe-ink2"
            style="padding:13px 16px;font-family:${raw(SANS)};font-size:14px;line-height:1.6;color:${raw(light.ink2)}"
          >
            <strong class="pe-amber-t" style="color:${raw(amber.text)}">${input.stale.lead}</strong>
            ${input.stale.body}
          </td>
        </tr>
      </table>`
    : "";

  const verdict = html`${input.verdict.map((l, i) => html`${i > 0 ? raw("<br>") : ""}${l}`)}`;
  const totalBlock = block(quiet ? "22px 28px 0" : "20px 28px 0", bigNumber(input.total));

  const headCard = quiet
    ? card(
        html`${heading(verdict, "28px 28px 0", 29)}
        ${input.intro ? paragraph(input.intro, "12px 28px 0", 15.5) : ""} ${totalBlock}
        ${block(
          "20px 28px 0",
          html`<table
            role="presentation"
            cellpadding="0"
            cellspacing="0"
            border="0"
            width="100%"
            style="border-collapse:collapse"
          >
            ${input.pots.map((p, i) =>
              isMissing(p)
                ? html`<tr>
                    <td style="padding:10px 0">
                      ${amberCallout({ title: `${potName[p.pot]} · not counted`, body: p.missing.body, link: p.missing.link })}
                    </td>
                  </tr>`
                : potLine(p, i === input.pots.length - 1),
            )}
          </table>`,
        )}
        ${paragraph(html`<strong>No nudges.</strong> ${input.checked.summary}`, "20px 28px 0", 14)}
        ${input.nextUp ? paragraph(html`<strong>Next up:</strong> ${input.nextUp}`, "16px 28px 0", 14) : ""}
        ${linkRow(input.weekUrl, "See the week in Pip", "20px 28px 26px")}`,
      )
    : card(
        html`${heading(verdict, "26px 28px 0", 26)} ${totalBlock} ${divider()}
        ${eyebrow("The three pots", "18px 28px 4px")}
        ${input.pots.map((p, i) =>
          block(
            i === 0 ? "10px 28px 0" : "8px 28px 0",
            isMissing(p)
              ? amberCallout({
                  title: `${potName[p.pot]} · not counted`,
                  body: p.missing.body,
                  link: p.missing.link,
                })
              : potRow(p),
          ),
        )}
        ${input.potsNote ? smallPrint(input.potsNote, "12px 28px 26px") : block("0 28px 22px", "")}`,
      );

  const needs = html`${input.recommendation ? recommendationCard(input.recommendation) : ""}
  ${shown.map((n) => (busy ? shortNudge(n) : fullNudge(n)))}
  ${hidden > 0 ? card(paragraph(html`And ${hidden} smaller ${hidden === 1 ? "thing" : "things"} in Pip. ${link(input.weekUrl, "See the week")}`, "16px 18px 16px", 14)) : ""}`;

  const tail = quiet
    ? ""
    : html`${checkedCard(input.checked)}
      ${
        input.calendar.length
          ? card(
              html`${heading("Next on the calendar", "22px 28px 0", 19)}
              ${block("12px 28px 0", dateList(input.calendar))}
              ${smallPrint("Dates from the companies themselves. Pip doesn't guess what they'll say.", "16px 28px 24px")}`,
            )
          : ""
      }`;

  const foot = quiet
    ? footer({
        advice: true,
        lines: [
          html`Sent every Monday to ${input.email}. ${link(input.setupUrl, "Manage in Setup")}. Pip,
          London — read-only by design.`,
        ],
      })
    : footer({
        advice: true,
        markUrl: input.markUrl,
        lines: [
          `Pip is read-only and can't buy, sell or move anything. Nothing here is personal advice or a recommendation to deal, and past performance says nothing about what happens next. Prices as at ${input.pricesAsAt}.`,
          html`Sent every Monday to ${input.email}. ${link(input.setupUrl, "Manage in Setup")} —
          turn this off.`,
        ],
      });

  const body = html`${masthead(input.markUrl, { right: input.range })} ${staleBanner} ${headCard}
  ${quiet ? "" : needs} ${tail} ${foot}`;

  return {
    subject,
    preheader: input.preheader,
    html: emailDocument({ title: subject, preheader: input.preheader, body }),
    text: weekDigestText(input, { quiet, shown, hidden }),
  };
}

function changeText(c: Change): string {
  if (c.direction === "flat") return c.text;
  return `${c.direction === "up" ? "Up" : "Down"} ${c.text}`;
}

function weekDigestText(
  input: WeekDigestInput,
  { quiet, shown, hidden }: { quiet: boolean; shown: readonly DigestNudge[]; hidden: number },
): string {
  const pots = input.pots
    .map((p) =>
      isMissing(p)
        ? `${potName[p.pot]}   NOT COUNTED\n${wrap(p.missing.body)}\n${p.missing.link.label}: ${p.missing.link.href}`
        : `${potName[p.pot]}   ${p.value}   ${changeText(p.change)}${p.capLabel ? "   [CAPPED]" : ""}\n  ${quiet ? p.status : p.line}${quiet ? "" : `\n  ${textBar(p.sharePercent)}`}`,
    )
    .join("\n");

  const nudges = shown.map((n) =>
    lines(
      `[${CHIP[n.kind].label.toUpperCase()}]\n${n.title.toUpperCase()}`,
      wrap(n.body),
      [
        n.sources?.length ? wrap(`Sources: ${n.sources.join("; ")}.`) : "",
        n.checks?.length ? wrap(`Checks passed: ${n.checks.join("; ")}.`) : "",
        `See in Pip: ${n.href}`,
      ]
        .filter(Boolean)
        .join("\n"),
    ).trimEnd(),
  );

  return lines(
    `PIP — YOUR WEEK\n${input.range}`,
    input.verdict.join(" ").toUpperCase(),
    input.intro && wrap(input.intro),
    input.stale && wrap(`${input.stale.lead} ${input.stale.body}`),
    `${input.total.label.toUpperCase()}\n${input.total.value}${input.total.asAt ? ` (${input.total.asAt})` : ""}\n${changeText(input.total.change)}${input.total.note ? `\n${wrap(input.total.note)}` : ""}`,
    `THE THREE POTS\n${pots}`,
    input.potsNote && wrap(input.potsNote),
    quiet && wrap(`No nudges. ${input.checked.summary}`),
    quiet && input.nextUp && wrap(`Next up: ${input.nextUp}`),
    ...(quiet
      ? [`See the week in Pip: ${input.weekUrl}`]
      : [
          input.recommendation && `${RULE}\n${recommendationText(input.recommendation)}`,
          ...nudges.map((n) => `${RULE}\n${n}`),
          hidden > 0 &&
            `And ${hidden} smaller ${hidden === 1 ? "thing" : "things"} in Pip: ${input.weekUrl}`,
          `${RULE}\nWHAT PIP CHECKED\n${(input.checked.stats ?? []).map((s) => `${s.value} ${s.label}`).join("\n")}\n${wrap(input.checked.summary)}`,
          input.calendar.length > 0 &&
            `NEXT ON THE CALENDAR\n${input.calendar.map((c) => `${c.date.padEnd(11)} ${c.label}`).join("\n")}`,
        ]),
    `${RULE}\nINFORMATION, NOT ADVICE\n${wrap(`Pip is read-only and can't buy, sell or move anything. Nothing here is personal advice or a recommendation to deal. Past performance says nothing about what happens next. Prices as at ${input.pricesAsAt}.`)}`,
    `${wrap(`Sent every Monday to ${input.email}.`)}\nTurn it off: ${input.setupUrl}`,
    "Pip, London.",
  );
}
