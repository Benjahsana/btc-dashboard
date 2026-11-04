/*
 * One fetch function per data source.
 * Each returns small, normalized data (oldest → newest) so it can be
 * cached in localStorage and reused if the API is down next time.
 */

const HL_URL = "https://api.hyperliquid.xyz/info";
const DAY_MS = 86400000;

async function fetchJSON(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url, location.href).host}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function hlPost(body) {
  return fetchJSON(HL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ---------- Candles: Kraken (primary), Coinbase (fallback) ---------- */

async function krakenCloses(interval) {
  const d = await fetchJSON(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=${interval}`);
  if (d.error && d.error.length) throw new Error("Kraken: " + d.error.join(", "));
  const key = Object.keys(d.result).find((k) => k !== "last");
  const rows = d.result[key];
  if (!rows || !rows.length) throw new Error("Kraken: no rows");
  return rows.map((r) => ({ t: r[0] * 1000, c: +r[4] }));
}

// Coinbase: max 300 candles per call, newest first, daily granularity only.
async function coinbaseDailyCloses(days) {
  const out = [];
  let end = Date.now();
  while (out.length < days) {
    const start = end - 300 * DAY_MS;
    const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400&start=${new Date(start).toISOString()}&end=${new Date(end).toISOString()}`;
    const rows = await fetchJSON(url);
    if (!rows.length) break;
    for (const r of rows) out.push({ t: r[0] * 1000, c: +r[4] });
    end = start;
  }
  const seen = new Set();
  return out
    .filter((x) => (seen.has(x.t) ? false : seen.add(x.t)))
    .sort((a, b) => a.t - b.t);
}

// Group daily closes into weeks (Monday start); the week's close is its last day.
function dailyToWeekly(daily) {
  const weeks = new Map();
  for (const d of daily) {
    const day = new Date(d.t).getUTCDay(); // 0 = Sun
    const monday = d.t - ((day + 6) % 7) * DAY_MS;
    weeks.set(monday, { t: monday, c: d.c });
  }
  return [...weeks.values()].sort((a, b) => a.t - b.t);
}

const Sources = {
  // ~720 daily closes
  async daily() {
    try { return await krakenCloses(1440); }
    catch (e) { console.warn("Kraken daily failed, using Coinbase", e); return coinbaseDailyCloses(730); }
  },

  // Weekly closes (needs 200+ weeks)
  async weekly() {
    try { return await krakenCloses(10080); }
    catch (e) { console.warn("Kraken weekly failed, using Coinbase", e); return dailyToWeekly(await coinbaseDailyCloses(1500)); }
  },

  // Header price and rolling 24h change
  async ticker() {
    try {
      const h = await krakenCloses(60);
      const now = h[h.length - 1];
      const ago = h[h.length - 25] || h[0];
      return { price: now.c, change24h: (now.c / ago.c - 1) * 100, source: "Kraken" };
    } catch (e) {
      console.warn("Kraken ticker failed, using Hyperliquid", e);
      const ctx = await Sources.hlCtx();
      return { price: ctx.markPx, change24h: (ctx.markPx / ctx.prevDayPx - 1) * 100, source: "Hyperliquid" };
    }
  },

  // ~30 days of 4h candles (extra history warms up the RSI)
  async candles4h() {
    const end = Date.now();
    const rows = await hlPost({
      type: "candleSnapshot",
      req: { coin: "BTC", interval: "4h", startTime: end - 30 * DAY_MS, endTime: end },
    });
    return rows.map((r) => ({ t: r.t, c: +r.c }));
  },

  // Current BTC perp stats on Hyperliquid
  async hlCtx() {
    const [meta, ctxs] = await hlPost({ type: "metaAndAssetCtxs" });
    const i = meta.universe.findIndex((u) => u.name === "BTC");
    if (i < 0) throw new Error("BTC not found on Hyperliquid");
    const c = ctxs[i];
    return {
      funding: +c.funding,           // hourly rate, e.g. 0.0000125
      oiBtc: +c.openInterest,        // in BTC
      markPx: +c.markPx,
      prevDayPx: +c.prevDayPx,
    };
  },

  // Hourly funding, last 14 days (API returns max 500 rows)
  async fundingHistory() {
    const rows = await hlPost({ type: "fundingHistory", coin: "BTC", startTime: Date.now() - 14 * DAY_MS });
    return rows.map((r) => ({ t: r.time, rate: +r.fundingRate }));
  },

  async fearGreed() {
    const d = await fetchJSON("https://api.alternative.me/fng/?limit=90");
    return d.data
      .map((r) => ({ t: +r.timestamp * 1000, v: +r.value, label: r.value_classification }))
      .sort((a, b) => a.t - b.t);
  },

  async hashrate() {
    const d = await fetchJSON("https://mempool.space/api/v1/mining/hashrate/1y");
    return d.hashrates.map((r) => ({ t: r.timestamp * 1000, h: r.avgHashrate }));
  },

  async height() {
    const h = await fetchJSON("https://mempool.space/api/blocks/tip/height");
    if (!Number.isFinite(h)) throw new Error("Bad block height");
    return h;
  },

  // Written once a day by the GitHub Action
  async onchain() {
    return fetchJSON("data/onchain.json", { cache: "no-cache" });
  },

  async oiHistory() {
    return fetchJSON("data/oi-history.json", { cache: "no-cache" });
  },
};
