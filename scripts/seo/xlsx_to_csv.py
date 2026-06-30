"""
scripts/seo/xlsx_to_csv.py

Block 5A-W-33 — one-off helper to convert the raw XLSX exports under
seo/exports/ into per-sheet CSVs so the TypeScript analyzer doesn't
need an XLSX dependency.

Stdlib only (zipfile + xml.etree). Run from the repo root:

    python scripts/seo/xlsx_to_csv.py

For each .xlsx in seo/exports/, writes one CSV per non-empty sheet:
    seo/exports/<basename>__<sheetname>.csv

CSVs use UTF-8 + comma delimiter + double-quote escaping.
"""

from __future__ import annotations

import csv
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
EXPORTS_DIR = Path(__file__).resolve().parent.parent.parent / 'seo' / 'exports'


def _col_index(ref: str) -> int:
    """Convert an XLSX cell ref like 'AB12' to a zero-based column index."""
    letters = ''.join(c for c in ref if c.isalpha())
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch.upper()) - ord('A') + 1)
    return idx - 1


def _read_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    out: list[str] = []
    try:
        data = zf.read('xl/sharedStrings.xml')
    except KeyError:
        return out
    root = ET.fromstring(data)
    for si in root.findall(f'{NS}si'):
        # A shared string can be either a single <t> or a run of <r><t>...</t></r>.
        # Concatenate all text content.
        text_parts: list[str] = []
        for t in si.iter(f'{NS}t'):
            if t.text:
                text_parts.append(t.text)
        out.append(''.join(text_parts))
    return out


def _read_workbook_sheets(zf: zipfile.ZipFile) -> list[tuple[str, str]]:
    """Return [(sheet_name, xml_path), ...] in workbook order."""
    workbook = ET.fromstring(zf.read('xl/workbook.xml'))
    rels = ET.fromstring(zf.read('xl/_rels/workbook.xml.rels'))
    rels_ns = '{http://schemas.openxmlformats.org/package/2006/relationships}'
    rel_targets: dict[str, str] = {}
    for r in rels.findall(f'{rels_ns}Relationship'):
        rel_targets[r.attrib['Id']] = r.attrib['Target']
    sheets = []
    r_attr = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
    for s in workbook.findall(f'{NS}sheets/{NS}sheet'):
        name = s.attrib['name']
        rid = s.attrib[r_attr]
        target = rel_targets.get(rid)
        if not target:
            continue
        path = target if target.startswith('xl/') else f'xl/{target}'
        sheets.append((name, path))
    return sheets


def _cell_value(c: ET.Element, shared: list[str]) -> str:
    t = c.attrib.get('t', 'n')
    v = c.find(f'{NS}v')
    inline = c.find(f'{NS}is')
    if t == 's' and v is not None and v.text is not None:
        # Shared string
        idx = int(v.text)
        return shared[idx] if 0 <= idx < len(shared) else ''
    if t == 'inlineStr' and inline is not None:
        return ''.join(tt.text or '' for tt in inline.iter(f'{NS}t'))
    if t == 'b' and v is not None and v.text is not None:
        return 'TRUE' if v.text == '1' else 'FALSE'
    if v is not None and v.text is not None:
        return v.text
    return ''


def _safe_filename(name: str) -> str:
    return re.sub(r'[^A-Za-z0-9._-]+', '_', name).strip('_')


def convert_sheet_to_csv(zf: zipfile.ZipFile, sheet_path: str, shared: list[str], out_path: Path) -> int:
    """Return the row count written."""
    try:
        sheet_xml = zf.read(sheet_path)
    except KeyError:
        return 0
    root = ET.fromstring(sheet_xml)
    sheet_data = root.find(f'{NS}sheetData')
    if sheet_data is None:
        return 0
    rows_written = 0
    with out_path.open('w', encoding='utf-8', newline='') as fh:
        writer = csv.writer(fh, quoting=csv.QUOTE_MINIMAL)
        for row in sheet_data.findall(f'{NS}row'):
            cells = row.findall(f'{NS}c')
            if not cells:
                continue
            max_col = 0
            buf: dict[int, str] = {}
            for c in cells:
                ref = c.attrib.get('r')
                if not ref:
                    continue
                idx = _col_index(ref)
                buf[idx] = _cell_value(c, shared)
                if idx > max_col:
                    max_col = idx
            line = [buf.get(i, '') for i in range(max_col + 1)]
            if any(cell.strip() for cell in line):
                writer.writerow(line)
                rows_written += 1
    return rows_written


def convert_xlsx(path: Path) -> list[Path]:
    written: list[Path] = []
    with zipfile.ZipFile(path) as zf:
        shared = _read_shared_strings(zf)
        sheets = _read_workbook_sheets(zf)
        base = path.stem
        for name, sheet_path in sheets:
            safe = _safe_filename(name)
            out = path.parent / f'{base}__{safe}.csv'
            rows = convert_sheet_to_csv(zf, sheet_path, shared, out)
            if rows > 0:
                written.append(out)
                print(f'  → {out.name}  ({rows} row{"s" if rows != 1 else ""})')
            else:
                # Don't leave empty CSVs.
                if out.exists():
                    out.unlink()
    return written


def main(argv: Optional[list[str]] = None) -> int:
    if not EXPORTS_DIR.exists():
        print(f'No exports dir at {EXPORTS_DIR}', file=sys.stderr)
        return 1
    xlsx_files = sorted(EXPORTS_DIR.glob('*.xlsx'))
    if not xlsx_files:
        print('No .xlsx files to convert.')
        return 0
    for xlsx in xlsx_files:
        print(f'{xlsx.name}')
        try:
            convert_xlsx(xlsx)
        except Exception as exc:
            print(f'  !! {exc}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
