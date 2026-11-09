"""Compiles the Global Security Master from NZX, ASX directories and Vanguard VT global equities."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Optional

from pipeline.adapters.vanguard_adapter import VanguardAdapter


def parse_nzx_directory(file_path: Path, gics_mapping: dict[str, str]) -> list[dict]:
    """Parses NZX listed company directory CSV."""
    records: list[dict] = []
    if not file_path.exists():
        return records

    with open(file_path, mode="r", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.reader(f)
        header: Optional[list[str]] = None
        col_map: dict[str, int] = {}

        for row in reader:
            if not row or not any(row):
                continue
            normalized_row = [c.strip().lower() for c in row]
            if "isin" in normalized_row or "ticker" in normalized_row or "code" in normalized_row:
                header = normalized_row
                col_map = {c: idx for idx, c in enumerate(header)}
                continue

            if not header:
                continue

            try:
                isin_col = next((idx for k, idx in col_map.items() if "isin" in k), -1)
                ticker_col = next((idx for k, idx in col_map.items() if "ticker" in k or "code" in k), -1)
                name_col = next((idx for k, idx in col_map.items() if "name" in k or "issuer" in k), -1)
                sector_col = next((idx for k, idx in col_map.items() if "sector" in k or "industry" in k), -1)

                isin = row[isin_col].strip() if isin_col != -1 and len(row) > isin_col else ""
                ticker = row[ticker_col].strip() if ticker_col != -1 and len(row) > ticker_col else ""
                name = row[name_col].strip() if name_col != -1 and len(row) > name_col else ""
                sector_raw = row[sector_col].strip() if sector_col != -1 and len(row) > sector_col else "Unclassified"

                if not isin and not ticker:
                    continue

                if not isin and ticker:
                    isin = f"NZ{ticker}0001"

                # Ensure ticker has .NZ suffix for direct autocomplete disambiguation
                clean_ticker = ticker if ".NZ" in ticker else f"{ticker}.NZ"
                sector = gics_mapping.get(sector_raw, sector_raw)

                records.append({
                    "isin": isin,
                    "name": name,
                    "ticker": clean_ticker,
                    "exchange": "NZX",
                    "country": "NZ",
                    "sector": sector,
                })
            except (ValueError, IndexError):
                continue

    return records


def parse_asx_directory(file_path: Path, gics_mapping: dict[str, str]) -> list[dict]:
    """Parses ASX listed company directory CSV."""
    records: list[dict] = []
    if not file_path.exists():
        return records

    with open(file_path, mode="r", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.reader(f)
        header: Optional[list[str]] = None
        col_map: dict[str, int] = {}

        for row in reader:
            if not row or not any(row):
                continue
            normalized_row = [c.strip().lower() for c in row]
            if "asx code" in normalized_row or "ticker" in normalized_row or "code" in normalized_row:
                header = normalized_row
                col_map = {c: idx for idx, c in enumerate(header)}
                continue

            if not header:
                continue

            try:
                code_col = next((idx for k, idx in col_map.items() if "code" in k or "ticker" in k), -1)
                name_col = next((idx for k, idx in col_map.items() if "name" in k or "company" in k), -1)
                sector_col = next((idx for k, idx in col_map.items() if "gics" in k or "industry" in k or "sector" in k), -1)

                code = row[code_col].strip() if code_col != -1 and len(row) > code_col else ""
                name = row[name_col].strip() if name_col != -1 and len(row) > name_col else ""
                sector_raw = row[sector_col].strip() if sector_col != -1 and len(row) > sector_col else "Unclassified"

                if not code or not name:
                    continue

                isin = f"AU000000{code:<3}"[:12]
                clean_ticker = code if ".AX" in code else f"{code}.AX"
                sector = gics_mapping.get(sector_raw, sector_raw)

                records.append({
                    "isin": isin,
                    "name": name,
                    "ticker": clean_ticker,
                    "exchange": "ASX",
                    "country": "AU",
                    "sector": sector,
                })
            except (ValueError, IndexError):
                continue

    return records


def parse_vanguard_global_directory(file_path: Path, gics_mapping: dict[str, str]) -> list[dict]:
    """Extracts verified global equity constituents from Vanguard VT master ETF export."""
    records: list[dict] = []
    if not file_path.exists():
        return records

    adapter = VanguardAdapter()
    result = adapter.parse(file_path)

    for h in result.holdings:
        if not h.isin and not h.name:
            continue
        sector = gics_mapping.get(h.sector or "", h.sector or "Unclassified")
        records.append({
            "isin": h.isin or f"US{h.cusip or 'GLOBAL'}0",
            "name": h.name,
            "ticker": h.ticker or "",
            "exchange": "GLOBAL",
            "country": h.country or "Global",
            "sector": sector,
        })

    return records


def compile_security_master(
    staging_dir: Path,
    output_master_path: Path,
    output_direct_path: Path,
    gics_mapping_path: Path,
) -> dict:
    """Compiles the global security master and writes client direct_equities.json."""
    gics_mapping: dict[str, str] = {}
    if gics_mapping_path.exists():
        with open(gics_mapping_path, "r", encoding="utf-8") as f:
            gics_mapping = json.load(f)

    # 1. Parse NZX
    nzx_file = staging_dir / "directories" / "nzx_directory.csv"
    nzx_records = parse_nzx_directory(nzx_file, gics_mapping)

    # 2. Parse ASX
    asx_file = staging_dir / "directories" / "asx_directory.csv"
    asx_records = parse_asx_directory(asx_file, gics_mapping)

    # 3. Parse Vanguard VT (Global Equities)
    vt_file = staging_dir / "vanguard" / "Holdings_details_VT.csv"
    vanguard_records = parse_vanguard_global_directory(vt_file, gics_mapping)

    # Merge and deduplicate by ISIN and Ticker
    seen_isins: set[str] = set()
    global_master: list[dict] = []

    # Priority: NZX > ASX > Vanguard Global
    for rec in nzx_records + asx_records + vanguard_records:
        isin = rec.get("isin", "").strip()
        if isin and isin in seen_isins:
            continue
        if isin:
            seen_isins.add(isin)
        global_master.append(rec)

    # Write global master to destination
    output_master_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_master_path, "w", encoding="utf-8") as f:
        json.dump(global_master, f, indent=2)

    # Extract direct equities (NZX and ASX only) for client-side search autocomplete
    direct_equities = [r for r in global_master if r.get("exchange") in {"NZX", "ASX"}]
    output_direct_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_direct_path, "w", encoding="utf-8") as f:
        json.dump(direct_equities, f, indent=2)

    return {
        "total_security_master_count": len(global_master),
        "direct_equities_count": len(direct_equities),
        "nzx_count": len(nzx_records),
        "asx_count": len(asx_records),
        "vanguard_global_count": len(vanguard_records),
    }

