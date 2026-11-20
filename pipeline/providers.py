"""Single source of truth for NZ fund manager / provider metadata, normalization, and verified schemes."""

from __future__ import annotations

import re
from typing import Any, Optional

# Canonical provider definitions for domestic NZ fund managers, overseas master ETF issuers, and reference dirs.
PROVIDER_DEFINITIONS: tuple[dict[str, Any], ...] = (
    {
        "slug": "smartshares",
        "display_name": "Smartshares",
        "legal_name": "Smartshares Limited",
        "kind": "domestic",
        "is_kiwisaver": False,
        "can_auto_fetch": True,
        "scheme_id": "SCH10752",
        "offer_id": "OFR10865",
    },
    {
        "slug": "kernel",
        "display_name": "Kernel",
        "legal_name": "Kernel Wealth Limited",
        "kind": "domestic",
        "is_kiwisaver": False,
        "can_auto_fetch": True,
        "scheme_id": "SCH12697",
        "offer_id": "OFR12698",
    },
    {
        "slug": "simplicity",
        "display_name": "Simplicity",
        "legal_name": "Simplicity NZ Limited",
        "kind": "domestic",
        "is_kiwisaver": True,
        "can_auto_fetch": True,
        "scheme_id": "SCH11598",
        "offer_id": "OFR11634",
    },
    {
        "slug": "fisher_funds",
        "display_name": "Fisher Funds",
        "legal_name": "Fisher Funds Management Limited",
        "kind": "domestic",
        "is_kiwisaver": True,
        "can_auto_fetch": True,
        "scheme_id": "SCH10713",
        "offer_id": "OFR10715",
    },
    {
        "slug": "milford",
        "display_name": "Milford",
        "legal_name": "Milford Funds Limited",
        "kind": "domestic",
        "is_kiwisaver": True,
        "can_auto_fetch": True,
        "scheme_id": None,
        "offer_id": None,
    },
    {
        "slug": "generate",
        "display_name": "Generate",
        "legal_name": "Generate Investment Management Limited",
        "kind": "domestic",
        "is_kiwisaver": True,
        "can_auto_fetch": True,
        "scheme_id": None,
        "offer_id": None,
    },
    {
        "slug": "booster",
        "display_name": "Booster",
        "legal_name": "Booster Investment Management Limited",
        "kind": "domestic",
        "is_kiwisaver": True,
        "can_auto_fetch": True,
        "scheme_id": None,
        "offer_id": None,
    },
    {
        "slug": "anz",
        "display_name": "ANZ",
        "legal_name": "ANZ New Zealand Investments Limited",
        "kind": "domestic",
        "is_kiwisaver": True,
        "can_auto_fetch": True,
        "scheme_id": None,
        "offer_id": None,
    },
    {
        "slug": "asb",
        "display_name": "ASB",
        "legal_name": "ASB Group Investments Limited",
        "kind": "domestic",
        "is_kiwisaver": True,
        "can_auto_fetch": True,
        "scheme_id": None,
        "offer_id": None,
    },
    {
        "slug": "westpac",
        "display_name": "Westpac",
        "legal_name": "BT Funds Management (NZ) Limited",
        "kind": "domestic",
        "is_kiwisaver": True,
        "can_auto_fetch": True,
        "scheme_id": None,
        "offer_id": None,
    },
    {
        "slug": "bnz",
        "display_name": "BNZ",
        "legal_name": "BNZ Investment Services Limited",
        "kind": "domestic",
        "is_kiwisaver": True,
        "can_auto_fetch": True,
        "scheme_id": None,
        "offer_id": None,
    },
    # Overseas master ETF issuers & staging directories
    {"slug": "vanguard", "display_name": "Vanguard", "legal_name": "Vanguard", "kind": "master", "is_kiwisaver": False, "can_auto_fetch": False, "scheme_id": None, "offer_id": None},
    {"slug": "ishares", "display_name": "iShares", "legal_name": "BlackRock iShares", "kind": "master", "is_kiwisaver": False, "can_auto_fetch": False, "scheme_id": None, "offer_id": None},
    {"slug": "spdr", "display_name": "SPDR", "legal_name": "State Street SPDR", "kind": "master", "is_kiwisaver": False, "can_auto_fetch": False, "scheme_id": None, "offer_id": None},
    {"slug": "betashares", "display_name": "BetaShares", "legal_name": "BetaShares", "kind": "master", "is_kiwisaver": False, "can_auto_fetch": False, "scheme_id": None, "offer_id": None},
    {"slug": "directories", "display_name": "Directories", "legal_name": "Exchange Directories", "kind": "reference", "is_kiwisaver": False, "can_auto_fetch": False, "scheme_id": None, "offer_id": None},
    {"slug": "custom", "display_name": "Custom", "legal_name": "Custom", "kind": "domestic", "is_kiwisaver": False, "can_auto_fetch": False, "scheme_id": None, "offer_id": None},
)

PROVIDERS_BY_SLUG: dict[str, dict[str, Any]] = {p["slug"]: p for p in PROVIDER_DEFINITIONS}
ALLOWED_PROVIDERS: set[str] = set(PROVIDERS_BY_SLUG.keys())
KIWISAVER_PROVIDER_SLUGS: set[str] = {p["slug"] for p in PROVIDER_DEFINITIONS if p["is_kiwisaver"]}
KNOWN_PROVIDER_SCHEMES: dict[str, tuple[str, str]] = {
    p["slug"]: (p["scheme_id"], p["offer_id"])
    for p in PROVIDER_DEFINITIONS
    if p.get("scheme_id") and p.get("offer_id")
}


def normalize_provider(provider: str) -> str:
    """Normalizes a fund manager name to canonical snake_case staging folder slug."""
    return re.sub(r"[\s\-]+", "_", str(provider or "").strip().lower()).strip("_")


def get_default_scheme_offer(provider: str) -> tuple[str, str]:
    """Returns verified (scheme_id, offer_id) for a known provider, or ('', '') if unverified."""
    norm = normalize_provider(provider)
    if norm in KNOWN_PROVIDER_SCHEMES:
        return KNOWN_PROVIDER_SCHEMES[norm]
    for slug, pair in KNOWN_PROVIDER_SCHEMES.items():
        if slug in norm or norm in slug:
            return pair
    return ("", "")


def get_legal_manager_name(provider: str, fallback: Optional[str] = None) -> str:
    """Returns the canonical NZ legal manager name for a provider slug or raw display name."""
    norm = normalize_provider(provider)
    if norm in PROVIDERS_BY_SLUG:
        return PROVIDERS_BY_SLUG[norm]["legal_name"]
    for slug, entry in PROVIDERS_BY_SLUG.items():
        if slug in norm:
            return entry["legal_name"]
    return fallback or provider


def get_provider_config() -> list[dict[str, Any]]:
    """Returns serializable provider configuration for Admin UI /api/config."""
    return [dict(p) for p in PROVIDER_DEFINITIONS]
