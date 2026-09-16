import type { Holding, SeriesPoint } from "@finance-app/shared";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { MINUS } from "../lib/format";
import { AllocationRing, StackedBar } from "./allocation";
import { BarChart } from "./bar-chart";
import { areaPath, normalise, smoothPath, straightPath } from "./chart-geometry";
import { HoldingsTable } from "./holdings-table";
import { LineChart } from "./line-chart";
import { Sparkline } from "./sparkline";

function series(values: number[]): SeriesPoint[] {
  return values.map((value, index) => ({
    at: `2026-09-${String(index + 1).padStart(2, "0")}`,
    value,
  }));
}

describe("chart geometry", () => {
  it("draws a flat series level instead of producing NaN", () => {
    const ys = normalise([500, 500, 500], 120, 8, 12);

    expect(ys.every((y) => Number.isFinite(y))).toBe(true);
    expect(new Set(ys).size).toBe(1);
  });

  it("puts the highest value nearest the top", () => {
    const [low, high] = normalise([100, 900], 120, 8, 12);
    expect(high!).toBeLessThan(low!);
  });

  it("never emits NaN in any path", () => {
    for (const values of [
      [1, 1],
      [5, 10, 2],
      [0, 0, 0, 0],
    ]) {
      for (const path of [
        straightPath(values, 62, 20),
        smoothPath(values, 320, 120),
        areaPath(values, 320, 120),
      ]) {
        expect(path).not.toContain("NaN");
      }
    }
  });

  it("closes the area down to the baseline so it can be filled", () => {
    expect(areaPath([1, 2, 3], 320, 120)).toMatch(/Z$/);
  });
});

describe("Sparkline", () => {
  it("draws a trend and hides it from assistive tech", () => {
    const { container } = render(<Sparkline series={series([1, 3, 2])} />);

    expect(container.querySelector("path")).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("draws nothing for a single point, because one point is not a trend", () => {
    const { container } = render(<Sparkline series={series([5])} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("LineChart", () => {
  it("always carries its sentence, which also describes it", () => {
    render(
      <LineChart
        series={series([1, 2, 3])}
        caption="This is what normal looks like."
        from="Mar 2024"
      />,
    );

    expect(screen.getByText("This is what normal looks like.")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "This is what normal looks like." }),
    ).toBeInTheDocument();
  });

  it("says why instead of drawing when there isn't enough history", () => {
    render(
      <LineChart
        series={series([5])}
        caption="One day is not a trend, so Pip won't draw you one."
        from="Today"
        emptyMessage="No history yet — come back tomorrow"
      />,
    );

    expect(screen.getByText("No history yet — come back tomorrow")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("gives two charts on one screen their own gradients", () => {
    const { container } = render(
      <>
        <LineChart series={series([1, 2])} caption="First" from="a" />
        <LineChart series={series([2, 1])} caption="Second" from="b" />
      </>,
    );

    const ids = [...container.querySelectorAll("linearGradient")].map((g) => g.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("BarChart", () => {
  const bars = [
    { label: "Jun", amount: 1_000 },
    { label: "Jul", amount: 0 },
    { label: "Aug", amount: 500 },
  ];

  it("labels each bar with its money so nobody reads a scale", () => {
    render(<BarChart bars={bars} caption="Nothing new since June." />);

    expect(screen.getByRole("listitem", { name: "Jun: £10" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Aug: £5" })).toBeInTheDocument();
  });

  it("draws a zero month as a faded stub rather than a gap", () => {
    render(<BarChart bars={bars} caption="Nothing new since June." />);

    const july = screen.getByRole("listitem", { name: "Jul: nothing in" });
    expect(july).toHaveClass("opacity-40");
    expect(within(july).getByText("—")).toBeInTheDocument();
  });

  it("carries its caption", () => {
    render(<BarChart bars={bars} caption="Nothing new since June." />);
    expect(screen.getByText("Nothing new since June.")).toBeInTheDocument();
  });
});

describe("AllocationRing and StackedBar", () => {
  const slices = [
    { bucket: "Base" as const, percent: 72, amount: 824_000 },
    { bucket: "Medium" as const, percent: 21, amount: 241_000 },
    { bucket: "Degen" as const, percent: 6.8, amount: 78_000 },
  ];

  it("names pots the way the screen does, never by their internal ids", () => {
    render(<AllocationRing slices={slices} targetSentence="You asked for 70 / 25 / 5." />);

    for (const name of ["Foundation", "Handpicked", "Side Bet"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    for (const id of ["Base", "Medium", "Degen"]) {
      expect(screen.queryByText(id)).not.toBeInTheDocument();
    }
  });

  it("puts money before each share when it has it", () => {
    const { container } = render(<AllocationRing slices={slices} targetSentence="…" />);
    const text = container.textContent ?? "";

    expect(text.indexOf("£8,240")).toBeLessThan(text.indexOf("72%"));
  });

  it("states the target in words rather than as a second ring", () => {
    const { container } = render(
      <AllocationRing
        slices={slices}
        targetSentence="You asked for 70 / 25 / 5. You're at 72 / 21 / 7."
      />,
    );

    expect(screen.getByText(/You asked for 70 \/ 25 \/ 5/)).toBeInTheDocument();
    // One track plus one arc per pot — no ghost target ring.
    expect(container.querySelectorAll("circle")).toHaveLength(1 + slices.length);
  });

  it("colours each arc with its pot's identity, which no scope can change", () => {
    const { container } = render(<AllocationRing slices={slices} targetSentence="…" />);

    expect(container.querySelector('[data-bucket="Degen"]')).toHaveStyle({
      stroke: "var(--pip-seed-bet)",
    });
  });

  it("shades one pot's holdings from its own accent", () => {
    const { container } = render(
      <StackedBar
        segments={[
          { id: "a", label: "Nvidia", percent: 30 },
          { id: "b", label: "Apple", percent: 23 },
        ]}
      />,
    );

    const parts = container.querySelectorAll<HTMLElement>(".bg-acc");
    expect(parts).toHaveLength(2);
    expect(Number(parts[1]!.style.opacity)).toBeLessThan(Number(parts[0]!.style.opacity));
  });
});

describe("HoldingsTable", () => {
  const change = (amount: number, percent: number): Holding["today"] => ({
    amount,
    percent,
    direction: amount > 0 ? "up" : amount < 0 ? "down" : "flat",
  });

  const holdings: Holding[] = [
    {
      id: "apple",
      name: "Apple",
      subtitle: "Phones, laptops",
      bucket: "Medium",
      value: 56_000,
      today: change(90, 0.5),
      sinceBought: change(3_170, 6),
      shareOfBucket: 23,
      series: series([1, 2, 3]),
    },
    {
      id: "nvidia",
      name: "Nvidia",
      subtitle: "Chips for AI",
      bucket: "Medium",
      value: 72_000,
      today: change(410, 2.9),
      sinceBought: change(13_900, 24),
      shareOfBucket: 30,
      series: series([3, 2, 4]),
    },
    {
      id: "asml",
      name: "ASML",
      subtitle: "Machines that make chips",
      bucket: "Medium",
      value: 43_000,
      today: change(-320, -0.5),
      sinceBought: change(-1_330, -3),
      shareOfBucket: 18,
      series: series([4, 3, 2]),
    },
  ];

  function renderTable(breakpoint: "phone" | "desktop") {
    return render(
      <MemoryRouter>
        <HoldingsTable holdings={holdings} breakpoint={breakpoint} />
      </MemoryRouter>,
    );
  }

  const rowNames = () =>
    screen
      .getAllByRole("link")
      .map((link) => within(link).getByText(/Apple|Nvidia|ASML/).textContent);

  it("opens sorted by value, biggest first", () => {
    renderTable("phone");
    expect(rowNames()).toEqual(["Nvidia", "Apple", "ASML"]);
  });

  it("flips direction when you choose the same column again", () => {
    renderTable("phone");

    fireEvent.click(screen.getByRole("button", { name: /Sort by value/ }));
    expect(rowNames()).toEqual(["ASML", "Apple", "Nvidia"]);
  });

  it("sorts names A to Z first time, because that's how names read", () => {
    renderTable("phone");

    fireEvent.click(screen.getByRole("button", { name: /Sort by holding/ }));
    expect(rowNames()).toEqual(["Apple", "ASML", "Nvidia"]);
  });

  it("stops at three columns on a phone and restores the fourth on desktop", () => {
    const { unmount } = renderTable("phone");
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sort by change/ })).toBeInTheDocument();
    unmount();

    renderTable("desktop");
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sort by since you bought/ })).toBeInTheDocument();
  });

  it("never shows a bare percentage — every change leads with pounds", () => {
    const { container } = renderTable("desktop");
    const text = container.textContent ?? "";

    expect(text).toContain("+£139.00 +24%");
    expect(text).toContain(`${MINUS}£3.20 ${MINUS}0.5%`);
  });

  it("makes each whole row the link to that holding's page", () => {
    renderTable("phone");
    expect(screen.getByRole("link", { name: /Nvidia/ })).toHaveAttribute(
      "href",
      "/instruments/nvidia",
    );
  });

  it("keeps a holding's shade when the order changes", () => {
    const { container } = renderTable("phone");
    const shadeOfNvidia = () =>
      within(screen.getByRole("link", { name: /Nvidia/ }))
        .getByText("Nvidia")
        .closest("a")!
        .querySelector<HTMLElement>(".bg-acc")!.style.opacity;

    const before = shadeOfNvidia();
    fireEvent.click(screen.getByRole("button", { name: /Sort by holding/ }));

    expect(shadeOfNvidia()).toBe(before);
    expect(container).toBeInTheDocument();
  });

  it("says tap on a phone and click on a computer", () => {
    const { unmount } = renderTable("phone");
    expect(screen.getByText(/Tap any holding for its own page/)).toBeInTheDocument();
    unmount();

    renderTable("desktop");
    expect(screen.getByText(/Click any holding for its own page/)).toBeInTheDocument();
  });
});
