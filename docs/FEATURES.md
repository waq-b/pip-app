# Features

Living doc. Every screen, rule, alert, and state the app has — written for a human, not a compiler. Last updated: Phase 0.

## Current state: Phase 0 ships no user-facing features

Phase 0 is scaffold only. `apps/web` renders a single placeholder screen:

- **Placeholder screen** (`apps/web/src/App.tsx`)
  - Shows the app name and a "Phase 0 scaffold placeholder" message
  - Lists the three buckets (Base, Medium, Degen) pulled from `@finance-app/shared`, proving the shared package wires up correctly
  - No routing, no real data, no interactivity
  - Single state — no loading/error/empty variants, because there's nothing to load yet

`apps/api` exposes one route:

- **`GET /health`** — returns `{ status: "ok" }`. No auth, no DB call. Used by CI/ops to confirm the server boots; will also be the target of Phase 7's ntfy health-check alerting.

## Phase 1 so far: a locked door, no rooms yet

The product has a name and a signed-off design — **Pip**, "Three pots. One number. No homework." See `docs/DESIGN.md` for what every screen will look like and `docs/phases/phase-1.md` for the order they arrive in. None of them are built yet.

What does work, all of it server-side:

- **Google is the only way in**, through Supabase. Being known to Google isn't enough: your email has to be on Pip's allowlist, and an empty allowlist admits nobody at all.
- **Two checks on every request.** Without a valid sign-in the API answers "not signed in"; signed in but not on the list, it answers "not on the list". The only thing that answers without either is the health check, and a test walks the real route table to prove nothing else has slipped through.
- **Removing someone works straight away.** The allowlist is checked on every request, not just at sign-in.
- **Staying signed in** follows Supabase's defaults: a short-lived token that the app refreshes while you use it. If a sign-in stops being accepted, Pip signs you out cleanly rather than leaving you stuck.
- **Asking to be let in.** Someone turned away is still signed in, so they can put themselves on the waiting list. Pip takes the address from their sign-in, so there's no form to fill in and no way to submit somebody else's. Asking twice is harmless.
- **No promises are made.** No queue position, no countdown, no "we'll email you" — there is no email system. Waqar grants access by hand.
- **Access is granted by hand**, with `pnpm --filter api allowlist add <email>`. There is no self-service sign-up, by design.

## What the API can already tell you

All of it from fixtures, all of it behind sign-in. No screen renders it yet.

- **Everything you own**, as one total, with what it did today, this month, or since you started — and the money alongside every percentage, never a bare percent.
- **A verdict line** that says "nothing needs you" only when that's true. Side Bet is over its cap in the sample data, so the line names it instead.
- **Each pot**: what it's worth, how it's gone with a sentence explaining the chart, six months of money in, and what's inside it.
- **Each holding**: its price, what it's worth to you, today and since you bought, and a plain-English note on what the company actually does.
- **Your rules**: the 70/25/5 targets, where each pot actually sits, and how far over the line Side Bet is — £208, not just 1.8%.
- **What changed** last week, and **which account feeds which pot**.
- **How current the prices are**, per pot, which is what the amber and red states will read.
- **Connecting an account.** Paste a key and Pip tells you one of three things: it's connected and can only look, it doesn't recognise the key, or the key can do too much. A key that can trade or withdraw is refused outright and never stored — Pip won't hold a key that could move your money, even if you want it to. Nothing at all is stored in this phase.

The sample data has one correction from the design: the prototype showed ISA money buying Rolls-Royce, which lives in the Invest pot. Money never crosses pots here.

## The app so far: the frame, not the pictures

The web app has its colours, fonts and layout. Sign-in, the refusal screen, the Pots home screen and pot detail are built (see Screens built); holdings, Rules and Setup are still placeholders.

- **Three places to go**, the same at every size: **Pots**, **Rules** and **Setup**. On a phone they sit along the bottom; on a tablet they become a narrow rail of icons down the left; on a computer that rail widens into a sidebar with labels, the Pip mark, and a permanent "Read-only access" badge.
- **You always know where you are.** The current section is lit — and Pots stays lit while you're inside a pot or looking at a single holding, because those live under it.
- **A red dot on Rules** appears when a cap has been broken. It is the only red in the app's chrome, and only Side Bet can cause it. (It isn't wired to real data yet.)
- **Wide screens don't get stretched.** Content stops at a comfortable width and the rest is plain background — no widgets, no ticker, no filler.
- **Light or dark follows your device**, until you choose otherwise.
- **Sign-in stands alone**, with no navigation around it, because there's nowhere to go until you're in.

## Screens built

- **Sign in.** The promise first — "Three pots. One number. No homework." — then one button, Continue with Google, and a line saying Pip reads your name and email, nothing else. No password field. While Google answers it says "Checking you're on the list". If sign-in can't start, it says so and offers the button again. Already signed in, it sends you straight through. On a computer it gains a second column.
- **Not on the list.** For someone signed in but not allowed. It names the account back, offers "Put me on the waiting list", and confirms with "Waqar will let you know when there's room" — no queue position, no countdown, no promise of an email. "Try a different account" signs you out and returns you to sign in.
- **Pots (home).** Everything you own as one big number, pence set small, with what it did and a one-line verdict — "Up £25.80 today. Side Bet needs a look." Today, This month and All time change every figure on the screen, and the old numbers stay up until the new ones arrive. Below: the three pots — Side Bet always fenced with a hatch and a hard border, and red only when it's over its cap — then how the money splits against the shape you asked for ("You asked for 70 / 25 / 5. You're at 72 / 21 / 7."), then what changed last week, ending "That's the lot." A line names where prices come from. It ends by saying Pip can't trade. While loading it shows the numbers' shape rather than a spinner; with nothing in any pot it says so and points you to connect an account; if it can't load, it says your money is fine and offers a retry. On a tablet the pots become single rows; on a computer they sit side by side, and "The shape you asked for" appears beside what changed.
- **A pot.** Its name and badge (Autopilot, Yours, Capped), what it's worth and what it did, and a plain-English line about what kind of money this is. Then how it's gone, with a sentence saying what the line did; what went in each of the last six months, a month with nothing showing as a faded stub; and what's inside, as one shaded bar and a sortable list of holdings — pounds before every percentage, each row opening that holding. It ends by naming where you'd actually buy or sell (Trading 212 or Kraken), because Pip can't. Side Bet stays fenced. With no history, the value stays put and only the chart is replaced; an empty Side Bet says that's a perfectly good place to leave it; an unknown pot says there are three. On a computer the sidebar lists all three pots under Pots, and the holdings list gains its fourth column.
- **Where you land.** Signed out, any page sends you to sign in. Signed in but not allowed, you land on the refusal screen. If Pip can't be reached at all, it says so and reassures you your money is fine.

## The pieces screens are built from

None of these appear on a screen yet, but they decide how every number will read:

- **Money always comes first.** Anywhere a change is shown, it reads "+£25.80 · +0.23%", never "+0.23%" on its own. That includes the holdings table, where the design prototype showed bare percentages — Pip is stricter than its own mockup here.
- **The big number** sets the pence smaller so the pounds carry the weight, and never rounds your money up.
- **A cap you've broken turns red; a target you've drifted past doesn't.** Being 2% over your Foundation target is shown calmly. Side Bet over its cap is red, hatched, and says how much in pounds.
- **Every chart has a sentence** saying in plain English what the line did. If there isn't enough history to draw one, it says so instead of drawing something misleading.
- **A month with nothing paid in** shows as a small faded bar, so it reads as zero rather than as missing data.
- **The holdings list** sorts by name, value or change; you tap or click a whole row to open a holding, and each keeps its colour when the order changes.

Still to come in Phase 1: the screens themselves, and the staleness ladder that turns freshness into green, amber and red. Nothing here touches real money or a real broker.
