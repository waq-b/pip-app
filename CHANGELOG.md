# Changelog

What changed, version by version. The project was built in numbered phases, which is why "Phase N" shows up in the docs and code comments. The version numbers below are release markers only: the packages themselves stay at `0.0.0`.

Pip is currently paused (see the README), so the last section is unreleased.

## Unreleased: Phase 6, notifications and ops

- **Notifications.** A bell on every screen, with the last 30 days of what Pip told you. Web push through Pip's own service worker, with a first-login sheet that asks once. Email through Resend.
- **Side Bet limit alerts.** Side Bet now has a limit in pounds instead of a percentage cap: 10% of your net assets (or a flat starter limit until you set them), judged on money in less money taken out over 12 months, so a price move can't put anyone over it. Alerts at 80% and 100%, each sent once.
- **Net assets.** A sealed, optional figure on Setup that sets Side Bet's limit. It never appears in an email or on a lock screen.
- **Urgent notes and recommendations.** Daily notes become urgent when a holding moves twice its pot's big-move line, or several independent publishers report on it within a day. For users with personal research switched on, Pip can also recommend a course (hold, take some profit, rebalance) with the reasoning and the trade-off. The course and every amount come from code; the model only explains.
- **Monday email.** The week's digest as an email, plus a "Your week is ready" push.
- **Ops without a pinger.** Pip is allowed to sleep on a free host, so nothing pings it. Every job step records a `job_runs` row, and a `pg_cron` check inside the database emails the operator when work is stale, failed or never happened.
- **One LLM request per build.** The week's news notes, the reasons in recommendations and the opening line are requested together, so Groq's per-minute limit isn't hit on a Monday.
- **Sign-in by code.** Email sign-in is an 8-digit code typed into the app, because an emailed link opens in a different browser from an installed PWA.
- **Update splash.** A launch splash checks for a new version before showing the app.
- **Fixes.** Failed pushes and LLM fallbacks are logged with a reason that never contains a key or the note's words. A push-delivery bookkeeping bug on Postgres. The freshness check no longer judges prices before the day's first refresh has run. Several tests that depended on the real clock now pin it.
- Added `packages/emails`: Pip's email templates as pure renderers returning subject, preheader, HTML and plain text.

## 0.5.0: Phase 5, research and "Your week" (2026-09-17)

- **Facts layer.** News and results dates for what you hold, from Google News RSS, Marketaux, Alpha Vantage and a few RSS feeds, with per-source daily budgets and aliases for matching.
- **Trust rules.** Deterministic checks on what may be said at all: named publishers, recency, independent sources, quiet around results, exclusions. Users set their own on Rules.
- **The research module.** It is handed values and hands back text, and nothing else: a test fails if it imports anything outside its folder or reaches the network, environment or filesystem. An output guard rejects forecasts, price targets and amounts and falls back to Pip's own template.
- **Your week.** A weekly build (Mondays) and daily notes, each logged with its facts, checks and outcome. A card on Pots and a `/week` screen.
- **Profile and plan.** Goals, horizon and exclusions, stored per user.
- **Outcomes.** What happened to a holding after a note, measured 7 and 30 days later.
- LLM is Groq only, with strict JSON schema output.

## 0.4.0: Phase 4, rules engine (2026-09-16)

- A pure rules engine: Foundation and Handpicked targets with a 5-point drift threshold, a cap on Side Bet, targets scaled over connected pots, and the two amounts that would fix a broken rule.
- Saving rules with server-side limits and own-row Row Level Security. Every screen reads the same engine.
- Rules are set with sliders and one Save button.
- A Trading 212 account can only feed one pot.

## 0.3.0: Phase 3, Kraken, read-only (2026-09-16)

- A read-only Kraken client (key info, balances and ledger only), signed requests, ordered nonces and retries.
- Pip checks the key's permissions on connect and on every poll, and refuses a key that can trade, withdraw, deposit or earn.
- Crypto prices from CoinGecko with Kraken's public endpoints as fallback.
- Side Bet's history and cost are rebuilt from the Kraken ledger.

## 0.2.0: Phase 2, Trading 212 practice accounts and market data (2026-09-16)

- AES-256-GCM encryption for provider keys, bound to user, provider, account and field, with key versions and a re-seal tool.
- Row Level Security as a second wall: user reads run in a transaction as the signed-in user.
- A read-only Trading 212 client (practice environment), polling, and history rebuilt from order history.
- Market data from Yahoo and Alpha Vantage with a shared price cache, market hours and daily call budgets.
- A scheduled refresh job triggered by `pg_cron`.
- Production serving from a single origin, and the first deploy to Render.
- A GitHub Actions workflow that keeps the free Supabase project from pausing.
- Recorded, anonymised provider responses used as test fixtures.

## 0.1.0: Phase 1, the app shell and auth (2026-09-16)

- The whole UI against stub data: Pots, pot detail, holding detail, Rules, Setup and sign-in, at phone, tablet and desktop sizes, in light and dark.
- Design tokens, self-hosted fonts, the seven data blocks, and the staleness ladder.
- Supabase Auth with an allowlist: the API verifies the token on every route and checks the allowlist. The server refuses everyone if it has no verifier.
- A test that walks the route table and asserts every non-exempt route answers 401 without a session.

## Phase 0: scaffold

- pnpm workspace, TypeScript, ESLint, Prettier, Vitest, the stub trading provider, the Drizzle and Postgres wiring, and the CI workflow.
