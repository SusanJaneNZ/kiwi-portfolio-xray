"""Fetcher for Sorted Smart Investor & Companies Office Disclose Register quarterly disclosures."""

from __future__ import annotations

import html as html_lib
import json
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
    holdings_url: str        # Direct download link to .xlsx / .csv or page URL
    filing_date: str         # Effective date (YYYY-MM-DD)
    target_code: str         # Internal app code (e.g., "DIV", "KERNEL_GLOBAL_100")
    provider: str            # "smartshares" | "kernel" | "simplicity"
    offer_id: str = ""       # e.g., "OFR12698"
    is_etf: bool = False


def get_default_catalog_path() -> Path:
    """Returns default path to pipeline/fund_catalog.json."""
    return Path(__file__).resolve().parent.parent / "fund_catalog.json"


def load_catalog(catalog_path: Path | None = None) -> list[DiscloseFundMeta]:
    """Loads fund metadata entries from fund_catalog.json or falls back to KNOWN_FUND_CATALOG."""
    path = catalog_path or get_default_catalog_path()
    if not path.exists():
        return list(KNOWN_FUND_CATALOG)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        metas = []
        for item in data:
            raw_provider = str(item.get("provider", "kernel")).strip()
            # Normalize provider to match staging directory conventions (e.g. "Fisher Funds" -> "fisher_funds")
            provider = re.sub(r"[\s\-]+", "_", raw_provider.lower())
            scheme_id = item.get("scheme_id") or ("SCH12697" if provider == "kernel" else "SCH10752")
            offer_id = item.get("offer_id") or ("OFR12698" if provider == "kernel" else "OFR10865")
            manager = item.get("manager_name")
            if not manager:
                if "kernel" in provider:
                    manager = "Kernel Wealth Limited"
                elif "fisher" in provider:
                    manager = "Fisher Funds Management Limited"
                elif "smartshares" in provider:
                    manager = "Smartshares Limited"
                elif "simplicity" in provider:
                    manager = "Simplicity NZ Limited"
                elif "milford" in provider:
                    manager = "Milford Funds Limited"
                elif "booster" in provider:
                    manager = "Booster Investment Management Limited"
                else:
                    manager = raw_provider

            fnd_code = str(item.get("fnd_code") or item.get("fund_id", "")).strip()
            holdings_url = str(item.get("holdings_url", "")).strip()
            if not holdings_url and fnd_code:
                holdings_url = f"https://smartinvestor.sorted.org.nz/api/funds/{fnd_code}/holdings.xlsx"

            metas.append(
                DiscloseFundMeta(
                    fund_id=fnd_code,
                    scheme_id=scheme_id,
                    manager_name=manager,
                    fund_name=item.get("fund_name", ""),
                    holdings_url=holdings_url,
                    filing_date=item.get("filing_date", "2026-09-30"),
                    target_code=item.get("fund_code") or item.get("target_code", ""),
                    provider=provider,
                    offer_id=offer_id,
                    is_etf=bool(item.get("is_etf", False)),
                )
            )
        return metas if metas else list(KNOWN_FUND_CATALOG)
    except Exception as exc:
        logger.warning("Failed to load fund catalog from %s: %s", path, exc)
        return list(KNOWN_FUND_CATALOG)


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
    # --- Kernel Funds (Verified Disclose Endpoints) ---
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
        catalog: Optional[Sequence[DiscloseFundMeta]] = None,
        catalog_path: Optional[Path] = None,
        delay_seconds: float = 1.0,
        user_agent: str = DEFAULT_USER_AGENT,
        downloader: Optional[Callable[[str, str], bytes]] = None,
    ) -> None:
        self.staging_dir = staging_dir or Path("data/staging")
        if catalog is not None:
            self.catalog = list(catalog)
        else:
            self.catalog = load_catalog(catalog_path)
        self.delay_seconds = max(0.0, float(delay_seconds))
        self.user_agent = user_agent
        self._downloader = downloader or self._default_download

    def resolve_holdings_url(self, meta: DiscloseFundMeta) -> Optional[str]:
        """Scrapes fund profile page to discover current live quarterly disclose document link."""
        if meta.holdings_url and "disclose-document/full-portfolio" in meta.holdings_url:
            return meta.holdings_url

        scheme = meta.scheme_id or ("SCH12697" if meta.provider.lower() == "kernel" else "SCH10752")
        offer = meta.offer_id or ("OFR12698" if meta.provider.lower() == "kernel" else "OFR10865")
        fnd = meta.fund_id.strip()

        page_url = f"https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/{scheme}/{offer}/{fnd}/"
        try:
            content = self._downloader(page_url, self.user_agent)
            html_text = content.decode("utf-8", errors="replace")
            m = re.search(
                r'href=[\"\']([^\"\']*disclose-document/full-portfolio/[^\"\']+\.xlsx)[\"\']',
                html_text,
                re.IGNORECASE,
            )
            if m:
                raw_link = html_lib.unescape(m.group(1))
                if raw_link.startswith("/"):
                    raw_link = f"https://www.smartinvestor.sorted.org.nz{raw_link}"
                return raw_link
        except Exception as exc:
            logger.debug("Failed to resolve live holdings link for %s: %s", meta.target_code, exc)
        return None

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
        provider_dir = re.sub(r"[\s\-]+", "_", meta.provider.strip().lower())
        return self.staging_dir / provider_dir / filename

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

        # 2. Download from remote URL (with automatic live resolution fallback)
        download_url = meta.holdings_url
        content = None
        last_exc: Optional[Exception] = None

        if download_url:
            try:
                content = self._downloader(download_url, self.user_agent)
            except Exception as exc:
                last_exc = exc
                logger.error(
                    "Direct download failed for %s (%s) from URL '%s': %s",
                    meta.target_code,
                    meta.fund_id,
                    download_url,
                    exc,
                    exc_info=True,
                )
                content = None

        if content is None:
            resolved = self.resolve_holdings_url(meta)
            if resolved and resolved != download_url:
                try:
                    content = self._downloader(resolved, self.user_agent)
                    download_url = resolved
                    last_exc = None
                except Exception as exc:
                    last_exc = exc
                    logger.error(
                        "Download from resolved URL '%s' failed for %s (%s): %s",
                        resolved,
                        meta.target_code,
                        meta.fund_id,
                        exc,
                        exc_info=True,
                    )
                    content = None

        if content is None:
            fallback = self._find_existing_staged_file(meta)
            if fallback:
                logger.info(
                    "Remote download failed (%s), fell back to existing staged file %s",
                    last_exc,
                    fallback.name,
                )
                return True, f"Remote download failed ({last_exc}), fell back to existing staged file ({fallback.name})", fallback
            err_detail = f": {type(last_exc).__name__}: {last_exc}" if last_exc else f": could not resolve valid endpoint for {meta.target_code} ({meta.fund_id})"
            msg = f"Remote download failed for {meta.target_code} ({meta.fund_id}) [URL: {download_url or 'None'}]{err_detail}"
            logger.error(msg)
            return False, msg, None

        # 3. Validate content
        is_valid, reason = self.validate_content(content)
        if not is_valid:
            logger.warning(
                "Invalid payload for %s (%s) from %s: %s",
                meta.target_code,
                meta.fund_id,
                download_url,
                reason,
            )
            fallback = self._find_existing_staged_file(meta)
            if fallback:
                return True, f"Remote payload invalid ({reason}), retained existing file ({fallback.name})", fallback
            return False, f"Invalid payload for {meta.target_code} ({meta.fund_id}) from {download_url}: {reason}", None

        # 4. Atomic write: write to .tmp, then replace target
        tmp_path = target_path.with_suffix(".tmp")
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
        """Checks if a matching file already exists in the provider's staging directory or related folders."""
        if not self.staging_dir.exists():
            return None

        norm_prov = re.sub(r"[\s\-]+", "_", meta.provider.strip().lower())
        candidate_dirs: list[Path] = [self.staging_dir / norm_prov]
        if norm_prov != meta.provider:
            candidate_dirs.append(self.staging_dir / meta.provider)
            candidate_dirs.append(self.staging_dir / meta.provider.replace("_", " "))

        # Also fallback to any existing subdirectory in staging_dir
        for p in self.staging_dir.iterdir():
            if p.is_dir() and p not in candidate_dirs:
                candidate_dirs.append(p)

        # Look for fund_id or target_code in filenames
        target_upper = meta.target_code.upper()
        fnd_upper = meta.fund_id.upper()

        for provider_dir in candidate_dirs:
            if not provider_dir.exists() or not provider_dir.is_dir():
                continue
            for f in provider_dir.iterdir():
                if not f.is_file() or f.suffix.lower() not in {".xlsx", ".csv"}:
                    continue
                name_upper = f.name.upper()
                matches_fnd = bool(fnd_upper and fnd_upper in name_upper)
                # Word/token boundary check so "AUS" does not match "AUSTRALIAN", and "DIV" does not match "DIVIDEND"
                matches_target = bool(
                    target_upper
                    and re.search(rf"(?:^|[_\-\s]){re.escape(target_upper)}(?:[_\-\s.]|$)", name_upper)
                )
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

