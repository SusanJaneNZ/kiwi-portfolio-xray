"""Automation script for processing crowdsourced fund requests from GitHub Issues."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Optional


def extract_metadata_from_text(title: str, body: str) -> dict[str, Any]:
    """Extracts structured fund registration metadata from an issue title and body."""
    meta: dict[str, Any] = {}

    # 1. Attempt extracting from JSON code block
    json_match = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", body)
    if json_match:
        try:
            parsed = json.loads(json_match.group(1))
            if isinstance(parsed, dict):
                meta.update(parsed)
        except Exception:
            pass

    # 2. Extract Smart Investor / Disclose URL
    url_match = re.search(
        r"(https?://(?:www\.)?smartinvestor\.sorted\.org\.nz/[^\s\)\>\]]+)",
        body,
        re.IGNORECASE,
    )
    if url_match:
        meta.setdefault("smart_investor_url", url_match.group(1).rstrip("/"))

    raw_url = meta.get("smart_investor_url", "")

    # 3. Extract SCH, OFR, FND from URL or text
    sch_m = re.search(r"(SCH\d+)", raw_url or body, re.IGNORECASE)
    ofr_m = re.search(r"(OFR\d+)", raw_url or body, re.IGNORECASE)
    fnd_m = re.search(r"(FND\d+)", raw_url or body, re.IGNORECASE)

    if sch_m:
        meta.setdefault("scheme_id", sch_m.group(1).upper())
    if ofr_m:
        meta.setdefault("offer_id", ofr_m.group(1).upper())
    if fnd_m:
        meta.setdefault("fnd_code", fnd_m.group(1).upper())

    # 4. Extract fund name and provider from title or markdown lines
    # Title pattern: [Fund Request] Fisher Funds KiwiSaver Growth Fund
    clean_title = re.sub(r"\[.*?\]", "", title).strip()
    if clean_title:
        meta.setdefault("fund_name", clean_title)

    for line in body.splitlines():
        line_clean = line.strip()
        m_name = re.match(r"^[\*\-]?\s*\*?\*?Fund Name:\*?\*?\s*(.+)$", line_clean, re.I)
        if m_name:
            meta["fund_name"] = m_name.group(1).strip()
            continue

        m_prov = re.match(r"^[\*\-]?\s*\*?\*?Provider:\*?\*?\s*(.+)$", line_clean, re.I)
        if m_prov:
            meta["provider"] = m_prov.group(1).strip()
            continue

        m_code = re.match(r"^[\*\-]?\s*\*?\*?Fund Code:\*?\*?\s*(.+)$", line_clean, re.I)
        if m_code:
            meta["fund_code"] = m_code.group(1).strip().upper()
            continue

        m_kiwi = re.match(r"^[\*\-]?\s*\*?\*?Is KiwiSaver:\*?\*?\s*(.+)$", line_clean, re.I)
        if m_kiwi:
            meta["is_kiwisaver"] = m_kiwi.group(1).strip().lower() in {"true", "yes", "1"}
            continue

    # Fallback provider detection
    name = meta.get("fund_name", "")
    if "provider" not in meta:
        for p in ("Fisher Funds", "Milford", "Simplicity", "Kernel", "ANZ", "ASB", "Westpac", "BNZ", "Booster", "Generate", "SuperLife"):
            if p.lower() in name.lower():
                meta["provider"] = p
                break
    meta.setdefault("provider", "KiwiSaver")

    # Generate fund code if missing
    if "fund_code" not in meta or not meta["fund_code"]:
        fnd = meta.get("fnd_code", "")
        slug = re.sub(r"[^A-Z0-9]+", "_", name.upper()).strip("_")
        meta["fund_code"] = f"{slug}_{fnd}" if fnd and fnd not in slug else (slug or f"FUND_{fnd}")

    meta["fund_code"] = re.sub(r"[^A-Z0-9_]", "_", meta["fund_code"].upper())
    meta.setdefault("is_etf", False)
    if "is_kiwisaver" not in meta:
        meta["is_kiwisaver"] = "kiwi" in (name + " " + title).lower()

    return meta


def update_catalog_file(catalog_path: Path, new_entry: dict[str, Any]) -> tuple[bool, str]:
    """Appends or updates fund_catalog.json with verified entry."""
    fnd_code = new_entry.get("fnd_code")
    fund_code = new_entry.get("fund_code")

    if not fnd_code:
        return False, "Missing required FND code (e.g. FND555)"
    if not fund_code:
        return False, "Missing required fund_code (e.g. FISHER_KIWISAVER_GROWTH)"

    if catalog_path.exists():
        try:
            catalog: list[dict[str, Any]] = json.loads(catalog_path.read_text(encoding="utf-8"))
        except Exception as e:
            return False, f"Failed to read catalog file: {e}"
    else:
        catalog = []

    provider_raw = str(new_entry.get("provider", "KiwiSaver")).strip()
    if provider_raw.upper() in {"ANZ", "ASB", "BNZ", "AMP", "ACC"}:
        clean_provider = provider_raw.upper()
    elif any(c.isupper() for c in provider_raw[1:]):
        clean_provider = provider_raw
    else:
        clean_provider = provider_raw.title()

    clean_item = {
        "fund_code": fund_code,
        "fund_name": new_entry.get("fund_name", fund_code.replace("_", " ").title()),
        "provider": clean_provider,
        "fnd_code": fnd_code,
        "scheme_id": new_entry.get("scheme_id", "SCH10713"),
        "offer_id": new_entry.get("offer_id", "OFR10715"),
        "is_etf": bool(new_entry.get("is_etf", False)),
        "is_kiwisaver": bool(new_entry.get("is_kiwisaver", True)),
    }

    # Check for existing match by fnd_code or fund_code
    idx = next(
        (
            i
            for i, c in enumerate(catalog)
            if c.get("fnd_code", "").upper() == fnd_code.upper()
            or c.get("fund_code", "").upper() == fund_code.upper()
        ),
        None,
    )

    action = "updated" if idx is not None else "added"
    if idx is not None:
        catalog[idx] = clean_item
    else:
        catalog.append(clean_item)

    catalog.sort(key=lambda x: (x.get("provider", ""), x.get("fund_name", "")))

    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = catalog_path.with_suffix(".tmp")
    temp_path.write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    temp_path.replace(catalog_path)

    return True, f"Successfully {action} '{clean_item['fund_name']}' ({clean_item['fund_code']}) in catalogue."


def main() -> int:
    parser = argparse.ArgumentParser(description="Process crowdsourced fund requests.")
    parser.add_argument("--title", type=str, default="", help="Issue title")
    parser.add_argument("--body", type=str, default="", help="Issue body content")
    parser.add_argument(
        "--catalog-path",
        type=Path,
        default=Path("pipeline/fund_catalog.json"),
        help="Path to fund_catalog.json",
    )
    args = parser.parse_args()

    title = args.title or os.environ.get("ISSUE_TITLE", "")
    body = args.body or os.environ.get("ISSUE_BODY", "")

    if not title and not body:
        print("Error: No issue title or body provided.", file=sys.stderr)
        return 1

    metadata = extract_metadata_from_text(title, body)
    print(f"Extracted Metadata:\n{json.dumps(metadata, indent=2)}")

    if not metadata.get("fnd_code"):
        print("::set-output name=success::false" if "GITHUB_OUTPUT" not in os.environ else "")
        print(f"Validation Error: Could not detect valid FND code from issue text:\n{body}", file=sys.stderr)
        return 1

    success, message = update_catalog_file(args.catalog_path, metadata)
    print(message)

    # Set GitHub Actions output if running in workflow
    gh_output = os.environ.get("GITHUB_OUTPUT")
    if gh_output and os.path.exists(gh_output):
        with open(gh_output, "a", encoding="utf-8") as f:
            f.write(f"success={'true' if success else 'false'}\n")
            f.write(f"fund_code={metadata.get('fund_code', '')}\n")
            f.write(f"fund_name={metadata.get('fund_name', '')}\n")
            f.write(f"fnd_code={metadata.get('fnd_code', '')}\n")

    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
