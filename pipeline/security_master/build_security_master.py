"""Compiles the Global Security Master from NZX, ASX directories and Vanguard VT global equities."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Optional

from pipeline.adapters.vanguard_adapter import VanguardAdapter
from pipeline.enrichment.fuzzy_matcher import normalize_company_name

COUNTRY_CODE_TO_NAME = {
    "AE": "United Arab Emirates",
    "AT": "Austria",
    "AU": "Australia",
    "BE": "Belgium",
    "BM": "Bermuda",
    "BR": "Brazil",
    "CA": "Canada",
    "CH": "Switzerland",
    "CL": "Chile",
    "CN": "China",
    "CO": "Colombia",
    "CZ": "Czechia",
    "DE": "Germany",
    "DK": "Denmark",
    "EG": "Egypt",
    "ES": "Spain",
    "FI": "Finland",
    "FR": "France",
    "GB": "United Kingdom",
    "GR": "Greece",
    "HK": "Hong Kong",
    "HU": "Hungary",
    "ID": "Indonesia",
    "IE": "Ireland",
    "IL": "Israel",
    "IN": "India",
    "IS": "Iceland",
    "IT": "Italy",
    "JP": "Japan",
    "KR": "South Korea",
    "KW": "Kuwait",
    "MX": "Mexico",
    "MY": "Malaysia",
    "NL": "Netherlands",
    "NO": "Norway",
    "NZ": "New Zealand",
    "PH": "Philippines",
    "PL": "Poland",
    "PT": "Portugal",
    "QA": "Qatar",
    "RO": "Romania",
    "SA": "Saudi Arabia",
    "SE": "Sweden",
    "SG": "Singapore",
    "TH": "Thailand",
    "TR": "Turkey",
    "TW": "Taiwan",
    "UK": "United Kingdom",
    "US": "United States",
    "USA": "United States",
    "VN": "Vietnam",
    "ZA": "South Africa",
}


def normalize_country(country_raw: str, default: str = "Global") -> str:
    cleaned = (country_raw or "").strip()
    if not cleaned or cleaned in {"-", "--", "---"}:
        return default
    return COUNTRY_CODE_TO_NAME.get(cleaned.upper(), cleaned)


def _normalize_country(country_raw: str, default: str = "Global") -> str:
    return normalize_country(country_raw, default)


def _normalize_sector(sector_raw: str, gics_lower_map: dict[str, str]) -> str:
    cleaned = (sector_raw or "").strip()
    if not cleaned:
        return "Unclassified"
    return gics_lower_map.get(cleaned.lower(), cleaned)


def _find_directory_file(directories_dir: Path, keyword: str, fallback_name: str) -> Optional[Path]:
    """Finds a staged directory CSV by exact fallback name or keyword match (e.g. ASXListedCompanies.csv)."""
    if not directories_dir.exists():
        return None
    fallback = directories_dir / fallback_name
    if fallback.exists():
        return fallback
    for candidate in sorted(directories_dir.glob("*.csv")):
        if keyword.lower() in candidate.name.lower():
            return candidate
    return None


def parse_nzx_directory(file_path: Path, gics_mapping: dict[str, str]) -> list[dict]:
    """Parses NZX listed company directory CSV (both headered and headerless 5-column Rank/Ticker/Name/Country/Sector)."""
    records: list[dict] = []
    if not file_path.exists():
        return records

    gics_lower = {k.lower(): v for k, v in gics_mapping.items()}

    with open(file_path, mode="r", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.reader(f)
        header: Optional[list[str]] = None
        col_map: dict[str, int] = {}

        for row in reader:
            if not row or not any(row):
                continue
            normalized_row = [c.strip().lower() for c in row]
            if "isin" in normalized_row or "ticker" in normalized_row or "code" in normalized_row or "nzx code" in normalized_row:
                header = normalized_row
                col_map = {c: idx for idx, c in enumerate(header)}
                continue

            # Auto-detect headerless 5-column format: Rank (int), Ticker, Company Name, Country, Sector
            if not header and len(row) == 5 and row[0].strip().isdigit():
                col_map = {"ticker": 1, "name": 2, "country": 3, "sector": 4}
                header = ["rank", "ticker", "company name", "country", "sector"]

            if not header:
                continue

            try:
                isin_col = next((idx for k, idx in col_map.items() if "isin" in k), -1)
                ticker_col = next((idx for k, idx in col_map.items() if "ticker" in k or "code" in k), -1)
                name_col = next((idx for k, idx in col_map.items() if "name" in k or "issuer" in k), -1)
                country_col = next((idx for k, idx in col_map.items() if "country" in k), -1)
                sector_col = next((idx for k, idx in col_map.items() if "sector" in k or "industry" in k), -1)

                isin = row[isin_col].strip() if isin_col != -1 and len(row) > isin_col else ""
                ticker = row[ticker_col].strip().upper() if ticker_col != -1 and len(row) > ticker_col else ""
                name = row[name_col].strip() if name_col != -1 and len(row) > name_col else ""
                country_raw = row[country_col].strip() if country_col != -1 and len(row) > country_col else "New Zealand"
                sector_raw = row[sector_col].strip() if sector_col != -1 and len(row) > sector_col else "Unclassified"

                if not isin and not ticker:
                    continue

                plain_ticker = ticker[:-3] if ticker.endswith(".NZ") else ticker
                if not isin and plain_ticker:
                    isin = f"NZX:{plain_ticker}"

                clean_ticker = f"{plain_ticker}.NZ"
                sector = _normalize_sector(sector_raw, gics_lower)
                country = _normalize_country(country_raw, default="New Zealand")

                records.append({
                    "isin": isin,
                    "name": name,
                    "ticker": clean_ticker,
                    "exchange": "NZX",
                    "country": country,
                    "sector": sector,
                })
            except (ValueError, IndexError):
                continue

    return records


def parse_asx_directory(file_path: Path, gics_mapping: dict[str, str]) -> list[dict]:
    """Parses ASX listed company directory CSV (e.g. ASXListedCompanies.csv)."""
    records: list[dict] = []
    if not file_path.exists():
        return records

    gics_lower = {k.lower(): v for k, v in gics_mapping.items()}

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

            # Skip leading ASX metadata timestamp line ("ASX listed companies as at ...")
            if not header:
                continue

            try:
                code_col = next((idx for k, idx in col_map.items() if "code" in k or "ticker" in k), -1)
                name_col = next((idx for k, idx in col_map.items() if "name" in k or "company" in k), -1)
                sector_col = next((idx for k, idx in col_map.items() if "gics" in k or "industry" in k or "sector" in k), -1)

                code = row[code_col].strip().upper() if code_col != -1 and len(row) > code_col else ""
                name = row[name_col].strip() if name_col != -1 and len(row) > name_col else ""
                sector_raw = row[sector_col].strip() if sector_col != -1 and len(row) > sector_col else "Unclassified"

                if not code or not name:
                    continue

                plain_code = code[:-3] if code.endswith(".AX") else code
                clean_ticker = f"{plain_code}.AX"
                sector = _normalize_sector(sector_raw, gics_lower)

                records.append({
                    "isin": f"ASX:{plain_code}",
                    "name": name,
                    "ticker": clean_ticker,
                    "exchange": "ASX",
                    "country": "Australia",
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

    gics_lower = {k.lower(): v for k, v in gics_mapping.items()}
    adapter = VanguardAdapter()
    result = adapter.parse(file_path)

    for h in result.holdings:
        if not h.isin and not h.name:
            continue
        sector = _normalize_sector(h.sector or "", gics_lower)
        country = _normalize_country(h.country or "", default="Global")
        records.append({
            "isin": h.isin,
            "name": h.name,
            "ticker": h.ticker or "",
            "exchange": "GLOBAL",
            "country": country,
            "sector": sector,
        })

    return records


def _enrich_local_isins_from_global(local_records: list[dict], global_records: list[dict]) -> None:
    """Replaces synthetic exchange IDs (e.g. ASX:BHP, NZX:FPH) with canonical ISINs from Vanguard VT when matched."""
    by_norm_name: dict[str, str] = {}
    for g in global_records:
        isin = g.get("isin", "").strip()
        if not isin or isin.startswith("ASX:") or isin.startswith("NZX:") or isin.startswith("VANG:"):
            continue
        norm = normalize_company_name(g.get("name", ""))
        if norm and norm not in by_norm_name:
            by_norm_name[norm] = isin

    for rec in local_records:
        isin = rec.get("isin", "")
        if isin.startswith("ASX:") or isin.startswith("NZX:"):
            norm = normalize_company_name(rec.get("name", ""))
            if norm in by_norm_name:
                rec["isin"] = by_norm_name[norm]


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

    directories_dir = staging_dir / "directories"

    # 1. Parse NZX
    nzx_file = _find_directory_file(directories_dir, "nzx", "nzx_directory.csv")
    nzx_records = parse_nzx_directory(nzx_file, gics_mapping) if nzx_file else []

    # 2. Parse ASX (supports ASXListedCompanies.csv or asx_directory.csv)
    asx_file = _find_directory_file(directories_dir, "asx", "asx_directory.csv")
    asx_records = parse_asx_directory(asx_file, gics_mapping) if asx_file else []

    # 3. Parse all Vanguard Global CSVs (preferring VT first)
    vanguard_dir = staging_dir / "vanguard"
    vanguard_records: list[dict] = []
    if vanguard_dir.exists():
        vanguard_files = sorted(
            vanguard_dir.glob("*.csv"),
            key=lambda p: (0 if "vt" in p.name.lower() or "total_world" in p.name.lower() else 1, p.name),
        )
        for vf in vanguard_files:
            vanguard_records.extend(parse_vanguard_global_directory(vf, gics_mapping))

    # Enrich ASX/NZX records with canonical ISINs from Vanguard VT before deduplicating
    _enrich_local_isins_from_global(nzx_records, vanguard_records)
    _enrich_local_isins_from_global(asx_records, vanguard_records)

    # Merge into Global Security Master, deduplicated by ISIN (Priority: NZX > ASX > Vanguard Global)
    seen_isins: set[str] = set()
    global_master: list[dict] = []

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

    # Extract direct equities (NZX and ASX) deduplicated by (exchange, ticker) so dual-listed stocks remain selectable on both exchanges
    seen_exchange_tickers: set[tuple[str, str]] = set()
    direct_equities: list[dict] = []
    for rec in nzx_records + asx_records:
        key = (rec.get("exchange", ""), rec.get("ticker", ""))
        if key not in seen_exchange_tickers:
            seen_exchange_tickers.add(key)
            direct_equities.append(rec)

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
