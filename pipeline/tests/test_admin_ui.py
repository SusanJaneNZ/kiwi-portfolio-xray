"""Unit tests for the local-only Admin Web UI backend service and HTTP routes."""

import json
import shutil
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
        # Isolate alias map and security master to temp dir so repo files stay untouched
        self.service.alias_map_path = self.tmp_dir / "provider_alias_map.json"
        shutil.copy(
            REPO_ROOT / "pipeline" / "enrichment" / "provider_alias_map.json",
            self.service.alias_map_path,
        )
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

        matches = self.service.search_security_master("Mercury")
        self.assertTrue(any("Mercury" in m["name"] for m in matches))

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
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()

