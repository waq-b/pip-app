import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { DESKTOP_WIDTH, PHONE_WIDTH, setViewportWidth, TABLET_WIDTH } from "../test/setup";
import { AppShell } from "./app-shell";
import { pointerWords } from "./pointer-words";

const EVERY_WIDTH = [PHONE_WIDTH, TABLET_WIDTH, DESKTOP_WIDTH];

function renderShell(
  options: { path?: string; rulesNeedAttention?: boolean; userName?: string } = {},
) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <AppShell rulesNeedAttention={options.rulesNeedAttention} userName={options.userName} />
        ),
        children: [
          { index: true, element: <p>Pots screen</p> },
          { path: "rules", element: <p>Rules screen</p> },
          { path: "pots/:bucket", element: <p>Pot screen</p> },
        ],
      },
    ],
    { initialEntries: [options.path ?? "/"] },
  );

  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  setViewportWidth(PHONE_WIDTH);
});

describe("the shell at every width", () => {
  it("offers the same three destinations on a phone", async () => {
    renderShell();

    expect(await screen.findByRole("navigation", { name: "Sections" })).toBeInTheDocument();
    for (const label of ["Pots", "Rules", "Setup"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("shows the same three on a tablet rail", async () => {
    setViewportWidth(TABLET_WIDTH);
    renderShell();

    expect(await screen.findByRole("navigation", { name: "Sections" })).toBeInTheDocument();
    for (const label of ["Pots", "Rules", "Setup"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("names the product and the read-only promise in the desktop sidebar", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderShell({ userName: "Waqar" });

    expect(await screen.findByText("Pip")).toBeInTheDocument();
    expect(screen.getByText("Read-only access")).toBeInTheDocument();
    expect(screen.getByText("Waqar")).toBeInTheDocument();
  });

  it("renders the screen inside the chrome at every width", async () => {
    for (const width of EVERY_WIDTH) {
      setViewportWidth(width);
      const { unmount } = renderShell();

      expect(await screen.findByText("Pots screen")).toBeInTheDocument();
      unmount();
    }
  });
});

describe("the alert dot", () => {
  it("stays hidden while nothing needs a look", async () => {
    renderShell();

    await screen.findByRole("link", { name: "Pots" });
    expect(screen.queryByRole("status", { name: "A rule needs a look" })).not.toBeInTheDocument();
  });

  it("appears on Rules when a cap is breached, at every width", async () => {
    for (const width of EVERY_WIDTH) {
      setViewportWidth(width);
      const { unmount } = renderShell({ rulesNeedAttention: true });

      expect(
        await screen.findByRole("status", { name: "A rule needs a look" }),
      ).toBeInTheDocument();
      unmount();
    }
  });
});

describe("which destination is lit", () => {
  it("keeps Pots lit inside a pot at every width, because pot detail lives under it", async () => {
    for (const width of EVERY_WIDTH) {
      setViewportWidth(width);
      const { unmount } = renderShell({ path: "/pots/Medium" });

      expect(await screen.findByRole("link", { name: "Pots" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      unmount();
    }
  });

  it("lights Rules on the rules screen, and only Rules", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderShell({ path: "/rules" });

    expect(await screen.findByRole("link", { name: "Rules" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Pots" })).not.toHaveAttribute("aria-current");
  });

  it("lights Pots on the pots screen itself", async () => {
    renderShell({ path: "/" });

    expect(await screen.findByRole("link", { name: "Pots" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("pointer words", () => {
  it("says tap on a phone and click everywhere else", () => {
    expect(pointerWords("phone")).toMatchObject({ verb: "tap", device: "your phone" });
    expect(pointerWords("tablet").verb).toBe("click");
    expect(pointerWords("desktop")).toMatchObject({ verb: "click", device: "your computer" });
  });

  it("keeps what someone could pick up accurate to the device", () => {
    expect(pointerWords("phone").carried).toBe("your phone");
    expect(pointerWords("desktop").carried).toBe("your laptop");
  });
});
