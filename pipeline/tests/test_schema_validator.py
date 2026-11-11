"""Unit tests for the schema and integrity validator."""

import unittest

from pipeline.validate.schema_validator import SchemaValidator


class TestSchemaValidator(unittest.TestCase):
    """Test suite for data integrity checks and schema validation."""

    def setUp(self):
        self.validator = SchemaValidator()

    def test_valid_portfolio_data(self):
        funds = [
            {
                "code": "TWF",
                "name": "Smartshares Total World ETF",
                "provider": "Smartshares",
                "effective_date": "2026-10-31",
                "cash_ratio": 0.02,
                "hedging_ratio": 0.0,
                "constituent_count": 2,
                "asset_class": "equity",
            }
        ]
        constituents = {
            "TWF": [
                {"isin": "US5949181045", "name": "MSFT", "country": "US", "sector": "Information Technology", "weight": 0.58, "asset_class": "equity"},
                {"isin": "US0378331005", "name": "AAPL", "country": "US", "sector": "Information Technology", "weight": 0.40, "asset_class": "equity"},
            ]
        }
        direct = [
            {"isin": "NZFPHE0001S2", "name": "FPH", "ticker": "FPH.NZ", "exchange": "NZX", "country": "NZ", "sector": "Health Care"}
        ]
        unresolved = []

        report = self.validator.validate_all(funds, constituents, direct, unresolved)
        self.assertTrue(report.is_valid)
        self.assertEqual(len(report.errors), 0)

    def test_weight_sum_integrity_failure(self):
        funds = [
            {
                "code": "TWF",
                "name": "Smartshares Total World ETF",
                "provider": "Smartshares",
                "effective_date": "2026-10-31",
                "cash_ratio": 0.05,
                "hedging_ratio": 0.0,
                "constituent_count": 1,
                "asset_class": "equity",
            }
        ]
        # Total equity (0.80) + cash (0.05) = 0.85 -> missing 15%
        constituents = {
            "TWF": [
                {"isin": "US5949181045", "name": "MSFT", "country": "US", "sector": "Information Technology", "weight": 0.80, "asset_class": "equity"},
            ]
        }
        report = self.validator.validate_all(funds, constituents, [], [])
        self.assertFalse(report.is_valid)
        self.assertTrue(any("weight sum failed integrity" in err for err in report.errors))

    def test_non_canonical_sector_warning(self):
        funds = [
            {
                "code": "FNZ",
                "name": "Smartshares NZ Top 50",
                "provider": "Smartshares",
                "effective_date": "2026-10-31",
                "cash_ratio": 0.0,
                "hedging_ratio": 0.0,
                "constituent_count": 1,
                "asset_class": "equity",
            }
        ]
        constituents = {
            "FNZ": [
                {"isin": "NZFPHE0001S2", "name": "FPH", "country": "NZ", "sector": "MadeUpSector", "weight": 1.0, "asset_class": "equity"},
            ]
        }
        report = self.validator.validate_all(funds, constituents, [], [])
        self.assertTrue(any("non-canonical sector" in w for w in report.warnings))

    def test_bond_and_td_category_validation(self):
        funds = [
            {
                "code": "KERNEL_BALANCED",
                "name": "Kernel Balanced Fund",
                "provider": "Kernel",
                "effective_date": "2026-10-31",
                "cash_ratio": 0.05,
                "hedging_ratio": 0.0,
                "constituent_count": 2,
                "asset_class": "mixed",
            }
        ]
        constituents = {
            "KERNEL_BALANCED": [
                {"isin": "BOND:ISSUER_NZ_GOVT", "name": "New Zealand Government", "country": "New Zealand", "sector": "Sovereign", "weight": 0.60, "asset_class": "fixed_interest"},
                {"isin": "TD:ISSUER_ANZ", "name": "ANZ Group Term Deposit", "country": "New Zealand", "sector": "InvalidTDSector", "weight": 0.35, "asset_class": "term_deposit"},
            ]
        }
        report = self.validator.validate_all(funds, constituents, [], [])
        self.assertFalse(report.is_valid)
        self.assertTrue(any("must have sector 'Term Deposit'" in e for e in report.errors))

    def test_duplicate_fund_codes_and_negative_weights_rejected(self):
        funds = [
            {
                "code": "FNZ",
                "name": "Fund 1",
                "provider": "Smartshares",
                "effective_date": "2026-10-31",
                "cash_ratio": 0.0,
                "hedging_ratio": 0.0,
                "constituent_count": 2,
                "asset_class": "equity",
            },
            {
                "code": "FNZ",
                "name": "Fund 2",
                "provider": "Smartshares",
                "effective_date": "2026-10-31",
                "cash_ratio": 0.0,
                "hedging_ratio": 0.0,
                "constituent_count": 1,
                "asset_class": "equity",
            },
        ]
        constituents = {
            "FNZ": [
                {"isin": "NZFPHE0001S2", "name": "FPH", "country": "New Zealand", "sector": "Health Care", "weight": -0.1, "asset_class": "equity"},
            ]
        }
        report = self.validator.validate_all(funds, constituents, [], [])
        self.assertFalse(report.is_valid)
        self.assertTrue(any("Duplicate fund code 'FNZ'" in e for e in report.errors))
        self.assertTrue(any("out-of-range weight" in e for e in report.errors))
        self.assertTrue(any("constituent_count (2)" in e for e in report.errors))


if __name__ == "__main__":
    unittest.main()

