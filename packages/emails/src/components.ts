/**
 * The shipped component set from the design board ("07 — What I'd ship"):
 * big number, per-pot rows, the limit bar, pot rails, chips, sources, checks.
 * Everything is a table with a background colour and inline styles. No
 * border-radius, gradients, background images, webfonts or SVG.
 */
import { html, raw, type Child, type Html } from "./html.js";
import {
  SANS,
  SERIF,
  amber,
  headStyles,
  light,
  potColour,
  potName,
  tone,
  type Pot,
  type Tone,
} from "./theme.js";

const L = light;
const TABLE = `role="presentation" cellpadding="0" cellspacing="0" border="0"`;

function t(attrs: string, style: string, body: Child): Html {
  return html`<table ${raw(TABLE)} ${raw(attrs)} style="${raw(style)}">
    ${body}
  </table>`;
}

type Text = {
  pad: string;
  size: number;
  colour?: "ink" | "ink2" | "ink3";
  serif?: boolean;
  weight?: number;
  lh?: number;
  extra?: string;
};

function textCell(
  { pad, size, colour = "ink2", serif, weight, lh, extra = "" }: Text,
  body: Child,
): Html {
  const style = [
    `padding:${pad}`,
    `font-family:${serif ? SERIF : SANS}`,
    `font-size:${size}px`,
    `line-height:${lh ?? (serif ? 1.25 : 1.6)}`,
    `color:${L[colour]}`,
    weight ? `font-weight:${weight}` : "",
    extra,
  ]
    .filter(Boolean)
    .join(";");
  return html`<tr>
    <td class="pe-pad pe-${colour}" style="${raw(style)}">${body}</td>
  </tr>`;
}

// ─── document ─────────────────────────────────────────────────────────────────

export type DocumentInput = {
  title: string;
  /** Hidden inbox preview line. */
  preheader: string;
  body: Child;
};

export function emailDocument({ title, preheader, body }: DocumentInput): string {
  const page = html`<!DOCTYPE html>
    <html lang="en-GB" xmlns="http://www.w3.org/1999/xhtml">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="x-apple-disable-message-reformatting" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <title>${title}</title>
        <style>
          ${raw(headStyles())}
        </style>
      </head>
      <body class="pe-bg" style="margin:0;padding:0;background:${raw(L.ground)}">
        <div
          style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all"
        >
          ${preheader}${raw("&#8199;&#847;".repeat(40))}
        </div>
        ${t(
          `width="100%" class="pe-bg"`,
          `border-collapse:collapse;background:${L.ground}`,
          html`<tr>
            <td align="center" style="padding:26px 0">
              ${t(
                `width="600" align="center" class="pe-outer"`,
                "border-collapse:collapse;margin:0 auto;width:600px",
                html`<tr>
                  <td class="pe-gutter" style="padding:0 36px">${body}</td>
                </tr>`,
              )}
            </td>
          </tr>`,
        )}
      </body>
    </html> `;
  return tidy(page.value);
}

/**
 * Collapses the source's indentation out of the sent markup, so a code or a
 * number never picks up stray spaces when someone selects and copies it.
 */
function tidy(markup: string): string {
  return (
    markup
      .replace(/\s+/g, " ")
      .replace(/>\s+</g, "><")
      .replace(/(<(?:td|div|a|strong|span|title)\b[^>]*>) /g, "$1")
      .replace(/ (<\/(?:td|div|a|strong|span|title)>)/g, "$1")
      .replace(/<(tr|table|style|head|body|html)\b/g, "\n<$1")
      .trim() + "\n"
  );
}

// ─── brand ────────────────────────────────────────────────────────────────────

/** The Pip mark: a 96px PNG, decoration only, with the text wordmark beside it. */
export function mark(markUrl: string, size: number): Html {
  return html`<img
    src="${markUrl}"
    width="${size}"
    height="${size}"
    alt=""
    style="display:block;border:0;outline:none;width:${size}px;height:${size}px"
  />`;
}

export function masthead(
  markUrl: string,
  opts: { size?: "large" | "small"; right?: string } = {},
): Html {
  const large = opts.size === "large";
  return t(
    `width="100%"`,
    "border-collapse:collapse",
    html`<tr>
      <td valign="middle" style="padding-right:9px;width:${large ? 26 : 24}px">
        ${mark(markUrl, large ? 26 : 24)}
      </td>
      <td
        valign="middle"
        class="pe-ink"
        style="font-family:${raw(SERIF)};font-size:${large ? 22 : 19}px;color:${raw(L.ink)}"
      >
        Pip
      </td>
      ${opts.right ? html`<td valign="middle" align="right" class="pe-ink3" style="font-family:${raw(SANS)};font-size:12.5px;color:${raw(L.ink3)};font-weight:700">${opts.right}</td>` : ""}
    </tr>`,
  );
}

// ─── containers ───────────────────────────────────────────────────────────────

export function card(rows: Child, opts: { strong?: boolean; spaced?: boolean } = {}): Html {
  const border = opts.strong ? `2px solid ${L.ink}` : `1px solid ${L.cardBorder}`;
  return t(
    `width="100%" class="pe-card${opts.strong ? " pe-inkborder" : ""}"`,
    `border-collapse:collapse;background:${L.card};border:${border}${opts.spaced === false ? "" : ";margin-top:14px"}`,
    rows,
  );
}

/** A row inside a card holding arbitrary content. */
export function block(pad: string, body: Child): Html {
  return html`<tr>
    <td class="pe-pad" style="padding:${raw(pad)}">${body}</td>
  </tr>`;
}

export const heading = (text: Child, pad = "14px 28px 0", size = 21) =>
  textCell({ pad, size, serif: true, colour: "ink", lh: 1.3 }, text);

export const paragraph = (
  text: Child,
  pad = "9px 28px 0",
  size = 15,
  colour: "ink" | "ink2" | "ink3" = "ink2",
) => textCell({ pad, size, colour, lh: 1.62 }, text);

export const smallPrint = (text: Child, pad = "14px 28px 24px") =>
  textCell({ pad, size: 13.5, colour: "ink3" }, text);

export const eyebrow = (text: Child, pad = "16px 28px 0") =>
  textCell(
    {
      pad,
      size: 11,
      colour: "ink3",
      weight: 700,
      extra: "letter-spacing:.08em;text-transform:uppercase",
    },
    text,
  );

export function divider(pad = "22px 28px 0"): Html {
  return block(
    pad,
    t(
      `width="100%"`,
      "border-collapse:collapse",
      html`<tr>
        <td class="pe-rule" style="height:1px;background:${raw(L.rule)};font-size:0;line-height:0">
          &nbsp;
        </td>
      </tr>`,
    ),
  );
}

export function link(href: string, label: Child): Html {
  return html`<a
    href="${href}"
    class="pe-link"
    style="color:${raw(L.link)};font-weight:700;text-decoration:underline;text-underline-offset:2px"
    >${label}</a
  >`;
}

export const linkRow = (href: string, label: string, pad = "18px 28px 24px") =>
  textCell({ pad, size: 14.5 }, link(href, html`${label} &#8594;`));

// ─── chips ────────────────────────────────────────────────────────────────────

export function chip(label: string, kind: Tone, aside?: string): Html {
  const c = tone[kind];
  return t(
    "",
    "border-collapse:collapse",
    html`<tr>
      <td
        class="pe-chip-${kind}"
        style="background:${raw(c.bg)};border:1px solid ${raw(c.border)};padding:5px 10px;font-family:${raw(SANS)};font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:${raw(c.text)}"
      >
        ${label}
      </td>
      ${
        aside
          ? html`<td style="width:10px;font-size:0">&nbsp;</td>
              <td
                class="pe-ink3"
                style="font-family:${raw(SANS)};font-size:11.5px;color:${raw(L.ink3)};font-weight:700"
              >
                ${aside}
              </td>`
          : ""
      }
    </tr>`,
  );
}

/** The "Information, not advice" label. */
export function adviceLabel(): Html {
  return t(
    "",
    "border-collapse:collapse",
    html`<tr>
      <td
        class="pe-label"
        style="border:1px solid ${raw(L.labelBorder)};padding:6px 11px;font-family:${raw(SANS)};font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${raw(L.ink2)}"
      >
        Information, not advice
      </td>
    </tr>`,
  );
}

// ─── numbers ──────────────────────────────────────────────────────────────────

export type Change = { text: string; direction: "up" | "down" | "flat" };

export function arrow(direction: Change["direction"]): Html {
  return direction === "up" ? raw("&#8593; ") : direction === "down" ? raw("&#8595; ") : raw("");
}

/** Big number with its change line. Pounds first, percentage second. */
export function bigNumber(input: {
  label: string;
  value: string;
  asAt?: string;
  change: Change;
  note?: string;
}): Html {
  const colour = input.change.direction === "down" ? L.dn : L.up;
  const cls = input.change.direction === "down" ? "pe-dn" : "pe-up";
  return html`<div
      class="pe-ink3"
      style="font-family:${raw(SANS)};font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:${raw(L.ink3)};font-weight:700"
    >
      ${input.label}
    </div>
    <div
      class="pe-ink pe-hero"
      style="font-family:${raw(SERIF)};font-size:42px;line-height:1.08;color:${raw(L.ink)};padding-top:6px"
    >
      ${input.value}${input.asAt ? html`<span class="pe-amber-t" style="font-family:${raw(SANS)};font-size:14px;color:${raw(amber.text)};font-weight:700">&nbsp;&nbsp;${input.asAt}</span>` : ""}
    </div>
    <div
      class="${cls}"
      style="font-family:${raw(SANS)};font-size:15.5px;color:${raw(colour)};font-weight:700;padding-top:5px"
    >
      ${arrow(input.change.direction)}${input.change.text}
    </div>
    ${input.note ? html`<div class="pe-ink3" style="font-family:${raw(SANS)};font-size:13.5px;color:${raw(L.ink3)};padding-top:6px;line-height:1.5">${input.note}</div>` : ""}`;
}

/** Two cells, percentage widths, no image. */
export function bar(
  percent: number,
  colourClass: string,
  colour: string,
  height: number,
  marker = false,
): Html {
  const filled = Math.max(1, Math.min(100, Math.round(percent)));
  const rest = 100 - filled;
  return t(
    `width="100%"`,
    "border-collapse:collapse",
    html`<tr>
      <td
        width="${filled}%"
        class="${colourClass}"
        style="background:${raw(colour)};height:${height}px;font-size:0;line-height:0"
      >
        &nbsp;
      </td>
      ${rest > 0 ? html`<td width="${rest}%" class="pe-track${marker ? " pe-inkborder" : ""}" style="background:${raw(L.track)};height:${height}px;font-size:0;line-height:0${raw(marker ? `;border-left:2px solid ${L.ink}` : "")}">&nbsp;</td>` : ""}
    </tr>`,
  );
}

export type PotRow = {
  pot: Pot;
  value: string;
  /** Share of everything, 0–100, drawn as the mini bar. */
  sharePercent: number;
  change: Change;
  /** e.g. "72% of you, 2 over its 70% line" */
  line: string;
  /** Side Bet only: shown in clay beside the name, e.g. "Capped at 5%". */
  capLabel?: string;
  /** Draws the row in clay (Side Bet over its cap). */
  overCap?: boolean;
};

function dashedFence(colour: string, cls: string): Html {
  const cells = Array.from({ length: 8 }, (_, i) =>
    i % 2 === 0
      ? html`<td
          width="12.5%"
          class="${cls}"
          style="background:${raw(colour)};height:6px;font-size:0;line-height:0"
        >
          &nbsp;
        </td>`
      : html`<td
          width="12.5%"
          class="pe-bg"
          style="background:${raw(L.ground)};height:6px;font-size:0;line-height:0"
        >
          &nbsp;
        </td>`,
  );
  return html`<tr>
    <td style="padding:0">
      ${t(
        `width="100%"`,
        "border-collapse:collapse",
        html`<tr>
          ${cells}
        </tr>`,
      )}
    </td>
  </tr>`;
}

/** Per-pot row with a 6px rail and mini bar. Side Bet also gets the dashed fence and a full clay border. */
export function potRow(row: PotRow): Html {
  const c = potColour[row.pot].light;
  const fenced = row.pot === "sideBet";
  const border = fenced
    ? `border:1px solid ${c};border-left:6px solid ${c}`
    : `border-left:6px solid ${c}`;
  const lineColour = row.overCap ? L.dn : L.ink2;
  const body = html`<tr>
    <td style="padding:13px 14px;font-family:${raw(SANS)}">
      ${t(
        `width="100%"`,
        "border-collapse:collapse",
        html`<tr>
          <td class="pe-ink" style="font-size:15px;font-weight:700;color:${raw(L.ink)}">
            ${potName[row.pot]}${row.capLabel ? html` <span class="pe-dn" style="font-size:11px;letter-spacing:.06em;color:${raw(L.dn)};font-weight:800;text-transform:uppercase">&nbsp;${row.capLabel}</span>` : ""}
          </td>
          <td
            align="right"
            class="pe-ink"
            style="font-family:${raw(SERIF)};font-size:17px;color:${raw(L.ink)}"
          >
            ${row.value}
          </td>
        </tr>`,
      )}
      <div style="padding-top:8px">${bar(row.sharePercent, `pe-${row.pot}`, c, 9)}</div>
      <div
        class="${row.overCap ? "pe-dn" : "pe-ink2"}"
        style="font-size:13px;line-height:1.5;color:${raw(lineColour)};padding-top:7px${raw(row.overCap ? ";font-weight:600" : "")}"
      >
        ${arrow(row.change.direction)}${row.change.text} &nbsp;&middot;&nbsp;
        <span
          class="${row.overCap ? "pe-dn" : "pe-ink3"}"
          style="color:${raw(row.overCap ? L.dn : L.ink3)}"
          >${row.line}</span
        >
      </div>
    </td>
  </tr>`;
  return t(
    `width="100%" class="pe-sunk pe-${row.pot}-b"`,
    `border-collapse:collapse;${border};background:${L.sunk}`,
    html`${fenced ? dashedFence(c, `pe-${row.pot}`) : ""}${body}`,
  );
}

/** The quiet week's one-line pot: swatch, name, status, value. */
export function potLine(input: { pot: Pot; status: string; value: string }, last: boolean): Html {
  const c = potColour[input.pot].light;
  return html`<tr>
    <td
      class="pe-rule-b"
      style="padding:10px 0;border-top:1px solid ${raw(L.rule)}${raw(last ? `;border-bottom:1px solid ${L.rule}` : "")}"
    >
      ${t(
        `width="100%"`,
        "border-collapse:collapse",
        html`<tr>
          <td
            width="8"
            class="pe-${input.pot}"
            style="background:${raw(c)};height:14px;font-size:0;line-height:0"
          >
            &nbsp;
          </td>
          <td
            class="pe-ink"
            style="padding-left:10px;font-family:${raw(SANS)};font-size:14.5px;color:${raw(L.ink)};font-weight:600"
          >
            ${potName[input.pot]} &nbsp;<span
              class="pe-ink3"
              style="color:${raw(L.ink3)};font-weight:500"
              >${input.status}</span
            >
          </td>
          <td
            align="right"
            class="pe-ink"
            style="font-family:${raw(SERIF)};font-size:16px;color:${raw(L.ink)}"
          >
            ${input.value}
          </td>
        </tr>`,
      )}
    </td>
  </tr>`;
}

/** Limit bar with the 100% mark as a 2px ink edge. */
export function limitBar(input: {
  caption: string;
  percent: number;
  footnote: string;
  pot?: Pot;
}): Html {
  const pot = input.pot ?? "sideBet";
  return t(
    `width="100%" class="pe-sunk"`,
    `border-collapse:collapse;background:${L.sunk};border:1px solid ${L.cardBorder}`,
    html`<tr>
      <td style="padding:14px 16px;font-family:${raw(SANS)}">
        <div
          class="pe-ink"
          style="font-size:13px;font-weight:700;color:${raw(L.ink)};padding-bottom:9px"
        >
          ${input.caption}
        </div>
        ${bar(input.percent, `pe-${pot}`, potColour[pot].light, 16, true)}
        <div
          class="pe-ink3"
          style="font-size:11px;color:${raw(L.ink3)};font-weight:700;padding-top:6px"
        >
          ${input.footnote}
        </div>
      </td>
    </tr>`,
  );
}

/** The inset "fact in a box" of an alert. */
export function factBox(input: {
  label: string;
  value: string;
  direction: Change["direction"];
  note?: string;
}): Html {
  const down = input.direction === "down";
  return t(
    `width="100%" class="pe-sunk"`,
    `border-collapse:collapse;background:${L.sunk};border:1px solid ${L.cardBorder}`,
    html`<tr>
      <td style="padding:14px 16px;font-family:${raw(SANS)}">
        <div
          class="pe-ink3"
          style="font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:${raw(L.ink3)};font-weight:700"
        >
          ${input.label}
        </div>
        <div
          class="${down ? "pe-dn" : "pe-up"}"
          style="font-family:${raw(SERIF)};font-size:28px;line-height:1.1;color:${raw(down ? L.dn : L.up)};padding-top:5px"
        >
          ${arrow(input.direction)}${input.value}
        </div>
        ${input.note ? html`<div class="pe-ink3" style="font-size:13px;color:${raw(L.ink3)};padding-top:4px">${input.note}</div>` : ""}
      </td>
    </tr>`,
  );
}

/** Amber callout: nothing wrong with the money, Pip just can't see part of it. */
export function amberCallout(input: {
  title?: string;
  body: Child;
  link?: { href: string; label: string };
}): Html {
  return t(
    `width="100%" class="pe-amber"`,
    `border-collapse:collapse;background:${amber.softTint};border:1px solid ${amber.border};border-left:6px solid ${amber.rail}`,
    html`<tr>
      <td style="padding:14px 16px;font-family:${raw(SANS)}">
        ${input.title ? html`<div class="pe-amber-t" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${raw(amber.text)};font-weight:800;padding-bottom:7px">${input.title}</div>` : ""}
        <div class="pe-ink2" style="font-size:14.5px;line-height:1.6;color:${raw(L.ink2)}">
          ${input.body}
        </div>
        ${input.link ? html`<div style="padding-top:10px;font-size:14px">${link(input.link.href, html`${input.link.label} &#8594;`)}</div>` : ""}
      </td>
    </tr>`,
  );
}

/** Sources as one line, separated by middots. */
export function sources(items: readonly string[], side = 28): Html {
  return html`${eyebrow("Sources", `16px ${side}px 0`)}${textCell(
    { pad: `5px ${side}px 0`, size: 13.5 },
    items.map((s, i) => html`${i > 0 ? raw(" &nbsp;&middot;&nbsp; ") : ""}${s}`),
  )}`;
}

/** Checks as a tick column. */
export function checks(items: readonly string[], side = 28): Html {
  return html`${eyebrow("Which checks it passed", `14px ${side}px 0`)}${block(
    `5px ${side}px 0`,
    t(
      `width="100%"`,
      `border-collapse:collapse;font-family:${SANS}`,
      items.map(
        (item) =>
          html`<tr>
            <td
              width="18"
              valign="top"
              class="pe-up"
              style="font-size:14px;color:${raw(L.up)};font-weight:800;line-height:1.55"
            >
              &#10003;
            </td>
            <td class="pe-ink2" style="font-size:13.5px;line-height:1.55;color:${raw(L.ink2)}">
              ${item}
            </td>
          </tr>`,
      ),
    ),
  )}`;
}

/** Label / value pairs: the recommendation's six parts. */
export function definitionRows(
  rows: readonly { label: string; value: string; strong?: boolean }[],
  labelWidth: number,
): Html {
  return t(
    `width="100%"`,
    `border-collapse:collapse;font-family:${SANS}`,
    rows.map(
      (r) =>
        html`<tr>
          <td
            width="${labelWidth}"
            valign="top"
            class="pe-ink3 pe-stack"
            style="padding:0 12px 12px 0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${raw(L.ink3)};font-weight:700;line-height:1.5"
          >
            ${r.label}
          </td>
          <td
            valign="top"
            class="${r.strong ? "pe-ink" : "pe-ink2"} pe-stack"
            style="padding-bottom:12px;font-size:15px;line-height:1.6;color:${raw(r.strong ? L.ink : L.ink2)}"
          >
            ${r.value}
          </td>
        </tr>`,
    ),
  );
}

/** Two columns of label / date, ruled. */
export function dateList(rows: readonly { label: string; date: string }[]): Html {
  return t(
    `width="100%"`,
    `border-collapse:collapse;font-family:${SANS}`,
    rows.map((r, i) => {
      const rule = i < rows.length - 1 ? `;border-bottom:1px solid ${L.rule}` : "";
      return html`<tr>
        <td
          class="pe-ink pe-rule-b"
          style="padding:9px 0${raw(rule)};font-size:14.5px;color:${raw(L.ink)};font-weight:600"
        >
          ${r.label}
        </td>
        <td
          align="right"
          class="pe-ink3 pe-rule-b"
          style="padding:9px 0${raw(rule)};font-size:14px;color:${raw(L.ink3)};font-weight:600"
        >
          ${r.date}
        </td>
      </tr>`;
    }),
  );
}

/** Numbered step cells, coloured in pot order. */
export function steps(items: readonly { title: string; body: string }[]): Html {
  const pots: Pot[] = ["foundation", "handpicked", "sideBet"];
  return t(
    `width="100%"`,
    `border-collapse:collapse;font-family:${SANS}`,
    items.map((s, i) => {
      const pot = pots[i % pots.length] as Pot;
      const pad = i < items.length - 1 ? "0 0 16px" : "0";
      return html`<tr>
        <td width="34" valign="top" style="padding:${raw(pad)}">
          ${t(
            "",
            "border-collapse:collapse",
            html`<tr>
              <td
                width="26"
                height="26"
                align="center"
                class="pe-${pot}"
                style="background:${raw(potColour[pot].light)};font-family:${raw(SERIF)};font-size:14px;color:${raw(L.card)};line-height:26px"
              >
                ${i + 1}
              </td>
            </tr>`,
          )}
        </td>
        <td valign="top" style="padding:${raw(pad)}">
          <div class="pe-ink" style="font-size:15.5px;font-weight:700;color:${raw(L.ink)}">
            ${s.title}
          </div>
          <div
            class="pe-ink2"
            style="font-size:14px;line-height:1.55;color:${raw(L.ink2)};padding-top:3px"
          >
            ${s.body}
          </div>
        </td>
      </tr>`;
    }),
  );
}

/** The footer under the last card. */
export function footer(input: {
  advice: boolean;
  lines: readonly Child[];
  markUrl?: string;
}): Html {
  return t(
    `width="100%"`,
    "border-collapse:collapse;margin-top:18px",
    html`${
      input.advice
        ? html`<tr>
            <td style="padding:0 8px">${adviceLabel()}</td>
          </tr>`
        : ""
    }
    ${input.lines.map(
      (line, i) =>
        html`<tr>
          <td
            class="pe-ink3"
            style="padding:${raw(i === 0 && !input.advice ? "0 8px" : "12px 8px 0")};font-family:${raw(SANS)};font-size:12.5px;line-height:1.65;color:${raw(L.ink3)}"
          >
            ${line}
          </td>
        </tr>`,
    )}
    ${
      input.markUrl
        ? html`<tr>
            <td style="padding:14px 8px 0">
              ${t(
                "",
                "border-collapse:collapse",
                html`<tr>
                  <td valign="middle" style="padding-right:8px">${mark(input.markUrl, 18)}</td>
                  <td
                    valign="middle"
                    class="pe-ink2"
                    style="font-family:${raw(SERIF)};font-size:15px;color:${raw(L.ink2)}"
                  >
                    Pip &nbsp;<span
                      class="pe-ink3"
                      style="font-family:${raw(SANS)};font-size:12px;color:${raw(L.ink3)};font-weight:600"
                      >London</span
                    >
                  </td>
                </tr>`,
              )}
            </td>
          </tr>`
        : ""
    }`,
  );
}
