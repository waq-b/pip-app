import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The wall (Phase 5 decision 9, hard line 2): the research module can only be
 * handed values and hand back text. Proven here, not promised in a comment —
 * every import in `research/` must stay inside `research/` or be the shared
 * types package, and nothing in it may reach the network, the environment, a
 * process or the filesystem. So there is no path from an LLM to rules, keys,
 * the database, providers or orders.
 *
 * Test files are left out: they never ship, and this one needs the filesystem.
 */
const RESEARCH = resolve(import.meta.dirname);
const ALLOWED_PACKAGES = new Set(["@finance-app/shared"]);
const FORBIDDEN_CODE: { pattern: RegExp; what: string }[] = [
  { pattern: /\bprocess\s*\./, what: "process" },
  { pattern: /(^|[^.\w])fetch\s*\(/, what: "fetch" },
  { pattern: /\brequire\s*\(/, what: "require" },
  { pattern: /\bglobalThis\b/, what: "globalThis" },
  { pattern: /\bXMLHttpRequest|WebSocket\b/, what: "network" },
  { pattern: /\beval\s*\(|new\s+Function\s*\(/, what: "eval" },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(RESEARCH);

function importsOf(file: string): string[] {
  return ts
    .preProcessFile(readFileSync(file, "utf8"), true, true)
    .importedFiles.map((i) => i.fileName);
}

describe("the research wall", () => {
  it("found the module, rather than passing vacuously", () => {
    expect(files.map((file) => relative(RESEARCH, file))).toEqual(
      expect.arrayContaining(["writer.ts", "guard.ts", "templates.ts", "prompts/awareness.v1.ts"]),
    );
  });

  it.each(files.map((file) => [relative(RESEARCH, file), file]))(
    "%s imports only research/ and the shared types",
    (_name, file) => {
      for (const specifier of importsOf(file)) {
        if (specifier.startsWith(".")) {
          const target = resolve(dirname(file), specifier);
          expect(
            target.startsWith(RESEARCH + "/") || target === RESEARCH,
            `${specifier} leaves research/`,
          ).toBe(true);
        } else {
          expect(ALLOWED_PACKAGES.has(specifier), `${specifier} isn't allowed in research/`).toBe(
            true,
          );
        }
      }
    },
  );

  it.each(files.map((file) => [relative(RESEARCH, file), file]))(
    "%s never reaches the network, the environment or a process",
    (_name, file) => {
      const code = readFileSync(file, "utf8")
        // Comments may talk about fetching; code may not.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      for (const { pattern, what } of FORBIDDEN_CODE) {
        expect(pattern.test(code), `${what} in ${relative(RESEARCH, file)}`).toBe(false);
      }
    },
  );

  it("would catch a crossing — the check isn't blind", () => {
    const sneaky = ts
      .preProcessFile(
        `import { dbRulesStore } from "../rules/store.js"; const k = await import("../crypto/secrets.js");`,
        true,
        true,
      )
      .importedFiles.map((i) => i.fileName);
    expect(sneaky).toEqual(["../rules/store.js", "../crypto/secrets.js"]);
    for (const specifier of sneaky) {
      expect(resolve(RESEARCH, specifier).startsWith(RESEARCH + "/")).toBe(false);
    }
    expect(FORBIDDEN_CODE.some(({ pattern }) => pattern.test("await fetch(url)"))).toBe(true);
    expect(FORBIDDEN_CODE.some(({ pattern }) => pattern.test("process.env.GROQ_API_KEY"))).toBe(
      true,
    );
  });
});
