"""Adapter for Kernel Wealth index fund constituent disclosures (CSV and Sorted Smart Investor XLSX)."""

from __future__ import annotations

import re
from pathlib import Path

from pipeline.adapters.base import BaseAdapter, FundExtractionResult, extract_code_from_filename
from pipeline.adapters.sorted_parser import parse_nz_fund_file

KERNEL_FUND_NAMES = {
    "KERNEL_NZ_50": "Kernel NZ 50 ESG Tilted Fund",
    "KERNEL_NZ_20": "Kernel NZ 20 Fund",
    "KERNEL_NZ_SMALL_MID_CAP": "Kernel NZ Small & Mid Cap Opportunities Fund",
    "KERNEL_NZ_COMMERCIAL_PROPERTY": "Kernel NZ Commercial Property Fund",
    "KERNEL_AUS_LEADERS": "Kernel S&P Kensho Australian Leaders Fund",
    "KERNEL_GLOBAL_100": "Kernel S&P Global 100 Fund",
    "KERNEL_GLOBAL_100_HEDGED": "Kernel S&P Global 100 (NZD Hedged) Fund",
    "KERNEL_WORLD_EX_US": "Kernel S&P World Ex-U.S. Fund",
    "KERNEL_CLEAN_ENERGY": "Kernel Global Clean Energy Fund",
    "KERNEL_HIGH_DIVIDEND": "Kernel NZ High Dividend Fund",
    "KERNEL_GLOBAL_ESG": "Kernel Global ESG Fund",
    "KERNEL_GLOBAL_ESG_HEDGED": "Kernel Global ESG (NZD Hedged) Fund",
    "KERNEL_GLOBAL_DIVIDEND": "Kernel S&P Global Dividend Aristocrats Fund",
    "KERNEL_GLOBAL_INFRASTRUCTURE": "Kernel Global Infrastructure Fund",
    "KERNEL_GLOBAL_INFRASTRUCTURE_HEDGED": "Kernel Global Infrastructure (NZD Hedged) Fund",
    "KERNEL_GLOBAL_PROPERTY_HEDGED": "Kernel Global Property (NZD Hedged) Fund",
    "KERNEL_SP_500_UNHEDGED": "Kernel S&P 500 (Unhedged) Fund",
    "KERNEL_SP_500_HEDGED": "Kernel S&P 500 (NZD Hedged) Fund",
    "KERNEL_EMERGING_MARKETS": "Kernel Emerging Markets Fund",
    "KERNEL_NZ_BOND": "Kernel NZ Bond Fund",
    "KERNEL_MARCH_2027_NZ_BOND": "Kernel March 2027 NZ Bond Fund",
    "KERNEL_MARCH_2029_NZ_BOND": "Kernel March 2029 NZ Bond Fund",
    "KERNEL_US_BOND": "Kernel US Bond Fund",
    "KERNEL_BALANCED": "Kernel Balanced Fund",
    "KERNEL_HIGH_GROWTH": "Kernel High Growth Fund",
    "KERNEL_CONSERVATIVE": "Kernel Conservative Fund",
    "KERNEL_CASH_PLUS": "Kernel Cash Plus Fund",
}

KERNEL_NAME_HINTS = {
    "MARCH 2027 NZ BOND": "KERNEL_MARCH_2027_NZ_BOND",
    "MARCH 2029 NZ BOND": "KERNEL_MARCH_2029_NZ_BOND",
    "MARCH 2027": "KERNEL_MARCH_2027_NZ_BOND",
    "MARCH 2029": "KERNEL_MARCH_2029_NZ_BOND",
    "NZ SMALL": "KERNEL_NZ_SMALL_MID_CAP",
    "SMALL & MID CAP": "KERNEL_NZ_SMALL_MID_CAP",
    "SMALL AND MID CAP": "KERNEL_NZ_SMALL_MID_CAP",
    "COMMERCIAL PROPERTY": "KERNEL_NZ_COMMERCIAL_PROPERTY",
    "GLOBAL INFRASTRUCTURE NZD HEDGED": "KERNEL_GLOBAL_INFRASTRUCTURE_HEDGED",
    "GLOBAL INFRASTRUCTURE (NZD HEDGED)": "KERNEL_GLOBAL_INFRASTRUCTURE_HEDGED",
    "GLOBAL INFRASTRUCTURE": "KERNEL_GLOBAL_INFRASTRUCTURE",
    "GLOBAL PROPERTY": "KERNEL_GLOBAL_PROPERTY_HEDGED",
    "GLOBAL ESG NZD HEDGED": "KERNEL_GLOBAL_ESG_HEDGED",
    "GLOBAL ESG (NZD HEDGED)": "KERNEL_GLOBAL_ESG_HEDGED",
    "GLOBAL ESG": "KERNEL_GLOBAL_ESG",
    "GLOBAL 100 NZD HEDGED": "KERNEL_GLOBAL_100_HEDGED",
    "GLOBAL 100 (NZD HEDGED)": "KERNEL_GLOBAL_100_HEDGED",
    "GLOBAL 100": "KERNEL_GLOBAL_100",
    "S&P 500 NZD HEDGED": "KERNEL_SP_500_HEDGED",
    "S&P 500 (NZD HEDGED)": "KERNEL_SP_500_HEDGED",
    "SANDP 500 NZD HEDGED": "KERNEL_SP_500_HEDGED",
    "S&P 500 UNHEDGED": "KERNEL_SP_500_UNHEDGED",
    "S&P 500 (UNHEDGED)": "KERNEL_SP_500_UNHEDGED",
    "SANDP 500 UNHEDGED": "KERNEL_SP_500_UNHEDGED",
    "EMERGING MARKETS": "KERNEL_EMERGING_MARKETS",
    "US BOND": "KERNEL_US_BOND",
    "NZ 50": "KERNEL_NZ_50",
    "NZ 20": "KERNEL_NZ_20",
    "AUSTRALIAN LEADERS": "KERNEL_AUS_LEADERS",
    "AUS LEADERS": "KERNEL_AUS_LEADERS",
    "WORLD EX": "KERNEL_WORLD_EX_US",
    "EX US": "KERNEL_WORLD_EX_US",
    "CLEAN ENERGY": "KERNEL_CLEAN_ENERGY",
    "HIGH DIVIDEND": "KERNEL_HIGH_DIVIDEND",
    "DIVIDEND ARISTOCRATS": "KERNEL_GLOBAL_DIVIDEND",
    "NZ BOND": "KERNEL_NZ_BOND",
    "HIGH GROWTH": "KERNEL_HIGH_GROWTH",
    "CONSERVATIVE": "KERNEL_CONSERVATIVE",
    "BALANCED": "KERNEL_BALANCED",
    "CASH PLUS": "KERNEL_CASH_PLUS",
}


_SORTED_KERNEL_HINTS = sorted(KERNEL_NAME_HINTS.items(), key=lambda kv: len(kv[0]), reverse=True)


class KernelAdapter(BaseAdapter):
    """Parses Kernel Wealth monthly fund portfolio disclosures (CSV or Sorted XLSX)."""

    def can_handle(self, file_path: Path) -> bool:
        if file_path.suffix.lower() not in {".csv", ".xlsx"}:
            return False
        if file_path.parent.name.lower() == "kernel":
            return True
        return "KERNEL" in file_path.name.upper()

    def parse(self, file_path: Path) -> FundExtractionResult:
        fund_code = self._extract_code_from_filename(file_path.name)
        fund_name = KERNEL_FUND_NAMES.get(fund_code, f"Kernel {fund_code.replace('KERNEL_', '').replace('_', ' ').title()}")
        return parse_nz_fund_file(
            file_path=file_path,
            fund_code=fund_code,
            fund_name=fund_name,
            provider="Kernel",
        )

    def _extract_code_from_filename(self, filename: str) -> str:
        return extract_code_from_filename(
            filename,
            sorted_hints=_SORTED_KERNEL_HINTS,
            known_codes=KERNEL_FUND_NAMES,
            default_code="KERNEL_FUND",
        )
