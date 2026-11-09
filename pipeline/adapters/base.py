"""Base classes and dataclasses for Tier 1 holding adapters."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional


def parse_percentage(raw_str: str) -> float:
    """Parses a percentage string into a decimal ratio (e.g. '5.5%' -> 0.055, '1.0%' -> 0.01, '0.05' -> 0.05)."""
    if not raw_str:
        return 0.0
    has_percent = "%" in raw_str
    cleaned = raw_str.replace("%", "").replace(",", "").strip()
    if not cleaned:
        return 0.0
    val = float(cleaned)
    if has_percent:
        return val / 100.0
    if val > 1.0:
        return val / 100.0
    return val


@dataclass
class RawHolding:
    """Represents an extracted security holding from an upstream disclosure file."""

    name: str
    weight: float
    isin: Optional[str] = None
    ticker: Optional[str] = None
    cusip: Optional[str] = None
    country: Optional[str] = None
    sector: Optional[str] = None
    market_value: Optional[float] = None
    effective_date: Optional[str] = None
    raw_metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class FundExtractionResult:
    """Encapsulates the holdings and metadata extracted from a disclosure."""

    fund_code: str
    fund_name: str
    provider: str
    effective_date: str
    holdings: list[RawHolding]
    cash_ratio: float = 0.0
    hedging_ratio: float = 0.0
    is_master: bool = False
    source_file: str = ""


class BaseAdapter(ABC):
    """Abstract base class for provider-specific constituent file adapters."""

    @abstractmethod
    def can_handle(self, file_path: Path) -> bool:
        """Return True if this adapter is designed to parse the given file."""
        pass

    @abstractmethod
    def parse(self, file_path: Path) -> FundExtractionResult:
        """Parse the given file and return a FundExtractionResult."""
        pass
