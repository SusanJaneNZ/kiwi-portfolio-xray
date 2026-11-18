"""Feeder unwrapper: scales master ETF equity constituents by feeder cash and hedging buffers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from pipeline.adapters.base import FundExtractionResult
from pipeline.security_master.build_security_master import normalize_country


@dataclass
class FeederWrapperDisclosure:
    """Sorted Smart Investor wrapper breakdown for a feeder fund."""

    feeder_code: str
    feeder_name: str
    master_ticker: str
    master_allocation: float
    cash_ratio: float
    hedging_ratio: float
    effective_date: str


@dataclass
class UnwrappedFund:
    """Represents a fully resolved and unwrapped fund ready for output serialization."""

    fund_code: str
    fund_name: str
    provider: str
    effective_date: str
    cash_ratio: float
    hedging_ratio: float
    constituents: list[dict]  # list of {isin, name, ticker, country, sector, weight}
    unresolved_holdings: list[dict]


class FeederUnwrapper:
    """Unwraps feeder funds into their underlying master ETF constituents."""

    def __init__(
        self,
        feeder_registry_path: Path,
        gics_mapping: Optional[dict[str, str]] = None,
        matcher: Optional[Any] = None,
    ):
        self.feeder_registry: dict[str, dict] = {}
        if feeder_registry_path.exists():
            with open(feeder_registry_path, "r", encoding="utf-8") as f:
                self.feeder_registry = json.load(f)
        self.gics_lower = {k.lower(): v for k, v in (gics_mapping or {}).items()}
        self.matcher = matcher

    def unwrap(
        self,
        feeder_code: str,
        master_fund: FundExtractionResult,
        wrapper_disclosure: Optional[FeederWrapperDisclosure] = None,
    ) -> UnwrappedFund:
        """Unwraps a feeder fund by projecting master constituents through cash and hedging buffers."""
        feeder_info = self.feeder_registry.get(feeder_code, {})
        feeder_name = feeder_info.get("name", f"Smartshares {feeder_code} ETF")

        # Ratios from Sorted Smart Investor wrapper disclosure or defaults
        cash_ratio = wrapper_disclosure.cash_ratio if wrapper_disclosure else 0.015
        hedging_ratio = wrapper_disclosure.hedging_ratio if wrapper_disclosure else 0.0
        effective_date = wrapper_disclosure.effective_date if wrapper_disclosure else master_fund.effective_date

        # Scaling factor for the equity basket: (1 - cash - max(0, hedging))
        equity_scale = max(0.0, 1.0 - cash_ratio - max(0.0, hedging_ratio))

        unwrapped_constituents: list[dict] = []
        for h in master_fund.holdings:
            scaled_weight = h.weight * equity_scale
            raw_sector = (h.sector or "").strip()
            norm_sector = self.gics_lower.get(raw_sector.lower(), raw_sector or "Unclassified")
            norm_country = normalize_country(h.country or "", default="Global")

            resolved_isin = h.isin
            if self.matcher is not None:
                m = self.matcher.match(name=h.name, ticker=h.ticker)
                if m.matched:
                    if not resolved_isin and m.isin:
                        resolved_isin = m.isin
                    if norm_sector in {"Unclassified", "-", "", "Unknown"} and m.sector:
                        norm_sector = m.sector
                    if norm_country in {"Global", "Unknown", ""} and m.country:
                        norm_country = m.country

            unwrapped_constituents.append({
                "isin": resolved_isin or f"SYNTH_{h.ticker or h.name}",
                "name": h.name,
                "ticker": h.ticker or "",
                "country": norm_country,
                "sector": norm_sector,
                "weight": round(scaled_weight, 8),
                "asset_class": "equity",
            })

        provider = "Smartshares"
        if feeder_code.startswith("KERNEL_"):
            provider = "Kernel"
        elif feeder_info.get("provider"):
            provider = feeder_info["provider"]

        return UnwrappedFund(
            fund_code=feeder_code,
            fund_name=feeder_name,
            provider=provider,
            effective_date=effective_date,
            cash_ratio=round(cash_ratio, 6),
            hedging_ratio=round(hedging_ratio, 6),
            constituents=unwrapped_constituents,
            unresolved_holdings=[],
        )
