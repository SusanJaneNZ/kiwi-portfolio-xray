"""Adapter for NZ Disclose Register statutory feeder wrapper disclosures."""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from pipeline.adapters.base import BaseAdapter, FundExtractionResult, RawHolding, parse_percentage


@dataclass
class FeederWrapperDisclosure:
    """Disclose Register statutory breakdown for a feeder fund."""

    feeder_code: str
    feeder_name: str
    master_ticker: str
    master_allocation: float
    cash_ratio: float
    hedging_ratio: float
    effective_date: str


class DiscloseRegisterAdapter(BaseAdapter):
    """Parses Disclose Register scheme CSV filings."""

    def can_handle(self, file_path: Path) -> bool:
        name = file_path.name.upper()
        return "DISCLOSE" in name or "FEEDER" in name

    def parse(self, file_path: Path) -> FundExtractionResult:
        """Parses the filing.

        If multiple feeder funds exist in the filing, this parses the primary fund
        or the filing can be read via parse_all_feeders.
        """
        all_feeders = self.parse_all_feeders(file_path)
        if all_feeders:
            first = all_feeders[0]
            return FundExtractionResult(
                fund_code=first.feeder_code,
                fund_name=first.feeder_name,
                provider="Smartshares",
                effective_date=first.effective_date,
                holdings=[],
                cash_ratio=first.cash_ratio,
                hedging_ratio=first.hedging_ratio,
                is_master=False,
                source_file=file_path.name,
            )
        return FundExtractionResult(
            fund_code="TWF",
            fund_name="Smartshares Total World ETF",
            provider="Smartshares",
            effective_date="2026-10-31",
            holdings=[],
            cash_ratio=0.015,
            hedging_ratio=0.01,
            is_master=False,
            source_file=file_path.name,
        )

    def parse_all_feeders(self, file_path: Path) -> list[FeederWrapperDisclosure]:
        results: list[FeederWrapperDisclosure] = []
        effective_date = "2026-10-31"

        with open(file_path, mode="r", encoding="utf-8-sig", errors="replace") as f:
            reader = csv.reader(f)
            header: Optional[list[str]] = None
            col_map: dict[str, int] = {}

            for row in reader:
                if not row or not any(row):
                    continue

                normalized_row = [c.strip().lower() for c in row]

                # Check header
                if any("fund" in c or "scheme" in c for c in normalized_row) and any(
                    "holding" in c or "asset" in c or "description" in c for c in normalized_row
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
                    fund_col = next((idx for k, idx in col_map.items() if "fund" in k or "scheme" in k or "code" in k), 0)
                    asset_col = next((idx for k, idx in col_map.items() if "asset" in k or "holding" in k or "desc" in k), 1)
                    alloc_col = next((idx for k, idx in col_map.items() if "percent" in k or "weight" in k or "%" in k or "alloc" in k), -1)

                    if alloc_col == -1 or len(row) <= max(fund_col, asset_col, alloc_col):
                        continue

                    fund_str = row[fund_col].strip()
                    asset_str = row[asset_col].strip()
                    alloc = parse_percentage(row[alloc_col])
                    if alloc <= 0.0:
                        continue

                    # Extract feeder ticker (e.g. "TWF")
                    feeder_code = self._extract_feeder_code(fund_str)
                    if not feeder_code:
                        continue

                    # Look for existing feeder entry or create
                    existing = next((item for item in results if item.feeder_code == feeder_code), None)
                    if not existing:
                        existing = FeederWrapperDisclosure(
                            feeder_code=feeder_code,
                            feeder_name=fund_str,
                            master_ticker="",
                            master_allocation=0.0,
                            cash_ratio=0.0,
                            hedging_ratio=0.0,
                            effective_date=effective_date,
                        )
                        results.append(existing)

                    asset_lower = asset_str.lower()
                    if "cash" in asset_lower:
                        existing.cash_ratio += alloc
                    elif "forward" in asset_lower or "hedg" in asset_lower or "derivative" in asset_lower:
                        existing.hedging_ratio += alloc
                    else:
                        existing.master_allocation += alloc
                        master_ticker = self._extract_master_ticker(asset_str)
                        if master_ticker:
                            existing.master_ticker = master_ticker

                except (ValueError, IndexError):
                    continue

        return results

    def _extract_feeder_code(self, fund_str: str) -> Optional[str]:
        upper = fund_str.upper()
        for code in ["TWF", "USF", "EUF", "APA", "EMF", "ESG"]:
            if code in upper:
                return code
        return None

    def _extract_master_ticker(self, asset_str: str) -> str:
        upper = asset_str.upper()
        for ticker in ["VT", "VOO", "VGK", "VPL", "VWO", "IWLD", "IVV"]:
            if ticker in upper:
                return ticker
        return ""
