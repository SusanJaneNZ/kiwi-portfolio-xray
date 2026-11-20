"""Fetcher for Sorted Smart Investor & Companies Office Disclose Register quarterly disclosures."""

from __future__ import annotations

import html as html_lib
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Callable, Optional, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

DEFAULT_USER_AGENT = "KiwiPortfolioXRay/1.0 (Retirement Portfolio Look-Through; +https://github.com/SusanJaneNZ/kiwi-portfolio-xray)"

MONTH_MAP = {
    "january": "01",
    "february": "02",
    "march": "03",
    "april": "04",
    "may": "05",
    "june": "06",
    "july": "07",
    "august": "08",
    "september": "09",
    "october": "10",
    "november": "11",
    "december": "12",
}


def extract_date_from_text(text: str) -> Optional[str]:
    """Extracts standardized YYYY-MM-DD from URLs or filenames."""
    if not text:
        return None
    # 1. ISO YYYY-MM-DD (e.g. 2026-09-30)
    m1 = re.search(r"(\d{4})[-_](\d{2})[-_](\d{2})", text)
    if m1:
        return f"{m1.group(1)}-{m1.group(2)}-{m1.group(3)}"
    # 2. DD-Month-YYYY (e.g. 30-September-2026 or 30September2026)
    m2 = re.search(r"(\d{1,2})[-_ ]*([a-zA-Z]+)[-_ ]*(\d{4})", text)
    if m2:
        day = int(m2.group(1))
        mon_str = m2.group(2).lower()
        year = m2.group(3)
        if mon_str in MONTH_MAP:
            return f"{year}-{MONTH_MAP[mon_str]}-{day:02d}"
    return None


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


from pipeline.providers import (
    KNOWN_PROVIDER_SCHEMES,
    get_default_scheme_offer,
    get_legal_manager_name,
    normalize_provider,
)


_QUARTER_ENDS: tuple[tuple[int, int, str], ...] = (
    (3, 31, "March"),
    (6, 30, "June"),
    (9, 30, "September"),
    (12, 31, "December"),
)


def recent_quarter_end_dates(count: int = 4, today: Optional[date] = None) -> list[str]:
    """Returns the most recent N calendar quarter-end dates formatted as 'DD-Month-YYYY'."""
    ref = today or date.today()
    candidates: list[tuple[date, str]] = []
    for yr in range(ref.year, ref.year - 3, -1):
        for month, day, month_name in reversed(_QUARTER_ENDS):
            q_date = date(yr, month, day)
            if q_date <= ref:
                candidates.append((q_date, f"{day:02d}-{month_name}-{yr}"))
                if len(candidates) >= count:
                    return [label for _, label in candidates]
    return [label for _, label in candidates]


def latest_quarter_end_iso(today: Optional[date] = None) -> str:
    """Returns the most recent calendar quarter-end date as 'YYYY-MM-DD'."""
    ref = today or date.today()
    for yr in range(ref.year, ref.year - 2, -1):
        for month, day, _ in reversed(_QUARTER_ENDS):
            q_date = date(yr, month, day)
            if q_date <= ref:
                return q_date.isoformat()
    return ref.isoformat()


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
            provider = normalize_provider(raw_provider)
            default_sch, default_ofr = get_default_scheme_offer(provider)
            scheme_id = item.get("scheme_id") or default_sch
            offer_id = item.get("offer_id") or default_ofr
            manager = item.get("manager_name") or get_legal_manager_name(provider, fallback=raw_provider)

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
        """Scrapes fund profile page to discover current live quarterly disclose document link, falling back to static URL."""
        default_sch, default_ofr = get_default_scheme_offer(meta.provider)
        scheme = meta.scheme_id or default_sch
        offer = meta.offer_id or default_ofr
        fnd = meta.fund_id.strip()

        if scheme and offer and fnd:
            page_url = f"https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/{scheme}/{offer}/{fnd}/"
            logger.info("Scraping fund profile page for %s (%s) at URL: %s", meta.target_code, meta.fund_id, page_url)
            try:
                content = self._downloader(page_url, self.user_agent)
                html_text = content.decode("utf-8", errors="replace")
                m = re.search(
                    r'href=[\"\']([^\"\']*disclose-document/full-portfolio/[^\"\']+\.xlsx(?:[^\s\"\'<>]*)?)[\"\']',
                    html_text,
                    re.IGNORECASE,
                )
                if m:
                    raw_link = html_lib.unescape(m.group(1))
                    if raw_link.startswith("/"):
                        raw_link = f"https://www.smartinvestor.sorted.org.nz{raw_link}"
                    logger.info("Discovered live disclosure link for %s (%s): %s", meta.target_code, meta.fund_id, raw_link)
                    return raw_link
            except Exception as exc:
                logger.info("Profile page scrape failed for %s (%s) at '%s': %s", meta.target_code, meta.fund_id, page_url, exc)
        else:
            logger.info("Skipping profile page scrape for %s (%s): missing verified scheme_id/offer_id", meta.target_code, meta.fund_id)

        if meta.holdings_url and "disclose-document/full-portfolio" in meta.holdings_url:
            return meta.holdings_url
        return None

    @staticmethod
    def get_url_variants(url: str) -> list[str]:
        """Expands URL variants for disclose documents when filename contains special characters like '/'."""
        if not url:
            return []
        m = re.match(r"^(https?://[^/]+/disclose-document/full-portfolio/[^/]+/)(.+)$", url)
        if not m:
            return [url]
        base, filename = m.groups()
        variants: list[str] = []
        if "/" in filename:
            # 1. Stripping the slash (Smart Investor publishes HTML with '/' but hosts files with slash stripped: S&P/NZX -> S&PNZX)
            v_stripped = base + filename.replace("/", "")
            variants.append(v_stripped)
            # 2. Encode '/' as '%2F'
            v_slash = base + filename.replace("/", "%2F")
            variants.append(v_slash)
            # 3. Fully quote filename characters
            v_quoted = base + quote(filename, safe="")
            if v_quoted not in variants:
                variants.append(v_quoted)
        if url not in variants:
            variants.append(url)
        return variants

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

    def get_target_path(self, meta: DiscloseFundMeta, filing_date: Optional[str] = None) -> Path:
        """Returns the canonical staging file path for a fund disclosure."""
        clean_code = self.sanitize_filename(meta.target_code)
        date_to_use = filing_date or meta.filing_date or "2026-09-30"
        clean_date = self.sanitize_filename(date_to_use)
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
        """Downloads a single fund disclosure with atomic write, automatic quarterly rollover, and safety checks."""
        # Check existing staged files
        existing_matches = self._find_all_staged_files(meta)
        latest_existing = existing_matches[0] if existing_matches else None
        latest_staged_date = extract_date_from_text(latest_existing.name) if latest_existing else None

        # 1. Determine remote date and candidate URLs
        download_url = meta.holdings_url
        resolved_live_url: Optional[str] = None
        remote_url_date = extract_date_from_text(download_url) if download_url else None

        # Only check live profile page if we already have an existing file on disk and need to compare quarter dates
        if latest_existing and not force and not remote_url_date:
            if not download_url or "api/funds" in download_url or "sorted.org.nz" in download_url:
                resolved_live_url = self.resolve_holdings_url(meta)
                if resolved_live_url:
                    remote_url_date = extract_date_from_text(resolved_live_url)

        # 2. Check if local staged file is already up to date (when force=False)
        if latest_existing and not force:
            if remote_url_date and latest_staged_date:
                if latest_staged_date >= remote_url_date:
                    return True, f"Already up-to-date ({latest_existing.name})", latest_existing
                else:
                    logger.info(
                        "Newer quarterly disclosure detected for %s (%s > %s). Proceeding to download.",
                        meta.target_code,
                        remote_url_date,
                        latest_staged_date,
                    )
            elif not remote_url_date and latest_existing.stat().st_size >= 1024:
                return True, f"Found existing staged file ({latest_existing.name})", latest_existing

        # 3. Download from remote URL candidates
        content = None
        last_exc: Optional[Exception] = None
        urls_attempted: list[str] = []

        if download_url:
            for curl in self.get_url_variants(download_url):
                urls_attempted.append(curl)
                logger.info("Attempting direct download for %s (%s) from URL: %s", meta.target_code, meta.fund_id, curl)
                try:
                    content = self._downloader(curl, self.user_agent)
                    download_url = curl
                    last_exc = None
                    break
                except Exception as exc:
                    last_exc = exc
                    logger.warning(
                        "Direct download failed for %s (%s) from URL '%s': %s",
                        meta.target_code,
                        meta.fund_id,
                        curl,
                        exc,
                    )
                    content = None

        if content is None:
            resolved = resolved_live_url or self.resolve_holdings_url(meta)
            if resolved:
                for rurl in self.get_url_variants(resolved):
                    if rurl in urls_attempted:
                        continue
                    urls_attempted.append(rurl)
                    logger.info("Attempting download from resolved live URL for %s (%s): %s", meta.target_code, meta.fund_id, rurl)
                    try:
                        content = self._downloader(rurl, self.user_agent)
                        download_url = rurl
                        last_exc = None
                        break
                    except Exception as exc:
                        last_exc = exc
                        logger.warning(
                            "Download from resolved URL '%s' failed for %s (%s): %s",
                            rurl,
                            meta.target_code,
                            meta.fund_id,
                            exc,
                        )
                        content = None

        if content is None and meta.fund_id:
            clean_fnd = meta.fund_id.strip().upper()
            slugs: list[str] = []
            if meta.fund_name:
                name_clean = re.sub(r"[^A-Za-z0-9]+", "-", meta.fund_name.strip()).strip("-").upper()
                if name_clean:
                    slugs.append(name_clean)
                short_name = re.sub(r"^(SIMPLICITY|SMART|KERNEL|FISHER[\s_]+FUNDS)[\s_]+", "", meta.fund_name.strip(), flags=re.IGNORECASE).strip()
                short_clean = re.sub(r"[^A-Za-z0-9]+", "-", short_name).strip("-").upper()
                if short_clean and short_clean not in slugs:
                    slugs.append(short_clean)
            candidate_dates = recent_quarter_end_dates(4)
            for slug in slugs:
                for qdate in candidate_dates:
                    durl = f"https://www.smartinvestor.sorted.org.nz/disclose-document/full-portfolio/{clean_fnd}/{slug}-{clean_fnd}-Full-portfolio-holdings-{qdate}.xlsx"
                    for vurl in self.get_url_variants(durl):
                        if vurl in urls_attempted:
                            continue
                        urls_attempted.append(vurl)
                        logger.info("Attempting download from derived candidate URL for %s (%s): %s", meta.target_code, meta.fund_id, vurl)
                        try:
                            content = self._downloader(vurl, self.user_agent)
                            download_url = vurl
                            last_exc = None
                            break
                        except Exception as exc:
                            last_exc = exc
                            content = None
                    if content is not None:
                        break
                if content is not None:
                    break

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
            attempted_str = " | ".join(urls_attempted) if urls_attempted else (download_url or "None")
            msg = f"Remote download failed for {meta.target_code} ({meta.fund_id}) [URL: {attempted_str}]{err_detail}"
            logger.error(msg)
            return False, msg, None

        # 4. Validate content
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

        # 5. Determine target file path based on effective filing date
        effective_date = (
            extract_date_from_text(download_url)
            or remote_url_date
            or meta.filing_date
            or "2026-09-30"
        )
        target_path = self.get_target_path(meta, filing_date=effective_date)
        target_path.parent.mkdir(parents=True, exist_ok=True)

        # 6. Atomic write: write to .tmp, then replace target
        tmp_path = target_path.with_suffix(".tmp")
        try:
            with open(tmp_path, "wb") as f:
                f.write(content)
            tmp_path.replace(target_path)
        except Exception as exc:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
            return False, f"Failed to commit file to disk: {exc}", None

        # 7. Clean up older/superseded disclosure files for this fund
        target_resolved = target_path.resolve()
        for old_file in self._find_all_staged_files(meta):
            try:
                if old_file.resolve() != target_resolved:
                    old_file.unlink(missing_ok=True)
                    logger.info("Removed superseded disclosure file: %s (replaced by %s)", old_file.name, target_path.name)
            except Exception as exc:
                logger.warning("Could not remove superseded file %s: %s", old_file.name, exc)

        if self.delay_seconds > 0:
            time.sleep(self.delay_seconds)

        return True, f"Successfully downloaded and verified ({len(content)} bytes)", target_path

    def fetch_all(
        self,
        providers: Optional[Sequence[str]] = None,
        force: bool = False,
    ) -> dict[str, Any]:
        """Fetches disclosures for all funds matching the specified providers."""
        target_providers = (
            {re.sub(r"[\s\-]+", "_", p.strip().lower()) for p in providers}
            if providers
            else None
        )

        results: dict[str, Any] = {
            "downloaded": [],
            "cached": [],
            "failed": [],
            "total_catalog": len(self.catalog),
        }

        for meta in self.catalog:
            meta_prov = re.sub(r"[\s\-]+", "_", meta.provider.lower())
            if target_providers and meta_prov not in target_providers:
                continue

            success, message, path = self.fetch_fund(meta, force=force)
            entry = {
                "code": meta.target_code,
                "fund_id": meta.fund_id,
                "provider": meta.provider,
                "url": meta.holdings_url,
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

    def _find_all_staged_files(self, meta: DiscloseFundMeta) -> list[Path]:
        """Finds all matching staged files for this fund, sorted newest first by date."""
        if not self.staging_dir.exists():
            return []

        norm_prov = re.sub(r"[\s\-]+", "_", meta.provider.strip().lower())
        candidate_dirs: list[Path] = [self.staging_dir / norm_prov]
        if norm_prov != meta.provider:
            candidate_dirs.append(self.staging_dir / meta.provider)
            candidate_dirs.append(self.staging_dir / meta.provider.replace("_", " "))

        # Also fallback to any existing subdirectory in staging_dir
        for p in self.staging_dir.iterdir():
            if p.is_dir() and p not in candidate_dirs:
                candidate_dirs.append(p)

        target_upper = meta.target_code.upper()
        fnd_upper = meta.fund_id.upper()
        matches: list[Path] = []

        for provider_dir in candidate_dirs:
            if not provider_dir.exists() or not provider_dir.is_dir():
                continue
            for f in provider_dir.iterdir():
                if not f.is_file() or f.suffix.lower() not in {".xlsx", ".csv"}:
                    continue
                name_upper = f.name.upper()
                file_fnds = re.findall(r"FND\d+", name_upper)

                # Strict FND check: if the file has an FND code, it MUST match the fund's FND code
                if fnd_upper and file_fnds:
                    if fnd_upper in file_fnds:
                        if f.stat().st_size >= 1024:
                            matches.append(f)
                    # Disqualify: this file belongs to a different FND code (e.g. hedged variant)
                    continue

                if fnd_upper and fnd_upper in name_upper:
                    if f.stat().st_size >= 1024:
                        matches.append(f)
                    continue

                # Word/token boundary check for target_code (only if file has no conflicting FND code)
                if not file_fnds and target_upper:
                    pattern = rf"(?:^|[_\-\s]){re.escape(target_upper)}(?:[_\-\s.]|$)"
                    if re.search(pattern, name_upper):
                        if f.stat().st_size >= 1024:
                            matches.append(f)

        def sort_key(p: Path) -> tuple[str, str]:
            d = extract_date_from_text(p.name) or "0000-00-00"
            return (d, p.name)

        matches.sort(key=sort_key, reverse=True)
        return matches

    def _find_existing_staged_file(self, meta: DiscloseFundMeta) -> Optional[Path]:
        """Checks if a matching file already exists in the provider's staging directory, returning the newest."""
        files = self._find_all_staged_files(meta)
        return files[0] if files else None

    def _default_download(self, url: str, user_agent: str) -> bytes:
        """Standard HTTP GET using urllib with user-agent and timeout."""
        req = Request(url, headers={"User-Agent": user_agent, "Accept": "*/*"})
        with urlopen(req, timeout=30) as resp:
            status = getattr(resp, "status", 200)
            if status != 200:
                raise HTTPError(url, status, f"HTTP status {status}", resp.headers, None)
            return resp.read()

