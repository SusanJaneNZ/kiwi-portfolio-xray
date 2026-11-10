"""Base classes and dataclasses for Tier 1 holding adapters."""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional


def parse_percentage(raw_str: str, column_is_percent: bool = False) -> float:
    """Parses a percentage string into a decimal ratio.

    Examples:
        '5.5%' -> 0.055
        '1.0%' -> 0.01
        '0.02' with column_is_percent=True -> 0.0002
        '<0.01%' -> 0.00005
        '0.05' with column_is_percent=False -> 0.05
    """
    if not raw_str:
        return 0.0
    text = raw_str.strip()
    if text in {"-", "—", "--", "N/A", "n/a", ""}:
        return 0.0

    is_less_than = text.startswith("<")
    if is_less_than:
        text = text.lstrip("<").strip()

    has_percent = "%" in text or column_is_percent
    cleaned = text.replace("%", "").replace(",", "").strip()
    if not cleaned:
        return 0.0

    val = float(cleaned)
    if is_less_than:
        val = val * 0.5

    if has_percent or val > 1.0:
        return val / 100.0
    return val


def parse_effective_date(text: str) -> Optional[str]:
    """Extracts a YYYY-MM-DD date from metadata text supporting ISO, US slash, and named month formats."""
    if not text:
        return None

    # 1. YYYY-MM-DD or YYYY/MM/DD
    iso_match = re.search(r"\b(202\d)[-/](\d{1,2})[-/](\d{1,2})\b", text)
    if iso_match:
        y, m, d = iso_match.groups()
        return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"

    # 2. DD/MM/YYYY or MM/DD/YYYY
    slash_match = re.search(r"\b(\d{1,2})/(\d{1,2})/(202\d)\b", text)
    if slash_match:
        a, b, y = (int(x) for x in slash_match.groups())
        if a > 12 and b <= 12:
            return f"{y:04d}-{b:02d}-{a:02d}"
        if a <= 12 and b <= 31:
            return f"{y:04d}-{a:02d}-{b:02d}"

    # 3. DD Month YYYY or DD-Mon-YYYY (e.g. 30 September 2026, 06-Nov-2026)
    nz_month_match = re.search(r"\b(\d{1,2}[\s-][A-Za-z]{3,9}[\s-]202\d)\b", text)
    if nz_month_match:
        date_str = nz_month_match.group(1).replace("-", " ")
        for fmt in ("%d %B %Y", "%d %b %Y"):
            try:
                return datetime.strptime(date_str, fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue

    # 4. Month DD, YYYY (US format, e.g. October 31, 2026 or Oct 31, 2026)
    month_match = re.search(r"\b([A-Za-z]{3,9}\s+\d{1,2},\s+202\d)\b", text)
    if month_match:
        date_str = month_match.group(1)
        for fmt in ("%B %d, %Y", "%b %d, %Y"):
            try:
                return datetime.strptime(date_str, fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue

    return None


@dataclass
class RawHolding:
    """Represents an extracted security holding from an upstream disclosure file."""

    name: str
    weight: float
    isin: Optional[str] = None
    ticker: Optional[str] = None
    cusip: Optional[str] = None
    sedol: Optional[str] = None
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
