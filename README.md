# BTC Indicators Dashboard

A free, single-page Bitcoin dashboard showing 14 indicators for two jobs:
**short-term trading** (around 4-hour entries) and **big-picture cycle positioning**.

It costs $0 to run: it's hosted on GitHub Pages, updated by GitHub Actions, and uses only free public data with no API keys.

> Educational only, not financial advice.

---

## How it works (plain English)

There are two kinds of data:

1. **Live data**, fetched by your browser each time you open the page or click **Refresh**:
   price and candles (Kraken, with Coinbase as a backup), funding rate, open interest and 4-hour candles (Hyperliquid), Fear & Greed (alternative.me), and hash rate and block height (mempool.space).
   Nothing refreshes on a timer. Data only updates when you load the page or click Refresh.

2. **Daily data**, fetched once a day by a GitHub robot (a "GitHub Action") at about 06:00 UTC:
   - **On-chain metrics** (MVRV Z-score, NUPL, SOPR) from bitcoin-data.com. Its free plan allows only about 15 requests a day, so the robot fetches them once and saves them to `data/onchain.json`.
   - **An open interest snapshot** from Hyperliquid, added to `data/oi-history.json`. Hyperliquid doesn't offer OI history, so we build our own one day at a time. That's what powers the OI chart and its 24h change.

**If a data source is down,** only its card is affected. The card shows the last value your browser saved, with a note saying when that value is from.

## What each file does

| File | What it's for |
|---|---|
| `index.html` | The page itself. |
| `css/styles.css` | Colors, fonts and layout. |
| `js/config.js` | **All signal thresholds, labels, colors and "What is this?" text.** This is the file you'll edit most. |
| `js/sources.js` | One small function per data source that fetches and tidies the data. |
| `js/indicators.js` | The math: moving averages, RSI, and so on. |
| `js/app.js` | Builds the cards, draws the charts, handles Refresh and errors. |
| `data/onchain.json` | On-chain data, written daily by the robot. |
| `data/oi-history.json` | Daily open-interest snapshots, written by the robot. |
| `scripts/fetch_daily.py` | The script the robot runs each day. |
| `.github/workflows/daily.yml` | Tells GitHub when to run the robot (daily, plus a manual button). |

## How to change a signal threshold

All the rules live in **`js/config.js`**. For example, the Mayer Multiple:

```js
mayer: {
  bands: [
    { upTo: 0.8, label: "Undervalued", color: "green" },
    { upTo: 1.5, label: "Neutral",     color: "gray" },
    { upTo: 2.4, label: "Warm",        color: "amber" },
    {            label: "Overheated",  color: "red" },
  ],
},
```

Read it top to bottom: the first line where the value is **below `upTo`** wins, and the last line catches everything above.
To make "Overheated" kick in at 2.2 instead of 2.4, change `2.4` to `2.2`.
Colors can be `green`, `amber`, `red` or `gray`.

**To edit on GitHub without any tools:** open `js/config.js` on github.com, click the pencil icon, make your change, and click **Commit changes**. The live site updates within a few minutes.

## Running the daily robot by hand

Go to the repo's **Actions** tab, click **Daily data**, then click **Run workflow**. It takes about 30 seconds and commits fresh files to `data/`.

Note: GitHub pauses scheduled robots on repos with no activity for 60 days. The robot's own daily commits normally count as activity, but if it ever stops, the Actions tab will show a button to re-enable it.

## Previewing on your own computer

From this folder, run:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. (Opening `index.html` directly as a file won't load the daily data.)

## Good to know

- **On-chain data lags.** bitcoin-data.com's free data is usually several days behind. Each on-chain card shows "Data as of [date]."
- **Hyperliquid's funding rate rests at about +11% a year** when nothing is happening (that's built into how it works). So the "Neutral" funding band goes up to 12%, not 10%.
- **Open interest 24h change** starts working the day after the first snapshot and compares with the daily snapshot closest to 24 hours ago. It's measured in BTC, so price moves alone don't count as "leverage building."
- Charts use [Chart.js](https://www.chartjs.org/) 4.4.1, loaded from cdnjs.
