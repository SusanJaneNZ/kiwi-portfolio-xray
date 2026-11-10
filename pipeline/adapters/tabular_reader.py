"""Zero-dependency CSV and XLSX tabular file reader and percentage/Sorted helper."""

from __future__ import annotations

import csv
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


def _col_ref_to_index(cell_ref: str) -> int:
    """Converts Excel column reference (e.g. 'A1', 'AA12') into 0-based column index."""
    letters = "".join(ch for ch in cell_ref if ch.isalpha()).upper()
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch) - ord("A") + 1)
    return max(0, idx - 1)


def _strip_ns(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def _read_xlsx_sheet_rows(zf: zipfile.ZipFile, sheet_path: str, shared_strings: list[str]) -> list[list[str]]:
    """Extracts 2D string grid from an XLSX worksheet XML file."""
    rows: list[list[str]] = []
    root = ET.fromstring(zf.read(sheet_path))

    for elem in root.iter():
        if _strip_ns(elem.tag) != "row":
            continue
        row_cells: dict[int, str] = {}
        max_col = -1

        for child in elem:
            if _strip_ns(child.tag) != "c":
                continue
            ref = child.attrib.get("r", "")
            col_idx = _col_ref_to_index(ref) if ref else (max_col + 1)
            max_col = max(max_col, col_idx)

            cell_type = child.attrib.get("t", "")
            val_text = ""

            if cell_type == "inlineStr":
                parts = [t.text or "" for t in child.iter() if _strip_ns(t.tag) == "t"]
                val_text = "".join(parts)
            else:
                v_elem = next((c for c in child if _strip_ns(c.tag) == "v"), None)
                if v_elem is not None and v_elem.text is not None:
                    raw_val = v_elem.text
                    if cell_type == "s":
                        try:
                            val_text = shared_strings[int(raw_val)]
                        except (ValueError, IndexError):
                            val_text = raw_val
                    else:
                        val_text = raw_val

            row_cells[col_idx] = val_text.strip()

        if max_col >= 0:
            row_list = [row_cells.get(i, "") for i in range(max_col + 1)]
            if any(row_list):
                rows.append(row_list)

    return rows


def read_tabular_rows(file_path: Path) -> list[list[str]]:
    """Reads rows from either a .csv or .xlsx file into a list of string lists."""
    suffix = file_path.suffix.lower()
    if suffix == ".csv":
        with open(file_path, mode="r", encoding="utf-8-sig", errors="replace") as f:
            return [row for row in csv.reader(f) if row and any(c.strip() for c in row)]

    if suffix == ".xlsx":
        with zipfile.ZipFile(file_path, "r") as zf:
            names = set(zf.namelist())
            shared_strings: list[str] = []

            if "xl/sharedStrings.xml" in names:
                ss_root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
                for si in ss_root:
                    if _strip_ns(si.tag) != "si":
                        continue
                    parts = [t.text or "" for t in si.iter() if _strip_ns(t.tag) == "t"]
                    shared_strings.append("".join(parts))

            sheet_paths = sorted(
                n for n in names if re.match(r"^xl/worksheets/sheet\d+\.xml$", n)
            )
            if not sheet_paths:
                return []

            # Pick the sheet with the most rows (handles files with a summary cover tab)
            best_rows: list[list[str]] = []
            for sp in sheet_paths:
                sheet_rows = _read_xlsx_sheet_rows(zf, sp, shared_strings)
                if len(sheet_rows) > len(best_rows):
                    best_rows = sheet_rows
            return best_rows

    raise ValueError(f"Unsupported file format '{suffix}'. Expected .csv or .xlsx.")

