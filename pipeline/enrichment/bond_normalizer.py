"""Fixed-interest, term-deposit, and canonical issuer normalization for Sorted NZ fund disclosures."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional

from pipeline.enrichment.fuzzy_matcher import normalize_company_name
from pipeline.security_master.build_security_master import normalize_country

DEFAULT_ISSUER_ALIAS_PATH = Path(__file__).with_name("issuer_alias_map.json")

CANONICAL_BOND_SECTORS = {
    "Sovereign",
    "Local Government",
    "Supranational",
    "Financial",
    "Bond ETF",
    "Corporate / Other",
}

EQUITY_FUND_ALLOWLIST = {
    "KERNEL_GLOBAL_DIVIDEND",
}

BANK_ISSUER_KEYS = {
    "ISSUER_ANZ",
    "ISSUER_WBC",
    "ISSUER_CBA_ASB",
    "ISSUER_NAB_BNZ",
    "ISSUER_KIWIBANK",
    "ISSUER_HEARTLAND",
    "ISSUER_RABOBANK",
    "ISSUER_TSB",
    "ISSUER_SBS",
}

_DATE_MONTHS = r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*"
_COMPACT_DDMMYY_RE = r"\b(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])(?:2[5-9]|[3-6]\d)\b"
_DATE_RE = re.compile(
    rf"(?:\b\d{{1,2}}[/-]\d{{1,2}}[/-](?:20|21)?\d{{2}}\b"
    rf"|\b\d{{1,2}}[-\s]{_DATE_MONTHS}[-\s](?:20|21)?\d{{2}}\b"
    rf"|\b{_DATE_MONTHS}\s+20\d{{2}}\b"
    rf"|{_COMPACT_DDMMYY_RE}"
    rf"|\b(?:202[5-9]|20[3-6]\d)\b)",
    re.IGNORECASE,
)
_COUPON_RE = re.compile(
    rf"(?:\b\d+(?:\.\d+)?\s*%"
    rf"|\b\d+\.\d{{2,3}}(?=\s+(?:\d{{1,2}}[/-]|{_DATE_MONTHS}|20\d{{2}}))"
    rf"|(?:(?:\d{{1,2}}[/-]\d{{1,2}}[/-](?:20|21)?\d{{2}}|{_COMPACT_DDMMYY_RE})\s+\d{{1,2}}\.\d{{1,4}}(?:\b|\s+(?:CB|GB)\b)))",
    re.IGNORECASE,
)
_EXPLICIT_TD_RE = re.compile(
    r"\b(?:term\s+deposit|call\s+deposit|notice\s+saver|bank\s+deposit)\b",
    re.IGNORECASE,
)
_BOND_KEYWORD_RE = re.compile(
    r"\b(?:new\s+zealand\s+government|nzgs|lgfa|nzlgfa|local\s+government\s+funding|housing\s+new\s+zealand|"
    r"us\s+treasury|u\.s\.\s+treasury|uk\s+gilt|bundesrepublik|"
    r"treasury\s+(?:bill|note|bond)|frn|floating\s+rate\s+note|fixed\s+rate\s+note|"
    r"capital\s+notes?|subordinated\s+notes?|senior\s+notes?|perpetual|rcd|ncd|commercial\s+paper|"
    r"via\s+sb\s+capital)\b",
    re.IGNORECASE,
)
_BOND_FUND_RE = re.compile(
    r"(?:\bbond\b.{0,30}\b(?:etf|fund|index)\b"
    r"|\b(?:fixed\s+interest\s+(?:etf|fund)|interest\s+rate\s+swap|bond\s+future|interest\s+rate\s+future)\b"
    r"|^(?:irs|rfr|ccs|cdx|fin\s+fut)\b)",
    re.IGNORECASE,
)
_TRANCHE_STRIP_PATTERNS = [
    re.compile(r"\b\d+(?:\.\d+)?\s*%(?:\s*p\.a\.)?", re.IGNORECASE),
    re.compile(rf"\b\d+\.\d{{2,3}}(?=\s+(?:\d{{1,2}}[/-]|{_DATE_MONTHS}|20\d{{2}}))", re.IGNORECASE),
    re.compile(rf"(?<=\s)\d{{1,2}}\.\d{{1,4}}(?=\s*(?:$|CB\b|GB\b))", re.IGNORECASE),
    _DATE_RE,
    re.compile(r"\b(?:series|tranche)\s+[a-z0-9-]+\b", re.IGNORECASE),
    re.compile(
        r"\b(?:senior|unsecured|secured|subordinated|notes?|frn|fixed|floating|"
        r"green\s+bond|social\s+bond|sustainability\s+bond|international\s+bond|bond|perpetual|callable|"
        r"registered\s+certificate\s+of\s+deposit|certificate\s+of\s+deposit|rcd|ncd|cb|gb|abs|mbs|rmbs|frm)\b",
        re.IGNORECASE,
    ),
]


def _slugify(value: str) -> str:
    slug = re.sub(r"[^A-Z0-9]+", "_", value.upper()).strip("_")
    return slug[:48] or "UNKNOWN"


class AssetClassifier:
    """Classifies non-cash holdings (term deposits, bonds, equities) and normalizes bond/bank issuers."""

    def __init__(self, issuer_alias_path: Optional[Path] = None):
        path = issuer_alias_path or DEFAULT_ISSUER_ALIAS_PATH
        self.issuer_map: dict[str, dict[str, Any]] = {}
        if path.exists():
            self.issuer_map = json.loads(path.read_text(encoding="utf-8"))

        # Precompute (normalized_alias, issuer_key, entry) ordered longest-alias-first for deterministic matching
        alias_rows: list[tuple[str, str, dict[str, Any]]] = []
        for issuer_key, entry in self.issuer_map.items():
            for alias in entry.get("aliases", []):
                norm_alias = normalize_company_name(alias)
                if norm_alias:
                    alias_rows.append((norm_alias, issuer_key, entry))
        alias_rows.sort(key=lambda item: len(item[0]), reverse=True)
        self._aliases = alias_rows

    def resolve_issuer(self, raw_name: str) -> tuple[Optional[str], Optional[str], dict[str, Any]]:
        """Matches a company, bank, or bond issuer name to its canonical issuer key and metadata."""
        norm_name = normalize_company_name(raw_name)
        if not norm_name:
            return None, None, {}

        padded_name = f" {norm_name} "
        # 1. Exact normalized match
        for norm_alias, issuer_key, entry in self._aliases:
            if norm_name == norm_alias:
                return issuer_key, entry.get("display_name"), entry

        # 2. Whole-token-phrase match (handles "ANZ Bank New Zealand 15/04/2027" cleanly without substring collisions)
        for norm_alias, issuer_key, entry in self._aliases:
            if f" {norm_alias} " in padded_name:
                return issuer_key, entry.get("display_name"), entry

        return None, None, {}

    def classify_holding(self, name: str, fund_code: str = "", asset_class_hint: str = "") -> str:
        """Routes a single non-cash holding into 'term_deposit', 'fixed_interest', or 'equity'."""
        hint = (asset_class_hint or "").strip().lower()
        if "term deposit" in hint:
            return "term_deposit"

        # Rule 1: Explicit Term Deposit / Call Deposit (even when rate % + maturity date appear)
        has_bond_kw = bool(_BOND_KEYWORD_RE.search(name) or _BOND_FUND_RE.search(name))
        if _EXPLICIT_TD_RE.search(name) and not has_bond_kw:
            return "term_deposit"
        if re.search(r"\bTD\b", name) and not re.search(r"\bLtd\b", name, re.IGNORECASE):
            issuer_key, _, _ = self.resolve_issuer(name)
            if (issuer_key in BANK_ISSUER_KEYS or _DATE_RE.search(name)) and not (_COUPON_RE.search(name) or has_bond_kw):
                return "term_deposit"

        # Protect explicitly dividend-oriented equity funds from bond heuristics unless row explicitly matched deposit
        if fund_code in EQUITY_FUND_ALLOWLIST:
            return "equity"

        if "fixed interest" in hint or "bond" in hint:
            return "fixed_interest"

        # Rule 2: Fixed Interest / Debt / Bond ETFs / Rate Derivatives
        if _COUPON_RE.search(name) and _DATE_RE.search(name):
            return "fixed_interest"
        if _DATE_RE.search(name) and re.search(r"\b(?:abs|mbs|rmbs|frm|cb|gb)\b", name, re.IGNORECASE):
            return "fixed_interest"
        if _BOND_KEYWORD_RE.search(name) or _BOND_FUND_RE.search(name):
            return "fixed_interest"

        # Rule 3: Equity fallback
        return "equity"

    def normalize_bond_holding(self, raw_name: str, country_hint: str = "") -> dict[str, Any]:
        """Normalizes a fixed-interest tranche or bond ETF into a canonical issuer record."""
        is_etf_or_fund = bool(_BOND_FUND_RE.search(raw_name))
        cleaned = " ".join(raw_name.split())

        if not is_etf_or_fund:
            stripped = cleaned
            for pat in _TRANCHE_STRIP_PATTERNS:
                stripped = pat.sub(" ", stripped)
            stripped = re.sub(r"[\s,;|/()-]+$", "", stripped)
            stripped = re.sub(r"\s{2,}", " ", stripped).strip()
            candidate_name = stripped or cleaned
        else:
            candidate_name = cleaned

        issuer_key, display_name, meta = self.resolve_issuer(candidate_name)
        if not issuer_key:
            issuer_key, display_name, meta = self.resolve_issuer(cleaned)

        final_name = display_name or candidate_name
        consolidation_key = issuer_key or _slugify(final_name)
        sector = self._derive_bond_sector(cleaned, is_etf_or_fund, issuer_key, meta)
        country = self._derive_country(cleaned, country_hint, sector, meta)

        return {
            "isin": f"BOND:{consolidation_key}",
            "name": final_name,
            "sector": sector,
            "country": country,
            "issuer_key": issuer_key,
            "issuer_name": display_name or (final_name if issuer_key else None),
            "consolidation_key": consolidation_key,
        }

    def normalize_term_deposit(self, raw_name: str, country_hint: str = "") -> dict[str, Any]:
        """Normalizes a fund-held term deposit row into a canonical deposit constituent."""
        issuer_key, display_name, meta = self.resolve_issuer(raw_name)
        cleaned = re.sub(r"\b\d+(?:\.\d+)?\s*%", " ", raw_name)
        cleaned = _EXPLICIT_TD_RE.sub(" ", cleaned)
        cleaned = _DATE_RE.sub(" ", cleaned)
        cleaned = re.sub(r"\s{2,}", " ", cleaned).strip(" -/,")
        bank_name = display_name or cleaned or raw_name
        consolidation_key = issuer_key or _slugify(bank_name)
        label = f"{bank_name} Term Deposit" if "deposit" not in bank_name.lower() else bank_name
        country = meta.get("country") or normalize_country(country_hint, default="New Zealand" if issuer_key in BANK_ISSUER_KEYS else "Global")

        return {
            "isin": f"TD:{consolidation_key}",
            "name": label,
            "sector": "Term Deposit",
            "country": country,
            "issuer_key": issuer_key,
            "issuer_name": display_name,
        }

    def derive_fund_asset_class(self, constituents: list[dict[str, Any]]) -> str:
        """Derives 'equity', 'fixed_interest', or 'mixed' from non-cash constituent weights."""
        eq_weight = sum(c.get("weight", 0.0) for c in constituents if c.get("asset_class") == "equity")
        def_weight = sum(
            c.get("weight", 0.0)
            for c in constituents
            if c.get("asset_class") in {"fixed_interest", "term_deposit"}
        )
        total_nc = eq_weight + def_weight
        if total_nc <= 0:
            return "fixed_interest"
        eq_share = eq_weight / total_nc
        def_share = def_weight / total_nc
        if eq_share > 0.05 and def_share > 0.05:
            return "mixed"
        if def_weight >= eq_weight:
            return "fixed_interest"
        return "equity"

    def _derive_bond_sector(
        self,
        raw_name: str,
        is_etf_or_fund: bool,
        issuer_key: Optional[str],
        meta: dict[str, Any],
    ) -> str:
        if is_etf_or_fund:
            if re.search(r"\bbond\b.{0,30}\b(?:etf|fund|index)\b|fixed\s+interest\s+(?:etf|fund)\b", raw_name, re.IGNORECASE):
                return "Bond ETF"
            return "Corporate / Other"
        if meta.get("category") in CANONICAL_BOND_SECTORS:
            return meta["category"]
        lower = raw_name.lower()
        if any(k in lower for k in ("local government", "council", "lgfa", "city of")):
            return "Local Government"
        if any(k in lower for k in ("asian development bank", "world bank", "international bank for reconstruction", "european investment bank", "nordic investment bank")):
            return "Supranational"
        if any(k in lower for k in ("government", "treasury", "gilt", "bundesrepublik", "nzgs", "sovereign")):
            return "Sovereign"
        if issuer_key in BANK_ISSUER_KEYS or any(k in lower for k in ("bank", "financial", "insurance", "building society")):
            return "Financial"
        return "Corporate / Other"

    def _derive_country(
        self,
        raw_name: str,
        country_hint: str,
        sector: str,
        meta: dict[str, Any],
    ) -> str:
        if country_hint and country_hint.strip():
            return normalize_country(country_hint, default="Global")
        if meta.get("country"):
            return meta["country"]
        if sector == "Supranational":
            return "Supranational"
        lower = raw_name.lower()
        if any(k in lower for k in ("new zealand", "nzgs", "lgfa", "kainga ora", "auckland")):
            return "New Zealand"
        if any(k in lower for k in ("us treasury", "u.s. treasury", "united states")):
            return "United States"
        if any(k in lower for k in ("uk gilt", "united kingdom")):
            return "United Kingdom"
        if "australia" in lower:
            return "Australia"
        return "Global"
