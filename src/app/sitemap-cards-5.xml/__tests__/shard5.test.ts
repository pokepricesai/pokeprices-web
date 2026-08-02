// Block 5A-W-50D — pin the new shard-5 coverage window.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/sitemap-cards-5.xml/route.ts'),
  'utf8',
)

describe('sitemap-cards-5.xml', () => {
  it('imports the shared indexability helper (same predicate as other shards)', () => {
    expect(SRC).toContain("import { fetchIndexableCardBatch, renderCardSitemapXml } from '@/lib/seo-indexability/sitemapCards'")
  })

  it('covers row positions [50000, 100000) — extends past the prior 50k cap', () => {
    expect(SRC).toMatch(/fetchIndexableCardBatch\(supabase,\s*50000,\s*100000\)/)
  })

  it('emits absolute www.pokeprices.io URLs', () => {
    expect(SRC).toContain("const BASE_URL = 'https://www.pokeprices.io'")
    expect(SRC).toContain('renderCardSitemapXml(BASE_URL, result.cards)')
  })

  it('does not remove or rename existing shards (regression pin)', () => {
    // Shard 5 is additive — existence must not require touching the
    // other four shard files.
    for (const shard of [1, 2, 3, 4]) {
      expect(
        () => readFileSync(join(process.cwd(), `src/app/sitemap-cards-${shard}.xml/route.ts`), 'utf8'),
      ).not.toThrow()
    }
  })
})
