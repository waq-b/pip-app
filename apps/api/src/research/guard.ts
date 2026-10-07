import type { Recommendation } from "@finance-app/shared";

/**
 * The output guard : every word an LLM writes passes
 * through here before anyone sees it. A draft that fails is thrown away and
 * Pip's own template is used instead — so advice, predictions or made-up
 * sources never reach the screen, whatever the model does.
 */

export const TITLE_MAX = 80;
export const BODY_MAX = 320;
export const OPENING_MAX = 140;

/**
 * Two audiences. `ALWAYS` is banned for everyone,
 * a recommendation brief included: forecasts, verdicts on price, bare
 * percentages and pounds (figures come from Pip, never the model), and the
 * design's jargon. `GENERIC_ONLY` is advice language — banned for everyone
 * except inside a `personal_research` recommendation, where the course is
 * code's and the words only explain it.
 *
 * Deliberately blunt: a factual "agreed to sell its unit" is refused too,
 * and the template says it plainly instead.
 */
const ALWAYS: { pattern: RegExp; why: string }[] = [
  { pattern: /\b(target price|price target)s?\b/i, why: "price target" },
  {
    pattern:
      /\bwill\s+(likely\s+)?(rise|fall|climb|drop|soar|crash|jump|slide|go up|go down|recover|rebound)\b/i,
    why: "forecast",
  },
  { pattern: /\bexpect(s|ed)?\s+(the\s+)?(price|shares?|stock)\b/i, why: "forecast" },
  {
    pattern: /\b(the peak|peaked|heading (to|for)|set to|bound to|about to|poised to)\b/i,
    why: "forecast",
  },
  { pattern: /\b(under|over)valued\b/i, why: "valuation verdict" },
  { pattern: /\b(cheap|expensive|bargain)\b/i, why: "valuation verdict" },
  { pattern: /\b(guarantee\w*|can'?t lose|cannot lose|risk-free)\b/i, why: "guarantee" },
  { pattern: /\b(opportunit\w*|upside)\b/i, why: "judging it good" },
  { pattern: /\b(portfolio|allocation|exposure|drawdown)\b/i, why: "jargon" },
  // The writer is never given pounds or percentages, so it can't put one in.
  { pattern: /%|\bper ?cent\b/i, why: "percentage" },
  { pattern: /£|\bpounds?\b/i, why: "pounds" },
];

const GENERIC_ONLY: { pattern: RegExp; why: string }[] = [
  { pattern: /\b(buy|buys|buying|sell|sells|selling|sold)\b/i, why: "buy or sell" },
  { pattern: /\b(hold on to|hold onto|keep holding|worth holding)\b/i, why: "hold as advice" },
  { pattern: /\bshould\b/i, why: "should" },
  { pattern: /\brecommend\w*/i, why: "recommend" },
  { pattern: /\b(benefit\w*|good for)\b/i, why: "judging it good" },
  { pattern: /\brebalanc\w*/i, why: "jargon" },
];

export type GuardVerdict = { ok: true } | { ok: false; why: string };

/** Everyone but a recommendation brief: every list applies. */
export function checkWords(...texts: string[]): GuardVerdict {
  return checkAgainst([...ALWAYS, ...GENERIC_ONLY], texts);
}

function checkAgainst(list: { pattern: RegExp; why: string }[], texts: string[]): GuardVerdict {
  for (const text of texts) {
    for (const { pattern, why } of list) {
      if (pattern.test(text)) return { ok: false, why };
    }
  }
  return { ok: true };
}

export interface RawNewsAnswer {
  material: boolean;
  title: string | null;
  body: string | null;
  cited: number[];
}

/** Parse and check a news nudge answer against the facts it was given (numbered 1…n). */
export function checkNewsAnswer(
  content: string,
  reportCount: number,
):
  | { ok: true; material: false }
  | { ok: true; material: true; title: string; body: string; cited: number[] }
  | { ok: false; why: string } {
  let answer: RawNewsAnswer;
  try {
    answer = JSON.parse(content) as RawNewsAnswer;
  } catch {
    return { ok: false, why: "not JSON" };
  }
  if (typeof answer !== "object" || answer === null || typeof answer.material !== "boolean") {
    return { ok: false, why: "schema" };
  }
  if (!answer.material) return { ok: true, material: false };
  const { title, body, cited } = answer;
  if (typeof title !== "string" || typeof body !== "string" || !Array.isArray(cited)) {
    return { ok: false, why: "schema" };
  }
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  if (!trimmedTitle || !trimmedBody) return { ok: false, why: "empty" };
  if (trimmedTitle.length > TITLE_MAX || trimmedBody.length > BODY_MAX) {
    return { ok: false, why: "too long" };
  }
  if (
    cited.length === 0 ||
    !cited.every((n) => Number.isInteger(n) && n >= 1 && n <= reportCount)
  ) {
    return { ok: false, why: "cited a fact it wasn't given" };
  }
  const words = checkWords(trimmedTitle, trimmedBody);
  if (!words.ok) return words;
  return {
    ok: true,
    material: true,
    title: trimmedTitle,
    body: trimmedBody,
    cited: [...new Set(cited)],
  };
}

export function checkOpeningAnswer(
  content: string,
): { ok: true; sentence: string } | { ok: false; why: string } {
  let answer: { sentence?: unknown };
  try {
    answer = JSON.parse(content) as { sentence?: unknown };
  } catch {
    return { ok: false, why: "not JSON" };
  }
  const sentence = typeof answer?.sentence === "string" ? answer.sentence.trim() : "";
  if (!sentence) return { ok: false, why: "schema" };
  if (sentence.length > OPENING_MAX) return { ok: false, why: "too long" };
  const words = checkWords(sentence);
  return words.ok ? { ok: true, sentence } : words;
}

export const BRIEF_PART_MAX = 220;

/**
 * The courses a brief can speak of. A brief has to name code's course and
 * no other: "hold" when code said "take some profit" fails.
 */
const COURSE_WORDS: Record<Recommendation, RegExp> = {
  hold: /\b(hold|holding|sit tight|stay put|wait|waiting)\b/i,
  take_some_profit:
    /\b(tak(e|es|ing) (some )?profits?|tak(e|es|ing)\b[\w' ]{0,24}\bout|sell(ing)? some|trim(ming)?)\b/i,
  rebalance:
    /\b(rebalanc\w*|even(s|ing)? (it )?(back )?out|top(ping)? up|point(ing)? new money|new money)\b/i,
};

/**
 * A `personal_research` recommendation brief: the
 * writer's why / typical / trade-off, checked before code wraps them with
 * the fact, Pip's take and "Your call.". Advice verbs are allowed here —
 * forecasts, figures and jargon never are.
 */
export function checkRecommendationAnswer(
  content: string,
  course: Recommendation,
):
  | { ok: true; parts: { why: string; typical: string; tradeoff: string } }
  | { ok: false; why: string } {
  let answer: Record<string, unknown>;
  try {
    answer = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return { ok: false, why: "not JSON" };
  }
  if (typeof answer !== "object" || answer === null) return { ok: false, why: "schema" };
  const parts = {
    why: typeof answer.why === "string" ? answer.why.trim() : "",
    typical: typeof answer.typical === "string" ? answer.typical.trim() : "",
    tradeoff: typeof answer.tradeoff === "string" ? answer.tradeoff.trim() : "",
  };
  if (!parts.why) return { ok: false, why: "no reason" };
  if (!parts.typical) return { ok: false, why: "schema" };
  if (!parts.tradeoff) return { ok: false, why: "no trade-off" };
  if (Object.values(parts).some((part) => part.length > BRIEF_PART_MAX)) {
    return { ok: false, why: "too long" };
  }
  const texts = Object.values(parts);
  const words = checkAgainst(ALWAYS, texts);
  if (!words.ok) return words;
  // "Buy" is never a course Pip takes, whoever's reading.
  if (texts.some((text) => /\b(buy|buys|buying|bought)\b/i.test(text))) {
    return { ok: false, why: "buy or sell" };
  }
  const all = texts.join(" ");
  if (!COURSE_WORDS[course].test(all)) return { ok: false, why: "didn't name Pip's take" };
  for (const [other, pattern] of Object.entries(COURSE_WORDS)) {
    if (other !== course && pattern.test(all)) return { ok: false, why: "a different course" };
  }
  // Selling is only ever "some", and only when code chose to take profit.
  if (/\b(sell|sells|selling|sold)\b(?! some)/i.test(all)) return { ok: false, why: "buy or sell" };
  return { ok: true, parts };
}
