import { createClient, type Session } from "@supabase/supabase-js";

/**
 * What the app needs from sign-in, and nothing more. Supabase sits behind this
 * interface so screens never import it, and tests swap in a fake without a
 * Supabase project (CLAUDE.md hard line 7).
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
   * Emails a one-time sign-in link that brings the browser back signed in.
   * Throws `TooManyEmailsError` when Supabase's send limit is hit.
   */
  sendMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;
}

/** Supabase's built-in mailer only sends a few emails an hour. */
export class TooManyEmailsError extends Error {
  constructor() {
    super("Too many sign-in emails");
    this.name = "TooManyEmailsError";
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

    async sendMagicLink(email) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        // Anyone can get a Supabase account; being let in is the API's
        // allowlist decision, so this doesn't try to gate anything.
        options: { emailRedirectTo: `${window.location.origin}/`, shouldCreateUser: true },
      });
      if (!error) return;
      if (error.status === 429 || error.code === "over_email_send_rate_limit") {
        throw new TooManyEmailsError();
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
