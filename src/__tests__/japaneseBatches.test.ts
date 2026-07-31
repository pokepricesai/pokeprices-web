// Block 5A-W-48C — verify the scraper repo's batch configuration
// stays coherent: every Japanese CSV in the sister repo is listed in
// exactly one Japanese batch, and no English CSV leaks into a
// Japanese batch (or vice versa).
//
// These tests read the sister scraper repo at
// C:\Users\lukep\OneDrive\Desktop\pokeprices . On dev environments
// that do not have the scraper repo checked out alongside the web
// repo (e.g. some CI paths), the tests skip gracefully.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

/** Cheap header-aware CSV parser sufficient for the PriceCharting
 *  format used by pc_csvs. Handles quoted fields containing commas. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.length > 0)
  if (lines.length < 2) return []
  const splitLine = (l: string): string[] => {
    const out: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]
      if (inQ) {
        if (ch === '"') { if (l[i+1] === '"') { cur += '"'; i++ } else inQ = false }
        else cur += ch
      } else {
        if (ch === '"') inQ = true
        else if (ch === ',') { out.push(cur); cur = '' }
        else cur += ch
      }
    }
    out.push(cur)
    return out
  }
  const header = splitLine(lines[0])
  const rows: Record<string, string>[] = []
  for (let r = 1; r < lines.length; r++) {
    const cells = splitLine(lines[r])
    const row: Record<string, string> = {}
    for (let c = 0; c < header.length; c++) row[header[c]] = cells[c] ?? ''
    rows.push(row)
  }
  return rows
}

const SCRAPER_ROOT = ['C:', 'Users', 'lukep', 'OneDrive', 'Desktop', 'pokeprices'].join(sep)
const BATCHDIR    = join(SCRAPER_ROOT, 'batches')
const CSVDIR      = join(SCRAPER_ROOT, 'pc_csvs')

const HAS_SCRAPER = existsSync(BATCHDIR) && existsSync(CSVDIR)

function loadBatch(name: string): Set<string> {
  const path = join(BATCHDIR, name)
  if (!existsSync(path)) return new Set()
  const text = readFileSync(path, 'utf8')
  return new Set(text.split(/\r?\n/).map(l => l.trim()).filter(Boolean))
}

function loadCsvConsoleNames(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  if (!existsSync(CSVDIR)) return out
  const files = readdirSync(CSVDIR).filter(f => f.endsWith('.csv'))
  for (const f of files) {
    const raw = readFileSync(join(CSVDIR, f), 'utf8')
    let rows: Record<string, string>[]
    try {
      rows = parseCsv(raw)
    } catch {
      continue
    }
    const consoles = new Set<string>()
    for (const r of rows) {
      const c = (r['console-name'] || '').trim()
      if (c) consoles.add(c)
    }
    out.set(f, consoles)
  }
  return out
}

// ── Batch coherence ───────────────────────────────

describe('Japanese batch coherence', () => {
  if (!HAS_SCRAPER) {
    it.skip('scraper repo not present — skipping batch coherence tests', () => {})
    return
  }

  it('the two Japanese batch files exist', () => {
    expect(existsSync(join(BATCHDIR, 'batch-japanese-1.txt'))).toBe(true)
    expect(existsSync(join(BATCHDIR, 'batch-japanese-2.txt'))).toBe(true)
  })

  it('no console name appears in both Japanese batches', () => {
    const jp1 = loadBatch('batch-japanese-1.txt')
    const jp2 = loadBatch('batch-japanese-2.txt')
    const overlap = Array.from(jp1).filter(n => jp2.has(n))
    expect(overlap).toEqual([])
  })

  it('no console name appears in a Japanese batch AND an English batch', () => {
    const jp = new Set<string>()
    loadBatch('batch-japanese-1.txt').forEach(c => jp.add(c))
    loadBatch('batch-japanese-2.txt').forEach(c => jp.add(c))
    const en = new Set<string>()
    for (let i = 1; i <= 6; i++) {
      loadBatch(`batch${i}.txt`).forEach(c => en.add(c))
    }
    const bleed = Array.from(jp).filter(n => en.has(n))
    expect(bleed).toEqual([])
  })

  it('every Japanese console-name found in pc_csvs is covered by exactly one Japanese batch', () => {
    const jp1 = loadBatch('batch-japanese-1.txt')
    const jp2 = loadBatch('batch-japanese-2.txt')
    const covered = new Set<string>()
    jp1.forEach(c => covered.add(c))
    jp2.forEach(c => covered.add(c))

    // Collect every distinct console name appearing in any JP-named CSV.
    const seen = new Set<string>()
    const consolesByFile = loadCsvConsoleNames()
    consolesByFile.forEach((consoles, file) => {
      if (!file.toLowerCase().includes('japan')) return
      consoles.forEach(c => seen.add(c))
    })
    // Every observed Japanese console must land in exactly one batch.
    seen.forEach(c => {
      const in1 = jp1.has(c)
      const in2 = jp2.has(c)
      expect(in1 || in2, `console "${c}" not in any batch`).toBe(true)
      expect(in1 && in2, `console "${c}" in both batches`).toBe(false)
    })
    // And every batch entry must correspond to a real CSV console.
    covered.forEach(c => {
      expect(seen.has(c), `batch entry "${c}" has no matching CSV console-name`).toBe(true)
    })
  })

  it('Japanese Battle Partners remains in a Japanese batch (regression pin)', () => {
    const jp1 = loadBatch('batch-japanese-1.txt')
    const jp2 = loadBatch('batch-japanese-2.txt')
    expect(jp1.has('Pokemon Japanese Battle Partners') || jp2.has('Pokemon Japanese Battle Partners')).toBe(true)
  })

  it('the six English batch files are untouched (still exist, size non-empty)', () => {
    for (let i = 1; i <= 6; i++) {
      const p = join(BATCHDIR, `batch${i}.txt`)
      expect(existsSync(p)).toBe(true)
      expect(statSync(p).size).toBeGreaterThan(0)
    }
  })
})

// ── Workflow wiring ───────────────────────────────

describe('Nightly workflow includes both Japanese batches', () => {
  if (!HAS_SCRAPER) {
    it.skip('scraper repo not present — skipping workflow tests', () => {})
    return
  }

  const wf = readFileSync(join(SCRAPER_ROOT, '.github', 'workflows', 'nightly-scrape.yml'), 'utf8')

  it('workflow declares batch-japanese-1 and batch-japanese-2 jobs', () => {
    expect(wf).toMatch(/^  batch-japanese-1:/m)
    expect(wf).toMatch(/^  batch-japanese-2:/m)
  })
  it('each Japanese job runs pokeprices_scraper_v8.py with the correct sets-file', () => {
    expect(wf).toContain('python pokeprices_scraper_v8.py --sets-file batches/batch-japanese-1.txt')
    expect(wf).toContain('python pokeprices_scraper_v8.py --sets-file batches/batch-japanese-2.txt')
  })
  it('refresh-and-analytics depends on BOTH Japanese batches', () => {
    expect(wf).toMatch(/needs:\s*\[[^\]]*batch-japanese-1[^\]]*batch-japanese-2[^\]]*\]/)
  })
})
