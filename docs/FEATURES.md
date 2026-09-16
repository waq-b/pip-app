# Features

Living doc. Every screen, rule, alert, and state the app has — written for a human, not a compiler. Last updated: end of Phase 2 (0.2.0).

## Where Pip is: live, on a Trading 212 practice account

**Pip** — "Three pots. One number. No homework." — is live at https://pip-old.example.net. Every screen from the signed-off design (`docs/DESIGN.md`) is built at phone, tablet and desktop sizes, in light and dark, behind a real sign-in (emailed magic link).

Connect a Trading 212 **practice** account and Pip shows what it really holds, valued with market prices, with history rebuilt from its orders — see "Real accounts" below. Kraken (Side Bet) connects with a read-only key (Phase 3); real-money Trading 212 accounts connect in Phase 7. Nothing Pip does can move money: it has no code that places an order.

Locally, `PROVIDER_MODE=stub` still runs the whole app on the design's sample data, which is what the screen descriptions below mostly describe.

The API also answers `GET /api/health` (`{ status: "ok" }`) with no sign-in, for uptime checks.

## Getting in

- **An emailed sign-in link is the only way in** for now, through Supabase — no password (Google sign-in comes later). Proving you own an email isn't enough: your email has to be on Pip's allowlist, and an empty allowlist admits nobody at all.
- **Two checks on every request.** Without a valid sign-in the API answers "not signed in"; signed in but not on the list, it answers "not on the list". The only thing that answers without either is the health check, and a test walks the real route table to prove nothing else has slipped through.
- **Removing someone works straight away.** The allowlist is checked on every request, not just at sign-in.
- **Staying signed in** follows Supabase's defaults: a short-lived token that the app refreshes while you use it. If a sign-in stops being accepted, Pip signs you out cleanly rather than leaving you stuck.
- **Asking to be let in.** Someone turned away is still signed in, so they can put themselves on the waiting list. Pip takes the address from their sign-in, so there's no form to fill in and no way to submit somebody else's. Asking twice is harmless.
- **No promises are made.** No queue position, no countdown, no "we'll email you" — the only emails Pip sends are sign-in links. Waqar grants access by hand.
- **Access is granted by hand**, with `pnpm --filter api allowlist add <email>`. There is no self-service sign-up, by design.

## What Pip can tell you

All of it from sample data, all of it behind sign-in, all of it on the screens below.

- **Everything you own**, as one total, with what it did today, this month, or since you started — and the money alongside every percentage, never a bare percent.
- **A verdict line** that says "nothing needs you" only when that's true. Side Bet is over its cap in the sample data, so the line names it instead.
- **Each pot**: what it's worth, how it's gone with a sentence explaining the chart, six months of money in, and what's inside it.
- **Each holding**: its price, what it's worth to you, today and since you bought, and a plain-English note on what the company actually does.
- **Your rules**: the 70/25/5 targets, where each pot actually sits, and how far over the line Side Bet is — £208, not just 1.8%.
- **What changed** last week, and **which account feeds which pot**.
- **How current the prices are**, per pot — see How old the prices are.
- **Connecting an account.** Paste a key and Pip tells you one of three things: it's connected and can only look, it doesn't recognise the key, or the key can do too much. A key that can trade or withdraw is refused outright and never stored — Pip won't hold a key that could move your money, even if you want it to. Nothing at all is stored in this phase.

The sample data has one correction from the design: the prototype showed ISA money buying Rolls-Royce, which lives in the Invest pot. Money never crosses pots here. The sample figures agree with themselves — a holding's percentages match its pounds, and its "All" chart starts at the price paid — and a test keeps it that way.

## Real accounts (Phase 2, Trading 212 practice)

With `PROVIDER_MODE=t212`, Pip shows your own Trading 212 practice account instead of sample data. Everything above still applies; these are the differences.

- **Your numbers come from your account and the market.** What you hold and what you paid come from Trading 212; what it's worth comes from market prices (Yahoo Finance, or Alpha Vantage if Yahoo is unavailable), converted to pounds. Trading 212's own prices are never shown.
- **Today** is measured from yesterday's close — or, for something you first bought today, from what you paid, because the rise before you bought wasn't yours. **All time** is what your investments are worth against what you paid for them (fees excluded, as Trading 212 counts it). **This month** needs a month of history; until there is one, Pip says "Not enough history yet to say how you did this month" instead of inventing a number.
- **History** is rebuilt from your order history when you connect, valued at each day's closing price, and a value is saved at every close from then on. If your order history doesn't add up to what you hold (shares transferred in, say), Pip doesn't guess: history starts on the day you connect. A pot with no past days says "History starts today — come back tomorrow."
- **Cash** in the account counts in the pot's value and appears as its own "Cash — Not invested yet" row, which doesn't open a page. Charts show investments only.
- **Side Bet** comes from your Kraken account (Phase 3). Once connected it counts in the total, the split and your rules like any pot. Each coin is one row — staked coins included, with the sub-line saying how much ("DOT · incl. 13 staked") — its quantity shown in coins ("0.01 BTC"), valued at CoinGecko's price in pounds (Kraken's public prices if CoinGecko is down). Pounds left on Kraken are its cash; dollars and euros count at today's rate. A coin with no price anywhere says "No price yet" and the pot doesn't state a change. **Since bought** for a coin uses what you paid (until it's known the row says "Cost not known yet"); coins you moved in from elsewhere count at their value the day they arrived; staking rewards cost nothing. Until Pip has worked out what a coin cost, its "since bought" isn't stated and Side Bet's all-time change isn't either. **History** is rebuilt from your Kraken ledger. **Today** for crypto means since midnight UTC, and Side Bet never says "markets closed" — crypto doesn't close. Connected but empty, its card says "Nothing in it yet" and its page says that's a perfectly good place to leave it. Not connected, Side Bet says so, with a Connect Kraken button, and is left out of everything; a Trading 212 account you haven't connected says the same, with a button to connect it.
- **Syncing.** Right after connecting, a pot says "Reading your account…" until Pip has read it and rebuilt its history.
- **Coming soon**, rather than sample data: "What changed" on Pots, "Money in" on a pot, and "Where your new money goes" on Rules. A holding's "In plain English" note isn't shown until there's one to show.
- **Rules** are your own (Phase 4), judged by one engine in the API that every screen reads: each connected pot's share of everything Pip can see, cash included, against its line. When a pot isn't connected, targets are judged against the pots that are — Foundation's 70% becomes 93.3% of Foundation plus Side Bet — and the rule says so ("…against 93.3% — your 70% scaled to the pots Pip can see."). A target 5 points or more away has drifted and says how far ("8 points above…"), calmly. Side Bet over its cap by any amount lights the red dot on Rules, turns its card red, and makes the verdict "Side Bet needs a look."; back under, they all clear. A pot that isn't connected says what to connect.
- **Prices stay fresh on their own**: every 30 minutes on weekdays while markets are open, hourly around the clock for crypto when anyone holds some, and whenever you open Pip, without making you wait more than a couple of seconds. Their age is shown the same way as always.

## Getting around

- **Three places to go**, the same at every size: **Pots**, **Rules** and **Setup**. On a phone they sit along the bottom; on a tablet they become a narrow rail of icons down the left; on a computer that rail widens into a sidebar with labels, the Pip mark, and a permanent "Read-only access" badge.
- **You always know where you are.** The current section is lit — and Pots stays lit while you're inside a pot or looking at a single holding, because those live under it.
- **A red dot on Rules** appears when a cap has been broken. It is the only red in the app's chrome, and only Side Bet can cause it. It lights on every screen, from the same rules the Rules screen shows.
- **Wide screens don't get stretched.** Content stops at a comfortable width and the rest is plain background — no widgets, no ticker, no filler.
- **Light or dark follows your device**, until you choose otherwise.
- **Sign-in stands alone**, with no navigation around it, because there's nowhere to go until you're in.

## Screens built

- **Sign in.** The promise first — "Three pots. One number. No homework." — then one email field and "Email me a sign-in link", with a line saying it's invite-only and Pip only needs your email. No password field. Once sent it says "Check your email", names the address, and offers "Use a different email"; opening the link in the same browser signs you in. If the link can't be sent it says so and lets you try again; if the sign-in email limit has been hit it says to try again in an hour. Already signed in, it sends you straight through. On a computer it gains a second column.
- **Not on the list.** For someone signed in but not allowed. It names the account back, offers "Put me on the waiting list", and confirms with "Waqar will let you know when there's room" — no queue position, no countdown, no promise of an email. "Try a different account" signs you out and returns you to sign in.
- **Pots (home).** Everything you own as one big number, pence set small, with what it did and a one-line verdict — "Up £25.80 today. Side Bet needs a look." Today, This month and All time change every figure on the screen, and the old numbers stay up until the new ones arrive. Below: the three pots — Side Bet always fenced with a hatch and a hard border, and red only when it's over its cap — then how the money splits against the shape you asked for ("You asked for 70 / 25 / 5. You're at 72 / 21 / 7."), then what changed last week, ending "That's the lot." A line names where prices come from. It ends by saying Pip can't trade. While loading it shows the numbers' shape rather than a spinner; with nothing in any pot it says so and points you to connect an account; if it can't load, it says your money is fine and offers a retry. On a tablet the pots become single rows; on a computer they sit side by side, and "The shape you asked for" appears beside what changed.
- **A pot.** Its name and badge (Autopilot, Yours, Capped), what it's worth and what it did, and a plain-English line about what kind of money this is. Then how it's gone, with a sentence saying what the line did; what went in each of the last six months, a month with nothing showing as a faded stub; and what's inside, as one shaded bar and a sortable list of holdings — pounds before every percentage, each row opening that holding. It ends by naming where you'd actually buy or sell (Trading 212 or Kraken), because Pip can't. Side Bet stays fenced. With no history, the value stays put and only the chart is replaced; an empty Side Bet says that's a perfectly good place to leave it; an unknown pot says there are three. On a computer the sidebar lists all three pots under Pots, and the holdings list gains its fourth column.
- **A holding.** Which pot it's in and its ticker, how much you hold and what one costs, what it's worth to you, and what it did today and since you bought — pounds first each time. Its price over Day, Month, Year or All, with a sentence saying what the price did in pounds ("The price went from £118.20 to £142.80 over the last month"). Then what the company or fund actually is, in plain English, marked "Information, not advice". It goes back to its pot, and ends by naming where you'd buy or sell. Bought today, it won't draw one day as a trend. On a computer, a breadcrumb replaces the back link and the chart gets most of the width.
- **Your rules.** The shape you set, shown, not edited. One card per pot: Foundation and Handpicked with a target, Side Bet with a hard cap (fenced and hatched), each with a bar showing where the pot actually sits and a plain-English line. When Side Bet is over its cap, a banner above says so in pounds first — "Side Bet is £208 over its cap" — then the percentages, marked "Information, not advice". It offers no buttons: there's nothing to raise, lower or fix from here, because changing rules arrives with the rules engine in Phase 4 and moving money happens at your broker. Below, "Where your new money goes" shows your monthly pay-in split by pot in pounds, described as the split you've set up at your broker — Pip reads it, it doesn't make it. It ends: "Changing a rule changes what Pip tells you — it never moves your money." Loading shows card shapes; if the rules can't load it says nothing has changed and offers a retry. On a computer the three cards sit side by side.
- **Setup.** "Where Pip reads your numbers from." Each account is its own row — Trading 212 ISA (feeds Foundation), Trading 212 Invest (feeds Handpicked), Kraken (Side Bet) — showing what it feeds and when it was last read ("Foundation · synced 4 min ago"), with a badge: Live, Needs a key (the provider stopped accepting it), Error, or Expired. Opening a live one shows what it feeds, how many holdings it saw, when it last read, and a line about permissions: for Kraken "This key cannot place orders. Pip checked."; for Trading 212 "Pip only reads this account. It can't check a Trading 212 key's permissions, and it has no code that places orders." — then Disconnect, which also removes that pot's history. With nothing connected it says "Nothing plugged in yet" and lists every account; otherwise "Connect another account" lists what isn't connected. An account Pip can't connect in this setup (Kraken, when the server has no CoinGecko key to price coins with) is shown but greyed out with "Coming soon".
  - **Connecting** gets the most hand-holding in the app. Trading 212: three steps (open Settings → API (Beta), make a key with only Account data, Portfolio, Metadata and History ticked, paste the key and the secret), a key field and a hidden secret field, and a plain note that Pip can't check a Trading 212 key's permissions and has no code that can place an order either way. Kraken: three steps (open Settings → API → Spot trading API and create a key; tick only Funds: Query and Data: Query ledger entries, no key password; paste the API key and the private key), a key field and a hidden private-key field, and a note that Pip checks the key can't trade, withdraw or deposit before storing it. While it checks: "Checking your keys…". Nothing is stored unless the key works:
    - **not recognised** — the key shown back masked ("kr-live-9…8814"), nothing connected or changed, "Try that again";
    - **missing a permission** — "That key can't see your Account data", with what to tick, "Make a new key";
    - **not in pounds** — Pip only works in pounds for now, "Try a different account";
    - **Trading 212 not answering** — nothing connected, "Try that again";
    - **a key that can trade or withdraw** (where Pip can tell) — **refused on purpose**, "That key can do too much", listing what's needed and what must be off, with only "Make a read-only key".
      The pasted key and secret aren't kept on screen after they're sent. Connecting the same account again replaces its key.
  - **Preferences**: Appearance (Light or Dark, "Follows your phone" until you pick, then "Follow your phone instead" to go back); **Hide the numbers**, which blurs the big total on every screen until you tap it, remembered on this device; Currency, fixed to pounds. No "Nudge me" until notifications exist.
  - Ends: "Pip only reads your accounts. Even if someone took your phone, they couldn't trade." (laptop, on a computer). Loading shows row shapes; if connections can't load it says your accounts are as you left them and offers a retry. On a computer, connections and preferences sit side by side.
- **Where you land.** Signed out, any page sends you to sign in. Signed in but not allowed, you land on the refusal screen. If Pip can't be reached at all, it says so and reassures you your money is fine.

## The pieces screens are built from

These decide how every number reads, on every screen:

- **Money always comes first.** Anywhere a change is shown, it reads "+£25.80 · +0.23%", never "+0.23%" on its own. That includes the holdings table, where the design prototype showed bare percentages — Pip is stricter than its own mockup here.
- **The big number** sets the pence smaller so the pounds carry the weight, and never rounds your money up.
- **A cap you've broken turns red; a target you've drifted past doesn't.** Being 2% over your Foundation target is shown calmly. Side Bet over its cap is red, hatched, and says how much in pounds.
- **Every chart has a sentence** saying in plain English what the line did. If there isn't enough history to draw one, it says so instead of drawing something misleading.
- **A month with nothing paid in** shows as a small faded bar, so it reads as zero rather than as missing data.
- **The holdings list** sorts by name, value or change; you tap or click a whole row to open a holding, and each keeps its colour when the order changes.

## How old the prices are

Every screen with a live figure has one small line saying where prices come from and how old they are. It never names a broker, because prices don't come from one. The line climbs a ladder, and only ever speaks with one voice:

- **Under an hour — green, and quiet.** "Sample prices · stub data · updated 4 min ago".
- **1 to 6 hours — amber.** The line names the late pot first, then reassures: "Side Bet is 2 hours old · everything else updated 4 min ago". Two late pots are still one line ("Handpicked and Side Bet are 2 hours old · Foundation updated 4 min ago"). A small "2H OLD" chip sits beside that pot's figure. The total isn't dimmed, no card appears, nothing is added to the navigation. On a pot or a holding it just says "Prices are 2 hours old" or "Price is 2 hours old".
- **Over 6 hours, or the price feed failed — red.** A card says which pot isn't updating ("Your Side Bet number is from 2 hours ago. Everything else is live.") with Try again. The amber line stands down. That pot's figure drops to 60%, because the feed is gone rather than late; the total stays at full strength but says "Roughly — one pot is stale". If every pot is affected — including all three being an hour or more late — the card says "All prices are 2 hours old" and the total dims too. On a pot or a holding, the card says when Pip last saw a figure and that what you own hasn't changed.
- **Markets closed — green, always.** A Saturday price isn't stale: "Prices from Friday's close".

The number never disappears at any rung. Nothing here touches real money or a real broker.
