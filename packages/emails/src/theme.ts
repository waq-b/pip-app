/**
 * Pip's email palette (design board "Pip Emails", section 12). Email can't use
 * the app's CSS variables, so every colour is written inline in its light value
 * and carries a class that the dark-mode block in the <head> overrides.
 */

export const SERIF = "Georgia,'Times New Roman',serif";
export const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

export const light = {
  ground: "#ebddc5",
  card: "#f5ead8",
  cardBorder: "#dfceb0",
  rule: "#e6d8bd",
  track: "#d6c4a4",
  sunk: "#ebddc5",
  ink: "#201e1d",
  ink2: "#413c37",
  ink3: "#6d6660",
  link: "#8c491a",
  up: "#4a5636",
  dn: "#8f2e22",
  labelBorder: "#b0a69a",
} as const;

export const dark = {
  ground: "#1c1815",
  card: "#2a241e",
  cardBorder: "#473b2e",
  rule: "#473b2e",
  track: "#473b2e",
  sunk: "#221d19",
  ink: "#f3ead9",
  ink2: "rgba(243,234,217,.84)",
  ink3: "rgba(243,234,217,.66)",
  link: "#f6a06b",
  up: "#aebf92",
  dn: "#ffc7bf",
  labelBorder: "rgba(243,234,217,.4)",
} as const;

export type Pot = "foundation" | "handpicked" | "sideBet";

export const potColour: Record<Pot, { light: string; dark: string }> = {
  foundation: { light: "#7a8a5e", dark: "#aebf92" },
  handpicked: { light: "#c67139", dark: "#f6a06b" },
  sideBet: { light: "#c0392c", dark: "#f08a7e" },
};

export const potName: Record<Pot, string> = {
  foundation: "Foundation",
  handpicked: "Handpicked",
  sideBet: "Side Bet",
};

/** Chip fills. `ink` is the solid black "Recommendation" chip. */
export type Tone = "foundation" | "handpicked" | "sideBet" | "amber" | "ink";

export const tone: Record<
  Tone,
  { bg: string; border: string; text: string; darkBg: string; darkText: string }
> = {
  foundation: {
    bg: "#e1eecc",
    border: "#b9cf96",
    text: "#3d472b",
    darkBg: "#2d3323",
    darkText: "#ccdbb2",
  },
  handpicked: {
    bg: "#ffe1d0",
    border: "#e9b892",
    text: "#8c491a",
    darkBg: "#3a2a1d",
    darkText: "#ffc6a5",
  },
  sideBet: {
    bg: "#ffdcd6",
    border: "#e09c92",
    text: "#8f2e22",
    darkBg: "#3d211c",
    darkText: "#ffc7bf",
  },
  amber: {
    bg: "#fbe6bd",
    border: "#dcbc6c",
    text: "#7a5200",
    darkBg: "#3a2c14",
    darkText: "#f3c46a",
  },
  ink: {
    bg: "#201e1d",
    border: "#201e1d",
    text: "#f5ead8",
    darkBg: "#f3ead9",
    darkText: "#241a12",
  },
};

/** Amber callouts: a pot that isn't connected, stale prices. */
export const amber = {
  tint: "#fbe6bd",
  softTint: "#fbf3e2",
  border: "#dcbc6c",
  rail: "#b8790a",
  text: "#7a5200",
  number: "#8a5a00",
};

function rules(): string {
  const d = dark;
  const lines = [
    `.pe-bg{background:${d.ground}!important}`,
    `.pe-card{background:${d.card}!important;border-color:${d.cardBorder}!important}`,
    `.pe-sunk{background:${d.sunk}!important;border-color:${d.cardBorder}!important}`,
    `.pe-code{background:#171310!important;border-color:${d.ink}!important}`,
    `.pe-rule{background:${d.rule}!important}`,
    `.pe-rule-b{border-color:${d.rule}!important}`,
    `.pe-track{background:${d.track}!important}`,
    `.pe-ink{color:${d.ink}!important}`,
    `.pe-ink2{color:${d.ink2}!important}`,
    `.pe-ink3{color:${d.ink3}!important}`,
    `.pe-link{color:${d.link}!important}`,
    `.pe-up{color:${d.up}!important}`,
    `.pe-dn{color:${d.dn}!important}`,
    `.pe-inkborder{border-color:${d.ink}!important}`,
    `.pe-label{border-color:${d.labelBorder}!important;color:${d.ink2}!important}`,
    `.pe-amber{background:#3a2c14!important;border-color:#eab04a!important}`,
    `.pe-amber-t{color:#f3c46a!important}`,
  ];
  for (const [pot, c] of Object.entries(potColour)) {
    lines.push(`.pe-${pot}{background:${c.dark}!important;border-color:${c.dark}!important}`);
    lines.push(`.pe-${pot}-b{border-color:${c.dark}!important}`);
  }
  for (const [name, t] of Object.entries(tone)) {
    lines.push(`.pe-chip-${name}{background:${t.darkBg}!important;color:${t.darkText}!important}`);
  }
  return lines.join("\n");
}

/** The <head> style block: dark mode for clients that respect it, and the 320px layout. */
export function headStyles(): string {
  const dm = rules();
  return `
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:collapse}
a{text-underline-offset:2px}
@media only screen and (max-width:620px){
.pe-outer{width:100%!important}
.pe-gutter{padding-left:12px!important;padding-right:12px!important}
.pe-pad{padding-left:18px!important;padding-right:18px!important}
.pe-stack{display:block!important;width:100%!important}
.pe-hero{font-size:36px!important}
}
@media (prefers-color-scheme:dark){
${dm}
}
${dm
  .split("\n")
  .map((l) => `[data-ogsc] ${l}`)
  .join("\n")}
`.trim();
}
