// Block 5A-W-48C — verify the scraper repo's batch configuration
// stays coherent: every Japanese CSV in the sister repo is listed in
// exactly one Japanese batch, and no English CSV leaks into a
// Japanese batch (or vice versa).
//
// Block 5A-W-48D — Japanese batches grew from 2 to 4 balanced files
// after the 116-set import. All batch/workflow assertions here iterate
// `batch-japanese-*.txt` dynamically so future rebalances don't need
// test edits.
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

/** Discover every batch-japanese-*.txt file present on disk. Callers
 *  should always go through this so a rebalance (2 → 4 → N batches)
 *  never requires touching the tests. Returns absolute names like
 *  `batch-japanese-1.txt` sorted by numeric suffix. */
function discoverJapaneseBatchFiles(): string[] {
  if (!existsSync(BATCHDIR)) return []
  return readdirSync(BATCHDIR)
    .filter(f => /^batch-japanese-\d+\.txt$/.test(f))
    .sort((a, b) => {
      const na = Number(a.match(/(\d+)/)![1])
      const nb = Number(b.match(/(\d+)/)![1])
      return na - nb
    })
}

function loadAllJapaneseBatches(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const f of discoverJapaneseBatchFiles()) out.set(f, loadBatch(f))
  return out
}

// ── Batch coherence ───────────────────────────────

describe('Japanese batch coherence', () => {
  if (!HAS_SCRAPER) {
    it.skip('scraper repo not present — skipping batch coherence tests', () => {})
    return
  }

  it('at least two Japanese batch files exist (batch-japanese-1..2 minimum)', () => {
    const files = discoverJapaneseBatchFiles()
    expect(files.length).toBeGreaterThanOrEqual(2)
    expect(files).toContain('batch-japanese-1.txt')
    expect(files).toContain('batch-japanese-2.txt')
  })

  it('no console name appears in more than one Japanese batch', () => {
    const seen = new Map<string, string>()   // console -> first batch it appeared in
    const dups: string[] = []
    for (const [file, entries] of Array.from(loadAllJapaneseBatches().entries())) {
      entries.forEach(c => {
        if (seen.has(c)) dups.push(`"${c}" in both ${seen.get(c)} and ${file}`)
        else seen.set(c, file)
      })
    }
    expect(dups).toEqual([])
  })

  it('no console name appears in a Japanese batch AND an English batch', () => {
    const jp = new Set<string>()
    for (const [, entries] of Array.from(loadAllJapaneseBatches().entries())) entries.forEach(c => jp.add(c))
    const en = new Set<string>()
    for (let i = 1; i <= 6; i++) {
      loadBatch(`batch${i}.txt`).forEach(c => en.add(c))
    }
    const bleed = Array.from(jp).filter(n => en.has(n))
    expect(bleed).toEqual([])
  })

  it('every Japanese console-name found in pc_csvs is covered by exactly one Japanese batch', () => {
    const batches = loadAllJapaneseBatches()
    const covered = new Set<string>()
    for (const [, entries] of Array.from(batches.entries())) entries.forEach(c => covered.add(c))

    // Collect every distinct console name appearing in any JP-named CSV.
    const seen = new Set<string>()
    const consolesByFile = loadCsvConsoleNames()
    consolesByFile.forEach((consoles, file) => {
      if (!file.toLowerCase().includes('japan')) return
      consoles.forEach(c => seen.add(c))
    })
    // Every observed Japanese console must land in some batch.
    seen.forEach(c => {
      expect(covered.has(c), `console "${c}" not in any batch`).toBe(true)
    })
    // And every batch entry must correspond to a real CSV console.
    covered.forEach(c => {
      expect(seen.has(c), `batch entry "${c}" has no matching CSV console-name`).toBe(true)
    })
  })

  it('Japanese Battle Partners remains in a Japanese batch (regression pin)', () => {
    const covered = new Set<string>()
    for (const [, entries] of Array.from(loadAllJapaneseBatches().entries())) entries.forEach(c => covered.add(c))
    expect(covered.has('Pokemon Japanese Battle Partners')).toBe(true)
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

describe('Nightly workflow includes every Japanese batch file', () => {
  if (!HAS_SCRAPER) {
    it.skip('scraper repo not present — skipping workflow tests', () => {})
    return
  }

  const wf = readFileSync(join(SCRAPER_ROOT, '.github', 'workflows', 'nightly-scrape.yml'), 'utf8')
  const files = discoverJapaneseBatchFiles()

  it('workflow declares one job per batch-japanese-N.txt file', () => {
    for (const f of files) {
      const jobName = f.replace(/\.txt$/, '')
      expect(wf, `job ${jobName} missing from workflow`).toMatch(new RegExp(`^  ${jobName}:`, 'm'))
    }
  })
  it('each Japanese job runs pokeprices_scraper_v8.py with the matching sets-file', () => {
    for (const f of files) {
      expect(wf).toContain(`python pokeprices_scraper_v8.py --sets-file batches/${f}`)
    }
  })
  it('refresh-and-analytics depends on EVERY Japanese batch job', () => {
    // Find the refresh-and-analytics `needs:` line and confirm it lists
    // every batch-japanese-N job name.
    const needsMatch = wf.match(/refresh-and-analytics:[\s\S]*?needs:\s*\[([^\]]+)\]/)
    expect(needsMatch, 'refresh-and-analytics needs: line not found').toBeTruthy()
    const needs = needsMatch![1]
    for (const f of files) {
      const jobName = f.replace(/\.txt$/, '')
      expect(needs, `refresh-and-analytics is missing ${jobName}`).toContain(jobName)
    }
  })
})
