# Design

The developer's translation of the Claude Design handover. Once signed off, this file — not the prototype — is the visual source of truth. Where the two disagree, this file wins and the prototype is treated as an earlier draft.

Reference prototype: `docs/design/Pip.dc.html` (built on the Organic design system). Last updated: Phase 1, second handover (desktop, icon cuts, amber).

---

## 1. Product

**Pip.** A pip is a seed — the smallest thing that grows. Three seeds at three sizes _are_ the product: a big calm one you never touch, a middle one you chose yourself, and a small hot one you're allowed to gamble with.

Tagline: **Three pots. One number. No homework.**

**Voice:** a mate who's good with money and bad at jargon. Leads with pounds, never percentages alone. Tells you when to do nothing — which is most days.

**Jargon is banned.** Use the right-hand column everywhere:

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

| ID       | Display name   | Colour     | Character                                                                                                 | Provider             |
| -------- | -------------- | ---------- | --------------------------------------------------------------------------------------------------------- | -------------------- |
| `Base`   | **Foundation** | Sage       | Autopilot. Calm type, generous air. The pot you're meant to forget.                                       | Trading 212 (ISA)    |
| `Medium` | **Handpicked** | Terracotta | Yours. Warm and faintly proud — shows real company names.                                                 | Trading 212 (Invest) |
| `Degen`  | **Side Bet**   | Hot clay   | Capped. Always inside a hatched fence with a hard border, so it reads as "the risky bit" across the room. | Kraken               |

**Side Bet is never allowed to look like the other two**, at any breakpoint. It is the only thing in the app that can turn anything red.

---

## 3. Brand

### Logo — two cuts

Three circles on a 56×56 viewBox. **The mark never rearranges and nothing is ever dropped; only the geometry and the colour change.**

| Cut          | Use         | Radii           | Centres                     |
| ------------ | ----------- | --------------- | --------------------------- |
| **Standard** | 48px and up | 13 / 10 / 6.5   | (19,20) (36.5,25) (27,41.5) |
| **Small**    | 16–48px     | 13.5 / 11.5 / 9 | (18,19) (38,24.5) (27,43)   |

Below 48px the third seed falls under two device pixels and the gaps close up, so the small cut compresses the size contrast and pushes the centres out by 1.5–2 units. The big seed still reads biggest; at 16px the three read as three warm dots. **Switch cuts at 48px.** The one-ink favicon uses the small cut.

**Maskable (Android):** full-bleed terracotta plate, small-cut mark reversed in cream at 52% of the canvas, dead centre — inside the 80% safe circle whatever the launcher crops to. The reversed mark keeps opacity steps 100 / 78 / 56 so the seeds stay distinguishable in one ink.

Variants live in `apps/web/src/assets/brand/` (see ARCHITECTURE.md for the asset list).

### Type

Two faces, no exceptions.

- **Caprasimo** (weight 400) — every big number and every heading. Nothing else, ever.
- **Figtree** — all interface copy, labels and small print. 400 prose, 600 emphasis, 700–800 figures and buttons.

Self-hosted via `@fontsource`. Phone sizes, with the desktop step where it differs:

| Role                              | Phone                         | Desktop           |
| --------------------------------- | ----------------------------- | ----------------- |
| Hero total                        | 47px, `-.025em`               | 72px, `-.03em`    |
| Pot / instrument value            | 42px                          | 58–60px, `-.03em` |
| Screen title                      | 29px                          | 30–32px           |
| Verdict line ("Up £41 this week") | 28px                          | 30px, one line    |
| Pot name, card heading            | 18–24px                       | 19–21px           |
| Body, list rows                   | 13.5–15px                     | 13–15px           |
| Meta, captions                    | 11.5–12.5px                   | 11–12px           |
| Section label                     | 11px, uppercase, `.12em`, 700 | 11.5px            |

### Colour

Every colour is a token. **No hex values in components.** The theme sets the base; a pot scope (`fnd` / `pick` / `bet`) overrides the accent trio inside it.

**Light**

| Token                   | Value                                                   | Use                         |
| ----------------------- | ------------------------------------------------------- | --------------------------- |
| `bg` / `card` / `sunk`  | `#ebddc5` / `#f5ead8` / `#e3d4ba`                       | Ground, card surface, track |
| `ink` / `ink2` / `ink3` | `#201e1d` / `rgba(32,30,29,.80)` / `rgba(32,30,29,.72)` | Primary, secondary, meta    |
| `line` / `skel`         | `rgba(32,30,29,.12)` / `rgba(32,30,29,.10)`             | Rules, skeleton fill        |
| `up` / `dn`             | `#56633f` / `#a33327`                                   | Gains, losses               |
| `solid` / `solidInk`    | `#8c491a` / `#fff4ea`                                   | Primary button              |

**Dark**

| Token                   | Value                                                         |
| ----------------------- | ------------------------------------------------------------- |
| `bg` / `card` / `sunk`  | `#1c1815` / `#2a241e` / `#171310`                             |
| `ink` / `ink2` / `ink3` | `#f3ead9` / `rgba(243,234,217,.84)` / `rgba(243,234,217,.68)` |
| `line` / `skel`         | `rgba(243,234,217,.14)` / `rgba(243,234,217,.09)`             |
| `up` / `dn`             | `#aebf92` / `#f08a7e`                                         |
| `solid` / `solidInk`    | `#f6a06b` / `#241a12`                                         |

**Pot accents** (`acc` accent, `tint` tinted fill, `aink` text on tint):

| Scope  | Light                             | Dark                              |
| ------ | --------------------------------- | --------------------------------- |
| `fnd`  | `#7a8a5e` / `#e1eecc` / `#3d472b` | `#aebf92` / `#2d3323` / `#ccdbb2` |
| `pick` | `#c67139` / `#ffe1d0` / `#643312` | `#f6a06b` / `#3a2a1d` / `#ffc6a5` |
| `bet`  | `#c0392c` / `#ffdcd6` / `#7a2418` | `#f08a7e` / `#3d211c` / `#ffc7bf` |

**Amber — a state colour, never a pot colour** (see §5):

| Token                 | Light     | Dark      |
| --------------------- | --------- | --------- |
| `amb` (ink)           | `#8a5a00` | `#f3c46a` |
| `ambDot`              | `#d59217` | `#eab04a` |
| `ambTint` (chip fill) | `#fbe6bd` | `#3a2c14` |
| `ambLine`             | `#b8790a` | `#eab04a` |

Amber is gold, deliberately ~60° away from every clay in the palette: nothing amber may be mistaken for Side Bet or for a loss. The amber ink is 5.2:1 on card, so it is body-copy safe.

Side Bet hatch: `repeating-linear-gradient(135deg, rgba(192,57,44,.07) 0 9px, transparent 9px 18px)` — `.16` on a track, `rgba(240,138,126,.10)` on dark.

Provider swatches: Trading 212 `#1f3a5f`, Kraken `#5741d9`.

### Shape, space, motion

- Radii: 30px screen cards · 26px section cards · 22–24px inner blocks · 20px sidebar identity block · 14–18px chips and rail items · `999px` every button, pill and track.
- Icons: **Lucide**, stroke-width **2.75**. 15–23px interface, 20–21px nav, 26–42px empty states.
- Motion: a 1.5s skeleton pulse, a 1s spinner, a 120ms hover brightness shift. Nothing else animates.
- Focus is never the browser default: `outline: 2px solid var(--acc); outline-offset: 3px`.
- Tap targets are whole rows and whole cards, not chevrons.

---

## 4. Copy rules

1. **Pounds before percent.** Every percentage is followed by what it means in money. "Up 6%" alone is banned — including in the desktop table's fourth column.
2. **One number is the hero.** Once per screen, bigger than anything else. The desktop sidebar exists partly so a top nav can't steal that position.
3. **Silence is a result.** "Nothing needs you" is the most common state and is designed for.
4. **No chart without a sentence.** Every chart carries a plain-English caption.
5. **Read-only, said out loud.** Every screen ends with a line reminding you Pip can't trade. On desktop the sidebar also carries a permanent "Read-only access" badge.
6. **Side Bet looks different.** Hatch, hard border, its own hot colour, at every breakpoint.

**Information, not advice.** Anything that reads like a suggestion carries an 11px uppercase label with an (i) glyph in muted ink. Statements of fact never carry it, so the label keeps its meaning.

---

## 5. Price provenance and the staleness ladder

One small line on any screen showing a live figure: a dot, then the source and age. It is never a badge, never a tooltip, never hidden behind an icon. **It names the market-data source, never the trading APIs** (see §6.1).

Amber appears in exactly two places: **the provenance line** and **a small age chip beside an affected figure**. It never touches the hero number, never tints a card, never draws a border. It is a dot, a line of text, and a chip.

| Age                                 | State                                                                                                                                                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Under 1 hour**                    | Green. "updated 4 min ago". Silent, the default.                                                                                                                                                                                                                            |
| **1–6 hours**                       | Amber line, naming each affected pot first, then reassuring about the rest: "Side Bet is 2 hours old · everything else updated 4 min ago". An age chip ("2H OLD") appears beside any figure that pot feeds. No card, no button, no tab-bar badge. The total stays undimmed. |
| **Over 6 hours, or a failed fetch** | Red stale-data card with a Try again. **The amber line stands down — one voice at a time.** The figure itself drops to 60% opacity, because the feed is gone rather than late.                                                                                              |
| **Markets closed**                  | Green, always. A Saturday price isn't stale, it's Saturday: "Prices from Friday's close."                                                                                                                                                                                   |

Two pots stale is still one line. Three pots stale becomes "All prices are 2 hours old", at which point the red card takes over. The number never disappears at any rung.

---

## 6. Corrections to the prototype (CLAUDE.md hard lines)

**Build these corrections, not the prototype.** The second handover adopted two earlier corrections (the "Where your new money goes" card and the Side Bet empty state now describe the user's own setup). These five still stand, and were re-checked against the new file:

1. **Prices never come from the trading APIs.** The prototype still reads "Prices from Trading 212 & Kraken", on the phone, on every new desktop screen and in the amber examples. It must name the market-data source — in Phase 1, "Sample prices · stub data". Hard line 8.
2. **Rules is display-only in Phase 1.** The desktop Rules screen still shows +/− steppers and the banner still carries "Show me how to fix it" and "Raise the cap". Phase 1 renders the banner with neither button and no steppers; both arrive in Phase 4. Hard line 1.
3. **Nothing says Pip moves money.** Any remaining copy implying Pip routes money is rewritten as a statement about the user's own setup at their broker. Hard line 1.
4. **Fixtures never cross pots.** The feed still says "£60 of your ISA bought Rolls-Royce", but Rolls-Royce is Handpicked (Invest), not the ISA. Hard line 11.
5. **"Nudge me" is omitted** (notifications are Phase 6) — it reappears in the desktop Setup screen. Currency shows as fixed GBP.

Instrument explainers are hand-written stub text in Phase 1 under the not-advice label. Their real source is the Phase 5 research module, and they stay generic for users other than Waqar. Hard line 12.

---

## 7. Data display system

Seven blocks, each with one job. All take their colour from the pot scope they sit in.

| Block                             | Job                                  | Rules                                                                                                                                        |
| --------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Big number**                    | "How much have I got"                | One per screen. Money before percent, decimals shrunk.                                                                                       |
| **Sparkline**                     | Shape of the trend                   | No axes, no numbers, never tappable alone. On desktop it gets its own gutter in the table rather than being squeezed.                        |
| **Line chart**                    | Value or price over a span           | No gridlines, no y-axis. Caption underneath. Always carries the provenance line. Taller on desktop (150px in a pot, 330px on an instrument). |
| **Bar chart**                     | Compare months                       | Value labels above the bars. A zero month is a stub at 40% opacity, never a gap.                                                             |
| **Allocation ring + stacked bar** | How the whole splits, against target | Ring for the three-way split, stacked bar for inside one pot. Target in words underneath, never a second faint ring.                         |
| **Holdings table**                | The full list, sortable              | Three columns on phone, **four on desktop** (see §8). Whole rows are the tap target.                                                         |
| **Progress + cap bar**            | Where you are against your line      | Fill is where you are, ink tick is your line. Over the line, the track picks up the hatch and the figure turns red.                          |

Charts are hand-rolled SVG. No chart library. Supporting pieces: **skeleton**, **provenance line**, **age chip**, **not-advice label**.

---

## 8. Layout and breakpoints

Three layouts, one set of components. Nothing is invented for desktop — the same blocks, re-laid.

| Breakpoint           | Navigation                                                                                            | Content                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **< 768 — phone**    | Three-tab bar at the bottom (Pots · Rules · Setup), red dot on Rules                                  | One column, 390 reference frame                                                                         |
| **≥ 768 — tablet**   | Tab bar becomes a **76px icon rail** on the left; 48px rounded items, label under each icon           | Still one column, capped at 640, ground either side. Tablet buys air, not density.                      |
| **≥ 1120 — desktop** | Rail expands to a **232px sidebar** with labels, plus who you're signed in as and the read-only badge | Max **1080**, two- or three-track grid. Either side is plain ground — no widgets, no ticker, no filler. |

**Sidebar, not top nav:** a horizontal band above the hero would cost the hero number its place as the first thing you see. The sidebar keeps the top-left of the content area free.

**The fourth column — desktop only.** The phone table stops at three columns because 390px is the limit, not because three is right. Desktop restores the column the phone folds into the subtitle: **Holding · Value · Today · Since you bought**, sparkline in its own gutter. That is the ceiling: no weight, no cost basis, no day range — those belong at the broker.

### Desktop screen layouts

- **Pots (home)** — verdict line and timeframe pills on one row; hero card split (big number and provenance on the left, allocation ring and legend on the right, divided by a rule); three pot cards side by side; bottom row of "What changed" (wider) beside "The shape you asked for" (narrower).
- **Pot detail** — sidebar gains a pot sub-nav (Foundation / Handpicked / Side Bet, current one pill-highlighted). Header card split: name, value and change on the left; the blurb, plain-English line and provenance on the right. Below: chart and "Money in" stacked in a narrower left column, "What's inside" with the four-column table in a wider right column.
- **Instrument detail** — breadcrumb (Pots › Handpicked › Nvidia). A 400px info card on the left (chips, name, quantity, hero value, today and since-you-bought, the plain-English note, not-advice label); the price chart takes the rest, tall, with the range pills inline in its header.
- **Rules** — 1048 content area. Header row with "Last changed" on the right. Over-cap banner runs horizontally. Three rule cards in a row.
- **Setup** — 700px, two columns: connections on the left, preferences on the right.
- **Sign-in** — the one screen with no sidebar and no hero number. Keeps the phone's proportions and gains a second column: the promise on the left, the sign-in card on the right, centred vertically, flush left inside its own half.
- **Tablet** — pot cards compress to single rows (dot, name, value, change) rather than the phone's full cards.

Copy shifts with the pointer: "Tap any holding" becomes "Click any holding", "Blur totals until you tap" becomes "until you click", "Follows your phone" becomes "Follows your computer", and "took your phone" becomes "took your laptop".

Safe areas are respected; the phone tab bar carries bottom padding for the home indicator.

---

## 9. Still undesigned

Everything from the first round has been answered. Outstanding:

- **Loading, empty and error states at tablet and desktop.** The handover draws all of them at phone width only. They'll be built from the phone states in the desktop grid.
- **The desktop connect-account flow.** Only phone cards exist for it.
