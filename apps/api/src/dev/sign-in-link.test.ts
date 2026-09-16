import { describe, expect, it, vi } from "vitest";
import { assertLocalOnly, devSignInLink } from "./sign-in-link.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
};

describe("the local sign-in link", () => {
  it("refuses to run in production or on Render", () => {
    expect(() => assertLocalOnly({ NODE_ENV: "production" })).toThrow(/local development only/);
    expect(() => assertLocalOnly({ RENDER: "true" })).toThrow(/local development only/);
  });

  it("only ever redirects to localhost", () => {
    expect(() => assertLocalOnly({ DEV_WEB_ORIGIN: "https://pip-old.example.net" })).toThrow(
      /localhost/,
    );
    expect(() => assertLocalOnly({})).not.toThrow();
  });

  it("asks Supabase for a magic link back to the local app, sending no email", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            properties: { action_link: "https://example.supabase.co/verify?token=t" },
          }),
        ),
    );
    const link = await devSignInLink("test@example.com", env, fetchMock);

    expect(link).toBe("https://example.supabase.co/verify?token=t");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.supabase.co/auth/v1/admin/generate_link");
    expect(JSON.parse(String(init!.body))).toEqual({
      type: "magiclink",
      email: "test@example.com",
      redirect_to: "http://localhost:5173/",
    });
  });

  it("needs the service role key", async () => {
    await expect(devSignInLink("a@b.c", { SUPABASE_URL: env.SUPABASE_URL })).rejects.toThrow(
      /SERVICE_ROLE_KEY/,
    );
  });
});
