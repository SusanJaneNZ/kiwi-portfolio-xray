"""Local-only Admin Web UI for staging CSVs, previewing adapters, mapping aliases, and running builds."""

from __future__ import annotations

import argparse
import base64
import json
import sys
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from pipeline.adapters.disclose_register_adapter import DiscloseRegisterAdapter
from pipeline.adapters.ishares_adapter import ISharesAdapter
from pipeline.adapters.kernel_adapter import KernelAdapter
from pipeline.adapters.smartshares_direct_adapter import SmartsharesDirectAdapter
from pipeline.adapters.tabular_reader import read_tabular_rows
from pipeline.adapters.vanguard_adapter import VanguardAdapter
from pipeline.output.build_output import PipelineCompiler
from pipeline.security_master.build_security_master import (
    parse_asx_directory,
    parse_nzx_directory,
)

ALLOWED_PROVIDERS = {
    "directories",
    "smartshares",
    "disclose",
    "vanguard",
    "ishares",
    "kernel",
}


class AdminService:
    """Backend operations for the local Admin Web UI."""

    def __init__(self, repo_root: Path, staging_dir: Path | None = None, output_dir: Path | None = None):
        self.repo_root = repo_root
        self.staging_dir = staging_dir or (repo_root / "data" / "staging")
        self.output_dir = output_dir or (repo_root / "public" / "data")
        self.alias_map_path = repo_root / "pipeline" / "enrichment" / "provider_alias_map.json"
        self.security_master_path = repo_root / "pipeline" / "security_master" / "security_master.json"
        self.gics_mapping_path = repo_root / "pipeline" / "normalizer" / "gics_mapping.json"

    def list_staged_files(self) -> dict[str, list[dict[str, Any]]]:
        """Lists all CSV and XLSX files currently staged under each provider folder."""
        result: dict[str, list[dict[str, Any]]] = {}
        for provider in sorted(ALLOWED_PROVIDERS):
            p_dir = self.staging_dir / provider
            files: list[dict[str, Any]] = []
            if p_dir.exists():
                for f in sorted(p for p in p_dir.iterdir() if p.is_file() and p.suffix.lower() in {".csv", ".xlsx"}):
                    stat = f.stat()
                    files.append({
                        "filename": f.name,
                        "size_bytes": stat.st_size,
                        "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                    })
            result[provider] = files
        return result

    def save_staged_file(
        self,
        provider: str,
        filename: str,
        content: str = "",
        content_base64: str = "",
    ) -> dict[str, Any]:
        """Saves an uploaded CSV or XLSX file to data/staging/<provider>/<filename>."""
        if provider not in ALLOWED_PROVIDERS:
            raise ValueError(f"Invalid provider directory '{provider}'. Must be one of {sorted(ALLOWED_PROVIDERS)}.")

        safe_name = Path(filename).name.strip()
        if not safe_name or Path(safe_name).suffix.lower() not in {".csv", ".xlsx"}:
            raise ValueError("Filename must end with .csv or .xlsx")

        target_dir = self.staging_dir / provider
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / safe_name

        if content_base64:
            target_path.write_bytes(base64.b64decode(content_base64))
        else:
            target_path.write_text(content, encoding="utf-8")

        return {
            "provider": provider,
            "filename": safe_name,
            "size_bytes": target_path.stat().st_size,
        }

    def delete_staged_file(self, provider: str, filename: str) -> bool:
        """Deletes a CSV/XLSX file from data/staging/<provider>/<filename>."""
        if provider not in ALLOWED_PROVIDERS:
            raise ValueError(f"Invalid provider directory '{provider}'.")

        safe_name = Path(filename).name.strip()
        target_path = self.staging_dir / provider / safe_name
        if target_path.exists() and target_path.is_file():
            target_path.unlink()
            return True
        return False

    def preview_staged_file(self, provider: str, filename: str) -> dict[str, Any]:
        """Previews raw file lines (CSV or XLSX) and tests parsing with the matching Tier 1 adapter."""
        if provider not in ALLOWED_PROVIDERS:
            raise ValueError(f"Invalid provider directory '{provider}'.")

        safe_name = Path(filename).name.strip()
        target_path = self.staging_dir / provider / safe_name
        if not target_path.exists():
            raise FileNotFoundError(f"File not found: {provider}/{safe_name}")

        raw_lines: list[str] = []
        if target_path.suffix.lower() == ".xlsx":
            rows = read_tabular_rows(target_path)
            raw_lines = [" | ".join(r) for r in rows[:10]]
        else:
            with open(target_path, "r", encoding="utf-8-sig", errors="replace") as f:
                for _ in range(10):
                    line = f.readline()
                    if not line:
                        break
                    raw_lines.append(line.rstrip("\r\n"))

        parse_summary: dict[str, Any] = {"adapter": None, "status": "no_matching_adapter", "rows": []}

        if provider == "directories":
            gics_mapping = {}
            if self.gics_mapping_path.exists():
                gics_mapping = json.loads(self.gics_mapping_path.read_text(encoding="utf-8"))
            if "nzx" in safe_name.lower():
                recs = parse_nzx_directory(target_path, gics_mapping)
                parse_summary = {
                    "adapter": "NZX Directory Parser",
                    "status": "ok" if recs else "empty",
                    "parsed_count": len(recs),
                    "sample_rows": recs[:5],
                }
            elif "asx" in safe_name.lower():
                recs = parse_asx_directory(target_path, gics_mapping)
                parse_summary = {
                    "adapter": "ASX Directory Parser",
                    "status": "ok" if recs else "empty",
                    "parsed_count": len(recs),
                    "sample_rows": recs[:5],
                }
            return {"raw_lines": raw_lines, "parse_summary": parse_summary}

        if provider == "disclose":
            adapter = DiscloseRegisterAdapter()
            if adapter.can_handle(target_path):
                feeders = adapter.parse_all_feeders(target_path)
                parse_summary = {
                    "adapter": "DiscloseRegisterAdapter",
                    "status": "ok" if feeders else "empty",
                    "parsed_count": len(feeders),
                    "sample_rows": [
                        {
                            "feeder_code": fd.feeder_code,
                            "master_ticker": fd.master_ticker,
                            "master_allocation": fd.master_allocation,
                            "cash_ratio": fd.cash_ratio,
                            "hedging_ratio": fd.hedging_ratio,
                            "effective_date": fd.effective_date,
                        }
                        for fd in feeders
                    ],
                }
            return {"raw_lines": raw_lines, "parse_summary": parse_summary}

        adapter_map = {
            "vanguard": VanguardAdapter(),
            "ishares": ISharesAdapter(),
            "smartshares": SmartsharesDirectAdapter(),
            "kernel": KernelAdapter(),
        }
        adapter = adapter_map.get(provider)
        if adapter:
            can_handle = adapter.can_handle(target_path)
            if can_handle:
                res = adapter.parse(target_path)
                total_equity = sum(h.weight for h in res.holdings)
                parse_summary = {
                    "adapter": adapter.__class__.__name__,
                    "status": "ok" if res.holdings else "empty",
                    "fund_code": res.fund_code,
                    "fund_name": res.fund_name,
                    "effective_date": res.effective_date,
                    "cash_ratio": res.cash_ratio,
                    "parsed_count": len(res.holdings),
                    "total_equity_weight": round(total_equity, 4),
                    "sample_rows": [
                        {
                            "name": h.name,
                            "ticker": h.ticker,
                            "isin": h.isin,
                            "country": h.country,
                            "sector": h.sector,
                            "weight": round(h.weight, 6),
                        }
                        for h in res.holdings[:8]
                    ],
                }
            else:
                parse_summary = {
                    "adapter": adapter.__class__.__name__,
                    "status": "filename_not_recognized",
                    "hint": f"Rename file to include expected provider/fund code for {adapter.__class__.__name__}.",
                }

        return {"raw_lines": raw_lines, "parse_summary": parse_summary}

    def run_pipeline(self, dry_run: bool = True) -> dict[str, Any]:
        """Executes PipelineCompiler in dry-run or production build mode."""
        compiler = PipelineCompiler(
            staging_dir=self.staging_dir,
            output_dir=self.output_dir,
            repo_root=self.repo_root,
        )
        report, summary = compiler.compile(dry_run=dry_run)
        return {
            "dry_run": dry_run,
            "is_valid": report.is_valid,
            "errors": report.errors,
            "warnings": report.warnings,
            "fund_summaries": report.fund_summaries,
            "sec_master_summary": summary.get("sec_master_summary", {}),
            "total_funds_compiled": summary.get("total_funds_compiled", 0),
            "total_unresolved_entries": summary.get("total_unresolved_entries", 0),
            "unresolved_entries": summary.get("unresolved_entries", []),
        }

    def get_alias_map(self) -> dict[str, dict[str, str]]:
        """Loads provider_alias_map.json."""
        if not self.alias_map_path.exists():
            return {}
        return json.loads(self.alias_map_path.read_text(encoding="utf-8"))

    def set_alias_mapping(self, scope_key: str, raw_name: str, isin: str) -> dict[str, dict[str, str]]:
        """Adds or updates a single alias mapping in provider_alias_map.json."""
        scope = scope_key.strip()
        name = raw_name.strip()
        clean_isin = isin.strip().upper()
        if not scope or not name or not clean_isin:
            raise ValueError("scope_key, raw_name, and isin are all required.")

        alias_map = self.get_alias_map()
        alias_map.setdefault(scope, {})[name] = clean_isin
        self.alias_map_path.parent.mkdir(parents=True, exist_ok=True)
        self.alias_map_path.write_text(json.dumps(alias_map, indent=2) + "\n", encoding="utf-8")
        return alias_map

    def delete_alias_mapping(self, scope_key: str, raw_name: str) -> dict[str, dict[str, str]]:
        """Removes an alias mapping from provider_alias_map.json."""
        alias_map = self.get_alias_map()
        if scope_key in alias_map and raw_name in alias_map[scope_key]:
            del alias_map[scope_key][raw_name]
            if not alias_map[scope_key]:
                del alias_map[scope_key]
            self.alias_map_path.write_text(json.dumps(alias_map, indent=2) + "\n", encoding="utf-8")
        return alias_map

    def search_security_master(self, query: str, limit: int = 15) -> list[dict[str, Any]]:
        """Searches security_master.json by name, ticker, or ISIN."""
        if not self.security_master_path.exists():
            return []
        data = json.loads(self.security_master_path.read_text(encoding="utf-8"))
        q = query.strip().lower()
        if not q:
            return data[:limit]

        matches = [
            item
            for item in data
            if q in item.get("name", "").lower()
            or q in item.get("ticker", "").lower()
            or q in item.get("isin", "").lower()
        ]
        return matches[:limit]


def make_handler(service: AdminService) -> type[BaseHTTPRequestHandler]:
    """Creates a request handler class bound to the provided AdminService."""
    html_path = Path(__file__).with_name("admin_ui.html")

    class AdminHTTPHandler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            # Keep terminal output concise
            pass

        def _send_json(self, payload: Any, status: int = HTTPStatus.OK) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _read_json_body(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length > 0 else b"{}"
            return json.loads(raw.decode("utf-8"))

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path
            qs = parse_qs(parsed.query)

            try:
                if path == "/" or path == "/index.html":
                    content = html_path.read_bytes()
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(content)))
                    self.end_headers()
                    self.wfile.write(content)
                elif path == "/api/staging":
                    self._send_json({"files": service.list_staged_files()})
                elif path == "/api/staging/preview":
                    provider = qs.get("provider", [""])[0]
                    filename = qs.get("filename", [""])[0]
                    self._send_json(service.preview_staged_file(provider, filename))
                elif path == "/api/aliases":
                    self._send_json({"aliases": service.get_alias_map()})
                elif path == "/api/security-master":
                    q = qs.get("q", [""])[0]
                    self._send_json({"results": service.search_security_master(q)})
                else:
                    self._send_json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)
            except FileNotFoundError as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.NOT_FOUND)
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)

        def do_POST(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path

            try:
                data = self._read_json_body()
                if path == "/api/staging/upload":
                    res = service.save_staged_file(
                        provider=data.get("provider", ""),
                        filename=data.get("filename", ""),
                        content=data.get("content", ""),
                        content_base64=data.get("content_base64", ""),
                    )
                    self._send_json(res)
                elif path == "/api/staging/delete":
                    deleted = service.delete_staged_file(
                        provider=data.get("provider", ""),
                        filename=data.get("filename", ""),
                    )
                    self._send_json({"deleted": deleted})
                elif path == "/api/pipeline/run":
                    dry_run = bool(data.get("dry_run", True))
                    self._send_json(service.run_pipeline(dry_run=dry_run))
                elif path == "/api/aliases/set":
                    aliases = service.set_alias_mapping(
                        scope_key=data.get("scope_key", ""),
                        raw_name=data.get("raw_name", ""),
                        isin=data.get("isin", ""),
                    )
                    self._send_json({"aliases": aliases})
                elif path == "/api/aliases/delete":
                    aliases = service.delete_alias_mapping(
                        scope_key=data.get("scope_key", ""),
                        raw_name=data.get("raw_name", ""),
                    )
                    self._send_json({"aliases": aliases})
                else:
                    self._send_json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)

    return AdminHTTPHandler


def main() -> int:
    parser = argparse.ArgumentParser(description="Start the local-only Kiwi Portfolio X-Ray Admin Web UI.")
    parser.add_argument("--port", type=int, default=8787, help="Local HTTP port (default: 8787)")
    parser.add_argument("--staging-dir", type=Path, default=Path("data/staging"), help="Staging CSV directory")
    parser.add_argument("--output-dir", type=Path, default=Path("public/data"), help="Output JSON directory")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    staging_dir = args.staging_dir if args.staging_dir.is_absolute() else (repo_root / args.staging_dir)
    output_dir = args.output_dir if args.output_dir.is_absolute() else (repo_root / args.output_dir)

    service = AdminService(repo_root=repo_root, staging_dir=staging_dir, output_dir=output_dir)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(service))

    print("=================================================================")
    print("🥝 Kiwi Portfolio X-Ray — Local Admin UI")
    print("=================================================================")
    print(f"Open in browser: http://127.0.0.1:{args.port}")
    print(f"Staging dir:     {staging_dir}")
    print(f"Output dir:      {output_dir}")
    print("Press Ctrl+C to stop.")
    print("=================================================================")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping local Admin UI.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

