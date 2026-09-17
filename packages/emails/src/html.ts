/**
 * A tiny escaping HTML builder. Everything interpolated into `html` is escaped
 * unless it is already `Html` (built by `html` or marked with `raw`), so copy
 * written by code or a model can never inject markup into an email.
 */
export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export type Child = Html | string | number | null | undefined | false | readonly Child[];

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

function render(child: Child): string {
  if (child === null || child === undefined || child === false) return "";
  if (child instanceof Html) return child.value;
  if (Array.isArray(child)) return child.map(render).join("");
  return escape(String(child));
}

export function html(strings: TemplateStringsArray, ...values: Child[]): Html {
  let out = strings[0] ?? "";
  values.forEach((value, i) => {
    out += render(value) + (strings[i + 1] ?? "");
  });
  return new Html(out);
}

/** Trusted markup only — never pass user or model text. */
export function raw(markup: string): Html {
  return new Html(markup);
}
