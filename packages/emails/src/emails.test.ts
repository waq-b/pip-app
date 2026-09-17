import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as f from "./fixtures.js";
import {
  MAX_NUDGES,
  alertEmail,
  recommendationEmail,
  signInCodeEmail,
  supabaseSignInTemplate,
  waitlistEmail,
  weekDigestEmail,
  youreInEmail,
  type Email,
} from "./index.js";
import { textBar, wrap } from "./text.js";

const all: Record<string, { email: Email; advice: boolean }> = {
  signIn: { email: signInCodeEmail(f.signIn), advice: false },
  weekOneThing: { email: weekDigestEmail(f.weekOneThing), advice: true },
  weekQuiet: { email: weekDigestEmail(f.weekQuiet), advice: true },
  weekFourThings: { email: weekDigestEmail(f.weekFourThings), advice: true },
  weekMissingPot: { email: weekDigestEmail(f.weekMissingPot), advice: true },
  weekStalePrices: { email: weekDigestEmail(f.weekStalePrices), advice: true },
  alertLimit80: { email: alertEmail(f.alertLimit80), advice: true },
  alertCapByGrowth: { email: alertEmail(f.alertCapByGrowth), advice: true },
  alertUrgentMove: { email: alertEmail(f.alertUrgentMove), advice: true },
  alertPushStopped: { email: alertEmail(f.alertPushStopped), advice: false },
  recommendation: { email: recommendationEmail(f.recommendationAlone), advice: true },
  waitlist: { email: waitlistEmail(f.waitlist), advice: false },
  youreIn: { email: youreInEmail(f.youreIn), advice: false },
};

describe.each(Object.entries(all))("%s", (_, { email, advice }) => {
  it("uses only what email clients render", () => {
    const body = email.html.slice(email.html.indexOf("<body"));
    expect(body).not.toMatch(
      /<svg|border-radius|linear-gradient|url\(|<script|display:\s*flex|display:\s*grid/i,
    );
    expect(email.html).not.toMatch(/@font-face|fonts\.googleapis/);
  });

  it("carries the advice label only where the app would show one", () => {
    expect(email.html.includes("Information, not advice")).toBe(advice);
    expect(email.text.includes("INFORMATION, NOT ADVICE")).toBe(advice);
  });

  it("has no link that acts on money", () => {
    const anchors = [...email.html.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1] ?? "");
    for (const text of anchors)
      expect(text).not.toMatch(/\b(buy|sell|rebalance|invest now|trade)\b/i);
  });

  it("has a subject, a preheader and a plain-text part", () => {
    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.html).toContain(email.preheader.replace(/'/g, "&#39;"));
    expect(email.text.trim().length).toBeGreaterThan(0);
  });

  it("gives every text colour explicitly, so force-invert has something to work with", () => {
    const tds = [...email.html.matchAll(/<td[^>]*style="([^"]*font-size[^"]*)"/g)].map(
      (m) => m[1] ?? "",
    );
    for (const style of tds.filter((s) => !/font-size:0\b/.test(s)))
      expect(style).toMatch(/color:/);
  });
});

describe("escaping", () => {
  it("escapes copy so model or user text can't add markup", () => {
    const email = alertEmail({
      ...f.alertUrgentMove,
      title: `<img src=x onerror=alert(1)> "Nvidia"`,
    });
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&lt;img src=x onerror=alert(1)&gt; &quot;Nvidia&quot;");
  });
});

describe("weekly digest", () => {
  it("keeps the fixed order: recommendation, calendar, shape, awareness", () => {
    const html = weekDigestEmail(f.weekFourThings).html;
    const at = (s: string) => html.indexOf(`>${s}</td>`);
    expect(at("Recommendation")).toBeGreaterThan(0);
    expect(at("Recommendation")).toBeLessThan(at("Calendar"));
    expect(at("Calendar")).toBeLessThan(at("Shape"));
    expect(at("Shape")).toBeLessThan(at("Awareness"));
  });

  it(`shows at most ${MAX_NUDGES} and points to Pip for the rest`, () => {
    const email = weekDigestEmail(f.weekFourThings);
    expect(email.html.match(/See in Pip &#8594;/g)).toHaveLength(MAX_NUDGES);
    expect(email.html).toContain("And 1 smaller thing in Pip.");
    expect(email.html).not.toContain("Greggs trading update");
  });

  it("shortens nudge bodies when the week is busy, never the recommendation", () => {
    const email = weekDigestEmail(f.weekFourThings);
    expect(email.html).toContain("What a disciplined investor usually does");
    expect(email.html).not.toContain("Which checks it passed");
  });

  it("collapses a quiet week to one card", () => {
    const email = weekDigestEmail(f.weekQuiet);
    expect(email.subject).toBe("Your week: nothing needs you");
    expect(email.html).toContain("No nudges.");
    expect(email.html).not.toContain("What Pip checked");
  });

  it("keeps a missing pot's row, in amber", () => {
    const email = weekDigestEmail(f.weekMissingPot);
    expect(email.html).toContain("Side Bet · not counted");
    expect(email.text).toContain("Side Bet   NOT COUNTED");
  });

  it("puts stale prices above the number and on it", () => {
    const html = weekDigestEmail(f.weekStalePrices).html;
    expect(html.indexOf("Prices here are from Friday")).toBeLessThan(html.indexOf("£11,402"));
    expect(html).toContain("as at Fri");
  });
});

describe("alerts", () => {
  it("tells a price-triggered alert's reader Pip isn't suggesting anything", () => {
    expect(alertEmail(f.alertUrgentMove).html).toContain("Pip isn&#39;t suggesting anything.");
  });
});

describe("Supabase sign-in template", () => {
  const template = supabaseSignInTemplate(10);

  it("keeps Supabase's variables intact", () => {
    expect(template.subject).toBe("Your Pip code: {{ .Token }}");
    expect(template.html).toContain(">{{ .Token }}</td>");
    expect(template.html).toContain('href="{{ .ConfirmationURL }}"');
    expect(template.html).toContain("Sent to {{ .Email }}");
  });

  it("matches the committed file (run the preview script after changing it)", () => {
    const committed = readFileSync(
      new URL("../supabase/sign-in-code.html", import.meta.url),
      "utf8",
    );
    expect(committed.slice(committed.indexOf("<!DOCTYPE"))).toBe(template.html);
  });
});

describe("plain text", () => {
  it("draws a 24-character bar", () => {
    expect(textBar(80)).toBe(`[${"|".repeat(19)}${" ".repeat(5)}]`);
    expect(textBar(0)).toHaveLength(26);
  });

  it("wraps to 46 characters", () => {
    for (const line of wrap("word ".repeat(40)).split("\n"))
      expect(line.length).toBeLessThanOrEqual(46);
  });
});
