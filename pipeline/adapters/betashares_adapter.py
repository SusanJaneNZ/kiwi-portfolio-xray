"""Adapter for BetaShares (ASX ETF) portfolio holdings disclosures (CSV and XLSX)."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from pipeline.adapters.base import (
    BaseAdapter,
    FundExtractionResult,
    RawHolding,
    clean_cell,
    clean_float_cell,
    extract_code_from_filename,
    parse_effective_date,
    should_divide_weights_by_100,
)
from pipeline.adapters.sorted_parser import CURRENCY_AND_CASH_TOKENS, _find_weight_col
from pipeline.adapters.tabular_reader import read_tabular_rows

BETASHARES_FUND_NAMES = {
    "ASIA": "BetaShares Asia Technology Tigers ETF (ASX: ASIA)",
    "NDQ": "BetaShares Nasdaq 100 ETF (ASX: NDQ)",
    "A200": "BetaShares Australia 200 ETF (ASX: A200)",
    "HACK": "BetaShares Global Cybersecurity ETF (ASX: HACK)",
    "ETHI": "BetaShares Global Sustainability Leaders ETF (ASX: ETHI)",
}

BETASHARES_NAME_HINTS = {
    "ASIA TECHNOLOGY TIGERS": "ASIA",
    "NASDAQ 100": "NDQ",
    "AUSTRALIA 200": "A200",
    "GLOBAL CYBERSECURITY": "HACK",
    "GLOBAL SUSTAINABILITY LEADERS": "ETHI",
}

_NAME_COL_NAMES = {"name", "company", "company name", "security", "security name", "holding", "holding name", "asset", "asset name"}
_CASH_TERMS = ("cash", "aud", "usd", "hkd", "twd", "krw", "cny", "payable", "receivable", "margin", "collateral")
_BETASHARES_CASH_RES = tuple(
    re.compile(rf"\b{re.escape(tok)}\b", re.IGNORECASE)
    for tok in (*_CASH_TERMS, *CURRENCY_AND_CASH_TOKENS)
)


_SORTED_BETASHARES_HINTS = sorted(BETASHARES_NAME_HINTS.items(), key=lambda kv: len(kv[0]), reverse=True)


class BetasharesAdapter(BaseAdapter):
    """Parses BetaShares ASX ETF holdings CSV or XLSX exports."""

    def can_handle(self, file_path: Path) -> bool:
        if file_path.suffix.lower() not in {".csv", ".xlsx"}:
            return False
        if file_path.parent.name.lower() == "betashares":
            return True
        upper = file_path.name.upper()
        return "BETASHARES" in upper or "BETA_SHARES" in upper

    def parse(self, file_path: Path) -> FundExtractionResult:
        fund_code = self._extract_code_from_filename(file_path.name)
        fund_name = BETASHARES_FUND_NAMES.get(fund_code, f"BetaShares {fund_code} ETF")

        rows = read_tabular_rows(file_path)
        effective_date = "2026-10-31"
        header: Optional[list[str]] = None
        col_map: dict[str, int] = {}
        weight_col = -1

        parsed_rows: list[dict] = []

        for row in rows:
            if not row or not any(c.strip() for c in row):
                continue

            if header is None:
                norm = [c.strip().lower() for c in row]
                candidate_map = {col: idx for idx, col in enumerate(norm)}
                name_match = any(c in _NAME_COL_NAMES for c in norm)
                weight_idx = _find_weight_col(candidate_map)
                if name_match and weight_idx != -1:
                    header = norm
                    col_map = candidate_map
                    weight_col = weight_idx
                    continue

                if len(row) >= 2:
                    meta_key = row[0].strip().lower()
                    meta_val = row[1].strip()
                    if meta_key == "fund asx code" and meta_val:
                        fund_code = meta_val.upper()
                    elif meta_key == "fund name" and meta_val:
                        fund_name = meta_val

                parsed_date = parse_effective_date(" ".join(row), prefer_day_first=True)
                if parsed_date:
                    effective_date = parsed_date
                continue

            name_idx = next((col_map[k] for k in _NAME_COL_NAMES if k in col_map), -1)
            if name_idx == -1 or weight_col == -1 or len(row) <= max(name_idx, weight_col):
                continue

            name = row[name_idx].strip()
            ticker_idx = next((i for k, i in col_map.items() if "ticker" in k or k in {"code", "asx code", "security code"}), -1)
            raw_ticker = row[ticker_idx].strip() if ticker_idx != -1 and len(row) > ticker_idx else ""
            ticker = raw_ticker.split()[0] if (" " in raw_ticker and raw_ticker.split()[0]) else raw_ticker
            if not name and ticker:
                name = ticker
            if not name or name.lower().startswith("total"):
                continue

            parsed_val = clean_float_cell(row[weight_col])
            if not parsed_val:
                continue
            raw_val, has_pct = parsed_val

            isin_idx = next((i for k, i in col_map.items() if "isin" in k), -1)
            isin = clean_cell(row[isin_idx]) if isin_idx != -1 and len(row) > isin_idx else ""

            sector_idx = next((i for k, i in col_map.items() if "sector" in k), -1)
            sector = row[sector_idx].strip() if sector_idx != -1 and len(row) > sector_idx else ""

            country_idx = next((i for k, i in col_map.items() if "country" in k or "location" in k), -1)
            country = row[country_idx].strip() if country_idx != -1 and len(row) > country_idx else ""

            asset_idx = next((i for k, i in col_map.items() if "asset" in k or "class" in k), -1)
            asset_class = row[asset_idx].strip() if asset_idx != -1 and len(row) > asset_idx else ""

            parsed_rows.append({
                "name": name,
                "ticker": ticker or None,
                "isin": isin or None,
                "sector": sector or None,
                "country": country or None,
                "asset_class": asset_class,
                "raw_val": raw_val,
                "has_pct": has_pct,
            })

        divide_by_100 = should_divide_weights_by_100(parsed_rows)

        holdings: list[RawHolding] = []
        cash_ratio = 0.0
        hedging_ratio = 0.0

        for r in parsed_rows:
            weight = (r["raw_val"] / 100.0) if (r["has_pct"] or divide_by_100) else r["raw_val"]
            if weight == 0.0:
                continue
            name_l = r["name"].lower()
            asset_l = r["asset_class"].lower()
            sector_l = (r["sector"] or "").lower()

            is_hedge = (
                ("forward" in name_l or "futures" in asset_l or "derivative" in asset_l)
                and not re.search(r"\b(?:etf|fund)\b", name_l)
            )
            is_cash = (
                not is_hedge
                and (
                    "cash" in asset_l
                    or "money market" in asset_l
                    or "cash" in sector_l
                    or any(pat.search(name_l) for pat in _BETASHARES_CASH_RES)
                )
            )
            if is_hedge:
                hedging_ratio += weight
                continue
            if is_cash:
                cash_ratio += weight
                continue
            if weight < 0:
                continue

            holdings.append(
                RawHolding(
                    name=r["name"],
                    weight=weight,
                    isin=r["isin"],
                    ticker=r["ticker"],
                    country=r["country"],
                    sector=r["sector"],
                    effective_date=effective_date,
                    raw_metadata={"asset_class": r["asset_class"]},
                )
            )

        return FundExtractionResult(
            fund_code=fund_code,
            fund_name=fund_name,
            provider="BetaShares",
            effective_date=effective_date,
            holdings=holdings,
            cash_ratio=max(0.0, cash_ratio),
            hedging_ratio=max(0.0, hedging_ratio),
            is_master=False,
            source_file=file_path.name,
        )

    def _extract_code_from_filename(self, filename: str) -> str:
        upper = Path(filename).stem.upper().replace("_", " ").replace("-", " ")
        prefix = re.match(r"^([A-Z0-9]{2,6})(?:\s|$)", upper)
        fallback = prefix.group(1) if (prefix and prefix.group(1) not in {"BETA", "HOLDINGS"}) else None
        code = extract_code_from_filename(
            filename,
            sorted_hints=_SORTED_BETASHARES_HINTS,
            known_codes=BETASHARES_FUND_NAMES,
            default_code="BETASHARES_FUND",
        )
        if code not in BETASHARES_FUND_NAMES and fallback:
            return fallback
        return code

