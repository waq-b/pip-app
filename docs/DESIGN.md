# Design

The developer's translation of the Claude Design handover. Once signed off, this file — not the prototype — is the visual source of truth. Where the two disagree, this file wins and the prototype is treated as an earlier draft.

Reference prototype: `docs/design/Pip.dc.html` (built on the Organic design system), plus `docs/design/Pip-s10-s11.dc.html` for the third handover. Last updated: Phase 6 planning, third handover (§10 notifications, §11 net assets) — §10–11 signed off by Waqar 2026-09-17.

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

Amber has **three uses**: the provenance line and the age chip (§5), and a chip meaning **needs setting up, not wrong** — e.g. NOT SET on net assets (§11), added Phase 6.

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

For staleness, amber appears in exactly two places: **the provenance line** and **a small age chip beside an affected figure**. (Its only other use is the "needs setting up" chip, §2.) It never touches the hero number, never tints a card, never draws a border. It is a dot, a line of text, and a chip.

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
2. **Rules is display-only in Phase 1.** The desktop Rules screen still shows +/− steppers and the banner still carries "Show me how to fix it" and "Raise the cap". Phase 1 renders the banner with neither button and no steppers; both arrive in Phase 4. Hard line 1. **Phase 4:** the prototype's steppers became sliders (Waqar: taps were slow, sliders suit phones and tablets), on Handpicked's target and Side Bet's cap only (Foundation is the rest), with one explicit Save — no save per change; "Show me how to fix it" opens two amounts at equal weight, never a recommendation; "Raise the cap" only focuses the cap slider. Neither can move money.
3. **Nothing says Pip moves money.** Any remaining copy implying Pip routes money is rewritten as a statement about the user's own setup at their broker. Hard line 1.
4. **Fixtures never cross pots.** The feed still says "£60 of your ISA bought Rolls-Royce", but Rolls-Royce is Handpicked (Invest), not the ISA. Hard line 11.
5. **"Nudge me" is omitted** (notifications are Phase 6) — it reappears in the desktop Setup screen. Currency shows as fixed GBP. **Phase 6:** replaced by the bell and the first-login ask (§10); the old "Nudge me" row is not built.

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
- **Phase 6 — built from existing patterns, for the next design handover** (Waqar, 2026-09-17: don't wait):
  - the bell at tablet width (proposed at the foot of the rail)
  - Setup's Notifications section (per-kind toggles, this-device row, email, "Pip last checked")
  - the recommendation brief card ("Pip's take" block on the `/week` note card)
  - Rules' Side Bet card without its slider (money in, less taken out, against the limit; growth line)
  - Rules' Handpicked card as the only slider, Foundation as the rest
  - the starter-limit soft reminder on Rules
  - the connection-gap row in the bell
  - net-assets entry as a keypad field with the stepper

---

## 10. Notifications — the ask and the bell (Phase 6)

From the third handover. The design's premise holds: a notification is rare enough to mean something, and "nothing since Tuesday" is the normal state. **Where it disagrees with the Phase 6 brief or CLAUDE.md, §10.6 lists the conflict and what this file proposes; nothing there is settled until Waqar signs off.**

### 10.1 New tokens and components

No new colour tokens. Everything uses the existing theme and pot scopes.

| Component            | Spec                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Switch**           | 42×25 track, `999px`, 20px knob inset 2.5px, knob slides `left` 2.5 → 19.5px over 140ms (the one new motion). On: track `solid`, knob `solidInk`. Off: track `rgba(ink,.18)` light / `rgba(ink,.20)` dark. Desktop popover: 38×23 with an 18px knob. The whole row is the tap target; the switch carries `role="switch"` and `aria-checked`. |
| **Bell button**      | 40px circle, `card` fill, Lucide `bell` at 20px. Desktop: 38px with a 2px `acc` ring, 19px icon.                                                                                                                                                                                                                                             |
| **Unread badge**     | 16px pill on the bell's top-right (6px/7px in), 10px/800 figure, 2.5px `card` ring; fades 150ms when read. Fill `solid`, figure `solidInk` — red stays Side Bet's.                                                                                                                                                                           |
| **Notification row** | 9px dot + title (13.5–14px/700) + body (12.5px, `ink2`) + meta "2 hours ago · Side Bet" (11px, `ink3`). Padding 13×12, radius 20px (18px desktop). A Side Bet row sits in the `bet` scope on `tint`. Unread shows the dot; read hides it. Whole row taps through.                                                                            |
| **Row dot colours**  | Side Bet → `acc` in `bet` scope; stale connection → `ambDot`; Foundation/good news → `fnd` `acc`; read/neutral → `line`. **Tokens only** — the prototype hardcodes `#7a8a5e` and `#c0392c`.                                                                                                                                                  |
| **Ask sheet**        | Bottom sheet over a `rgba(ink,.28)` scrim: `card`, radius `28 28 26 26`, padding 24/20/20, gap 14, shadow `0 -14px 40px rgba(ink,.18)`. Lucide `bell` 26px in `acc`, Caprasimo 24px question, 13px body, two switch rows, primary button (left-aligned label, `solid`), a text "Not now", 11px footnote.                                     |
| **Panel (phone)**    | Over a `rgba(ink,.30)` scrim: top 92px, 14px side insets, `card`, radius 28px, max-height 566px, scrolls inside. Header: Caprasimo 21px "Notifications" + "Mark all read" (12.5px/700, `solid`, hidden when nothing is unread). Grouped "Today" / "This week" / "Earlier" section labels. Foot: switch rows and an 11px footnote.            |
| **Popover (≥ 1120)** | 382px, anchored 66px down under the bell at the content header's right, radius 24px, shadow `0 0 0 1px line, 0 26px 60px rgba(ink,.26)`. **No scrim** — the board stays visible. Same list, same switches, same order.                                                                                                                       |
| **Empty mark**       | `pip-mark-empty.svg` — the standard cut as dashed outlines (2.5 stroke, `5 4` dash) at 50% opacity, 30px. New asset.                                                                                                                                                                                                                         |

Icons are Lucide: `bell`, `bell-off`. Stroke **2.75** as everywhere else (the prototype draws 2.4).

### 10.2 First login — step 1 of 2: the ask

Shown once, over Pots, after the first sign-in that has at least one connection (so there is something behind it).

1. **Pip asks first.** Sheet: "Want Pip to tell you when something matters?" / "Most weeks it won't. Pip only speaks up when something you set a line for is crossed." Two switches, both on by default:
   - **Push alerts** — "When Side Bet nears its limit, or something can't wait for your week."
   - **Weekly email** — "Monday morning: one number, three pots, what moved."
   - Primary button: "Turn these on" (both on) · "Turn on email only" · "Turn on alerts only" · "Save" (both off). The prototype's CTA text was lost in the export; these are Pip's wording.
   - "Not now".
   - Footnote: "Both live in the bell afterwards."
2. **Then the phone asks.** The OS permission prompt fires **only** from the primary-button tap when Push alerts is on — never on a maybe, and on iPhone only inside the installed app (a Safari tab gets the Add to Home Screen row instead, §10.4).
3. **"Not now" is a real answer.** Bell-off icon, "Fine. Pip will stay quiet." / "Nothing is pushed and no email goes out. The bell still keeps the list." / chip "Notifications off · the bell still works". The sheet never reappears.

Step 2 is net assets, §11.2.

### 10.3 The bell

- **Where:** phone — top-right of the page header, beside the Pip mark, on every screen. Tablet — at the foot of the 76px rail above Setup (undesigned, §9). Desktop — on the right of the content header; identity stays in the sidebar.
- **Badge:** unread count; none when zero.
- **The list:** the last 30 days of what Pip told you — limit alerts, urgent notes, recommendations, "Your week is ready", and connection gaps ("Kraken went quiet for 3 hours", shown here, never pushed) — newest first, grouped Today / This week / Earlier. Tapping a row opens where it came from (Rules for the limit, `/week` for notes and the week) and marks it read.
- **Foot switches:** Push alerts and Weekly email, mirrored in Setup — "neither is the real one". The push subtitle reads this device's state ("On for this iPhone", "Off", "Blocked in your phone's settings", "Add Pip to your Home Screen first"). Turning push off never clears the list.
- **Empty:** dashed mark, "Nothing since <day>" / "Which is the normal amount. Pip will be here when something actually happens."
- Loading: three skeleton rows. Error: one line, "Couldn't load your notifications" with Try again; switches still work.

### 10.4 Setup — Notifications (mirrors the bell)

Not drawn in the handover; built from Setup's existing card and row patterns with the new switch:

- **Push alerts** master, then per-kind (indented, disabled while the master is off): **Side Bet's limit** · **Urgent notes and Pip's take** · **Your week is ready**.
- **This device:** On · Off · Not supported · Blocked in settings · "On iPhone and iPad, add Pip to your Home Screen first: tap Share, then Add to Home Screen, then open Pip from there." A "Turn on for this device" button where permission can be asked. A dropped subscription shows "Notifications stopped on this device" and the button again. That is the re-ask; the sheet never returns.
- **Weekly email** on/off, with the address it goes to.
- **Pip's jobs:** "Pip last checked prices and news 12 min ago" (plan decision 10).

### 10.5 Push payloads

The OS draws them: Pip's icon and name, a title, a body. Same copy rules as the list rows — pounds first, no buy/sell for anyone but a `personal_research` recommendation (§10.7), never a forecast. Tapping opens the matching screen and does nothing else. Pushes: `limit`, `urgent` (urgent notes and recommendations R1, R2, R4), `digest`.

### 10.6 Corrections to the prototype (decided, Waqar 2026-09-17)

**Build these, not the prototype.**

1. **Monday email**, not Sunday. The week build doesn't move.
2. **Two masters in the bell, per-kind toggles in Setup.**
3. **What earns a push is the brief's list**, not the design's: Side Bet's limit (80% / 100%), urgent notes and recommendations (R1, R2, R4), "Your week is ready". Not pushed: target drift, connection gaps (bell list only), milestones (not built — a new feature). The design's "No: daily price moves" and "No: anything about a single holding" explainer isn't shipped.
4. **No copy implying Pip knows or moves money** (hard line 1): "Your standing order at Kraken is already paused" and "it says what your broker already did" are cut. "Side Bet crept 1.8% over its 5% cap" becomes pounds against the limit.
5. **"Nothing it could tell you ever needs an urgent decision"** — cut.
6. **The sheet is asked once**; a dropped subscription is re-asked by the device row, not a second sheet.
7. **Unread badge in `solid`**, not red.
8. **Desktop header** carries the bell only; identity stays in the sidebar.
9. **The list** reads the nudge log, limit alerts and connection gaps — no separate history.
10. **Fixtures** use Pip's own providers and the sample user — no Coinbase, no real-looking Gmail address, no milestone.
11. **Row dots are tokens**, icon stroke 2.75.

### 10.7 Recommendations in the list and pushes

Not in the handover. A recommendation (hard line 12, `personal_research` only) shows as a row titled with the fact ("Nvidia is worth 3.2× what you put in") and opens its brief on `/week`: the fact, **Pip's take** (hold / take some profit / rebalance, with the amount in pounds from code), why, the trade-off, "Your call." Built from the existing `/week` note card with a "Pip's take" block; no new visual component until one is designed.

---

## 11. Net assets — the number that sets the limit (Phase 6)

From the third handover. Net assets replace Side Bet's cap slider: Side Bet's limit is **10% of net assets, in pounds**, against **money put into Side Bet over the last 12 months** (agreed with Waqar, phase-6.md). The design predates part of that agreement; §11.5 lists the gaps.

### 11.1 Components

| Component             | Spec                                                                                                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sealed figure**     | Label (11px uppercase `.1em`, 700, `ink2`), "£" then the figure in Caprasimo 22px. Hidden shows `••••••` at `.22em` tracking in `ink2`. Lucide `eye` / `eye-off` in a 44px tap target at the right. Never pre-filled into the DOM while hidden.            |
| **Stepper**           | Two 46×44 pills, 1.5px `line` border on `bg`, "−" / "+" 15px/800, beside a number-keypad field (`inputmode="numeric"`, whole pounds, formatted with commas as you type). Steps of £5,000; "nearest thousand is fine".                                      |
| **Limit card**        | `bet` scope on `tint`, radius 20px, padding 14: label "Your Side Bet limit", figure Caprasimo 27px in `aink`, 12px note at 86%. **The figure is masked (`••••`) whenever net assets are** — it gives them away ×10 — and shows only while the eye is open. |
| **Setup row — set**   | Lucide `lock` 18px `ink2`, "Net assets", "Change" link; masked figure with the eye; "Hidden by default, like a password. Last reviewed 12 Sep — Pip will ask you to check it once a year."                                                                 |
| **Setup row — unset** | `lock` and a **NOT SET** chip (`ambTint` / `amb`, 10px/800) — the "needs setting up" amber (§2); body copy; primary "Add my net assets".                                                                                                                   |
| **"What it sets"**    | Rows with a hairline between: limit, money in over 12 months, today's value. 17px Caprasimo figures.                                                                                                                                                       |

### 11.2 First login — step 2 of 2

Asked at the end of first login, never the start. Card on `bg`:

- Lucide `lock` 26px in `acc`. Caprasimo 24px: "Roughly, what are you worth all in?"
- "Pip uses this for one thing: Side Bet's limit. The FCA's guide for high-risk investments is no more than 10% of your net assets — home, pension, savings, the lot."
- Sealed figure + entry, then the limit card: "Your Side Bet limit" / "£6,400" / "10% of what you entered. Pip counts money in, less taken out, over 12 months against it." (figure masked with net assets)
- "Save and show me my money" · "I'd rather not say".
- "Skip it and Pip uses a £350 starter limit until you add it. Nothing is ever sent to your brokers, and this figure never appears on the home screen."

### 11.3 Setup — Net assets

- **Set:** the sealed row, then "What it sets": **Side Bet limit · 10% of net assets** £6,400 · **Money in, less taken out · last 12 months** £780 · **Side Bet today** £910. Footnote: "Pip can't stop a purchase — it tells you where the limit sits. It only counts Side Bet, not high-risk investments you hold elsewhere."
- **Not set:** "Until you add it, Pip uses a **£350 starter limit** for Side Bet." · "Add my net assets". A soft reminder elsewhere — one calm line on Rules' Side Bet card: "Starter limit — add your net assets in Setup" (undesigned, §9).
- **Yearly:** 12 months after "last reviewed", the row carries the reminder and a bell entry: "Time to check your net assets — it's been a year."
- **"Why dots"** explainer kept; "One figure, one purpose" kept, rewritten: "Pip uses it only for Side Bet's limit."

### 11.4 Rules — Side Bet card

Not redrawn in the handover. The slider goes. The card keeps the fence and hatch and shows money in, less taken out, over 12 months against the limit on the progress + cap bar (§7), "£780 of £6,400". Growth past the limit in value is a calm line, never red: "Side Bet has grown to £910 — more than you put in. That's good news." If its value passes 10% of net assets, Waqar also gets a recommendation (R1, phase-6.md decision 14). Handpicked's target is the only slider; Foundation is the rest; Side Bet sits outside the shape.

### 11.5 Corrections to the prototype (decided, Waqar 2026-09-17)

1. **"The FCA's 10% guide"**, never "legally capped", "legal ceiling" or "the law"; "ceiling" becomes "limit".
2. **£350 starter limit**, not a £2,000 floor.
3. **One limit.** No "your own cap · 5% of the portfolio" beside it.
4. **Measured on money in, less taken out, over 12 months** (net of withdrawals — taking profit out frees room). Value is the calm growth line.
5. **Number keypad plus stepper.**
6. **Amber NOT SET chip allowed** — the third amber use, "needs setting up, not wrong" (§2).
7. **The limit is masked with net assets** and shows only while the eye is open.
8. **Eye toggles**, and re-hides on leaving the screen.
9. **"Your Kraken standing order is paused"** — cut (hard line 1).
10. **"Pip never uses it to size a suggestion"** becomes "Pip uses it only for Side Bet's limit."
