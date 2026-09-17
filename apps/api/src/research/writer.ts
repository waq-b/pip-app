import { checkNewsAnswer, checkOpeningAnswer } from "./guard.js";
import {
  AWARENESS_PROMPT_VERSION,
  AWARENESS_SCHEMA,
  AWARENESS_SYSTEM,
  awarenessUser,
} from "./prompts/awareness.v2.js";
import { WEEK_PROMPT_VERSION, WEEK_SCHEMA, WEEK_SYSTEM, weekUser } from "./prompts/week.v1.js";
import { OPENING_TEMPLATE, templateFor } from "./templates.js";
import type { Chat, NewsNudgeInput, NotMaterial, NudgeDraft } from "./types.js";

/**
 * The nudge writer (Phase 5 decision 6). Only news nudges for readers with
 * personal research on, and the week's opening sentence, ever reach an LLM;
 * everything else is Pip's own template. Every LLM answer passes the guard or
 * is replaced by the template — a failure never leaves a week unwritten.
 */
export interface NudgeWriter {
  /** `groq`, `stub`. */
  readonly kind: string;
  news(input: NewsNudgeInput): Promise<NudgeDraft | NotMaterial>;
  opening(
    titles: string[],
  ): Promise<{ sentence: string; model: string; promptVersion: string | null }>;
}

const newsTemplate = (input: NewsNudgeInput): NudgeDraft =>
  templateFor({
    type: "news",
    name: input.name,
    shortName: input.shortName,
    reports: input.reports,
  });

/** An LLM behind a `Chat` — in production Groq's OpenAI-compatible API. */
export function llmWriter(options: {
  chat: Chat;
  model: string;
  onFallback?: (why: string) => void;
}): NudgeWriter {
  const { chat, model } = options;
  const fellBack = (why: string) => options.onFallback?.(why);

  return {
    kind: "llm",

    async news(input) {
      // No plan means no personal research: general words, and nothing sent anywhere.
      if (!input.plan || input.reports.length === 0) return newsTemplate(input);
      let content: string;
      let answeredBy = model;
      try {
        const answer = await chat({
          model,
          system: AWARENESS_SYSTEM,
          user: awarenessUser(input),
          schema: AWARENESS_SCHEMA,
        });
        content = answer.content;
        answeredBy = answer.model || model;
      } catch {
        fellBack("unavailable");
        return newsTemplate(input);
      }
      const checked = checkNewsAnswer(content, input.reports.length);
      if (!checked.ok) {
        fellBack(checked.why);
        return newsTemplate(input);
      }
      if (!checked.material) {
        return {
          material: false,
          model: `groq:${answeredBy}`,
          promptVersion: AWARENESS_PROMPT_VERSION,
        };
      }
      return {
        title: checked.title,
        body: checked.body,
        citedIds: checked.cited.map((n) => input.reports[n - 1]!.id),
        model: `groq:${answeredBy}`,
        promptVersion: AWARENESS_PROMPT_VERSION,
      };
    },

    async opening(titles) {
      if (titles.length === 0)
        return { sentence: OPENING_TEMPLATE, model: "template", promptVersion: null };
      try {
        const answer = await chat({
          model,
          system: WEEK_SYSTEM,
          user: weekUser(titles),
          schema: WEEK_SCHEMA,
        });
        const checked = checkOpeningAnswer(answer.content);
        if (checked.ok) {
          return {
            sentence: checked.sentence,
            model: `groq:${answer.model || model}`,
            promptVersion: WEEK_PROMPT_VERSION,
          };
        }
        fellBack(checked.why);
      } catch {
        fellBack("unavailable");
      }
      return { sentence: OPENING_TEMPLATE, model: "template", promptVersion: null };
    },
  };
}

/**
 * Stub mode and CI (hard line 7): canned words built from the facts, no
 * network. Always "material", citing every report, so the loop test can see a
 * news nudge travel end to end.
 */
export function stubWriter(): NudgeWriter {
  return {
    kind: "stub",
    async news(input) {
      if (!input.plan || input.reports.length === 0) return newsTemplate(input);
      const publishers = [...new Set(input.reports.map((r) => r.publisher))];
      return {
        title: `${input.name} in the news`,
        body: `Sample words from stub mode: ${publishers.join(" and ")} reported on ${input.name} this week.`,
        citedIds: input.reports.map((report) => report.id),
        model: "stub",
        promptVersion: AWARENESS_PROMPT_VERSION,
      };
    },
    async opening(titles) {
      return titles.length === 0
        ? { sentence: OPENING_TEMPLATE, model: "template", promptVersion: null }
        : {
            sentence: "Here's your week, from stub mode.",
            model: "stub",
            promptVersion: WEEK_PROMPT_VERSION,
          };
    },
  };
}
