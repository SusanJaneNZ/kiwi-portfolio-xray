"""Unit tests for the PipelineCompiler per-fund circuit breaker."""

import json
import tempfile
import unittest
from pathlib import Path

from pipeline.output.build_output import PipelineCompiler


class TestCircuitBreaker(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.staging_dir = Path(self.temp_dir.name) / "staging"
        self.output_dir = Path(self.temp_dir.name) / "output"
        self.logs_dir = Path(self.temp_dir.name) / "logs"
        self.staging_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.repo_root = Path(__file__).resolve().parent.parent.parent

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_corrupt_file_does_not_abort_compiler(self) -> None:
        """A corrupt or unparseable workbook does not halt compilation of other funds."""
        smart_dir = self.staging_dir / "smartshares"
        smart_dir.mkdir(parents=True, exist_ok=True)

        corrupt_file = smart_dir / "SMART-NZ-DIVIDEND-ETF-FND1105-Corrupt.xlsx"
        corrupt_file.write_bytes(b"THIS IS NOT A VALID ZIP OR EXCEL FILE -- CORRUPT BYTES")

        compiler = PipelineCompiler(
            staging_dir=self.staging_dir,
            output_dir=self.output_dir,
            repo_root=self.repo_root,
        )
        compiler.logs_dir = self.logs_dir

        # Run compilation in dry-run mode
        report, summary = compiler.compile(dry_run=True)

        # Verify compiler caught error via circuit breaker without raising fatal exception
        build_errors = summary.get("build_errors", [])
        self.assertTrue(len(build_errors) >= 1)
        err_filenames = [be.get("filename") for be in build_errors]
        self.assertIn("SMART-NZ-DIVIDEND-ETF-FND1105-Corrupt.xlsx", err_filenames)

        # Verify circuit breaker warning is surfaced in report warnings
        cb_warnings = [w for w in report.warnings if "[CIRCUIT BREAKER]" in w]
        self.assertTrue(len(cb_warnings) >= 1)
        self.assertTrue(any("SMART-NZ-DIVIDEND-ETF-FND1105-Corrupt.xlsx" in w for w in cb_warnings))

    def test_production_mode_writes_errors_and_blocks_write_without_force(self) -> None:
        """Production mode persists build_errors.json and halts overwrite unless force=True."""
        smart_dir = self.staging_dir / "smartshares"
        smart_dir.mkdir(parents=True, exist_ok=True)

        corrupt_file = smart_dir / "SMART-NZ-DIVIDEND-ETF-FND1105-Corrupt.xlsx"
        corrupt_file.write_bytes(b"CORRUPT DATA FOR PRODUCTION RUN")

        compiler = PipelineCompiler(
            staging_dir=self.staging_dir,
            output_dir=self.output_dir,
            repo_root=self.repo_root,
        )
        compiler.logs_dir = self.logs_dir

        # Run compilation without force
        report, summary = compiler.compile(dry_run=False, force=False)
        self.assertFalse(report.is_valid)
        self.assertFalse(summary.get("files_written", False))

        # Check that build_errors.json was written to logs_dir
        errors_file = self.logs_dir / "build_errors.json"
        self.assertTrue(errors_file.exists())
        errors_data = json.loads(errors_file.read_text(encoding="utf-8"))
        self.assertEqual(len(errors_data), 1)
        self.assertIn("Corrupt", errors_data[0]["filename"])

        # Remove the corrupt file and verify clean run purges build_errors.json
        corrupt_file.unlink()
        report2, summary2 = compiler.compile(dry_run=False, force=False)
        self.assertFalse(errors_file.exists())


if __name__ == "__main__":
    unittest.main()
