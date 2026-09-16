import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MINUS } from "../lib/format";
import { BigNumber } from "./big-number";
import { NotAdviceLabel } from "./not-advice-label";
import { ProgressCapBar } from "./progress-cap-bar";
import { AgeChip, ProvenanceLine } from "./provenance";
import { Skeleton } from "./skeleton";

describe("BigNumber", () => {
  it("sets the pence apart so the pounds carry the weight", () => {
    render(<BigNumber label="Everything you own" value={1_143_018} />);

    expect(screen.getByText("£11,430")).toBeInTheDocument();
    expect(screen.getByText(".18")).toBeInTheDocument();
  });

  it("leads the change with money, then the percentage, then when", () => {
    const { container } = render(
      <BigNumber
        label="Everything you own"
        value={1_143_018}
        change={{ amount: 2_580, percent: 0.23, direction: "up" }}
        when="today"
      />,
    );

    const text = container.textContent ?? "";
    expect(text.indexOf("+£25.80")).toBeLessThan(text.indexOf("+0.23%"));
    expect(text.indexOf("+0.23%")).toBeLessThan(text.indexOf("today"));
  });

  it("colours a loss as a loss", () => {
    render(
      <BigNumber
        label="Side Bet"
        value={78_000}
        change={{ amount: -3_420, percent: -4.2, direction: "down" }}
      />,
    );

    expect(screen.getByText(`${MINUS}£34.20`)).toHaveClass("text-dn");
  });
});

describe("ProgressCapBar", () => {
  it("draws a target without alarm, even when you're past it", () => {
    render(
      <ProgressCapBar label="Foundation" actualPercent={72} targetPercent={70} kind="target" />,
    );

    expect(screen.getByText("72% · target 70%")).toBeInTheDocument();
    expect(screen.getByRole("meter")).not.toHaveAttribute("data-over");
    expect(screen.queryByText(/information, not advice/i)).not.toBeInTheDocument();
  });

  it("turns a breached cap red, hatches the track, and says so in pounds", () => {
    render(
      <ProgressCapBar
        label="Side Bet"
        actualPercent={6.8}
        targetPercent={5}
        kind="cap"
        scaleMax={10}
        overByAmount={20_800}
      />,
    );

    const figure = screen.getByText("6.8% · 1.8% over cap · £208");
    expect(figure).toHaveClass("text-dn");
    expect(screen.getByRole("meter")).toHaveClass("hatch");
  });

  it("carries the not-advice label only when it's saying something needs a look", () => {
    render(
      <ProgressCapBar
        label="Side Bet"
        actualPercent={6.8}
        targetPercent={5}
        kind="cap"
        scaleMax={10}
      />,
    );

    expect(screen.getByText(/information, not advice/i)).toBeInTheDocument();
  });

  it("stays calm for a cap that hasn't been reached", () => {
    render(
      <ProgressCapBar
        label="Side Bet"
        actualPercent={3}
        targetPercent={5}
        kind="cap"
        scaleMax={10}
      />,
    );

    expect(screen.getByText("3% · cap 5%")).not.toHaveClass("text-dn");
    expect(screen.getByRole("meter")).not.toHaveClass("hatch");
  });

  it("never draws past the end of the track", () => {
    const { container } = render(
      <ProgressCapBar
        label="Side Bet"
        actualPercent={50}
        targetPercent={5}
        kind="cap"
        scaleMax={10}
      />,
    );

    const fill = container.querySelector<HTMLElement>(".bg-acc");
    expect(fill?.style.width).toBe("100%");
  });
});

describe("ProvenanceLine and AgeChip", () => {
  it("is quiet when prices are fresh", () => {
    render(<ProvenanceLine state="fresh" text="Sample prices · updated 4 min ago" />);

    expect(screen.getByText(/updated 4 min ago/)).not.toHaveClass("text-amber");
  });

  it("goes amber when a pot is behind", () => {
    render(
      <ProvenanceLine
        state="amber"
        text="Side Bet is 2 hours old · everything else updated 4 min ago"
      />,
    );

    expect(screen.getByText(/2 hours old/)).toHaveClass("text-amber");
  });

  it("shows markets-closed as green, not stale", () => {
    const { container } = render(
      <ProvenanceLine state="closed" text="Prices from Friday's close" />,
    );

    expect(container.querySelector(".bg-up")).toBeInTheDocument();
  });

  it("labels an age in whole hours", () => {
    render(<AgeChip hours={2.7} />);
    expect(screen.getByText("2h old")).toBeInTheDocument();
  });
});

describe("NotAdviceLabel and Skeleton", () => {
  it("says what it is, plainly", () => {
    render(<NotAdviceLabel />);
    expect(screen.getByText(/information, not advice/i)).toBeInTheDocument();
  });

  it("hides a skeleton from assistive tech — it's a shape, not content", () => {
    const { container } = render(<Skeleton height={20} />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });
});
