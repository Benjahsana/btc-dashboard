/*
 * Indicator math. All functions take a plain array of numbers
 * (oldest → newest) and return an array of the same length,
 * with null where there isn't enough history yet.
 */

const Ind = {
  sma(values, n) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= n) sum -= values[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  },

  // Exponential moving average, seeded with the simple average of the first n values
  ema(values, n) {
    const out = new Array(values.length).fill(null);
    if (values.length < n) return out;
    const k = 2 / (n + 1);
    let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
    out[n - 1] = prev;
    for (let i = n; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  },

  // Wilder's RSI
  rsi(values, n = 14) {
    const out = new Array(values.length).fill(null);
    if (values.length <= n) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= n; i++) {
      const d = values[i] - values[i - 1];
      if (d > 0) gain += d; else loss -= d;
    }
    gain /= n; loss /= n;
    const calc = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
    out[n] = calc();
    for (let i = n + 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      gain = (gain * (n - 1) + Math.max(d, 0)) / n;
      loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
      out[i] = calc();
    }
    return out;
  },

  last(arr) {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
    return null;
  },

  // Pick the band whose upTo the value is below (last band = catch-all)
  band(value, bands) {
    return bands.find((b) => b.upTo === undefined || value < b.upTo);
  },
};
