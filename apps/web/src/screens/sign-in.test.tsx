import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { WAQAR } from "../test/fake-auth";
import { ME_ALLOWED, renderRoute } from "../test/render-route";
import { DESKTOP_WIDTH, PHONE_WIDTH, setViewportWidth } from "../test/setup";

beforeEach(() => {
  setViewportWidth(PHONE_WIDTH);
});

describe("the sign-in screen", () => {
  it("makes the promise before asking for anything", async () => {
    renderRoute("/sign-in");

    expect(
      await screen.findByRole("heading", { name: /Three pots\.\s*One number\.\s*No homework\./ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Pip shows you your money in plain English. It can look, never touch."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Invite-only while it's young. Pip reads your name and email, nothing else.",
      ),
    ).toBeInTheDocument();
  });

  it("offers one button and no password field", async () => {
    const { container } = renderRoute("/sign-in");

    expect(await screen.findByRole("button", { name: /Continue with Google/ })).toBeEnabled();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("hands off to Google, and says what's happening meanwhile", async () => {
    const { auth } = renderRoute("/sign-in");

    fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/ }));

    expect(auth.signInWithGoogle).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("heading", { name: "Checking you're on the list" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Two seconds. Pip is only asking Google who you are."),
    ).toBeInTheDocument();
  });

  it("explains, and offers the button again, when sign-in can't start", async () => {
    const { auth } = renderRoute("/sign-in");
    auth.signInWithGoogle.mockRejectedValueOnce(new Error("offline"));

    fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Pip couldn't start sign-in");
    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeEnabled();
  });

  it("sends someone already signed in straight through", async () => {
    renderRoute("/sign-in", { session: WAQAR, api: ME_ALLOWED });

    expect(await screen.findByRole("heading", { name: "Your pots" })).toBeInTheDocument();
  });

  it("has no navigation, because there's nowhere to go until you're in", async () => {
    renderRoute("/sign-in");

    await screen.findByRole("button", { name: /Continue with Google/ });
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("gains a labelled second column on desktop", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderRoute("/sign-in");

    expect(await screen.findByText("Sign in")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeInTheDocument();
  });
});
