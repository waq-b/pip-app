import { describe, expect, it } from "vitest";
import { checkRecommendationAnswer, checkWords } from "./guard.js";
import {
  briefBody,
  recommendationTemplate,
  takeLine,
  YOUR_CALL,
  type RecommendationBriefInput,
} from "./recommendation.js";
import type { Chat } from "./types.js";
import { llmWriter } from "./writer.js";

/**
 * The recommendation brief and its guard (phase-6.md decision 14, hard line
 * 12). Code decides the course and the pounds; the model may only explain
 * them. Every planted bad answer here must end up as Pip's own template.
 */

const nvidia: RecommendationBriefInput = {
  trigger: "holding_multiple",
  course: "take_some_profit",
  amountPence: 100_000,
  bucket: "Medium",
  name: "Nvidia",
  facts: { valuePence: 320_000, costPence: 100_000, multiple: 3.2 },
  plan: {
    goals: "Retire at 55",
    horizonYears: 20,
    riskWords: "steady",
    shape: { foundation: 75, handpicked: 25 },
  },
};

const good = {
  why: "Your stake has come back three times over, so taking your stake out leaves only gains riding.",
  typical: "Disciplined investors often take their stake out at a multiple like this.",
  tradeoff: "If it keeps going, less of it is going with it.",
};

const answer = (parts: Partial<typeof good>) => JSON.stringify({ ...good, ...parts });

describe("the guard on a recommendation brief", () => {
  it("passes reasons that name Pip's take, a trade-off, and nothing else", () => {
    expect(checkRecommendationAnswer(answer({}), "take_some_profit")).toEqual({
      ok: true,
      parts: good,
    });
  });

  it.each([
    ["a planted 'buy'", { typical: "Most people would buy more of it now." }, "buy or sell"],
    [
      "a forecast",
      { why: "It looks like it's heading to new highs, so take your stake out." },
      "forecast",
    ],
    ["'the peak'", { why: "This could be the peak, so take your stake out." }, "forecast"],
    ["a percentage", { why: "It's up 220%, so taking your stake out makes sense." }, "percentage"],
    ["pounds", { why: "Taking your £1,000 stake out leaves gains riding." }, "pounds"],
    ["no trade-off", { tradeoff: "" }, "no trade-off"],
    ["no reason", { why: "  " }, "no reason"],
    ["a guarantee", { tradeoff: "You can't lose once your stake is out." }, "guarantee"],
    ["jargon", { typical: "Trimming keeps your portfolio tidy." }, "jargon"],
  ])("refuses %s", (_label, parts, why) => {
    expect(checkRecommendationAnswer(answer(parts), "take_some_profit")).toEqual({
      ok: false,
      why,
    });
  });

  it("refuses a brief that says hold when code said take some profit", () => {
    const hold = answer({
      why: "It has done well, and one good run isn't a reason to act, so hold.",
      typical: "Disciplined investors tend to sit tight.",
    });
    expect(checkRecommendationAnswer(hold, "take_some_profit")).toMatchObject({ ok: false });
  });

  it("refuses a brief that doesn't name the take at all", () => {
    const vague = answer({
      why: "It has done very well since you started.",
      typical: "Disciplined investors keep to their own rules.",
    });
    expect(checkRecommendationAnswer(vague, "take_some_profit")).toEqual({
      ok: false,
      why: "didn't name Pip's take",
    });
  });

  it("refuses 'sell' on its own, and allows 'sell some'", () => {
    const sell = answer({ typical: "Disciplined investors often sell at a multiple." });
    expect(checkRecommendationAnswer(sell, "take_some_profit")).toMatchObject({ ok: false });
    const some = answer({ typical: "Disciplined investors often sell some at a multiple." });
    expect(checkRecommendationAnswer(some, "take_some_profit")).toMatchObject({ ok: true });
  });

  it("refuses an answer that isn't the schema", () => {
    expect(checkRecommendationAnswer("not json", "hold")).toEqual({ ok: false, why: "not JSON" });
    expect(checkRecommendationAnswer(answer({ why: "x".repeat(300) }), "take_some_profit")).toEqual(
      {
        ok: false,
        why: "too long",
      },
    );
  });

  it("keeps advice words banned everywhere else", () => {
    expect(checkWords("You should hold on to it.")).toMatchObject({ ok: false });
    expect(checkWords("Time to rebalance.")).toEqual({ ok: false, why: "jargon" });
  });
});

describe("the writer", () => {
  const writerWith = (content: string | Error) => {
    const fellBack: string[] = [];
    const chat: Chat = async () => {
      if (content instanceof Error) throw content;
      return { content, model: "openai/gpt-oss-120b" };
    };
    return {
      writer: llmWriter({ chat, model: "m", onFallback: (why) => fellBack.push(why) }),
      fellBack,
    };
  };

  it("wraps good reasons in code's title and 'Your call.'", async () => {
    const { writer } = writerWith(answer({}));
    const draft = await writer.recommendation(nvidia);
    expect(draft).toMatchObject({
      title: "Nvidia is worth 3.2× what you put in",
      model: "groq:openai/gpt-oss-120b",
      promptVersion: "recommendation.v1",
    });
    expect(draft.body).toBe(briefBody(good));
    expect(draft.body.endsWith(YOUR_CALL)).toBe(true);
  });

  it.each([
    ["a planted 'tell them to buy'", answer({ typical: "Tell the reader to buy more now." })],
    ["a forecast", answer({ why: "It will rise further, so take your stake out." })],
    ["a mismatched default", answer({ why: "Hold: one good run isn't a reason to act." })],
    ["a missing trade-off", answer({ tradeoff: "" })],
  ])("falls back to the template on %s", async (_label, content) => {
    const { writer, fellBack } = writerWith(content);
    const draft = await writer.recommendation(nvidia);
    expect(draft).toEqual(recommendationTemplate(nvidia));
    expect(fellBack).toHaveLength(1);
  });

  it("falls back to the template when Groq is down", async () => {
    const { writer, fellBack } = writerWith(new Error("503"));
    expect(await writer.recommendation(nvidia)).toEqual(recommendationTemplate(nvidia));
    expect(fellBack).toEqual(["unavailable"]);
  });

  it("says why Groq was unavailable, but only a short code — never an error's words", async () => {
    const reasons: string[] = [];
    const failing =
      (reason: string): Chat =>
      async () => {
        throw Object.assign(new Error("anything at all"), { reason });
      };
    for (const reason of ["403", "timeout", "a sentence with spaces"]) {
      await llmWriter({
        chat: failing(reason),
        model: "m",
        onFallback: (why) => reasons.push(why),
      }).recommendation(nvidia);
    }
    expect(reasons).toEqual(["unavailable (403)", "unavailable (timeout)", "unavailable"]);
  });

  it("never sends the model a pound", async () => {
    let sent = "";
    const chat: Chat = async (request) => {
      sent = request.user + request.system;
      return { content: answer({}), model: "m" };
    };
    await llmWriter({ chat, model: "m" }).recommendation(nvidia);
    expect(sent).not.toMatch(/£|\b1,?000\b|3,?200/);
    expect(sent).toContain("3.2 times");
  });
});

describe("Pip's template", () => {
  const cases: RecommendationBriefInput[] = [
    {
      trigger: "side_bet_over_limit",
      course: "take_some_profit",
      amountPence: 40_000,
      bucket: "Degen",
      name: "Side Bet",
      facts: { valuePence: 680_000, limitPence: 640_000 },
    },
    nvidia,
    {
      trigger: "pot_off_target",
      course: "rebalance",
      amountPence: 60_000,
      bucket: "Medium",
      name: "Handpicked",
      facts: { driftPoints: 6.2 },
    },
    {
      trigger: "pot_off_target",
      course: "rebalance",
      amountPence: 50_000,
      bucket: "Base",
      name: "Foundation",
      facts: { driftPoints: -5.1 },
    },
    {
      trigger: "urgent_move",
      course: "hold",
      amountPence: null,
      bucket: "Medium",
      name: "ASML",
      facts: { movePercent: -16, movePence: -24_000, moveLine: 7 },
    },
  ];

  it("gives every trigger a fact, a reason, the typical course, a trade-off and 'Your call.'", () => {
    expect(cases.map((input) => recommendationTemplate(input).title)).toEqual([
      "Side Bet is worth £6,800, past its £6,400 limit",
      "Nvidia is worth 3.2× what you put in",
      "Handpicked is 6 points over its target",
      "Foundation is 5 points under its target",
      "ASML is down £240 today",
    ]);
    for (const input of cases) {
      const { body } = recommendationTemplate(input);
      expect(body.endsWith(" Your call.")).toBe(true);
      expect(body).toMatch(/disciplined investor/i);
    }
  });

  it("says the pounds code worked out, and points new money the right way", () => {
    const [sideBet, , over, under] = cases.map((input) => recommendationTemplate(input).body);
    expect(sideBet).toContain("Taking £400 out would bring it back to the limit");
    expect(over).toContain("£600 more than your own target");
    expect(over).toContain("Pointing new money at Foundation");
    expect(under).toContain("£500 short of your own target");
    expect(under).toContain("Pointing new money at Foundation");
  });

  it("never forecasts, and mentions tax only outside the ISA", () => {
    for (const input of cases) {
      expect(recommendationTemplate(input).body).not.toMatch(
        /will (rise|fall)|the peak|heading to|can't lose/i,
      );
    }
    expect(recommendationTemplate(nvidia).body).toContain("capital gains tax");
  });

  it("puts Pip's take in a line for a push", () => {
    expect(takeLine("take_some_profit", 40_000)).toBe("Pip's take: take some profit — £400.");
    expect(takeLine("hold", null)).toBe("Pip's take: hold.");
    expect(takeLine("rebalance", 60_000)).toBe("Pip's take: even it back out — £600.");
  });
});
