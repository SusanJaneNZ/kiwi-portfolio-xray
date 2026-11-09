"""Feeder unwrapper: scales master ETF equity constituents by feeder cash and hedging buffers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from pipeline.adapters.base import FundExtractionResult, RawHolding
from pipeline.adapters.disclose_register_adapter import FeederWrapperDisclosure


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

    def __init__(self, feeder_registry_path: Path):
        self.feeder_registry: dict[str, dict] = {}
        if feeder_registry_path.exists():
            with open(feeder_registry_path, "r", encoding="utf-8") as f:
                self.feeder_registry = json.load(f)

    def unwrap(
        self,
        feeder_code: str,
        master_fund: FundExtractionResult,
        wrapper_disclosure: Optional[FeederWrapperDisclosure] = None,
    ) -> UnwrappedFund:
        """Unwraps a feeder fund by projecting master constituents through cash and hedging buffers."""
        feeder_info = self.feeder_registry.get(feeder_code, {})
        feeder_name = feeder_info.get("name", f"Smartshares {feeder_code} ETF")

        # Ratios from Disclose Register or defaults
        cash_ratio = wrapper_disclosure.cash_ratio if wrapper_disclosure else 0.015
        hedging_ratio = wrapper_disclosure.hedging_ratio if wrapper_disclosure else 0.0
        effective_date = wrapper_disclosure.effective_date if wrapper_disclosure else master_fund.effective_date

        # Scaling factor for the equity basket: (1 - cash - max(0, hedging))
        equity_scale = max(0.0, 1.0 - cash_ratio - max(0.0, hedging_ratio))

        unwrapped_constituents: list[dict] = []
        for h in master_fund.holdings:
            scaled_weight = h.weight * equity_scale
            unwrapped_constituents.append({
                "isin": h.isin or f"SYNTH_{h.ticker or h.name}",
                "name": h.name,
                "ticker": h.ticker or "",
                "country": h.country or "Global",
                "sector": h.sector or "Unclassified",
                "weight": round(scaled_weight, 8),
            })

        return UnwrappedFund(
            fund_code=feeder_code,
            fund_name=feeder_name,
            provider="Smartshares",
            effective_date=effective_date,
            cash_ratio=round(cash_ratio, 6),
            hedging_ratio=round(hedging_ratio, 6),
            constituents=unwrapped_constituents,
            unresolved_holdings=[],
        )

