"""Pipeline compilation engine: orchestrates Tier 1 extraction, Tier 2 enrichment, feeder unwrapping, and asset generation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from pipeline.adapters.disclose_register_adapter import DiscloseRegisterAdapter
from pipeline.adapters.ishares_adapter import ISharesAdapter
from pipeline.adapters.kernel_adapter import KernelAdapter
from pipeline.adapters.smartshares_direct_adapter import SmartsharesDirectAdapter
from pipeline.adapters.vanguard_adapter import VanguardAdapter
from pipeline.enrichment.fuzzy_matcher import SecurityMatcher
from pipeline.security_master.build_security_master import compile_security_master
from pipeline.unwrapper.feeder_unwrapper import FeederUnwrapper, UnwrappedFund
from pipeline.validate.schema_validator import SchemaValidator, ValidationReport


class PipelineCompiler:
    """Orchestrates the entire data transformation pipeline."""

    def __init__(self, staging_dir: Path, output_dir: Path, repo_root: Path):
        self.staging_dir = staging_dir
        self.output_dir = output_dir
        self.repo_root = repo_root

        self.security_master_path = repo_root / "pipeline" / "security_master" / "security_master.json"
        self.alias_map_path = repo_root / "pipeline" / "enrichment" / "provider_alias_map.json"
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
        )

        with open(self.security_master_path, "r", encoding="utf-8") as f:
            security_master_data = json.load(f)

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

        # 3. Parse Disclose Register Feeder Filings
        disclose_adapter = DiscloseRegisterAdapter()
        feeder_disclosures = []
        disclose_dir = self.staging_dir / "disclose"
        if disclose_dir.exists():
            for f in sorted(disclose_dir.glob("*.csv")):
                if disclose_adapter.can_handle(f):
                    feeder_disclosures.extend(disclose_adapter.parse_all_feeders(f))

        feeder_disc_map = {d.feeder_code: d for d in feeder_disclosures}

        # 4. Unwrap Feeders using FeederUnwrapper
        unwrapper = FeederUnwrapper(self.feeder_registry_path)
        all_unwrapped_funds: list[UnwrappedFund] = []

        with open(self.feeder_registry_path, "r", encoding="utf-8") as f:
            feeder_registry = json.load(f)

        for feeder_code, info in feeder_registry.items():
            master_ticker = info.get("master_ticker")
            master_fund = master_funds.get(master_ticker)
            if not master_fund:
                continue
            disc = feeder_disc_map.get(feeder_code)
            unwrapped = unwrapper.unwrap(feeder_code, master_fund, disc)
            all_unwrapped_funds.append(unwrapped)

        # 5. Ingest Direct Funds (Smartshares) and Enrich
        smartshares_adapter = SmartsharesDirectAdapter()
        smartshares_dir = self.staging_dir / "smartshares"
        all_unresolved_entries: list[dict] = []

        if smartshares_dir.exists():
            for f in sorted(smartshares_dir.glob("*.csv")):
                if smartshares_adapter.can_handle(f):
                    res = smartshares_adapter.parse(f)
                    unwrapped = self._enrich_domestic_fund(res, matcher, all_unresolved_entries)
                    all_unwrapped_funds.append(unwrapped)

        # 6. Ingest Kernel Funds and Enrich
        kernel_adapter = KernelAdapter()
        kernel_dir = self.staging_dir / "kernel"
        if kernel_dir.exists():
            for f in sorted(kernel_dir.glob("*.csv")):
                if kernel_adapter.can_handle(f):
                    res = kernel_adapter.parse(f)
                    unwrapped = self._enrich_domestic_fund(res, matcher, all_unresolved_entries)
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
                "cadence": "monthly",
                "is_stale": False,
            })
            constituents_map[uf.fund_code] = uf.constituents

        # 8. Load direct equities
        with open(direct_equities_output_path, "r", encoding="utf-8") as f:
            direct_equities_data = json.load(f)

        # 9. Validate with SchemaValidator
        validator = SchemaValidator()
        validation_report = validator.validate_all(
            funds_registry=funds_registry,
            constituents=constituents_map,
            direct_equities=direct_equities_data,
            unresolved_entries=all_unresolved_entries,
        )

        # 10. If not dry_run, write production files
        if not dry_run:
            self.output_dir.mkdir(parents=True, exist_ok=True)
            with open(self.output_dir / "funds_registry.json", "w", encoding="utf-8") as f:
                json.dump(funds_registry, f, indent=2)

            with open(self.output_dir / "constituents.json", "w", encoding="utf-8") as f:
                json.dump(constituents_map, f, indent=2)

            with open(self.output_dir / "unresolved_entries.json", "w", encoding="utf-8") as f:
                json.dump(all_unresolved_entries, f, indent=2)

        summary_data = {
            "sec_master_summary": sec_master_summary,
            "total_funds_compiled": len(funds_registry),
            "total_unresolved_entries": len(all_unresolved_entries),
            "unresolved_entries": all_unresolved_entries,
            "validation_report": validation_report,
        }

        return validation_report, summary_data

    def _enrich_domestic_fund(
        self,
        fund_res: Any,
        matcher: SecurityMatcher,
        unresolved_collector: list[dict],
    ) -> UnwrappedFund:
        """Enriches raw domestic or Kernel holdings using the Global Security Master."""
        resolved_constituents: list[dict] = []
        raw_equity_sum = sum(h.weight for h in fund_res.holdings)

        # Normalize equity weights if cash exists to ensure exact integrity
        scale = 1.0 - fund_res.cash_ratio
        weight_norm_factor = (scale / raw_equity_sum) if raw_equity_sum > 0 else 1.0

        for idx, h in enumerate(fund_res.holdings):
            normalized_weight = h.weight * weight_norm_factor
            match = matcher.match(
                name=h.name,
                ticker=h.ticker,
                isin=h.isin,
                provider=fund_res.provider,
                fund_code=fund_res.fund_code,
            )

            if match.matched and match.isin:
                resolved_constituents.append({
                    "isin": match.isin,
                    "name": match.name or h.name,
                    "ticker": match.ticker or h.ticker or "",
                    "country": match.country or "Global",
                    "sector": match.sector or "Unclassified",
                    "weight": round(normalized_weight, 8),
                })
            else:
                # Synthetic placeholder record to preserve weight sum integrity
                synth_isin = f"UNRESOLVED_{h.ticker or idx}"
                resolved_constituents.append({
                    "isin": synth_isin,
                    "name": h.name,
                    "ticker": h.ticker or "",
                    "country": "Unknown",
                    "sector": "Unclassified",
                    "weight": round(normalized_weight, 8),
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
                            h.name: f"INSERT_CANONICAL_ISIN"
                        }
                    },
                })

        return UnwrappedFund(
            fund_code=fund_res.fund_code,
            fund_name=fund_res.fund_name,
            provider=fund_res.provider,
            effective_date=fund_res.effective_date,
            cash_ratio=round(fund_res.cash_ratio, 6),
            hedging_ratio=0.0,
            constituents=resolved_constituents,
            unresolved_holdings=[],
        )

