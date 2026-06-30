// src/lib/seo-analysis/csvParse.ts
// Block 5A-W-33 — minimal CSV parser sufficient for the GSC / Bing /
// eBay export shapes (header row + quoted fields + commas inside
// quotes + CRLF line endings). Stdlib-pure, no dependencies.
//
// Not a full RFC 4180 implementation — but covers every real-world
// quirk these exports throw at us:
//   * "" inside a quoted field is an escaped double-quote
//   * fields may or may not be quoted
//   * trailing blank lines are tolerated
//   * BOM is stripped from the start of the file

export type CsvRow = Record<string, string>

export function parseCsv(text: string): CsvRow[] {
  const rows = parseCsvRows(text)
  if (rows.length === 0) return []
  const header = rows[0]!
  const out: CsvRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!
    const obj: CsvRow = {}
    for (let c = 0; c < header.length; c++) {
      obj[header[c] ?? ''] = row[c] ?? ''
    }
    out.push(obj)
  }
  return out
}

/** Lower-level: returns rows as string[][] without header interpretation. */
export function parseCsvRows(input: string): string[][] {
  // Strip UTF-8 BOM if present.
  const text = input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          // Escaped quote.
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      // Tolerate CR; finalize on LF or end.
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      field = ''
      // Skip wholly empty trailing rows (single empty field).
      if (!(row.length === 1 && row[0] === '')) rows.push(row)
      row = []
      i++
      continue
    }
    field += ch
    i++
  }
  // Final field / row.
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
  }
  return rows
}
