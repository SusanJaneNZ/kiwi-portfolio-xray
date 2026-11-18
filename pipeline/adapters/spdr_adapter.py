"""Adapter for State Street SPDR Master ETF constituent disclosures (e.g. SPEM)."""

from __future__ import annotations

import hashlib
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
from pipeline.adapters.tabular_reader import read_tabular_rows

SPDR_MASTER_TICKERS = {"SPEM", "SPY", "SPLG", "MDY", "DIA"}

SPDR_FUND_NAMES = {
    "SPEM": "State Street SPDR Portfolio Emerging Markets ETF",
    "SPY": "SPDR S&P 500 ETF Trust",
    "SPLG": "SPDR Portfolio S&P 500 ETF",
    "MDY": "SPDR S&P MidCap 400 ETF Trust",
    "DIA": "SPDR Dow Jones Industrial Average ETF Trust",
}

CURRENCY_TO_COUNTRY = {
    "TWD": "Taiwan",
    "HKD": "China",
    "CNY": "China",
    "INR": "India",
    "BRL": "Brazil",
    "ZAR": "South Africa",
    "KRW": "South Korea",
    "MXN": "Mexico",
    "THB": "Thailand",
    "MYR": "Malaysia",
    "IDR": "Indonesia",
    "SAR": "Saudi Arabia",
    "AED": "United Arab Emirates",
    "QAR": "Qatar",
    "KWD": "Kuwait",
    "CLP": "Chile",
    "COP": "Colombia",
    "TRY": "Turkey",
    "PLN": "Poland",
    "HUF": "Hungary",
    "CZK": "Czech Republic",
    "EGP": "Egypt",
    "PHP": "Philippines",
    "USD": "United States",
    "EUR": "Europe",
    "GBP": "United Kingdom",
    "SGD": "Singapore",
    "RUB": "Russia",
}

DISCLAIMER_KEYWORDS = (
    "state street global advisors",
    "performance data",
    "portfolio holdings",
    "bonds generally present",
    "not fdic insured",
    "doubleline",
    "distributor: state street",
    "before investing in a fund",
)


class SPDRAdapter(BaseAdapter):
    """Parses State Street SPDR product constituent disclosures (XLSX or CSV)."""

    def can_handle(self, file_path: Path) -> bool:
        if file_path.suffix.lower() not in {".csv", ".xlsx"}:
            return False
        if file_path.parent.name.lower() == "spdr":
            return True
        name = file_path.name.upper()
        if "SPDR" in name or "SSGA" in name:
            return True
        return any(ticker in name for ticker in SPDR_MASTER_TICKERS)

    def parse(self, file_path: Path) -> FundExtractionResult:
        fund_ticker = self._extract_ticker(file_path.name) or "SPEM"
        fund_name = SPDR_FUND_NAMES.get(fund_ticker, f"SPDR {fund_ticker} ETF")

        rows = read_tabular_rows(file_path)
        if not rows:
            raise ValueError(f"SPDR file '{file_path.name}' is empty or unreadable.")

        effective_date = "2026-11-16"
        header: Optional[list[str]] = None
        col_map: dict[str, int] = {}
        weight_col = -1
        weight_is_pct = True

        holdings: list[RawHolding] = []
        raw_total_equity_weight = 0.0

        for row in rows:
            if not row or not any(c.strip() for c in row):
                continue

            normalized_row = [c.strip().lower() for c in row]
            first_cell = normalized_row[0]

            # Stop once footer disclaimer begins
            if header and any(kw in first_cell for kw in DISCLAIMER_KEYWORDS):
                break

            if not header:
                row_str = " ".join(row)
                # Check for metadata
                if "ticker" in first_cell and len(row) > 1:
                    val = row[1].strip().upper()
                    if val in SPDR_MASTER_TICKERS or len(val) in {3, 4, 5}:
                        fund_ticker = val
                        fund_name = SPDR_FUND_NAMES.get(fund_ticker, f"SPDR {fund_ticker} ETF")
                if "fund name" in first_cell and len(row) > 1:
                    fn = row[1].strip()
                    if fn:
                        fund_name = fn

                parsed_date = parse_effective_date(row_str)
                if parsed_date:
                    effective_date = parsed_date

                # Check for header row
                if "name" in normalized_row and ("weight" in normalized_row or "sedol" in normalized_row or "ticker" in normalized_row):
                    header = normalized_row
                    col_map = {name_k: idx for idx, name_k in enumerate(header)}
                    for idx, col in enumerate(header):
                        if "weight" in col or "%" in col or "percent" in col:
                            weight_col = idx
                            weight_is_pct = "%" in col or "percent" in col or True
                            break
                    continue
                continue

            # Parsing holding row
            try:
                name_col = col_map.get("name", 0)
                name = row[name_col].strip() if len(row) > name_col else ""
                lower_name = name.lower()
                if not name or lower_name.startswith("total") or any(kw in lower_name for kw in ("cash", "collateral", "margin", "reserve", "money market")):
                    continue

                if weight_col == -1 or len(row) <= weight_col:
                    continue

                weight = parse_percentage(row[weight_col], column_is_percent=weight_is_pct)
                if weight <= 0.0:
                    continue

                ticker_col = col_map.get("ticker", -1)
                ticker = row[ticker_col].strip() if ticker_col != -1 and len(row) > ticker_col else None
                if ticker in {"-", "--", "N/A", "n/a", ""}:
                    ticker = None

                ident_col = col_map.get("identifier", -1)
                identifier = row[ident_col].strip() if ident_col != -1 and len(row) > ident_col else None
                if identifier in {"-", "--", "N/A", "n/a", ""}:
                    identifier = None

                sedol_col = col_map.get("sedol", -1)
                sedol = row[sedol_col].strip() if sedol_col != -1 and len(row) > sedol_col else None
                if sedol in {"-", "--", "N/A", "n/a", ""}:
                    sedol = None

                # Derive ISIN (prefer real 12-char ISIN, then SEDOL to align with Vanguard Global VT, then CUSIP)
                isin = None
                if identifier and len(identifier) == 12 and re.match(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$", identifier):
                    isin = identifier
                elif sedol:
                    isin = f"SEDOL:{sedol}"
                elif identifier and len(identifier) == 9:
                    isin = f"US{identifier}0"
                elif ticker:
                    isin = f"SPDR:{ticker}"
                else:
                    digest = hashlib.sha1(f"{ticker or ''}:{name}".encode("utf-8")).hexdigest()[:10].upper()
                    isin = f"SPDR:{digest}"

                currency_col = next((idx for k, idx in col_map.items() if "currency" in k), -1)
                currency = row[currency_col].strip() if currency_col != -1 and len(row) > currency_col else None
                country = CURRENCY_TO_COUNTRY.get(currency or "", "Global")

                sector_col = col_map.get("sector", -1)
                sector = row[sector_col].strip() if sector_col != -1 and len(row) > sector_col else None
                if sector in {"-", "--", "N/A", "n/a", ""}:
                    sector = None

                holdings.append(
                    RawHolding(
                        name=name,
                        weight=weight,
                        isin=isin,
                        ticker=ticker,
                        sedol=sedol,
                        country=country,
                        sector=sector,
                        effective_date=effective_date,
                    )
                )
                raw_total_equity_weight += weight
            except (ValueError, IndexError):
                continue

        # Normalize master ETF equity basket constituents to sum to exactly 1.0
        if raw_total_equity_weight > 0 and abs(raw_total_equity_weight - 1.0) > 1e-6:
            for h in holdings:
                h.weight = h.weight / raw_total_equity_weight

        return FundExtractionResult(
            fund_code=fund_ticker,
            fund_name=fund_name,
            provider="SPDR",
            effective_date=effective_date,
            holdings=holdings,
            cash_ratio=0.0,
            hedging_ratio=0.0,
            is_master=True,
            source_file=file_path.name,
        )

    def _extract_ticker(self, filename: str) -> Optional[str]:
        name_upper = filename.upper()
        for t in SPDR_MASTER_TICKERS:
            if t in name_upper:
                return t
        return None
