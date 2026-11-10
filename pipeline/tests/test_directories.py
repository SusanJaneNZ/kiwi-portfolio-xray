"""Unit tests for real-world exchange directory parsing (ASXListedCompanies.csv)."""

import json
import tempfile
import unittest
from pathlib import Path

from pipeline.security_master.build_security_master import (
    _enrich_local_isins_from_global,
    parse_asx_directory,
)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
GICS_PATH = REPO_ROOT / "pipeline" / "normalizer" / "gics_mapping.json"


class TestASXDirectory(unittest.TestCase):
    """Tests parsing real ASXListedCompanies.csv format and GICS Level 2 mapping."""

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


if __name__ == "__main__":
    unittest.main()

