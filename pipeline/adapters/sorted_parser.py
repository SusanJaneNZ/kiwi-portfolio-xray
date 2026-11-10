"""Shared tabular parser for Sorted Smart Investor (.xlsx/.csv) and NZ fund disclosures."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from pipeline.adapters.base import FundExtractionResult, RawHolding, parse_effective_date
from pipeline.adapters.tabular_reader import read_tabular_rows

NAME_HEADERS = {
    "asset",
    "asset name",
    "security name",
    "security description",
    "company name",
    "holding",
    "holding name",
    "name",
}

CURRENCY_AND_CASH_TOKENS = (
    "cash",
    "new zealand dollar",
    "us dollar",
    "australian dollar",
    "canadian dollar",
    "hong kong dollar",
    "singapore dollar",
    "taiwan dollar",
    "british pound",
    "pound sterling",
    "swiss franc",
    "japanese yen",
    "chinese yuan",
    "yuan renminbi",
    "danish krone",
    "swedish krona",
    "norwegian krone",
    "korean won",
    "indian rupee",
    "brazilian real",
    "south african rand",
    "mexican peso",
    "net current assets",
    "accounts payable",
    "accounts receivable",
    "redemptions payable",
    "subscriptions receivable",
    "accrued",
    "term deposit",
    "bank account",
)


def _clean_float_cell(raw_str: str) -> tuple[float, bool] | None:
    text = (raw_str or "").strip()
    if not text or text in {"-", "--", "---", "N/A", "n/a"}:
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


def parse_nz_fund_file(
    file_path: Path,
    fund_code: str,
    fund_name: str,
    provider: str,
) -> FundExtractionResult:
    """Parses a Sorted Smart Investor or provider CSV/XLSX holdings file."""
    rows = read_tabular_rows(file_path)

    effective_date = "2026-10-31"
    header: Optional[list[str]] = None
    col_map: dict[str, int] = {}
    parsed_entries: list[dict] = []

    for row in rows:
        normalized_row = [c.strip().lower() for c in row]

        if not header:
            has_name_or_ticker = any(
                c in NAME_HEADERS or "security" in c or "company" in c or "asset" in c or "ticker" in c or "code" in c
                for c in normalized_row
            )
            has_weight = any(
                "weight" in c or "percent" in c or "%" in c or "market value" in c or "fund" in c
                for c in normalized_row
            )
            if has_name_or_ticker and has_weight:
                header = normalized_row
                col_map = {c: idx for idx, c in enumerate(header)}
                continue

            if len(normalized_row) >= 2 and normalized_row[0] == "fund name" and row[1].strip():
                fund_name = row[1].strip().title()

            row_str = " ".join(row)
            maybe_date = parse_effective_date(row_str)
            if maybe_date:
                effective_date = maybe_date
            continue

        # Locate columns
        name_col = next((col_map[k] for k in NAME_HEADERS if k in col_map), -1)
        if name_col == -1:
            name_col = next(
                (idx for k, idx in col_map.items() if ("asset" in k and "class" not in k) or "desc" in k or "company" in k or "name" in k),
                -1,
            )
        ticker_col = next(
            (idx for k, idx in col_map.items() if k in {"security code", "ticker", "code", "symbol"} or "ticker" in k),
            -1,
        )
        isin_col = next((idx for k, idx in col_map.items() if "isin" in k), -1)
        class_col = next((idx for k, idx in col_map.items() if "asset class" in k or k == "class"), -1)
        type_col = next((idx for k, idx in col_map.items() if k == "type" or "sector" in k), -1)
        country_col = next((idx for k, idx in col_map.items() if "country" in k), -1)
        weight_col = next(
            (idx for k, idx in col_map.items() if "weight" in k or "%" in k or "percent" in k),
            -1,
        )

        if weight_col == -1 or len(row) <= weight_col:
            continue

        name = row[name_col].strip() if name_col != -1 and len(row) > name_col else ""
        ticker = row[ticker_col].strip() if ticker_col != -1 and len(row) > ticker_col else ""
        if not name and ticker:
            name = ticker
        if not name or name.lower().startswith("total"):
            continue

        parsed_num = _clean_float_cell(row[weight_col])
        if not parsed_num:
            continue
        raw_val, has_pct = parsed_num

        isin = row[isin_col].strip() if isin_col != -1 and len(row) > isin_col else ""
        asset_class = row[class_col].strip() if class_col != -1 and len(row) > class_col else ""
        asset_type = row[type_col].strip() if type_col != -1 and len(row) > type_col else ""
        country = row[country_col].strip() if country_col != -1 and len(row) > country_col else ""

        parsed_entries.append({
            "name": name,
            "ticker": ticker or None,
            "isin": isin or None,
            "asset_class": asset_class,
            "asset_type": asset_type,
            "country": country or None,
            "raw_val": raw_val,
            "has_pct": has_pct,
        })

    # Determine whether raw numeric values without '%' are expressed on a 0..100 scale vs 0..1 Excel percentage scale
    any_pct_symbol = any(e["has_pct"] for e in parsed_entries)
    total_raw = sum(e["raw_val"] for e in parsed_entries)
    divide_by_100 = any_pct_symbol or total_raw > 2.0

    holdings: list[RawHolding] = []
    cash_ratio = 0.0
    hedging_ratio = 0.0

    for e in parsed_entries:
        weight = (e["raw_val"] / 100.0) if (e["has_pct"] or divide_by_100) else e["raw_val"]
        if weight == 0.0:
            continue

        name_lower = e["name"].lower()
        class_lower = e["asset_class"].lower()
        type_lower = e["asset_type"].lower()

        is_cash = (
            "cash" in class_lower
            or "cash" in type_lower
            or name_lower == "euro"
            or any(tok in name_lower for tok in CURRENCY_AND_CASH_TOKENS)
            or "receivable" in name_lower
            or "payable" in name_lower
        )
        is_hedging = (
            "forward" in name_lower
            or "hedg" in name_lower
            or "derivative" in class_lower
            or ("currency" in type_lower and "forward" in name_lower)
        )

        if is_cash:
            cash_ratio += weight
            continue
        if is_hedging:
            hedging_ratio += weight
            continue
        if weight < 0:
            continue

        holdings.append(
            RawHolding(
                name=e["name"],
                weight=weight,
                isin=e["isin"],
                ticker=e["ticker"],
                country=e["country"],
                effective_date=effective_date,
            )
        )

    return FundExtractionResult(
        fund_code=fund_code,
        fund_name=fund_name,
        provider=provider,
        effective_date=effective_date,
        holdings=holdings,
        cash_ratio=max(0.0, cash_ratio),
        hedging_ratio=hedging_ratio,
        is_master=False,
        source_file=file_path.name,
    )
