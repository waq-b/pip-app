import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the Phase 0 placeholder with all three buckets", () => {
    render(<App />);
    expect(screen.getByText("finance-app-personal")).toBeInTheDocument();
    expect(screen.getByText("Base")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("Degen")).toBeInTheDocument();
  });
});
