import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TooManyEmailsError, TooManyTriesError, WrongCodeError } from "../lib/auth-client";
import { WAQAR } from "../test/fake-auth";
import { ME_ALLOWED, renderRoute } from "../test/render-route";
import { DESKTOP_WIDTH, PHONE_WIDTH, setViewportWidth } from "../test/setup";

beforeEach(() => {
  setViewportWidth(PHONE_WIDTH);
});

function ask(email: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
}

async function askForCode(email = "test@example.com") {
  const rendered = renderRoute("/sign-in", { api: ME_ALLOWED });
  await screen.findByLabelText("Email");
  ask(email);
  await screen.findByRole("heading", { name: "Enter the code from your email" });
  return rendered;
}

function type(code: string) {
  fireEvent.change(screen.getByLabelText("Code"), { target: { value: code } });
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
    expect(screen.getByRole("button", { name: "Email me a code" })).toBeDisabled();
    expect(container.querySelector('input[type="password"]')).not.toBeInTheDocument();
  });

  it("emails a code and asks for it", async () => {
    const { auth } = renderRoute("/sign-in");
    await screen.findByLabelText("Email");

    ask("  test@example.com ");

    expect(
      await screen.findByRole("heading", { name: "Enter the code from your email" }),
    ).toBeInTheDocument();
    expect(auth.sendCode).toHaveBeenCalledWith("test@example.com");
    expect(screen.getByText("test@example.com")).toBeInTheDocument();

    const input = screen.getByLabelText("Code");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("signs this window in with the code, once all eight digits are there", async () => {
    const { auth } = await askForCode();

    type("1234567");
    expect(auth.verifyCode).not.toHaveBeenCalled();
    type("12345678");

    expect(auth.verifyCode).toHaveBeenCalledTimes(1);
    expect(auth.verifyCode).toHaveBeenCalledWith("test@example.com", "12345678");
    expect(await screen.findByRole("heading", { name: "Your pots" })).toBeInTheDocument();
  });

  it("checks a complete code once — typing past the end or submitting again doesn't resend it", async () => {
    const { auth } = await askForCode();
    let finish: () => void = () => {};
    auth.verifyCode.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          finish = () => reject(new WrongCodeError());
        }),
    );

    type("12345678");
    type("123456789");
    fireEvent.submit(screen.getByLabelText("Code").closest("form")!);

    expect(auth.verifyCode).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(auth.verifyCode).toHaveBeenCalledTimes(1);
  });

  it("takes a pasted code with spaces or words around it", async () => {
    const { auth } = await askForCode();

    type("Your code: 1234 5678");

    expect(auth.verifyCode).toHaveBeenCalledWith("test@example.com", "12345678");
  });

  it("says when a code is wrong or expired, and lets you fix it", async () => {
    const { auth } = await askForCode();
    auth.verifyCode.mockRejectedValueOnce(new WrongCodeError());

    type("00000000");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code didn't work. Check it's from the newest email, or send a new code.",
    );
    type("12345678");
    expect(await screen.findByRole("heading", { name: "Your pots" })).toBeInTheDocument();
  });

  it("says to wait when there have been too many tries", async () => {
    const { auth } = await askForCode();
    auth.verifyCode.mockRejectedValueOnce(new TooManyTriesError());

    type("00000000");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many tries for now. Wait a few minutes, then send a new code.",
    );
  });

  it("sends a new code on request, and says when the email limit is hit", async () => {
    const { auth } = await askForCode();

    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }));
    expect(await screen.findByText("Pip sent a new code. Use the newest one.")).toBeInTheDocument();
    expect(auth.sendCode).toHaveBeenCalledTimes(2);

    auth.sendCode.mockRejectedValueOnce(new TooManyEmailsError());
    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Pip has sent too many sign-in emails for now. Try again in an hour, and use the newest code you have.",
    );
  });

  it("follows a session that arrives another way — the email's link opened in a browser tab", async () => {
    const { auth } = await askForCode();

    act(() => auth.setSession(WAQAR));

    expect(await screen.findByRole("heading", { name: "Your pots" })).toBeInTheDocument();
    expect(auth.verifyCode).not.toHaveBeenCalled();
  });

  it("explains, and lets you try again, when the code can't be sent", async () => {
    const { auth } = renderRoute("/sign-in");
    auth.sendCode.mockRejectedValueOnce(new Error("offline"));
    await screen.findByLabelText("Email");

    ask("test@example.com");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Pip couldn't send the code. Give it a moment and try again.",
    );
    expect(screen.getByRole("button", { name: "Email me a code" })).toBeEnabled();
  });

  it("says to wait when too many emails have gone out", async () => {
    const { auth } = renderRoute("/sign-in");
    auth.sendCode.mockRejectedValueOnce(new TooManyEmailsError());
    await screen.findByLabelText("Email");

    ask("test@example.com");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Pip has sent too many sign-in emails for now. Try again in an hour, and use the newest code you have.",
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
