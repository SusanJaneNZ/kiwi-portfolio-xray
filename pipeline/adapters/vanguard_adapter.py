"""Adapter for Vanguard US Master ETF constituent disclosures (e.g. VT, VOO, VGK, VPL, VWO)."""

from __future__ import annotations

import csv
import hashlib
from pathlib import Path
from typing import Optional

from pipeline.adapters.base import (
    BaseAdapter,
    FundExtractionResult,
    RawHolding,
    parse_effective_date,
    parse_percentage,
)

MASTER_TICKERS = {"VT", "VOO", "VGK", "VPL", "VWO"}

FUND_NAME_HINTS = {
    "TOTAL WORLD": "VT",
    "TOTAL_WORLD": "VT",
    "S&P 500": "VOO",
    "S&P_500": "VOO",
    "SP 500": "VOO",
    "FTSE EUROPE": "VGK",
    "FTSE_EUROPE": "VGK",
    "FTSE PACIFIC": "VPL",
    "FTSE_PACIFIC": "VPL",
    "EMERGING MARKETS": "VWO",
    "EMERGING_MARKETS": "VWO",
}

NAME_HEADER_CANDIDATES = {"company name", "holding name", "holdings", "security name", "name", "holding"}


class VanguardAdapter(BaseAdapter):
    """Parses Vanguard US constituent CSV exports."""

    def can_handle(self, file_path: Path) -> bool:
        name = file_path.name.upper()
        if any(ticker in name for ticker in MASTER_TICKERS):
            return True
        if "VANGUARD" in name or "HOLDINGS_DETAILS" in name or "HOLDINGS DETAILS" in name:
            return True
        return any(hint in name for hint in FUND_NAME_HINTS)

    def parse(self, file_path: Path) -> FundExtractionResult:
        fund_ticker = self._extract_ticker_from_text(file_path.name) or "VT"
        fund_name = f"Vanguard {fund_ticker} ETF"

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

                # Detect header row when a name column and a weight/ticker column co-occur
                if not header:
                    has_name_col = any(c in NAME_HEADER_CANDIDATES for c in normalized_row)
                    has_metric_col = any(
                        "weight" in c or "%" in c or "percent" in c or "ticker" in c or "symbol" in c or "market value" in c
                        for c in normalized_row
                    )
                    if has_name_col and has_metric_col:
                        header = normalized_row
                        col_map = {name_k: idx for idx, name_k in enumerate(header)}
                        weight_col, weight_header_is_percent = self._find_weight_column(header)
                        continue

                    # Inspect metadata lines for fund ticker and effective date
                    row_str = " ".join(row)
                    detected = self._extract_ticker_from_text(row_str)
                    if detected:
                        fund_ticker = detected
                        fund_name = f"Vanguard {fund_ticker} ETF"
                    parsed_date = parse_effective_date(row_str)
                    if parsed_date:
                        effective_date = parsed_date
                    continue

                try:
                    name_col = next((col_map[k] for k in NAME_HEADER_CANDIDATES if k in col_map), 0)
                    name = row[name_col].strip() if len(row) > name_col else ""
                    name_lower = name.lower()
                    if (
                        not name
                        or name_lower.startswith("total")
                        or "cash" in name_lower
                        or "short-term reserves" in name_lower
                        or "currency" in name_lower
                    ):
                        continue

                    if weight_col == -1 or len(row) <= weight_col:
                        continue
                    weight = parse_percentage(row[weight_col], column_is_percent=weight_header_is_percent)
                    if weight <= 0.0:
                        continue

                    ticker_col = next((idx for k, idx in col_map.items() if "ticker" in k or "symbol" in k), -1)
                    ticker = row[ticker_col].strip() if ticker_col != -1 and len(row) > ticker_col else None

                    cusip_col = col_map.get("cusip", -1)
                    cusip = row[cusip_col].strip() if cusip_col != -1 and len(row) > cusip_col else None
                    if cusip in {"", "-", "—"}:
                        cusip = None

                    sedol_col = col_map.get("sedol", -1)
                    sedol = row[sedol_col].strip() if sedol_col != -1 and len(row) > sedol_col else None
                    if sedol in {"", "-", "—"}:
                        sedol = None

                    isin_col = col_map.get("isin", -1)
                    isin = row[isin_col].strip() if isin_col != -1 and len(row) > isin_col else None
                    if isin in {"", "-", "—"}:
                        isin = None

                    if not isin:
                        if cusip and len(cusip) == 9:
                            isin = f"US{cusip}0"
                        elif sedol:
                            isin = f"SEDOL:{sedol}"
                        else:
                            # Deterministic unique ID when vendor export omits ISIN/CUSIP/SEDOL
                            digest = hashlib.sha1(f"{ticker or ''}:{name}".encode("utf-8")).hexdigest()[:10].upper()
                            isin = f"VANG:{ticker or digest}"

                    country_col = next(
                        (idx for k, idx in col_map.items() if k in {"country", "market", "location"}),
                        -1,
                    )
                    country = row[country_col].strip() if country_col != -1 and len(row) > country_col else None

                    sector_col = next((idx for k, idx in col_map.items() if "sector" in k), -1)
                    sector = row[sector_col].strip() if sector_col != -1 and len(row) > sector_col else None

                    holdings.append(
                        RawHolding(
                            name=name,
                            weight=weight,
                            isin=isin,
                            ticker=ticker,
                            cusip=cusip,
                            sedol=sedol,
                            country=country,
                            sector=sector,
                            effective_date=effective_date,
                        )
                    )
                    raw_total_equity_weight += weight

                except (ValueError, IndexError):
                    continue

        # Normalize master ETF equity constituents to sum to 1.0 of the equity basket
        if raw_total_equity_weight > 0 and abs(raw_total_equity_weight - 1.0) > 0.001:
            for h in holdings:
                h.weight = h.weight / raw_total_equity_weight

        return FundExtractionResult(
            fund_code=fund_ticker,
            fund_name=fund_name,
            provider="Vanguard",
            effective_date=effective_date,
            holdings=holdings,
            cash_ratio=0.0,
            hedging_ratio=0.0,
            is_master=True,
            source_file=file_path.name,
        )

    def _find_weight_column(self, header: list[str]) -> tuple[int, bool]:
        for idx, col in enumerate(header):
            if "weight" in col or "%" in col or "percent" in col:
                is_pct = "%" in col or "percent" in col
                return idx, is_pct
        return -1, False

    def _extract_ticker_from_text(self, text: str) -> Optional[str]:
        upper = text.upper()
        for ticker in MASTER_TICKERS:
            if ticker in upper:
                return ticker
        for hint, ticker in FUND_NAME_HINTS.items():
            if hint in upper:
                return ticker
        return None
