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

- **Sign in with Google.** One button, no passwords. Google proves who you are; the `allowlist` table decides whether you may come in. An address nobody has allowlisted is turned away — politely, to a "not on the list" destination — and an empty allowlist admits nobody at all.
- **Unverified addresses are refused**, even if the same address is on the allowlist.
- **Staying signed in.** Sessions live in the database, not in a token. One goes stale 12 hours after you stop using it, and dies outright 7 days after it began however much you use it.
- **Everything is shut by default.** Every API route answers 401 without a session. The only exceptions are the health check and the sign-in flow itself, and a test walks the real route table to prove no other route has slipped through.
- **Asking to be let in.** Someone turned away can put themselves on the waiting list. Pip already knows the address — Google just verified it — so there's no form to fill in and no way to submit somebody else's. The ask expires if it isn't made within 15 minutes of being turned away, and asking twice is harmless.
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

The web app has its colours, fonts and layout, but every screen is still a placeholder.

- **Three places to go**, the same at every size: **Pots**, **Rules** and **Setup**. On a phone they sit along the bottom; on a tablet they become a narrow rail of icons down the left; on a computer that rail widens into a sidebar with labels, the Pip mark, and a permanent "Read-only access" badge.
- **You always know where you are.** The current section is lit — and Pots stays lit while you're inside a pot or looking at a single holding, because those live under it.
- **A red dot on Rules** appears when a cap has been broken. It is the only red in the app's chrome, and only Side Bet can cause it. (It isn't wired to real data yet.)
- **Wide screens don't get stretched.** Content stops at a comfortable width and the rest is plain background — no widgets, no ticker, no filler.
- **Light or dark follows your device**, until you choose otherwise.
- **Sign-in stands alone**, with no navigation around it, because there's nowhere to go until you're in.

Still to come in Phase 1: the screens themselves, and the staleness ladder that turns freshness into green, amber and red. Nothing here touches real money or a real broker.
