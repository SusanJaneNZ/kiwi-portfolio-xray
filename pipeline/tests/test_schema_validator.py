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
            }
        ]
        constituents = {
            "TWF": [
                {"isin": "US5949181045", "name": "MSFT", "country": "US", "sector": "Information Technology", "weight": 0.58},
                {"isin": "US0378331005", "name": "AAPL", "country": "US", "sector": "Information Technology", "weight": 0.40},
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
            }
        ]
        # Total equity (0.80) + cash (0.05) = 0.85 -> missing 15%
        constituents = {
            "TWF": [
                {"isin": "US5949181045", "name": "MSFT", "country": "US", "sector": "Information Technology", "weight": 0.80},
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
            }
        ]
        constituents = {
            "FNZ": [
                {"isin": "NZFPHE0001S2", "name": "FPH", "country": "NZ", "sector": "MadeUpSector", "weight": 1.0},
            ]
        }
        report = self.validator.validate_all(funds, constituents, [], [])
        self.assertTrue(any("non-canonical sector" in w for w in report.warnings))


if __name__ == "__main__":
    unittest.main()

