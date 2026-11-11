"""Adapter for Kernel Wealth index fund constituent disclosures (CSV and Sorted Smart Investor XLSX)."""

from __future__ import annotations

import re
from pathlib import Path

from pipeline.adapters.base import BaseAdapter, FundExtractionResult
from pipeline.adapters.sorted_parser import parse_nz_fund_file

KERNEL_FUND_NAMES = {
    "KERNEL_NZ_50": "Kernel NZ 50 ESG Tilted Fund",
    "KERNEL_NZ_20": "Kernel NZ 20 Fund",
    "KERNEL_AUS_LEADERS": "Kernel S&P Kensho Australian Leaders Fund",
    "KERNEL_GLOBAL_100": "Kernel S&P Global 100 Fund",
    "KERNEL_WORLD_EX_US": "Kernel S&P World Ex-U.S. Fund",
    "KERNEL_CLEAN_ENERGY": "Kernel Global Clean Energy Fund",
    "KERNEL_HIGH_DIVIDEND": "Kernel NZ High Dividend Fund",
    "KERNEL_GLOBAL_ESG": "Kernel Global ESG Fund",
    "KERNEL_GLOBAL_DIVIDEND": "Kernel S&P Global Dividend Aristocrats Fund",
    "KERNEL_NZ_BOND": "Kernel NZ Bond Fund",
    "KERNEL_BALANCED": "Kernel Balanced Fund",
    "KERNEL_HIGH_GROWTH": "Kernel High Growth Fund",
    "KERNEL_CONSERVATIVE": "Kernel Conservative Fund",
    "KERNEL_CASH_PLUS": "Kernel Cash Plus Fund",
}

KERNEL_NAME_HINTS = {
    "NZ 50": "KERNEL_NZ_50",
    "NZ 20": "KERNEL_NZ_20",
    "AUSTRALIAN LEADERS": "KERNEL_AUS_LEADERS",
    "AUS LEADERS": "KERNEL_AUS_LEADERS",
    "GLOBAL 100": "KERNEL_GLOBAL_100",
    "WORLD EX": "KERNEL_WORLD_EX_US",
    "EX US": "KERNEL_WORLD_EX_US",
    "CLEAN ENERGY": "KERNEL_CLEAN_ENERGY",
    "HIGH DIVIDEND": "KERNEL_HIGH_DIVIDEND",
    "GLOBAL ESG": "KERNEL_GLOBAL_ESG",
    "DIVIDEND ARISTOCRATS": "KERNEL_GLOBAL_DIVIDEND",
    "NZ BOND": "KERNEL_NZ_BOND",
    "HIGH GROWTH": "KERNEL_HIGH_GROWTH",
    "CONSERVATIVE": "KERNEL_CONSERVATIVE",
    "BALANCED": "KERNEL_BALANCED",
    "CASH PLUS": "KERNEL_CASH_PLUS",
}


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
        normalized = re.sub(r"[^A-Z0-9]+", " ", Path(filename).stem.upper()).strip()
        underscore = normalized.replace(" ", "_")

        for code in KERNEL_FUND_NAMES:
            if code in underscore:
                return code

        for hint, code in KERNEL_NAME_HINTS.items():
            if hint in normalized:
                return code

        return underscore or "KERNEL_FUND"
