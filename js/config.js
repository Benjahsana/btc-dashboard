/*
 * ─────────────────────────────────────────────────────────────
 *  DASHBOARD SETTINGS — edit this file to change signals.
 * ─────────────────────────────────────────────────────────────
 *
 * How "bands" work:
 *   The value is checked against each band from top to bottom.
 *   The first band where  value < upTo  wins.
 *   The last band has no "upTo" — it catches everything above.
 *
 * Colors you can use:  "green", "amber", "red", "gray"
 *   green = historically favorable / healthy
 *   amber = worth watching
 *   red   = overheated / caution
 *   gray  = neutral
 *
 * "info" is the one-line "What is this?" text shown on each card.
 */

const CONFIG = {

  /* ───────────── CYCLE ───────────── */

  wma200: {
    title: "Price vs. 200-week MA",
    info: "Bitcoin's price divided by its 200-week average. Historically, below 1 has marked cycle bottoms and very high readings have marked tops.",
    bands: [
      { upTo: 1.0, label: "Deep value", color: "green" },
      { upTo: 1.5, label: "Healthy",    color: "green" },
      { upTo: 2.5, label: "Elevated",   color: "amber" },
      {            label: "Extended",   color: "red" },
    ],
  },

  mayer: {
    title: "Mayer Multiple",
    info: "Price divided by the 200-day average. Shows how stretched price is versus its recent long-term trend.",
    bands: [
      { upTo: 0.8, label: "Undervalued", color: "green" },
      { upTo: 1.5, label: "Neutral",     color: "gray" },
      { upTo: 2.4, label: "Warm",        color: "amber" },
      {            label: "Overheated",  color: "red" },
    ],
  },

  bullBand: {
    title: "Bull market support band",
    info: "The 20-week simple and 21-week exponential averages. In bull markets, price has tended to stay above this band.",
    labels: {
      above:   { label: "Bull trend intact", color: "green" },
      between: { label: "Testing support",   color: "amber" },
      below:   { label: "Support lost",      color: "red" },
    },
  },

  piCycle: {
    title: "Pi Cycle Top",
    info: "Compares the 111-day average to 2× the 350-day average. When the 111-day crosses above, it has historically flagged cycle tops within days.",
    approachPct: 5, // "Approaching" when the gap is within this many %
    labels: {
      top:      { label: "Top signal",  color: "red" },
      approach: { label: "Approaching", color: "amber" },
      none:     { label: "No signal",   color: "gray" },
    },
  },

  halving: {
    title: "Halving-cycle clock",
    info: "Bitcoin's new-coin reward halves every 210,000 blocks (~4 years). Past cycles have followed a rough pattern around these dates.",
    lastHalvingBlock: 840000,
    lastHalvingDate: "2024-04-20",
    nextHalvingBlock: 1050000,
    minutesPerBlock: 10,
    phases: [ // by months since the last halving
      { upToMonths: 12, label: "Early expansion",                color: "green" },
      { upToMonths: 18, label: "Historical peak window",         color: "amber" },
      { upToMonths: 30, label: "Post-peak / bear (historically)", color: "red" },
      {                 label: "Pre-halving accumulation",       color: "green" },
    ],
  },

  rsiWeekly: {
    title: "Weekly RSI (14)",
    info: "Momentum on a 0–100 scale using weekly candles. Above 70 means a strong run-up; below 30 means a heavy sell-off.",
  },

  /* ───────────── TRADING ───────────── */

  funding: {
    title: "Funding rate (Hyperliquid)",
    info: "What long traders pay short traders (or vice versa) each hour to hold perpetual futures. High positive = many leveraged longs.",
    // Bands use the ANNUALIZED rate in % (hourly rate × 24 × 365).
    // Note: Hyperliquid's "resting" rate is about +11%/yr, so Neutral goes up to 12.
    bands: [
      { upTo: -5, label: "Crowded shorts", color: "green" },
      { upTo: 12, label: "Neutral",        color: "gray" },
      { upTo: 30, label: "Elevated",       color: "amber" },
      {           label: "Crowded longs",  color: "red" },
    ],
  },

  openInterest: {
    title: "Open interest (Hyperliquid)",
    info: "Total value of open BTC perpetual positions. The 24h change is measured in BTC, so price moves alone don't count as new leverage.",
    risePct: 5,  // above +5% in 24h  → "Leverage building"
    fallPct: 5,  // below −5% in 24h  → "Deleveraging"
    labels: {
      rising:  { label: "Leverage building", color: "amber" },
      falling: { label: "Deleveraging",      color: "green" },
      stable:  { label: "Stable",            color: "gray" },
      noHistory: { label: "Building history", color: "gray" },
    },
  },

  rsi4h: {
    title: "4-hour RSI (14)",
    info: "Short-term momentum on a 0–100 scale using 4-hour candles. Useful for timing entries.",
  },

  // Shared by both RSI cards
  rsi: {
    period: 14,
    overbought: 70,
    oversold: 30,
    labels: {
      overbought: { label: "Overbought", color: "red" },
      oversold:   { label: "Oversold",   color: "green" },
      neutral:    { label: "Neutral",    color: "gray" },
    },
  },

  fearGreed: {
    title: "Fear & Greed Index",
    info: "A 0–100 crowd-mood score from alternative.me. Extreme fear has often been a buying opportunity; extreme greed a time for caution.",
    // The label comes from the API; this only picks the color.
    colors: {
      "Extreme Fear":  "green",
      "Fear":          "green",
      "Neutral":       "gray",
      "Greed":         "amber",
      "Extreme Greed": "red",
    },
  },

  /* ───────────── ON-CHAIN ───────────── */

  mvrv: {
    title: "MVRV Z-score",
    info: "How far Bitcoin's market value sits above what holders paid on average, in standard deviations. High = holders sitting on big profits.",
    bands: [
      { upTo: 0, label: "Undervalued", color: "green" },
      { upTo: 3, label: "Neutral",     color: "gray" },
      { upTo: 7, label: "Warm",        color: "amber" },
      {          label: "Overheated",  color: "red" },
    ],
  },

  nupl: {
    title: "NUPL",
    info: "Net Unrealized Profit/Loss: the share of Bitcoin's value that is unrealized profit. Maps to crowd emotion from capitulation to euphoria.",
    bands: [
      { upTo: 0,    label: "Capitulation",       color: "green" },
      { upTo: 0.25, label: "Hope / Fear",        color: "green" },
      { upTo: 0.5,  label: "Optimism / Anxiety", color: "gray" },
      { upTo: 0.75, label: "Belief / Denial",    color: "amber" },
      {             label: "Euphoria",           color: "red" },
    ],
  },

  sopr: {
    title: "SOPR (7-day avg)",
    info: "Spent Output Profit Ratio: above 1 means coins moved today were sold at a profit on average; below 1 means at a loss.",
    averageDays: 7,
    breakeven: 0.005, // within ±0.005 of 1.0 counts as "At breakeven"
    labels: {
      breakeven: { label: "At breakeven",      color: "gray" },
      profit:    { label: "Profit-taking",     color: "amber" },
      loss:      { label: "Selling at a loss", color: "green" },
    },
  },

  /* ───────────── NETWORK ───────────── */

  hashRibbons: {
    title: "Hash rate & Hash Ribbons",
    info: "Mining power securing Bitcoin. When the 30-day average drops below the 60-day, miners are under stress; the recovery has historically been bullish.",
    fastDays: 30,
    slowDays: 60,
    recoveryWindowDays: 30,
    labels: {
      capitulation: { label: "Miner capitulation",             color: "amber" },
      recovery:     { label: "Recovery (historically bullish)", color: "green" },
      healthy:      { label: "Healthy",                         color: "green" },
    },
  },
};
