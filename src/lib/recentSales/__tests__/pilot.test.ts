// Block 4B-W-2A — pilot cohort invariants.
//
// All tests are file-based. They do NOT connect to the database, do NOT
// import any public Page or Route file, and do NOT enable any feature flag.

import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

vi.mock('server-only', () => ({}))

const ROOT          = resolve(__dirname, '..', '..', '..', '..')
const MANIFEST_PATH = join(ROOT, 'data',       'recent-sales-pilot-100.json')
const MIGRATION_PATH= join(ROOT, 'migrations', '2026-06-17-recent-sales-pilot-100.sql')
const VERIFY_PATH   = join(ROOT, 'scripts',    'verify-recent-sales-pilot.sql')
const SELECT_PATH   = join(ROOT, 'scripts',    'select-recent-sales-pilot.sql')

const ALLOWED_CATEGORIES = [
  'sealed','sparse','difficult_variants',
  'vintage_or_wotc','psa_or_grade_spread','modern_or_recent',
  'general_quality',
] as const

// Minimum-coverage targets (>=). general_quality is the top-up bucket.
// 58-card technical pilot — see docs/recent-sales-architecture.md.
const MINIMUM_COVERAGE: Record<typeof ALLOWED_CATEGORIES[number], number> = {
  sealed:              10,
  sparse:              10,
  difficult_variants:   8,
  vintage_or_wotc:      8,
  psa_or_grade_spread:  5,
  modern_or_recent:     1,
  general_quality:      0,
}

const EXPECTED_TOTAL = 58

function readJson<T = unknown>(p: string): T {
  return JSON.parse(readFileSync(p, 'utf8')) as T
}

interface PilotEntry {
  provider: string
  provider_card_id: string
  card_slug: string
  card_name: string
  set_name: string
  primary_category: string
  selection_reason: string
  confidence: number
  is_sealed: boolean
  raw_price_cents:   number | null
  psa9_price_cents:  number | null
  psa10_price_cents: number | null
  sales_30d:        number | null
  portfolio_count:  number | null
  watchlist_count:  number | null
}

interface Manifest {
  _meta: {
    block: string
    intended_count: number
    status: string
    note: string
    intended_category_totals: Record<string, number>
    placeholder_id_prefix?: string
  }
  entries: PilotEntry[]
}

// --------------------------------------------------------------------
// Manifest structure
// --------------------------------------------------------------------
describe('pilot manifest — structure', () => {
  const m = readJson<Manifest>(MANIFEST_PATH)

  it(`declares block 4B-W-2A and intended count = ${EXPECTED_TOTAL}`, () => {
    expect(m._meta.block).toBe('4B-W-2A')
    expect(m._meta.intended_count).toBe(EXPECTED_TOTAL)
  })

  it(`declares intended category totals that sum to ${EXPECTED_TOTAL}`, () => {
    const totals = m._meta.intended_category_totals
    const sum = Object.values(totals).reduce((a, b) => a + b, 0)
    expect(sum).toBe(EXPECTED_TOTAL)
    // Each minimum-coverage category must meet its floor in the scaffold.
    for (const cat of ALLOWED_CATEGORIES) {
      const min = MINIMUM_COVERAGE[cat]
      expect(totals[cat] ?? 0,
        `intended_category_totals.${cat} must be >= ${min}`
      ).toBeGreaterThanOrEqual(min)
    }
  })

  it(`contains exactly ${EXPECTED_TOTAL} entries`, () => {
    expect(m.entries.length).toBe(EXPECTED_TOTAL)
  })

  it('every entry has the brief\'s required fields', () => {
    const required = [
      'provider','provider_card_id','card_slug','card_name','set_name',
      'primary_category','selection_reason','confidence','is_sealed',
      'raw_price_cents','psa9_price_cents','psa10_price_cents',
      'sales_30d','portfolio_count','watchlist_count',
    ] as const
    for (let i = 0; i < m.entries.length; i++) {
      const e = m.entries[i]
      for (const f of required) {
        expect(e, `entry[${i}] missing ${f}`).toHaveProperty(f)
      }
    }
  })
})

// --------------------------------------------------------------------
// Identity rules
// --------------------------------------------------------------------
describe('pilot manifest — identity', () => {
  const m = readJson<Manifest>(MANIFEST_PATH)

  it('every provider is "pricecharting"', () => {
    for (const e of m.entries) expect(e.provider).toBe('pricecharting')
  })

  it('every provider_card_id is a numeric string and unique', () => {
    const ids = new Set<string>()
    for (const e of m.entries) {
      expect(e.provider_card_id, `entry ${e.card_name}`).toMatch(/^[0-9]+$/)
      expect(ids.has(e.provider_card_id), `dup ${e.provider_card_id}`).toBe(false)
      ids.add(e.provider_card_id)
    }
    expect(ids.size).toBe(EXPECTED_TOTAL)
  })

  it('every card_slug is alphanumeric and unique', () => {
    const slugs = new Set<string>()
    for (const e of m.entries) {
      expect(e.card_slug).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(slugs.has(e.card_slug), `dup ${e.card_slug}`).toBe(false)
      slugs.add(e.card_slug)
    }
    expect(slugs.size).toBe(EXPECTED_TOTAL)
  })
})

// --------------------------------------------------------------------
// Category + cohort rules
// --------------------------------------------------------------------
describe('pilot manifest — categories', () => {
  const m = readJson<Manifest>(MANIFEST_PATH)
  const counts: Record<string, number> = {}
  for (const e of m.entries) counts[e.primary_category] = (counts[e.primary_category] || 0) + 1

  it('every primary_category is one of the seven allowed categories', () => {
    for (const e of m.entries) {
      expect(ALLOWED_CATEGORIES as readonly string[]).toContain(e.primary_category)
    }
  })

  it(`cohort sums to exactly ${EXPECTED_TOTAL} and each minimum-coverage category meets its floor`, () => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    expect(total).toBe(EXPECTED_TOTAL)
    for (const cat of ALLOWED_CATEGORIES) {
      const min = MINIMUM_COVERAGE[cat]
      expect(counts[cat] ?? 0, `category ${cat} must have >= ${min}`).toBeGreaterThanOrEqual(min)
    }
  })

  it('sealed-category entries all have is_sealed=true', () => {
    for (const e of m.entries) {
      if (e.primary_category === 'sealed') expect(e.is_sealed).toBe(true)
    }
  })

  // Note: the converse does NOT hold — the general_quality top-up bucket
  // may legitimately include is_sealed=true items (e.g. checklane blisters,
  // eraser blisters) when the sealed pool's top-10 is full.

  it('sparse-category entries either have null sales_30d or sales_30d <= 1', () => {
    for (const e of m.entries) {
      if (e.primary_category === 'sparse') {
        if (typeof e.sales_30d === 'number') expect(e.sales_30d).toBeLessThanOrEqual(1)
      }
    }
  })
})

// --------------------------------------------------------------------
// Confidence + numeric fields
// --------------------------------------------------------------------
describe('pilot manifest — numeric guarantees', () => {
  const m = readJson<Manifest>(MANIFEST_PATH)

  it('every confidence is in [0.900, 1.000]', () => {
    for (const e of m.entries) {
      expect(e.confidence).toBeGreaterThanOrEqual(0.900)
      expect(e.confidence).toBeLessThanOrEqual(1.000)
    }
  })

  it('optional numeric fields are null or non-negative finite numbers', () => {
    const optional = ['raw_price_cents','psa9_price_cents','psa10_price_cents',
                      'sales_30d','portfolio_count','watchlist_count'] as const
    for (const e of m.entries) {
      for (const f of optional) {
        const v = e[f]
        if (v !== null) {
          expect(typeof v).toBe('number')
          expect(Number.isFinite(v)).toBe(true)
          expect(v).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })
})

// --------------------------------------------------------------------
// No PII / private data
// --------------------------------------------------------------------
describe('pilot manifest — no PII', () => {
  const m = readJson<Manifest>(MANIFEST_PATH)
  // PII checks apply to per-entry data. _meta.note is a developer-facing
  // description of the scaffold workflow and is allowed there.
  const entriesText = JSON.stringify(m.entries)
  const rawAll      = readFileSync(MANIFEST_PATH, 'utf8')

  it('entries contain no user_id / owner_id field', () => {
    expect(entriesText).not.toMatch(/"user_id"\s*:/i)
    expect(entriesText).not.toMatch(/"owner_id"\s*:/i)
  })

  it('entries contain no email field and no email-looking values', () => {
    expect(entriesText).not.toMatch(/"email"\s*:/i)
    expect(rawAll).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
  })

  it('entries contain no purchase_price field', () => {
    expect(entriesText).not.toMatch(/"purchase_price/i)
  })

  it('entries contain no notes / note field', () => {
    expect(entriesText).not.toMatch(/"notes?"\s*:/i)
  })
})

// --------------------------------------------------------------------
// Migration body invariants
// --------------------------------------------------------------------
describe('pilot migration — additive and scoped', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8')

  it('only INSERTs into recent_sales_card_allow_list', () => {
    const inserts = sql.match(/INSERT\s+INTO\s+public\.([a-z_]+)/gi) || []
    for (const ins of inserts) {
      expect(ins.toLowerCase()).toBe('insert into public.recent_sales_card_allow_list')
    }
  })

  it('does not INSERT into recent_sales', () => {
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.recent_sales\b/i)
  })

  it('does not INSERT into market_import_runs', () => {
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.market_import_runs\b/i)
  })

  it('does not DELETE / DROP / TRUNCATE anything', () => {
    // Strip comments first so SQL keyword phrases inside notes do not match.
    const noComments = sql.replace(/--[^\n]*/g, '')
    expect(noComments).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(noComments).not.toMatch(/\bDROP\s+(TABLE|INDEX|POLICY|FUNCTION)\b/i)
    expect(noComments).not.toMatch(/\bTRUNCATE\b/i)
  })

  it('uses ON CONFLICT (provider, provider_card_id) for idempotency', () => {
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(\s*provider\s*,\s*provider_card_id\s*\)/i)
  })

  it(`contains a DO $$ post-condition block that asserts ${EXPECTED_TOTAL} pilot rows`, () => {
    expect(sql).toMatch(/DO\s*\$\$/)
    expect(sql).toMatch(new RegExp(`v_pilot_count\\s*<>\\s*${EXPECTED_TOTAL}\\b`))
  })

  it(`contains exactly ${EXPECTED_TOTAL} INSERT VALUES rows between the BEGIN/END markers`, () => {
    const begin = sql.indexOf('-- BEGIN PILOT_ENTRIES')
    const end   = sql.indexOf('-- END PILOT_ENTRIES')
    expect(begin).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(begin)
    const body = sql.slice(begin, end)
    const rows = body.match(/^\s*\('pricecharting'/gm) || []
    expect(rows.length).toBe(EXPECTED_TOTAL)
  })

  it('every VALUES row references the pricecharting provider', () => {
    const rows = sql.match(/^\s*\('([^']+)'/gm) || []
    for (const r of rows) {
      // r looks like "  ('pricecharting"
      const m = r.match(/\('([^']+)'/)
      if (m) expect(m[1]).toBe('pricecharting')
    }
  })
})

// --------------------------------------------------------------------
// SQL verification script matches the migration's invariants
// --------------------------------------------------------------------
describe('verify SQL — matches migration invariants', () => {
  const sql = readFileSync(VERIFY_PATH, 'utf8')

  it('checks for exactly the pilot scope (reason LIKE pilot:%)', () => {
    expect(sql).toMatch(/reason\s+LIKE\s+'pilot:%'/i)
  })

  it('verifies Stage-1 invariants (recent_sales empty, runs empty)', () => {
    expect(sql).toMatch(/FROM\s+public\.recent_sales\b/i)
    expect(sql).toMatch(/FROM\s+public\.market_import_runs\b/i)
  })

  it('is read-only (no INSERT/UPDATE/DELETE/DROP/TRUNCATE)', () => {
    const noComments = sql.replace(/--[^\n]*/g, '')
    expect(noComments).not.toMatch(/\bINSERT\b/i)
    expect(noComments).not.toMatch(/\bUPDATE\b/i)
    expect(noComments).not.toMatch(/\bDELETE\b/i)
    expect(noComments).not.toMatch(/\bDROP\b/i)
    expect(noComments).not.toMatch(/\bTRUNCATE\b/i)
    expect(noComments).not.toMatch(/\bALTER\b/i)
  })
})

// --------------------------------------------------------------------
// Selection SQL is read-only
// --------------------------------------------------------------------
describe('selection SQL — read-only', () => {
  const sql = readFileSync(SELECT_PATH, 'utf8')

  it('is read-only (no INSERT/UPDATE/DELETE/DROP/TRUNCATE)', () => {
    const noComments = sql.replace(/--[^\n]*/g, '')
    expect(noComments).not.toMatch(/\bINSERT\s+INTO\b/i)
    expect(noComments).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i)
    expect(noComments).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(noComments).not.toMatch(/\bDROP\b/i)
    expect(noComments).not.toMatch(/\bTRUNCATE\b/i)
    expect(noComments).not.toMatch(/\bALTER\b/i)
  })

  it('enforces eligibility: pricecharting + en + active + confidence >= 0.900', () => {
    expect(sql).toMatch(/provider\s*=\s*'pricecharting'/i)
    expect(sql).toMatch(/language\s*=\s*'en'/i)
    expect(sql).toMatch(/is_active\s*=\s*TRUE/i)
    expect(sql).toMatch(/confidence\s*>=\s*0\.900/i)
  })

  it('caps returns at LIMIT 100 (the selector returns up to 100 — actual cohort may be smaller)', () => {
    expect(sql).toMatch(/LIMIT\s+100\s*;?/i)
  })
})

// --------------------------------------------------------------------
// Public-surface leakage: pilot data must not be imported by UI/route code
// --------------------------------------------------------------------
describe('pilot data — no public surface imports', () => {
  function walk(dir: string, out: string[] = [], skipTests = true): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) {
        if (skipTests && (name === '__tests__' || name === 'node_modules' || name.startsWith('.'))) continue
        walk(p, out, skipTests)
      } else if (/\.(tsx?|mjs|jsx?)$/.test(name)) {
        if (skipTests && /\.test\.[tj]sx?$/.test(name)) continue
        out.push(p)
      }
    }
    return out
  }

  it('no source file under src/ imports the manifest JSON or pilot SQL paths', () => {
    const srcDir = join(ROOT, 'src')
    const files = walk(srcDir)
    for (const f of files) {
      const content = readFileSync(f, 'utf8')
      expect(content, `${f} should not import the pilot manifest`).not.toMatch(/data\/recent-sales-pilot-100\.json/)
      expect(content, `${f} should not reference the pilot SQL`).not.toMatch(/recent-sales-pilot-100\.sql/)
      expect(content, `${f} should not reference the selection script`).not.toMatch(/select-recent-sales-pilot\.sql/)
    }
  })

  it('no source file under src/ references the placeholder ID prefix', () => {
    const srcDir = join(ROOT, 'src')
    const files = walk(srcDir)
    for (const f of files) {
      const content = readFileSync(f, 'utf8')
      expect(content, `${f} should not bake in the placeholder marker`).not.toMatch(/9999999\d{3}/)
    }
  })

  it('no NEXT_PUBLIC_RECENT_SALES_* identifier appears anywhere in src/', () => {
    const srcDir = join(ROOT, 'src')
    const files = walk(srcDir)
    for (const f of files) {
      const content = readFileSync(f, 'utf8')
      expect(content, `${f} contains NEXT_PUBLIC_RECENT_SALES_*`).not.toMatch(/NEXT_PUBLIC_RECENT_SALES_/)
    }
  })
})

// --------------------------------------------------------------------
// Feature flags must still be off / fail closed at the time tests run
// --------------------------------------------------------------------
describe('pilot — feature flags remain off during tests', () => {
  it('all five RECENT_SALES_* flags are unset in process.env at test time', () => {
    for (const k of [
      'RECENT_SALES_INGESTION_ENABLED',
      'RECENT_SALES_ADMIN_VIEW_ENABLED',
      'RECENT_SALES_FREE_PREVIEW_ENABLED',
      'RECENT_SALES_PRO_PREVIEW_ENABLED',
      'RECENT_SALES_FULL_CATALOGUE',
    ]) {
      expect(process.env[k]).toBeUndefined()
    }
  })
})
