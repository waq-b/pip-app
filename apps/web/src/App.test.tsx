import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { routes } from "./routes";

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("routing", () => {
  it("opens on the pots screen", async () => {
    renderAt("/");

    // By role, not text: the nav also says "Pots".
    expect(await screen.findByRole("heading", { name: "Pots" })).toBeInTheDocument();
  });

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

  it("keeps sign-in and the refusal screen outside the shell, as the design has them", async () => {
    expect(routes.map((route) => route.path)).toEqual(["/", "/sign-in", "/not-on-the-list"]);

    renderAt("/sign-in");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Sections" })).not.toBeInTheDocument();
  });

  it("renders a named pot", async () => {
    renderAt("/pots/Medium");
    expect(await screen.findByRole("heading", { name: "Pot" })).toBeInTheDocument();
  });

  it("renders the screen a refused sign-in lands on", async () => {
    renderAt("/not-on-the-list");
    expect(await screen.findByRole("heading", { name: "Not on the list" })).toBeInTheDocument();
  });
});
