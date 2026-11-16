"""Fetcher for Sorted Smart Investor & Companies Office Disclose Register quarterly disclosures."""

from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

DEFAULT_USER_AGENT = "KiwiPortfolioXRay/1.0 (Retirement Portfolio Look-Through; +https://github.com/SusanJaneNZ/kiwi-portfolio-xray)"


@dataclass(frozen=True)
class DiscloseFundMeta:
    """Metadata contract for a Disclose Register / Sorted fund disclosure."""

    fund_id: str             # e.g., "FND1105"
    scheme_id: str           # e.g., "SCH10174"
    manager_name: str        # e.g., "Smartshares Limited"
    fund_name: str           # e.g., "Smartshares NZ Dividend ETF"
    holdings_url: str        # Direct download link to .xlsx / .csv
    filing_date: str         # Effective date (YYYY-MM-DD)
    target_code: str         # Internal app code (e.g., "DIV", "KERNEL_GLOBAL_100")
    provider: str            # "smartshares" | "kernel" | "simplicity"


# Seed catalog of core Kiwi retail retirement funds on Disclose Register / Smart Investor
KNOWN_FUND_CATALOG: tuple[DiscloseFundMeta, ...] = (
    # --- Smartshares Direct NZ/AU ETFs ---
    DiscloseFundMeta(
        fund_id="FND1105",
        scheme_id="SCH10174",
        manager_name="Smartshares Limited",
        fund_name="Smartshares NZ Dividend ETF",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND1105/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="DIV",
        provider="smartshares",
    ),
    DiscloseFundMeta(
        fund_id="FND1115",
        scheme_id="SCH10174",
        manager_name="Smartshares Limited",
        fund_name="Smartshares NZ Top 50 ETF",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND1115/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="FNZ",
        provider="smartshares",
    ),
    DiscloseFundMeta(
        fund_id="FND1114",
        scheme_id="SCH10174",
        manager_name="Smartshares Limited",
        fund_name="Smartshares NZ Top 10 ETF",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND1114/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="TNZ",
        provider="smartshares",
    ),
    DiscloseFundMeta(
        fund_id="FND1117",
        scheme_id="SCH10174",
        manager_name="Smartshares Limited",
        fund_name="Smartshares NZ Mid Cap ETF",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND1117/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="MDZ",
        provider="smartshares",
    ),
    DiscloseFundMeta(
        fund_id="FND1116",
        scheme_id="SCH10174",
        manager_name="Smartshares Limited",
        fund_name="Smartshares NZ Property ETF",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND1116/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="NPF",
        provider="smartshares",
    ),
    DiscloseFundMeta(
        fund_id="FND1103",
        scheme_id="SCH10174",
        manager_name="Smartshares Limited",
        fund_name="Smartshares NZ Bond ETF",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND1103/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="NZB",
        provider="smartshares",
    ),
    DiscloseFundMeta(
        fund_id="FND1101",
        scheme_id="SCH10174",
        manager_name="Smartshares Limited",
        fund_name="Smartshares Global Bond ETF",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND1101/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="GBF",
        provider="smartshares",
    ),
    DiscloseFundMeta(
        fund_id="FND14632",
        scheme_id="SCH10174",
        manager_name="Smartshares Limited",
        fund_name="Smartshares Global Aggregate Bond ETF",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND14632/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="AGG",
        provider="smartshares",
    ),
    DiscloseFundMeta(
        fund_id="FND1095",
        scheme_id="SCH10174",
        manager_name="Smartshares Limited",
        fund_name="Smartshares Australian Dividend ETF",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND1095/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="ASD",
        provider="smartshares",
    ),
    DiscloseFundMeta(
        fund_id="FND1096",
        scheme_id="SCH10174",
        manager_name="Smartshares Limited",
        fund_name="Smartshares Australian Financials ETF",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND1096/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="ASF",
        provider="smartshares",
    ),
    DiscloseFundMeta(
        fund_id="FND1097",
        scheme_id="SCH10174",
        manager_name="Smartshares Limited",
        fund_name="Smartshares Australian Mid Cap ETF",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND1097/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="MZY",
        provider="smartshares",
    ),
    DiscloseFundMeta(
        fund_id="FND19355",
        scheme_id="SCH10174",
        manager_name="Smartshares Limited",
        fund_name="Smartshares Australian Top 200 ETF",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND19355/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="AUS",
        provider="smartshares",
    ),
    # --- Smartshares Global Feeder Wrappers ---
    DiscloseFundMeta(
        fund_id="FND1112",
        scheme_id="SCH10174",
        manager_name="Smartshares Limited",
        fund_name="Smartshares Total World ETF",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND1112/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="TWF",
        provider="smartshares",
    ),
    DiscloseFundMeta(
        fund_id="FND1106",
        scheme_id="SCH10174",
        manager_name="Smartshares Limited",
        fund_name="Smartshares US 500 ETF",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND1106/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="USF",
        provider="smartshares",
    ),
    DiscloseFundMeta(
        fund_id="FND1100",
        scheme_id="SCH10174",
        manager_name="Smartshares Limited",
        fund_name="Smartshares Europe ETF",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND1100/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="EUF",
        provider="smartshares",
    ),
    DiscloseFundMeta(
        fund_id="FND1094",
        scheme_id="SCH10174",
        manager_name="Smartshares Limited",
        fund_name="Smartshares Asia Pacific ETF",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND1094/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="APA",
        provider="smartshares",
    ),
    DiscloseFundMeta(
        fund_id="FND1111",
        scheme_id="SCH10174",
        manager_name="Smartshares Limited",
        fund_name="Smartshares Emerging Markets ETF",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND1111/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="EMF",
        provider="smartshares",
    ),
    DiscloseFundMeta(
        fund_id="FND14633",
        scheme_id="SCH10174",
        manager_name="Smartshares Limited",
        fund_name="Smartshares Global Equities ESG ETF",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND14633/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="ESG",
        provider="smartshares",
    ),
    # --- Kernel Funds ---
    DiscloseFundMeta(
        fund_id="FND15841",
        scheme_id="SCH12697",
        manager_name="Kernel Wealth Limited",
        fund_name="Kernel NZ 20 Fund",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND15841/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="KERNEL_NZ_20",
        provider="kernel",
    ),
    DiscloseFundMeta(
        fund_id="FND23720",
        scheme_id="SCH12697",
        manager_name="Kernel Wealth Limited",
        fund_name="Kernel NZ 50 ESG Tilted Fund",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND23720/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="KERNEL_NZ_50",
        provider="kernel",
    ),
    DiscloseFundMeta(
        fund_id="FND19303",
        scheme_id="SCH12697",
        manager_name="Kernel Wealth Limited",
        fund_name="Kernel S&P Global 100 Fund",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND19303/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="KERNEL_GLOBAL_100",
        provider="kernel",
    ),
    DiscloseFundMeta(
        fund_id="FND40595",
        scheme_id="SCH12697",
        manager_name="Kernel Wealth Limited",
        fund_name="Kernel Balanced Fund",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND40595/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="KERNEL_BALANCED",
        provider="kernel",
    ),
    DiscloseFundMeta(
        fund_id="FND46942",
        scheme_id="SCH12697",
        manager_name="Kernel Wealth Limited",
        fund_name="Kernel NZ Bond Fund",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND46942/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="KERNEL_NZ_BOND",
        provider="kernel",
    ),
    DiscloseFundMeta(
        fund_id="FND58858",
        scheme_id="SCH12697",
        manager_name="Kernel Wealth Limited",
        fund_name="Kernel Conservative Fund",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND58858/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="KERNEL_CONSERVATIVE",
        provider="kernel",
    ),
    DiscloseFundMeta(
        fund_id="FND43023",
        scheme_id="SCH12697",
        manager_name="Kernel Wealth Limited",
        fund_name="Kernel Global ESG Fund",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND43023/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="KERNEL_GLOBAL_ESG",
        provider="kernel",
    ),
    DiscloseFundMeta(
        fund_id="FND37635",
        scheme_id="SCH12697",
        manager_name="Kernel Wealth Limited",
        fund_name="Kernel S&P Global Clean Energy Fund",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND37635/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="KERNEL_CLEAN_ENERGY",
        provider="kernel",
    ),
    DiscloseFundMeta(
        fund_id="FND37634",
        scheme_id="SCH12697",
        manager_name="Kernel Wealth Limited",
        fund_name="Kernel S&P Global Dividend Aristocrats Fund",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND37634/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="KERNEL_DIVIDEND_ARISTOCRATS",
        provider="kernel",
    ),
    DiscloseFundMeta(
        fund_id="FND58860",
        scheme_id="SCH12697",
        manager_name="Kernel Wealth Limited",
        fund_name="Kernel World Ex-US Fund",
        holdings_url="https://smartinvestor.sorted.org.nz/api/funds/FND58860/holdings.xlsx",
        filing_date="2026-09-30",
        target_code="KERNEL_WORLD_EX_US",
        provider="kernel",
    ),
)


class SmartInvestorFetcher:
    """Automated crawler and downloader for Disclose Register / Sorted fund disclosures."""

    def __init__(
        self,
        staging_dir: Path | None = None,
        catalog: Sequence[DiscloseFundMeta] = KNOWN_FUND_CATALOG,
        delay_seconds: float = 1.0,
        user_agent: str = DEFAULT_USER_AGENT,
        downloader: Optional[Callable[[str, str], bytes]] = None,
    ) -> None:
        self.staging_dir = staging_dir or Path("data/staging")
        self.catalog = list(catalog)
        self.delay_seconds = max(0.0, float(delay_seconds))
        self.user_agent = user_agent
        self._downloader = downloader or self._default_download

    @staticmethod
    def sanitize_filename(name: str) -> str:
        """Sanitizes strings for cross-platform safe file paths."""
        return re.sub(r"[^a-zA-Z0-9_\-]", "_", name)

    @staticmethod
    def validate_content(content: bytes) -> tuple[bool, str]:
        """Validates downloaded payload: minimum size and magic byte verification."""
        if len(content) < 1024:
            return False, f"Payload size ({len(content)} bytes) below 1KB minimum threshold"

        # Check for HTML error pages masquerading as valid downloads
        sample = content[:512].lower()
        if b"<!doctype html" in sample or b"<html" in sample:
            return False, "Payload contains HTML document (likely an error, login, or rate-limit page)"
        if sample.strip().startswith(b'{"error"') or sample.strip().startswith(b'{"message"'):
            return False, "Payload contains JSON error response"

        # Check magic bytes for XLSX/ZIP (PK\x03\x04), legacy XLS (OLE2), or CSV text
        if content.startswith(b"PK\x03\x04") or content.startswith(b"\xd0\xcf\x11\xe0"):
            return True, "Valid Excel/ZIP archive format"

        # Check for valid CSV text (UTF-8 or Windows-1252/Latin-1)
        for enc in ("utf-8", "latin-1", "cp1252"):
            try:
                sample_text = content[:2048].decode(enc)
                if "\n" in sample_text and ("," in sample_text or "\t" in sample_text or ";" in sample_text):
                    return True, f"Valid tabular CSV text format ({enc})"
            except UnicodeDecodeError:
                continue

        return False, "Payload does not match ZIP/XLSX or tabular CSV structure"

    def get_target_path(self, meta: DiscloseFundMeta) -> Path:
        """Returns the canonical staging file path for a fund disclosure."""
        clean_code = self.sanitize_filename(meta.target_code)
        clean_date = self.sanitize_filename(meta.filing_date)
        clean_fnd = self.sanitize_filename(meta.fund_id)
        # Standardized naming convention compatible with sorted_parser
        filename = f"{clean_code}_{clean_fnd}_{clean_date}.xlsx"
        return self.staging_dir / meta.provider / filename

    def fetch_fund(
        self,
        meta: DiscloseFundMeta,
        force: bool = False,
    ) -> tuple[bool, str, Optional[Path]]:
        """Downloads a single fund disclosure with atomic write and safety checks."""
        target_path = self.get_target_path(meta)
        target_path.parent.mkdir(parents=True, exist_ok=True)

        # 1. Skip if already cached on disk and force is not set
        if target_path.exists() and not force:
            if target_path.stat().st_size >= 1024:
                return True, f"Already cached on disk ({target_path.name})", target_path

        # Also check if existing legacy file exists for this fund code in staging
        if not force:
            existing_match = self._find_existing_staged_file(meta)
            if existing_match:
                return True, f"Found existing staged file ({existing_match.name})", existing_match

        # 2. Download from remote URL
        tmp_path = target_path.with_suffix(".tmp")
        try:
            content = self._downloader(meta.holdings_url, self.user_agent)
        except Exception as exc:
            logger.warning("Failed to fetch %s (%s): %s", meta.target_code, meta.holdings_url, exc)
            # If download fails, check if we have any existing file as fallback
            fallback = self._find_existing_staged_file(meta)
            if fallback:
                return True, f"Remote download failed ({exc}), fell back to existing staged file", fallback
            return False, f"Remote download failed: {exc}", None

        # 3. Validate content
        is_valid, reason = self.validate_content(content)
        if not is_valid:
            logger.warning("Invalid payload for %s: %s", meta.target_code, reason)
            fallback = self._find_existing_staged_file(meta)
            if fallback:
                return True, f"Remote payload invalid ({reason}), retained existing file", fallback
            return False, f"Invalid payload: {reason}", None

        # 4. Atomic write: write to .tmp, then replace target
        try:
            with open(tmp_path, "wb") as f:
                f.write(content)
            tmp_path.replace(target_path)
        except Exception as exc:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
            return False, f"Failed to commit file to disk: {exc}", None

        if self.delay_seconds > 0:
            time.sleep(self.delay_seconds)

        return True, f"Successfully downloaded and verified ({len(content)} bytes)", target_path

    def fetch_all(
        self,
        providers: Optional[Sequence[str]] = None,
        force: bool = False,
    ) -> dict[str, Any]:
        """Fetches disclosures for all funds matching the specified providers."""
        target_providers = {p.strip().lower() for p in providers} if providers else None

        results: dict[str, Any] = {
            "downloaded": [],
            "cached": [],
            "failed": [],
            "total_catalog": len(self.catalog),
        }

        for meta in self.catalog:
            if target_providers and meta.provider.lower() not in target_providers:
                continue

            success, message, path = self.fetch_fund(meta, force=force)
            entry = {
                "code": meta.target_code,
                "fund_id": meta.fund_id,
                "provider": meta.provider,
                "message": message,
                "path": str(path) if path else None,
            }
            if success:
                if "cached" in message or "existing" in message:
                    results["cached"].append(entry)
                else:
                    results["downloaded"].append(entry)
            else:
                results["failed"].append(entry)

        results["success"] = len(results["failed"]) == 0
        return results

    def _find_existing_staged_file(self, meta: DiscloseFundMeta) -> Optional[Path]:
        """Checks if a matching file already exists in the provider's staging directory."""
        provider_dir = self.staging_dir / meta.provider
        if not provider_dir.exists():
            return None

        # Look for fund_id or target_code in filenames
        target_upper = meta.target_code.upper()
        fnd_upper = meta.fund_id.upper()

        for f in provider_dir.iterdir():
            if not f.is_file() or f.suffix.lower() not in {".xlsx", ".csv"}:
                continue
            name_upper = f.name.upper()
            matches_fnd = fnd_upper in name_upper
            # Word/token boundary check so "AUS" does not match "AUSTRALIAN", and "DIV" does not match "DIVIDEND"
            matches_target = bool(re.search(rf"(?:^|[_\-\s]){re.escape(target_upper)}(?:[_\-\s.]|$)", name_upper))
            if matches_fnd or matches_target:
                if f.stat().st_size >= 1024:
                    return f
        return None

    def _default_download(self, url: str, user_agent: str) -> bytes:
        """Standard HTTP GET using urllib with user-agent and timeout."""
        req = Request(url, headers={"User-Agent": user_agent, "Accept": "*/*"})
        with urlopen(req, timeout=30) as resp:
            status = getattr(resp, "status", 200)
            if status != 200:
                raise HTTPError(url, status, f"HTTP status {status}", resp.headers, None)
            return resp.read()

