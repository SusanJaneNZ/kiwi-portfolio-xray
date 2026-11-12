"""String normalization and disambiguated fuzzy matching against the Global Security Master."""

from __future__ import annotations

import difflib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

try:
    from rapidfuzz import fuzz
    HAS_RAPIDFUZZ = True
except ImportError:
    HAS_RAPIDFUZZ = False

# Corporate legal and share-class classification stop-words
LEGAL_SUFFIXES = {
    "LIMITED", "LTD", "INCORPORATED", "INC", "CORPORATION", "CORP",
    "PLC", "PUBLIC", "AG", "AS", "NV", "SA", "OYJ", "HOLDINGS", "HOLDING", "HLDGS",
    "GROUP", "GRP", "COMPANY", "CO", "SPA", "SE", "GMBH", "KGA", "KGAA", "BERHAD", "BHD",
    "AB", "ASA", "SCA", "SP", "KK", "TBK", "PTE", "PTY", "LP", "LLC",
    "ORD", "ORDINARY", "COMMON", "SHARES", "SHS", "REG", "REGISTERED", "STAPLED",
    "PROMESSES", "ADR", "GDR", "BDR", "SPONSORED", "SV", "NA", "ON", "NPV", "CVA",
    "PTG", "NVTG", "PREF", "PREFERENCE",
    # Trailing country/article/currency/REIT tags appended by Vanguard VT or Kernel
    "THE", "CANADA", "CN", "USD", "EUR", "SEK", "GBP", "AUD", "NZD", "CHF", "JPY", "KONINKLIJKE",
    "JREIT", "J-REIT",
}

TOKEN_EXPANSIONS = {
    "INTL": "INTERNATIONAL",
    "CIE": "COMPAGNIE",
    "COS": "COMPANIES",
    "HLDG": "HOLDING",
    "DEV": "DEVELOPMENT",
    "INVEST": "INVESTMENT",
}


def normalize_company_name(name: str) -> str:
    """Normalizes a company name by stripping legal/share suffixes, punctuation, and extra whitespace."""
    if not name:
        return ""
    # Strip trailing exchange ticker + currency tags like " - KER (EUR)"
    cleaned = re.sub(r"\s+-\s+[A-Z0-9./]{1,6}\s*\([A-Z]{3}\)\s*$", " ", name, flags=re.IGNORECASE)
    # Strip compound abbreviations like A/S, N.V., S.A., S.p.A., O.N., K.K. (using lookaround so trailing dots match cleanly)
    cleaned = re.sub(
        r"(?<!\w)(?:A/S|N\.V\.|S\.A\.|S\.P\.A\.|A\.G\.|O\.Y\.|P\.L\.C\.|K\.K\.|O\.N\.)(?!\w)",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    # Strip parentheses and contents if e.g. (NZ), (AU), (UK Register), (SEK)
    cleaned = re.sub(r"\([^)]+\)", " ", cleaned)
    # Replace punctuation with space
    cleaned = re.sub(r"[^A-Za-z0-9\s]", " ", cleaned).upper()
    tokens = []
    for tok in cleaned.split():
        if not tok:
            continue
        expanded = TOKEN_EXPANSIONS.get(tok, tok)
        if expanded in LEGAL_SUFFIXES:
            continue
        tokens.append(expanded)
    return " ".join(tokens)


def get_stem_tokens(name: str) -> set[str]:
    """Returns the primary stem words of a company name."""
    norm = normalize_company_name(name)
    tokens = {tok for tok in norm.split() if len(tok) >= 3}
    return tokens


def token_sort_similarity(s1: str, s2: str) -> float:
    """Calculates token-sort similarity score between 0.0 and 1.0."""
    norm1 = normalize_company_name(s1)
    norm2 = normalize_company_name(s2)

    if norm1 == norm2 and norm1:
        return 1.0

    tokens1 = sorted(norm1.split())
    tokens2 = sorted(norm2.split())

    sorted_s1 = " ".join(tokens1)
    sorted_s2 = " ".join(tokens2)

    if HAS_RAPIDFUZZ:
        return fuzz.ratio(sorted_s1, sorted_s2) / 100.0
    else:
        # Standard library difflib SequenceMatcher ratio
        matcher = difflib.SequenceMatcher(None, sorted_s1, sorted_s2)
        return matcher.ratio()


@dataclass
class MatchResult:
    """Result of attempting to match a holding against the security master."""

    matched: bool
    isin: Optional[str] = None
    name: Optional[str] = None
    ticker: Optional[str] = None
    country: Optional[str] = None
    sector: Optional[str] = None
    score: float = 0.0
    reason: str = ""
    candidate_spread: float = 1.0


class SecurityMatcher:
    """Enriches raw holdings against a loaded security master dataset."""

    def __init__(
        self,
        security_master: list[dict],
        alias_map: Optional[dict[str, dict[str, str]]] = None,
        gics_mapping: Optional[dict[str, str]] = None,
    ):
        self.security_master = security_master
        self.alias_map = alias_map or {}
        self.gics_mapping = gics_mapping or {}
        self.gics_lower = {k.lower(): v for k, v in self.gics_mapping.items()}

        # Build indexes for O(1) exact lookups & inverted token pool
        self.by_isin: dict[str, dict] = {}
        self.by_ticker: dict[str, list[dict]] = {}
        self.by_clean_name: dict[str, list[dict]] = {}
        self.by_token: dict[str, list[dict]] = {}

        for sec in security_master:
            isin = sec.get("isin", "").strip()
            if isin:
                self.by_isin[isin] = sec

            ticker = sec.get("ticker", "").strip().upper()
            if ticker:
                self.by_ticker.setdefault(ticker, []).append(sec)
                if ":" in ticker:
                    self.by_ticker.setdefault(ticker.split(":")[-1], []).append(sec)
                if "." in ticker:
                    self.by_ticker.setdefault(ticker.split(".")[0], []).append(sec)

            clean_name = normalize_company_name(sec.get("name", ""))
            if clean_name:
                self.by_clean_name.setdefault(clean_name, []).append(sec)
                for tok in get_stem_tokens(clean_name):
                    self.by_token.setdefault(tok, []).append(sec)

        # Unambiguous cross-fund alias fallback (None marks conflicting multi-fund targets)
        self.global_alias_by_name: dict[str, Optional[str]] = {}
        for scope_map in self.alias_map.values():
            if not isinstance(scope_map, dict):
                continue
            for raw_name, target_isin in scope_map.items():
                if raw_name not in self.global_alias_by_name:
                    self.global_alias_by_name[raw_name] = target_isin
                elif self.global_alias_by_name[raw_name] != target_isin:
                    self.global_alias_by_name[raw_name] = None

    def match(
        self,
        name: str,
        ticker: Optional[str] = None,
        isin: Optional[str] = None,
        provider: str = "",
        fund_code: str = "",
    ) -> MatchResult:
        """Attempts to match an incoming record using alias, ISIN, exact ticker, and fuzzy guardrails."""
        # 1. Check explicit provider alias map first (per-fund -> provider wildcard -> unambiguous cross-fund)
        alias_key = f"{provider}:{fund_code}"
        fund_aliases = self.alias_map.get(alias_key, {})
        alias_isin = fund_aliases.get(name)
        alias_reason = "provider_alias_map"
        if not alias_isin:
            alias_isin = self.alias_map.get(f"{provider}:*", {}).get(name) or self.alias_map.get("*", {}).get(name)
            if not alias_isin:
                alias_isin = self.global_alias_by_name.get(name)
                alias_reason = "cross_fund_alias_map"

        if alias_isin:
            if alias_isin in self.by_isin:
                sec = self.by_isin[alias_isin]
                return self._build_result(sec, 1.0, alias_reason)
            # If alias is provided but not in security master, return partial resolution
            return MatchResult(
                matched=True,
                isin=alias_isin,
                name=name,
                ticker=ticker,
                country="Unknown",
                sector=self._normalize_sector("Unclassified"),
                score=1.0,
                reason=f"{alias_reason}_direct",
            )

        # 2. Direct ISIN lookup
        if isin and isin in self.by_isin:
            sec = self.by_isin[isin]
            return self._build_result(sec, 1.0, "exact_isin")

        # 3. Exact clean name match (preserving primary/first registered listing on dual-listed collisions)
        clean_in = normalize_company_name(name)
        if clean_in and clean_in in self.by_clean_name:
            sec = self.by_clean_name[clean_in][0]
            return self._build_result(sec, 1.0, "exact_normalized_name")
        if clean_in and "CLASS" not in clean_in:
            parts = clean_in.split()
            if len(parts) >= 2 and parts[-1] in {"A", "B", "C"}:
                base_clean = " ".join(parts[:-1])
                if base_clean in self.by_clean_name:
                    return self._build_result(self.by_clean_name[base_clean][0], 0.99, "exact_normalized_name_share_class")

        # 4. Exact ticker match (require name/stem check on bare tickers to avoid cross-exchange collisions)
        in_stems = get_stem_tokens(name)
        if ticker:
            ticker_upper = ticker.strip().upper()
            candidates = self.by_ticker.get(ticker_upper, [])
            if len(candidates) == 1:
                cand = candidates[0]
                cand_ticker = cand.get("ticker", "").strip().upper()
                cand_stems = get_stem_tokens(cand.get("name", ""))
                exact_qualified = ("." in ticker_upper or ":" in ticker_upper) and cand_ticker == ticker_upper
                stems_align = bool(in_stems & cand_stems) if (in_stems and cand_stems) else False
                if exact_qualified or stems_align or token_sort_similarity(name, cand.get("name", "")) >= 0.55:
                    return self._build_result(cand, 0.98, "exact_ticker_unique")
            elif len(candidates) > 1:
                # Disambiguate by stem match
                for cand in candidates:
                    cand_stems = get_stem_tokens(cand.get("name", ""))
                    if in_stems and (in_stems & cand_stems):
                        return self._build_result(cand, 0.95, "exact_ticker_stem_disambiguated")

        # 5. Guardrailed fuzzy match via inverted stem-token pool
        candidate_pool, _ = self._collect_stem_candidates(name)

        candidates_scored: list[tuple[float, dict]] = []
        for sec in candidate_pool:
            cand_name = sec.get("name", "")
            score = token_sort_similarity(name, cand_name)
            candidates_scored.append((score, sec))

        if not candidates_scored:
            return MatchResult(
                matched=False,
                name=name,
                ticker=ticker,
                score=0.0,
                reason="no_candidates_above_70",
            )

        candidates_scored.sort(key=lambda x: x[0], reverse=True)
        top1_score, top1_sec = candidates_scored[0]
        top1_norm = normalize_company_name(top1_sec.get("name", ""))
        # Measure spread against the strongest candidate representing a DIFFERENT normalized company
        top2_score = next(
            (s for s, sec in candidates_scored[1:] if normalize_company_name(sec.get("name", "")) != top1_norm),
            0.0,
        )
        spread = top1_score - top2_score

        # Guardrails: >= 0.90 score, >= 0.15 spread, and shared stem tokens
        top1_stems = get_stem_tokens(top1_sec.get("name", ""))
        shared_stems = bool(in_stems & top1_stems) if in_stems else True

        if top1_score >= 0.90 and spread >= 0.15 and shared_stems:
            return self._build_result(top1_sec, top1_score, "fuzzy_guardrails_passed", spread)

        # Ambiguous collision or low confidence
        reason = f"ambiguous_collision_spread_{spread:.2f}" if spread < 0.15 else "score_below_90"
        return MatchResult(
            matched=False,
            name=name,
            ticker=ticker,
            score=top1_score,
            candidate_spread=spread,
            reason=reason,
        )

    def _collect_stem_candidates(self, name: str) -> tuple[list[dict], set[int]]:
        in_stems = get_stem_tokens(name)
        candidate_pool: list[dict] = []
        seen_pool_ids: set[int] = set()
        for tok in in_stems:
            for sec in self.by_token.get(tok, []):
                obj_id = id(sec)
                if obj_id not in seen_pool_ids:
                    seen_pool_ids.add(obj_id)
                    candidate_pool.append(sec)
        return candidate_pool, seen_pool_ids

    def suggest_candidates(self, name: str, limit: int = 3) -> list[dict]:
        """Returns top Security Master close-match candidates for an unresolved/unlinked holding name."""
        candidate_pool, seen_pool_ids = self._collect_stem_candidates(name)

        # Also include normalized multi-token substring hits when stems are broad or missing
        lowered_tokens = [t.lower() for t in normalize_company_name(name).split() if len(t) >= 3]
        if len(candidate_pool) < limit and lowered_tokens:
            for sec in self.security_master:
                obj_id = id(sec)
                if obj_id in seen_pool_ids:
                    continue
                sec_name_l = sec.get("name", "").lower()
                if any(tok in sec_name_l for tok in lowered_tokens):
                    seen_pool_ids.add(obj_id)
                    candidate_pool.append(sec)

        scored: list[tuple[float, dict]] = []
        for sec in candidate_pool:
            score = token_sort_similarity(name, sec.get("name", ""))
            scored.append((score, sec))
        scored.sort(key=lambda x: x[0], reverse=True)

        results: list[dict] = []
        for score, sec in scored[:limit]:
            results.append({
                "isin": sec.get("isin", ""),
                "name": sec.get("name", ""),
                "ticker": sec.get("ticker", ""),
                "country": sec.get("country", "Global"),
                "sector": self._normalize_sector(sec.get("sector")),
                "score": round(score, 3),
            })
        return results

    def normalize_sector(self, sector_raw: Optional[str]) -> str:
        if not sector_raw:
            return "Unclassified"
        cleaned = sector_raw.strip()
        if not cleaned:
            return "Unclassified"
        return self.gics_lower.get(cleaned.lower(), cleaned)

    _normalize_sector = normalize_sector

    def _build_result(
        self, sec: dict, score: float, reason: str, spread: float = 1.0
    ) -> MatchResult:
        return MatchResult(
            matched=True,
            isin=sec.get("isin"),
            name=sec.get("name"),
            ticker=sec.get("ticker"),
            country=sec.get("country", "Global"),
            sector=self._normalize_sector(sec.get("sector")),
            score=score,
            candidate_spread=spread,
            reason=reason,
        )
