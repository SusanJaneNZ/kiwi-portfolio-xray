"""
Fetch end-of-day closing prices for NZX equities, Smartshares/BetaShares ETFs,
and liquid ASX equities from Yahoo Finance and write `public/data/prices.json`.

Usage:
    python -m pipeline.fetch_prices --output public/data/prices.json
    python -m pipeline.fetch_prices --output public/data/prices.json --limit 20
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def collect_target_tickers(data_dir: Path) -> list[str]:
    """Return deduplicated sorted list of NZX equities, listed ETFs, and liquid ASX equities."""
    tickers: set[str] = set()

    direct_path = data_dir / "direct_equities.json"
    funds_path = data_dir / "funds_registry.json"
    constituents_path = data_dir / "constituents.json"

    fund_isins: set[str] = set()
    if constituents_path.exists():
        constituents = json.loads(constituents_path.read_text(encoding="utf-8"))
        for rows in constituents.values():
            for row in rows:
                isin = row.get("isin")
                if isinstance(isin, str) and isin:
                    fund_isins.add(isin)

    if direct_path.exists():
        direct_equities = json.loads(direct_path.read_text(encoding="utf-8"))
        for item in direct_equities:
            ticker = (item.get("ticker") or "").strip().upper()
            exchange = (item.get("exchange") or "").strip().upper()
            if not ticker:
                continue
            if exchange == "NZX":
                tickers.add(ticker if "." in ticker else f"{ticker}.NZ")
            elif exchange == "ASX" and item.get("isin") in fund_isins:
                tickers.add(ticker if "." in ticker else f"{ticker}.AX")

    if funds_path.exists():
        funds = json.loads(funds_path.read_text(encoding="utf-8"))
        for fund in funds:
            provider = (fund.get("provider") or "").strip().lower()
            code = (fund.get("code") or "").strip().upper()
            if not code:
                continue
            if provider == "smartshares":
                tickers.add(f"{code}.NZ")
            elif provider == "betashares":
                tickers.add(f"{code}.AX")

    return sorted(tickers)


def fetch_single_price(ticker: str, retries: int = 2) -> tuple[str, float | None]:
    """Fetch the latest closing/market price for a single ticker from Yahoo Finance."""
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/"
        f"{urllib.parse.quote(ticker, safe='')}?interval=1d&range=5d"
    )
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )

    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status != 200:
                    continue
                payload = json.loads(resp.read().decode("utf-8"))
                meta = payload.get("chart", {}).get("result", [{}])[0].get("meta", {})
                raw_price = meta.get("regularMarketPrice")
                if raw_price is None:
                    raw_price = meta.get("previousClose")
                if raw_price is None:
                    raw_price = meta.get("chartPreviousClose")
                if isinstance(raw_price, (int, float)) and raw_price > 0:
                    return ticker, round(float(raw_price), 4)
                return ticker, None
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < retries:
                time.sleep(1.5 * (attempt + 1))
                continue
            if exc.code == 404:
                return ticker, None
        except Exception:
            if attempt < retries:
                time.sleep(0.5 * (attempt + 1))
                continue
    return ticker, None


def run_fetch(data_dir: Path, output_path: Path, limit: int | None = None, workers: int = 6) -> dict:
    existing_prices: dict[str, float] = {}
    if output_path.exists():
        try:
            prev = json.loads(output_path.read_text(encoding="utf-8"))
            if isinstance(prev.get("prices"), dict):
                existing_prices = {
                    k: float(v)
                    for k, v in prev["prices"].items()
                    if isinstance(v, (int, float)) and v > 0
                }
        except Exception:
            pass

    tickers = collect_target_tickers(data_dir)
    if limit is not None and limit > 0:
        tickers = tickers[:limit]

    fetched: dict[str, float] = {}
    failed = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fetch_single_price, t): t for t in tickers}
        for future in concurrent.futures.as_completed(futures):
            ticker, price = future.result()
            if price is not None:
                fetched[ticker] = price
            else:
                failed += 1

    # Merge onto previous prices so a transient miss doesn't drop a valid prior quote
    merged = {**existing_prices, **fetched}
    now_utc = datetime.now(timezone.utc)
    result = {
        "date": now_utc.strftime("%Y-%m-%d"),
        "updatedAt": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Yahoo Finance (End-of-Day)",
        "count": len(merged),
        "prices": dict(sorted(merged.items())),
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(
        f"Fetched {len(fetched)}/{len(tickers)} tickers ({failed} missed); "
        f"wrote {len(merged)} total prices to {output_path}"
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch end-of-day NZX/ASX prices from Yahoo Finance.")
    parser.add_argument("--data-dir", type=Path, default=Path("public/data"))
    parser.add_argument("--output", type=Path, default=Path("public/data/prices.json"))
    parser.add_argument("--limit", type=int, default=None, help="Optional cap on ticker count for testing")
    parser.add_argument("--workers", type=int, default=6, help="Concurrent worker threads")
    args = parser.parse_args()

    result = run_fetch(args.data_dir, args.output, limit=args.limit, workers=args.workers)
    return 0 if result["count"] > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
