# Design

The developer's translation of the Claude Design handover. Once signed off, this file — not the prototype — is the visual source of truth. Where the two disagree, this file wins and the prototype is treated as an earlier draft.

Reference prototype: `docs/design/Pip.dc.html` (built on the Organic design system). Last updated: Phase 1, task 2.

---

## 1. Product

**Pip.** A pip is a seed — the smallest thing that grows. Three seeds at three sizes _are_ the product: a big calm one you never touch, a middle one you chose yourself, and a small hot one you're allowed to gamble with.

Tagline: **Three pots. One number. No homework.**

**Voice:** a mate who's good with money and bad at jargon. Leads with pounds, never percentages alone. Tells you when to do nothing — which is most days.

**Jargon is banned.** Use the right-hand column everywhere, including in code comments and API field names where it reads naturally:

| Never say    | Say                      |
| ------------ | ------------------------ |
| Portfolio    | Everything you own       |
| Allocation   | What's inside            |
| Rebalance    | Even it back out         |
| Contribution | Money in                 |
| Drawdown     | The worst dip so far     |
| Exposure     | How much is riding on it |

---

## 2. The three pots

Display names are UI-only. Internal IDs stay `Base`, `Medium`, `Degen` (CLAUDE.md s1), mapped through `BUCKET_META` in `packages/shared`.

| ID       | Display name   | Colour     | Character                                                                                                            | Provider             |
| -------- | -------------- | ---------- | -------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `Base`   | **Foundation** | Sage       | Autopilot. Calm type, generous air, no red unless something genuinely matters. The pot you're meant to forget.       | Trading 212 (ISA)    |
| `Medium` | **Handpicked** | Terracotta | Yours. Warm and faintly proud — shows real company names, because these are ones you've heard of.                    | Trading 212 (Invest) |
| `Degen`  | **Side Bet**   | Hot clay   | Capped. Always drawn inside a hatched fence with a hard border, so it reads as "the risky bit" from across the room. | Kraken               |

**Side Bet is never allowed to look like the other two.** Wherever it appears it carries a 1.5px accent border and the hatch fill. It is the only thing in the app that can turn anything red.

---

## 3. Brand

### Logo

Three circles, fixed geometry, on a 56×56 viewBox: sage `r13` at (19,20), terracotta `r10` at (36.5,25), hot clay `r6.5` at (27,41.5). **The mark never rearranges; only the colour changes.** Four variants live in `apps/web/src/assets/brand/` (see ARCHITECTURE.md for the full asset list).

### Type

Two faces, no exceptions.

- **Caprasimo** (`--font-heading`, weight 400) — every big number and every heading. Nothing else, ever.
- **Figtree** (`--font-body`) — all interface copy, labels and small print. 400 for prose, 600 for emphasis, 700–800 for figures and buttons.

Both self-hosted via `@fontsource`. The scale, as used in the prototype:

| Role                              | Size                              | Face      |
| --------------------------------- | --------------------------------- | --------- |
| Hero total ("Everything you own") | 47px, `-.025em`, decimals at 16px | Caprasimo |
| Pot / instrument value            | 42px, `-.025em`                   | Caprasimo |
| Screen title                      | 29px, `-.02em`                    | Caprasimo |
| Pot name, card heading            | 18–24px                           | Caprasimo |
| Body, list rows                   | 13.5–15px, line-height 1.5–1.6    | Figtree   |
| Meta, captions                    | 11.5–12.5px                       | Figtree   |
| Section label                     | 11px, uppercase, `.12em`, 700     | Figtree   |

### Colour

Every colour is a token. **No hex values in components.** Tokens are scoped: the theme sets the base, and a pot scope (`fnd` / `pick` / `bet`) overrides the accent trio inside it.

**Light**

| Token                | Value                 | Use                             |
| -------------------- | --------------------- | ------------------------------- |
| `bg`                 | `#ebddc5`             | Screen ground                   |
| `card`               | `#f5ead8`             | Card surface                    |
| `sunk`               | `#e3d4ba`             | Track, inset, pill group ground |
| `ink`                | `#201e1d`             | Primary text                    |
| `ink2`               | `rgba(32,30,29,.80)`  | Secondary text                  |
| `ink3`               | `rgba(32,30,29,.72)`  | Meta, captions                  |
| `line`               | `rgba(32,30,29,.12)`  | Rules and borders               |
| `up`                 | `#56633f`             | Gains                           |
| `dn`                 | `#a33327`             | Losses                          |
| `skel`               | `rgba(32,30,29,.10)`  | Skeleton fill                   |
| `solid` / `solidInk` | `#8c491a` / `#fff4ea` | Primary button                  |

**Dark**

| Token                   | Value                                                         |
| ----------------------- | ------------------------------------------------------------- |
| `bg` / `card` / `sunk`  | `#1c1815` / `#2a241e` / `#171310`                             |
| `ink` / `ink2` / `ink3` | `#f3ead9` / `rgba(243,234,217,.84)` / `rgba(243,234,217,.68)` |
| `line` / `skel`         | `rgba(243,234,217,.14)` / `rgba(243,234,217,.09)`             |
| `up` / `dn`             | `#aebf92` / `#f08a7e`                                         |
| `solid` / `solidInk`    | `#f6a06b` / `#241a12`                                         |

**Pot accents** (`acc` = accent, `tint` = tinted fill, `aink` = text on tint):

| Scope  | Light `acc` / `tint` / `aink`     | Dark `acc` / `tint` / `aink`      |
| ------ | --------------------------------- | --------------------------------- |
| `fnd`  | `#7a8a5e` / `#e1eecc` / `#3d472b` | `#aebf92` / `#2d3323` / `#ccdbb2` |
| `pick` | `#c67139` / `#ffe1d0` / `#643312` | `#f6a06b` / `#3a2a1d` / `#ffc6a5` |
| `bet`  | `#c0392c` / `#ffdcd6` / `#7a2418` | `#f08a7e` / `#3d211c` / `#ffc7bf` |

Side Bet hatch: `repeating-linear-gradient(135deg, rgba(192,57,44,.07) 0 9px, transparent 9px 18px)`. On a track, the same at `.16`.

Provider swatches: Trading 212 `#1f3a5f`, Kraken `#5741d9`.

### Shape, space, motion

- Radii: 30px screen cards · 26px section cards · 22–24px inner blocks · 14–16px chips and inputs · `999px` every button, pill and track.
- Nothing sharp, nothing hairline-only. Rounded shapes need air — don't crowd them.
- Icons: **Lucide**, stroke-width **2.75**, 15–23px in interface, 26–42px in empty states.
- Motion is minimal: a 1.5s skeleton pulse, a 1s spinner, a 120ms hover brightness shift. Nothing else animates.
- Focus is never the browser default: `outline: 2px solid var(--acc); outline-offset: 3px`.
- Tap targets are whole rows and whole cards, not chevrons.

---

## 4. Copy rules

These are design rules, not suggestions. A screen that breaks one is wrong.

1. **Pounds before percent.** Every percentage is followed by what it means in money. "Up 6%" on its own is banned.
2. **One number is the hero.** Everything you own, once, at the top, bigger than anything else on the screen. Never two heroes.
3. **Silence is a result.** "Nothing needs you" is the most common state, and it is designed for — not an empty screen.
4. **No chart without a sentence.** Every chart carries a plain-English caption saying what it did.
5. **Read-only, said out loud.** Every screen ends with a line reminding you Pip can't trade.
6. **Side Bet looks different.** Hatch, hard border, its own hot colour, everywhere it appears.

### Two patterns that travel with the data

- **Price provenance.** Any screen showing a live figure carries one small line: a dot, then the source and age — "Sample prices · stub data" in Phase 1. Green when fresh, amber when a feed is over an hour stale, and when stale it names the affected pot. Never a badge, never a tooltip, never hidden behind an icon.
- **Information, not advice.** Anything that reads like a suggestion carries an 11px uppercase label with an (i) glyph in muted ink. Statements of fact — your balance, today's change — never carry it, so the label keeps its meaning.

---

## 5. Corrections to the prototype (CLAUDE.md hard lines)

The prototype breaks several hard lines. **Build these corrections, not the prototype.** Rationale is in `docs/phases/phase-1.md`.

1. **Nothing says Pip moves money.** Cut "Pip has stopped putting new money in here", "Pip will nudge new money elsewhere", "Pip stopped topping it up", and "Where new money goes — split automatically". Rewrite each as a statement about the user's own setup at their provider, e.g. "Your Trading 212 auto-invest splits £200 like this". Hard line 1.
2. **The over-cap banner has no buttons in Phase 1.** "Raise the cap" is rule editing (Phase 5); "Show me how to fix it" has no destination. The banner states the fact and carries the not-advice label. Hard line 1.
3. **Prices never come from the trading APIs.** The provenance line never says "Prices from Trading 212 & Kraken" — it names the market-data source. Hard line 8.
4. **Fixtures never cross pots.** The prototype's feed says "£60 of your ISA bought Rolls-Royce", but Rolls-Royce is Handpicked (Invest), not the ISA. Hard line 11.
5. **No promises about emails.** The waitlist says "Waqar will let you know", not "we'll email you".
6. **"Nudge me" is omitted** (notifications are Phase 7). Currency shows as fixed GBP.
7. **Instrument explainers are hand-written stub text** in Phase 1, under the not-advice label. Their real source is the Phase 6 research module, and they stay generic for users other than Waqar. Hard line 12.

---

## 6. Data display system

Seven blocks, each with one job. All seven take their colour from the pot scope they sit in, so none needs a per-context variant.

| Block                             | Job                                  | Rules                                                                                                                                                      | Used on                  |
| --------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Big number**                    | "How much have I got"                | One per screen. Money before percent, decimals shrunk so the pounds carry the weight.                                                                      | Home, pot, instrument    |
| **Sparkline**                     | Shape of the trend at a glance       | No axes, no numbers, never tappable on its own. It's punctuation beside a figure, not a chart.                                                             | Pot cards, holdings rows |
| **Line chart**                    | Value or price over a chosen span    | No gridlines, no y-axis. Caption underneath in words. Always carries the provenance line.                                                                  | Pot, instrument          |
| **Bar chart**                     | Compare discrete things or months    | Value labels above the bars, so nobody reads a scale. A zero month is a stub at 40% opacity, never a gap.                                                  | Pot ("Money in")         |
| **Allocation ring + stacked bar** | How the whole splits, against target | Ring for the three-way split across pots; stacked bar for what's inside one pot. Target stated in words underneath — never a second faint ring.            | Home, pot                |
| **Holdings table**                | The full list, sortable              | Three columns is the phone limit; a plain-English sub-line replaces a fourth. Whole rows are the tap target.                                               | Pot                      |
| **Progress + cap bar**            | Where you are against a line you set | Fill is where you are, the ink tick is your line. Over the line, the track picks up the Side Bet hatch and the figure turns red — the only red in the app. | Home, rules              |

Charts are hand-rolled SVG, as in the prototype. No chart library.

Supporting pieces: **skeleton** (`sk`, pulsing tinted block), **provenance line**, **not-advice label**.

---

## 7. Screens

Tab bar, three tabs: **Pots** · **Rules** · **Setup**. A red dot on Rules is the over-cap warning — the only red chrome in the app, and only Side Bet can cause it.

### Sign-in

One button, no passwords. Invite-only, so the door has to say no kindly.

- **Sign in** — mark, the tagline as a three-line heading, "Pip shows you your money in plain English. It can look, never touch.", a "Continue with Google" button, and a line saying Pip reads your name and email and nothing else.
- **Checking** — spinner, "Checking you're on the list", "Two seconds. Pip is only asking Google who you are."
- **Not on the list** — dashed-outline mark, "You're not on the list — yet", the signed-in email named back, a "Put me on the waiting list" button and a "Try a different account" link. No queue position, no countdown.

### Pots (home)

Header (mark, wordmark, sync chip) · hero card ("Your week" → one-line verdict, then the hero total with today's change) · provenance line · timeframe pills (Today / This month / All time — these change every figure on the screen) · three pot cards (name, blurb, value, change, sparkline, progress-and-target bar, share of your money) · "How it splits" (ring + legend + target sentence) · "What changed" feed for the last 7 days, ending "That's the lot. Quiet week." · read-only footer.

- **Loading** — skeletons in the shape of the numbers, never a spinner where a figure will be. "Counting your money…"
- **Empty (first run)** — "Three empty pots, waiting for you." and a connect button.
- **Error (stale)** — the last good total stays on screen, marked "Roughly — one pot is stale", with a banner naming the pot and a "Try again".

### Pot detail

Back to your pots · header card (name, badge, blurb, value, change, plain-English line; Side Bet hatched and bordered) · "How it's gone" line chart with caption · "Money in" bar chart with caption · "What's inside" (stacked bar, sortable holdings table) · footer: "Read-only. To buy or sell, use {provider} — Pip just keeps score."

- **Loading** — skeleton cards.
- **Empty** — for Side Bet: "Nothing in here, which is a perfectly good place to leave it", the cap explained in pounds, a connect button, and "You don't need this pot. It's just allowed to exist."
- **Error (no history)** — the value stays correct and visible; only the chart is replaced, with "The value above is correct — it's only the history that's missing. Nothing's wrong with your money."

### Instrument detail

Back to pot · header (pot chip, ticker chip, name, quantity and unit price, value, today and since-you-bought) · price chart with Day/Month/Year/All pills and the provenance line · "In plain English" explainer under the not-advice label · read-only footer.

- **Loading** — the name and pot are known instantly; only the numbers wait.
- **Empty (bought today)** — "No history yet — come back tomorrow" and "One day is not a trend, so Pip won't draw you one."
- **Error (stale price)** — the figure dims, "Price is 2 hours old", and an explanation that the holding hasn't changed, only what Pip can see of it.

### Rules — display only in Phase 1

"Your rules. You set the shape once. Pip nags you if the shape drifts."

Over-cap banner (when over) → three rule cards (name, kind badge — Target or Hard cap — the target figure, the progress-and-cap bar, a plain-English line) → "Where new money goes" (corrected per §5.1) → footer: "Changing a rule changes what Pip tells you — it never moves your money."

- **Loading** — skeleton cards.
- **Error (couldn't save)** — "That change didn't stick", the old value still shown as what's running, "nothing's been half-applied".
- The +/− steppers, saving and the "no rules yet — use 70/25/5" empty state are **Phase 5**.

### Setup

"Where Pip reads your numbers from."

Connection rows (provider swatch, name, what it feeds, status badge) and "Connect another account" · Appearance (Light/Dark, follows your phone) · "Hide the numbers" (blurs totals until you tap; per-device, localStorage) · Currency (£ GBP, fixed) · footer: "Pip uses read-only keys. Even if someone took your phone, they couldn't trade."

**Connect flow** — pasting a key is the least friendly thing Pip asks, so it gets the most hand-holding:

- **Not connected** — numbered steps, "generate a key with read-only ticked, nothing else", the key field, and "Your key is stored encrypted and only ever used to read balances."
- **Connected** — what it feeds, holdings seen, last read, and a shield line: "This key cannot place orders. Pip checked."
- **Invalid key** — "Kraken doesn't recognise that key", the likely cause, and "Nothing is connected, and nothing was changed."
- **Too much access** — "That key can do too much", a permission checklist (query funds needed; create/cancel orders and withdraw must be off), and a refusal to store it. This is a **hard requirement**, not a warning (CLAUDE.md s13).

Other Setup states: loading (per-row spinner while checking keys), empty ("Nothing plugged in yet"), error ("access expired" — the stale £0 is explained, not shown as real).

---

## 8. Layout

Mobile-first, 390×844 as the reference frame. On desktop the phone layout is centred at a max width of ~440px — the handover has no desktop design, so anything wider needs a design decision, not an improvised one.

Safe areas are respected (the tab bar carries bottom padding for the home indicator). Content scrolls under a fixed tab bar.

---

## 9. Open questions

- **Desktop.** Centred phone column is the Phase 1 answer. A real desktop layout is undesigned.
- **App icon at small sizes.** The mark is rasterized on the cream ground; there's no separately drawn small-size version.
- **Amber provenance state.** The handover describes it but never draws it. Built from the tokens as the accent tint until designed.
