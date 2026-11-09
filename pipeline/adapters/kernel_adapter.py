"""Adapter for Kernel Wealth index fund constituent disclosures."""

from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Optional

from pipeline.adapters.base import BaseAdapter, FundExtractionResult, RawHolding, parse_percentage

KERNEL_FUND_NAMES = {
    "KERNEL_NZ_50": "Kernel NZ 50 ESG Tilted Fund",
    "KERNEL_AUS_LEADERS": "Kernel S&P Kensho Australian Leaders Fund",
    "KERNEL_GLOBAL_100": "Kernel S&P Global 100 Fund",
    "KERNEL_WORLD_EX_US": "Kernel S&P World Ex-U.S. Fund",
    "KERNEL_CLEAN_ENERGY": "Kernel Global Clean Energy Fund",
    "KERNEL_HIGH_DIVIDEND": "Kernel NZ High Dividend Fund",
}


class KernelAdapter(BaseAdapter):
    """Parses Kernel Wealth monthly fund portfolio disclosures."""

    def can_handle(self, file_path: Path) -> bool:
        name = file_path.name.upper()
        return "KERNEL" in name

    def parse(self, file_path: Path) -> FundExtractionResult:
        fund_code = self._extract_code_from_filename(file_path.name)
        fund_name = KERNEL_FUND_NAMES.get(fund_code, f"Kernel {fund_code.replace('_', ' ').title()}")

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

                # Detect header
                if any("company" in c or "security" in c or "holding" in c or "name" in c for c in normalized_row) and any(
                    "weight" in c or "%" in c or "value" in c for c in normalized_row
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
                    name_col = next(
                        (idx for k, idx in col_map.items() if "company" in k or "name" in k or "security" in k or "holding" in k),
                        0,
                    )
                    ticker_col = next(
                        (idx for k, idx in col_map.items() if "ticker" in k or "symbol" in k or "code" in k),
                        -1,
                    )

                    name = row[name_col].strip() if len(row) > name_col else ""
                    ticker = row[ticker_col].strip() if ticker_col != -1 and len(row) > ticker_col else None

                    if not name and ticker:
                        name = ticker

                    if not name or name.lower().startswith("total"):
                        continue

                    # Weight extraction
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
            provider="Kernel",
            effective_date=effective_date,
            holdings=holdings,
            cash_ratio=cash_ratio,
            hedging_ratio=0.0,
            is_master=False,
            source_file=file_path.name,
        )

    def _extract_code_from_filename(self, filename: str) -> str:
        upper = filename.upper().replace("-", "_")
        for code in KERNEL_FUND_NAMES:
            if code in upper:
                return code
        # Extract a sane identifier
        clean = re.sub(r"[^A-Z0-9_]", "", upper)
        return clean.replace(".CSV", "").replace("CSV", "")
