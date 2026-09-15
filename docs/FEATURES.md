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

Nothing else exists yet. Real screens (Dashboard, bucket detail, rules, settings), Google sign-in, and every rule/alert described in CLAUDE.md arrive starting Phase 1 — see `docs/phases/phase-1.md` once it's written, and `docs/DESIGN.md` once Claude Design has handed over screens.
