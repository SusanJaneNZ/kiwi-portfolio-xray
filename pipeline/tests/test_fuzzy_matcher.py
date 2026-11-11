"""Unit tests for string normalization, security matching, and disambiguation guardrails."""

import unittest

from pipeline.enrichment.fuzzy_matcher import (
    SecurityMatcher,
    get_stem_tokens,
    normalize_company_name,
    token_sort_similarity,
)


class TestFuzzyMatcher(unittest.TestCase):
    """Test suite for SecurityMatcher and string normalization."""

    def setUp(self):
        self.mock_security_master = [
            {
                "isin": "NZFPHE0001S2",
                "name": "Fisher & Paykel Healthcare Corporation Limited",
                "ticker": "FPH.NZ",
                "country": "NZ",
                "sector": "Health Care",
            },
            {
                "isin": "NZMCYE0001S8",
                "name": "Mercury NZ Limited",
                "ticker": "MCY.NZ",
                "country": "NZ",
                "sector": "Utilities",
            },
            {
                "isin": "AU000000BHP4",
                "name": "BHP Group Limited",
                "ticker": "BHP.AX",
                "country": "AU",
                "sector": "Materials",
            },
            {
                "isin": "US02079K3059",
                "name": "Alphabet Inc Class A",
                "ticker": "GOOGL",
                "country": "US",
                "sector": "Communication Services",
            },
            {
                "isin": "US02079K1079",
                "name": "Alphabet Inc Class C",
                "ticker": "GOOG",
                "country": "US",
                "sector": "Communication Services",
            },
            {
                "isin": "DK0061539921",
                "name": "Vestas Wind Systems A/S",
                "ticker": "VWS",
                "country": "DK",
                "sector": "Utilities",
            },
        ]
        self.alias_map = {
            "Kernel:KERNEL_NZ_50": {
                "Chorus Ltd": "NZCNUE0001S2"
            }
        }
        self.gics_map = {
            "Health Care": "Health Care",
            "Utilities": "Utilities",
            "Materials": "Materials",
            "Communication Services": "Communication Services",
        }
        self.matcher = SecurityMatcher(
            security_master=self.mock_security_master,
            alias_map=self.alias_map,
            gics_mapping=self.gics_map,
        )

    def test_normalize_company_name(self):
        self.assertEqual(
            normalize_company_name("Fisher & Paykel Healthcare Corporation Limited"),
            "FISHER PAYKEL HEALTHCARE",
        )
        self.assertEqual(
            normalize_company_name("Vestas Wind Systems A/S"),
            "VESTAS WIND SYSTEMS",
        )
        self.assertEqual(
            normalize_company_name("BHP Group Ltd (AU)"),
            "BHP",
        )

    def test_exact_isin_lookup(self):
        match = self.matcher.match(name="Random", isin="NZFPHE0001S2")
        self.assertTrue(match.matched)
        self.assertEqual(match.isin, "NZFPHE0001S2")
        self.assertEqual(match.reason, "exact_isin")

    def test_exact_ticker_lookup(self):
        match = self.matcher.match(name="Mercury Energy", ticker="MCY.NZ")
        self.assertTrue(match.matched)
        self.assertEqual(match.isin, "NZMCYE0001S8")
        self.assertEqual(match.reason, "exact_ticker_unique")

    def test_provider_alias_override(self):
        match = self.matcher.match(
            name="Chorus Ltd",
            provider="Kernel",
            fund_code="KERNEL_NZ_50",
        )
        self.assertTrue(match.matched)
        self.assertEqual(match.isin, "NZCNUE0001S2")

    def test_fuzzy_guardrail_pass(self):
        # Slightly modified name, score should be >= 0.90 with no close competitor
        match = self.matcher.match(name="Vestas Wind Systems AS")
        self.assertTrue(match.matched)
        self.assertEqual(match.isin, "DK0061539921")
        self.assertGreaterEqual(match.score, 0.90)

    def test_stem_collision_guardrail_fail(self):
        # "Alphabet Inc" without class specification - ambiguous collision between Class A and Class C
        match = self.matcher.match(name="Alphabet Inc")
        self.assertFalse(match.matched)
        self.assertIn("ambiguous_collision", match.reason)

    def test_normalization_and_candidate_suggestions(self):
        self.assertEqual(normalize_company_name("Technoprobe S.p.A."), "TECHNOPROBE")
        self.assertEqual(normalize_company_name("Kering SA - KER (EUR)"), "KERING")
        self.assertEqual(normalize_company_name("Nippon Building Fund Inc JREIT"), "NIPPON BUILDING FUND")
        self.assertEqual(normalize_company_name("Japan Real Estate Invest Corp JREIT"), "JAPAN REAL ESTATE INVESTMENT")

        suggestions = self.matcher.suggest_candidates("Alphabet Inc", limit=2)
        self.assertEqual(len(suggestions), 2)
        self.assertTrue(all("Alphabet" in s["name"] for s in suggestions))


if __name__ == "__main__":
    unittest.main()
