"""Validation engine for JSON schemas, weight sum integrity, and taxonomy compliance."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

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

        for idx, f in enumerate(funds):
            for required in ["code", "name", "provider", "effective_date", "cash_ratio", "hedging_ratio", "constituent_count"]:
                if required not in f:
                    report.errors.append(f"Fund #{idx} missing required key: '{required}'.")

            eff_date = f.get("effective_date", "")
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", eff_date):
                report.errors.append(f"Fund {f.get('code')} invalid date format: '{eff_date}'.")

    def _validate_constituents(
        self,
        funds: list[dict],
        constituents: dict[str, list[dict]],
        report: ValidationReport,
    ) -> None:
        fund_map = {f.get("code"): f for f in funds if isinstance(f, dict)}

        for code, f_info in fund_map.items():
            if code not in constituents:
                report.errors.append(f"Fund '{code}' listed in registry but missing from constituents.json.")
                continue

            fund_constituents = constituents[code]
            if not isinstance(fund_constituents, list):
                report.errors.append(f"Constituents for fund '{code}' must be a list.")
                continue

            equity_weight_sum = 0.0
            unclassified_count = 0

            for c_idx, c in enumerate(fund_constituents):
                for req in ["isin", "name", "country", "sector", "weight"]:
                    if req not in c:
                        report.errors.append(f"Fund '{code}' constituent #{c_idx} missing key '{req}'.")

                w = c.get("weight", 0.0)
                equity_weight_sum += w

                sector = c.get("sector", "")
                if sector not in CANONICAL_GICS_SECTORS:
                    report.warnings.append(
                        f"Fund '{code}' constituent '{c.get('name')}' has non-canonical sector '{sector}'."
                    )
                if sector == "Unclassified":
                    unclassified_count += 1

            # Weight sum integrity check: sum(equity) + cash + max(0, hedging) == 1.0 +- 0.5%
            cash = f_info.get("cash_ratio", 0.0)
            hedging = max(0.0, f_info.get("hedging_ratio", 0.0))
            total_sum = equity_weight_sum + cash + hedging

            deviation = abs(total_sum - 1.0)
            if deviation > 0.005:  # Allowed tolerance +- 0.5%
                report.errors.append(
                    f"Fund '{code}' weight sum failed integrity: equity={equity_weight_sum:.4f}, "
                    f"cash={cash:.4f}, hedging={hedging:.4f}, total={total_sum:.4f} (deviation {deviation:.4f} > 0.005)."
                )

            report.fund_summaries.append({
                "code": code,
                "name": f_info.get("name"),
                "total_weight": round(total_sum, 4),
                "equity_weight": round(equity_weight_sum, 4),
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

