/** Plain-text alternatives. Every component degrades to a labelled sentence. */

export type Email = {
  subject: string;
  /** Hidden inbox preview line. */
  preheader: string;
  html: string;
  text: string;
};

const WIDTH = 46;

/** Wraps a paragraph to the board's ~46 character plain-text column. */
export function wrap(paragraph: string, width = WIDTH): string {
  const lines: string[] = [];
  let line = "";
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

export const RULE = "- - - - - - - - - - - - - - - - - - - - - -";

/** The one place plain text draws: a 24-character pipe bar. */
export function textBar(percent: number): string {
  const filled = Math.max(0, Math.min(24, Math.round((percent / 100) * 24)));
  return `[${"|".repeat(filled)}${" ".repeat(24 - filled)}]`;
}

/** Joins blocks with blank lines, dropping empty ones. */
export function lines(...blocks: (string | false | null | undefined)[]): string {
  return (
    blocks.filter((b): b is string => typeof b === "string" && b.length > 0).join("\n\n") + "\n"
  );
}
