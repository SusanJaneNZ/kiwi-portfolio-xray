"""Command-line entrypoint for the Kiwi Portfolio X-Ray data ingestion pipeline."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from pipeline.fetchers import SmartInvestorFetcher
from pipeline.output.build_output import PipelineCompiler


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest and unwrap fund portfolio disclosures.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate schemas and mappings without writing production files.",
    )
    parser.add_argument(
        "--fetch",
        action="store_true",
        help="Fetch latest fund disclosures from Sorted Smart Investor & Disclose Register before compiling.",
    )
    parser.add_argument(
        "--providers",
        type=str,
        default="",
        help="Comma-separated list of providers to fetch (e.g., 'smartshares,kernel'). Defaults to all.",
    )
    parser.add_argument(
        "--force-fetch",
        action="store_true",
        help="Force re-download of disclosures even if already cached on disk.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force write production files even if validation or circuit breaker warnings occurred.",
    )
    parser.add_argument(
        "--staging-dir",
        type=Path,
        default=Path("data/staging"),
        help="Path to the directory containing staging CSV files.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("public/data"),
        help="Path to output compiled JSON datasets.",
    )

    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parent.parent

    print("=================================================================")
    print(f"🥝 Kiwi Portfolio X-Ray Ingestion Pipeline ({'DRY-RUN' if args.dry_run else 'PRODUCTION BUILD'})")
    print("=================================================================")
    print(f"Staging Directory: {args.staging_dir}")
    print(f"Output Directory:  {args.output_dir}")
    print("-----------------------------------------------------------------")

    if args.fetch:
        providers = [p.strip() for p in args.providers.split(",") if p.strip()] or None
        print(f"📡 Fetching disclosures from Sorted Smart Investor ({'providers: ' + ', '.join(providers) if providers else 'all providers'})...")
        fetcher = SmartInvestorFetcher(staging_dir=args.staging_dir)
        fetch_res = fetcher.fetch_all(providers=providers, force=args.force_fetch)
        dl_count = len(fetch_res["downloaded"])
        cached_count = len(fetch_res["cached"])
        fail_count = len(fetch_res["failed"])
        print(f"   [FETCH RESULT] Downloaded: {dl_count} | Cached: {cached_count} | Failed: {fail_count}")
        if fail_count > 0:
            for err in fetch_res["failed"]:
                print(f"   [FETCH WARN] {err['provider']}:{err['code']} - {err['message']}", file=sys.stderr)
        print("-----------------------------------------------------------------")

    compiler = PipelineCompiler(
        staging_dir=args.staging_dir,
        output_dir=args.output_dir,
        repo_root=repo_root,
    )

    try:
        report, summary = compiler.compile(dry_run=args.dry_run, force=args.force)
    except Exception as e:
        print(f"[FATAL] Compilation aborted due to error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1

    sec_summary = summary.get("sec_master_summary", {})
    total_companies = sec_summary.get("total_known_companies", sec_summary.get("total_security_master_count", 0))
    print(f"[PASS] Known Companies Register Compiled: {total_companies} total companies")
    print(f"       - NZX Companies:       {sec_summary.get('nzx_count', 0)}")
    print(f"       - ASX Companies:       {sec_summary.get('asx_count', 0)}")
    print(f"       - Vanguard Global VT:  {sec_summary.get('vanguard_global_count', 0)}")
    print(f"       - Direct Equities Extracted: {sec_summary.get('direct_equities_count', 0)}")
    print(f"[PASS] Total Funds Compiled: {summary.get('total_funds_compiled', 0)}")

    for fs in report.fund_summaries:
        status_icon = "PASS" if abs(fs["total_weight"] - 1.0) <= 0.005 else "FAIL"
        print(
            f"       [{status_icon}] {fs['code']:<18} | Weight: {fs['total_weight']*100:.2f}% "
            f"(Equities: {fs['equity_weight']*100:.2f}%, Cash: {fs['cash_ratio']*100:.2f}%) "
            f"| Constituents: {fs['constituent_count']}"
        )

    unresolved_count = summary.get("total_unresolved_entries", 0)
    if unresolved_count > 0:
        print(f"[WARN] Unresolved holdings detected: {unresolved_count} items")
        for u in summary.get("unresolved_entries", [])[:5]:
            print(f"       - {u['provider']}:{u['fund_code']}: '{u['raw_name']}' ({u['reason']})")
        if unresolved_count > 5:
            print(f"       ... and {unresolved_count - 5} more items (see public/data/unresolved_entries.json)")
    else:
        print("[PASS] Unresolved holdings: 0 items (All constituents canonical)")

    build_errors = summary.get("build_errors", [])
    if build_errors:
        log_dest = "logged to pipeline/logs/build_errors.json" if not args.dry_run else "dry-run: logging to disk suppressed"
        print(f"[WARN] Circuit breaker caught {len(build_errors)} corrupt/unparseable files ({log_dest}):")
        for be in build_errors[:3]:
            print(f"       - {be.get('filename', be.get('file'))}: {be.get('error')}")

    if report.warnings:
        print(f"[WARN] Taxonomy warnings ({len(report.warnings)}):")
        for w in report.warnings[:3]:
            print(f"       - {w}")

    if not report.is_valid:
        print("-----------------------------------------------------------------")
        print(f"[FAIL] Pipeline Validation Failed with {len(report.errors)} errors:")
        for err in report.errors:
            print(f"       * {err}", file=sys.stderr)
        return 1

    print("-----------------------------------------------------------------")
    print(f"✨ Ingestion complete. Output status: {'DRY-RUN OK (no files written)' if args.dry_run else 'SUCCESS'}")
    print("=================================================================")
    return 0


if __name__ == "__main__":
    sys.exit(main())

