// Block 4B-W-1 — codifies the "no behaviour change" guarantee.
//
// Every test here is a static scan of the repository (no DB, no
// fetch). If a future block accidentally couples recent-sales code
// to the public card page, AI assistant, or an unintended env var
// shape, this file fails first.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const REPO_ROOT = process.cwd()
const SRC       = path.join(REPO_ROOT, 'src')

function readSafe(rel: string): string {
  const full = path.join(REPO_ROOT, rel)
  return existsSync(full) ? readFileSync(full, 'utf8') : ''
}

function walk(dir: string, opts: { skipTests?: boolean } = {}): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'coverage') continue
    if (opts.skipTests && name === '__tests__') continue
    const full = path.join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walk(full, opts))
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) {
      // Skip the leakage test file itself — its negation assertions
      // contain the very strings it's scanning for.
      if (opts.skipTests && /\.test\.(ts|tsx|js|jsx|mjs)$/.test(name)) continue
      out.push(full)
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────
// 1. No NEXT_PUBLIC recent-sales env vars anywhere
// ─────────────────────────────────────────────────────────────────────

describe('NEXT_PUBLIC leakage', () => {
  it('no NEXT_PUBLIC_RECENT_SALES* identifier appears in src/ outside tests', () => {
    const files = walk(SRC, { skipTests: true })
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      expect(text).not.toMatch(/NEXT_PUBLIC_RECENT_SALES/i)
    }
  })

  it('no NEXT_PUBLIC_RECENT_SALES* identifier appears in .env.example', () => {
    const env = readSafe('.env.example')
    expect(env).not.toMatch(/NEXT_PUBLIC_RECENT_SALES/i)
  })

  it('every RECENT_SALES_* entry in the env catalogue is server-scope only', () => {
    const env = readSafe('src/lib/env.ts')
    // Extract every catalogue block that mentions RECENT_SALES_ and
    // confirm its scope is "server".
    const blocks = env.match(/\{[^{}]*?RECENT_SALES_[^{}]*?\}/g) ?? []
    expect(blocks.length).toBeGreaterThan(0)
    for (const b of blocks) {
      expect(b).toMatch(/scope:\s*'server'/)
      expect(b).not.toMatch(/scope:\s*'public'/)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────
// 2. No card-page (or other public) component imports recent-sales code
// ─────────────────────────────────────────────────────────────────────

describe('public surface isolation', () => {
  // CLIENT components and other surfaces that must NEVER import the
  // recent-sales code path. The card-page server component
  // (page.tsx) is excluded — Block 4B-W-4A intentionally imports the
  // server-only loader there.
  const publicClientSurfaces = [
    'src/app/set/[slug]/card/[cardSlug]/CardPageClient.tsx',
    'src/app/set/[slug]/page.tsx',
    'src/app/set/[slug]/SetPageClient.tsx',
    'src/app/pokemon/[slug]/page.tsx',
    'src/app/page.tsx',
    'src/app/layout.tsx',
    'src/components/CardStructuredData.tsx',
    'src/components/SetStructuredData.tsx',
    'src/components/PokemonStructuredData.tsx',
    'src/components/FAQ.tsx',
    'src/lib/faqs.ts',
  ]

  for (const rel of publicClientSurfaces) {
    it(`${rel} does NOT import recent-sales code`, () => {
      const text = readSafe(rel)
      // file may not exist (e.g. on a future rename) — empty string
      // means the test passes trivially; we re-verify presence
      // separately below.
      expect(text).not.toMatch(/from\s+['"]@\/lib\/recentSales/)
      expect(text).not.toMatch(/from\s+['"]@\/lib\/cardSlug/)
      expect(text).not.toMatch(/RECENT_SALES_/)
    })
  }

  it('at least one of the listed public surfaces actually exists (smoke check)', () => {
    const any = publicClientSurfaces.some(rel => readSafe(rel).length > 0)
    expect(any).toBe(true)
  })

  // Block 4B-W-4A — the card-page server component is allowed to
  // import the server-only loader and the section, but must NOT
  // import the admin query layer or any client-side flag value.
  it('card-page server component imports the recent-sales loader but NOT the admin layer', () => {
    const text = readSafe('src/app/set/[slug]/card/[cardSlug]/page.tsx')
    expect(text.length).toBeGreaterThan(0)
    expect(text).toMatch(/from\s+['"]@\/lib\/recentSales\/cardQueries['"]/)
    expect(text).toMatch(/RecentSalesSection/)
    // Admin queries must never reach the public card page.
    expect(text).not.toMatch(/from\s+['"]@\/lib\/recentSales\/adminQueries['"]/)
  })

  // Block 4B-W-4A — no public surface imports the admin query layer.
  it('admin query layer is not imported by any non-admin file', () => {
    const files = walk(SRC, { skipTests: true })
    for (const f of files) {
      const rel = f.replace(REPO_ROOT + path.sep, '').replace(/\\/g, '/')
      // The admin route + admin page are the only allowed importers.
      if (rel.includes('app/api/admin/recent-sales/')) continue
      if (rel.includes('app/admin/recent-sales/'))      continue
      if (rel === 'src/lib/recentSales/adminQueries.ts') continue
      const text = readFileSync(f, 'utf8')
      expect(text, `${rel} should not import adminQueries`).not.toMatch(
        /from\s+['"]@\/lib\/recentSales\/adminQueries['"]/,
      )
    }
  })

  // The free-preview section component is a SERVER component (no
  // 'use client'); confirm so a future refactor cannot silently make
  // it client-side and pull recentSales code into the browser bundle.
  it('RecentSalesSection is a server component (no "use client")', () => {
    const text = readSafe('src/components/recentSales/RecentSalesSection.tsx')
    expect(text.length).toBeGreaterThan(0)
    // The first 200 chars are headers/comments; check the first non-comment
    // line is NOT a 'use client' directive.
    const stripped = text
      .split('\n')
      .filter(l => !l.trim().startsWith('//') && l.trim() !== '')
      .slice(0, 3)
      .join('\n')
    expect(stripped).not.toMatch(/^['"]use client['"]/m)
  })
})

// ─────────────────────────────────────────────────────────────────────
// 3. No public recent-sales route exists
// ─────────────────────────────────────────────────────────────────────

describe('no public recent-sales routes', () => {
  it('there is no /api/recent-sales/* route (public)', () => {
    const dir = path.join(SRC, 'app', 'api', 'recent-sales')
    expect(existsSync(dir)).toBe(false)
  })

  it('there is no /recent-sales page (public)', () => {
    const dir = path.join(SRC, 'app', 'recent-sales')
    expect(existsSync(dir)).toBe(false)
  })

  // Block 4B-W-3A — the admin-only /admin/recent-sales surface DOES
  // exist now. It must be flag-gated, noindex, and never linked from
  // any public surface. The next describe-block enforces those
  // conditions.
  it('/admin/recent-sales page is flag-gated and noindex', () => {
    const page   = readSafe('src/app/admin/recent-sales/page.tsx')
    const apiRt  = readSafe('src/app/api/admin/recent-sales/inspect/route.ts')
    expect(page.length).toBeGreaterThan(0)
    expect(apiRt.length).toBeGreaterThan(0)
    // Flag-gated via isAdminViewEnabled
    expect(page).toMatch(/isAdminViewEnabled/)
    expect(apiRt).toMatch(/isAdminViewEnabled/)
    // requireAdmin on the API
    expect(apiRt).toMatch(/requireAdmin/)
    // noindex
    expect(page).toMatch(/robots:\s*\{\s*index:\s*false/)
    // notFound when flag is off
    expect(page).toMatch(/notFound\(\)/)
    // No public navigation link to /admin/recent-sales anywhere in src/
    const files = walk(SRC, { skipTests: true })
    for (const f of files) {
      // skip the page + route + tests themselves
      if (f.includes(path.join('admin','recent-sales'))) continue
      if (f.includes(path.join('api','admin','recent-sales'))) continue
      const t = readFileSync(f, 'utf8')
      expect(t, `${f} should not link to /admin/recent-sales`).not.toMatch(/['"]\/admin\/recent-sales['"]/)
    }
  })

  it('robots.txt disallows /admin', () => {
    const robots = readSafe('src/app/robots.ts')
    expect(robots).toMatch(/['"]\/admin['"]/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// 4. No existing pricing RPC was renamed or removed
// ─────────────────────────────────────────────────────────────────────

describe('current RPC surface unchanged', () => {
  // The brief asserts: "no current RPC changed". We assert presence of
  // the well-known RPCs that the audit found in active call sites.
  const expectedRpcs = [
    'get_card_detail_by_url_slug',
    'get_card_price_history',
    'get_watchlist_with_prices',
    'get_alerts_with_prices',
  ]

  it('every documented RPC is still referenced somewhere in src/', () => {
    const files = walk(SRC)
    const all = files.map(f => readFileSync(f, 'utf8')).join('\n')
    for (const rpc of expectedRpcs) {
      expect(all).toContain(rpc)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────
// 5. The new migration is additive (no DROP / TRUNCATE / ALTER TABLE
//    on existing tables outside the migration's own scope)
// ─────────────────────────────────────────────────────────────────────

describe('migration safety', () => {
  const migrationPath = 'migrations/2026-06-17-recent-sales-stage-1.sql'

  it('exists', () => {
    expect(readSafe(migrationPath).length).toBeGreaterThan(0)
  })

  it('contains no DROP TABLE / TRUNCATE / ALTER on pre-existing tables', () => {
    const sql = readSafe(migrationPath)
    // Drop / Truncate of pre-existing tables would be destructive.
    // The migration's own DROP POLICY IF EXISTS lines target policies
    // we created in the same file — harmless and idempotent.
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i)
    expect(sql).not.toMatch(/\bTRUNCATE\b/i)
    // No ALTER on tables we don't own:
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+public\.cards\b/i)
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+public\.daily_prices\b/i)
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+public\.card_trends\b/i)
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+public\.card_volume\b/i)
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+public\.psa_population\b/i)
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+public\.watchlist\b/i)
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+public\.portfolio_items\b/i)
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+public\.user_alerts\b/i)
  })

  it('enables RLS on every new table', () => {
    const sql = readSafe(migrationPath)
    for (const t of [
      'provider_card_links','market_import_runs',
      'recent_sales','recent_sales_card_allow_list',
    ]) {
      const re = new RegExp(`ALTER\\s+TABLE\\s+public\\.${t}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i')
      expect(sql).toMatch(re)
    }
  })

  it('declares provider_sale_key UNIQUE but raw_hash + marketplace_item_id non-unique', () => {
    const raw = readSafe(migrationPath)
    expect(raw).toMatch(/provider_sale_key\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i)
    // Strip SQL line comments before scanning — the column declarations
    // deliberately CONTAIN "-- INTENTIONALLY NOT UNIQUE" as documentation.
    const sql = raw.replace(/--[^\n]*/g, '')
    // raw_hash must NOT carry a UNIQUE constraint inline.
    expect(sql).not.toMatch(/raw_hash[^,\n]*UNIQUE/i)
    // marketplace_item_id must NOT carry a UNIQUE constraint inline.
    expect(sql).not.toMatch(/marketplace_item_id[^,\n]*UNIQUE/i)
    // And no separate UNIQUE INDEX on either.
    expect(sql).not.toMatch(/CREATE\s+UNIQUE\s+INDEX[^;]*raw_hash/i)
    expect(sql).not.toMatch(/CREATE\s+UNIQUE\s+INDEX[^;]*marketplace_item_id/i)
  })

  it('parse_confidence uses the 0-100 integer scale, NOT 0-1', () => {
    const sql = readSafe(migrationPath)
    expect(sql).toMatch(/parse_confidence\s+INT\s+NOT\s+NULL\s+CHECK\s*\(parse_confidence\s+BETWEEN\s+0\s+AND\s+100\)/i)
    // Defensive: ensure we did not also accept the 0-1 scale anywhere.
    expect(sql).not.toMatch(/parse_confidence[^,]*BETWEEN\s+0\s+AND\s+1[\s,)]/i)
  })

  it('inserts ZERO rows into recent_sales, allow_list, or market_import_runs', () => {
    const sql = readSafe(migrationPath)
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.recent_sales\b/i)
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.recent_sales_card_allow_list\b/i)
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.market_import_runs\b/i)
  })

  it('backfills ONLY provider_card_links and ON CONFLICT DO NOTHING', () => {
    const sql = readSafe(migrationPath)
    expect(sql).toMatch(/INSERT\s+INTO\s+public\.provider_card_links/i)
    expect(sql).toMatch(/ON\s+CONFLICT\s*\([^)]+\)\s*DO\s+NOTHING/i)
  })
})
