import { checkNewsAnswer, checkOpeningAnswer, checkRecommendationAnswer } from "./guard.js";
import {
  MAX_REPORTS_PER_NOTE,
  WORDING_PROMPT_VERSION,
  WORDING_SCHEMA,
  WORDING_SYSTEM,
  wordingUser,
} from "./prompts/wording.v1.js";
import {
  briefBody,
  briefTitle,
  recommendationTemplate,
  type BriefDraft,
  type RecommendationBriefInput,
} from "./recommendation.js";
import { OPENING_TEMPLATE, templateFor } from "./templates.js";
import type { Chat, NewsNudgeInput, NotMaterial, NudgeDraft } from "./types.js";

/**
 * The nudge writer (Phase 5 decision 6, one request since 2026-09-21). Only
 * news notes and Pip's takes for readers with personal research on, and their
 * week's opening sentence, ever reach an LLM; everything else is Pip's own
 * template. A build asks for all of it in **one** request, and every piece of
 * the answer passes the guard on its own or is replaced by its template — a
 * failure never leaves a week unwritten, and one bad piece never costs the rest.
 */

export interface WordingRequest {
  /** News notes. Those without a plan (no personal research) get Pip's words and cost nothing. */
  news: NewsNudgeInput[];
  /** Pip's takes: code has chosen the course and the pounds; only the reasons are asked for. */
  recommendations: RecommendationBriefInput[];
  /** The week's opening line, from the titles of the notes Pip wrote itself. Null on a daily build. */
  opening: { titles: string[] } | null;
}

export interface Opening {
  sentence: string;
  model: string;
  promptVersion: string | null;
}

export interface WordingResult {
  /** In the order asked for. */
  news: (NudgeDraft | NotMaterial)[];
  recommendations: BriefDraft[];
  opening: Opening | null;
}

export interface NudgeWriter {
  /** `llm`, `stub`. */
  readonly kind: string;
  words(request: WordingRequest): Promise<WordingResult>;
}

/**
 * "unavailable", with the provider's reason when it gave one (an HTTP status,
 * "timeout") — never the error's message, which could carry anything.
 */
function unavailable(error: unknown): string {
  const reason = (error as { reason?: unknown } | null)?.reason;
  return typeof reason === "string" && /^[\w-]{1,20}$/.test(reason)
    ? `unavailable (${reason})`
    : "unavailable";
}

const newsTemplate = (input: NewsNudgeInput): NudgeDraft =>
  templateFor({
    type: "news",
    name: input.name,
    shortName: input.shortName,
    reports: input.reports,
  });

const templateOpening: Opening = {
  sentence: OPENING_TEMPLATE,
  model: "template",
  promptVersion: null,
};

/** Pip's own words for everything: the whole answer when nothing needs a model, or it failed. */
function allTemplates(request: WordingRequest): WordingResult {
  return {
    news: request.news.map(newsTemplate),
    recommendations: request.recommendations.map(recommendationTemplate),
    opening: request.opening ? templateOpening : null,
  };
}

interface RawWording {
  notes?: { id?: unknown }[];
  briefs?: { id?: unknown }[];
  opening?: unknown;
}

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

    async words(request) {
      const result = allTemplates(request);
      // Only news with a plan and something to read goes to the model.
      const notes = request.news
        .map((input, index) => ({ id: `n${index + 1}`, index, input }))
        .filter(({ input }) => input.plan !== null && input.reports.length > 0);
      const briefs = request.recommendations.map((input, index) => ({
        id: `r${index + 1}`,
        index,
        input,
      }));
      const wantOpening =
        request.opening !== null && (request.opening.titles.length > 0 || notes.length > 0);
      if (notes.length === 0 && briefs.length === 0 && !wantOpening) return result;

      let content: string;
      let answeredBy = model;
      try {
        const answer = await chat({
          model,
          system: WORDING_SYSTEM,
          user: wordingUser({
            plan: notes[0]?.input.plan ?? briefs[0]?.input.plan ?? null,
            notes,
            briefs,
            titles: wantOpening ? request.opening!.titles : null,
          }),
          schema: WORDING_SCHEMA,
        });
        content = answer.content;
        answeredBy = answer.model || model;
      } catch (error) {
        fellBack(unavailable(error));
        return result;
      }

      let raw: RawWording;
      try {
        raw = JSON.parse(content) as RawWording;
      } catch {
        fellBack("not JSON");
        return result;
      }
      const by = `groq:${answeredBy}`;
      const byId = <T extends { id?: unknown }>(list: T[] | undefined, id: string) =>
        (Array.isArray(list) ? list : []).find((item) => item?.id === id);

      for (const { id, index, input } of notes) {
        const note = byId(raw.notes, id);
        if (!note) {
          fellBack("missing a note");
          continue;
        }
        const checked = checkNewsAnswer(
          JSON.stringify(note),
          Math.min(input.reports.length, MAX_REPORTS_PER_NOTE),
        );
        if (!checked.ok) {
          fellBack(checked.why);
          continue;
        }
        result.news[index] = checked.material
          ? {
              title: checked.title,
              body: checked.body,
              citedIds: checked.cited.map((n) => input.reports[n - 1]!.id),
              model: by,
              promptVersion: WORDING_PROMPT_VERSION,
            }
          : { material: false, model: by, promptVersion: WORDING_PROMPT_VERSION };
      }

      for (const { id, index, input } of briefs) {
        const brief = byId(raw.briefs, id);
        if (!brief) {
          fellBack("missing a brief");
          continue;
        }
        const checked = checkRecommendationAnswer(JSON.stringify(brief), input.course);
        if (!checked.ok) {
          fellBack(checked.why);
          continue;
        }
        result.recommendations[index] = {
          parts: checked.parts,
          title: briefTitle(input),
          body: briefBody(checked.parts),
          citedIds: [],
          model: by,
          promptVersion: WORDING_PROMPT_VERSION,
        };
      }

      if (wantOpening) {
        const checked = checkOpeningAnswer(JSON.stringify({ sentence: raw.opening }));
        if (checked.ok) {
          result.opening = {
            sentence: checked.sentence,
            model: by,
            promptVersion: WORDING_PROMPT_VERSION,
          };
        } else fellBack(checked.why);
      }
      return result;
    },
  };
}

/**
 * Stub mode and CI (hard line 7): canned words built from the facts, no
 * network. News with a plan is always "material", citing every report, so the
 * loop test can see a news nudge travel end to end; briefs are Pip's template.
 */
export function stubWriter(): NudgeWriter {
  return {
    kind: "stub",
    async words(request) {
      return {
        news: request.news.map((input) => {
          if (!input.plan || input.reports.length === 0) return newsTemplate(input);
          const publishers = [...new Set(input.reports.map((r) => r.publisher))];
          return {
            title: `${input.name} in the news`,
            body: `Sample words from stub mode: ${publishers.join(" and ")} reported on ${input.name} this week.`,
            citedIds: input.reports.map((report) => report.id),
            model: "stub",
            promptVersion: WORDING_PROMPT_VERSION,
          };
        }),
        recommendations: request.recommendations.map(recommendationTemplate),
        opening:
          request.opening === null
            ? null
            : request.opening.titles.length === 0 &&
                !request.news.some((input) => input.plan && input.reports.length > 0)
              ? templateOpening
              : {
                  sentence: "Here's your week, from stub mode.",
                  model: "stub",
                  promptVersion: WORDING_PROMPT_VERSION,
                },
      };
    },
  };
}
