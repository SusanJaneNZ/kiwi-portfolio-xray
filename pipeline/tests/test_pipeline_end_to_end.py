"""End-to-end integration test for the entire pipeline."""

import unittest
from pathlib import Path

from pipeline.output.build_output import PipelineCompiler

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
STAGING_DIR = REPO_ROOT / "data" / "staging"
OUTPUT_DIR = REPO_ROOT / "public" / "data"


class TestPipelineEndToEnd(unittest.TestCase):
    """Integration test suite executing the complete pipeline flow."""

    def test_full_pipeline_compilation(self):
        compiler = PipelineCompiler(
            staging_dir=STAGING_DIR,
            output_dir=OUTPUT_DIR,
            repo_root=REPO_ROOT,
        )

        report, summary = compiler.compile(dry_run=False)

        # 1. Pipeline validation should pass
        self.assertTrue(report.is_valid, f"Validation errors: {report.errors}")
        self.assertEqual(len(report.errors), 0)

        # 2. Check compiled funds
        total_funds = summary.get("total_funds_compiled", 0)
        self.assertGreaterEqual(total_funds, 4)

        # 3. Check generated files exist on disk
        self.assertTrue((OUTPUT_DIR / "funds_registry.json").exists())
        self.assertTrue((OUTPUT_DIR / "constituents.json").exists())
        self.assertTrue((OUTPUT_DIR / "direct_equities.json").exists())
        self.assertTrue((OUTPUT_DIR / "unresolved_entries.json").exists())

        # 4. Check all funds in report have total_weight == 1.0 +- 0.005
        for fs in report.fund_summaries:
            self.assertAlmostEqual(fs["total_weight"], 1.0, delta=0.005)


if __name__ == "__main__":
    unittest.main()

