"""End-to-end integration test for the entire pipeline."""

import tempfile
import unittest
from pathlib import Path

from pipeline.output.build_output import PipelineCompiler

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


class TestPipelineEndToEnd(unittest.TestCase):
    """Integration test suite executing the complete pipeline flow."""

    def test_full_pipeline_compilation(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            staging_dir = tmp_path / "staging"
            output_dir = tmp_path / "public_data"

            for sub in ["directories", "vanguard", "ishares", "smartshares", "kernel"]:
                (staging_dir / sub).mkdir(parents=True, exist_ok=True)

            (staging_dir / "directories" / "nzx_directory.csv").write_text(
                "Rank,Ticker,Company Name,Country,Sector\n"
                "1,FPH,Fisher & Paykel Healthcare Corporation Limited,New Zealand,Healthcare\n"
                "2,MCY,Mercury NZ Limited,New Zealand,Utilities\n",
                encoding="utf-8",
            )
            (staging_dir / "directories" / "ASXListedCompanies.csv").write_text(
                "ASX listed companies as at Thu Nov 05 14:07:12 AEDT 2026\n"
                "Company name,ASX code,GICS industry group\n"
                '"BHP GROUP LIMITED","BHP","Materials"\n',
                encoding="utf-8",
            )
            (staging_dir / "vanguard" / "Holdings_details_VT.csv").write_text(
                "Holdings details\nTotal World Stock ETF (VT)\nEquity,as of 09/30/2026\n"
                ",SEDOL,HOLDINGS,TICKER,% OF FUNDS*,SUB-INDUSTRY,COUNTRY\n"
                ",2588173,Microsoft Corp,MSFT,50.00%,Systems Software,US\n"
                ",B0189V6,Vestas Wind Systems A/S,VWS,50.00%,Renewable Electricity,DK\n",
                encoding="utf-8",
            )
            (staging_dir / "smartshares" / "smartshares_TWF_202610.csv").write_text(
                "Asset name,% of fund net assets\n"
                "Vanguard Total World Stock ETF,97.5\n"
                "NZD Cash Account,1.5\n"
                "Foreign currency hedging contracts,1.0\n",
                encoding="utf-8",
            )
            (staging_dir / "smartshares" / "smartshares_FNZ_202610.csv").write_text(
                "Security Code,Security Description,Weighting (%)\n"
                "FPH,Fisher & Paykel Healthcare Corporation Limited,60.0%\n"
                "MCY,Mercury NZ Limited,38.5%\n"
                "NZD CASH,Cash and cash equivalents,1.5%\n",
                encoding="utf-8",
            )
            (staging_dir / "kernel" / "kernel_clean_energy_202610.csv").write_text(
                "Company Name,Weighting (%)\n"
                "Vestas Wind Systems A/S,98.8%\n"
                "Cash,1.2%\n",
                encoding="utf-8",
            )

            compiler = PipelineCompiler(
                staging_dir=staging_dir,
                output_dir=output_dir,
                repo_root=REPO_ROOT,
            )
            compiler.security_master_path = tmp_path / "security_master.json"

            report, summary = compiler.compile(dry_run=False)

            self.assertTrue(report.is_valid, f"Validation errors: {report.errors}")
            self.assertEqual(len(report.errors), 0)
            self.assertEqual(summary.get("total_funds_compiled"), 3)
            self.assertEqual(summary.get("total_unresolved_entries"), 0)

            self.assertTrue((output_dir / "funds_registry.json").exists())
            self.assertTrue((output_dir / "constituents.json").exists())
            self.assertTrue((output_dir / "direct_equities.json").exists())
            self.assertTrue((output_dir / "unresolved_entries.json").exists())
            self.assertTrue(compiler.security_master_path.exists())

            for fs in report.fund_summaries:
                self.assertAlmostEqual(fs["total_weight"], 1.0, delta=0.005)


if __name__ == "__main__":
    unittest.main()
