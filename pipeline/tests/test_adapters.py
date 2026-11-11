"""Unit tests for Tier 1 holding extraction adapters."""

import tempfile
import unittest
from pathlib import Path

from pipeline.adapters.betashares_adapter import BetasharesAdapter
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
        csv_text = (
            "Security Code,Security Description,Weighting (%)\n"
            "FPH,Fisher & Paykel Healthcare Corporation Limited,12.27%\n"
            "MCY,Mercury NZ Limited,8.50%\n"
            "AIA,Auckland International Airport Limited,7.80%\n"
            "NZD CASH,Cash and cash equivalents,1.50%\n"
            "OTHER,Other NZX Top 50 Equities,69.93%\n"
        )
        adapter = SmartsharesDirectAdapter()
        with tempfile.TemporaryDirectory() as tmp:
            sm_dir = Path(tmp) / "smartshares"
            sm_dir.mkdir()
            fnz_file = sm_dir / "smartshares_FNZ_202610.csv"
            fnz_file.write_text(csv_text, encoding="utf-8")

            self.assertTrue(adapter.can_handle(fnz_file))
            res = adapter.parse(fnz_file)
            self.assertEqual(res.fund_code, "FNZ")
            self.assertFalse(res.is_master)
            self.assertAlmostEqual(res.cash_ratio, 0.015, places=3)
            self.assertGreater(len(res.holdings), 3)

            fph = next(h for h in res.holdings if h.ticker == "FPH")
            self.assertAlmostEqual(fph.weight, 0.1227, places=4)

    def test_kernel_adapter(self):
        csv_text = (
            "Company Name,Weighting (%)\n"
            "Vestas Wind Systems A/S,12.50%\n"
            "Orsted A/S,10.20%\n"
            "Cash and Cash Equivalents,1.20%\n"
            "Other Clean Energy Equities,76.10%\n"
        )
        adapter = KernelAdapter()
        with tempfile.TemporaryDirectory() as tmp:
            k_dir = Path(tmp) / "kernel"
            k_dir.mkdir()
            clean_file = k_dir / "kernel_clean_energy_202610.csv"
            clean_file.write_text(csv_text, encoding="utf-8")

            self.assertTrue(adapter.can_handle(clean_file))
            res = adapter.parse(clean_file)
            self.assertEqual(res.fund_code, "KERNEL_CLEAN_ENERGY")
            self.assertAlmostEqual(res.cash_ratio, 0.012, places=3)

            vestas = next(h for h in res.holdings if "Vestas" in h.name)
            self.assertAlmostEqual(vestas.weight, 0.125, places=3)

    def test_generalized_master_ticker_extraction(self):
        vanguard = VanguardAdapter()
        ishares = ISharesAdapter()
        smartshares = SmartsharesDirectAdapter()
        self.assertEqual(vanguard._extract_ticker_from_text("Vanguard Mid-Cap ETF (VO)"), "VO")
        self.assertEqual(ishares._extract_ticker_from_filename("BOTZ_holdings.csv"), "BOTZ")
        self.assertEqual(ishares._extract_ticker_from_filename("IVV_holdings.csv"), "IVV")
        # Multi-word Smartshares hints must beat short word substrings (ESG vs EUROPE ESG / US ESG)
        self.assertEqual(smartshares._extract_code_from_filename("SMART-EUROPE-ESG-ETF-FND14631-Full.xlsx"), "EUG")
        self.assertEqual(smartshares._extract_code_from_filename("SMART-US-ESG-ETF-FND14636-Full.xlsx"), "USA")
        self.assertEqual(smartshares._extract_code_from_filename("SMART-GLOBAL-ESG-ETF-FND14633-Full.xlsx"), "ESG")
        self.assertEqual(smartshares._extract_code_from_filename("SMART-US-SMALL-CAP-ETF-FND1110-Full.xlsx"), "USS")
        self.assertEqual(smartshares._extract_code_from_filename("SMART-US-MID-CAP-ETF-FND1109-Full.xlsx"), "USM")
        self.assertEqual(smartshares._extract_code_from_filename("SMART-AUSTRALIAN-TOP-200-ETF-FND19355-Full.xlsx"), "AUS")

    def test_ishares_skips_money_market_and_cash_derivatives(self):
        csv_text = (
            'Fund Holdings as of,"09/Nov/2026"\n\n'
            'Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Location\n'
            '"AAPL","APPLE","Information Technology","Equity","999.00","99.90","United States"\n'
            '"ICSUAGD","BLK ICS USD LIQ AGENCY DIS","Cash and/or Derivatives","Money Market","1.00","0.08","Ireland"\n'
            '"USD","USD CASH","Cash and/or Derivatives","Cash","0.20","0.02","United States"\n'
        )
        adapter = ISharesAdapter()
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "SASU_holdings.csv"
            p.write_text(csv_text, encoding="utf-8")
            res = adapter.parse(p)
            self.assertEqual(res.fund_code, "SASU")
            self.assertEqual(len(res.holdings), 1)
            self.assertEqual(res.holdings[0].ticker, "AAPL")
            self.assertAlmostEqual(res.holdings[0].weight, 1.0, places=4)

    def test_betashares_asia_adapter(self):
        csv_text = (
            "BetaShares Asia Technology Tigers ETF\n"
            "As at 31 October 2026\n"
            "Ticker,Name,Sector,Country,Weight (%)\n"
            "2330 TT,Taiwan Semiconductor Manufacturing Co Ltd,Information Technology,Taiwan,10.50%\n"
            "0700 HK,Tencent Holdings Ltd,Communication Services,China,9.80%\n"
            "AUD CASH,AUD Cash,Cash,Australia,0.70%\n"
            "OTHER,Other Holdings,Information Technology,South Korea,79.00%\n"
        )
        adapter = BetasharesAdapter()
        with tempfile.TemporaryDirectory() as tmp:
            bs_dir = Path(tmp) / "betashares"
            bs_dir.mkdir()
            p = bs_dir / "ASIA_holdings.csv"
            p.write_text(csv_text, encoding="utf-8")
            self.assertTrue(adapter.can_handle(p))
            res = adapter.parse(p)
            self.assertEqual(res.fund_code, "ASIA")
            self.assertEqual(res.provider, "BetaShares")
            self.assertAlmostEqual(res.cash_ratio, 0.007, places=4)
            self.assertEqual(len(res.holdings), 3)
            tsmc = next(h for h in res.holdings if "Taiwan Semiconductor" in h.name)
            self.assertAlmostEqual(tsmc.weight, 0.105, places=4)


if __name__ == "__main__":
    unittest.main()

