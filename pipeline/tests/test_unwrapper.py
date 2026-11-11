"""Unit tests for the feeder unwrapper."""

import unittest
from pathlib import Path

from pipeline.adapters.base import FundExtractionResult, RawHolding
from pipeline.unwrapper.feeder_unwrapper import FeederUnwrapper, FeederWrapperDisclosure

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


class TestFeederUnwrapper(unittest.TestCase):
    """Test suite for feeder unwrapping mathematics and asset scaling."""

    def setUp(self):
        self.registry_path = REPO_ROOT / "pipeline" / "feeder_registry.json"
        self.unwrapper = FeederUnwrapper(self.registry_path)

        # Mock master fund (normalized to 1.0)
        self.mock_master = FundExtractionResult(
            fund_code="VT",
            fund_name="Vanguard Total World ETF",
            provider="Vanguard",
            effective_date="2026-10-31",
            holdings=[
                RawHolding(name="Microsoft", weight=0.60, isin="US5949181045", country="US", sector="Information Technology"),
                RawHolding(name="Apple", weight=0.40, isin="US0378331005", country="US", sector="Information Technology"),
            ],
            is_master=True,
        )

    def test_feeder_scaling_math(self):
        # 1.5% cash, 1.0% hedging -> equity scale = 97.5% (0.975)
        disclosure = FeederWrapperDisclosure(
            feeder_code="TWF",
            feeder_name="Smartshares Total World ETF",
            master_ticker="VT",
            master_allocation=0.975,
            cash_ratio=0.015,
            hedging_ratio=0.010,
            effective_date="2026-10-31",
        )

        unwrapped = self.unwrapper.unwrap("TWF", self.mock_master, disclosure)
        self.assertEqual(unwrapped.fund_code, "TWF")
        self.assertEqual(unwrapped.cash_ratio, 0.015)
        self.assertEqual(unwrapped.hedging_ratio, 0.010)

        # Microsoft: 0.60 * 0.975 = 0.585
        msft = next(c for c in unwrapped.constituents if c["name"] == "Microsoft")
        self.assertAlmostEqual(msft["weight"], 0.585, places=4)

        # Apple: 0.40 * 0.975 = 0.390
        aapl = next(c for c in unwrapped.constituents if c["name"] == "Apple")
        self.assertAlmostEqual(aapl["weight"], 0.390, places=4)

        # Total sum check
        total = sum(c["weight"] for c in unwrapped.constituents) + unwrapped.cash_ratio + unwrapped.hedging_ratio
        self.assertAlmostEqual(total, 1.0, places=4)


if __name__ == "__main__":
    unittest.main()

