# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Phase 1 — Base UI + auth

- Added: `docs/phases/phase-1.md` — Phase 1 plan from the Claude Design handover (Pip), with scope decisions, hard-line design corrections and a 20-task breakdown (#3226664834)
- Added: design assets — `docs/design/Pip.dc.html` reference, logo mark SVGs in `apps/web/src/assets/brand/`, favicon and PWA/apple-touch icons, self-hosted Caprasimo + Figtree via `@fontsource`, `lucide-react` (#3226676914)
- Changed: `index.html` and the PWA manifest now carry the Pip name, description and cream/dark theme colours (#3226676914)
- Removed: unreferenced `apps/web/public/icons.svg` left over from the Phase 0 scaffold (#3226676914)
- Added: `docs/DESIGN.md` — product voice, pot identities, brand tokens (light/dark/per-pot), type scale, copy rules, the seven data blocks, screen inventory with every state, and the hard-line corrections to the prototype (#3226691677)
- Changed: `.prettierignore` now covers `docs/design/`, so the design handover is never reformatted
- Changed: second design handover — `docs/design/Pip.dc.html` updated with desktop/tablet layouts, the mark at icon sizes and the amber staleness state (#3226676914)
- Added: small-cut logo `pip-mark-small.svg` (16–48px geometry); favicon rebuilt on it; maskable icon rebuilt as the terracotta plate with the reversed mark (#3226676914)
- Changed: `docs/DESIGN.md` rewritten — amber state tokens and the staleness ladder, three breakpoints with the sidebar/rail navigation, the desktop four-column table, and both icon cuts (#3226691677)
- Changed: `docs/phases/phase-1.md` replanned for the second handover — responsive work folded in, task list now 22 items (#3226664834)
- Added: `BUCKET_META` in `packages/shared` — display name, accent scope and provider per bucket id, so UI names never reach the API or database (#3226691676)
- Added: `packages/shared/src/api.ts` — response types for portfolio, bucket detail, instrument detail, rules, activity, connections and the connect flow, with money as integer pence and per-pot `PriceFreshness` (#3226691676)
- Added: `docker-compose.yml` — local Postgres 17 for development, serving the `DATABASE_URL` in `.env.example` (#3226691746)
- Added: Auth.js tables (`accounts`, `sessions`, `verification_tokens`) and `waitlist` to the Drizzle schema; `users` gains the profile columns Auth.js expects (#3226691746)
- Added: first generated migration in `apps/api/drizzle/`, plus `db:generate` / `db:migrate` / `db:studio` scripts (#3226691746)
- Added: Google sign-in via Auth.js — `@auth/core` mounted on Fastify by hand at `/auth/*` (there is no published `@auth/fastify`), with the Drizzle adapter and server-side database sessions (#3226677189)
- Added: the allowlist gate in `callbacks.signIn` — unverified, unlisted and email-less sign-ins are all sent to `/not-on-the-list`, so an empty allowlist admits nobody (#3226677189)
- Added: `AllowlistStore` and `SessionStore` interfaces with Postgres and in-memory implementations, so auth tests never open a socket (#3226677189)
- Added: 12h idle session expiry plus a 7-day absolute cap via a new `sessions.created_at` column and `isLive()` (#3226677189)
- Added: `pnpm --filter api allowlist <list|add|remove>` CLI, the only way to grant access (#3226677189)
- Fixed: `apps/api` ran every test suite twice, the second time against stale compiled output in `dist/`; vitest now excludes it (#3226677189)
- Added: global session guard — an `onRequest` hook on the root instance, so every route is protected by existing; only `/health` and `/auth/*` are exempt (#3226677090)
- Added: route-coverage test that walks the real route table and asserts every non-exempt route answers 401 without a session, failing rather than passing vacuously if the table is empty (#3226677090)
- Added: `useSecureCookiesFromEnv()` so the guard and the Auth.js config can't disagree about the cookie name (#3226677090)
- Added: waitlist signup — a rejected sign-in mints a 15-minute HMAC token carrying the Google-verified address, and `POST /waitlist` takes the email from inside that token rather than the request body (#3226682602)
- Added: `WaitlistStore` with Postgres and in-memory implementations; asking twice is idempotent and keeps the first ask (#3226682602)
- Changed: `/waitlist` joins `/health` and `/auth/*` as a session-free path, gated by its own signed token; the route is not registered at all when no `AUTH_SECRET` is configured (#3226682602)
- Added: `market/market.ts` — the market-data interface (price, series, per-pot freshness), kept separate from trading providers so no price ever comes from a trading API (#3226691678)
- Added: `market/stub` — deterministic prices seeded by instrument id, so fixtures, tests and screenshots agree, with per-pot staleness overrides (age, outright failure, markets closed) to exercise the amber/red ladder (#3226691678)
- Added: read routes — `/portfolio`, `/buckets/:id`, `/instruments/:id`, `/rules`, `/activity`, `/connections`, composing what is held (trading layer) with what it's worth (market layer) (#3226676894)
- Added: the design's sample data as fixtures, with the hard-line corrections applied at source — no copy implies Pip moves money, and no entry crosses pots (#3226676894)
- Changed: trading provider fixtures rebuilt with the real holding set, and provider money moved from floating-point pounds to integer pence to match the API types (#3226676894)
- Changed: current prices now come from the market layer rather than the trading fixtures, with each generated series anchored to end at that price, so hard line 8 holds structurally and not just by convention (#3226676894)
- Fixed: `Timeframe` was defined in the shared API types but missing from the package's exports (#3226676894)
- Fixed: stub provider threw at import — `HISTORY` was built from `MONTHS` before that const was initialised (#3226676894)
- Added: `POST` / `DELETE /connections/:provider` — the full connect flow against a handler that inspects the key and stores nothing, ready for Phase 2 to swap in real validation behind the same responses (#3226677039)
- Added: outright refusal of any key carrying a trade or withdraw scope, enforced in the API rather than the UI (#3226677039)
- Changed: `docs/ARCHITECTURE.md` freshened — header, docs tree, and the `app.ts` description were still describing Phase 0 (#3226677039)
- Removed: `docker-compose.yml`. Postgres is hosted in every environment (Neon or Supabase, with its own development database), so there is no local server and no Docker — one `DATABASE_URL` is the whole story (#3226691746)
- Added: web foundation — every DESIGN.md token as Tailwind v4 theme variables (light, dark, the three pot scopes, amber), self-hosted fonts, router, query client and a same-origin API client (#3226691561)
- Added: appearance that follows the device until someone chooses, stored per device and wrapped so a browser that refuses storage still themes correctly (#3226691561)
- Added: Vite dev proxy for the API's paths, so the session cookie stays same-origin instead of being dropped as cross-site (#3226691561)
- Added: responsive app shell — bottom tab bar under 768, a 76px icon rail from 768 with content capped at 640, a 232px labelled sidebar from 1120 with content capped at 1080 (#3227556742)
- Added: the red alert dot on Rules at every width, and the "Read-only access" badge in the desktop sidebar (#3227556742)
- Added: `PipMark` component that picks the small cut below 48px, which the rail and sidebar need (#3227556742)
- Added: `pointerWords()` so screens say tap on a phone and click elsewhere, and phone/computer to match (#3227556742)
- Added: a `matchMedia` stub in the web test setup, since jsdom has none (#3227556742)
- Fixed: Pots went dark on pot and instrument detail — `NavLink` overwrote the `aria-current` it was given with its own route match; active state now comes from each destination's `matches` at every width (#3227556742)
- Fixed: the mark and the Rules alert dot were hard-coded to light-mode hex values, so neither changed palette in dark mode; both now read `--pip-seed-*` and `--pip-alert` tokens (#3227556742)
- Added: a test that fails if a hex colour appears in the shell's components, reading their source via Vite's `?raw` so it needs no Node APIs (#3227556742)

### Phase 0 — Scaffold

- Added: pnpm workspace root — `pnpm-workspace.yaml`, root `package.json`, shared `tsconfig.base.json`, ESLint 9 flat config, Prettier, `.gitignore`, `.env.example` (#3226662417)
- Added: `apps/web` — Vite + React 19 + TypeScript + Tailwind v4 + PWA plugin, mobile-first placeholder screen rendering the three buckets from `@finance-app/shared`, Vitest + Testing Library (#3226662419)
- Added: `apps/api` — Fastify server with a `/health` route, `src/providers/provider.ts` trading-provider interface, Vitest (#3226660714)
- Added: `packages/shared` — `BUCKETS`/`Bucket` constant, consumed by both apps via `workspace:*` (#3226662418)
- Added: stub trading provider (`apps/api/src/providers/stub`) implementing `getPositions`/`getCash`/`getHistory` with fake per-bucket data, selected via `PROVIDER_MODE=stub` (#3226662452)
- Added: Postgres + Drizzle wiring in `apps/api` — `drizzle.config.ts`, lazy `DATABASE_URL` client, minimal multi-user schema (`users`, `allowlist`); no live DB touched by tests (#3226662656)
- Added: CI pipeline (`.github/workflows/ci.yml`) — install, lint, format check, test, build on every push to `main` and every PR, stub mode only, no secrets configured (#3226662384)
- Added: `docs/ARCHITECTURE.md` and `docs/FEATURES.md`, plus a `docs/DESIGN.md` placeholder blocked on the Phase 1 Claude Design handover (#3226662383)
- Added: this changelog, in keep-a-changelog format (#3226660804)
- Changed: Phase 0's DB task rescoped from SQLite to Postgres + multi-user schema to match the updated CLAUDE.md; see `docs/phases/phase-0.md`
