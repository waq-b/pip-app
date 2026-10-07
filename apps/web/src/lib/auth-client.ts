import { createClient, type Session } from "@supabase/supabase-js";

/**
 * What the app needs from sign-in, and nothing more. Supabase sits behind this
 * interface so screens never import it, and tests swap in a fake without a
 * Supabase project (design rule 6).
 */
export interface AuthSession {
  accessToken: string;
  email: string | null;
  name: string | null;
}

export interface AuthClient {
  /** The current session, refreshed by Supabase if its token was expiring. */
  getSession(): Promise<AuthSession | null>;
  /** Called on sign-in, sign-out and token refresh. Returns an unsubscribe. */
  onChange(listener: (session: AuthSession | null) => void): () => void;
  /**
   * Emails a one-time sign-in code. The same email carries a link as a
   * fallback for desktop browsers; an installed PWA can't use the link, because
   * it opens the system browser, whose storage the PWA doesn't share.
   * Throws `TooManyEmailsError` when Supabase's send limit is hit.
   */
  sendCode(email: string): Promise<void>;
  /**
   * Signs in with the code from the email, in this window's own storage.
   * Throws `WrongCodeError` for a wrong or expired code, `TooManyTriesError`
   * when Supabase is limiting attempts.
   */
  verifyCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
}

/** How many digits Supabase's email code has — must match Auth → Email OTP Length (8). */
export const SIGN_IN_CODE_LENGTH = 8;

/** Supabase's built-in mailer only sends a few emails an hour. */
export class TooManyEmailsError extends Error {
  constructor() {
    super("Too many sign-in emails");
    this.name = "TooManyEmailsError";
  }
}

/** The code is wrong, expired, already used, or for an address Pip doesn't know. */
export class WrongCodeError extends Error {
  constructor() {
    super("Wrong or expired sign-in code");
    this.name = "WrongCodeError";
  }
}

/** Supabase limits how often a code can be tried. */
export class TooManyTriesError extends Error {
  constructor() {
    super("Too many sign-in code attempts");
    this.name = "TooManyTriesError";
  }
}

export function supabaseAuthClient(
  url: string | undefined = import.meta.env.VITE_SUPABASE_URL,
  publishableKey: string | undefined = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
): AuthClient {
  if (!url || !publishableKey) {
    throw new Error(
      "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set — Pip can't sign anyone in without them",
    );
  }

  // `detectSessionInUrl` is on by default: a desktop browser tab opened from
  // the email's link still signs in, and other open tabs hear about it.
  const supabase = createClient(url, publishableKey);

  return {
    async getSession() {
      const { data } = await supabase.auth.getSession();
      return toAuthSession(data.session);
    },

    onChange(listener) {
      const { data } = supabase.auth.onAuthStateChange((_event, session) =>
        listener(toAuthSession(session)),
      );
      return () => data.subscription.unsubscribe();
    },

    async sendCode(email) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        // Supabase accounts are made by the allowlist command, never here, so
        // a stranger can't get a session at all (sign-ups are off in Supabase
        // too). Being let in is still the API's allowlist decision.
        options: { emailRedirectTo: `${window.location.origin}/`, shouldCreateUser: false },
      });
      if (!error) return;
      // An address with no Supabase account. Answer exactly as for a real
      // one, so the sign-in screen never reveals who's on the list.
      if (error.code === "otp_disabled" || /signups not allowed/i.test(error.message)) return;
      if (error.status === 429 || error.code === "over_email_send_rate_limit") {
        throw new TooManyEmailsError();
      }
      throw error;
    },

    async verifyCode(email, code) {
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
      if (!error) return;
      if (error.status === 429 || error.code === "over_request_rate_limit") {
        throw new TooManyTriesError();
      }
      // Wrong, expired or used — and an address with no account fails the same
      // way, so this answer never reveals who's on the list either.
      if (error.status === 400 || error.status === 403 || error.code === "otp_expired") {
        throw new WrongCodeError();
      }
      throw error;
    },

    async signOut() {
      await supabase.auth.signOut();
    },
  };
}

function toAuthSession(session: Session | null): AuthSession | null {
  if (!session) return null;

  const metadata = session.user.user_metadata as
    { full_name?: unknown; name?: unknown } | undefined;
  const name =
    typeof metadata?.full_name === "string"
      ? metadata.full_name
      : typeof metadata?.name === "string"
        ? metadata.name
        : null;

  return { accessToken: session.access_token, email: session.user.email ?? null, name };
}
