"""Shared tabular parser for Sorted Smart Investor (.xlsx/.csv) and NZ fund disclosures."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from pipeline.adapters.base import (
    FundExtractionResult,
    RawHolding,
    clean_float_cell,
    parse_effective_date,
    should_divide_weights_by_100,
)
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
    "new zealand dollars",
    "us dollar",
    "us dollars",
    "australian dollar",
    "australian dollars",
    "canadian dollar",
    "canadian dollars",
    "hong kong dollar",
    "hong kong dollars",
    "singapore dollar",
    "singapore dollars",
    "taiwan dollar",
    "taiwan dollars",
    "british pound",
    "british pounds",
    "pound sterling",
    "pounds sterling",
    "swiss franc",
    "swiss francs",
    "japanese yen",
    "chinese yuan",
    "yuan renminbi",
    "danish krone",
    "danish kroner",
    "swedish krona",
    "swedish kronor",
    "norwegian krone",
    "norwegian kroner",
    "korean won",
    "indian rupee",
    "brazilian real",
    "south african rand",
    "mexican peso",
    "mexican nuevo peso",
    "israeli shekel",
    "israeli sheqel",
    "shekel",
    "sheqel",
    "polish zloty",
    "zloty",
    "hungarian forint",
    "forint",
    "turkish lira",
    "thailand baht",
    "thai baht",
    "european monetary union euro",
    "euro",
    "euros",
    "stif fund",
    "eto margin",
    "futures margin",
    "variation margin",
    "initial margin",
    "net current assets",
    "accounts payable",
    "accounts receivable",
    "redemptions payable",
    "subscriptions receivable",
    "unsettled trades",
    "outstanding settlements",
    "unsettled",
    "accrued",
    "bank account",
)

_CASH_TOKEN_RES = tuple(re.compile(rf"\b{re.escape(tok)}\b", re.IGNORECASE) for tok in CURRENCY_AND_CASH_TOKENS)


def _find_weight_col(col_map: dict[str, int]) -> int:
    for priority_key in ("% of fund net assets", "% of fund", "weight (%)", "weighting (%)", "weight%", "weight"):
        if priority_key in col_map:
            return col_map[priority_key]
    for k, idx in col_map.items():
        if "weight" in k or "%" in k or "percent" in k:
            return idx
    return -1


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
            candidate_map = {c: idx for idx, c in enumerate(normalized_row)}
            has_name_or_ticker = any(
                c in NAME_HEADERS or "security" in c or "company" in c or "asset" in c or "ticker" in c or "code" in c
                for c in normalized_row
            )
            detected_weight_col = _find_weight_col(candidate_map)
            if has_name_or_ticker and detected_weight_col != -1:
                header = normalized_row
                col_map = candidate_map
                continue

            if len(normalized_row) >= 2 and normalized_row[0] == "fund name" and row[1].strip():
                fund_name = row[1].strip().title()

            row_str = " ".join(row)
            maybe_date = parse_effective_date(row_str, prefer_day_first=True)
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
        weight_col = _find_weight_col(col_map)

        if weight_col == -1 or len(row) <= weight_col:
            continue

        name = row[name_col].strip() if name_col != -1 and len(row) > name_col else ""
        ticker = row[ticker_col].strip() if ticker_col != -1 and len(row) > ticker_col else ""
        if not name and ticker:
            name = ticker
        if not name or name.lower().startswith("total"):
            continue

        parsed_num = clean_float_cell(row[weight_col])
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
    divide_by_100 = should_divide_weights_by_100(parsed_entries)

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
            or any(pat.search(name_lower) for pat in _CASH_TOKEN_RES)
            or "receivable" in name_lower
            or "payable" in name_lower
            or name_lower.startswith("redemption")
            or name_lower.startswith("subscription")
            or bool(re.search(r"\b(?:csh|cash)\b", name_lower))
            or "cogent nom" in name_lower
        )
        # Note: explicit deposit phrases ("term deposit", "call deposit", "notice saver") are investable rows handled downstream.
        if "term deposit" in name_lower or "call deposit" in name_lower or "notice saver" in name_lower or bool(re.search(r"\bdeposit\b", name_lower)):
            is_cash = False
        is_hedging_name = (
            "forward" in name_lower
            or "hedg" in name_lower
            or bool(re.search(r"(?:\b|-)ndf\b", name_lower))
            or bool(re.search(r"\b[a-z]{3}\.[a-z]{3}\s*@", name_lower))
            or name_lower.startswith("kw nzd.")
        )
        is_etf_or_fund_product = bool(re.search(r"\b(?:etf|fund|trust|ucits)\b", name_lower))
        is_hedging = (
            (is_hedging_name and not is_etf_or_fund_product)
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
                raw_metadata={
                    "asset_class": e["asset_class"],
                    "asset_type": e["asset_type"],
                },
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
