import { signInCodeEmail } from "./templates/sign-in-code.js";

/** Where Pip is served. The mark is hosted by the web app (apps/web/public/email). */
export const PIP_URL = "https://pip-old.example.net";
export const MARK_PATH = "/email/pip-mark-96.png";

/**
 * The sign-in email as a Supabase Auth template (Authentication → Emails →
 * Magic Link), with Supabase's Go template variables in place of values.
 * `expiryMinutes` must match Email OTP Expiration in Supabase.
 */
export function supabaseSignInTemplate(expiryMinutes: number) {
  return signInCodeEmail({
    code: "{{ .Token }}",
    signInUrl: "{{ .ConfirmationURL }}",
    email: "{{ .Email }}",
    markUrl: `${PIP_URL}${MARK_PATH}`,
    expiryMinutes,
  });
}
