"""Unit tests for the SmartInvestorFetcher crawler and downloader."""

import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError

from pipeline.fetchers.smart_investor_fetcher import (
    KNOWN_FUND_CATALOG,
    DiscloseFundMeta,
    SmartInvestorFetcher,
)


class TestSmartInvestorFetcher(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.staging_dir = Path(self.temp_dir.name)
        self.sample_meta = DiscloseFundMeta(
            fund_id="FND1105",
            scheme_id="SCH10174",
            manager_name="Smartshares Limited",
            fund_name="Smartshares NZ Dividend ETF",
            holdings_url="https://mock.test/FND1105.xlsx",
            filing_date="2026-09-30",
            target_code="DIV",
            provider="smartshares",
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_content_validation_size_threshold(self) -> None:
        """Payloads under 1024 bytes are rejected."""
        valid, msg = SmartInvestorFetcher.validate_content(b"short payload")
        self.assertFalse(valid)
        self.assertIn("minimum threshold", msg)

    def test_content_validation_rejects_html_and_json_errors(self) -> None:
        """Rejects HTML error pages masquerading as file downloads."""
        html_payload = b"<!DOCTYPE html><html><body><h1>429 Rate Limit Exceeded</h1></body></html>" + (b" " * 1500)
        valid, msg = SmartInvestorFetcher.validate_content(html_payload)
        self.assertFalse(valid)
        self.assertIn("HTML", msg)

        json_payload = b'{"error": "Resource not found", "status": 404}' + (b" " * 1500)
        valid, msg = SmartInvestorFetcher.validate_content(json_payload)
        self.assertFalse(valid)
        self.assertIn("JSON error", msg)

    def test_content_validation_accepts_zip_magic_and_csv(self) -> None:
        """Accepts ZIP/XLSX PK\\x03\\x04 magic bytes and tabular CSV text."""
        xlsx_payload = b"PK\x03\x04" + (b"\x00" * 2000)
        valid, msg = SmartInvestorFetcher.validate_content(xlsx_payload)
        self.assertTrue(valid)
        self.assertIn("Excel/ZIP", msg)

        csv_payload = b"Security Name,ISIN,Weight\nCompany A,NZ0001,0.5\nCompany B,NZ0002,0.5\n" + (b" " * 1500)
        valid, msg = SmartInvestorFetcher.validate_content(csv_payload)
        self.assertTrue(valid)
        self.assertIn("CSV", msg)

    def test_sanitize_filename(self) -> None:
        """Removes path traversals, slashes, and special characters."""
        dirty = "../../Kernel S&P 500 / Global:Fund*1?"
        clean = SmartInvestorFetcher.sanitize_filename(dirty)
        self.assertNotIn("/", clean)
        self.assertNotIn("\\", clean)
        self.assertNotIn(":", clean)
        self.assertNotIn(" ", clean)

    def test_atomic_download_success(self) -> None:
        """Valid download writes atomically and leaves no temporary files."""
        fake_payload = b"PK\x03\x04" + (b"\x01" * 2000)

        def mock_downloader(url: str, ua: str) -> bytes:
            self.assertEqual(url, self.sample_meta.holdings_url)
            return fake_payload

        fetcher = SmartInvestorFetcher(
            staging_dir=self.staging_dir,
            catalog=[self.sample_meta],
            delay_seconds=0.0,
            downloader=mock_downloader,
        )

        ok, msg, path = fetcher.fetch_fund(self.sample_meta)
        self.assertTrue(ok)
        self.assertIsNotNone(path)
        self.assertTrue(path.exists())
        self.assertEqual(path.stat().st_size, len(fake_payload))

        # Ensure no leftover .tmp file
        tmp_path = path.with_suffix(".tmp")
        self.assertFalse(tmp_path.exists())

    def test_atomic_download_failure_retains_fallback(self) -> None:
        """Network error does not corrupt or wipe existing cached disclosure."""
        # Pre-populate valid staged file
        target = self.staging_dir / "smartshares" / "DIV_FND1105_2026-09-30.xlsx"
        target.parent.mkdir(parents=True, exist_ok=True)
        original_bytes = b"PK\x03\x04" + (b"\x09" * 1500)
        target.write_bytes(original_bytes)

        def failing_downloader(url: str, ua: str) -> bytes:
            raise ConnectionResetError("Connection refused by server")

        fetcher = SmartInvestorFetcher(
            staging_dir=self.staging_dir,
            catalog=[self.sample_meta],
            delay_seconds=0.0,
            downloader=failing_downloader,
        )

        # Force download to trigger downloader
        ok, msg, path = fetcher.fetch_fund(self.sample_meta, force=True)
        self.assertTrue(ok)
        self.assertIn("fell back to existing", msg)
        self.assertEqual(path, target)
        self.assertEqual(target.read_bytes(), original_bytes)

    def test_fetch_all_filters_by_provider(self) -> None:
        """fetch_all respects the requested providers filter."""
        meta_kernel = DiscloseFundMeta(
            fund_id="FND43023",
            scheme_id="SCH12739",
            manager_name="Kernel Wealth Limited",
            fund_name="Kernel Global ESG Fund",
            holdings_url="https://mock.test/FND43023.xlsx",
            filing_date="2026-09-30",
            target_code="KERNEL_GLOBAL_ESG",
            provider="kernel",
        )

        mock_payload = b"PK\x03\x04" + (b"\x05" * 2000)
        calls: list[str] = []

        def mock_downloader(url: str, ua: str) -> bytes:
            calls.append(url)
            return mock_payload

        fetcher = SmartInvestorFetcher(
            staging_dir=self.staging_dir,
            catalog=[self.sample_meta, meta_kernel],
            delay_seconds=0.0,
            downloader=mock_downloader,
        )

        res = fetcher.fetch_all(providers=["kernel"], force=True)
        self.assertTrue(res["success"])
        self.assertEqual(len(res["downloaded"]), 1)
        self.assertEqual(res["downloaded"][0]["code"], "KERNEL_GLOBAL_ESG")
        self.assertEqual(len(calls), 1)
        self.assertIn("FND43023", calls[0])

    def test_fetch_fund_handles_404_not_found(self) -> None:
        """HTTP 404 Not Found is handled cleanly without crashing or leaving partial files."""
        meta_404 = DiscloseFundMeta(
            fund_id="FND99999",
            scheme_id="SCH12697",
            manager_name="Kernel Wealth Limited",
            fund_name="Nonexistent Fund",
            holdings_url="https://mock.test/FND99999.xlsx",
            filing_date="2026-09-30",
            target_code="KERNEL_NONEXISTENT",
            provider="kernel",
        )

        def not_found_downloader(url: str, ua: str) -> bytes:
            raise HTTPError(url, 404, "HTTP Error 404: Not Found", {}, None)

        fetcher = SmartInvestorFetcher(
            staging_dir=self.staging_dir,
            catalog=[meta_404],
            delay_seconds=0.0,
            downloader=not_found_downloader,
        )

        ok, msg, path = fetcher.fetch_fund(meta_404, force=True)
        self.assertFalse(ok)
        self.assertIn("404", msg)
        self.assertIsNone(path)

        # Staging file and .tmp must not exist
        expected_path = fetcher.get_target_path(meta_404)
        self.assertFalse(expected_path.exists())
        self.assertFalse(expected_path.with_suffix(".tmp").exists())

    def test_fetch_all_segregates_404_failures_and_reports_summary(self) -> None:
        """Batch fetch isolates 404 failures and reports exact failed fund details."""
        valid_meta = self.sample_meta
        failing_meta_1 = DiscloseFundMeta(
            fund_id="FND15841",
            scheme_id="SCH12697",
            manager_name="Kernel Wealth Limited",
            fund_name="Kernel NZ 20 Fund",
            holdings_url="https://mock.test/FND15841.xlsx",
            filing_date="2026-09-30",
            target_code="KERNEL_NZ_20",
            provider="kernel",
        )
        failing_meta_2 = DiscloseFundMeta(
            fund_id="FND23720",
            scheme_id="SCH12697",
            manager_name="Kernel Wealth Limited",
            fund_name="Kernel NZ 50 ESG Tilted Fund",
            holdings_url="https://mock.test/FND23720.xlsx",
            filing_date="2026-09-30",
            target_code="KERNEL_NZ_50",
            provider="kernel",
        )

        valid_payload = b"PK\x03\x04" + (b"\x07" * 2000)

        def mock_downloader(url: str, ua: str) -> bytes:
            if "FND1105" in url:
                return valid_payload
            raise HTTPError(url, 404, "HTTP Error 404: Not Found", {}, None)

        fetcher = SmartInvestorFetcher(
            staging_dir=self.staging_dir,
            catalog=[valid_meta, failing_meta_1, failing_meta_2],
            delay_seconds=0.0,
            downloader=mock_downloader,
        )

        results = fetcher.fetch_all(force=True)
        self.assertFalse(results["success"])
        self.assertEqual(len(results["downloaded"]), 1)
        self.assertEqual(results["downloaded"][0]["code"], "DIV")
        self.assertEqual(len(results["failed"]), 2)

        failed_codes = {f["code"] for f in results["failed"]}
        self.assertEqual(failed_codes, {"KERNEL_NZ_20", "KERNEL_NZ_50"})
        for failure in results["failed"]:
            self.assertIn("404", failure["message"])

    def test_known_fund_catalog_metadata_contracts(self) -> None:
        """Every entry in KNOWN_FUND_CATALOG adheres to strict scheme and URL contracts."""
        self.assertGreater(len(KNOWN_FUND_CATALOG), 0)
        for fund in KNOWN_FUND_CATALOG:
            self.assertTrue(fund.fund_id.startswith("FND"), f"{fund.target_code} invalid fund_id: {fund.fund_id}")
            self.assertTrue(fund.scheme_id.startswith("SCH"), f"{fund.target_code} invalid scheme_id: {fund.scheme_id}")
            self.assertTrue(fund.holdings_url.startswith("https://"), f"{fund.target_code} invalid URL: {fund.holdings_url}")
            self.assertIn(fund.provider, {"smartshares", "kernel", "simplicity"}, f"Unknown provider: {fund.provider}")
            self.assertTrue(len(fund.target_code) > 0, "target_code must not be empty")

    def test_load_catalog_from_json_file(self) -> None:
        """load_catalog correctly parses JSON files into DiscloseFundMeta objects."""
        from pipeline.fetchers.smart_investor_fetcher import load_catalog
        import json

        catalog_file = Path(self.temp_dir.name) / "test_catalog.json"
        sample_data = [
            {
                "fund_code": "TEST_FUND",
                "fund_name": "Test Managed Fund",
                "provider": "Kernel",
                "fnd_code": "FND12345",
                "scheme_id": "SCH12697",
                "offer_id": "OFR12698",
                "is_etf": False,
            }
        ]
        catalog_file.write_text(json.dumps(sample_data), encoding="utf-8")

        metas = load_catalog(catalog_file)
        self.assertEqual(len(metas), 1)
        self.assertEqual(metas[0].target_code, "TEST_FUND")
        self.assertEqual(metas[0].fund_id, "FND12345")
        self.assertEqual(metas[0].provider, "kernel")
        self.assertFalse(metas[0].is_etf)

    def test_resolve_holdings_url_scrapes_live_link(self) -> None:
        """resolve_holdings_url scrapes the fund page HTML to extract disclose-document link."""
        meta = DiscloseFundMeta(
            fund_id="FND15841",
            scheme_id="SCH12697",
            manager_name="Kernel Wealth Limited",
            fund_name="Kernel NZ 20 Fund",
            holdings_url="",
            filing_date="2026-09-30",
            target_code="KERNEL_NZ_20",
            provider="kernel",
            offer_id="OFR12698",
        )

        mock_html = b"""
        <html>
          <body>
            <a href="https://www.smartinvestor.sorted.org.nz/disclose-document/full-portfolio/FND15841/KERNEL-NZ-20-FUND-FND15841-Full-portfolio-holdings-30-September-2026.xlsx">Download</a>
          </body>
        </html>
        """

        def mock_downloader(url: str, user_agent: str) -> bytes:
            return mock_html

        fetcher = SmartInvestorFetcher(staging_dir=self.staging_dir, downloader=mock_downloader)
        link = fetcher.resolve_holdings_url(meta)
        self.assertIsNotNone(link)
        self.assertIn("disclose-document/full-portfolio/FND15841", link)

    def test_load_catalog_normalizes_provider_and_constructs_holdings_url(self) -> None:
        """Catalog loader converts provider names with spaces to underscores and defaults direct API endpoints."""
        from pipeline.fetchers.smart_investor_fetcher import load_catalog
        import json

        custom_catalog = self.staging_dir / "custom_catalog.json"
        data = [
            {
                "fund_code": "FISHER_GROWTH",
                "fund_name": "Fisher Funds KiwiSaver Growth Fund",
                "provider": "Fisher Funds",
                "fnd_code": "FND555",
            }
        ]
        custom_catalog.write_text(json.dumps(data), encoding="utf-8")

        metas = load_catalog(custom_catalog)
        self.assertEqual(len(metas), 1)
        self.assertEqual(metas[0].provider, "fisher_funds")
        self.assertEqual(metas[0].holdings_url, "https://smartinvestor.sorted.org.nz/api/funds/FND555/holdings.xlsx")
        self.assertEqual(metas[0].manager_name, "Fisher Funds Management Limited")

    def test_fetch_fund_error_includes_url_and_diagnostics(self) -> None:
        """When download fails and no cached file exists, error includes code, fund ID, URL and exception info."""
        meta = DiscloseFundMeta(
            fund_id="FND99999",
            scheme_id="SCH10713",
            manager_name="Test Manager",
            fund_name="Test Fund",
            holdings_url="https://mock.test/api/funds/FND99999/holdings.xlsx",
            filing_date="2026-09-30",
            target_code="TEST_FAIL_FUND",
            provider="test_provider",
        )

        def mock_downloader(url: str, ua: str) -> bytes:
            raise ConnectionResetError("Connection refused by test mock")

        fetcher = SmartInvestorFetcher(staging_dir=self.staging_dir, downloader=mock_downloader)
        ok, msg, path = fetcher.fetch_fund(meta, force=True)
        self.assertFalse(ok)
        self.assertIsNone(path)
        self.assertIn("TEST_FAIL_FUND", msg)
        self.assertIn("FND99999", msg)
        self.assertIn("https://mock.test/api/funds/FND99999/holdings.xlsx", msg)
        self.assertIn("ConnectionResetError", msg)

    def test_find_existing_staged_file_matches_space_and_underscore_folders(self) -> None:
        """_find_existing_staged_file locates files in both underscored and spaced provider directories."""
        provider_dir = self.staging_dir / "fisher_funds"
        provider_dir.mkdir(parents=True, exist_ok=True)
        test_file = provider_dir / "FISHER_KIWISAVER_GROWTH_FND555_2026-09-30.xlsx"
        test_file.write_bytes(b"PK\x03\x04" + (b"\x00" * 2000))

        meta = DiscloseFundMeta(
            fund_id="FND555",
            scheme_id="SCH10713",
            manager_name="Fisher Funds",
            fund_name="Fisher Growth",
            holdings_url="",
            filing_date="2026-09-30",
            target_code="FISHER_KIWISAVER_GROWTH",
            provider="fisher funds",  # with space
        )

        fetcher = SmartInvestorFetcher(staging_dir=self.staging_dir)
        found = fetcher._find_existing_staged_file(meta)
        self.assertIsNotNone(found)
        self.assertEqual(found, test_file)


if __name__ == "__main__":
    unittest.main()

