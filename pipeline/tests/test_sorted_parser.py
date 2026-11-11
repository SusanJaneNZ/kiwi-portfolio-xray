"""Dedicated unit tests for sorted_parser, BetaShares edge cases, and parse_effective_date."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pipeline.adapters.base import parse_effective_date
from pipeline.adapters.betashares_adapter import BetasharesAdapter
from pipeline.adapters.sorted_parser import parse_nz_fund_file


class TestSortedParserAndDates(unittest.TestCase):
    """Covers cash/margin segregation, header-locking guards, weight priority, and date parsing."""

    def test_currency_plurals_and_futures_margin_go_to_cash(self):
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "SMART-TNZ.csv"
            csv_path.write_text(
                "Asset Allocation,Fund: TNZ\n"
                "As at 05/10/2026\n"
                "Asset name,Benchmark Weight (%),% of fund net assets\n"
                "Fisher & Paykel Healthcare,10.0,96.0\n"
                "Pounds Sterling,0.0,1.5\n"
                "FUTURES MARGIN - NZD,0.0,2.5\n",
                encoding="utf-8",
            )
            res = parse_nz_fund_file(csv_path, "TNZ", "Smart NZ Top 10", "Smartshares")
            self.assertEqual(res.effective_date, "2026-10-05")
            self.assertEqual(len(res.holdings), 1)
            self.assertEqual(res.holdings[0].name, "Fisher & Paykel Healthcare")
            self.assertAlmostEqual(res.holdings[0].weight, 0.96, places=4)
            self.assertAlmostEqual(res.cash_ratio, 0.04, places=4)

    def test_betashares_negative_hedging_clamped_and_full_currency_names_filtered(self):
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "ASIA.csv"
            csv_path.write_text(
                "Fund Name,Betashares Asia Technology Tigers ETF\n"
                "Fund ASX Code,ASIA\n"
                "Date,2031-03-15\n"
                "Ticker,Name,Asset Class,Sector,Country,Currency,Weight (%)\n"
                "700 HK,TENCENT HOLDINGS LTD,Equities,Communication Services,China,HKD,98.5\n"
                ",New Zealand Dollar,Equities,,,NZD,2.0\n"
                ",AUD FX Forward Hedge,Equities,,,AUD,-0.5\n",
                encoding="utf-8",
            )
            adapter = BetasharesAdapter()
            res = adapter.parse(csv_path)
            self.assertEqual(res.effective_date, "2031-03-15")
            self.assertEqual(len(res.holdings), 1)
            self.assertAlmostEqual(res.cash_ratio, 0.02, places=4)
            self.assertEqual(res.hedging_ratio, 0.0)

    def test_parse_effective_date_day_first_vs_month_first_and_2030_plus(self):
        self.assertEqual(parse_effective_date("05/10/2026", prefer_day_first=True), "2026-10-05")
        self.assertEqual(parse_effective_date("05/10/2026", prefer_day_first=False), "2026-05-10")
        self.assertEqual(parse_effective_date("2032-11-01"), "2032-11-01")
        self.assertIsNone(parse_effective_date("2026-13-45"))


if __name__ == "__main__":
    unittest.main()

