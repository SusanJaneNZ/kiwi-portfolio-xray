"""Unit tests for Tier 1 holding extraction adapters."""

import tempfile
import unittest
from pathlib import Path

from pipeline.adapters.disclose_register_adapter import DiscloseRegisterAdapter
from pipeline.adapters.ishares_adapter import ISharesAdapter
from pipeline.adapters.kernel_adapter import KernelAdapter
from pipeline.adapters.smartshares_direct_adapter import SmartsharesDirectAdapter
from pipeline.adapters.vanguard_adapter import VanguardAdapter

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
STAGING_DIR = REPO_ROOT / "data" / "staging"


class TestAdapters(unittest.TestCase):
    """Test suite for provider-specific constituent adapters."""

    def test_vanguard_adapter(self):
        csv_text = (
            "Holdings details\n\n"
            "Total World Stock ETF (VT)\n\n\n"
            "Equity,as of 09/30/2026\n\n"
            ",SEDOL,HOLDINGS,TICKER,% OF FUNDS*,SUB-INDUSTRY,COUNTRY,SECURITYDEPOSITORYRECEIPTTYPE,MARKET VALUE*,SHARES\n"
            ',2379504,NVIDIA Corp,NVDA,4.52%,Semiconductors,US,---,"$4,620,328,602.78","20,230,881"\n'
            ',2046251,Apple Inc,AAPL,4.08%,"Technology Hardware, Storage & Peripherals",US,---,"$4,175,554,285.98","12,538,449"\n'
            ',---,Other Equity,MISC,91.40%,Application Software,US,---,"$100.00","1"\n'
            "Fixed income,as of 09/30/2026\n"
            "Short-term reserves,as of 09/30/2026\n"
            ",SEDOL,HOLDINGS,TICKER,% OF FUNDS*,MARKET VALUE*\n"
            ',---,US Dollar,USD,0.05%,"$1,000.00"\n'
        )
        adapter = VanguardAdapter()
        with tempfile.TemporaryDirectory() as tmp:
            vanguard_dir = Path(tmp) / "vanguard"
            vanguard_dir.mkdir()
            vt_file = vanguard_dir / "Holdings_details_Total_World_Stock_ETF.csv"
            vt_file.write_text(csv_text, encoding="utf-8")

            self.assertTrue(adapter.can_handle(vt_file))
            res = adapter.parse(vt_file)

            self.assertEqual(res.fund_code, "VT")
            self.assertEqual(res.provider, "Vanguard")
            self.assertEqual(res.effective_date, "2026-09-30")
            self.assertTrue(res.is_master)
            # Only the 3 Equity rows ingested; Fixed income / Short-term reserves / USD cash stopped cleanly
            self.assertEqual(len(res.holdings), 3)

            total_weight = sum(h.weight for h in res.holdings)
            self.assertAlmostEqual(total_weight, 1.0, places=3)

            nvda = next(h for h in res.holdings if h.ticker == "NVDA")
            self.assertEqual(nvda.isin, "SEDOL:2379504")
            self.assertEqual(nvda.sector, "Semiconductors")
            self.assertEqual(nvda.country, "US")

    def test_vanguard_real_world_export_edge_cases(self):
        csv_text = (
            "Fund Name: Vanguard Total World Stock ETF\n"
            "As of 10/31/2026\n"
            "\n"
            "Ticker,Holdings,% of funds,Sector,Country,SEDOL\n"
            "MSFT,Microsoft Corp,4.00,Information Technology,United States,2588173\n"
            "FPH,Fisher & Paykel Healthcare Corp,0.50,Health Care,New Zealand,\n"
            "TINY,Small Cap Co,<0.01%,Industrials,Japan,\n"
            ",Short-term reserves,0.20,,,\n"
            "Total,,100.00,,,\n"
        )
        adapter = VanguardAdapter()
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "Holdings_details_Total_World_Stock_ETF.csv"
            p.write_text(csv_text, encoding="utf-8")
            self.assertTrue(adapter.can_handle(p))

            res = adapter.parse(p)
            self.assertEqual(res.fund_code, "VT")
            self.assertEqual(res.effective_date, "2026-10-31")
            # Reserves & Total skipped -> 3 equity holdings
            self.assertEqual(len(res.holdings), 3)

            by_ticker = {h.ticker: h for h in res.holdings}
            # Critical check: 0.50% is 1/8th of 4.00% (NOT 50%!)
            ratio = by_ticker["MSFT"].weight / by_ticker["FPH"].weight
            self.assertAlmostEqual(ratio, 8.0, places=2)
            self.assertEqual(by_ticker["MSFT"].isin, "SEDOL:2588173")
            self.assertEqual(by_ticker["FPH"].isin, "VANG:FPH")

    def test_smartshares_direct_adapter(self):
        fnz_file = STAGING_DIR / "smartshares" / "smartshares_FNZ_202610.csv"
        adapter = SmartsharesDirectAdapter()
        self.assertTrue(adapter.can_handle(fnz_file))

        res = adapter.parse(fnz_file)
        self.assertEqual(res.fund_code, "FNZ")
        self.assertFalse(res.is_master)
        self.assertAlmostEqual(res.cash_ratio, 0.015, places=3)
        self.assertGreater(len(res.holdings), 3)

        fph = next(h for h in res.holdings if h.ticker == "FPH")
        self.assertAlmostEqual(fph.weight, 0.1227, places=4)

    def test_kernel_adapter(self):
        clean_file = STAGING_DIR / "kernel" / "kernel_clean_energy_202610.csv"
        adapter = KernelAdapter()
        self.assertTrue(adapter.can_handle(clean_file))

        res = adapter.parse(clean_file)
        self.assertEqual(res.fund_code, "KERNEL_CLEAN_ENERGY")
        self.assertAlmostEqual(res.cash_ratio, 0.012, places=3)

        vestas = next(h for h in res.holdings if "Vestas" in h.name)
        self.assertAlmostEqual(vestas.weight, 0.125, places=3)

    def test_disclose_register_adapter(self):
        disclose_file = STAGING_DIR / "disclose" / "smartshares_feeder_disclosures_202610.csv"
        adapter = DiscloseRegisterAdapter()
        self.assertTrue(adapter.can_handle(disclose_file))

        feeders = adapter.parse_all_feeders(disclose_file)
        self.assertEqual(len(feeders), 2)

        twf = next(f for f in feeders if f.feeder_code == "TWF")
        self.assertAlmostEqual(twf.cash_ratio, 0.015, places=3)
        self.assertAlmostEqual(twf.hedging_ratio, 0.010, places=3)
        self.assertAlmostEqual(twf.master_allocation, 0.975, places=3)


if __name__ == "__main__":
    unittest.main()

