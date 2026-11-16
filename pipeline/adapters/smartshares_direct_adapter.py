"""Adapter for Smartshares Direct Equity, Bond, and Feeder Wrapper Funds (CSV and Sorted XLSX)."""

from __future__ import annotations

import re
from pathlib import Path

from pipeline.adapters.base import BaseAdapter, FundExtractionResult, extract_code_from_filename
from pipeline.adapters.sorted_parser import parse_nz_fund_file

SMARTSHARES_DIRECT_FUNDS = {
    "FNZ": "Smartshares NZ Top 50 ETF",
    "TNZ": "Smartshares NZ Top 10 ETF",
    "MDZ": "Smartshares NZ Mid Cap ETF",
    "NZG": "Smartshares S&P/NZX 50 ETF",
    "NZT": "Smartshares S&P/NZX 20 ETF",
    "DIV": "Smartshares NZ Dividend ETF",
    "NPF": "Smartshares NZ Property ETF",
    "NZC": "Smartshares NZ Cash ETF",
    "NZB": "Smartshares NZ Bond ETF",
    "NGB": "Smart S&P/NZX NZ Government Bond ETF",
    "GBF": "Smartshares Global Bond ETF",
    "AGG": "Smartshares Global Aggregate Bond ETF",
    "GGB": "Smart Global Government Bond ETF",
    "OZY": "Smartshares Australian Top 20 ETF",
    "AUS": "Smartshares Australian Top 200 ETF",
    "ASD": "Smartshares Australian Dividend ETF",
    "ASF": "Smartshares Australian Financials ETF",
    "MZY": "Smartshares Australian Mid Cap ETF",
    "ASP": "Smartshares Australian Property ETF",
    "ASR": "Smartshares Australian Resources ETF",
    "AUE": "Smartshares Australian ESG ETF",
    "TWF": "Smartshares Total World ETF",
    "TWH": "Smartshares Total World (NZD Hedged) ETF",
    "USF": "Smartshares US 500 ETF",
    "USE": "Smartshares US 500 (NZD Hedged) ETF",
    "USG": "Smartshares US Large Growth ETF",
    "USV": "Smartshares US Large Value ETF",
    "USM": "Smartshares US Mid Cap ETF",
    "USS": "Smartshares US Small Cap ETF",
    "UST": "Smartshares US Technology (NZD Hedged) ETF",
    "USA": "Smartshares US ESG ETF",
    "EUF": "Smartshares Europe ETF",
    "EUG": "Smartshares Europe ESG ETF",
    "APA": "Smartshares Asia Pacific ETF",
    "EMF": "Smartshares Emerging Markets ETF",
    "EMG": "Smartshares Emerging Markets ESG ETF",
    "JPG": "Smartshares Japan ESG ETF",
    "BOT": "Smartshares Automation & Robotics ETF",
    "HLT": "Smartshares Healthcare Innovation ETF",
    "ESG": "Smartshares Global Equities ESG ETF",
    "INF": "Smartshares Global Infrastructure ETF",
    "GPR": "Smartshares Global Property ETF",
    "GLD": "Smartshares Gold ETF",
    "BTC": "Smartshares Bitcoin ETF",
}

SMARTSHARES_NAME_HINTS = {
    "GLOBAL AGGREGATE BOND": "AGG",
    "AUSTRALIAN FINANCIALS": "ASF",
    "AUSTRALIAN DIVIDEND": "ASD",
    "AUSTRALIAN TOP 200": "AUS",
    "AUSTRALIAN TOP 20": "OZY",
    "AUSTRALIAN MID CAP": "MZY",
    "EMERGING MARKETS": "EMF",
    "NZ TOP 50 FUND": "FNZ",
    "EUROPE ESG": "EUG",
    "GLOBAL ESG": "ESG",
    "US SMALL CAP": "USS",
    "US MID CAP": "USM",
    "TOTAL WORLD": "TWF",
    "ASIA PACIFIC": "APA",
    "NZ PROPERTY": "NPF",
    "NZ DIVIDEND": "DIV",
    "GLOBAL BOND": "GBF",
    "NZ MID CAP": "MDZ",
    "NZ TOP 50": "FNZ",
    "NZ TOP 10": "TNZ",
    "NZX 50": "NZG",
    "NZ CORE": "NZG",
    "NZ BOND": "NZB",
    "US ESG": "USA",
    "US 500": "USF",
    "EUROPE": "EUF",
    "FND14631": "EUG",
    "FND14632": "AGG",
    "FND14633": "ESG",
    "FND14636": "USA",
    "FND19355": "AUS",
    "FND1096": "ASF",
    "FND1097": "MZY",
    "FND1109": "USM",
    "FND1110": "USS",
    "FND1114": "TNZ",
    "FND1116": "NPF",
    "FND2471": "FNZ",
}

# Pre-sort hints longest-first so "EUROPE ESG" / "AUSTRALIAN TOP 200" win over substrings
_SORTED_HINTS = sorted(SMARTSHARES_NAME_HINTS.items(), key=lambda kv: len(kv[0]), reverse=True)


class SmartsharesDirectAdapter(BaseAdapter):
    """Parses Smartshares portfolio holding CSV or Sorted XLSX files."""

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
        return extract_code_from_filename(
            filename,
            sorted_hints=_SORTED_HINTS,
            known_codes=SMARTSHARES_DIRECT_FUNDS,
            default_code="SMARTSHARES_FUND",
        )
