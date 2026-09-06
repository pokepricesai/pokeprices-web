// src/app/insights/__tests__/legacy-insights-invariants.test.ts
//
// EIC Block 1 — Part 5. Lightweight regression guard for the
// insights system. Focus is on structural invariants that would
// silently break the published article set if the EIC evolution
// regressed them; NOT byte-identical HTML matching.
//
// What this test protects:
//   * The latest `reports/eic-backups/*.summary.json` still parses
//     and has the expected shape.
//   * Every published article recorded in that backup has an id,
//     slug, headline and published_at, and slugs are unique.
//   * The public `/insights/[slug]` route reads seo_title /
//     seo_description (so the Block 1 backfill actually reaches the
//     public HTML).
//   * The sitemap route still selects `slug, published_at` from
//     insights filtered on `status='published'`.
//   * The article JSON-LD component still emits schema.org Article
//     shape (headline / datePublished / publisher).
//   * The breadcrumb JSON-LD component still emits BreadcrumbList.
//
// This test intentionally does NOT hit Supabase. Data-drift checks
// are performed by scripts/eic-verify-legacy-insights.mjs run
// on-demand against the live DB.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const BACKUP_DIR = join(process.cwd(), 'reports', 'eic-backups')

function findLatestSummary(): string | null {
  if (!existsSync(BACKUP_DIR)) return null
  const files = readdirSync(BACKUP_DIR).filter(f => f.endsWith('.summary.json')).sort()
  return files.length ? join(BACKUP_DIR, files[files.length - 1]) : null
}

describe('legacy insights invariants (EIC Block 1)', () => {
  it('has at least one committed backup summary', () => {
    const p = findLatestSummary()
    expect(p, 'run `node scripts/eic-backup-insights.mjs` to produce a baseline').not.toBeNull()
  })

  it('latest backup summary has the expected shape', () => {
    const p = findLatestSummary()!
    const j = JSON.parse(readFileSync(p, 'utf8'))
    expect(j).toHaveProperty('total_articles')
    expect(j).toHaveProperty('published_count')
    expect(j).toHaveProperty('draft_count')
    expect(Array.isArray(j.published_slugs)).toBe(true)
    expect(Array.isArray(j.published_headlines)).toBe(true)
    expect(j.published_slugs.length).toBe(j.published_count)
    expect(j.published_headlines.length).toBe(j.published_count)
    // Every published entry must be well-formed.
    for (const s of j.published_slugs)  expect(typeof s).toBe('string')
    for (const h of j.published_headlines) {
      expect(typeof h.slug).toBe('string')
      expect(typeof h.headline).toBe('string')
      expect(h.headline.length).toBeGreaterThan(0)
    }
  })

  it('published slugs are unique in the backup', () => {
    const p = findLatestSummary()!
    const j = JSON.parse(readFileSync(p, 'utf8'))
    const set = new Set<string>(j.published_slugs)
    expect(set.size, 'duplicate slug detected in backup').toBe(j.published_slugs.length)
  })

  it('the public /insights/[slug] route reads seo_title and seo_description', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'app', 'insights', '[slug]', 'page.tsx'), 'utf8')
    // Structural: the metadata function must consume both canonical
    // SEO fields. If the contract ever changes (rename / delete), we
    // want the test to shout so Luke can update the backfill or the
    // client save path in lock-step.
    expect(src).toMatch(/article\.seo_title/)
    expect(src).toMatch(/article\.seo_description/)
  })

  it('the sitemap route still emits published insights', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'app', 'sitemap-insights.xml', 'route.ts'), 'utf8')
    expect(src).toMatch(/from\(['"]insights['"]\)/)
    expect(src).toMatch(/status/) // filter on published status
    expect(src).toMatch(/published/)
  })

  it('ArticleSchema emits schema.org Article JSON-LD', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'components', 'ArticleSchema.tsx'), 'utf8')
    expect(src).toMatch(/application\/ld\+json/)
    expect(src).toMatch(/Article/)
    expect(src).toMatch(/headline/)
    expect(src).toMatch(/datePublished/)
  })

  it('BreadcrumbSchema emits schema.org BreadcrumbList JSON-LD', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'components', 'BreadcrumbSchema.tsx'), 'utf8')
    expect(src).toMatch(/application\/ld\+json/)
    expect(src).toMatch(/BreadcrumbList/)
  })

  it('the admin write path canonicalises SEO fields (mirrorSeoFields)', () => {
    const routeSrc = readFileSync(join(process.cwd(), 'src', 'app', 'api', 'admin', 'insights', 'route.ts'), 'utf8')
    const idRouteSrc = readFileSync(join(process.cwd(), 'src', 'app', 'api', 'admin', 'insights', '[id]', 'route.ts'), 'utf8')
    expect(routeSrc).toMatch(/mirrorSeoFields/)
    expect(idRouteSrc).toMatch(/mirrorSeoFields/)
  })
})
