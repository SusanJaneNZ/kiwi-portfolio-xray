"""Unit tests for native XLSX parsing and Sorted Smart Investor Smartshares/Kernel holdings."""

import base64
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

from pipeline.adapters.kernel_adapter import KernelAdapter
from pipeline.adapters.smartshares_direct_adapter import SmartsharesDirectAdapter
from pipeline.admin_ui import AdminService

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _col_letter(idx: int) -> str:
    res = ""
    n = idx + 1
    while n > 0:
        n, rem = divmod(n - 1, 26)
        res = chr(65 + rem) + res
    return res


def create_test_xlsx(dest_path: Path, rows: list[list[str | float]]) -> None:
    """Writes a minimal standards-compliant XLSX workbook without external packages."""
    strings: list[str] = []
    str_idx: dict[str, int] = {}

    def get_si(val: str) -> int:
        if val not in str_idx:
            str_idx[val] = len(strings)
            strings.append(val)
        return str_idx[val]

    sheet_rows_xml = []
    for r_i, row in enumerate(rows, start=1):
        cells_xml = []
        for c_i, val in enumerate(row):
            ref = f"{_col_letter(c_i)}{r_i}"
            if isinstance(val, (int, float)):
                cells_xml.append(f'<c r="{ref}"><v>{val}</v></c>')
            else:
                si = get_si(str(val))
                cells_xml.append(f'<c r="{ref}" t="s"><v>{si}</v></c>')
        sheet_rows_xml.append(f'<row r="{r_i}">{"".join(cells_xml)}</row>')

    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(sheet_rows_xml)}</sheetData>'
        "</worksheet>"
    )

    si_xml = "".join(f"<si><t>{escape(s)}</t></si>" for s in strings)
    shared_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(strings)}" uniqueCount="{len(strings)}">'
        f"{si_xml}</sst>"
    )

    with zipfile.ZipFile(dest_path, "w") as zf:
        zf.writestr("xl/worksheets/sheet1.xml", sheet_xml)
        zf.writestr("xl/sharedStrings.xml", shared_xml)


class TestSortedSmartInvestorXLSX(unittest.TestCase):
    """Tests XLSX parsing for Smartshares and Kernel Sorted Smart Investor spreadsheets."""

    def test_sorted_kernel_xlsx_decimal_scale(self):
        rows = [
            ["Kernel S&P Global Clean Energy Fund"],
            ["As at 30 September 2026"],
            ["Asset", "Asset class", "Type", "Country", "% of Fund"],
            ["Vestas Wind Systems A/S", "Shares", "International equities", "DK", 0.125],
            ["Orsted A/S", "Shares", "International equities", "DK", 0.102],
            ["First Solar Inc", "Shares", "International equities", "US", 0.761],
            ["NZD Cash Account", "Cash and cash equivalents", "Cash", "NZ", 0.012],
        ]
        adapter = KernelAdapter()
        with tempfile.TemporaryDirectory() as tmp:
            kernel_dir = Path(tmp) / "kernel"
            kernel_dir.mkdir()
            xlsx_path = kernel_dir / "Full portfolio holdings - Kernel Global Clean Energy Fund.xlsx"
            create_test_xlsx(xlsx_path, rows)

            self.assertTrue(adapter.can_handle(xlsx_path))
            res = adapter.parse(xlsx_path)

            self.assertEqual(res.fund_code, "KERNEL_CLEAN_ENERGY")
            self.assertEqual(res.effective_date, "2026-09-30")
            self.assertEqual(len(res.holdings), 3)
            self.assertAlmostEqual(res.cash_ratio, 0.012, places=4)

            vestas = next(h for h in res.holdings if "Vestas" in h.name)
            self.assertAlmostEqual(vestas.weight, 0.125, places=4)
            self.assertEqual(vestas.country, "DK")

    def test_sorted_smartshares_xlsx_percent_scale(self):
        rows = [
            ["Asset", "Asset class", "Type", "Country", "% of Fund"],
            ["Fisher & Paykel Healthcare Corporation Limited", "Shares", "Australasian equities", "NZ", 15.0],
            ["Mercury NZ Limited", "Shares", "Australasian equities", "NZ", 83.5],
            ["Cash at Bank", "Cash and cash equivalents", "Cash", "NZ", 1.5],
        ]
        adapter = SmartsharesDirectAdapter()
        with tempfile.TemporaryDirectory() as tmp:
            sm_dir = Path(tmp) / "smartshares"
            sm_dir.mkdir()
            xlsx_path = sm_dir / "Smart_NZ_Top_50_ETF.xlsx"
            create_test_xlsx(xlsx_path, rows)

            self.assertTrue(adapter.can_handle(xlsx_path))
            res = adapter.parse(xlsx_path)

            self.assertEqual(res.fund_code, "FNZ")
            self.assertAlmostEqual(res.cash_ratio, 0.015, places=4)
            self.assertEqual(len(res.holdings), 2)
            self.assertAlmostEqual(res.holdings[0].weight, 0.15, places=4)

    def test_admin_service_xlsx_upload_and_preview(self):
        rows = [
            ["Asset", "Asset class", "Type", "Country", "% of Fund"],
            ["Mercury NZ Limited", "Shares", "Australasian equities", "NZ", 98.5],
            ["NZD Cash", "Cash", "Cash", "NZ", 1.5],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            raw_xlsx = tmp_path / "src.xlsx"
            create_test_xlsx(raw_xlsx, rows)
            b64 = base64.b64encode(raw_xlsx.read_bytes()).decode("ascii")

            svc = AdminService(
                repo_root=REPO_ROOT,
                staging_dir=tmp_path / "staging",
                output_dir=tmp_path / "output",
            )
            svc.save_staged_file("smartshares", "Smart_NZ_Top_50.xlsx", content_base64=b64)
            preview = svc.preview_staged_file("smartshares", "Smart_NZ_Top_50.xlsx")

            self.assertEqual(preview["parse_summary"]["adapter"], "SmartsharesDirectAdapter")
            self.assertEqual(preview["parse_summary"]["status"], "ok")
            self.assertEqual(preview["parse_summary"]["fund_code"], "FNZ")
            self.assertEqual(preview["parse_summary"]["parsed_count"], 1)


if __name__ == "__main__":
    unittest.main()

