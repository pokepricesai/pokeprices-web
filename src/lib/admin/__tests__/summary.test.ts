// Block 5A-W-47C — pure tests for the admin dashboard summary
// helpers. No network, no React — just the derivation rules.

import { describe, it, expect } from 'vitest'
import {
  parseCountRange,
  formatMetric,
  UNAVAILABLE,
  deriveAttention,
  priceStalenessDays,
  mergeActivity,
  humanTimeAgo,
} from '../summary'

// ── parseCountRange ──

describe('parseCountRange', () => {
  it('parses the standard "0-9/123" shape', () => {
    expect(parseCountRange('0-9/123')).toBe(123)
  })
  it('parses "*/0"', () => {
    expect(parseCountRange('*/0')).toBe(0)
  })
  it('parses "0-0/456"', () => {
    expect(parseCountRange('0-0/456')).toBe(456)
  })
  it('returns null when the total is "*" (unbounded)', () => {
    expect(parseCountRange('0-0/*')).toBeNull()
  })
  it('returns null for null / empty / non-matching', () => {
    expect(parseCountRange(null)).toBeNull()
    expect(parseCountRange(undefined)).toBeNull()
    expect(parseCountRange('')).toBeNull()
    expect(parseCountRange('nonsense')).toBeNull()
  })
})

// ── formatMetric ──

describe('formatMetric', () => {
  it('formats numbers with en-GB thousand separators', () => {
    expect(formatMetric(41477)).toBe('41,477')
    expect(formatMetric(0)).toBe('0')
    expect(formatMetric(1)).toBe('1')
  })
  it('emits "Unavailable" for the sentinel', () => {
    expect(formatMetric(UNAVAILABLE)).toBe('Unavailable')
  })
  it('distinguishes zero from unavailable (regression pin)', () => {
    expect(formatMetric(0)).not.toBe(formatMetric(UNAVAILABLE))
  })
})

// ── priceStalenessDays ──

describe('priceStalenessDays', () => {
  it('same-day → 0', () => {
    expect(priceStalenessDays('2026-07-27', '2026-07-27')).toBe(0)
  })
  it('one day gap → 1', () => {
    expect(priceStalenessDays('2026-07-26', '2026-07-27')).toBe(1)
  })
  it('multi-day gap', () => {
    expect(priceStalenessDays('2026-07-20', '2026-07-27')).toBe(7)
  })
  it('latest > today coerces to 0 (never negative)', () => {
    expect(priceStalenessDays('2026-07-28', '2026-07-27')).toBe(0)
  })
  it('null / malformed inputs return null', () => {
    expect(priceStalenessDays(null, '2026-07-27')).toBeNull()
    expect(priceStalenessDays('2026-07-27', 'garbage')).toBeNull()
    expect(priceStalenessDays('not-a-date', '2026-07-27')).toBeNull()
    expect(priceStalenessDays(undefined, '2026-07-27')).toBeNull()
  })
})

// ── deriveAttention ──

const CALM: import('../summary').AttentionInput = {
  draftArticles: 0, pendingCreators: 0, pendingVendors: 0,
  latestPriceDate: '2026-07-27', today: '2026-07-27',
}

describe('deriveAttention', () => {
  it('empty when everything is calm (no drafts, no pending, fresh prices)', () => {
    expect(deriveAttention(CALM)).toEqual([])
  })
  it('surfaces draft articles', () => {
    const out = deriveAttention({ ...CALM, draftArticles: 3 })
    expect(out).toHaveLength(1)
    expect(out[0].key).toBe('draft-articles')
    expect(out[0].count).toBe(3)
    expect(out[0].href).toBe('/admin/insights')
    expect(out[0].reason).toContain('3 drafts')
  })
  it('handles single-vs-plural in labels', () => {
    const one = deriveAttention({ ...CALM, draftArticles: 1 })[0]
    expect(one.reason).toContain('1 draft ')
    expect(one.reason).not.toContain('drafts')
  })
  it('FIX1 — pending creators surface as INFORMATIONAL (no misleading moderation link)', () => {
    const out = deriveAttention({ ...CALM, pendingCreators: 2 })
    expect(out.map(a => a.key)).toEqual(['pending-creators'])
    expect(out[0].href).toBeNull()
    expect(out[0].informational).toBe(true)
    // The reason text explicitly notes that no admin review tool exists.
    expect(out[0].reason).toMatch(/no admin review tool/i)
    // And critically — the label must NOT pretend this is a review action.
    expect(out[0].label.toLowerCase()).not.toContain('pending review')
  })
  it('Block 5A-W-50A — pending vendors are actionable and link to /admin/vendors', () => {
    const out = deriveAttention({ ...CALM, pendingVendors: 5 })
    expect(out.map(a => a.key)).toEqual(['pending-vendors'])
    expect(out[0].href).toBe('/admin/vendors')
    expect(out[0].informational).toBe(false)
    expect(out[0].reason).toMatch(/moderation tool/i)
    expect(out[0].label.toLowerCase()).not.toContain('pending review')
  })
  it('surfaces stale price data when > 2 days old', () => {
    const out = deriveAttention({ ...CALM, latestPriceDate: '2026-07-20', today: '2026-07-27' })
    expect(out.map(a => a.key)).toContain('stale-prices')
    expect(out.find(a => a.key === 'stale-prices')?.count).toBe(7)
  })
  it('does NOT flag 1-day price gap as stale (staleness threshold is > 2 days)', () => {
    expect(deriveAttention({ ...CALM, latestPriceDate: '2026-07-26', today: '2026-07-27' })).toEqual([])
    expect(deriveAttention({ ...CALM, latestPriceDate: '2026-07-25', today: '2026-07-27' })).toEqual([])
  })
  it('does NOT surface an UNAVAILABLE metric as attention (regression pin: never treat unavailable as a signal)', () => {
    const out = deriveAttention({
      ...CALM,
      draftArticles:   UNAVAILABLE,
      pendingCreators: UNAVAILABLE,
      pendingVendors:  UNAVAILABLE,
    })
    expect(out).toEqual([])
  })
  it('composes multiple signals in a deterministic order', () => {
    const out = deriveAttention({
      draftArticles: 2, pendingCreators: 1, pendingVendors: 3,
      latestPriceDate: '2026-07-20', today: '2026-07-27',
    })
    expect(out.map(a => a.key)).toEqual([
      'draft-articles', 'pending-creators', 'pending-vendors', 'stale-prices',
    ])
  })
})

// ── mergeActivity ──

const NOW = new Date('2026-07-27T12:00:00Z')

describe('mergeActivity', () => {
  it('returns [] when all sources are empty', () => {
    expect(mergeActivity({ insights: [], creators: [], vendors: [] }, NOW)).toEqual([])
  })
  it('orders newest first across sources', () => {
    const out = mergeActivity({
      insights: [{ id: 'i1', headline: 'A', created_at: '2026-07-25T00:00:00Z', status: 'draft' }],
      creators: [{ id: 'c1', name: 'C', created_at: '2026-07-27T00:00:00Z', status: 'approved' }],
      vendors:  [{ id: 'v1', name: 'V', created_at: '2026-07-26T00:00:00Z', active: false }],
    }, NOW)
    expect(out.map(r => r.source)).toEqual(['creator', 'vendor', 'insight'])
  })
  it('drops rows without a created_at (no fabricated timestamps)', () => {
    const out = mergeActivity({
      insights: [
        { id: 'ok', headline: 'ok', created_at: '2026-07-25T00:00:00Z' },
        { id: 'nope', headline: 'no timestamp' },
      ],
      creators: [], vendors: [],
    }, NOW)
    expect(out).toHaveLength(1)
    expect((out[0].key)).toContain('ok')
  })
  it('caps at 8 by default', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: 'i' + i, headline: 'H' + i, created_at: `2026-06-${(i + 1).toString().padStart(2, '0')}T00:00:00Z` }))
    expect(mergeActivity({ insights: many, creators: [], vendors: [] }, NOW)).toHaveLength(8)
  })
  it('cap parameter is respected', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: 'i' + i, headline: 'H' + i, created_at: `2026-06-${(i + 1).toString().padStart(2, '0')}T00:00:00Z` }))
    expect(mergeActivity({ insights: many, creators: [], vendors: [] }, NOW, 3)).toHaveLength(3)
  })
  it('FIX1 — creator/vendor rows link to the INDIVIDUAL profile when a slug is present (not the public directory landing)', () => {
    const out = mergeActivity({
      insights: [{ headline: 'A', slug: 'a-slug', created_at: '2026-07-25T00:00:00Z' }],
      creators: [{ name: 'C', slug: 'c-slug', created_at: '2026-07-25T00:00:00Z' }],
      vendors:  [{ name: 'V', slug: 'v-slug', created_at: '2026-07-25T00:00:00Z' }],
    }, NOW)
    // Insights link to the admin editor — a real admin action.
    expect(out.find(r => r.source === 'insight')?.href).toBe('/admin/insights')
    // Creator/vendor link to the individual profile page — genuinely
    // useful; NOT to the public directory landing.
    expect(out.find(r => r.source === 'creator')?.href).toBe('/creators/c-slug')
    expect(out.find(r => r.source === 'vendor')?.href).toBe('/vendors/v-slug')
  })
  it('FIX1 — creator/vendor rows WITHOUT a slug render href as null (no misleading directory link)', () => {
    const out = mergeActivity({
      insights: [],
      creators: [{ name: 'C-no-slug', created_at: '2026-07-25T00:00:00Z' }],
      vendors:  [{ name: 'V-no-slug', created_at: '2026-07-25T00:00:00Z' }],
    }, NOW)
    expect(out.find(r => r.source === 'creator')?.href).toBeNull()
    expect(out.find(r => r.source === 'vendor')?.href).toBeNull()
  })
})

describe('humanTimeAgo', () => {
  it('< 1 min → "just now"', () => {
    expect(humanTimeAgo('2026-07-27T11:59:30Z', NOW)).toBe('just now')
  })
  it('minutes', () => {
    expect(humanTimeAgo('2026-07-27T11:55:00Z', NOW)).toBe('5 min ago')
  })
  it('hours', () => {
    expect(humanTimeAgo('2026-07-27T09:00:00Z', NOW)).toBe('3 h ago')
  })
  it('days', () => {
    expect(humanTimeAgo('2026-07-25T12:00:00Z', NOW)).toBe('2 d ago')
  })
  it('months', () => {
    expect(humanTimeAgo('2026-04-27T12:00:00Z', NOW)).toBe('3 mo ago')
  })
  it('years', () => {
    expect(humanTimeAgo('2024-07-27T12:00:00Z', NOW)).toBe('2 y ago')
  })
  it('empty string on malformed input', () => {
    expect(humanTimeAgo('not a date', NOW)).toBe('')
  })
})
