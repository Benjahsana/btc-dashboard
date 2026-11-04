/*
 * Rendering, refresh, caching and error handling.
 * Data is fetched only on page load and when Refresh is clicked.
 */

const DAY = 86400000;
const CACHE_PREFIX = "btcdash:v1:";

/* ---------- Safe localStorage ---------- */

const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + key)); }
    catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value)); }
    catch { /* storage full or blocked — fine, just no cache */ }
  },
};

// Fetch a source; on failure fall back to the last good copy.
async function loadSource(key) {
  try {
    const data = await Sources[key]();
    const time = Date.now();
    store.set(key, { time, data });
    return { data, time, stale: false };
  } catch (err) {
    console.error(`[${key}]`, err);
    const cached = store.get(key);
    if (cached && cached.data != null) return { data: cached.data, time: cached.time, stale: true };
    throw err;
  }
}

/* ---------- Formatting ---------- */

const fmt = {
  usd(v, dec = 0) {
    return (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  },
  usdShort(v) {
    return "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: v >= 1e9 ? 2 : 1 }).format(v);
  },
  num(v, dec = 2) {
    return v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }).replace("-", "−");
  },
  pct(v, dec = 2) {
    const r = +v.toFixed(dec);
    const s = Math.abs(r).toFixed(dec) + "%";
    return r > 0 ? "+" + s : r < 0 ? "−" + s : s;
  },
  // Calendar dates (halving day, on-chain "as of", candle days) are UTC
  date(t, utc = true) {
    return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", ...(utc && { timeZone: "UTC" }) });
  },
  dateTime(t) {
    return new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  },
  label(t, style) {
    const d = new Date(t);
    if (style === "month") return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) + " '" + String(d.getUTCFullYear()).slice(2);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- Charts ---------- */

const COLORS = {
  ink: "#1f2937",
  accent: "#f7931a",
  blue: "#3b82f6",
  faint: "#cbd5e1",
  ref: "#c3cad4",
  grid: "#eef1f5",
  muted: "#8a94a6",
};

const charts = new Map();

function drawLine(canvas, { labels, series, refs = [], yLog = false, yMin, yMax, yFmt = (v) => v }) {
  const datasets = series.map((s) => ({
    label: s.label,
    data: s.data,
    borderColor: s.color,
    backgroundColor: s.fill || "transparent",
    fill: !!s.fill,
    borderWidth: s.width || 1.8,
    pointRadius: s.points ? 2.5 : 0,
    pointHoverRadius: 3,
    tension: 0.2,
    spanGaps: true,
  }));
  // Only draw threshold lines near the data, so they don't squash the chart
  const vals = series.flatMap((s) => s.data).filter((v) => v != null);
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.35;
  const shown = yMin != null || yMax != null ? refs : refs.filter((r) => r.value >= lo - pad && r.value <= hi + pad);
  for (const r of shown) {
    datasets.push({
      label: r.label || "",
      data: labels.map(() => r.value),
      borderColor: COLORS.ref,
      borderDash: [3, 3],
      borderWidth: 1,
      pointRadius: 0,
      pointHoverRadius: 0,
      isRef: true,
    });
  }
  const named = series.filter((s) => s.label).length;
  return new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: named > 1,
          position: "bottom",
          align: "start",
          labels: {
            boxWidth: 10, boxHeight: 2, padding: 10,
            font: { size: 11 }, color: COLORS.muted,
            filter: (item, data) => !data.datasets[item.datasetIndex].isRef,
          },
        },
        tooltip: {
          filter: (item) => !item.dataset.isRef,
          backgroundColor: "#111827",
          padding: 8,
          titleFont: { size: 11, weight: "500" },
          bodyFont: { size: 12 },
          callbacks: { label: (c) => ` ${c.dataset.label ? c.dataset.label + ": " : ""}${yFmt(c.parsed.y)}` },
        },
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 4, maxRotation: 0, autoSkip: true, font: { size: 10 }, color: COLORS.muted },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          type: yLog ? "logarithmic" : "linear",
          min: yMin,
          max: yMax,
          position: "right",
          ticks: { maxTicksLimit: 4, font: { size: 10 }, color: COLORS.muted, callback: (v) => yFmt(v) },
          grid: { color: COLORS.grid },
          border: { display: false },
        },
      },
    },
  });
}

/* ---------- Helpers for card math ---------- */

const tail = (arr, n) => arr.slice(Math.max(0, arr.length - n));
const bandRefs = (bands) => bands.filter((b) => b.upTo !== undefined).map((b) => ({ value: b.upTo }));

function rsiSignal(v) {
  const r = CONFIG.rsi;
  return v >= r.overbought ? r.labels.overbought : v <= r.oversold ? r.labels.oversold : r.labels.neutral;
}

function rsiCard(candles, points, labelStyle) {
  const closes = candles.map((c) => c.c);
  const rsi = Ind.rsi(closes, CONFIG.rsi.period);
  const v = Ind.last(rsi);
  const idx = tail(candles.map((_, i) => i), points);
  return {
    value: fmt.num(v, 1),
    sub: `Price ${fmt.usd(closes[closes.length - 1])}`,
    signal: rsiSignal(v),
    chart: {
      labels: idx.map((i) => fmt.label(candles[i].t, labelStyle)),
      series: [{ label: "RSI", data: idx.map((i) => rsi[i]), color: COLORS.accent }],
      refs: [{ value: CONFIG.rsi.overbought }, { value: CONFIG.rsi.oversold }],
      yMin: 0, yMax: 100,
      yFmt: (x) => Math.round(x),
    },
  };
}

function onchainSeries(onchain, key) {
  const m = onchain.metrics && onchain.metrics[key];
  if (!m || !m.series || !m.series.length) throw new Error(`No ${key} data in onchain.json`);
  return { asOf: m.asOf, rows: m.series.map(([d, v]) => ({ t: Date.parse(d + "T00:00:00Z"), v })) };
}

function onchainBandCard(onchain, key, cfg, dec) {
  const { asOf, rows } = onchainSeries(onchain, key);
  const last = rows[rows.length - 1].v;
  const yr = tail(rows, 365);
  return {
    value: fmt.num(last, dec),
    sub: `30 days ago: ${fmt.num(rows[Math.max(0, rows.length - 31)].v, dec)}`,
    signal: Ind.band(last, cfg.bands),
    note: `Data as of ${fmt.date(Date.parse(asOf + "T00:00:00Z"))}`,
    chart: {
      labels: yr.map((r) => fmt.label(r.t, "month")),
      series: [{ label: cfg.title, data: yr.map((r) => r.v), color: COLORS.accent }],
      refs: bandRefs(cfg.bands),
      yFmt: (x) => fmt.num(x, dec > 2 ? 2 : 1),
    },
  };
}

/* ---------- Card definitions ---------- */
// needs: sources required; optional: sources used if available.
// compute(data) returns { value, unit, sub, signal, chart | html, note }

const CARDS = {
  wma200: {
    needs: ["weekly"],
    compute({ weekly }) {
      const closes = weekly.map((w) => w.c);
      const ma = Ind.sma(closes, 200);
      const price = closes[closes.length - 1];
      const m = Ind.last(ma);
      const mult = price / m;
      const idx = closes.map((_, i) => i).filter((i) => ma[i] != null);
      return {
        value: fmt.num(mult, 2), unit: "×",
        sub: `Price ${fmt.usd(price)} · 200WMA ${fmt.usd(m)}`,
        signal: Ind.band(mult, CONFIG.wma200.bands),
        chart: {
          labels: idx.map((i) => fmt.label(weekly[i].t, "month")),
          series: [
            { label: "Price", data: idx.map((i) => closes[i]), color: COLORS.ink, width: 1.4 },
            { label: "200-week MA", data: idx.map((i) => ma[i]), color: COLORS.accent, width: 2 },
          ],
          yLog: true,
          yFmt: fmt.usdShort,
        },
      };
    },
  },

  mayer: {
    needs: ["daily"],
    compute({ daily }) {
      const closes = daily.map((d) => d.c);
      const ma = Ind.sma(closes, 200);
      const mult = closes.map((c, i) => (ma[i] ? c / ma[i] : null));
      const v = Ind.last(mult);
      const idx = tail(closes.map((_, i) => i), 365);
      return {
        value: fmt.num(v, 2), unit: "×",
        sub: `Price ${fmt.usd(closes[closes.length - 1])} · 200DMA ${fmt.usd(Ind.last(ma))}`,
        signal: Ind.band(v, CONFIG.mayer.bands),
        chart: {
          labels: idx.map((i) => fmt.label(daily[i].t, "month")),
          series: [{ label: "Mayer Multiple", data: idx.map((i) => mult[i]), color: COLORS.accent }],
          refs: bandRefs(CONFIG.mayer.bands),
          yFmt: (x) => fmt.num(x, 1),
        },
      };
    },
  },

  bullBand: {
    needs: ["weekly"],
    compute({ weekly }) {
      const closes = weekly.map((w) => w.c);
      const sma = Ind.sma(closes, 20);
      const ema = Ind.ema(closes, 21);
      const price = closes[closes.length - 1];
      const a = Ind.last(sma), b = Ind.last(ema);
      const hi = Math.max(a, b), lo = Math.min(a, b);
      const L = CONFIG.bullBand.labels;
      const signal = price > hi ? L.above : price < lo ? L.below : L.between;
      const dist = price > hi ? `${fmt.pct((price / hi - 1) * 100, 1)} above the band`
        : price < lo ? `${fmt.pct((price / lo - 1) * 100, 1)} below the band` : "Inside the band";
      const idx = tail(closes.map((_, i) => i), 104);
      return {
        value: fmt.usd(price),
        sub: `${dist} · 20W SMA ${fmt.usd(a)} · 21W EMA ${fmt.usd(b)}`,
        signal,
        chart: {
          labels: idx.map((i) => fmt.label(weekly[i].t, "month")),
          series: [
            { label: "Price", data: idx.map((i) => closes[i]), color: COLORS.ink, width: 1.4 },
            { label: "20W SMA", data: idx.map((i) => sma[i]), color: COLORS.accent },
            { label: "21W EMA", data: idx.map((i) => ema[i]), color: COLORS.blue },
          ],
          yFmt: fmt.usdShort,
        },
      };
    },
  },

  piCycle: {
    needs: ["daily"],
    compute({ daily }) {
      const closes = daily.map((d) => d.c);
      const fast = Ind.sma(closes, 111);
      const slow = Ind.sma(closes, 350).map((v) => (v == null ? null : v * 2));
      const f = Ind.last(fast), s = Ind.last(slow);
      if (f == null || s == null) throw new Error("Not enough daily history for the 350-day average");
      const gap = (f / s - 1) * 100;
      const c = CONFIG.piCycle;
      const signal = f >= s ? c.labels.top : gap > -c.approachPct ? c.labels.approach : c.labels.none;
      const idx = closes.map((_, i) => i).filter((i) => slow[i] != null).slice(-365);
      return {
        value: fmt.pct(gap, 1),
        sub: `Gap between lines · 111DMA ${fmt.usd(f)} · 2×350DMA ${fmt.usd(s)}`,
        signal,
        chart: {
          labels: idx.map((i) => fmt.label(daily[i].t, "month")),
          series: [
            { label: "111DMA", data: idx.map((i) => fast[i]), color: COLORS.accent },
            { label: "2× 350DMA", data: idx.map((i) => slow[i]), color: COLORS.blue },
          ],
          yFmt: fmt.usdShort,
        },
      };
    },
  },

  halving: {
    needs: ["height"],
    compute({ height }) {
      const c = CONFIG.halving;
      const now = Date.now();
      const start = Date.parse(c.lastHalvingDate + "T00:00:00Z");
      const blocksLeft = Math.max(0, c.nextHalvingBlock - height);
      const next = now + blocksLeft * c.minutesPerBlock * 60000;
      const daysSince = Math.floor((now - start) / DAY);
      const daysUntil = Math.ceil((next - now) / DAY);
      const monthsSince = daysSince / 30.4375;
      const phase = c.phases.find((p) => p.upToMonths === undefined || monthsSince < p.upToMonths);

      // Phase timeline bar
      const totalMonths = (next - start) / DAY / 30.4375;
      let prev = 0;
      const segs = c.phases.map((p) => {
        const end = Math.min(p.upToMonths ?? totalMonths, totalMonths);
        const w = Math.max(0, ((end - prev) / totalMonths) * 100);
        prev = end;
        return `<span class="seg seg-${p.color}" style="width:${w}%" title="${esc(p.label)}"></span>`;
      }).join("");
      const pos = Math.min(100, (monthsSince / totalMonths) * 100);
      const html = `
        <div class="timeline" role="img" aria-label="${Math.round(pos)}% of the way through this halving cycle">
          <div class="track">${segs}</div>
          <div class="marker" style="left:${pos}%"><span>Today</span></div>
        </div>
        <div class="timeline-ends">
          <span>${fmt.date(start)}<br><small>Block ${c.lastHalvingBlock.toLocaleString()}</small></span>
          <span class="right">~${fmt.date(next, false)}<br><small>Block ${c.nextHalvingBlock.toLocaleString()}</small></span>
        </div>`;
      return {
        value: daysSince.toLocaleString(), unit: " days since",
        sub: `~${daysUntil.toLocaleString()} days until the next halving · ${blocksLeft.toLocaleString()} blocks left (tip ${height.toLocaleString()})`,
        signal: phase,
        html,
        note: `${fmt.num(monthsSince, 1)} months in. Phases are based on past cycles, not guaranteed.`,
      };
    },
  },

  rsiWeekly: {
    needs: ["weekly"],
    compute: ({ weekly }) => rsiCard(weekly, 104, "month"),
  },

  funding: {
    needs: ["hlCtx", "fundingHistory"],
    compute({ hlCtx, fundingHistory }) {
      const toAnn = (h) => h * 24 * 365 * 100;
      const ann = toAnn(hlCtx.funding);
      const week = tail(fundingHistory, 168);
      const avg = week.reduce((a, r) => a + r.rate, 0) / (week.length || 1);
      return {
        value: fmt.pct(ann, 1), unit: " /yr",
        sub: `Hourly ${fmt.pct(hlCtx.funding * 100, 5)} · 7-day avg ${fmt.pct(toAnn(avg), 1)} /yr`,
        signal: Ind.band(ann, CONFIG.funding.bands),
        chart: {
          labels: fundingHistory.map((r) => fmt.label(r.t)),
          series: [{ label: "Annualized", data: fundingHistory.map((r) => toAnn(r.rate)), color: COLORS.accent, width: 1.4 }],
          refs: [{ value: 0 }],
          yFmt: (x) => fmt.pct(x, 0),
        },
      };
    },
  },

  openInterest: {
    needs: ["hlCtx"],
    optional: ["oiHistory"],
    compute({ hlCtx, oiHistory }) {
      const c = CONFIG.openInterest;
      const now = Date.now();
      const usd = hlCtx.oiBtc * hlCtx.markPx;
      const snaps = ((oiHistory && oiHistory.snapshots) || [])
        .map((s) => ({ t: Date.parse(s.t), btc: s.oi_btc, usd: s.oi_usd }))
        .filter((s) => Number.isFinite(s.t))
        .sort((a, b) => a.t - b.t);

      // Compare with the daily snapshot closest to 24h ago (at least 12h old)
      const old = snaps.filter((s) => now - s.t >= 12 * 3600000);
      const ref = old.sort((a, b) => Math.abs(now - DAY - a.t) - Math.abs(now - DAY - b.t))[0];
      let signal, changeTxt;
      if (ref) {
        const ch = (hlCtx.oiBtc / ref.btc - 1) * 100;
        signal = ch > c.risePct ? c.labels.rising : ch < -c.fallPct ? c.labels.falling : c.labels.stable;
        const hrs = Math.round((now - ref.t) / 3600000);
        changeTxt = `${fmt.pct(ch, 1)} vs. ${hrs}h ago`;
      } else {
        signal = c.labels.noHistory;
        changeTxt = "24h change appears after the next daily snapshot";
      }
      const pts = [...snaps.slice(-60), { t: now, usd }];
      return {
        value: fmt.usdShort(usd),
        sub: `${Math.round(hlCtx.oiBtc).toLocaleString()} BTC · ${changeTxt}`,
        signal,
        chart: {
          labels: pts.map((p) => fmt.label(p.t)),
          series: [{ label: "Open interest", data: pts.map((p) => p.usd), color: COLORS.accent, points: pts.length < 15 }],
          yFmt: fmt.usdShort,
        },
      };
    },
  },

  rsi4h: {
    needs: ["candles4h"],
    compute: ({ candles4h }) => rsiCard(candles4h, 42, "day"),
  },

  fearGreed: {
    needs: ["fearGreed"],
    compute({ fearGreed }) {
      const last = fearGreed[fearGreed.length - 1];
      const ago = (n) => fearGreed[Math.max(0, fearGreed.length - 1 - n)].v;
      return {
        value: String(last.v), unit: " / 100",
        sub: `Yesterday ${ago(1)} · Last week ${ago(7)} · Last month ${ago(30)}`,
        signal: { label: last.label, color: CONFIG.fearGreed.colors[last.label] || "gray" },
        chart: {
          labels: fearGreed.map((r) => fmt.label(r.t)),
          series: [{ label: "Fear & Greed", data: fearGreed.map((r) => r.v), color: COLORS.accent }],
          refs: [{ value: 25 }, { value: 75 }],
          yMin: 0, yMax: 100,
          yFmt: (x) => Math.round(x),
        },
      };
    },
  },

  mvrv: { needs: ["onchain"], compute: ({ onchain }) => onchainBandCard(onchain, "mvrv", CONFIG.mvrv, 2) },
  nupl: { needs: ["onchain"], compute: ({ onchain }) => onchainBandCard(onchain, "nupl", CONFIG.nupl, 3) },

  sopr: {
    needs: ["onchain"],
    compute({ onchain }) {
      const c = CONFIG.sopr;
      const { asOf, rows } = onchainSeries(onchain, "sopr");
      const vals = rows.map((r) => r.v);
      const avg = Ind.sma(vals, c.averageDays);
      const v = Ind.last(avg);
      const signal = Math.abs(v - 1) <= c.breakeven ? c.labels.breakeven : v > 1 ? c.labels.profit : c.labels.loss;
      const idx = tail(rows.map((_, i) => i), 365);
      return {
        value: fmt.num(v, 4),
        sub: `Latest daily reading ${fmt.num(vals[vals.length - 1], 4)}`,
        signal,
        note: `Data as of ${fmt.date(Date.parse(asOf + "T00:00:00Z"))}`,
        chart: {
          labels: idx.map((i) => fmt.label(rows[i].t, "month")),
          series: [
            { label: "Daily", data: idx.map((i) => vals[i]), color: COLORS.faint, width: 1 },
            { label: `${c.averageDays}-day avg`, data: idx.map((i) => avg[i]), color: COLORS.accent },
          ],
          refs: [{ value: 1 }],
          yFmt: (x) => fmt.num(x, 2),
        },
      };
    },
  },

  hashRibbons: {
    needs: ["hashrate"],
    compute({ hashrate }) {
      const c = CONFIG.hashRibbons;
      const eh = hashrate.map((r) => r.h / 1e18);
      const fast = Ind.sma(eh, c.fastDays);
      const slow = Ind.sma(eh, c.slowDays);
      const n = eh.length - 1;
      let signal = c.labels.healthy;
      if (fast[n] < slow[n]) signal = c.labels.capitulation;
      else {
        for (let i = n; i > n - c.recoveryWindowDays && i > 0; i--) {
          if (slow[i - 1] != null && fast[i - 1] < slow[i - 1] && fast[i] >= slow[i]) { signal = c.labels.recovery; break; }
        }
      }
      const idx = eh.map((_, i) => i).filter((i) => slow[i] != null);
      return {
        value: Math.round(fast[n]).toLocaleString(), unit: " EH/s",
        sub: `30-day avg · 60-day avg ${Math.round(slow[n]).toLocaleString()} EH/s`,
        signal,
        chart: {
          labels: idx.map((i) => fmt.label(hashrate[i].t, "month")),
          series: [
            { label: "30-day", data: idx.map((i) => fast[i]), color: COLORS.accent },
            { label: "60-day", data: idx.map((i) => slow[i]), color: COLORS.blue },
          ],
          yFmt: (x) => Math.round(x).toLocaleString(),
        },
      };
    },
  },
};

const SECTIONS = [
  { title: "Cycle", desc: "Where Bitcoin sits in its multi-year cycle.", cards: ["wma200", "mayer", "bullBand", "piCycle", "halving", "rsiWeekly"] },
  { title: "Trading", desc: "Short-term positioning and momentum for ~4-hour entries.", cards: ["funding", "openInterest", "rsi4h", "fearGreed"] },
  { title: "On-chain", desc: "What holders are doing, updated once a day.", cards: ["mvrv", "nupl", "sopr"] },
  { title: "Network", desc: "The health of Bitcoin's mining network.", cards: ["hashRibbons"] },
];

/* ---------- DOM ---------- */

const SKELETON = `
  <div class="value-row"><div class="sk sk-value"></div><div class="sk sk-pill"></div></div>
  <div class="sk sk-line"></div>
  <div class="sk sk-chart"></div>`;

function buildLayout() {
  const main = document.getElementById("sections");
  main.innerHTML = SECTIONS.map((s) => `
    <section class="section">
      <div class="section-head">
        <h2>${esc(s.title)}</h2>
        <p>${esc(s.desc)}</p>
      </div>
      <div class="grid">
        ${s.cards.map((id) => `
          <article class="card" id="card-${id}" aria-busy="true">
            <header class="card-head">
              <h3>${esc(CONFIG[id].title)}</h3>
              <button class="info" type="button" aria-label="What is this?" aria-expanded="false">?</button>
              <div class="tip" role="tooltip"><strong>What is this?</strong> ${esc(CONFIG[id].info)}</div>
            </header>
            <div class="card-body">${SKELETON}</div>
          </article>`).join("")}
      </div>
    </section>`).join("");

  // Click-to-toggle explanations (hover works via CSS)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".info");
    document.querySelectorAll(".card-head.open").forEach((h) => {
      if (!btn || h !== btn.parentElement) { h.classList.remove("open"); h.querySelector(".info").setAttribute("aria-expanded", "false"); }
    });
    if (btn) {
      const open = btn.parentElement.classList.toggle("open");
      btn.setAttribute("aria-expanded", String(open));
    }
  });
}

function renderCard(id, view, staleTime) {
  const card = document.getElementById("card-" + id);
  const body = card.querySelector(".card-body");
  if (charts.has(id)) { charts.get(id).destroy(); charts.delete(id); }

  const notes = [];
  if (staleTime) notes.push(`<div class="note warn">Couldn't load — showing last value from ${esc(fmt.dateTime(staleTime))}</div>`);
  if (view.note) notes.push(`<div class="note">${esc(view.note)}</div>`);

  body.innerHTML = `
    <div class="value-row">
      <div class="value">${esc(view.value)}${view.unit ? `<span class="unit">${esc(view.unit)}</span>` : ""}</div>
      <span class="pill pill-${esc(view.signal.color)}">${esc(view.signal.label)}</span>
    </div>
    <div class="sub">${esc(view.sub || "")}</div>
    ${view.html ? `<div class="custom">${view.html}</div>` : `<div class="chart"><canvas></canvas></div>`}
    ${notes.join("")}`;
  if (view.chart) charts.set(id, drawLine(body.querySelector("canvas"), view.chart));
  card.removeAttribute("aria-busy");
  card.classList.toggle("is-stale", !!staleTime);
}

function renderError(id, err) {
  const card = document.getElementById("card-" + id);
  if (charts.has(id)) { charts.get(id).destroy(); charts.delete(id); }
  card.querySelector(".card-body").innerHTML = `
    <div class="error">
      <div class="pill pill-gray">Unavailable</div>
      <p>Couldn't load this indicator, and there's no saved value yet. Try Refresh in a minute.</p>
      <small>${esc(err && err.message ? err.message : String(err))}</small>
    </div>`;
  card.removeAttribute("aria-busy");
}

/* ---------- Refresh ---------- */

let refreshing = false;

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  const btn = document.getElementById("refresh");
  btn.disabled = true;
  btn.classList.add("loading");

  const pending = {};
  const get = (key) => (pending[key] ??= loadSource(key));

  const header = get("ticker").then(renderHeader).catch((e) => {
    console.error(e);
    document.getElementById("price").textContent = "Price unavailable";
  });

  const jobs = Object.entries(CARDS).map(async ([id, def]) => {
    try {
      const data = {};
      let stale = 0;
      for (const [key, res] of await Promise.all(def.needs.map(async (k) => [k, await get(k)]))) {
        data[key] = res.data;
        if (res.stale) stale = stale ? Math.min(stale, res.time) : res.time;
      }
      for (const key of def.optional || []) {
        try { data[key] = (await get(key)).data; } catch { data[key] = null; }
      }
      renderCard(id, def.compute(data), stale);
    } catch (err) {
      console.error(`[card ${id}]`, err);
      renderError(id, err);
    }
  });

  await Promise.allSettled([header, ...jobs]);
  document.getElementById("updated").textContent = "Last updated " + new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  btn.disabled = false;
  btn.classList.remove("loading");
  refreshing = false;
}

function renderHeader(res) {
  const { price, change24h } = res.data;
  document.getElementById("price").textContent = fmt.usd(price);
  const ch = document.getElementById("change");
  ch.textContent = fmt.pct(change24h, 2) + " 24h";
  ch.className = "change " + (change24h >= 0 ? "up" : "down");
  ch.hidden = false;
  document.getElementById("price-stale").hidden = !res.stale;
}

document.addEventListener("DOMContentLoaded", () => {
  buildLayout();
  document.getElementById("refresh").addEventListener("click", refresh);
  refresh();
});
