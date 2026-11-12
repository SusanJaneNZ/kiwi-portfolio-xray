"""Base classes and dataclasses for Tier 1 holding adapters."""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional


EMPTY_MARKERS = {"", "-", "—", "--", "---", "N/A", "n/a"}


def clean_cell(raw_str: str) -> str:
    """Strips whitespace and normalizes placeholder dash/NA markers to empty string."""
    text = (raw_str or "").strip()
    return "" if text in EMPTY_MARKERS else text


def clean_float_cell(raw_str: str) -> tuple[float, bool] | None:
    """Parses a numeric/percentage cell into (numeric_value, has_percent_symbol) or None."""
    text = clean_cell(raw_str)
    if not text:
        return None
    has_pct = "%" in text
    is_lt = text.startswith("<")
    cleaned = text.lstrip("<").replace("%", "").replace(",", "").strip()
    if not cleaned:
        return None
    try:
        val = float(cleaned)
    except ValueError:
        return None
    if is_lt:
        val *= 0.5
    return val, has_pct


def should_divide_weights_by_100(parsed_entries: list[dict[str, Any]]) -> bool:
    """Infers whether numeric entries without '%' are expressed on a 0..100 scale rather than 0..1."""
    any_pct = any(e.get("has_pct") for e in parsed_entries)
    total_raw = sum(float(e.get("raw_val", 0.0)) for e in parsed_entries)
    return any_pct or total_raw > 2.0


def extract_code_from_filename(
    filename: str,
    sorted_hints: list[tuple[str, str]],
    known_codes: Any,
    fallback_prefix: str = "",
    default_code: str = "FUND",
) -> str:
    """Extracts a canonical fund code from filename using longest-first hints, word-boundary codes, or stem fallback."""
    stem_upper = Path(filename).stem.upper()
    spaced = re.sub(r"[^A-Z0-9]+", " ", stem_upper).strip()
    underscored = spaced.replace(" ", "_")

    for hint, code in sorted_hints:
        if hint in spaced:
            return code
    for code in known_codes:
        if code in underscored or re.search(rf"\b{re.escape(code)}\b", spaced):
            return code
    if fallback_prefix and underscored.startswith(fallback_prefix):
        return underscored
    return underscored or default_code


def parse_percentage(raw_str: str, column_is_percent: bool = False) -> float:
    """Parses a percentage string into a decimal ratio.

    Examples:
        '5.5%' -> 0.055
        '1.0%' -> 0.01
        '0.02' with column_is_percent=True -> 0.0002
        '<0.01%' -> 0.00005
        '0.05' with column_is_percent=False -> 0.05
    """
    parsed = clean_float_cell(raw_str)
    if not parsed:
        return 0.0
    val, has_percent = parsed
    if has_percent or column_is_percent or val > 1.0:
        return val / 100.0
    return val


def _format_valid_date(year: int, month: int, day: int) -> Optional[str]:
    try:
        return datetime(year, month, day).strftime("%Y-%m-%d")
    except ValueError:
        return None


def parse_effective_date(text: str, prefer_day_first: bool = True) -> Optional[str]:
    """Extracts a YYYY-MM-DD date from metadata text supporting ISO, slash, and named month formats."""
    if not text:
        return None

    # 1. YYYY-MM-DD or YYYY/MM/DD
    iso_match = re.search(r"\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b", text)
    if iso_match:
        y, m, d = (int(x) for x in iso_match.groups())
        formatted = _format_valid_date(y, m, d)
        if formatted:
            return formatted

    # 2. DD/MM/YYYY or MM/DD/YYYY (respects prefer_day_first when both <= 12)
    slash_match = re.search(r"\b(\d{1,2})/(\d{1,2})/(20\d{2})\b", text)
    if slash_match:
        a, b, y = (int(x) for x in slash_match.groups())
        order = ((y, b, a), (y, a, b)) if prefer_day_first else ((y, a, b), (y, b, a))
        for yy, mm, dd in order:
            formatted = _format_valid_date(yy, mm, dd)
            if formatted:
                return formatted

    # 3. DD Month YYYY or DD-Mon-YYYY (e.g. 30 September 2026, 06-Nov-2026)
    nz_month_match = re.search(r"\b(\d{1,2}[\s-][A-Za-z]{3,9}[\s-]20\d{2})\b", text)
    if nz_month_match:
        date_str = nz_month_match.group(1).replace("-", " ")
        for fmt in ("%d %B %Y", "%d %b %Y"):
            try:
                return datetime.strptime(date_str, fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue

    # 4. Month DD, YYYY (US format, e.g. October 31, 2026 or Oct 31, 2026)
    month_match = re.search(r"\b([A-Za-z]{3,9}\s+\d{1,2},\s+20\d{2})\b", text)
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
