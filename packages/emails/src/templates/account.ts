import {
  block,
  card,
  emailDocument,
  heading,
  link,
  linkRow,
  masthead,
  paragraph,
  smallPrint,
  steps,
} from "../components.js";
import { html, raw } from "../html.js";
import { SANS, light } from "../theme.js";
import { lines, wrap, type Email } from "../text.js";

/** Account emails carry no advice label: nothing in them is about money. */

export type WaitlistInput = {
  markUrl: string;
  /** Omitted until there's a route that takes someone off the list. */
  removeUrl?: string;
};

const PROVIDERS = "Trading 212 and Kraken";

export function waitlistEmail(input: WaitlistInput): Email {
  const subject = "You're on the Pip list";
  const preheader = "Waqar will email you when there's room. Nothing else to do.";
  const intro =
    "That's it — nothing else to do. Pip is small and being let in slowly, so Waqar will email you himself when there's room. No queue position, no \"share to skip ahead\", no countdown.";
  const wait = `Pip only reads. It connects to ${PROVIDERS} in read-only mode, can't move a penny, and shows you three pots and one number. If that's not what you wanted, no hard feelings — this address is the only thing we're keeping.`;

  const body = card(
    html`${block("22px 22px 0", masthead(input.markUrl))}
    ${heading("You're on the list", "16px 22px 0", 25)} ${paragraph(intro, "12px 22px 0", 15.5)}
    ${block(
      "16px 22px 0",
      html`<table
        role="presentation"
        cellpadding="0"
        cellspacing="0"
        border="0"
        width="100%"
        class="pe-sunk"
        style="border-collapse:collapse;background:${raw(light.sunk)};border:1px solid ${raw(light.cardBorder)}"
      >
        <tr>
          <td
            class="pe-ink2"
            style="padding:14px 16px;font-family:${raw(SANS)};font-size:14px;line-height:1.6;color:${raw(light.ink2)}"
          >
            <strong>While you wait:</strong> ${wait}
          </td>
        </tr>
      </table>`,
    )}
    ${
      input.removeUrl
        ? smallPrint(
            html`Didn't sign up? ${link(input.removeUrl, "Take this address off the list")} — one
            click, no questions.`,
            "16px 22px 22px",
          )
        : smallPrint(
            "Didn't sign up? Reply to this email and Waqar will take this address off the list.",
            "16px 22px 22px",
          )
    }`,
    { spaced: false },
  );

  const text = lines(
    "PIP",
    "YOU'RE ON THE LIST",
    wrap(intro),
    wrap(`While you wait: ${wait}`),
    input.removeUrl
      ? `Didn't sign up? Take this address off the list:\n${input.removeUrl}`
      : wrap("Didn't sign up? Reply to this email and Waqar will take this address off the list."),
  );

  return { subject, preheader, html: emailDocument({ title: subject, preheader, body }), text };
}

export type YoureInInput = {
  markUrl: string;
  signInUrl: string;
  /** Digits in the sign-in code, e.g. 8. */
  codeLength: number;
  /** What Pip assumes when net assets are skipped, e.g. "£2,000". */
  netAssetsFallback: string;
};

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

export function youreInEmail(input: YoureInInput): Email {
  const subject = "There's room — you're in";
  const preheader = "Three things and you'll have your number.";
  const digits = NUMBER_WORDS[input.codeLength] ?? String(input.codeLength);
  const items = [
    {
      title: "Sign in with a code",
      body: `No password to invent. ${digits[0]?.toUpperCase()}${digits.slice(1)} digits by email, same as every time after.`,
    },
    {
      title: "Connect an account, read-only",
      body: `${PROVIDERS}. Pip asks for a key that can look and nothing else — it cannot trade, withdraw or move money, and you can revoke it at your broker whenever you like.`,
    },
    {
      title: "Tell Pip roughly what you're worth",
      body: `One masked figure, house and pension included. It's the only way to work out your Side Bet ceiling, it's never sent to your brokers, and you can skip it — Pip just uses a cautious ${input.netAssetsFallback} instead.`,
    },
  ];
  const intro =
    "Three things and you'll have your number. About four minutes, and you can stop after step one.";
  const closing = "This link is yours and doesn't expire. Reply to this email and Waqar reads it.";

  const body = card(
    html`${block("22px 22px 0", masthead(input.markUrl))}
    ${heading("There's room. You're in.", "16px 22px 0", 25)}
    ${paragraph(intro, "12px 22px 0", 15.5)} ${block("18px 22px 0", steps(items))}
    ${linkRow(input.signInUrl, "Start with step one", "20px 22px 0")}
    ${smallPrint(closing, "16px 22px 22px")}`,
    { spaced: false },
  );

  const text = lines(
    "PIP",
    "THERE'S ROOM. YOU'RE IN.",
    wrap(intro),
    ...items.map((s, i) => `${i + 1}. ${s.title.toUpperCase()}\n${wrap(s.body)}`),
    `Start with step one:\n${input.signInUrl}`,
    wrap(closing),
  );

  return { subject, preheader, html: emailDocument({ title: subject, preheader, body }), text };
}
