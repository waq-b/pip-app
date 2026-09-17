/**
 * The output guard (Phase 5 decision 6): every word an LLM writes passes
 * through here before anyone sees it. A draft that fails is thrown away and
 * Pip's own template is used instead — so advice, predictions or made-up
 * sources never reach the screen, whatever the model does.
 */

export const TITLE_MAX = 80;
export const BODY_MAX = 320;
export const OPENING_MAX = 140;

/**
 * Words that read as advice, a forecast, a verdict on price, or jargon the
 * design bans. Deliberately blunt: a factual "agreed to sell its unit" is
 * refused too, and the template says it plainly instead.
 */
const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /\b(buy|buys|buying|sell|sells|selling|sold)\b/i, why: "buy or sell" },
  { pattern: /\b(hold on to|hold onto|keep holding|worth holding)\b/i, why: "hold as advice" },
  { pattern: /\bshould\b/i, why: "should" },
  { pattern: /\brecommend\w*/i, why: "recommend" },
  { pattern: /\b(target price|price target)s?\b/i, why: "price target" },
  {
    pattern:
      /\bwill\s+(likely\s+)?(rise|fall|climb|drop|soar|crash|jump|slide|go up|go down|recover|rebound)\b/i,
    why: "forecast",
  },
  { pattern: /\bexpect(s|ed)?\s+(the\s+)?(price|shares?|stock)\b/i, why: "forecast" },
  { pattern: /\b(under|over)valued\b/i, why: "valuation verdict" },
  { pattern: /\b(cheap|expensive|bargain)\b/i, why: "valuation verdict" },
  { pattern: /\bguarantee\w*/i, why: "guarantee" },
  { pattern: /\b(benefit\w*|good for|opportunit\w*|upside)\b/i, why: "judging it good" },
  { pattern: /\b(portfolio|allocation|rebalanc\w*|exposure|drawdown)\b/i, why: "jargon" },
  // The writer is never given pounds, so it can't put money before a percentage.
  { pattern: /%|\bper ?cent\b/i, why: "percentage" },
];

export type GuardVerdict = { ok: true } | { ok: false; why: string };

export function checkWords(...texts: string[]): GuardVerdict {
  for (const text of texts) {
    for (const { pattern, why } of BANNED) {
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
