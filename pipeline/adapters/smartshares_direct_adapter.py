"""Adapter for Smartshares Direct Equity Funds (CSV and Sorted Smart Investor XLSX)."""

from __future__ import annotations

import re
from pathlib import Path

from pipeline.adapters.base import BaseAdapter, FundExtractionResult
from pipeline.adapters.sorted_parser import parse_nz_fund_file

SMARTSHARES_DIRECT_FUNDS = {
    "FNZ": "Smartshares NZ Top 50 ETF",
    "MDZ": "Smartshares NZ Mid Cap ETF",
    "NZG": "Smartshares S&P/NZX 50 ETF",
    "DIV": "Smartshares NZ Dividend ETF",
    "NZB": "Smartshares NZ Bond ETF",
    "GBF": "Smartshares Global Bond ETF",
    "AGG": "Smartshares Global Aggregate Bond ETF",
    "OZY": "Smartshares Australian Top 20 ETF",
    "ASD": "Smartshares Australian Dividend ETF",
    "TWF": "Smartshares Total World ETF",
    "USF": "Smartshares US 500 ETF",
    "EUF": "Smartshares Europe ETF",
    "APA": "Smartshares Asia Pacific ETF",
    "EMF": "Smartshares Emerging Markets ETF",
    "ESG": "Smartshares Global Equities ESG ETF",
}

SMARTSHARES_NAME_HINTS = {
    "NZ TOP 50": "FNZ",
    "NZ MID CAP": "MDZ",
    "NZX 50": "NZG",
    "NZ CORE": "NZG",
    "NZ DIVIDEND": "DIV",
    "NZ BOND": "NZB",
    "GLOBAL BOND": "GBF",
    "GLOBAL AGGREGATE BOND": "AGG",
    "FND14632": "AGG",
    "AUSTRALIAN TOP 20": "OZY",
    "AUSTRALIAN DIVIDEND": "ASD",
    "TOTAL WORLD": "TWF",
    "US 500": "USF",
    "EUROPE": "EUF",
    "ASIA PACIFIC": "APA",
    "EMERGING MARKETS": "EMF",
    "GLOBAL ESG": "ESG",
    "FND14633": "ESG",
}


class SmartsharesDirectAdapter(BaseAdapter):
    """Parses Smartshares direct equity portfolio holding CSV or Sorted XLSX files."""

    def can_handle(self, file_path: Path) -> bool:
        if file_path.suffix.lower() not in {".csv", ".xlsx"}:
            return False
        if file_path.parent.name.lower() == "smartshares":
            return True
        name = file_path.name.upper()
        if "SMARTSHARES" in name or "SMART " in name:
            return True
        return any(code in name for code in SMARTSHARES_DIRECT_FUNDS)

    def parse(self, file_path: Path) -> FundExtractionResult:
        fund_code = self._extract_code_from_filename(file_path.name)
        fund_name = SMARTSHARES_DIRECT_FUNDS.get(fund_code, f"Smartshares {fund_code} ETF")
        return parse_nz_fund_file(
            file_path=file_path,
            fund_code=fund_code,
            fund_name=fund_name,
            provider="Smartshares",
        )

    def _extract_code_from_filename(self, filename: str) -> str:
        upper = filename.upper().replace("_", " ").replace("-", " ")
        for code in SMARTSHARES_DIRECT_FUNDS:
            if re.search(rf"\b{code}\b", upper):
                return code
        for hint, code in SMARTSHARES_NAME_HINTS.items():
            if hint in upper:
                return code
        stem = re.sub(r"[^A-Z0-9]+", "_", Path(filename).stem.upper()).strip("_")
        return stem or "SMARTSHARES_FUND"
