"""Adapter for iShares (BlackRock) Master ETF constituent disclosures (e.g. IWLD, IVV)."""

from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Optional

from pipeline.adapters.base import (
    BaseAdapter,
    FundExtractionResult,
    RawHolding,
    parse_effective_date,
    parse_percentage,
)

ISHARES_MASTER_TICKERS = {"IWLD", "IVV"}


class ISharesAdapter(BaseAdapter):
    """Parses iShares product constituent CSV exports."""

    def can_handle(self, file_path: Path) -> bool:
        if file_path.suffix.lower() != ".csv":
            return False
        if file_path.parent.name.lower() == "ishares":
            return True
        name = file_path.name.upper()
        if "ISHARES" in name or "HOLDINGS" in name or "BLACKROCK" in name:
            return any(ticker in name for ticker in ISHARES_MASTER_TICKERS)
        return False

    def parse(self, file_path: Path) -> FundExtractionResult:
        fund_ticker = self._extract_ticker_from_filename(file_path.name)
        fund_name = f"iShares {fund_ticker} ETF"

        holdings: list[RawHolding] = []
        effective_date = "2026-10-31"
        raw_total_equity_weight = 0.0

        with open(file_path, mode="r", encoding="utf-8-sig", errors="replace") as f:
            reader = csv.reader(f)
            header: Optional[list[str]] = None
            col_map: dict[str, int] = {}
            weight_col = -1
            weight_header_is_percent = False

            for row in reader:
                if not row or not any(row):
                    continue

                normalized_row = [c.strip().lower() for c in row]

                if not header:
                    if ("name" in normalized_row or "holding name" in normalized_row) and (
                        "isin" in normalized_row
                        or "weight (%)" in normalized_row
                        or "weight" in normalized_row
                        or "ticker" in normalized_row
                    ):
                        header = normalized_row
                        col_map = {name_k: idx for idx, name_k in enumerate(header)}
                        for idx, col in enumerate(header):
                            if "weight" in col or "%" in col or "percent" in col:
                                weight_col = idx
                                weight_header_is_percent = "%" in col or "percent" in col
                                break
                        continue

                    row_str = " ".join(row)
                    parsed_date = parse_effective_date(row_str)
                    if parsed_date:
                        effective_date = parsed_date
                    continue

                try:
                    name_col = col_map.get("name", col_map.get("holding name", 1))
                    name = row[name_col].strip() if len(row) > name_col else ""
                    if not name or name.lower().startswith("cash") or name.lower().startswith("total"):
                        continue

                    asset_col = next((idx for k, idx in col_map.items() if "asset" in k or "class" in k), -1)
                    if asset_col != -1 and len(row) > asset_col:
                        asset_val = row[asset_col].strip().lower()
                        if any(tok in asset_val for tok in ("cash", "futures", "derivative", "money market")) or asset_val == "fx":
                            continue

                    sector_col = next((idx for k, idx in col_map.items() if "sector" in k), -1)
                    sector = row[sector_col].strip() if sector_col != -1 and len(row) > sector_col else None
                    if sector and any(tok in sector.lower() for tok in ("cash", "derivative")):
                        continue

                    if weight_col == -1 or len(row) <= weight_col:
                        continue
                    weight = parse_percentage(row[weight_col], column_is_percent=weight_header_is_percent)
                    if weight <= 0.0:
                        continue

                    ticker_col = col_map.get("ticker", -1)
                    ticker = row[ticker_col].strip() if ticker_col != -1 and len(row) > ticker_col else None

                    isin_col = col_map.get("isin", -1)
                    isin = row[isin_col].strip() if isin_col != -1 and len(row) > isin_col else None
                    if isin in {"", "-", "--", "---"}:
                        isin = None

                    country_col = next((idx for k, idx in col_map.items() if "location" in k or "country" in k), -1)
                    country = row[country_col].strip() if country_col != -1 and len(row) > country_col else None

                    holdings.append(
                        RawHolding(
                            name=name,
                            weight=weight,
                            isin=isin,
                            ticker=ticker,
                            country=country,
                            sector=sector,
                            effective_date=effective_date,
                        )
                    )
                    raw_total_equity_weight += weight

                except (ValueError, IndexError):
                    continue

        # Normalize master ETF equity constituents to sum to 1.0 of the equity basket
        if raw_total_equity_weight > 0 and abs(raw_total_equity_weight - 1.0) > 1e-6:
            for h in holdings:
                h.weight = h.weight / raw_total_equity_weight

        return FundExtractionResult(
            fund_code=fund_ticker,
            fund_name=fund_name,
            provider="iShares",
            effective_date=effective_date,
            holdings=holdings,
            cash_ratio=0.0,
            hedging_ratio=0.0,
            is_master=True,
            source_file=file_path.name,
        )

    def _extract_ticker_from_filename(self, filename: str) -> str:
        upper = Path(filename).stem.upper()
        for ticker in ISHARES_MASTER_TICKERS:
            if ticker in upper:
                return ticker
        prefix_match = re.match(r"^([A-Z0-9]{2,6})(?:[_\-\s]|$)", upper)
        if prefix_match:
            return prefix_match.group(1)
        return "IWLD"
