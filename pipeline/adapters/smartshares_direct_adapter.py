"""Adapter for Smartshares Direct Equity Funds (e.g. FNZ, MDZ, NZG, OZY, ASD)."""

from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Optional

from pipeline.adapters.base import BaseAdapter, FundExtractionResult, RawHolding, parse_percentage

SMARTSHARES_DIRECT_FUNDS = {
    "FNZ": "Smartshares NZ Top 50 ETF",
    "MDZ": "Smartshares NZ Mid Cap ETF",
    "NZG": "Smartshares NZ Dividend ETF",
    "OZY": "Smartshares Australian Top 20 ETF",
    "ASD": "Smartshares Australian Dividend ETF",
}


class SmartsharesDirectAdapter(BaseAdapter):
    """Parses Smartshares direct equity portfolio holding CSVs."""

    def can_handle(self, file_path: Path) -> bool:
        name = file_path.name.upper()
        if "SMARTSHARES" in name or any(f"{f}_" in name or f"_{f}." in name or f"_{f}_" in name for f in SMARTSHARES_DIRECT_FUNDS):
            return any(code in name for code in SMARTSHARES_DIRECT_FUNDS)
        return False

    def parse(self, file_path: Path) -> FundExtractionResult:
        fund_code = self._extract_code_from_filename(file_path.name)
        fund_name = SMARTSHARES_DIRECT_FUNDS.get(fund_code, f"Smartshares {fund_code} ETF")

        holdings: list[RawHolding] = []
        effective_date = "2026-10-31"
        cash_ratio = 0.0

        with open(file_path, mode="r", encoding="utf-8-sig", errors="replace") as f:
            reader = csv.reader(f)
            header: Optional[list[str]] = None
            col_map: dict[str, int] = {}

            for row in reader:
                if not row or not any(row):
                    continue

                normalized_row = [c.strip().lower() for c in row]

                # Check for header
                if any("security" in c or "ticker" in c or "code" in c for c in normalized_row) and any(
                    "weight" in c or "percent" in c or "%" in c or "market value" in c for c in normalized_row
                ):
                    header = normalized_row
                    col_map = {c: idx for idx, c in enumerate(header)}
                    continue

                if not header:
                    row_str = " ".join(row)
                    date_match = re.search(r"\b(202\d[-/]\d{1,2}[-/]\d{1,2})\b", row_str)
                    if date_match:
                        effective_date = date_match.group(1).replace("/", "-")
                    continue

                try:
                    # Find name column
                    name_col = next(
                        (idx for k, idx in col_map.items() if "desc" in k or "name" in k or "security name" in k),
                        -1,
                    )
                    ticker_col = next(
                        (idx for k, idx in col_map.items() if "code" in k or "ticker" in k or "symbol" in k),
                        -1,
                    )

                    name = row[name_col].strip() if name_col != -1 and len(row) > name_col else ""
                    ticker = row[ticker_col].strip() if ticker_col != -1 and len(row) > ticker_col else None

                    # If name is empty, fall back to ticker or vice versa
                    if not name and ticker:
                        name = ticker

                    if not name:
                        continue

                    # Extract weight
                    weight_col = next((idx for k, idx in col_map.items() if "weight" in k or "%" in k), -1)
                    if weight_col == -1 or len(row) <= weight_col:
                        continue
                    weight = parse_percentage(row[weight_col])
                    if weight <= 0.0:
                        continue

                    # Detect cash rows
                    name_lower = name.lower()
                    if "cash" in name_lower or "nzd cash" in name_lower or "aud cash" in name_lower:
                        cash_ratio += weight
                        continue

                    if name_lower.startswith("total"):
                        continue

                    holdings.append(
                        RawHolding(
                            name=name,
                            weight=weight,
                            ticker=ticker,
                            effective_date=effective_date,
                        )
                    )

                except (ValueError, IndexError):
                    continue

        return FundExtractionResult(
            fund_code=fund_code,
            fund_name=fund_name,
            provider="Smartshares",
            effective_date=effective_date,
            holdings=holdings,
            cash_ratio=cash_ratio,
            hedging_ratio=0.0,
            is_master=False,
            source_file=file_path.name,
        )

    def _extract_code_from_filename(self, filename: str) -> str:
        upper = filename.upper()
        for code in SMARTSHARES_DIRECT_FUNDS:
            if code in upper:
                return code
        return "FNZ"
