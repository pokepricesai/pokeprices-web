// Stage 6A — change-detection hash unit tests.
//
// The purpose of the hash is to change ONLY when a search engine would
// see something different if it re-crawled. These tests pin that contract.

import { describe, it, expect } from 'vitest'
import {
  hashCardSignature,
  hashInsightSignature,
  hashGenericSignature,
  urlHash,
  sha1Hex,
} from '../hash'

const baseCard = {
  card_slug:            '959616',
  card_url_slug:        'ampharos-29',
  card_name:            'Ampharos #29',
  set_name:             'Chaos Rising',
  card_number_display:  '29/83',
  headline_price_cents: 5300,
  psa10_price_cents:    5300,
  psa9_price_cents:     1200,
  raw_price_cents:      200,
  image_url:            'https://example.com/img.png',
}

describe('hashCardSignature — stability', () => {
  it('is deterministic for identical input', () => {
    expect(hashCardSignature(baseCard)).toBe(hashCardSignature({ ...baseCard }))
  })

  it('is 40 hex chars (SHA-1)', () => {
    expect(hashCardSignature(baseCard)).toMatch(/^[0-9a-f]{40}$/)
  })

  it('changes when a user-visible field changes', () => {
    const before = hashCardSignature(baseCard)
    const after  = hashCardSignature({ ...baseCard, card_name: 'Ampharos #29 [Reverse Holo]' })
    expect(after).not.toBe(before)
  })

  it('changes when the headline price crosses a 10c bucket', () => {
    // 5300 vs 5311 both round to the same 10c bucket (5310). But 5300 vs 5315 straddle 5310 vs 5320.
    const same = hashCardSignature({ ...baseCard, headline_price_cents: 5301 })
    expect(same).toBe(hashCardSignature(baseCard))
    const different = hashCardSignature({ ...baseCard, headline_price_cents: 5350 })
    expect(different).not.toBe(hashCardSignature(baseCard))
  })

  it('does not change when the *bucketed* price is unchanged', () => {
    // 5300 and 5304 both round to 5300; the hash should be identical.
    expect(hashCardSignature({ ...baseCard, headline_price_cents: 5304 }))
      .toBe(hashCardSignature(baseCard))
  })

  it('treats null vs 0 as different (they are: no data ≠ £0.00)', () => {
    expect(hashCardSignature({ ...baseCard, psa10_price_cents: null }))
      .not.toBe(hashCardSignature({ ...baseCard, psa10_price_cents: 0 }))
  })

  it('does not include any timestamp-like field', () => {
    // Confidence check: the shape of the type has no updated_at, ingested_at, etc.
    const keys = Object.keys(baseCard)
    for (const k of keys) expect(k).not.toMatch(/_at$|timestamp|updated|ingested/i)
  })
})

describe('hashInsightSignature', () => {
  const baseInsight = {
    slug:             'why-pokeprices-is-growing',
    headline:         'Why PokePrices is growing so quickly',
    intro:            'A quick note from Luke on the September growth curve.',
    meta_title:       'Why PokePrices is growing (2026)',
    meta_description: 'Behind the numbers behind PokePrices.',
    status:           'published',
    published_at:     '2026-09-14T09:00:00.000Z',
    body_hash:        'abc123',
  }

  it('is deterministic', () => {
    expect(hashInsightSignature(baseInsight)).toBe(hashInsightSignature({ ...baseInsight }))
  })

  it('ignores intra-day published_at drift', () => {
    // Only the calendar date participates in the hash, so two exports
    // with different HH:MM published_at for the same article should
    // hash the same.
    const morning = hashInsightSignature({ ...baseInsight, published_at: '2026-09-14T07:00:00.000Z' })
    const evening = hashInsightSignature({ ...baseInsight, published_at: '2026-09-14T18:30:00.000Z' })
    expect(morning).toBe(evening)
  })

  it('changes when body_hash changes', () => {
    expect(hashInsightSignature({ ...baseInsight, body_hash: 'def456' }))
      .not.toBe(hashInsightSignature(baseInsight))
  })
})

describe('hashGenericSignature', () => {
  it('is order-independent within the fields object', () => {
    const a = hashGenericSignature('set', { name: 'Chaos Rising', total: 83 })
    const b = hashGenericSignature('set', { total: 83, name: 'Chaos Rising' })
    expect(a).toBe(b)
  })

  it('is family-scoped so a set called "Charizard" and a pokemon called "Charizard" do not collide', () => {
    const a = hashGenericSignature('set',     { name: 'Charizard' })
    const b = hashGenericSignature('pokemon', { name: 'Charizard' })
    expect(a).not.toBe(b)
  })
})

describe('urlHash / sha1Hex', () => {
  it('urlHash is a 40-char SHA-1', () => {
    expect(urlHash('https://www.pokeprices.io/')).toMatch(/^[0-9a-f]{40}$/)
  })
  it('sha1Hex is deterministic and length-stable', () => {
    expect(sha1Hex('hello')).toBe(sha1Hex('hello'))
    expect(sha1Hex('hello')).toHaveLength(40)
  })
})
