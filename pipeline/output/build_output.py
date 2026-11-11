"""Pipeline compilation engine: orchestrates Tier 1 extraction, Tier 2 enrichment, feeder unwrapping, and asset generation."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional

from pipeline.adapters.ishares_adapter import ISharesAdapter
from pipeline.adapters.kernel_adapter import KernelAdapter
from pipeline.adapters.smartshares_direct_adapter import SmartsharesDirectAdapter
from pipeline.adapters.vanguard_adapter import VanguardAdapter
from pipeline.enrichment.bond_normalizer import AssetClassifier
from pipeline.enrichment.fuzzy_matcher import SecurityMatcher
from pipeline.security_master.build_security_master import (
    _atomic_write_json,
    compile_security_master,
    normalize_country,
)
from pipeline.unwrapper.feeder_unwrapper import FeederUnwrapper, FeederWrapperDisclosure, UnwrappedFund
from pipeline.validate.schema_validator import SchemaValidator, ValidationReport


class PipelineCompiler:
    """Orchestrates the entire data transformation pipeline."""

    def __init__(self, staging_dir: Path, output_dir: Path, repo_root: Path):
        self.staging_dir = staging_dir
        self.output_dir = output_dir
        self.repo_root = repo_root

        self.security_master_path = repo_root / "pipeline" / "security_master" / "security_master.json"
        self.alias_map_path = repo_root / "pipeline" / "enrichment" / "provider_alias_map.json"
        self.issuer_alias_path = repo_root / "pipeline" / "enrichment" / "issuer_alias_map.json"
        self.gics_mapping_path = repo_root / "pipeline" / "normalizer" / "gics_mapping.json"
        self.feeder_registry_path = repo_root / "pipeline" / "feeder_registry.json"

    def compile(self, dry_run: bool = False) -> tuple[ValidationReport, dict[str, Any]]:
        # 1. Compile Security Master
        direct_equities_output_path = self.output_dir / "direct_equities.json"
        sec_master_summary = compile_security_master(
            staging_dir=self.staging_dir,
            output_master_path=self.security_master_path,
            output_direct_path=direct_equities_output_path,
            gics_mapping_path=self.gics_mapping_path,
            write_files=not dry_run,
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

        # 2. Parse Master ETFs (Vanguard & iShares)
        vanguard_adapter = VanguardAdapter()
        ishares_adapter = ISharesAdapter()

        master_funds: dict[str, Any] = {}
        vanguard_dir = self.staging_dir / "vanguard"
        if vanguard_dir.exists():
            for f in sorted(vanguard_dir.glob("*.csv")):
                if vanguard_adapter.can_handle(f):
                    res = vanguard_adapter.parse(f)
                    master_funds[res.fund_code] = res

        ishares_dir = self.staging_dir / "ishares"
        if ishares_dir.exists():
            for f in sorted(ishares_dir.glob("*.csv")):
                if ishares_adapter.can_handle(f):
                    res = ishares_adapter.parse(f)
                    master_funds[res.fund_code] = res

        feeder_disc_map: dict[str, FeederWrapperDisclosure] = {}

        with open(self.feeder_registry_path, "r", encoding="utf-8") as f:
            feeder_registry = json.load(f)

        # 3. Ingest Smartshares staged files (Direct Funds and Sorted Feeder wrappers)
        smartshares_adapter = SmartsharesDirectAdapter()
        smartshares_dir = self.staging_dir / "smartshares"
        all_unwrapped_funds: list[UnwrappedFund] = []
        all_unresolved_entries: list[dict] = []
        unconfigured_feeders: list[dict] = []
        extra_warnings: list[str] = []

        if smartshares_dir.exists():
            for f in sorted(p for p in smartshares_dir.iterdir() if p.is_file() and p.suffix.lower() in {".csv", ".xlsx"}):
                if smartshares_adapter.can_handle(f):
                    res = smartshares_adapter.parse(f)
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
                                f"({detected_feeder['master_weight'] * 100:.1f}%) — add a Feeder Pairing in Panel 6 and stage its master ETF CSV to unwrap."
                            )
                        else:
                            unwrapped = self._enrich_domestic_fund(res, matcher, classifier, all_unresolved_entries)
                            all_unwrapped_funds.append(unwrapped)

        # 5. Unwrap Feeders using FeederUnwrapper
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
            unwrapped = unwrapper.unwrap(feeder_code, master_fund, disc)
            for c in unwrapped.constituents:
                self._stamp_issuer(c, classifier)
            all_unwrapped_funds.append(unwrapped)

        # 6. Ingest Kernel Funds and Enrich
        kernel_adapter = KernelAdapter()
        kernel_dir = self.staging_dir / "kernel"
        if kernel_dir.exists():
            for f in sorted(p for p in kernel_dir.iterdir() if p.is_file() and p.suffix.lower() in {".csv", ".xlsx"}):
                if kernel_adapter.can_handle(f):
                    res = kernel_adapter.parse(f)
                    unwrapped = self._enrich_domestic_fund(res, matcher, classifier, all_unresolved_entries)
                    all_unwrapped_funds.append(unwrapped)

        # 7. Construct Funds Registry & Constituents Map
        funds_registry: list[dict] = []
        constituents_map: dict[str, list[dict]] = {}

        for uf in all_unwrapped_funds:
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

        # 8. Validate with SchemaValidator
        validator = SchemaValidator()
        validation_report = validator.validate_all(
            funds_registry=funds_registry,
            constituents=constituents_map,
            direct_equities=direct_equities_data,
            unresolved_entries=all_unresolved_entries,
        )
        validation_report.warnings = extra_warnings + validation_report.warnings

        # 9. If not dry_run, write production files atomically
        if not dry_run:
            _atomic_write_json(direct_equities_output_path, direct_equities_data)
            _atomic_write_json(self.output_dir / "funds_registry.json", funds_registry)
            _atomic_write_json(self.output_dir / "constituents.json", constituents_map)
            _atomic_write_json(self.output_dir / "unresolved_entries.json", all_unresolved_entries)

        summary_data = {
            "sec_master_summary": sec_master_summary,
            "total_funds_compiled": len(funds_registry),
            "total_unresolved_entries": len(all_unresolved_entries),
            "unresolved_entries": all_unresolved_entries,
            "unconfigured_feeders": unconfigured_feeders,
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

        lower = top.name.lower()
        suggested_provider = "vanguard" if "vanguard" in lower else ("ishares" if "ishares" in lower or "blackrock" in lower else "vanguard")
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
                isin_key = td["isin"]
                if isin_key not in consolidated_tds:
                    entry = {
                        "isin": isin_key,
                        "name": td["name"],
                        "ticker": "",
                        "country": td["country"],
                        "sector": td["sector"],
                        "weight": 0.0,
                        "asset_class": "term_deposit",
                    }
                    if td["issuer_key"]:
                        entry["issuer_key"] = td["issuer_key"]
                        entry["issuer_name"] = td["issuer_name"]
                    consolidated_tds[isin_key] = entry
                consolidated_tds[isin_key]["weight"] += normalized_weight
                continue

            if row_class == "fixed_interest":
                bond = classifier.normalize_bond_holding(h.name, country_hint=h.country or "")
                isin_key = bond["isin"]
                if isin_key not in consolidated_bonds:
                    entry = {
                        "isin": isin_key,
                        "name": bond["name"],
                        "ticker": "",
                        "country": bond["country"],
                        "sector": bond["sector"],
                        "weight": 0.0,
                        "asset_class": "fixed_interest",
                        "tranche_count": 0,
                    }
                    if bond["issuer_key"]:
                        entry["issuer_key"] = bond["issuer_key"]
                        entry["issuer_name"] = bond["issuer_name"]
                    consolidated_bonds[isin_key] = entry
                consolidated_bonds[isin_key]["weight"] += normalized_weight
                consolidated_bonds[isin_key]["tranche_count"] += 1
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

