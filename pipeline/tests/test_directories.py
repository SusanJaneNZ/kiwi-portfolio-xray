"""Unit tests for real-world exchange directory parsing (ASXListedCompanies.csv and nzx_directory.csv)."""

import json
import tempfile
import unittest
from pathlib import Path

from pipeline.security_master.build_security_master import (
    _enrich_local_isins_from_global,
    parse_asx_directory,
    parse_nzx_directory,
)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
GICS_PATH = REPO_ROOT / "pipeline" / "normalizer" / "gics_mapping.json"
NZX_STAGED = REPO_ROOT / "data" / "staging" / "directories" / "nzx_directory.csv"


class TestDirectories(unittest.TestCase):
    """Tests parsing real ASXListedCompanies.csv and NZX directory formats."""

    def setUp(self):
        self.gics_mapping = json.loads(GICS_PATH.read_text(encoding="utf-8"))

    def test_real_asx_listed_companies_csv(self):
        csv_text = (
            "ASX listed companies as at Thu Nov 05 14:07:12 AEDT 2026\n"
            "Company name,ASX code,GICS industry group\n"
            '"1414 DEGREES LIMITED","14D","Capital Goods"\n'
            '"BHP GROUP LIMITED","BHP","Materials"\n'
            '"COMMONWEALTH BANK OF AUSTRALIA.","CBA","Banks"\n'
            '"CSL LIMITED","CSL","Pharmaceuticals, Biotechnology & Life Sciences"\n'
            '"GOODMAN GROUP","GMG","Equity Real Estate Investment Trusts (REITs)"\n'
            '"BETASHARES TEST ETF","BETA","Not Applic"\n'
        )
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "ASXListedCompanies.csv"
            p.write_text(csv_text, encoding="utf-8")

            records = parse_asx_directory(p, self.gics_mapping)
            self.assertEqual(len(records), 6)

            by_ticker = {r["ticker"]: r for r in records}
            self.assertEqual(by_ticker["14D.AX"]["sector"], "Industrials")
            self.assertEqual(by_ticker["CBA.AX"]["sector"], "Financials")
            self.assertEqual(by_ticker["CSL.AX"]["sector"], "Health Care")
            self.assertEqual(by_ticker["GMG.AX"]["sector"], "Real Estate")
            self.assertEqual(by_ticker["BETA.AX"]["sector"], "Unclassified")
            self.assertEqual(by_ticker["BHP.AX"]["isin"], "ASX:BHP")

            # Verify canonical ISIN enrichment from Vanguard VT
            global_vt = [
                {"isin": "AU000000BHP4", "name": "BHP Group Ltd", "ticker": "BHP"}
            ]
            _enrich_local_isins_from_global(records, global_vt)
            self.assertEqual(by_ticker["BHP.AX"]["isin"], "AU000000BHP4")

    def test_staged_nzx_directory_117_rows(self):
        records = parse_nzx_directory(NZX_STAGED, self.gics_mapping)
        self.assertEqual(len(records), 117)

        by_ticker = {r["ticker"]: r for r in records}
        self.assertEqual(by_ticker["WBC.NZ"]["country"], "Australia")
        self.assertEqual(by_ticker["WBC.NZ"]["sector"], "Financials")
        self.assertEqual(by_ticker["RGI.NZ"]["country"], "Canada")
        self.assertEqual(by_ticker["FPH.NZ"]["sector"], "Health Care")
        self.assertEqual(by_ticker["VGL.NZ"]["sector"], "Information Technology")
        self.assertEqual(by_ticker["GNZ.NZ"]["sector"], "Unclassified")
        self.assertIn("Precinct Properties", by_ticker["PCT.NZ"]["name"])
        self.assertEqual(by_ticker["2CC.NZ"]["ticker"], "2CC.NZ")

        # Enrich FPH from Vanguard VT
        global_vt = [
            {"isin": "NZFPHE0001S2", "name": "Fisher & Paykel Healthcare Corp", "ticker": "FPH"}
        ]
        _enrich_local_isins_from_global(records, global_vt)
        self.assertEqual(by_ticker["FPH.NZ"]["isin"], "NZFPHE0001S2")

    def test_headerless_nzx_csv(self):
        csv_text = (
            "1,WBC,Westpac Banking Corporation,Australia,Financials\n"
            "2,FPH,Fisher & Paykel Healthcare Corporation Limited,New Zealand,Healthcare\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "nzx_directory.csv"
            p.write_text(csv_text, encoding="utf-8")

            records = parse_nzx_directory(p, self.gics_mapping)
            self.assertEqual(len(records), 2)
            self.assertEqual(records[0]["ticker"], "WBC.NZ")
            self.assertEqual(records[0]["country"], "Australia")
            self.assertEqual(records[1]["sector"], "Health Care")


if __name__ == "__main__":
    unittest.main()
