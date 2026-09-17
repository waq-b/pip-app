import type { Bucket, Pence } from "@finance-app/shared";

/**
 * The research module's whole world (Phase 5 decision 9). It is handed values
 * and hands back text. It never fetches, never reads the database, the
 * environment or a key, and nothing it returns can act on anything — hard
 * line 2 made structural. `wall.test.ts` proves the imports.
 */

/** What an LLM call looks like from in here. The HTTP lives outside `research/`. */
export interface ChatRequest {
  model: string;
  system: string;
  user: string;
  /** Strict JSON schema the answer must match. */
  schema: { name: string; schema: Record<string, unknown> };
}

export interface ChatAnswer {
  /** The raw JSON text the model returned. */
  content: string;
  /** Which model actually answered. */
  model: string;
}

export type Chat = (request: ChatRequest) => Promise<ChatAnswer>;

/** A report as the writer sees it: numbered, quoted, never trusted. */
export interface ReportForWriter {
  id: string;
  publisher: string;
  publishedAt: Date;
  headline: string;
  snippet: string | null;
}

/** Percentages only — pounds, quantities and ids never reach an LLM (decision 6). */
export interface MovesForWriter {
  day: number | null;
  week: number | null;
  month: number | null;
}

export interface PlanForWriter {
  goals: string;
  horizonYears: number | null;
  riskWords: string;
  shape: { foundation: number; handpicked: number; sideBetCap: number };
}

export interface NewsNudgeInput {
  name: string;
  shortName: string;
  bucket: Bucket;
  /** The pot's share of everything Pip can see, percent. */
  potSharePercent: number | null;
  moves: MovesForWriter;
  nextResultsDate: string | null;
  /** Already through stage A, newest first. */
  reports: ReportForWriter[];
  /** Present only for users with personal research on; otherwise no LLM call is made. */
  plan: PlanForWriter | null;
}

/** What comes back for any nudge: words, and where they came from. */
export interface NudgeDraft {
  title: string;
  body: string;
  /** Report ids the words rest on (news only). */
  citedIds: string[];
  /** `groq:openai/gpt-oss-120b`, `stub`, or `template`. */
  model: string;
  promptVersion: string | null;
}

/** The writer judged the reports routine — no nudge. */
export interface NotMaterial {
  material: false;
  model: string;
  promptVersion: string;
}

export interface MoneyFigure {
  pence: Pence;
  percent: number;
}
