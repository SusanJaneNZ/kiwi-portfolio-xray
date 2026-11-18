"""Tests for the GitHub issue fund request automation bot."""

import json
import tempfile
import unittest
from pathlib import Path
from pipeline.automation.process_fund_request import (
    extract_metadata_from_text,
    update_catalog_file,
)


class TestFundRequestBot(unittest.TestCase):
    def test_extract_metadata_from_json_block(self):
        title = "[Fund Request] Milford Active Growth Fund"
        body = """
Please add this KiwiSaver fund to Kiwi Portfolio X-Ray!

```json
{
  "fund_name": "Milford Active Growth Fund",
  "provider": "Milford",
  "fund_code": "MILFORD_ACTIVE_GROWTH",
  "fnd_code": "FND123",
  "scheme_id": "SCH10001",
  "offer_id": "OFR10002",
  "is_kiwisaver": true
}
```
        """
        meta = extract_metadata_from_text(title, body)
        self.assertEqual(meta["fund_name"], "Milford Active Growth Fund")
        self.assertEqual(meta["provider"], "Milford")
        self.assertEqual(meta["fund_code"], "MILFORD_ACTIVE_GROWTH")
        self.assertEqual(meta["fnd_code"], "FND123")
        self.assertEqual(meta["scheme_id"], "SCH10001")
        self.assertEqual(meta["offer_id"], "OFR10002")
        self.assertTrue(meta["is_kiwisaver"])

    def test_extract_metadata_from_url_and_markdown(self):
        title = "[Fund Request] Fisher Funds KiwiSaver Growth Fund"
        body = """
### Fund Submission

- **Fund Name:** Fisher Funds KiwiSaver Growth Fund
- **Provider:** Fisher Funds
- **Fund Code:** FISHER_GROWTH
- **Smart Investor Link:** https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/SCH10713/OFR10715/FND555/
        """
        meta = extract_metadata_from_text(title, body)
        self.assertEqual(meta["fund_name"], "Fisher Funds KiwiSaver Growth Fund")
        self.assertEqual(meta["provider"], "Fisher Funds")
        self.assertEqual(meta["fund_code"], "FISHER_GROWTH")
        self.assertEqual(meta["fnd_code"], "FND555")
        self.assertEqual(meta["scheme_id"], "SCH10713")
        self.assertEqual(meta["offer_id"], "OFR10715")

    def test_update_catalog_file(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            catalog_file = Path(tmp_dir) / "fund_catalog.json"

            # 1. Add new entry
            new_entry = {
                "fund_code": "TEST_GROWTH",
                "fund_name": "Test Growth Fund",
                "provider": "Test Provider",
                "fnd_code": "FND999",
                "scheme_id": "SCH123",
                "offer_id": "OFR456",
                "is_kiwisaver": True,
            }
            success, msg = update_catalog_file(catalog_file, new_entry)
            self.assertTrue(success)
            self.assertIn("Successfully added", msg)

            data = json.loads(catalog_file.read_text(encoding="utf-8"))
            self.assertEqual(len(data), 1)
            self.assertEqual(data[0]["fund_code"], "TEST_GROWTH")
            self.assertEqual(data[0]["fnd_code"], "FND999")

            # 2. Update existing entry
            updated_entry = {
                "fund_code": "TEST_GROWTH",
                "fund_name": "Test Growth Fund Updated",
                "provider": "Test Provider",
                "fnd_code": "FND999",
                "scheme_id": "SCH123",
                "offer_id": "OFR456",
                "is_kiwisaver": True,
            }
            success, msg = update_catalog_file(catalog_file, updated_entry)
            self.assertTrue(success)
            self.assertIn("Successfully updated", msg)

            data = json.loads(catalog_file.read_text(encoding="utf-8"))
            self.assertEqual(len(data), 1)
            self.assertEqual(data[0]["fund_name"], "Test Growth Fund Updated")

    def test_update_catalog_missing_fnd_fails(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            catalog_file = Path(tmp_dir) / "fund_catalog.json"
            bad_entry = {
                "fund_code": "TEST_GROWTH",
                "fund_name": "Test Growth Fund",
            }
            success, msg = update_catalog_file(catalog_file, bad_entry)
            self.assertFalse(success)
            self.assertIn("Missing required FND code", msg)


if __name__ == "__main__":
    unittest.main()
