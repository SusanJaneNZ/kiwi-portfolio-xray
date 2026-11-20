"""Local-only Admin Web UI for staging CSVs, previewing adapters, mapping aliases, and running builds."""

from __future__ import annotations

import argparse
import base64
import csv
import io
import json
import logging
import re
import shutil
import sys
import threading
import traceback
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

logger = logging.getLogger(__name__)

from pipeline.adapters import PROVIDER_ADAPTERS, iter_staged_files
from pipeline.adapters.tabular_reader import read_tabular_rows
from pipeline.enrichment.fuzzy_matcher import (
    SecurityMatcher,
    normalize_company_name,
    token_sort_similarity,
)
from pipeline.output.build_output import PipelineCompiler
from pipeline.security_master.build_security_master import (
    atomic_write_json,
    parse_asx_directory,
    parse_nzx_directory,
)
from pipeline.providers import (
    ALLOWED_PROVIDERS,
    KIWISAVER_PROVIDER_SLUGS,
    get_default_scheme_offer,
    get_provider_config,
    normalize_provider,
)

ALLOWED_MASTER_PROVIDERS = {"vanguard", "ishares", "spdr"}


class AdminService:
    """Backend operations for the local Admin Web UI."""

    def __init__(self, repo_root: Path, staging_dir: Path | None = None, output_dir: Path | None = None):
        self.repo_root = repo_root
        self.staging_dir = staging_dir or (repo_root / "data" / "staging")
        self.output_dir = output_dir or (repo_root / "public" / "data")
        alias_candidate = repo_root / "pipeline" / "enrichment" / "company_alias_map.json"
        legacy_candidate = repo_root / "pipeline" / "enrichment" / "provider_alias_map.json"
        self.alias_map_path = alias_candidate if alias_candidate.exists() else (legacy_candidate if legacy_candidate.exists() else alias_candidate)
        self.manual_securities_path = repo_root / "pipeline" / "enrichment" / "manual_securities.json"
        self.security_master_path = repo_root / "pipeline" / "security_master" / "security_master.json"
        self.gics_mapping_path = repo_root / "pipeline" / "normalizer" / "gics_mapping.json"
        self.feeder_registry_path = repo_root / "pipeline" / "feeder_registry.json"
        self.fund_catalog_path = repo_root / "pipeline" / "fund_catalog.json"
        self._lock = threading.Lock()
        self._last_unconfigured_feeders: set[str] = set()

    def list_staged_files(self) -> dict[str, list[dict[str, Any]]]:
        """Lists all CSV and XLSX files currently staged under each provider folder."""
        result: dict[str, list[dict[str, Any]]] = {}
        for provider in sorted(ALLOWED_PROVIDERS):
            files: list[dict[str, Any]] = []
            for f in iter_staged_files(self.staging_dir, provider):
                stat = f.stat()
                files.append({
                    "filename": f.name,
                    "size_bytes": stat.st_size,
                    "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                })
            result[provider] = files
        return result

    def save_staged_file(
        self,
        provider: str,
        filename: str,
        content: str = "",
        content_base64: str = "",
    ) -> dict[str, Any]:
        """Saves an uploaded CSV or XLSX file to data/staging/<provider>/<filename>."""
        norm_prov = re.sub(r"[\s\-]+", "_", str(provider).strip().lower())
        if norm_prov in ALLOWED_PROVIDERS:
            provider = norm_prov
        elif provider not in ALLOWED_PROVIDERS:
            raise ValueError(f"Invalid provider directory '{provider}'. Must be one of {sorted(ALLOWED_PROVIDERS)}.")

        safe_name = Path(filename).name.strip()
        if not safe_name or Path(safe_name).suffix.lower() not in {".csv", ".xlsx"}:
            raise ValueError("Filename must end with .csv or .xlsx")

        target_dir = self.staging_dir / provider
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / safe_name

        if content_base64:
            target_path.write_bytes(base64.b64decode(content_base64))
        else:
            target_path.write_text(content, encoding="utf-8")

        return {
            "provider": provider,
            "filename": safe_name,
            "size_bytes": target_path.stat().st_size,
        }

    def delete_staged_file(self, provider: str, filename: str) -> bool:
        """Deletes a CSV/XLSX file from data/staging/<provider>/<filename>."""
        norm_prov = re.sub(r"[\s\-]+", "_", str(provider).strip().lower())
        if norm_prov in ALLOWED_PROVIDERS:
            provider = norm_prov
        elif provider not in ALLOWED_PROVIDERS:
            raise ValueError(f"Invalid provider directory '{provider}'.")

        safe_name = Path(filename).name.strip()
        target_path = self.staging_dir / provider / safe_name
        if target_path.exists() and target_path.is_file():
            target_path.unlink()
            return True
        return False

    def preview_staged_file(self, provider: str, filename: str) -> dict[str, Any]:
        """Previews raw file lines (CSV or XLSX) and tests parsing with the matching Tier 1 adapter."""
        norm_prov = re.sub(r"[\s\-]+", "_", str(provider).strip().lower())
        if norm_prov in ALLOWED_PROVIDERS:
            provider = norm_prov
        elif provider not in ALLOWED_PROVIDERS:
            raise ValueError(f"Invalid provider directory '{provider}'.")

        safe_name = Path(filename).name.strip()
        target_path = self.staging_dir / provider / safe_name
        if not target_path.exists():
            raise FileNotFoundError(f"File not found: {provider}/{safe_name}")

        raw_lines: list[str] = []
        if target_path.suffix.lower() == ".xlsx":
            rows = read_tabular_rows(target_path)
            raw_lines = [" | ".join(r) for r in rows[:10]]
        else:
            with open(target_path, "r", encoding="utf-8-sig", errors="replace") as f:
                for _ in range(10):
                    line = f.readline()
                    if not line:
                        break
                    raw_lines.append(line.rstrip("\r\n"))

        parse_summary: dict[str, Any] = {"adapter": None, "status": "no_matching_adapter", "rows": []}

        if provider == "directories":
            gics_mapping = {}
            if self.gics_mapping_path.exists():
                gics_mapping = json.loads(self.gics_mapping_path.read_text(encoding="utf-8"))
            if "nzx" in safe_name.lower():
                recs = parse_nzx_directory(target_path, gics_mapping)
                parse_summary = {
                    "adapter": "NZX Directory Parser",
                    "status": "ok" if recs else "empty",
                    "parsed_count": len(recs),
                    "sample_rows": recs[:5],
                }
            elif "asx" in safe_name.lower():
                recs = parse_asx_directory(target_path, gics_mapping)
                parse_summary = {
                    "adapter": "ASX Directory Parser",
                    "status": "ok" if recs else "empty",
                    "parsed_count": len(recs),
                    "sample_rows": recs[:5],
                }
            return {"raw_lines": raw_lines, "parse_summary": parse_summary}

        adapter_cls = PROVIDER_ADAPTERS.get(provider)
        adapter = adapter_cls() if adapter_cls else None
        if adapter:
            can_handle = adapter.can_handle(target_path)
            if can_handle:
                res = adapter.parse(target_path)
                total_equity = sum(h.weight for h in res.holdings)
                parse_summary = {
                    "adapter": adapter.__class__.__name__,
                    "status": "ok" if res.holdings else "empty",
                    "fund_code": res.fund_code,
                    "fund_name": res.fund_name,
                    "effective_date": res.effective_date,
                    "cash_ratio": res.cash_ratio,
                    "parsed_count": len(res.holdings),
                    "total_equity_weight": round(total_equity, 4),
                    "sample_rows": [
                        {
                            "name": h.name,
                            "ticker": h.ticker,
                            "isin": h.isin,
                            "country": h.country,
                            "sector": h.sector,
                            "weight": round(h.weight, 6),
                        }
                        for h in res.holdings[:8]
                    ],
                }
            else:
                parse_summary = {
                    "adapter": adapter.__class__.__name__,
                    "status": "filename_not_recognized",
                    "hint": f"Rename file to include expected provider/fund code for {adapter.__class__.__name__}.",
                }

        return {"raw_lines": raw_lines, "parse_summary": parse_summary}

    def _build_security_matcher(self, sm_data: list[dict[str, Any]] | None = None) -> SecurityMatcher | None:
        """Builds a SecurityMatcher from provided or persisted security_master.json + manual_securities.json."""
        if sm_data is None:
            if not self.security_master_path.exists():
                sm_data = []
            else:
                sm_data = json.loads(self.security_master_path.read_text(encoding="utf-8"))
        manual_map = self.get_manual_securities()
        if manual_map:
            manual_entries = [
                {
                    "isin": isin_key,
                    "name": entry.get("name", isin_key),
                    "ticker": entry.get("ticker", ""),
                    "country": entry.get("country", "Global"),
                    "sector": entry.get("sector", "Unclassified"),
                }
                for isin_key, entry in manual_map.items()
            ]
            manual_isins = {e["isin"] for e in manual_entries}
            sm_data = manual_entries + [s for s in sm_data if s.get("isin") not in manual_isins]
        if not sm_data:
            return None
        gics_data = (
            json.loads(self.gics_mapping_path.read_text(encoding="utf-8"))
            if self.gics_mapping_path.exists()
            else {}
        )
        return SecurityMatcher(security_master=sm_data, alias_map=self.get_alias_map(), gics_mapping=gics_data)

    def _read_raw_fund_catalog(self) -> list[dict[str, Any]]:
        """Reads raw fund_catalog.json without dynamic runtime enrichment."""
        if not self.fund_catalog_path.exists():
            return []
        try:
            return json.loads(self.fund_catalog_path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Error reading %s: %s", self.fund_catalog_path, exc)
            return []

    def _index_staged_files(self) -> list[str]:
        """Collects filenames of all staged files across all directories in staging_dir."""
        filenames: list[str] = []
        if self.staging_dir.exists():
            for p in self.staging_dir.glob("*/*"):
                if p.is_file() and p.suffix.lower() in {".csv", ".xlsx"}:
                    filenames.append(p.name.upper())
        return filenames

    def _has_staged_disclosure(self, item: dict[str, Any], filenames: list[str]) -> bool:
        """Determines whether a statutory disclosure file exists in staging for this fund."""
        fnd = str(item.get("fnd_code", "")).strip().upper()
        code = str(item.get("fund_code", "")).strip().upper()

        # 1. Authoritative FND code check (Disclose Register standard)
        if fnd and any(fnd in fn for fn in filenames):
            return True

        # 2. Token match for fund_code (avoiding collision with files carrying another FND code)
        for fn in filenames:
            file_fnds = re.findall(r"FND\d+", fn)
            if file_fnds and fnd and all(ff != fnd for ff in file_fnds):
                continue
            pattern = rf"(^|[^A-Z0-9]){re.escape(code)}([^A-Z0-9]|$)"
            if re.search(pattern, fn):
                return True

        return False

    def _get_staged_master_tickers(self) -> dict[str, set[str]]:
        """Discovers staged master ETF tickers in vanguard, ishares, and spdr directories."""
        result: dict[str, set[str]] = {"vanguard": set(), "ishares": set(), "spdr": set()}

        # Vanguard
        vg_dir = self.staging_dir / "vanguard"
        if vg_dir.exists():
            try:
                from pipeline.adapters.vanguard_adapter import VanguardAdapter
                v_ad = VanguardAdapter()
                for f in vg_dir.glob("*.csv"):
                    ticker = v_ad._extract_ticker_from_text(f.name)
                    if not ticker:
                        try:
                            lines = f.read_text(encoding="utf-8", errors="ignore").splitlines()[:15]
                            for l in lines:
                                ticker = v_ad._extract_ticker_from_text(l)
                                if ticker:
                                    break
                        except Exception:
                            pass
                    if ticker:
                        result["vanguard"].add(ticker.upper())
            except Exception as exc:
                logger.warning("Error indexing vanguard staged files: %s", exc)

        # iShares
        is_dir = self.staging_dir / "ishares"
        if is_dir.exists():
            try:
                from pipeline.adapters.ishares_adapter import ISharesAdapter
                i_ad = ISharesAdapter()
                for f in is_dir.glob("*.csv"):
                    ticker = i_ad._extract_ticker_from_filename(f.name)
                    if ticker:
                        result["ishares"].add(ticker.upper())
            except Exception as exc:
                logger.warning("Error indexing ishares staged files: %s", exc)

        # SPDR
        sp_dir = self.staging_dir / "spdr"
        if sp_dir.exists():
            try:
                from pipeline.adapters.spdr_adapter import SPDRAdapter
                s_ad = SPDRAdapter()
                for f in sp_dir.glob("*.xlsx"):
                    ticker = s_ad._extract_ticker(f.name)
                    if ticker:
                        result["spdr"].add(ticker.upper())
            except Exception as exc:
                logger.warning("Error indexing spdr staged files: %s", exc)

        return result

    def _get_unresolved_fund_codes(self) -> set[str]:
        """Loads fund codes with unmapped company holdings from unresolved_entries.json."""
        unres_path = self.repo_root / "public" / "data" / "unresolved_entries.json"
        if not unres_path.exists():
            return set()
        try:
            entries = json.loads(unres_path.read_text(encoding="utf-8"))
            codes: set[str] = set()
            for e in entries:
                fcode = str(e.get("fund_code", "")).strip().upper()
                if fcode:
                    codes.add(fcode)
            return codes
        except Exception:
            return set()

    def get_fund_catalog(self) -> list[dict[str, Any]]:
        """Returns the list of managed funds from fund_catalog.json enriched with As Of dates, processing status, and granular diagnostic steps."""
        catalog = self._read_raw_fund_catalog()
        if not catalog:
            return []

        # Load funds_registry.json from output_dir if present to discover constituent_count & effective_date
        registry_path = self.output_dir / "funds_registry.json"
        reg_map: dict[str, dict[str, Any]] = {}
        if registry_path.exists():
            try:
                reg_list = json.loads(registry_path.read_text(encoding="utf-8"))
                for r in reg_list:
                    code = str(r.get("code", "")).strip().upper()
                    if code:
                        reg_map[code] = r
            except Exception as exc:
                logger.warning("Error reading %s: %s", registry_path, exc)

        feeder_registry = self.get_feeder_registry()
        staged_masters = self._get_staged_master_tickers()
        staged_files = self._index_staged_files()
        unresolved_funds = self._get_unresolved_fund_codes()

        enriched: list[dict[str, Any]] = []
        for entry in catalog:
            item = dict(entry)
            code = str(item.get("fund_code", "")).strip().upper()
            provider_norm = str(item.get("provider", "smartshares")).strip().lower().replace(" ", "_")
            reg_entry = reg_map.get(code)
            if reg_entry and reg_entry.get("constituent_count", 0) > 0:
                item["effective_date"] = reg_entry.get("effective_date", "")
                item["constituent_count"] = reg_entry.get("constituent_count", 0)
                item["is_stale"] = bool(reg_entry.get("is_stale", False))
                item["status"] = "PROCESSED"
                item["sub_status"] = "PROCESSED"
                item["status_label"] = "Processed"
                item["target_panel"] = "panel-catalog"
                item["target_param"] = ""
                item["action_tooltip"] = "Fund constituents published and verified"
            else:
                item["effective_date"] = ""
                item["constituent_count"] = 0
                item["is_stale"] = False
                item["status"] = "AWAITING_PROCESSING"

                has_file = self._has_staged_disclosure(item, staged_files)
                feeder_info = feeder_registry.get(code)
                is_unconf_feeder = code in self._last_unconfigured_feeders

                if not has_file:
                    item["sub_status"] = "AWAITING_DISCLOSURE"
                    item["status_label"] = "Awaiting Disclosure File"
                    item["target_panel"] = "panel-staging"
                    item["target_param"] = provider_norm
                    item["action_tooltip"] = f"Download or stage disclosure file for {code} in Panel 1"
                elif not feeder_info and is_unconf_feeder:
                    item["sub_status"] = "AWAITING_MASTER_MAPPING"
                    item["status_label"] = "Awaiting Master Fund Mapping"
                    item["target_panel"] = "panel-feeders"
                    item["target_param"] = code
                    item["action_tooltip"] = f"Pair feeder fund {code} with Master ETF in Panel 4"
                elif feeder_info:
                    master_prov = str(feeder_info.get("master_provider", "vanguard")).strip().lower()
                    master_tick = str(feeder_info.get("master_ticker", "")).strip().upper()
                    has_master_file = master_tick in staged_masters.get(master_prov, set())
                    if not has_master_file:
                        item["sub_status"] = "AWAITING_MASTER_DISCLOSURE"
                        item["status_label"] = "Awaiting Master Fund Disclosure File"
                        item["target_panel"] = "panel-staging"
                        item["target_param"] = master_prov
                        item["action_tooltip"] = f"Upload {master_tick} disclosure to data/staging/{master_prov}/ in Panel 1"
                    else:
                        item["sub_status"] = "AWAITING_MASTER_PUBLISH"
                        item["status_label"] = "Awaiting Master Fund Publish"
                        item["target_panel"] = "panel-diagnostics"
                        item["target_param"] = ""
                        item["action_tooltip"] = f"Disclosures ready: click to run Publish Datasets in Panel 3"
                else:
                    item["sub_status"] = "AWAITING_PUBLISH"
                    item["status_label"] = "Awaiting Publish"
                    item["target_panel"] = "panel-diagnostics"
                    item["target_param"] = ""
                    item["action_tooltip"] = f"Disclosure staged: click to run Publish Datasets in Panel 3"
            enriched.append(item)

        # Sort: Awaiting processing first, then oldest As-Of date, then fund_code
        def sort_key(x: dict[str, Any]) -> tuple[int, str, str]:
            is_awaiting = (x.get("status") == "AWAITING_PROCESSING" or not x.get("effective_date"))
            order = 0 if is_awaiting else 1
            eff = str(x.get("effective_date", ""))
            fcode = str(x.get("fund_code", ""))
            return (order, eff, fcode)

        enriched.sort(key=sort_key)
        return enriched

    def save_fund_catalog_entry(self, entry: dict[str, Any]) -> list[dict[str, Any]]:
        """Adds or updates a fund in fund_catalog.json."""
        with self._lock:
            catalog = self._read_raw_fund_catalog()
            fund_code = str(entry.get("fund_code", "")).strip().upper()
            if not fund_code:
                raise ValueError("fund_code is required")

            provider = str(entry.get("provider", "Kernel")).strip().title()
            if not provider:
                provider = "KiwiSaver"

            fnd_raw = str(entry.get("fnd_code", "")).strip()
            scheme_id = str(entry.get("scheme_id", "")).strip().upper()
            offer_id = str(entry.get("offer_id", "")).strip().upper()
            fnd_code = ""

            if "FND" in fnd_raw.upper():
                fnd_match = re.search(r"(FND\d+)", fnd_raw, re.IGNORECASE)
                if fnd_match:
                    fnd_code = fnd_match.group(1).upper()
            if not fnd_code:
                raise ValueError("A valid FND code (e.g. FND15841) or Smart Investor URL is required")

            combined_text = f"{fnd_raw} {entry.get('holdings_url', '')}"
            default_sch, default_ofr = get_default_scheme_offer(provider)
            if not scheme_id:
                sch_m = re.search(r"(SCH\d+)", combined_text, re.IGNORECASE)
                scheme_id = sch_m.group(1).upper() if sch_m else default_sch

            if not offer_id:
                ofr_m = re.search(r"(OFR\d+)", combined_text, re.IGNORECASE)
                offer_id = ofr_m.group(1).upper() if ofr_m else default_ofr

            fund_name = str(entry.get("fund_name", "")).strip() or fund_code.replace("_", " ").title()
            norm_prov = re.sub(r"[\s\-]+", "_", provider.lower())
            is_etf = bool(entry.get("is_etf", norm_prov == "smartshares"))
            is_kiwisaver = bool(
                entry.get(
                    "is_kiwisaver",
                    "kiwi" in provider.lower()
                    or "kiwi" in fund_code.lower()
                    or norm_prov in {"simplicity", "fisher_funds", "milford", "generate", "booster", "anz", "asb", "westpac", "bnz"}
                )
            )

            existing_entry = next((c for c in catalog if c.get("fund_code", "").upper() == fund_code), None)
            if "holdings_url" in entry:
                holdings_url = str(entry.get("holdings_url", "")).strip()
            else:
                holdings_url = ""
                if ("http://" in fnd_raw or "https://" in fnd_raw) and fnd_raw.endswith(".xlsx"):
                    holdings_url = fnd_raw
                elif existing_entry and existing_entry.get("holdings_url"):
                    holdings_url = existing_entry["holdings_url"]

            clean_entry: dict[str, Any] = {
                "fund_code": fund_code,
                "fund_name": fund_name,
                "provider": provider,
                "fnd_code": fnd_code,
                "scheme_id": scheme_id,
                "offer_id": offer_id,
                "is_etf": is_etf,
                "is_kiwisaver": is_kiwisaver,
            }
            if holdings_url:
                clean_entry["holdings_url"] = holdings_url

            idx = next((i for i, c in enumerate(catalog) if c.get("fund_code", "").upper() == fund_code), None)
            if idx is not None:
                catalog[idx] = clean_entry
            else:
                catalog.append(clean_entry)

            catalog.sort(key=lambda x: (x.get("provider", ""), x.get("fund_name", "")))
            self.fund_catalog_path.parent.mkdir(parents=True, exist_ok=True)
            self.fund_catalog_path.write_text(json.dumps(catalog, indent=2), encoding="utf-8")
            return self.get_fund_catalog()

    def delete_fund_catalog_entry(self, fund_code: str) -> list[dict[str, Any]]:
        """Deletes a fund entry from fund_catalog.json by its fund_code."""
        with self._lock:
            catalog = self._read_raw_fund_catalog()
            fcode_clean = str(fund_code).strip().upper()
            catalog = [c for c in catalog if c.get("fund_code", "").upper() != fcode_clean]
            self.fund_catalog_path.parent.mkdir(parents=True, exist_ok=True)
            self.fund_catalog_path.write_text(json.dumps(catalog, indent=2), encoding="utf-8")
            return self.get_fund_catalog()

    def fetch_disclosures(
        self,
        providers: list[str] | None = None,
        force: bool = False,
        fund_code: str | None = None,
    ) -> dict[str, Any]:
        """Triggers SmartInvestorFetcher to synchronize disclosures into data/staging."""
        from pipeline.fetchers import SmartInvestorFetcher
        fetcher = SmartInvestorFetcher(staging_dir=self.staging_dir, catalog_path=self.fund_catalog_path)
        if fund_code:
            clean_code = str(fund_code).strip().upper()
            target = next((m for m in fetcher.catalog if m.target_code.upper() == clean_code), None)
            if not target:
                err_msg = f"Fund code '{clean_code}' not found in catalogue"
                sys.stderr.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [AdminUI ERROR] {err_msg}\n")
                sys.stderr.flush()
                return {
                    "downloaded": [],
                    "cached": [],
                    "failed": [{"code": clean_code, "message": err_msg, "fund_id": ""}],
                    "success": False,
                }

            sys.stderr.write(
                f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [AdminUI] Fetching disclosure for {clean_code} "
                f"(Fund ID: {target.fund_id}, Provider: {target.provider}, URL: {target.holdings_url}, Force: {force})...\n"
            )
            sys.stderr.flush()

            success, message, path = fetcher.fetch_fund(target, force=force)
            entry = {
                "code": target.target_code,
                "fund_id": target.fund_id,
                "provider": target.provider,
                "url": target.holdings_url,
                "message": message,
                "path": str(path) if path else None,
            }
            if not success:
                sys.stderr.write(
                    f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [AdminUI ERROR] Fetch failed for {clean_code}: {message}\n"
                )
            else:
                sys.stderr.write(
                    f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [AdminUI] Fetch completed for {clean_code}: {message} (staged: {path})\n"
                )
            sys.stderr.flush()

            return {
                "downloaded": [entry] if success and ("cached" not in message and "existing" not in message) else [],
                "cached": [entry] if success and ("cached" in message or "existing" in message) else [],
                "failed": [entry] if not success else [],
                "success": success,
                "total_catalog": len(fetcher.catalog),
            }

        sys.stderr.write(
            f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [AdminUI] Batch disclosure fetch initiated: providers={providers}, force={force}\n"
        )
        sys.stderr.flush()
        results = fetcher.fetch_all(providers=providers, force=force)
        if results.get("failed"):
            for f in results["failed"]:
                sys.stderr.write(
                    f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [AdminUI ERROR] Batch fetch item failed: {f.get('code')} ({f.get('fund_id')}): {f.get('message')}\n"
                )
            sys.stderr.flush()
        return results

    def run_pipeline(self, dry_run: bool = True) -> dict[str, Any]:
        """Executes PipelineCompiler in dry-run or production build mode."""
        compiler = PipelineCompiler(
            staging_dir=self.staging_dir,
            output_dir=self.output_dir,
            repo_root=self.repo_root,
        )
        report, summary = compiler.compile(dry_run=dry_run)
        unconf = summary.get("unconfigured_feeders", [])
        self._last_unconfigured_feeders = {
            str(f.get("fund_code", "")).strip().upper()
            for f in unconf
            if isinstance(f, dict) and f.get("fund_code")
        }
        sm_data = summary.pop("_security_master_data", None)
        unresolved = summary.get("unresolved_entries", [])
        if unresolved:
            matcher = self._build_security_matcher(sm_data=sm_data)
            if matcher:
                for entry in unresolved:
                    entry["candidates"] = matcher.suggest_candidates(entry.get("raw_name", ""), limit=3)

        return {
            "dry_run": dry_run,
            "is_valid": report.is_valid,
            "files_written": summary.get("files_written", False),
            "errors": report.errors,
            "warnings": report.warnings,
            "fund_summaries": report.fund_summaries,
            "sec_master_summary": summary.get("sec_master_summary", {}),
            "total_funds_compiled": summary.get("total_funds_compiled", 0),
            "total_unresolved_entries": summary.get("total_unresolved_entries", 0),
            "unresolved_entries": unresolved,
            "unconfigured_feeders": summary.get("unconfigured_feeders", []),
            "build_errors": summary.get("build_errors", []),
        }

    def get_alias_map(self) -> dict[str, dict[str, str]]:
        """Loads provider_alias_map.json."""
        if not self.alias_map_path.exists():
            return {}
        return json.loads(self.alias_map_path.read_text(encoding="utf-8"))

    def audit_aliases(self) -> dict[str, dict[str, dict[str, Any]]]:
        """Audits provider_alias_map.json entries against security_master.json and suggests fixes for unlinked IDs."""
        alias_map = self.get_alias_map()
        matcher = self._build_security_matcher()
        audit: dict[str, dict[str, dict[str, Any]]] = {}
        for scope, mp in alias_map.items():
            scope_audit: dict[str, dict[str, Any]] = {}
            for raw_name, isin in mp.items():
                if matcher and isin in matcher.by_isin:
                    sec = matcher.by_isin[isin]
                    scope_audit[raw_name] = {
                        "isin": isin,
                        "in_security_master": True,
                        "sm_name": sec.get("name", ""),
                        "ticker": sec.get("ticker", ""),
                        "country": sec.get("country", "Global"),
                        "sector": matcher.normalize_sector(sec.get("sector")),
                    }
                else:
                    cands = matcher.suggest_candidates(raw_name, limit=2) if matcher else []
                    scope_audit[raw_name] = {
                        "isin": isin,
                        "in_security_master": False,
                        "candidates": cands,
                    }
            audit[scope] = scope_audit
        return audit

    def set_alias_mapping(self, scope_key: str, raw_name: str, isin: str) -> dict[str, dict[str, str]]:
        """Adds or updates a single alias mapping in provider_alias_map.json."""
        scope = scope_key.strip()
        name = raw_name.strip()
        clean_isin = isin.strip().upper()
        if not scope or not name or not clean_isin:
            raise ValueError("scope_key, raw_name, and isin are all required.")

        with self._lock:
            alias_map = self.get_alias_map()
            alias_map.setdefault(scope, {})[name] = clean_isin
            atomic_write_json(self.alias_map_path, alias_map)
            return alias_map

    def bulk_set_alias_mappings(
        self,
        mappings: list[dict[str, str]] | None = None,
        csv_text: str = "",
    ) -> tuple[dict[str, dict[str, str]], int]:
        """Adds or updates multiple alias mappings from structured dicts or scope,companyName,isin CSV."""
        parsed_rows: list[tuple[str, str, str]] = []
        if mappings:
            for item in mappings:
                parsed_rows.append((
                    str(item.get("scope_key", "")).strip(),
                    str(item.get("raw_name", "")).strip(),
                    str(item.get("isin", "")).strip().upper(),
                ))
        if csv_text and csv_text.strip():
            reader = csv.reader(io.StringIO(csv_text.strip()))
            for row in reader:
                if len(row) < 3:
                    continue
                scope, name, isin = row[0].strip(), row[1].strip(), row[2].strip().upper()
                if scope.lower() in {"scope", "scope_key"} and name.lower() in {"companyname", "company_name", "raw_name"}:
                    continue
                parsed_rows.append((scope, name, isin))

        with self._lock:
            alias_map = self.get_alias_map()
            saved_count = 0
            for scope, name, clean_isin in parsed_rows:
                if not scope or not name or not clean_isin or clean_isin == "INSERT_CANONICAL_ISIN":
                    continue
                alias_map.setdefault(scope, {})[name] = clean_isin
                saved_count += 1

            if saved_count == 0:
                raise ValueError("No valid (scope, companyName, isin) rows found to import.")

            atomic_write_json(self.alias_map_path, alias_map)
            return alias_map, saved_count

    def delete_alias_mapping(self, scope_key: str, raw_name: str) -> dict[str, dict[str, str]]:
        """Removes an alias mapping from provider_alias_map.json."""
        with self._lock:
            alias_map = self.get_alias_map()
            if scope_key in alias_map and raw_name in alias_map[scope_key]:
                del alias_map[scope_key][raw_name]
                if not alias_map[scope_key]:
                    del alias_map[scope_key]
                atomic_write_json(self.alias_map_path, alias_map)
            return alias_map

    def search_security_master(self, query: str, limit: int = 15) -> list[dict[str, Any]]:
        """Searches security_master.json using multi-token matching and fuzzy close-match ranking."""
        if not self.security_master_path.exists():
            return []
        data = json.loads(self.security_master_path.read_text(encoding="utf-8"))
        q = query.strip().lower()
        if not q:
            return data[:limit]

        q_tokens = q.split()
        meaningful_query = normalize_company_name(query)
        meaningful_tokens = [t.lower() for t in meaningful_query.split() if len(t) >= 2 and t.lower() not in {"nyse", "nasdaq", "asx", "nzx", "common", "stock", "class"}]

        exact_or_token_matches: list[tuple[float, dict[str, Any]]] = []
        seen_isins: set[str] = set()
        for item in data:
            hay = f"{item.get('name', '')} {item.get('ticker', '')} {item.get('isin', '')}".lower()
            is_direct = q in hay
            is_multi_token = (
                len(q_tokens) > 1
                and bool(meaningful_tokens)
                and all(re.search(rf"\b{re.escape(tok)}\b", hay) for tok in q_tokens)
            )
            if is_direct or is_multi_token:
                score = 1.1 if (q == item.get("ticker", "").lower() or q == item.get("isin", "").lower()) else token_sort_similarity(query, item.get("name", ""))
                exact_or_token_matches.append((score, item))
                seen_isins.add(item.get("isin", ""))

        exact_or_token_matches.sort(key=lambda pair: pair[0], reverse=True)
        results = [item for _, item in exact_or_token_matches[:limit]]

        if len(results) < limit and meaningful_tokens:
            matcher = self._build_security_matcher()
            if matcher:
                for cand in matcher.suggest_candidates(" ".join(meaningful_tokens), limit=limit):
                    if cand["isin"] not in seen_isins and cand["score"] >= 0.62:
                        seen_isins.add(cand["isin"])
                        results.append(cand)
                        if len(results) >= limit:
                            break
        return results

    def get_manual_securities(self) -> dict[str, dict[str, str]]:
        """Loads manual_securities.json."""
        if not self.manual_securities_path.exists():
            return {}
        return json.loads(self.manual_securities_path.read_text(encoding="utf-8"))

    def set_manual_security(
        self,
        name: str,
        country: str,
        sector: str,
        isin: str = "",
        ticker: str = "",
        scope_key: str = "",
        raw_name: str = "",
    ) -> tuple[str, dict[str, dict[str, str]]]:
        """Saves manual Country/Sector metadata for an unmappable company and optionally links its alias."""
        clean_name = name.strip()
        clean_country = country.strip()
        clean_sector = sector.strip()
        clean_ticker = ticker.strip().upper()
        if not clean_name or not clean_country or not clean_sector:
            raise ValueError("name, country, and sector are all required.")

        clean_isin = isin.strip().upper()
        if not clean_isin:
            slug_base = clean_ticker or re.sub(r"[^A-Z0-9]+", "_", clean_name.upper()).strip("_")[:32] or "COMPANY"
            clean_isin = f"MANUAL:{slug_base}"

        with self._lock:
            manual = self.get_manual_securities()
            manual[clean_isin] = {
                "name": clean_name,
                "ticker": clean_ticker,
                "country": clean_country,
                "sector": clean_sector,
            }
            atomic_write_json(self.manual_securities_path, manual)

            if scope_key.strip() and raw_name.strip():
                alias_map = self.get_alias_map()
                alias_map.setdefault(scope_key.strip(), {})[raw_name.strip()] = clean_isin
                atomic_write_json(self.alias_map_path, alias_map)

            return clean_isin, manual

    def get_feeder_registry(self) -> dict[str, dict[str, str]]:
        """Loads pipeline/feeder_registry.json."""
        if not self.feeder_registry_path.exists():
            return {}
        return json.loads(self.feeder_registry_path.read_text(encoding="utf-8"))

    def set_feeder_pairing(
        self,
        feeder_code: str,
        name: str,
        master_provider: str,
        master_ticker: str,
    ) -> dict[str, dict[str, str]]:
        """Adds or updates a feeder pairing in feeder_registry.json."""
        code = feeder_code.strip().upper()
        clean_name = name.strip()
        provider = master_provider.strip().lower()
        ticker = master_ticker.strip().upper()
        if not code or not clean_name or not ticker:
            raise ValueError("feeder_code, name, and master_ticker are all required.")
        if provider not in ALLOWED_MASTER_PROVIDERS:
            raise ValueError(f"Unsupported master_provider '{master_provider}'. Must be one of: {sorted(ALLOWED_MASTER_PROVIDERS)}")

        with self._lock:
            registry = self.get_feeder_registry()
            registry[code] = {
                "name": clean_name,
                "master_provider": provider,
                "master_ticker": ticker,
            }
            atomic_write_json(self.feeder_registry_path, registry)
            return registry

    def delete_feeder_pairing(self, feeder_code: str) -> dict[str, dict[str, str]]:
        """Removes a feeder pairing from feeder_registry.json."""
        code = feeder_code.strip().upper()
        with self._lock:
            registry = self.get_feeder_registry()
            if code in registry:
                del registry[code]
                atomic_write_json(self.feeder_registry_path, registry)
            return registry

    # Canonical aliases matching the architecture glossary
    search_company_register = search_security_master
    get_custom_companies = get_manual_securities
    set_custom_company = set_manual_security
    add_custom_company = set_manual_security


def make_handler(service: AdminService) -> type[BaseHTTPRequestHandler]:
    """Creates a request handler class bound to the provided AdminService."""
    html_path = Path(__file__).with_name("admin_ui.html")

    class AdminHTTPHandler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            sys.stderr.write(
                f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [AdminUI] {self.address_string()} - "
                + (format % args)
                + "\n"
            )
            sys.stderr.flush()

        def _send_json(self, payload: Any, status: int = HTTPStatus.OK) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _read_json_body(self) -> dict[str, Any]:
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise ValueError("Invalid Content-Length header.")
            if length < 0 or length > 50 * 1024 * 1024:
                raise ValueError("Request body too large.")
            raw = self.rfile.read(length) if length > 0 else b"{}"
            return json.loads(raw.decode("utf-8"))

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path
            qs = parse_qs(parsed.query)

            try:
                if path == "/" or path == "/index.html":
                    content = html_path.read_bytes()
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(content)))
                    self.end_headers()
                    self.wfile.write(content)
                elif path == "/api/config":
                    self._send_json({"providers": get_provider_config()})
                elif path == "/api/staging":
                    self._send_json({"files": service.list_staged_files()})
                elif path == "/api/staging/preview":
                    provider = qs.get("provider", [""])[0]
                    filename = qs.get("filename", [""])[0]
                    self._send_json(service.preview_staged_file(provider, filename))
                elif path == "/api/aliases":
                    self._send_json({"aliases": service.get_alias_map(), "audit": service.audit_aliases()})
                elif path in {"/api/manual-securities", "/api/custom-companies"}:
                    self._send_json({"manual_securities": service.get_manual_securities()})
                elif path == "/api/feeders":
                    self._send_json({"feeders": service.get_feeder_registry()})
                elif path in {"/api/security-master", "/api/company-register"}:
                    q = qs.get("q", [""])[0]
                    self._send_json({"results": service.search_security_master(q)})
                elif path == "/api/catalog":
                    self._send_json({"catalog": service.get_fund_catalog()})
                elif path == "/api/portfolio/backups":
                    backups_dir = service.repo_root / "backups"
                    backups_dir.mkdir(parents=True, exist_ok=True)
                    items = []
                    for f in backups_dir.glob("*.json"):
                        if f.is_file():
                            stat = f.stat()
                            dt = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
                            items.append({
                                "filename": f.name,
                                "isCurrent": f.name == "portfolio_backup.json",
                                "modifiedAt": dt.isoformat(),
                                "size": stat.st_size,
                            })
                    legacy = service.repo_root / "portfolio_backup.json"
                    if legacy.exists() and not any(i["filename"] == "portfolio_backup.json" for i in items):
                        stat = legacy.stat()
                        dt = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
                        items.append({
                            "filename": "portfolio_backup.json",
                            "isCurrent": True,
                            "modifiedAt": dt.isoformat(),
                            "size": stat.st_size,
                        })
                    items.sort(key=lambda x: (not x["isCurrent"], x["modifiedAt"]), reverse=True)
                    self._send_json({"ok": True, "backups": items})
                elif path == "/api/portfolio/load":
                    target_file = qs.get("file", [""])[0]
                    backups_dir = service.repo_root / "backups"
                    backups_dir.mkdir(parents=True, exist_ok=True)
                    main_backup = backups_dir / "portfolio_backup.json"
                    legacy_backup = service.repo_root / "portfolio_backup.json"

                    chosen = None
                    if target_file:
                        safe_name = Path(target_file).name
                        cand = backups_dir / safe_name
                        if cand.exists():
                            chosen = cand
                    elif main_backup.exists():
                        chosen = main_backup
                    elif legacy_backup.exists():
                        chosen = legacy_backup

                    if chosen and chosen.exists():
                        try:
                            parsed = json.loads(chosen.read_text(encoding="utf-8"))
                            self._send_json({"exists": True, "state": parsed, "file": f"backups/{chosen.name}" if chosen.parent.name == "backups" else chosen.name})
                        except Exception as exc:
                            self._send_json({"exists": False, "error": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
                    else:
                        self._send_json({"exists": False})
                else:
                    self._send_json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)
            except FileNotFoundError as exc:
                sys.stderr.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [AdminUI 404] {self.path}: {exc}\n")
                sys.stderr.flush()
                self._send_json({"error": str(exc)}, status=HTTPStatus.NOT_FOUND)
            except Exception as exc:
                sys.stderr.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [AdminUI ERROR] GET {self.path}: {exc}\n")
                traceback.print_exc(file=sys.stderr)
                sys.stderr.flush()
                self._send_json({"error": str(exc), "traceback": traceback.format_exc()}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

        def do_POST(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path

            try:
                data = self._read_json_body()
                if path == "/api/staging/upload":
                    res = service.save_staged_file(
                        provider=data.get("provider", ""),
                        filename=data.get("filename", ""),
                        content=data.get("content", ""),
                        content_base64=data.get("content_base64", ""),
                    )
                    self._send_json(res)
                elif path == "/api/staging/delete":
                    deleted = service.delete_staged_file(
                        provider=data.get("provider", ""),
                        filename=data.get("filename", ""),
                    )
                    self._send_json({"deleted": deleted})
                elif path == "/api/pipeline/run":
                    dry_run = bool(data.get("dry_run", True))
                    self._send_json(service.run_pipeline(dry_run=dry_run))
                elif path == "/api/pipeline/fetch":
                    providers = data.get("providers")
                    force = bool(data.get("force", False))
                    fund_code = data.get("fund_code")
                    self._send_json(service.fetch_disclosures(providers=providers, force=force, fund_code=fund_code))
                elif path == "/api/catalog/save":
                    catalog = service.save_fund_catalog_entry(data)
                    self._send_json({"ok": True, "catalog": catalog})
                elif path == "/api/catalog/delete":
                    catalog = service.delete_fund_catalog_entry(data.get("fund_code", ""))
                    self._send_json({"ok": True, "catalog": catalog})
                elif path == "/api/aliases/set":
                    aliases = service.set_alias_mapping(
                        scope_key=data.get("scope_key", ""),
                        raw_name=data.get("raw_name", ""),
                        isin=data.get("isin", ""),
                    )
                    self._send_json({"aliases": aliases, "audit": service.audit_aliases()})
                elif path == "/api/aliases/bulk-set":
                    aliases, saved_count = service.bulk_set_alias_mappings(
                        mappings=data.get("mappings"),
                        csv_text=data.get("csv_text", ""),
                    )
                    self._send_json({"aliases": aliases, "audit": service.audit_aliases(), "saved_count": saved_count})
                elif path == "/api/aliases/delete":
                    aliases = service.delete_alias_mapping(
                        scope_key=data.get("scope_key", ""),
                        raw_name=data.get("raw_name", ""),
                    )
                    self._send_json({"aliases": aliases, "audit": service.audit_aliases()})
                elif path == "/api/manual-securities/set":
                    saved_isin, manual = service.set_manual_security(
                        name=data.get("name", ""),
                        country=data.get("country", ""),
                        sector=data.get("sector", ""),
                        isin=data.get("isin", ""),
                        ticker=data.get("ticker", ""),
                        scope_key=data.get("scope_key", ""),
                        raw_name=data.get("raw_name", ""),
                    )
                    self._send_json({
                        "isin": saved_isin,
                        "manual_securities": manual,
                        "aliases": service.get_alias_map(),
                        "audit": service.audit_aliases(),
                    })
                elif path == "/api/feeders/set":
                    feeders = service.set_feeder_pairing(
                        feeder_code=data.get("feeder_code", ""),
                        name=data.get("name", ""),
                        master_provider=data.get("master_provider", ""),
                        master_ticker=data.get("master_ticker", ""),
                    )
                    self._send_json({"feeders": feeders})
                elif path == "/api/feeders/delete":
                    feeders = service.delete_feeder_pairing(
                        feeder_code=data.get("feeder_code", ""),
                    )
                    self._send_json({"feeders": feeders})
                elif path == "/api/portfolio/save":
                    backups_dir = service.repo_root / "backups"
                    backups_dir.mkdir(parents=True, exist_ok=True)
                    main_backup = backups_dir / "portfolio_backup.json"
                    main_backup.write_text(json.dumps(data, indent=2), encoding="utf-8")
                    self._send_json({"ok": True, "file": "backups/portfolio_backup.json"})
                elif path == "/api/portfolio/export":
                    backups_dir = service.repo_root / "backups"
                    backups_dir.mkdir(parents=True, exist_ok=True)
                    now = datetime.now()
                    stamp = now.strftime("%Y-%m-%d_%H%M%S")
                    export_name = f"kiwi_portfolio_{stamp}.json"
                    export_path = backups_dir / export_name
                    export_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
                    self._send_json({"ok": True, "file": export_name, "path": f"backups/{export_name}"})
                elif path == "/api/portfolio/backup":
                    backups_dir = service.repo_root / "backups"
                    backups_dir.mkdir(parents=True, exist_ok=True)
                    main_backup = backups_dir / "portfolio_backup.json"
                    legacy_backup = service.repo_root / "portfolio_backup.json"
                    src = main_backup if main_backup.exists() else legacy_backup if legacy_backup.exists() else None
                    if src and src.exists():
                        now = datetime.now()
                        stamp = now.strftime("%Y-%m-%d_%H%M%S")
                        dated_name = f"portfolio_backup_{stamp}.json"
                        dated_path = backups_dir / dated_name
                        shutil.copyfile(src, dated_path)

                        # Prune older than 10
                        try:
                            dated_files = sorted([f for f in backups_dir.glob("portfolio_backup_*.json") if f.is_file()])
                            if len(dated_files) > 10:
                                for old_f in dated_files[:-10]:
                                    old_f.unlink(missing_ok=True)
                        except Exception:
                            pass

                        self._send_json({"ok": True, "backupFile": dated_name, "path": f"backups/{dated_name}"})
                    else:
                        self._send_json({"ok": True, "backupFile": None})
                else:
                    self._send_json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)
            except Exception as exc:
                sys.stderr.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [AdminUI ERROR] POST {self.path}: {exc}\n")
                traceback.print_exc(file=sys.stderr)
                sys.stderr.flush()
                self._send_json({"error": str(exc), "traceback": traceback.format_exc()}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    return AdminHTTPHandler


def main() -> int:
    parser = argparse.ArgumentParser(description="Start the local-only Kiwi Portfolio X-Ray Admin Web UI.")
    parser.add_argument("--port", type=int, default=8787, help="Local HTTP port (default: 8787)")
    parser.add_argument("--staging-dir", type=Path, default=Path("data/staging"), help="Staging CSV directory")
    parser.add_argument("--output-dir", type=Path, default=Path("public/data"), help="Output JSON directory")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    staging_dir = args.staging_dir if args.staging_dir.is_absolute() else (repo_root / args.staging_dir)
    output_dir = args.output_dir if args.output_dir.is_absolute() else (repo_root / args.output_dir)

    service = AdminService(repo_root=repo_root, staging_dir=staging_dir, output_dir=output_dir)
    server = ThreadingHTTPServer(("0.0.0.0", args.port), make_handler(service))

    print("=================================================================")
    print("🥝 Kiwi Portfolio X-Ray — Local Admin UI")
    print("=================================================================")
    print(f"Open in browser: http://127.0.0.1:{args.port}")
    print(f"Staging dir:     {staging_dir}")
    print(f"Output dir:      {output_dir}")
    print("Press Ctrl+C to stop.")
    print("=================================================================")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping local Admin UI.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

