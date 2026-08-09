// Block 5A-W-54A — data-coverage regression pins for the card-show
// catalogue expansion. Verifies:
//   * CardShow country union includes au + nz.
//   * COUNTRY_LABEL / CARD_SHOW_COUNTRIES stay in sync.
//   * Helpers accept au + nz without a type error.
//   * Every 54A entry has a source URL (sourceUrl or websiteUrl).
//   * Slugs, IDs and per-country (city + startDate) tuples are unique.
//   * At least the block-spec minimum count landed per country.

import { describe, it, expect } from 'vitest'
import {
  cardShows,
  getCardShowsByCountry,
  getCardShowBySlug,
  getRegionsForCountry,
  CARD_SHOW_COUNTRIES,
  COUNTRY_LABEL,
  type CardShowCountry,
} from '@/data/cardShows'

// ── Country union / labels ──────────────────────────

describe('54A — CardShowCountry union + COUNTRY_LABEL cover 5 markets', () => {
  it('CARD_SHOW_COUNTRIES lists uk / us / ca / au / nz', () => {
    expect(CARD_SHOW_COUNTRIES).toEqual(['uk', 'us', 'ca', 'au', 'nz'])
  })

  it('every code has a human-readable label', () => {
    for (const c of CARD_SHOW_COUNTRIES) {
      expect(COUNTRY_LABEL[c]).toBeTruthy()
      expect(COUNTRY_LABEL[c].length).toBeGreaterThan(2)
    }
    expect(COUNTRY_LABEL.au).toBe('Australia')
    expect(COUNTRY_LABEL.nz).toBe('New Zealand')
  })

  it('helpers accept au + nz (compile-time via runtime call)', () => {
    // Runtime confirmation that these code paths do not throw and
    // return arrays — the type-check confirms the signature.
    for (const c of CARD_SHOW_COUNTRIES) {
      expect(Array.isArray(getCardShowsByCountry(c))).toBe(true)
      expect(Array.isArray(getRegionsForCountry(c))).toBe(true)
    }
  })
})

// ── Data integrity ──────────────────────────────────

describe('54A — data integrity across the whole catalogue', () => {
  it('every card show has a country in the union', () => {
    for (const s of cardShows) {
      expect(CARD_SHOW_COUNTRIES).toContain(s.country as CardShowCountry)
    }
  })

  it('every id is unique', () => {
    const ids = cardShows.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every slug is unique within its country', () => {
    for (const c of CARD_SHOW_COUNTRIES) {
      const slugs = cardShows.filter(s => s.country === c).map(s => s.slug)
      expect(new Set(slugs).size).toBe(slugs.length)
    }
  })

  it('no two events collide on (country, city-lowercase, startDate)', () => {
    // Practical dedupe fingerprint — Trading Card Con Toronto and
    // Sport Card Expo Toronto legitimately share a city but never a
    // date, so this triple must always be unique.
    const seen = new Set<string>()
    for (const s of cardShows) {
      const k = `${s.country}|${s.city.toLowerCase()}|${s.startDate}`
      expect(seen.has(k)).toBe(false)
      seen.add(k)
    }
  })

  it('every startDate parses to a valid ISO yyyy-mm-dd', () => {
    for (const s of cardShows) {
      expect(s.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(new Date(s.startDate).getTime())).toBe(false)
      if (s.endDate) {
        expect(s.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(new Date(s.endDate) >= new Date(s.startDate)).toBe(true)
      }
    }
  })

  it('every 54A-imported entry (lastChecked=2026-08-09) has a source URL', () => {
    // Pre-54A legacy events without a URL are grandfathered in (a few
    // 2026-05 US shows carried no organiser link when originally
    // imported); the source-URL rule is a going-forward standard.
    const missing = cardShows
      .filter(s => s.lastChecked === '2026-08-09')
      .filter(s => !s.websiteUrl && !s.sourceUrl && !s.facebookUrl)
    expect(missing.map(s => s.id)).toEqual([])
  })

  it('slug uses only URL-safe characters (no whitespace, no capitals)', () => {
    for (const s of cardShows) {
      expect(s.slug).toMatch(/^[a-z0-9][a-z0-9-]*$/)
    }
  })
})

// ── AU + NZ implementation coverage ─────────────────

describe('54A — AU + NZ have real event coverage', () => {
  it('AU has at least 5 imported events', () => {
    const au = cardShows.filter(s => s.country === 'au')
    expect(au.length).toBeGreaterThanOrEqual(5)
  })

  it('NZ has at least 2 imported events (Auckland + HobbyCon Tauranga baseline)', () => {
    const nz = cardShows.filter(s => s.country === 'nz')
    expect(nz.length).toBeGreaterThanOrEqual(2)
    const auckland  = nz.find(s => s.city.toLowerCase() === 'auckland')
    const hobbyCon  = nz.find(s => s.name.toLowerCase().includes('hobbycon'))
    expect(auckland).toBeTruthy()
    expect(hobbyCon).toBeTruthy()
  })

  it('AU + NZ events reference their organiser sites in websiteUrl or sourceUrl', () => {
    const auNz = cardShows.filter(s => s.country === 'au' || s.country === 'nz')
    for (const s of auNz) {
      const url = s.websiteUrl || s.sourceUrl
      expect(url).toBeTruthy()
      expect(url!.startsWith('https://')).toBe(true)
    }
  })
})

// ── 54A UK / US / CA baseline additions ─────────────

describe('54A — headline UK / US / CA additions landed', () => {
  const spec = [
    { country: 'uk' as const, slugSuffix: 'spalding-card-show-spalding-2026-08' },
    { country: 'uk' as const, slugSuffix: 'manchester-card-con-manchester-2026-08' },
    { country: 'uk' as const, slugSuffix: 'collectors-showcase-olympia-london-2026-11' },
    { country: 'us' as const, slugSuffix: 'front-row-card-show-las-vegas-2026-08' },
    { country: 'us' as const, slugSuffix: 'front-row-card-show-phoenix-2026-12' },
    { country: 'ca' as const, slugSuffix: 'trading-card-con-montreal-2026-08' },
    { country: 'ca' as const, slugSuffix: 'sport-card-expo-calgary-calgary-2026-09' },
  ]
  for (const s of spec) {
    it(`${s.country.toUpperCase()} contains ${s.slugSuffix}`, () => {
      const show = getCardShowBySlug(s.country, s.slugSuffix)
      expect(show).toBeTruthy()
      expect(show!.country).toBe(s.country)
    })
  }
})

// ── Existing Collect-A-Con entries not duplicated ────

describe('54A — did not duplicate existing Collect-A-Con entries', () => {
  it('each Collect-A-Con city/date fingerprint appears at most once', () => {
    const cac = cardShows.filter(s => s.name.toLowerCase().startsWith('collect-a-con'))
    const seen = new Set<string>()
    for (const s of cac) {
      const k = `${s.city.toLowerCase()}|${s.startDate}`
      expect(seen.has(k)).toBe(false)
      seen.add(k)
    }
  })
})
