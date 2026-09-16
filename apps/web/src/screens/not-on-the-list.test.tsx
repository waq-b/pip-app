import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SAM, WAQAR } from "../test/fake-auth";
import { ME_ALLOWED, ME_REFUSED, renderRoute } from "../test/render-route";

describe("the not-on-the-list screen", () => {
  it("says no kindly, and names the account back", async () => {
    renderRoute("/not-on-the-list", { session: SAM, api: ME_REFUSED });

    expect(
      await screen.findByRole("heading", { name: "You're not on the list — yet" }),
    ).toBeInTheDocument();
    expect(screen.getByText("sam@example.com")).toBeInTheDocument();
  });

  it("makes no promise of an email, because there is no email system", async () => {
    const { container } = renderRoute("/not-on-the-list", { session: SAM, api: ME_REFUSED });
    await screen.findByRole("heading", { name: "You're not on the list — yet" });

    expect(container.textContent).not.toMatch(/we'll email|email you|email the moment/i);
  });

  it("asks with the sign-in alone — no address sent — and confirms without over-promising", async () => {
    const { fetchMock } = renderRoute("/not-on-the-list", {
      session: SAM,
      api: { ...ME_REFUSED, "/waitlist": { body: { status: "added", email: "sam@example.com" } } },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Put me on the waiting list" }));

    expect(
      await screen.findByRole("heading", { name: "You're on the waiting list" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Waqar will let you know when there's room/)).toBeInTheDocument();

    const [, init] = fetchMock.mock.calls.find(([input]) => String(input) === "/waitlist")!;
    expect(init?.body).toBeUndefined();
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer token-for-sam");
  });

  it("lets you try again after a failure", async () => {
    renderRoute("/not-on-the-list", {
      session: SAM,
      api: { ...ME_REFUSED, "/waitlist": { status: 500, body: { error: "down" } } },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Put me on the waiting list" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't add you just now");
    expect(screen.getByRole("button", { name: "Put me on the waiting list" })).toBeEnabled();
  });

  it("signs you out to try a different account", async () => {
    const { auth } = renderRoute("/not-on-the-list", { session: SAM, api: ME_REFUSED });

    fireEvent.click(await screen.findByRole("button", { name: "Try a different account" }));

    expect(
      await screen.findByRole("button", { name: "Email me a sign-in link" }),
    ).toBeInTheDocument();
    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it("sends someone signed out to sign in instead", async () => {
    renderRoute("/not-on-the-list");
    expect(
      await screen.findByRole("button", { name: "Email me a sign-in link" }),
    ).toBeInTheDocument();
  });

  it("sends someone who is allowed on into the app", async () => {
    renderRoute("/not-on-the-list", { session: WAQAR, api: ME_ALLOWED });
    expect(await screen.findByRole("heading", { name: "Your pots" })).toBeInTheDocument();
  });
});
