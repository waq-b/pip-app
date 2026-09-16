# Recorded provider responses

Real responses captured on 2026-09-16 (Phase 2 task 1), for tests to replay — tests never call a network (CLAUDE.md hard line 7).

- `t212/` — a Trading 212 **practice** Stocks ISA holding Nvidia, Greggs, ASML (Amsterdam) and Vanguard FTSE All-World (LSE). GET requests only. Account, order and fill ids are replaced with placeholders, transaction references and pagination cursors are masked. Amounts are practice money. `instruments-sample.json` and `exchanges-sample.json` are trimmed to the instruments and schedules above.
- `yahoo/` — the unofficial chart endpoint, `range=1d&interval=5m`, for the same instruments plus Rolls-Royce, VWCE (Xetra) and GBP/USD, GBP/EUR.
- `alpha-vantage/` — quote, daily series, FX daily and symbol search. The API key is not in any file.

Kept byte-for-byte as returned (bar anonymisation), so they're excluded from Prettier. Re-record rather than hand-edit; scan for keys and real ids before committing.

Added 2026-09-16 (Phase 3 task 1):

- `kraken/` — Kraken spot REST. Private calls (`GetApiKeyInfo`, `BalanceEx`, `Ledgers`) from a read-only key on an **empty** account, so balances and ledger are empty; key, key name and IBAN replaced with placeholders. `permission-denied.json` is a method the key lacks; `invalid-key.json` is an unknown key. Public `Ticker`, `Assets` (sample) and daily `OHLC` for XBT/GBP (trimmed to the last 40 candles).
- `coingecko/` — Demo API: `simple/price` in GBP, `market_chart` for 1 day and 365 days daily, the error for asking beyond 365 days, and a 12-ticker sample of `exchanges/kraken/tickers` (Kraken base asset → CoinGecko coin id). The API key is not in any file.
