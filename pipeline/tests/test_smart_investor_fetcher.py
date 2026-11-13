"""Unit tests for the SmartInvestorFetcher crawler and downloader."""

import tempfile
import unittest
from pathlib import Path

from pipeline.fetchers.smart_investor_fetcher import (
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


if __name__ == "__main__":
    unittest.main()

