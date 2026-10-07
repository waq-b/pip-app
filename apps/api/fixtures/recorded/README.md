# Recorded provider responses

Real responses captured on 2026-09-16 , for tests to replay — tests never call a network (design rule 6).

- `t212/` — a Trading 212 **practice** Stocks ISA holding Nvidia, Greggs, ASML (Amsterdam) and Vanguard FTSE All-World (LSE). GET requests only. Account, order and fill ids are replaced with placeholders, transaction references and pagination cursors are masked. Amounts are practice money. `instruments-sample.json` and `exchanges-sample.json` are trimmed to the instruments and schedules above.
- `yahoo/` — the unofficial chart endpoint, `range=1d&interval=5m`, for the same instruments plus Rolls-Royce, VWCE (Xetra) and GBP/USD, GBP/EUR.
- `alpha-vantage/` — quote, daily series, FX daily and symbol search. The API key is not in any file.

Kept byte-for-byte as returned (bar anonymisation), so they're excluded from Prettier. Re-record rather than hand-edit; scan for keys and real ids before committing.

Added 2026-09-16 :

- `kraken/` — Kraken spot REST. Private calls (`GetApiKeyInfo`, `BalanceEx`, `Ledgers`) from a read-only key on an **empty** account, so balances and ledger are empty; key, key name and IBAN replaced with placeholders. `permission-denied.json` is a method the key lacks; `invalid-key.json` is an unknown key. Public `Ticker`, `Assets` (sample) and daily `OHLC` for XBT/GBP (trimmed to the last 40 candles).
- `coingecko/` — Demo API: `simple/price` in GBP, `market_chart` for 1 day and 365 days daily, the error for asking beyond 365 days, and a 12-ticker sample of `exchanges/kraken/tickers` (Kraken base asset → CoinGecko coin id). The API key is not in any file.

Added 2026-09-17 . Third-party headlines, trimmed to a handful of items per file so tests have real shapes without copying whole feeds:

- `rss/` — BBC Business, Investing.com (stock market, crypto), CoinDesk, CoinTelegraph and Nvidia's investor-relations releases feed. First 5 items each; CoinDesk's `content:encoded` bodies replaced with `trimmed`.
- `google-news/` — Google News RSS searches `<name> when:7d` (`hl=en-GB&gl=GB&ceid=GB:en`) for Greggs, ASML and "Vanguard FTSE All-World", first 8 items. Each item's publisher is in `<source url>`; titles end " - <Publisher>"; links are Google redirect URLs.
- `alpha-vantage/news-*.json` — `NEWS_SENTIMENT` for NVDA, ASML and `CRYPTO:BTC` (feeds trimmed to 5) and the error for an LSE ticker (`GRG.LON`). `earnings-calendar-3month-sample.csv` — the CSV header, first rows and ASML's row.
- `marketaux/` — `news/all` for NVDA, GRG.L, ASML, VWRL.L, CC:BTC and all five together (free plan: 3 articles a request, `published_after=2026-09-10`). The API token is not in any file.
- `groq/` — chat completions with strict `json_schema` from `openai/gpt-oss-120b` and `openai/gpt-oss-20b` on prompt v1 with ASML facts (messages omitted; response and usage kept).

All files were inspected for keys, ids and personal data before publishing: the Kraken key, key name and IBAN are placeholders, Trading 212 account and order ids are placeholders, and Groq request ids are placeholders. The Trading 212 holdings are from a practice account with practice money.
