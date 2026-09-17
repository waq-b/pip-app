import {
  block,
  card,
  divider,
  emailDocument,
  footer,
  heading,
  link,
  masthead,
  paragraph,
  smallPrint,
} from "../components.js";
import { html, raw } from "../html.js";
import { SERIF, light } from "../theme.js";
import { lines, wrap, type Email } from "../text.js";

export type SignInCodeInput = {
  code: string;
  /** Signs in the browser that opens it (Supabase's ConfirmationURL). */
  signInUrl: string;
  email: string;
  markUrl: string;
  /** Must match Supabase → Authentication → Providers → Email → Email OTP Expiration. */
  expiryMinutes: number;
};

/**
 * The first Pip email anyone gets. One job: put the code where a thumb can
 * reach it. No pot colours, no money, no advice label.
 */
export function signInCodeEmail(input: SignInCodeInput): Email {
  const expiry = `${input.expiryMinutes} minutes`;
  const subject = `Your Pip code: ${input.code}`;
  const preheader = `Expires in ${expiry}. Didn't ask for this? Ignore it — nothing has happened.`;

  const body = html`${card(
    html`${block("28px 30px 8px", masthead(input.markUrl, { size: "large" }))}
    ${heading("Your sign-in code", "16px 30px 0", 27)}
    ${paragraph("Type this into Pip to finish signing in.", "10px 30px 0", 15.5)}
    ${block(
      "20px 30px 0",
      html`<table
        role="presentation"
        cellpadding="0"
        cellspacing="0"
        border="0"
        width="100%"
        class="pe-sunk pe-code"
        style="border-collapse:collapse;background:${raw(light.sunk)};border:2px solid ${raw(light.ink)}"
      >
        <tr>
          <td
            align="center"
            class="pe-ink pe-hero"
            style="padding:24px 10px;font-family:${raw(SERIF)};font-size:46px;letter-spacing:.14em;color:${raw(light.ink)};line-height:1.1"
          >
            ${input.code}
          </td>
        </tr>
      </table>`,
    )}
    ${paragraph(`It expires in ${expiry} and works once. Select it and copy — it's text, not a picture.`, "12px 30px 0", 14, "ink3")}
    ${divider("22px 30px 0")}
    ${paragraph(html`On the computer you asked from? ${link(input.signInUrl, "Open Pip and sign in")} — same code, one tap.`, "18px 30px 0", 14.5)}
    ${smallPrint(
      html`<strong class="pe-ink2" style="color:${raw(light.ink2)}">Wasn't you?</strong> Someone
        typed your address in. Nothing has happened to your account and there's nothing to undo —
        ignore this and the code dies in ${expiry}. If it keeps arriving, just reply to this email
        and Waqar will look.`,
      "16px 30px 26px",
    )}`,
    { spaced: false },
  )}
  ${footer({
    advice: false,
    lines: [
      html`Sent to ${input.email} because someone asked to sign in. Sign-in emails can't be switched
        off — they're how Pip knows it's you.<br />Pip, London. Read-only by design.`,
    ],
  })}`;

  const text = lines(
    "PIP",
    "YOUR SIGN-IN CODE",
    `    ${input.code}`,
    `Type this into Pip to finish signing in.\nIt expires in ${expiry} and works once.`,
    `On the computer you asked from, open:\n${input.signInUrl}`,
    `WASN'T YOU?\n${wrap(`Someone typed your address in. Nothing has happened to your account. Ignore this and the code dies in ${expiry}. If it keeps arriving, reply to this email.`)}`,
    `--\n${wrap(`Sent to ${input.email} because someone asked to sign in. Sign-in emails can't be switched off.`)}\nPip, London. Read-only by design.`,
  );

  return { subject, preheader, html: emailDocument({ title: subject, preheader, body }), text };
}
