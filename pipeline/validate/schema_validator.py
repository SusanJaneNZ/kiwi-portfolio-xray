"""Validation engine for JSON schemas, weight sum integrity, and taxonomy compliance."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from pipeline.enrichment.bond_normalizer import CANONICAL_BOND_SECTORS

FUND_ASSET_CLASSES = {"equity", "fixed_interest", "mixed"}
CONSTITUENT_ASSET_CLASSES = {"equity", "fixed_interest", "term_deposit"}

CANONICAL_GICS_SECTORS = {
    "Communication Services",
    "Consumer Discretionary",
    "Consumer Staples",
    "Energy",
    "Financials",
    "Health Care",
    "Industrials",
    "Information Technology",
    "Materials",
    "Real Estate",
    "Utilities",
    "Unclassified",
}


@dataclass
class ValidationReport:
    """Consolidated validation diagnostics report."""

    is_valid: bool = True
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    fund_summaries: list[dict[str, Any]] = field(default_factory=list)


class SchemaValidator:
    """Validates pipeline output datasets against schemas, weight integrity, and taxonomies."""

    def __init__(self, schemas_dir: Optional[Path] = None):
        self.schemas_dir = schemas_dir or (Path(__file__).parent / "schemas")

    def validate_all(
        self,
        funds_registry: list[dict],
        constituents: dict[str, list[dict]],
        direct_equities: list[dict],
        unresolved_entries: list[dict],
    ) -> ValidationReport:
        report = ValidationReport()

        # 1. Validate Funds Registry structure
        self._validate_funds_registry(funds_registry, report)

        # 2. Validate Constituents & Weight Sum Integrity
        self._validate_constituents(funds_registry, constituents, report)

        # 3. Validate Direct Equities
        self._validate_direct_equities(direct_equities, report)

        # 4. Validate Unresolved Entries format
        self._validate_unresolved_entries(unresolved_entries, report)

        report.is_valid = len(report.errors) == 0
        return report

    def _validate_funds_registry(self, funds: list[dict], report: ValidationReport) -> None:
        if not isinstance(funds, list) or len(funds) == 0:
            report.errors.append("funds_registry.json must be a non-empty array.")
            return

        seen_codes: set[str] = set()
        for idx, f in enumerate(funds):
            for required in ["code", "name", "provider", "effective_date", "cash_ratio", "hedging_ratio", "constituent_count", "asset_class"]:
                if required not in f:
                    report.errors.append(f"Fund #{idx} missing required key: '{required}'.")

            code = f.get("code", "")
            if code:
                if code in seen_codes:
                    report.errors.append(f"Duplicate fund code '{code}' in funds_registry.json.")
                seen_codes.add(code)

            cash_ratio = f.get("cash_ratio", 0.0)
            hedging_ratio = f.get("hedging_ratio", 0.0)
            if not isinstance(cash_ratio, (int, float)) or cash_ratio < 0.0 or cash_ratio > 1.0:
                report.errors.append(f"Fund '{code}' has out-of-range cash_ratio {cash_ratio}.")
            if not isinstance(hedging_ratio, (int, float)) or hedging_ratio < 0.0 or hedging_ratio > 1.0:
                report.errors.append(f"Fund '{code}' has out-of-range hedging_ratio {hedging_ratio}.")

            if f.get("asset_class") not in FUND_ASSET_CLASSES:
                report.errors.append(
                    f"Fund {f.get('code')} has invalid asset_class '{f.get('asset_class')}'."
                )

            eff_date = f.get("effective_date", "")
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", eff_date):
                report.errors.append(f"Fund {f.get('code')} invalid date format: '{eff_date}'.")

    def _validate_constituents(
        self,
        funds: list[dict],
        constituents: dict[str, list[dict]],
        report: ValidationReport,
    ) -> None:
        for f_info in funds:
            if not isinstance(f_info, dict):
                continue
            code = f_info.get("code")
            if code not in constituents:
                report.errors.append(f"Fund '{code}' listed in registry but missing from constituents.json.")
                continue

            fund_constituents = constituents[code]
            if not isinstance(fund_constituents, list):
                report.errors.append(f"Constituents for fund '{code}' must be a list.")
                continue

            expected_count = f_info.get("constituent_count")
            if isinstance(expected_count, int) and expected_count != len(fund_constituents):
                report.errors.append(
                    f"Fund '{code}' constituent_count ({expected_count}) does not match constituents length ({len(fund_constituents)})."
                )

            equity_weight_sum = 0.0
            bond_weight_sum = 0.0
            td_weight_sum = 0.0
            unclassified_count = 0

            for c_idx, c in enumerate(fund_constituents):
                for req in ["isin", "name", "country", "sector", "weight", "asset_class"]:
                    if req not in c:
                        report.errors.append(f"Fund '{code}' constituent #{c_idx} missing key '{req}'.")

                asset_class = c.get("asset_class")
                if asset_class not in CONSTITUENT_ASSET_CLASSES:
                    report.errors.append(
                        f"Fund '{code}' constituent '{c.get('name')}' has invalid asset_class '{asset_class}'."
                    )

                w = c.get("weight", 0.0)
                if not isinstance(w, (int, float)) or w < 0.0 or w > 1.0:
                    report.errors.append(
                        f"Fund '{code}' constituent '{c.get('name')}' has out-of-range weight {w}."
                    )
                    continue
                if asset_class == "fixed_interest":
                    bond_weight_sum += w
                elif asset_class == "term_deposit":
                    td_weight_sum += w
                else:
                    equity_weight_sum += w

                sector = c.get("sector", "")
                if asset_class == "fixed_interest":
                    if sector not in CANONICAL_BOND_SECTORS:
                        report.errors.append(
                            f"Fund '{code}' bond constituent '{c.get('name')}' has invalid bond category '{sector}'."
                        )
                elif asset_class == "term_deposit":
                    if sector != "Term Deposit":
                        report.errors.append(
                            f"Fund '{code}' term deposit constituent '{c.get('name')}' must have sector 'Term Deposit', got '{sector}'."
                        )
                else:
                    if sector not in CANONICAL_GICS_SECTORS:
                        report.warnings.append(
                            f"Fund '{code}' constituent '{c.get('name')}' has non-canonical sector '{sector}'."
                        )
                    if sector == "Unclassified":
                        unclassified_count += 1

            # Weight sum integrity check: sum(investable constituents) + cash + max(0, hedging) == 1.0 +- 0.5%
            investable_sum = equity_weight_sum + bond_weight_sum + td_weight_sum
            cash = f_info.get("cash_ratio", 0.0)
            hedging = max(0.0, f_info.get("hedging_ratio", 0.0))
            total_sum = investable_sum + cash + hedging

            deviation = abs(total_sum - 1.0)
            if deviation > 0.005:  # Allowed tolerance +- 0.5%
                report.errors.append(
                    f"Fund '{code}' weight sum failed integrity: investable={investable_sum:.4f}, "
                    f"cash={cash:.4f}, hedging={hedging:.4f}, total={total_sum:.4f} (deviation {deviation:.4f} > 0.005)."
                )

            report.fund_summaries.append({
                "code": code,
                "name": f_info.get("name"),
                "asset_class": f_info.get("asset_class"),
                "total_weight": round(total_sum, 4),
                "equity_weight": round(equity_weight_sum, 4),
                "bond_weight": round(bond_weight_sum, 4),
                "term_deposit_weight": round(td_weight_sum, 4),
                "cash_ratio": cash,
                "hedging_ratio": hedging,
                "constituent_count": len(fund_constituents),
                "unclassified_count": unclassified_count,
            })

    def _validate_direct_equities(self, direct_equities: list[dict], report: ValidationReport) -> None:
        if not isinstance(direct_equities, list):
            report.errors.append("direct_equities.json must be a list.")
            return

        for idx, item in enumerate(direct_equities):
            for req in ["isin", "name", "ticker", "exchange", "country", "sector"]:
                if req not in item:
                    report.errors.append(f"direct_equities item #{idx} missing '{req}'.")
            if item.get("exchange") not in {"NZX", "ASX"}:
                report.errors.append(f"direct_equities item #{idx} has invalid exchange '{item.get('exchange')}'.")

    def _validate_unresolved_entries(self, unresolved: list[dict], report: ValidationReport) -> None:
        if not isinstance(unresolved, list):
            report.errors.append("unresolved_entries.json must be a list.")
            return

        for idx, item in enumerate(unresolved):
            for req in ["provider", "fund_code", "raw_name", "weight", "reason"]:
                if req not in item:
                    report.errors.append(f"unresolved_entries item #{idx} missing '{req}'.")

