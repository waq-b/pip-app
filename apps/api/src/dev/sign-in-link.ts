/**
 * Local development only: a one-time sign-in link for an allowlisted email,
 * without sending an email (Supabase's built-in sender allows about two an
 * hour). Authentication is unchanged — the link signs the browser in through
 * Supabase exactly like an emailed one, and the API still verifies every
 * request and checks the allowlist (CLAUDE.md hard line 4).
 *
 *   pnpm --filter api sign-in-link [email]
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY in apps/api/.env. That key can do anything
 * in the project: it lives only in that gitignored file, never in Render, never
 * in the web app, never in chat. The script refuses to run anywhere that looks
 * like production, and only ever redirects to localhost.
 */
const DEV_ORIGIN = process.env.DEV_WEB_ORIGIN ?? "http://localhost:5173";

export function assertLocalOnly(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === "production" || env.RENDER) {
    throw new Error("sign-in-link is for local development only");
  }
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.DEV_WEB_ORIGIN ?? DEV_ORIGIN)) {
    throw new Error("sign-in-link only redirects to localhost");
  }
}

export async function devSignInLink(
  email: string,
  env: NodeJS.ProcessEnv = process.env,
  doFetch: typeof fetch = fetch,
): Promise<string> {
  assertLocalOnly(env);
  const url = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in apps/api/.env");

  const response = await doFetch(`${url}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email, redirect_to: `${DEV_ORIGIN}/` }),
  });
  if (!response.ok) throw new Error(`Supabase refused (${response.status})`);
  const body = (await response.json()) as {
    action_link?: string;
    properties?: { action_link?: string };
  };
  const link = body.properties?.action_link ?? body.action_link;
  if (!link) throw new Error("Supabase didn't return a link");
  return link;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const email = process.argv[2] ?? "test@example.com";
  console.log(await devSignInLink(email));
}
