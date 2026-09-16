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
    expect(await screen.findByText("Pots")).toBeInTheDocument();
  });

  it("has a route for every screen the design describes", async () => {
    const paths = routes.map((route) => route.path);

    expect(paths).toEqual([
      "/",
      "/pots/:bucket",
      "/instruments/:id",
      "/rules",
      "/setup",
      "/sign-in",
      "/not-on-the-list",
    ]);
  });

  it("renders a named pot", async () => {
    renderAt("/pots/Medium");
    expect(await screen.findByText("Pot")).toBeInTheDocument();
  });

  it("renders the screen a refused sign-in lands on", async () => {
    renderAt("/not-on-the-list");
    expect(await screen.findByText("Not on the list")).toBeInTheDocument();
  });
});
