import { describe, expect, it, vi } from "vitest";
import { ensureSupabaseAccount } from "./supabase-admin.js";

const env = { SUPABASE_URL: "https://project.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service" };
const answering = (status: number, body: object = {}) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

describe("making a Supabase account for someone let in", () => {
  it("creates a confirmed account through the admin API", async () => {
    const fetch = answering(200, { id: "x" });
    expect(await ensureSupabaseAccount("friend@example.test", env, fetch)).toBe("created");
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://project.supabase.test/auth/v1/admin/users");
    expect(JSON.parse(String(init!.body))).toEqual({
      email: "friend@example.test",
      email_confirm: true,
    });
  });

  it("is fine when the account already exists", async () => {
    const fetch = answering(422, { code: 422, error_code: "email_exists" });
    expect(await ensureSupabaseAccount("friend@example.test", env, fetch)).toBe("already_there");
  });

  it("says so when Supabase refuses for any other reason", async () => {
    await expect(ensureSupabaseAccount("friend@example.test", env, answering(500))).rejects.toThrow(
      /500/,
    );
  });

  it("never runs on Render", async () => {
    await expect(
      ensureSupabaseAccount("friend@example.test", { ...env, RENDER: "true" }, answering(200)),
    ).rejects.toThrow(/developer's machine/);
  });
});
