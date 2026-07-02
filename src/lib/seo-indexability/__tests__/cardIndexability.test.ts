// Block 5A-W-35 — tests for the card indexability helper.
//
// Fixtures are minimal — mimic the shape the get_card_detail_by_url_slug
// RPC returns and the shape a sitemap-side join would surface.

import { describe, it, expect } from 'vitest'
import {
  MARKET_SIGNAL_PRICE_FIELDS,
  SEALED_SLUG_PATTERNS,
  hasCardIdentity,
  hasMarketSignal,
  isCardIndexable,
  isSealedProductSlug,
  nonIndexableReason,
  type CardIndexabilityInput,
} from '../cardIndexability'

function baseCard(over: Partial<CardIndexabilityInput> = {}): CardIndexabilityInput {
  return {
    card_name:     'Test Card',
    set_name:      'Test Set',
    card_url_slug: 'test-card-1',
    ...over,
  }
}

// ── hasCardIdentity ────────────────────────────────────────────────

describe('hasCardIdentity', () => {
  it('accepts a card with name, set, and url slug', () => {
    expect(hasCardIdentity(baseCard())).toBe(true)
  })
  it('rejects null / undefined', () => {
    expect(hasCardIdentity(null)).toBe(false)
    expect(hasCardIdentity(undefined)).toBe(false)
  })
  it('rejects missing / blank card_name', () => {
    expect(hasCardIdentity(baseCard({ card_name: '' }))).toBe(false)
    expect(hasCardIdentity(baseCard({ card_name: '   ' }))).toBe(false)
    expect(hasCardIdentity(baseCard({ card_name: null }))).toBe(false)
  })
  it('rejects missing / blank set_name', () => {
    expect(hasCardIdentity(baseCard({ set_name: null }))).toBe(false)
    expect(hasCardIdentity(baseCard({ set_name: '' }))).toBe(false)
  })
  it('rejects missing / blank card_url_slug', () => {
    expect(hasCardIdentity(baseCard({ card_url_slug: null }))).toBe(false)
    expect(hasCardIdentity(baseCard({ card_url_slug: '' }))).toBe(false)
  })
})

// ── hasMarketSignal ────────────────────────────────────────────────

describe('hasMarketSignal', () => {
  it('true when raw_usd > 0', () => {
    expect(hasMarketSignal(baseCard({ raw_usd: 100 }))).toBe(true)
  })
  it('true when psa9_usd > 0', () => {
    expect(hasMarketSignal(baseCard({ psa9_usd: 100 }))).toBe(true)
  })
  it('true when psa10_usd > 0', () => {
    expect(hasMarketSignal(baseCard({ psa10_usd: 100 }))).toBe(true)
  })
  it('true for any low-grade or gem-mint tier field', () => {
    for (const field of ['psa7_usd', 'grade1_usd', 'bgs95_usd', 'tag10_usd', 'cgc10pristine_usd'] as const) {
      const c = baseCard({ [field]: 42 })
      expect(hasMarketSignal(c)).toBe(true)
    }
  })
  it('respects a pre-computed has_market_signal alias when set', () => {
    expect(hasMarketSignal(baseCard({ has_market_signal: true }))).toBe(true)
    expect(hasMarketSignal(baseCard({ has_market_signal: false, raw_usd: 100 }))).toBe(false)
  })
  it('false when every price field is null / undefined / zero / negative', () => {
    expect(hasMarketSignal(baseCard())).toBe(false)
    expect(hasMarketSignal(baseCard({
      raw_usd: 0, psa9_usd: 0, psa10_usd: 0,
      psa7_usd: null, psa8_usd: undefined,
    }))).toBe(false)
    expect(hasMarketSignal(baseCard({ raw_usd: -50 }))).toBe(false)
  })
  it('false on null / undefined card', () => {
    expect(hasMarketSignal(null)).toBe(false)
    expect(hasMarketSignal(undefined)).toBe(false)
  })
  it('lists every real RPC price field in the signal list', () => {
    // Regression pin: if a new grade tier lands, adding it to the RPC
    // requires adding it to MARKET_SIGNAL_PRICE_FIELDS.
    expect(MARKET_SIGNAL_PRICE_FIELDS).toContain('raw_usd')
    expect(MARKET_SIGNAL_PRICE_FIELDS).toContain('psa10_usd')
    expect(MARKET_SIGNAL_PRICE_FIELDS).toContain('bgs10black_usd')
    expect(MARKET_SIGNAL_PRICE_FIELDS.length).toBeGreaterThanOrEqual(15)
  })
})

// ── isCardIndexable ────────────────────────────────────────────────

describe('isCardIndexable', () => {
  it('true when identity present AND at least one price signal', () => {
    expect(isCardIndexable(baseCard({ raw_usd: 100 }))).toBe(true)
    expect(isCardIndexable(baseCard({ psa10_usd: 5000 }))).toBe(true)
  })
  it('false when identity is present but no market signal at all', () => {
    // The W35 core case: a card row exists, has a URL, but no prices.
    expect(isCardIndexable(baseCard())).toBe(false)
  })
  it('false when identity is missing even with prices', () => {
    expect(isCardIndexable(baseCard({ card_name: null, raw_usd: 100 }))).toBe(false)
    expect(isCardIndexable(baseCard({ set_name: '',   raw_usd: 100 }))).toBe(false)
  })
  it('does NOT special-case sealed products — sealed with prices is still indexable', () => {
    // The W35 audit found 30 sealed-slug URLs with real GSC traffic.
    // Excluding them would break existing rankings; the price signal
    // is the sole gate.
    const sealed = baseCard({
      card_url_slug: 'blooming-waters-premium-collection-box',
      is_sealed:      true,
      psa10_usd:      3900,
    })
    expect(isSealedProductSlug(sealed.card_url_slug!)).toBe(true)
    expect(isCardIndexable(sealed)).toBe(true)
  })
  it('excludes a truly thin card whose only signal is that it exists', () => {
    const thin = baseCard({
      card_url_slug: 'watchog-71',
    })
    expect(isCardIndexable(thin)).toBe(false)
  })
})

// ── nonIndexableReason ─────────────────────────────────────────────

describe('nonIndexableReason', () => {
  it('returns null when the card is indexable', () => {
    expect(nonIndexableReason(baseCard({ raw_usd: 100 }))).toBeNull()
  })
  it('names the specific missing identity field', () => {
    expect(nonIndexableReason(baseCard({ card_name: null }))).toBe('missing card_name')
    expect(nonIndexableReason(baseCard({ set_name: '' }))).toBe('missing set_name')
    expect(nonIndexableReason(baseCard({ card_url_slug: undefined }))).toBe('missing card_url_slug')
  })
  it('reports "no market signal" for thin cards', () => {
    expect(nonIndexableReason(baseCard())).toBe('no market signal on any grade tier')
  })
  it('reports "no card row" for null input', () => {
    expect(nonIndexableReason(null)).toBe('no card row')
    expect(nonIndexableReason(undefined)).toBe('no card row')
  })
})

// ── isSealedProductSlug ────────────────────────────────────────────

describe('isSealedProductSlug', () => {
  it('detects the well-known patterns', () => {
    expect(isSealedProductSlug('blooming-waters-premium-collection-box')).toBe(true)
    expect(isSealedProductSlug('booster-pack-series-2')).toBe(true)
    expect(isSealedProductSlug('build-battle-display-box')).toBe(true)
    expect(isSealedProductSlug('azure-legends-tin-kyogre-ex-international')).toBe(true)
    expect(isSealedProductSlug('bodyguard-theme-deck')).toBe(true)
  })
  it('does not trigger on ordinary card slugs', () => {
    for (const slug of ['pikachu-birthday-24', 'greninja-gold-star-swsh144', 'umbreon-vmax-215']) {
      expect(isSealedProductSlug(slug)).toBe(false)
    }
  })
  it('is case-insensitive', () => {
    expect(isSealedProductSlug('BOOSTER-BOX')).toBe(true)
    expect(isSealedProductSlug('Some-Booster-Bundle')).toBe(true)
  })
  it('handles null / empty / undefined', () => {
    expect(isSealedProductSlug(null)).toBe(false)
    expect(isSealedProductSlug(undefined)).toBe(false)
    expect(isSealedProductSlug('')).toBe(false)
  })
  it('SEALED_SLUG_PATTERNS is a non-empty readonly string array', () => {
    expect(Array.isArray(SEALED_SLUG_PATTERNS)).toBe(true)
    expect(SEALED_SLUG_PATTERNS.length).toBeGreaterThan(5)
    for (const p of SEALED_SLUG_PATTERNS) expect(typeof p).toBe('string')
  })
})

// ── Safety regression pins ─────────────────────────────────────────

describe('regression: real cards from GSC top-1000 must remain indexable', () => {
  // These 5 URLs are among the top card opportunities from the W33B
  // analyser. They MUST stay indexable — treat this test as a canary.
  it.each([
    ['Celebrations',    'greninja-gold-star-swsh144',  1500],
    ['Evolving Skies',  'umbreon-vmax-215',            42000],
    ['Celebrations',    'pikachu-birthday-24',         800],
    ['Promo',           'lucario-vstar-swsh291',       1200],
    ['Crown Zenith',    'giratina-vstar-gg69',         6000],
  ])('%s / %s stays indexable when it has any price', (setName, slug, price) => {
    const c = baseCard({
      card_name:     slug,
      set_name:      setName,
      card_url_slug: slug,
      psa10_usd:     price,
    })
    expect(isCardIndexable(c)).toBe(true)
  })
})
