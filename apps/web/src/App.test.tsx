import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { routes } from "./routes";
import { SAM, WAQAR } from "./test/fake-auth";
import { ME_ALLOWED, ME_REFUSED, renderRoute } from "./test/render-route";

describe("routing through the two walls", () => {
  it("opens on the pots screen for someone signed in and allowed", async () => {
    renderRoute("/", { session: WAQAR, api: ME_ALLOWED });

    // By role, not text: the nav also says "Pots".
    expect(await screen.findByRole("heading", { name: "Pots" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Sections" })).toBeInTheDocument();
  });

  it("asks the API with the signed-in person's token", async () => {
    const { fetchMock } = renderRoute("/", { session: WAQAR, api: ME_ALLOWED });

    await screen.findByRole("heading", { name: "Pots" });
    const [, init] = fetchMock.mock.calls.find(([input]) => String(input) === "/me")!;
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer token-for-waqar");
  });

  it("sends someone signed out to sign in, without asking the API anything", async () => {
    const { fetchMock } = renderRoute("/");

    expect(await screen.findByRole("button", { name: /Continue with Google/ })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("guards the inner screens too, not just the front door", async () => {
    renderRoute("/pots/Medium");
    expect(await screen.findByRole("button", { name: /Continue with Google/ })).toBeInTheDocument();
  });

  it("sends someone signed in but not on the list to the refusal screen", async () => {
    renderRoute("/", { session: SAM, api: ME_REFUSED });

    expect(
      await screen.findByRole("heading", { name: "You're not on the list — yet" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Sections" })).not.toBeInTheDocument();
  });

  it("sends an expired sign-in back to sign in", async () => {
    renderRoute("/", {
      session: WAQAR,
      api: { "/me": { status: 401, body: { error: "unauthenticated" } } },
    });

    expect(await screen.findByRole("button", { name: /Continue with Google/ })).toBeInTheDocument();
  });

  it("says so plainly when Pip can't be reached at all", async () => {
    renderRoute("/", { session: WAQAR, api: { "/me": { status: 500, body: { error: "down" } } } });

    expect(await screen.findByText("Can't reach Pip right now")).toBeInTheDocument();
    expect(screen.getByText("Your money is fine. Reload in a moment.")).toBeInTheDocument();
  });

  it("follows a sign-out that happens while you're in", async () => {
    const { auth } = renderRoute("/", { session: WAQAR, api: ME_ALLOWED });
    await screen.findByRole("heading", { name: "Pots" });

    auth.setSession(null);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeInTheDocument(),
    );
  });
});

describe("the route table", () => {
  it("puts the signed-in screens inside the shell", () => {
    const shell = routes[0]!;

    expect(shell.path).toBe("/");
    expect(shell.children?.map((child) => child.path ?? "index")).toEqual([
      "index",
      "pots/:bucket",
      "instruments/:id",
      "rules",
      "setup",
    ]);
  });

  it("keeps sign-in and the refusal screen outside the shell", () => {
    expect(routes.map((route) => route.path)).toEqual(["/", "/sign-in", "/not-on-the-list"]);
  });
});
