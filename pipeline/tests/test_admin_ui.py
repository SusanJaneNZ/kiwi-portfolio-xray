"""Unit tests for the local-only Admin Web UI backend service and HTTP routes."""

import json
import re
import shutil
import subprocess
import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from pipeline.admin_ui import AdminService, make_handler

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


class TestAdminUI(unittest.TestCase):
    """Test suite for AdminService and local HTTP endpoints."""

    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp())
        self.staging_dir = self.tmp_dir / "staging"
        self.output_dir = self.tmp_dir / "output"
        shutil.copytree(REPO_ROOT / "data" / "staging", self.staging_dir)

        self.service = AdminService(
            repo_root=REPO_ROOT,
            staging_dir=self.staging_dir,
            output_dir=self.output_dir,
        )
        # Isolate alias map, manual securities, and security master to temp dir so repo files stay untouched
        self.service.alias_map_path = self.tmp_dir / "company_alias_map.json"
        src_alias = REPO_ROOT / "pipeline" / "enrichment" / "company_alias_map.json"
        if not src_alias.exists():
            src_alias = REPO_ROOT / "pipeline" / "enrichment" / "provider_alias_map.json"
        shutil.copy(src_alias, self.service.alias_map_path)
        self.service.manual_securities_path = self.tmp_dir / "manual_securities.json"
        self.service.security_master_path = self.tmp_dir / "security_master.json"
        self.service.security_master_path.write_text(
            json.dumps([{"isin": "NZMCYE0001S8", "name": "Mercury NZ Limited", "ticker": "MCY.NZ"}]),
            encoding="utf-8",
        )
        self.service.feeder_registry_path = self.tmp_dir / "feeder_registry.json"
        shutil.copy(
            REPO_ROOT / "pipeline" / "feeder_registry.json",
            self.service.feeder_registry_path,
        )

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_upload_preview_and_delete(self):
        csv_content = "Company Name,Weighting (%)\nMercury NZ Ltd,50.0%\nCash,50.0%\n"
        uploaded = self.service.save_staged_file("kernel", "kernel_test_202611.csv", csv_content)
        self.assertEqual(uploaded["filename"], "kernel_test_202611.csv")

        listed = self.service.list_staged_files()
        filenames = [f["filename"] for f in listed["kernel"]]
        self.assertIn("kernel_test_202611.csv", filenames)

        preview = self.service.preview_staged_file("kernel", "kernel_test_202611.csv")
        self.assertEqual(preview["parse_summary"]["adapter"], "KernelAdapter")
        self.assertEqual(preview["parse_summary"]["status"], "ok")
        self.assertEqual(preview["parse_summary"]["parsed_count"], 1)

        self.assertTrue(self.service.delete_staged_file("kernel", "kernel_test_202611.csv"))
        self.assertFalse(self.service.delete_staged_file("kernel", "kernel_test_202611.csv"))

    def test_invalid_provider_rejected(self):
        with self.assertRaises(ValueError):
            self.service.save_staged_file("../../etc", "evil.csv", "a,b\n1,2\n")

    def test_alias_crud_and_search(self):
        aliases = self.service.set_alias_mapping("Kernel:KERNEL_NZ_50", "Test Corp", "NZTEST0001S1")
        self.assertEqual(aliases["Kernel:KERNEL_NZ_50"]["Test Corp"], "NZTEST0001S1")

        aliases_after = self.service.delete_alias_mapping("Kernel:KERNEL_NZ_50", "Test Corp")
        self.assertNotIn("Test Corp", aliases_after.get("Kernel:KERNEL_NZ_50", {}))

        matches = self.service.search_security_master("Mercury Limited")
        self.assertTrue(any("Mercury" in m["name"] for m in matches))

        # Verify audit_aliases detects linked vs unlinked IDs and suggests close candidates
        self.service.set_alias_mapping("Kernel:KERNEL_NZ_50", "Mercury Ltd", "NZWRONG0001")
        audit = self.service.audit_aliases()
        self.assertFalse(audit["Kernel:KERNEL_NZ_50"]["Mercury Ltd"]["in_security_master"])
        self.assertTrue(
            any(c["isin"] == "NZMCYE0001S8" for c in audit["Kernel:KERNEL_NZ_50"]["Mercury Ltd"]["candidates"])
        )

        # Verify bulk CSV import skips header and placeholder rows
        csv_payload = "scope,companyName,isin\nKernel:KERNEL_NZ_50,Mercury Ltd,NZMCYE0001S8\nKernel:KERNEL_NZ_50,Skip Me,INSERT_CANONICAL_ISIN\n"
        updated_map, saved_count = self.service.bulk_set_alias_mappings(csv_text=csv_payload)
        self.assertEqual(saved_count, 1)
        self.assertEqual(updated_map["Kernel:KERNEL_NZ_50"]["Mercury Ltd"], "NZMCYE0001S8")
        audit_after = self.service.audit_aliases()
        self.assertTrue(audit_after["Kernel:KERNEL_NZ_50"]["Mercury Ltd"]["in_security_master"])

    def test_feeder_registry_crud_and_validation(self):
        initial = self.service.get_feeder_registry()
        self.assertIn("TWF", initial)

        updated = self.service.set_feeder_pairing(
            feeder_code="twh",
            name="Smart Total World (NZD Hedged) ETF",
            master_provider="Vanguard",
            master_ticker="vt",
        )
        self.assertEqual(
            updated["TWH"],
            {
                "name": "Smart Total World (NZD Hedged) ETF",
                "master_provider": "vanguard",
                "master_ticker": "VT",
            },
        )

        with self.assertRaises(ValueError):
            self.service.set_feeder_pairing("TWH", "Bad Provider", "kernel", "VT")

        with self.assertRaises(ValueError):
            self.service.set_feeder_pairing("", "Missing Code", "vanguard", "VT")

        after_delete = self.service.delete_feeder_pairing("twh")
        self.assertNotIn("TWH", after_delete)

    def test_http_server_routes(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.service))
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/") as resp:
                self.assertEqual(resp.status, 200)
                html = resp.read().decode("utf-8")
                self.assertIn("Local Admin Console", html)

            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/staging") as resp:
                self.assertEqual(resp.status, 200)
                payload = json.loads(resp.read().decode("utf-8"))
                self.assertIn("smartshares", payload["files"])

            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/feeders") as resp:
                self.assertEqual(resp.status, 200)
                payload = json.loads(resp.read().decode("utf-8"))
                self.assertIn("TWF", payload["feeders"])

            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/aliases") as resp:
                self.assertEqual(resp.status, 200)
                payload = json.loads(resp.read().decode("utf-8"))
                self.assertIn("aliases", payload)
                self.assertIn("audit", payload)

            set_req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/feeders/set",
                data=json.dumps({
                    "feeder_code": "USM",
                    "name": "Smart US Mid Cap ETF",
                    "master_provider": "vanguard",
                    "master_ticker": "VO",
                }).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(set_req) as resp:
                self.assertEqual(resp.status, 200)
                payload = json.loads(resp.read().decode("utf-8"))
                self.assertEqual(payload["feeders"]["USM"]["master_ticker"], "VO")

            del_req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/feeders/delete",
                data=json.dumps({"feeder_code": "USM"}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(del_req) as resp:
                self.assertEqual(resp.status, 200)
                payload = json.loads(resp.read().decode("utf-8"))
                self.assertNotIn("USM", payload["feeders"])
            # 4. POST /api/pipeline/fetch with single fund_code
            fetch_req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/pipeline/fetch",
                data=json.dumps({"fund_code": "FNZ", "force": False}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(fetch_req) as resp:
                self.assertEqual(resp.status, 200)
                res = json.loads(resp.read().decode("utf-8"))
                self.assertIn("downloaded", res)
                self.assertIn("cached", res)
                self.assertIn("failed", res)
        finally:
            server.shutdown()
            server.server_close()

    def test_manual_security_country_sector_and_alias_link(self):
        saved_isin, manual = self.service.set_manual_security(
            isin="SEDOL:BQPGVF6",
            name="Arm Holdings plc ADR",
            ticker="ARM",
            country="United Kingdom",
            sector="Information Technology",
            scope_key="Kernel:KERNEL_WORLD_EX_US",
            raw_name="Arm Holdings plc ADR",
        )
        self.assertEqual(saved_isin, "SEDOL:BQPGVF6")
        self.assertEqual(manual["SEDOL:BQPGVF6"]["sector"], "Information Technology")

        audit = self.service.audit_aliases()
        arm_audit = audit["Kernel:KERNEL_WORLD_EX_US"]["Arm Holdings plc ADR"]
        self.assertTrue(arm_audit["in_security_master"])
        self.assertEqual(arm_audit["country"], "United Kingdom")
        self.assertEqual(arm_audit["sector"], "Information Technology")

        auto_isin, _ = self.service.set_manual_security(
            name="Unlisted Co Ltd",
            ticker="UCL",
            country="New Zealand",
            sector="Industrials",
        )
        self.assertEqual(auto_isin, "MANUAL:UCL")

        noisy = self.service.search_security_master("NYSE Class A Common Stock")
        self.assertEqual(noisy, [])
        exact = self.service.search_security_master("MCY")
        self.assertTrue(any(r["isin"] == "NZMCYE0001S8" for r in exact))

    def test_api_pipeline_fetch_endpoint(self):
        """POST /api/pipeline/fetch returns structured JSON with downloaded, cached, and failed lists."""
        handler = make_handler(self.service)
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        port = server.server_address[1]
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/pipeline/fetch",
                data=json.dumps({"providers": ["kernel"], "force": False}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req) as resp:
                self.assertEqual(resp.status, 200)
                payload = json.loads(resp.read().decode("utf-8"))
                self.assertIn("downloaded", payload)
                self.assertIn("cached", payload)
                self.assertIn("failed", payload)
                self.assertIsInstance(payload["failed"], list)
            # 4. POST /api/pipeline/fetch with single fund_code
            fetch_req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/pipeline/fetch",
                data=json.dumps({"fund_code": "FNZ", "force": False}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(fetch_req) as resp:
                self.assertEqual(resp.status, 200)
                res = json.loads(resp.read().decode("utf-8"))
                self.assertIn("downloaded", res)
                self.assertIn("cached", res)
                self.assertIn("failed", res)
        finally:
            server.shutdown()
            server.server_close()

    def test_fund_catalog_api_get_save_delete(self):
        """GET, POST save, and POST delete for /api/catalog."""
        handler = make_handler(self.service)
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        port = server.server_address[1]
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        try:
            # 1. GET /api/catalog
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/catalog") as resp:
                self.assertEqual(resp.status, 200)
                data = json.loads(resp.read().decode("utf-8"))
                self.assertIn("catalog", data)

            # 2. POST /api/catalog/save with URL parsing
            save_req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/catalog/save",
                data=json.dumps({
                    "fund_code": "KERNEL_TEST_NEW",
                    "fund_name": "Kernel Test New Fund",
                    "provider": "Kernel",
                    "fnd_code": "https://smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/SCH12697/OFR12698/FND99999/",
                }).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(save_req) as resp:
                self.assertEqual(resp.status, 200)
                saved = json.loads(resp.read().decode("utf-8"))
                self.assertTrue(saved.get("ok"))
                entry = next((c for c in saved["catalog"] if c["fund_code"] == "KERNEL_TEST_NEW"), None)
                self.assertIsNotNone(entry)
                self.assertEqual(entry["fnd_code"], "FND99999")
                self.assertEqual(entry["scheme_id"], "SCH12697")
                self.assertEqual(entry["offer_id"], "OFR12698")
                self.assertEqual(entry["status"], "AWAITING_PROCESSING")
                self.assertEqual(entry["constituent_count"], 0)
                self.assertEqual(entry["effective_date"], "")

            # 3. POST /api/catalog/delete
            del_req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/catalog/delete",
                data=json.dumps({"fund_code": "KERNEL_TEST_NEW"}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(del_req) as resp:
                self.assertEqual(resp.status, 200)
                deleted = json.loads(resp.read().decode("utf-8"))
                self.assertTrue(deleted.get("ok"))
                entry = next((c for c in deleted["catalog"] if c["fund_code"] == "KERNEL_TEST_NEW"), None)
                self.assertIsNone(entry)
            # 4. POST /api/pipeline/fetch with single fund_code
            fetch_req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/pipeline/fetch",
                data=json.dumps({"fund_code": "FNZ", "force": False}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(fetch_req) as resp:
                self.assertEqual(resp.status, 200)
                res = json.loads(resp.read().decode("utf-8"))
                self.assertIn("downloaded", res)
                self.assertIn("cached", res)
                self.assertIn("failed", res)
        finally:
            server.shutdown()
            server.server_close()

    def test_admin_ui_html_syntax_and_script_validity(self):
        """Verifies that admin_ui.html exists and all embedded <script> tags contain valid JavaScript with no syntax errors or duplicate declarations."""
        html_path = REPO_ROOT / "pipeline" / "admin_ui.html"
        self.assertTrue(html_path.exists(), "pipeline/admin_ui.html must exist")
        content = html_path.read_text(encoding="utf-8")
        self.assertGreater(len(content), 1000)

        scripts = re.findall(r"<script[\s\S]*?>([\s\S]*?)</script>", content, re.IGNORECASE)
        self.assertGreater(len(scripts), 0, "admin_ui.html must contain at least one <script> tag")

        for idx, script_body in enumerate(scripts):
            trimmed = script_body.strip()
            if not trimmed:
                continue
            proc = subprocess.run(
                ["node", "--input-type=module", "--check"],
                input=trimmed,
                text=True,
                capture_output=True,
            )
            self.assertEqual(
                proc.returncode,
                0,
                f"JavaScript syntax error in admin_ui.html <script> tag #{idx}:\n{proc.stderr}",
            )


if __name__ == "__main__":
    unittest.main()

