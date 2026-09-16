import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TooManyEmailsError } from "../lib/auth-client";
import { WAQAR } from "../test/fake-auth";
import { ME_ALLOWED, renderRoute } from "../test/render-route";
import { DESKTOP_WIDTH, PHONE_WIDTH, setViewportWidth } from "../test/setup";

beforeEach(() => {
  setViewportWidth(PHONE_WIDTH);
});

function ask(email: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
}

describe("the sign-in screen", () => {
  it("makes the promise before asking for anything", async () => {
    renderRoute("/sign-in");

    expect(
      await screen.findByRole("heading", { name: /Three pots\.\s*One number\.\s*No homework\./ }),
    ).toBeInTheDocument();
  });

  it("asks only for an email — no password field", async () => {
    const { container } = renderRoute("/sign-in");

    expect(await screen.findByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByRole("button", { name: "Email me a sign-in link" })).toBeDisabled();
    expect(container.querySelector('input[type="password"]')).not.toBeInTheDocument();
  });

  it("emails a link and says where it went", async () => {
    const { auth } = renderRoute("/sign-in");
    await screen.findByLabelText("Email");

    ask("  test@example.com ");

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(auth.sendMagicLink).toHaveBeenCalledWith("test@example.com");
    expect(screen.getByText("test@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("explains, and lets you try again, when the link can't be sent", async () => {
    const { auth } = renderRoute("/sign-in");
    auth.sendMagicLink.mockRejectedValueOnce(new Error("offline"));
    await screen.findByLabelText("Email");

    ask("test@example.com");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Pip couldn't send the link. Give it a moment and try again.",
    );
    expect(screen.getByRole("button", { name: "Email me a sign-in link" })).toBeEnabled();
  });

  it("says to wait when too many emails have gone out", async () => {
    const { auth } = renderRoute("/sign-in");
    auth.sendMagicLink.mockRejectedValueOnce(new TooManyEmailsError());
    await screen.findByLabelText("Email");

    ask("test@example.com");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Pip has sent too many sign-in emails just now. Wait a few minutes and try again.",
    );
  });

  it("sends someone already signed in straight through", async () => {
    renderRoute("/sign-in", { session: WAQAR, api: ME_ALLOWED });

    expect(await screen.findByRole("heading", { name: "Your pots" })).toBeInTheDocument();
  });

  it("has no navigation, because there's nowhere to go until you're in", async () => {
    renderRoute("/sign-in");

    await screen.findByLabelText("Email");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("gains a labelled second column on desktop", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderRoute("/sign-in");

    expect(await screen.findByText("Sign in")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});
