/**
 * Sign-ups are off in Supabase and the web app never creates accounts, so the
 * allowlist command makes someone's Supabase account when it lets them in —
 * otherwise their magic link would never arrive.
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY from apps/api/.env: a key that can do
 * anything in the project, so it's only ever used from a developer's machine,
 * never in Render, the web app or chat.
 */
export type AccountOutcome = "created" | "already_there";

export async function ensureSupabaseAccount(
  email: string,
  env: NodeJS.ProcessEnv = process.env,
  doFetch: typeof fetch = fetch,
): Promise<AccountOutcome> {
  if (env.NODE_ENV === "production" || env.RENDER) {
    throw new Error("Supabase accounts are only made from a developer's machine");
  }
  const url = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in apps/api/.env");

  const response = await doFetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    // Confirmed, because proving they own the address is what the magic link does.
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (response.ok) return "created";
  const body = (await response.json().catch(() => ({}))) as { code?: string; error_code?: string };
  if (response.status === 422 && (body.error_code ?? body.code) === "email_exists") {
    return "already_there";
  }
  throw new Error(`Supabase refused to make the account (${response.status})`);
}
