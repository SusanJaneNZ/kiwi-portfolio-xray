"""Pipeline compilation engine: orchestrates Tier 1 extraction, Tier 2 enrichment, feeder unwrapping, and asset generation."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional

from pipeline.adapters import PROVIDER_ADAPTERS, iter_staged_files
from pipeline.adapters.base import BaseAdapter, FundExtractionResult
from pipeline.adapters.sorted_parser import parse_nz_fund_file
from pipeline.enrichment.bond_normalizer import AssetClassifier
from pipeline.enrichment.fuzzy_matcher import SecurityMatcher
from pipeline.security_master.build_security_master import (
    atomic_write_json,
    compile_security_master,
    normalize_country,
)
from pipeline.unwrapper.feeder_unwrapper import FeederUnwrapper, FeederWrapperDisclosure, UnwrappedFund
from pipeline.validate.schema_validator import SchemaValidator, ValidationReport


class GenericDomesticAdapter(BaseAdapter):
    """Fallback adapter for arbitrary NZ KiwiSaver and managed funds in Sorted xlsx/csv format."""

    def __init__(self, provider_name: str = "KiwiSaver", catalog: list[dict] | None = None):
        self.provider_name = provider_name
        self.catalog = catalog or []

    def can_handle(self, file_path: Path) -> bool:
        return file_path.suffix.lower() in {".csv", ".xlsx"}

    def parse(self, file_path: Path) -> FundExtractionResult:
        stem = file_path.stem
        fund_code = stem.split("_FND")[0] if "_FND" in stem else stem
        fund_name = fund_code.replace("_", " ").title()
        for cat in self.catalog:
            if cat.get("fund_code", "").upper() == fund_code.upper() or cat.get("fnd_code", "").upper() in stem.upper():
                fund_code = cat.get("fund_code", fund_code)
                fund_name = cat.get("fund_name", fund_name)
                break
        return parse_nz_fund_file(file_path, fund_code, fund_name, self.provider_name.replace("_", " ").title())


class PipelineCompiler:
    """Orchestrates the entire data transformation pipeline."""

    def __init__(self, staging_dir: Path, output_dir: Path, repo_root: Path):
        self.staging_dir = staging_dir
        self.output_dir = output_dir
        self.repo_root = repo_root

        self.security_master_path = repo_root / "pipeline" / "security_master" / "security_master.json"
        alias_candidate = repo_root / "pipeline" / "enrichment" / "company_alias_map.json"
        legacy_candidate = repo_root / "pipeline" / "enrichment" / "provider_alias_map.json"
        self.alias_map_path = alias_candidate if alias_candidate.exists() else (legacy_candidate if legacy_candidate.exists() else alias_candidate)
        self.manual_securities_path = repo_root / "pipeline" / "enrichment" / "manual_securities.json"
        self.issuer_alias_path = repo_root / "pipeline" / "enrichment" / "issuer_alias_map.json"
        self.gics_mapping_path = repo_root / "pipeline" / "normalizer" / "gics_mapping.json"
        self.feeder_registry_path = repo_root / "pipeline" / "feeder_registry.json"
        self.fund_catalog_path = repo_root / "pipeline" / "fund_catalog.json"
        self.logs_dir = repo_root / "pipeline" / "logs"

    def compile(self, dry_run: bool = False, force: bool = False) -> tuple[ValidationReport, dict[str, Any]]:
        # 1. Compile Security Master in-memory first (defer disk writes until validation passes)
        direct_equities_output_path = self.output_dir / "direct_equities.json"
        sec_master_summary = compile_security_master(
            staging_dir=self.staging_dir,
            output_master_path=self.security_master_path,
            output_direct_path=direct_equities_output_path,
            gics_mapping_path=self.gics_mapping_path,
            write_files=False,
            manual_securities_path=self.manual_securities_path,
        )

        security_master_data = sec_master_summary.pop("_security_master_data", [])
        direct_equities_data = sec_master_summary.pop("_direct_equities_data", [])

        alias_map = {}
        if self.alias_map_path.exists():
            with open(self.alias_map_path, "r", encoding="utf-8") as f:
                alias_map = json.load(f)

        gics_mapping = {}
        if self.gics_mapping_path.exists():
            with open(self.gics_mapping_path, "r", encoding="utf-8") as f:
                gics_mapping = json.load(f)

        matcher = SecurityMatcher(
            security_master=security_master_data,
            alias_map=alias_map,
            gics_mapping=gics_mapping,
        )
        classifier = AssetClassifier(self.issuer_alias_path)
        for item in direct_equities_data:
            self._stamp_issuer(item, classifier)

        # 2. Parse Master ETFs (Vanguard, iShares, SPDR)
        master_funds: dict[str, Any] = {}
        build_errors: list[dict[str, Any]] = []
        extra_warnings: list[str] = []

        for provider in ("vanguard", "ishares", "spdr"):
            adapter = PROVIDER_ADAPTERS[provider]()
            for f in iter_staged_files(self.staging_dir, provider, extensions=(".csv", ".xlsx")):
                if adapter.can_handle(f):
                    try:
                        res = adapter.parse(f)
                        master_funds[res.fund_code] = res
                    except Exception as exc:
                        build_errors.append({
                            "file": str(f),
                            "filename": f.name,
                            "provider": provider,
                            "error": str(exc),
                        })
                        extra_warnings.append(
                            f"[CIRCUIT BREAKER] Corrupt/unparseable file skipped in '{provider}': {f.name} ({exc})"
                        )

        feeder_disc_map: dict[str, FeederWrapperDisclosure] = {}

        with open(self.feeder_registry_path, "r", encoding="utf-8") as f:
            feeder_registry = json.load(f)

        # 3. Ingest domestic & scheme disclosures (Smartshares, Kernel, BetaShares, Fisher Funds, KiwiSaver, etc.)
        catalog_entries: list[dict] = []
        if self.fund_catalog_path.exists():
            try:
                catalog_entries = json.loads(self.fund_catalog_path.read_text(encoding="utf-8"))
            except Exception:
                pass

        known_direct_providers = {"vanguard", "ishares", "spdr", "directories"}
        fund_providers: list[str] = ["smartshares"]
        if self.staging_dir.exists():
            for p in sorted(self.staging_dir.iterdir()):
                if p.is_dir() and p.name.lower() not in known_direct_providers and p.name.lower() != "smartshares":
                    fund_providers.append(p.name.lower())

        all_unwrapped_funds: list[UnwrappedFund] = []
        all_unresolved_entries: list[dict] = []
        unconfigured_feeders: list[dict] = []

        for provider in fund_providers:
            adapter = (
                PROVIDER_ADAPTERS[provider]()
                if provider in PROVIDER_ADAPTERS
                else GenericDomesticAdapter(provider, catalog_entries)
            )
            for f in iter_staged_files(self.staging_dir, provider):
                if adapter.can_handle(f):
                    try:
                        res = adapter.parse(f)
                        if res.fund_code in feeder_registry:
                            feeder_disc_map[res.fund_code] = FeederWrapperDisclosure(
                                feeder_code=res.fund_code,
                                feeder_name=res.fund_name,
                                master_ticker=feeder_registry[res.fund_code].get("master_ticker", ""),
                                master_allocation=sum(h.weight for h in res.holdings),
                                cash_ratio=res.cash_ratio,
                                hedging_ratio=res.hedging_ratio,
                                effective_date=res.effective_date,
                            )
                        else:
                            detected_feeder = self._detect_unconfigured_feeder(res, classifier)
                            if detected_feeder:
                                unconfigured_feeders.append(detected_feeder)
                                extra_warnings.append(
                                    f"Feeder fund '{res.fund_code}' holds '{detected_feeder['master_holding_name']}' "
                                    f"({detected_feeder['master_weight'] * 100:.1f}%) — add a Feeder Pairing in the Feeder Pairings panel and stage its master ETF CSV to unwrap."
                                )
                            else:
                                unwrapped = self._enrich_domestic_fund(res, matcher, classifier, all_unresolved_entries)
                                all_unwrapped_funds.append(unwrapped)
                    except Exception as exc:
                        build_errors.append({
                            "file": str(f),
                            "filename": f.name,
                            "provider": provider,
                            "error": str(exc),
                        })
                        extra_warnings.append(
                            f"[CIRCUIT BREAKER] Corrupt/unparseable file skipped in '{provider}': {f.name} ({exc})"
                        )

        # 4. Unwrap Feeders using FeederUnwrapper
        unwrapper = FeederUnwrapper(self.feeder_registry_path, gics_mapping=gics_mapping, matcher=matcher)

        for feeder_code, info in feeder_registry.items():
            master_ticker = info.get("master_ticker")
            master_fund = master_funds.get(master_ticker)
            disc = feeder_disc_map.get(feeder_code)
            if not master_fund:
                if disc:
                    provider_folder = info.get("master_provider", "ishares")
                    extra_warnings.append(
                        f"Feeder '{feeder_code}' disclosure staged (as of {disc.effective_date}), "
                        f"awaiting master ETF '{master_ticker}' in data/staging/{provider_folder}/."
                    )
                continue
            try:
                unwrapped = unwrapper.unwrap(feeder_code, master_fund, disc)
                for c in unwrapped.constituents:
                    self._stamp_issuer(c, classifier)
                all_unwrapped_funds.append(unwrapped)
            except Exception as exc:
                build_errors.append({
                    "feeder_code": feeder_code,
                    "master_ticker": master_ticker,
                    "provider": "feeder_unwrapper",
                    "error": str(exc),
                })
                extra_warnings.append(
                    f"[CIRCUIT BREAKER] Failed to unwrap feeder '{feeder_code}' -> '{master_ticker}': {exc}"
                )

        # 7. Construct Funds Registry & Constituents Map (reject duplicate fund codes)
        funds_registry: list[dict] = []
        constituents_map: dict[str, list[dict]] = {}
        duplicate_errors: list[str] = []

        for uf in all_unwrapped_funds:
            if uf.fund_code in constituents_map:
                duplicate_errors.append(
                    f"Duplicate staged files resolved to fund code '{uf.fund_code}'. Remove older/duplicate disclosure files before building."
                )
                continue
            funds_registry.append({
                "code": uf.fund_code,
                "name": uf.fund_name,
                "provider": uf.provider,
                "effective_date": uf.effective_date,
                "cash_ratio": uf.cash_ratio,
                "hedging_ratio": uf.hedging_ratio,
                "constituent_count": len(uf.constituents),
                "asset_class": classifier.derive_fund_asset_class(uf.constituents),
                "cadence": "monthly",
                "is_stale": False,
            })
            constituents_map[uf.fund_code] = uf.constituents

        all_unresolved_entries.sort(key=lambda item: item.get("weight", 0.0), reverse=True)

        # 8. Validate with SchemaValidator BEFORE writing any production outputs
        validator = SchemaValidator()
        validation_report = validator.validate_all(
            funds_registry=funds_registry,
            constituents=constituents_map,
            direct_equities=direct_equities_data,
            unresolved_entries=all_unresolved_entries,
        )
        if duplicate_errors:
            validation_report.errors.extend(duplicate_errors)
            validation_report.is_valid = False
        if build_errors:
            validation_report.errors.append(
                f"Circuit breaker caught {len(build_errors)} corrupt/unparseable files. Production write aborted (use --force to bypass)."
            )
            validation_report.is_valid = False
        validation_report.warnings = extra_warnings + validation_report.warnings

        # 9. Only write production files when validation passes (unless force=True)
        files_written = False
        if not dry_run and (validation_report.is_valid or force):
            atomic_write_json(self.security_master_path, security_master_data)
            atomic_write_json(direct_equities_output_path, direct_equities_data)
            atomic_write_json(self.output_dir / "funds_registry.json", funds_registry)
            atomic_write_json(self.output_dir / "constituents.json", constituents_map)
            atomic_write_json(self.output_dir / "unresolved_entries.json", all_unresolved_entries)
            files_written = True

        if not dry_run:
            errors_file = self.logs_dir / "build_errors.json"
            if build_errors:
                self.logs_dir.mkdir(parents=True, exist_ok=True)
                atomic_write_json(errors_file, build_errors)
            elif errors_file.exists():
                errors_file.unlink(missing_ok=True)

        summary_data = {
            "sec_master_summary": sec_master_summary,
            "total_funds_compiled": len(funds_registry),
            "total_unresolved_entries": len(all_unresolved_entries),
            "unresolved_entries": all_unresolved_entries,
            "unconfigured_feeders": unconfigured_feeders,
            "build_errors": build_errors,
            "files_written": files_written,
            "_security_master_data": security_master_data,
            "validation_report": validation_report,
        }

        return validation_report, summary_data

    def _detect_unconfigured_feeder(self, fund_res: Any, classifier: AssetClassifier) -> Optional[dict[str, Any]]:
        """Detects a feeder ETF holding >=75% of its non-cash assets in a single underlying equity ETF."""
        if not fund_res.holdings:
            return None
        total_w = sum(h.weight for h in fund_res.holdings)
        if total_w <= 0:
            return None
        top = max(fund_res.holdings, key=lambda h: h.weight)
        if (top.weight / total_w) < 0.75:
            return None
        hint = getattr(top, "raw_metadata", {}).get("asset_class", "")
        if classifier.classify_holding(top.name, fund_code=fund_res.fund_code, asset_class_hint=hint) != "equity":
            return None
        if not re.search(r"\b(?:etf|ucits|index\s+fund|vanguard|ishares|spdr)\b", top.name, re.IGNORECASE):
            return None
        # Physical commodity trusts (e.g. gold, silver, bitcoin) hold physical assets, not corporate equities
        if re.search(r"\b(?:gold|silver|commodity|physical|bullion)\b", top.name, re.IGNORECASE):
            return None

        lower = top.name.lower()
        if "spdr" in lower or "state street" in lower:
            suggested_provider = "spdr"
        elif "ishares" in lower or "blackrock" in lower:
            suggested_provider = "ishares"
        elif "vanguard" in lower:
            suggested_provider = "vanguard"
        else:
            suggested_provider = "vanguard"
        return {
            "fund_code": fund_res.fund_code,
            "fund_name": fund_res.fund_name,
            "provider": fund_res.provider,
            "effective_date": fund_res.effective_date,
            "master_holding_name": top.name,
            "master_weight": round(top.weight, 4),
            "suggested_provider": suggested_provider,
        }

    def _stamp_issuer(self, record: dict[str, Any], classifier: AssetClassifier) -> None:
        """Stamps canonical issuer_key and issuer_name onto an equity record when mapped."""
        issuer_key, issuer_name, _ = classifier.resolve_issuer(record.get("name", ""))
        if issuer_key:
            record["issuer_key"] = issuer_key
            if issuer_name:
                record["issuer_name"] = issuer_name

    @staticmethod
    def _accumulate_non_equity(
        bucket: dict[str, dict],
        normalized: dict[str, Any],
        asset_class: str,
        weight: float,
        track_tranches: bool = False,
    ) -> None:
        isin_key = normalized["isin"]
        if isin_key not in bucket:
            entry: dict[str, Any] = {
                "isin": isin_key,
                "name": normalized["name"],
                "ticker": "",
                "country": normalized["country"],
                "sector": normalized["sector"],
                "weight": 0.0,
                "asset_class": asset_class,
            }
            if track_tranches:
                entry["tranche_count"] = 0
            if normalized.get("issuer_key"):
                entry["issuer_key"] = normalized["issuer_key"]
                entry["issuer_name"] = normalized["issuer_name"]
            bucket[isin_key] = entry
        bucket[isin_key]["weight"] += weight
        if track_tranches:
            bucket[isin_key]["tranche_count"] += 1

    def _enrich_domestic_fund(
        self,
        fund_res: Any,
        matcher: SecurityMatcher,
        classifier: AssetClassifier,
        unresolved_collector: list[dict],
    ) -> UnwrappedFund:
        """Classifies and enriches domestic/Kernel holdings across term deposits, bonds, and equities."""
        resolved_equities: list[dict] = []
        consolidated_bonds: dict[str, dict] = {}
        consolidated_tds: dict[str, dict] = {}
        raw_non_cash_sum = sum(h.weight for h in fund_res.holdings)

        # Normalize investable weights after segregating cash & hedging to preserve weight integrity
        hedging_ratio = max(0.0, getattr(fund_res, "hedging_ratio", 0.0))
        scale = max(0.0, 1.0 - fund_res.cash_ratio - hedging_ratio)
        weight_norm_factor = (scale / raw_non_cash_sum) if raw_non_cash_sum > 0 else 1.0

        for idx, h in enumerate(fund_res.holdings):
            normalized_weight = h.weight * weight_norm_factor
            hint = getattr(h, "raw_metadata", {}).get("asset_class", "")
            row_class = classifier.classify_holding(h.name, fund_code=fund_res.fund_code, asset_class_hint=hint)

            if row_class == "term_deposit":
                td = classifier.normalize_term_deposit(h.name, country_hint=h.country or "")
                self._accumulate_non_equity(consolidated_tds, td, "term_deposit", normalized_weight)
                continue

            if row_class == "fixed_interest":
                bond = classifier.normalize_bond_holding(h.name, country_hint=h.country or "")
                self._accumulate_non_equity(consolidated_bonds, bond, "fixed_interest", normalized_weight, track_tranches=True)
                continue

            match = matcher.match(
                name=h.name,
                ticker=h.ticker,
                isin=h.isin,
                provider=fund_res.provider,
                fund_code=fund_res.fund_code,
            )

            if match.matched and match.isin:
                entry = {
                    "isin": match.isin,
                    "name": match.name or h.name,
                    "ticker": match.ticker or h.ticker or "",
                    "country": normalize_country(match.country or h.country or "", default="Global"),
                    "sector": match.sector or "Unclassified",
                    "weight": round(normalized_weight, 8),
                    "asset_class": "equity",
                }
                self._stamp_issuer(entry, classifier)
                resolved_equities.append(entry)
            else:
                # Synthetic placeholder record to preserve weight sum integrity
                synth_isin = f"UNRESOLVED_{h.ticker or idx}"
                resolved_equities.append({
                    "isin": synth_isin,
                    "name": h.name,
                    "ticker": h.ticker or "",
                    "country": normalize_country(h.country or "", default="Unknown"),
                    "sector": "Unclassified",
                    "weight": round(normalized_weight, 8),
                    "asset_class": "equity",
                })
                # Add to unresolved collector
                unresolved_collector.append({
                    "provider": fund_res.provider,
                    "fund_code": fund_res.fund_code,
                    "raw_name": h.name,
                    "raw_ticker": h.ticker or "",
                    "weight": round(normalized_weight, 6),
                    "reason": match.reason,
                    "suggested_snippet": {
                        f"{fund_res.provider}:{fund_res.fund_code}": {
                            h.name: "INSERT_CANONICAL_ISIN"
                        }
                    },
                })

        for group in (consolidated_bonds, consolidated_tds):
            for entry in group.values():
                entry["weight"] = round(entry["weight"], 8)

        resolved_constituents = resolved_equities + list(consolidated_bonds.values()) + list(consolidated_tds.values())

        return UnwrappedFund(
            fund_code=fund_res.fund_code,
            fund_name=fund_res.fund_name,
            provider=fund_res.provider,
            effective_date=fund_res.effective_date,
            cash_ratio=round(fund_res.cash_ratio, 6),
            hedging_ratio=round(hedging_ratio, 6),
            constituents=resolved_constituents,
            unresolved_holdings=[],
        )

