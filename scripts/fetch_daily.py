#!/usr/bin/env python3
"""
Daily data fetch, run by GitHub Actions (.github/workflows/daily.yml).

Writes:
  data/onchain.json     MVRV Z-score, NUPL and SOPR from bitcoin-data.com (3 API calls)
  data/oi-history.json  appends one Hyperliquid BTC open-interest snapshot

Standard library only. If one source fails, the previous data for it is kept,
so a bad day never wipes the dashboard. Exits with an error only if
everything failed.
"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
ONCHAIN_PATH = os.path.join(DATA, "onchain.json")
OI_PATH = os.path.join(DATA, "oi-history.json")

KEEP_DAYS = 730  # on-chain history kept in the file (~2 years)
UA = {"User-Agent": "btc-dashboard-daily/1.0", "Accept": "application/json"}

# metric name in our file -> (bitcoin-data.com path, field in each row)
ONCHAIN = {
    "mvrv": ("mvrv-zscore", "mvrvZscore"),
    "nupl": ("nupl", "nupl"),
    "sopr": ("sopr", "sopr"),
}


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def http_json(url, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    headers = dict(UA)
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def read_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
        f.write("\n")
    os.replace(tmp, path)


def update_onchain():
    current = read_json(ONCHAIN_PATH, {"metrics": {}})
    metrics = current.get("metrics", {})
    ok = 0
    for name, (path, field) in ONCHAIN.items():
        try:
            rows = http_json(f"https://bitcoin-data.com/v1/{path}")
            series = [
                [r["d"], round(float(r[field]), 5)]
                for r in rows
                if r.get("d") and r.get(field) is not None
            ]
            series.sort(key=lambda x: x[0])
            if not series:
                raise ValueError("empty series")
            series = series[-KEEP_DAYS:]
            metrics[name] = {"asOf": series[-1][0], "series": series}
            ok += 1
            print(f"on-chain {name}: {len(series)} rows, latest {series[-1]}")
        except Exception as e:  # keep yesterday's data for this metric
            print(f"WARNING on-chain {name} failed: {e}", file=sys.stderr)
    write_json(ONCHAIN_PATH, {
        "updated": now_iso() if ok else current.get("updated"),
        "source": "https://bitcoin-data.com",
        "metrics": metrics,
    })
    return ok


def update_oi():
    try:
        meta, ctxs = http_json("https://api.hyperliquid.xyz/info", {"type": "metaAndAssetCtxs"})
        i = [u["name"] for u in meta["universe"]].index("BTC")
        ctx = ctxs[i]
        oi_btc = float(ctx["openInterest"])
        mark = float(ctx["markPx"])
    except Exception as e:
        print(f"WARNING open interest failed: {e}", file=sys.stderr)
        return 0
    hist = read_json(OI_PATH, {"snapshots": []})
    snaps = hist.get("snapshots", [])
    snap = {"t": now_iso(), "oi_btc": round(oi_btc, 4), "oi_usd": round(oi_btc * mark), "mark": mark}
    snaps.append(snap)
    write_json(OI_PATH, {"source": "https://api.hyperliquid.xyz/info", "snapshots": snaps})
    print(f"open interest: {snap}")
    return 1


if __name__ == "__main__":
    results = [update_onchain(), update_oi()]
    if not any(results):
        sys.exit("Every source failed")
