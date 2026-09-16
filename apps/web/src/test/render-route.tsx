import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import type { AuthSession } from "../lib/auth-client";
import { routes } from "../routes";
import { AuthProvider } from "../shell/auth-provider";
import { fakeAuthClient } from "./fake-auth";

export interface StubResponse {
  status?: number;
  body: unknown;
}

export type Handler = StubResponse | ((init: RequestInit | undefined, url: URL) => StubResponse);

/**
 * Renders the real route table at a path, signed in as `session` (or signed
 * out), with the API answered by stubs keyed on pathname. Anything not stubbed
 * answers 500, so a screen calling an endpoint the test didn't expect fails
 * loudly instead of hanging. No network, ever (CLAUDE.md hard line 7).
 */
export function renderRoute(
  path: string,
  options: { session?: AuthSession | null; api?: Record<string, Handler> } = {},
) {
  const api = options.api ?? {};

  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(url, "http://localhost");
    // Stubs are keyed by the API's own path; the app calls it under `/api`.
    const apiPath = parsed.pathname.replace(/^\/api(?=\/)/, "");
    const handler = api[apiPath];

    if (!handler) return json({ error: `not stubbed: ${apiPath}` }, 500);

    const { status = 200, body } = typeof handler === "function" ? handler(init, parsed) : handler;
    return json(body, status);
  });
  vi.stubGlobal("fetch", fetchMock);

  const auth = fakeAuthClient(options.session ?? null);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });

  const utils = render(
    <AuthProvider client={auth}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AuthProvider>,
  );

  return { ...utils, fetchMock, router, auth };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const ME_ALLOWED: Record<string, Handler> = {
  "/me": { body: { email: "test@example.com", name: "Waqar", allowed: true } },
};

export const ME_REFUSED: Record<string, Handler> = {
  "/me": { body: { email: "sam@example.com", name: "Sam", allowed: false } },
};
