"""Unit and integration tests for bond, term-deposit, multi-asset, and issuer normalization."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from pipeline.enrichment.bond_normalizer import AssetClassifier
from pipeline.output.build_output import PipelineCompiler
from pipeline.tests.test_sorted_xlsx import create_test_xlsx


class TestAssetClassifierAndBondPipeline(unittest.TestCase):
    """Tests 3-way row classification, bond tranche consolidation, TD extraction, and issuer stamping."""

    def setUp(self):
        self.classifier = AssetClassifier()

    def test_classification_rules_and_false_positive_guards(self):
        # Equities (including tricky 'Ltd ' and 'TD' substrings) must stay 'equity'
        self.assertEqual(self.classifier.classify_holding("Chorus Ltd "), "equity")
        self.assertEqual(self.classifier.classify_holding("TD SYNNEX Corp"), "equity")
        self.assertEqual(self.classifier.classify_holding("BHP Group Ltd (AU)"), "equity")
        self.assertEqual(self.classifier.classify_holding("Perpetual Limited"), "equity")
        self.assertEqual(self.classifier.classify_holding("Perpetual Group"), "equity")
        self.assertEqual(
            self.classifier.classify_holding("US Treasury Corp Dividend", fund_code="KERNEL_GLOBAL_DIVIDEND"),
            "equity",
        )
        self.assertEqual(
            self.classifier.classify_holding(
                "Generic Note",
                fund_code="KERNEL_GLOBAL_DIVIDEND",
                asset_class_hint="Fixed interest",
            ),
            "fixed_interest",
        )

        # Explicit deposits -> term_deposit (even when rate % and maturity date are included)
        self.assertEqual(self.classifier.classify_holding("ANZ Term Deposit 5.10% 15/06/2027"), "term_deposit")
        self.assertEqual(self.classifier.classify_holding("ANZ Term Deposit 15/06/2027"), "term_deposit")
        self.assertEqual(self.classifier.classify_holding("Kiwibank Notice Saver Call Deposit"), "term_deposit")

        # Diverse fixed-interest formats -> fixed_interest
        self.assertEqual(self.classifier.classify_holding("New Zealand Government 4.5% 15/04/2027"), "fixed_interest")
        self.assertEqual(self.classifier.classify_holding("ANZ Bank New Zealand 5.20% 15-Apr-27"), "fixed_interest")
        self.assertEqual(self.classifier.classify_holding("US TREASURY N/B 4.125 11/15/32"), "fixed_interest")
        self.assertEqual(self.classifier.classify_holding("NZLGFA BOND 15/05/28 2.25"), "fixed_interest")
        self.assertEqual(self.classifier.classify_holding("MERIDIAN ENERGY LIMITED 110332 4.55 GB"), "fixed_interest")
        self.assertEqual(self.classifier.classify_holding("SOUTHLAND BUILDING SOCIETY 070329 6.14 CB"), "fixed_interest")
        self.assertEqual(self.classifier.classify_holding("PERUVIAN GOVERNMENT INTERNATIONAL BOND 3.23% 28/07/2121"), "fixed_interest")
        self.assertEqual(self.classifier.classify_holding("UDCAU 2026 1 A 200832 ABS"), "fixed_interest")
        self.assertEqual(self.classifier.classify_holding("IRS AUD 4.50000 09/15/27-5Y LCH"), "fixed_interest")
        self.assertEqual(self.classifier.classify_holding("ISHARES CORE GLOBAL AGGREGATE BOND UCITS ETF (NZD HEDGED)"), "fixed_interest")
        self.assertEqual(self.classifier.classify_holding("New Zealand Treasury Bill 18/06/2026"), "fixed_interest")
        self.assertEqual(self.classifier.classify_holding("BNZ RCD 15/04/2026"), "fixed_interest")
        self.assertEqual(self.classifier.classify_holding("ANZ Bank New Zealand Perpetual 6.95%"), "fixed_interest")
        self.assertEqual(self.classifier.classify_holding("Chorus Capital Notes"), "fixed_interest")
        self.assertEqual(self.classifier.classify_holding("iShares Core US Aggregate Bond ETF"), "fixed_interest")

        # NZ Residential Mortgages, FRNs (NFIX3FRA/Float), ABS Trusts -> fixed_interest
        self.assertEqual(self.classifier.classify_holding("Loan secured over residential property in Auckland"), "fixed_interest")
        self.assertEqual(self.classifier.classify_holding("BZLNZ NFIX3FRA + 58 11/05/2029"), "fixed_interest")
        self.assertEqual(self.classifier.classify_holding("KIWI Float 13/06/2028"), "fixed_interest")
        self.assertEqual(self.classifier.classify_holding("UDC Endeavour Auto ABS Trust"), "fixed_interest")
        self.assertEqual(self.classifier.classify_holding("MTFNZ M25 A"), "fixed_interest")

        # Accounting / Capital Call rows -> accounting
        self.assertEqual(self.classifier.classify_holding("Debtors"), "accounting")
        self.assertEqual(self.classifier.classify_holding("Creditors"), "accounting")
        self.assertEqual(self.classifier.classify_holding("IVX Capital Call"), "accounting")

        # Mortgage consolidation into single canonical NZ Residential Mortgages pool
        m1 = self.classifier.normalize_bond_holding("Loan secured over residential property in Auckland")
        m2 = self.classifier.normalize_bond_holding("Loan secured over residential property in Wellington")
        self.assertEqual(m1["isin"], "BOND:NZ_RESIDENTIAL_MORTGAGES")
        self.assertEqual(m1["isin"], m2["isin"])

    def test_tranche_stripping_country_and_sector(self):
        b1 = self.classifier.normalize_bond_holding("New Zealand Government 4.5% 15/04/2027 Series 1")
        b2 = self.classifier.normalize_bond_holding("NZGS 3.50% 14-Apr-33 Tranche 2")
        self.assertEqual(b1["isin"], "BOND:ISSUER_NZ_GOVT")
        self.assertEqual(b1["isin"], b2["isin"])
        self.assertEqual(b1["sector"], "Sovereign")
        self.assertEqual(b1["country"], "New Zealand")

        etf = self.classifier.normalize_bond_holding("iShares Global Green Bond ETF")
        self.assertEqual(etf["name"], "iShares Global Green Bond ETF")
        self.assertEqual(etf["sector"], "Bond ETF")
        self.assertEqual(etf["country"], "Global")

        anz_bond = self.classifier.normalize_bond_holding("ANZ Bank New Zealand Senior FRN 15/05/2028")
        self.assertEqual(anz_bond["issuer_key"], "ISSUER_ANZ")
        self.assertEqual(anz_bond["sector"], "Financial")
        self.assertEqual(anz_bond["country"], "New Zealand")

    def test_end_to_end_bond_balanced_and_conservative_xlsx(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            staging = root / "staging"
            out_dir = root / "public"
            (staging / "directories").mkdir(parents=True)
            (staging / "smartshares").mkdir(parents=True)
            (staging / "kernel").mkdir(parents=True)

            # Minimal NZX directory with ANZ & Chorus so direct_equities and balanced equities match cleanly
            (staging / "directories" / "nzx_directory.csv").write_text(
                "Ticker,Company Name,Sector,ISIN\n"
                "ANZ.NZ,ANZ Group Holdings Limited,Financials,AU000000ANZ3\n"
                "CNU.NZ,Chorus Limited,Communication Services,NZCNUE0001S2\n",
                encoding="utf-8",
            )

            # Empty pipeline config folder mirrored cleanly
            repo_copy = root / "repo"
            (repo_copy / "pipeline" / "security_master").mkdir(parents=True)
            (repo_copy / "pipeline" / "enrichment").mkdir(parents=True)
            (repo_copy / "pipeline" / "normalizer").mkdir(parents=True)
            (repo_copy / "pipeline" / "feeder_registry.json").write_text("{}", encoding="utf-8")
            (repo_copy / "pipeline" / "normalizer" / "gics_mapping.json").write_text("{}", encoding="utf-8")
            (repo_copy / "pipeline" / "enrichment" / "company_alias_map.json").write_text("{}", encoding="utf-8")
            (repo_copy / "pipeline" / "enrichment" / "issuer_alias_map.json").write_text(
                Path("pipeline/enrichment/issuer_alias_map.json").read_text(encoding="utf-8"),
                encoding="utf-8",
            )

            # 1. Smart NZB (Bond ETF fixture with multi-tranche sovereign & bank bonds)
            create_test_xlsx(
                staging / "smartshares" / "SMART-NZ-BOND-ETF.xlsx",
                [
                    ["Smart NZ Bond ETF"],
                    ["As at 31 October 2026"],
                    ["Asset name", "% of fund net assets"],
                    ["New Zealand Government 4.5% 15/04/2027", 35.0],
                    ["New Zealand Government 3.5% 14/04/2033", 25.0],
                    ["ANZ Bank New Zealand 5.2% 15-Apr-28", 20.0],
                    ["LGFA 4.5% 15/04/2029 Series 2", 18.0],
                    ["NZD Cash", 2.0],
                ],
            )

            # 2. Kernel Balanced (mixed equities + sovereign bonds + Bond ETF + cash)
            create_test_xlsx(
                staging / "kernel" / "KERNEL-BALANCED-FUND.xlsx",
                [
                    ["Kernel Balanced Fund"],
                    ["As at 31 October 2026"],
                    ["Asset name", "% of fund net assets"],
                    ["Chorus Limited", 35.0],
                    ["ANZ Group Holdings Limited", 25.0],
                    ["New Zealand Government 4.5% 15/04/2027", 20.0],
                    ["iShares Core US Aggregate Bond ETF", 18.0],
                    ["Cash", 2.0],
                ],
            )

            # 3. Kernel Conservative (bonds + NZ bank Term Deposit + cash)
            create_test_xlsx(
                staging / "kernel" / "KERNEL-CONSERVATIVE-FUND.xlsx",
                [
                    ["Kernel Conservative Fund"],
                    ["As at 31 October 2026"],
                    ["Asset name", "% of fund net assets"],
                    ["ANZ Bank Term Deposit", 35.0],
                    ["New Zealand Government 4.5% 15/04/2027", 60.0],
                    ["Cash", 5.0],
                ],
            )

            # 4. Unconfigured Feeder Wrapper (e.g. USS holding Vanguard Small-Cap ETF 99.8%)
            create_test_xlsx(
                staging / "smartshares" / "SMART-US-SMALL-CAP-ETF-FND1110.xlsx",
                [
                    ["Smart US Small Cap ETF"],
                    ["As at 31 October 2026"],
                    ["Asset name", "% of fund net assets"],
                    ["VANGUARD SMALL-CAP ETF", 99.8],
                    ["Cash", 0.2],
                ],
            )

            compiler = PipelineCompiler(staging_dir=staging, output_dir=out_dir, repo_root=repo_copy)
            report, summary = compiler.compile(dry_run=False)

            self.assertTrue(report.is_valid, f"Unexpected validation errors: {report.errors}")
            self.assertEqual(summary["total_unresolved_entries"], 0)
            self.assertEqual(len(summary["unconfigured_feeders"]), 1)
            self.assertEqual(summary["unconfigured_feeders"][0]["fund_code"], "USS")
            self.assertEqual(summary["unconfigured_feeders"][0]["suggested_provider"], "vanguard")

            funds_by_code = {f["code"]: f for f in json.loads((out_dir / "funds_registry.json").read_text())}
            self.assertEqual(funds_by_code["NZB"]["asset_class"], "fixed_interest")
            self.assertEqual(funds_by_code["KERNEL_BALANCED"]["asset_class"], "mixed")
            self.assertEqual(funds_by_code["KERNEL_CONSERVATIVE"]["asset_class"], "fixed_interest")

            constituents = json.loads((out_dir / "constituents.json").read_text())
            nzb_by_isin = {c["isin"]: c for c in constituents["NZB"]}
            self.assertAlmostEqual(nzb_by_isin["BOND:ISSUER_NZ_GOVT"]["weight"], 0.60, places=4)
            self.assertEqual(nzb_by_isin["BOND:ISSUER_NZ_GOVT"]["tranche_count"], 2)
            self.assertEqual(nzb_by_isin["BOND:ISSUER_ANZ"]["issuer_key"], "ISSUER_ANZ")

            cons_by_isin = {c["isin"]: c for c in constituents["KERNEL_CONSERVATIVE"]}
            self.assertIn("TD:ISSUER_ANZ", cons_by_isin)
            self.assertEqual(cons_by_isin["TD:ISSUER_ANZ"]["asset_class"], "term_deposit")
            self.assertEqual(cons_by_isin["TD:ISSUER_ANZ"]["issuer_key"], "ISSUER_ANZ")

            direct_equities = json.loads((out_dir / "direct_equities.json").read_text())
            by_ticker = {d["ticker"]: d for d in direct_equities}
            self.assertEqual(by_ticker["ANZ.NZ"]["issuer_key"], "ISSUER_ANZ")
            self.assertEqual(by_ticker["CNU.NZ"]["issuer_key"], "ISSUER_CNU")


if __name__ == "__main__":
    unittest.main()
