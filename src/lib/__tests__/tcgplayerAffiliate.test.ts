// src/lib/__tests__/tcgplayerAffiliate.test.ts
// Unit tests for the TCGplayer Impact affiliate URL builder.
// Verifies the deep-link format proven in CN-05 Sprint 4:
//   partner.tcgplayer.com/k4EaNV?u={encoded_dest}&sharedid={subid}

import { describe, it, expect } from 'vitest'
import { buildTcgplayerLink } from '../tcgplayerAffiliate'

describe('buildTcgplayerLink — search path', () => {
  it('emits a per-game search URL wrapped in the Impact partner link when no productId is supplied', () => {
    const r = buildTcgplayerLink({ cardName: 'Charizard', game: 'pokemon' })
    expect(r.isExact).toBe(false)
    expect(r.label).toBe('Find this card on TCGplayer')
    const u = new URL(r.href)
    expect(u.host).toBe('partner.tcgplayer.com')
    expect(u.pathname).toBe('/k4EaNV')
    const dest = u.searchParams.get('u')
    expect(dest).not.toBeNull()
    expect(dest).toContain('tcgplayer.com/search/pokemon/product')
    expect(dest).toContain('q=Charizard')
  })

  it('maps each supported game to the correct TCGplayer category slug', () => {
    const games = [
      ['pokemon',             'pokemon'],
      ['magic',               'magic'],
      ['yugioh',              'yugioh'],
      ['one-piece-card-game', 'one-piece-card-game'],
      ['lorcana',             'lorcana'],
    ] as const
    for (const [input, expected] of games) {
      const r = buildTcgplayerLink({ cardName: 'x', game: input })
      const dest = new URL(r.href).searchParams.get('u')!
      expect(dest).toContain(`tcgplayer.com/search/${expected}/product`)
    }
  })

  it('passes a sharedid when supplied and caps at 70 chars', () => {
    const short = buildTcgplayerLink({ cardName: 'x', game: 'pokemon', subid: 'pp:card:abc' })
    expect(new URL(short.href).searchParams.get('sharedid')).toBe('pp:card:abc')

    const long = buildTcgplayerLink({ cardName: 'x', game: 'pokemon', subid: 'a'.repeat(100) })
    expect(new URL(long.href).searchParams.get('sharedid')!.length).toBe(70)
  })

  it('does not emit a sharedid when none is supplied', () => {
    const r = buildTcgplayerLink({ cardName: 'x', game: 'pokemon' })
    expect(new URL(r.href).searchParams.has('sharedid')).toBe(false)
  })
})

describe('buildTcgplayerLink — exact product path', () => {
  it('emits an exact product URL when productId is numeric', () => {
    const r = buildTcgplayerLink({ cardName: 'Charizard', game: 'pokemon', productId: 695400 })
    expect(r.isExact).toBe(true)
    expect(r.label).toBe('View this card on TCGplayer')
    const dest = new URL(r.href).searchParams.get('u')!
    expect(dest).toBe('https://www.tcgplayer.com/product/695400')
  })

  it('accepts string productIds that are numeric', () => {
    const r = buildTcgplayerLink({ cardName: 'x', game: 'magic', productId: '12345' })
    expect(r.isExact).toBe(true)
  })

  it('falls back to search when productId is non-numeric', () => {
    const r = buildTcgplayerLink({ cardName: 'Mox Ruby', game: 'magic', productId: 'not-a-number' })
    expect(r.isExact).toBe(false)
    expect(new URL(r.href).searchParams.get('u')).toContain('/search/magic/product')
  })

  it('falls back to search when productId is null or empty', () => {
    const r1 = buildTcgplayerLink({ cardName: 'Mox Ruby', game: 'magic', productId: null })
    const r2 = buildTcgplayerLink({ cardName: 'Mox Ruby', game: 'magic', productId: '' })
    expect(r1.isExact).toBe(false)
    expect(r2.isExact).toBe(false)
  })
})

describe('buildTcgplayerLink — degenerate input', () => {
  it('returns a safe non-null link when cardName is empty', () => {
    const r = buildTcgplayerLink({ cardName: '   ', game: 'pokemon' })
    expect(r.isExact).toBe(false)
    expect(r.label).toBe('Browse on TCGplayer')
    expect(new URL(r.href).host).toBe('partner.tcgplayer.com')
  })
})

describe('buildTcgplayerLink — URL safety', () => {
  it('URL-encodes the destination correctly for TCGplayer search', () => {
    const r = buildTcgplayerLink({ cardName: 'Pikachu & Zekrom', game: 'pokemon' })
    const dest = new URL(r.href).searchParams.get('u')!
    // encodeURIComponent encodes spaces as %20 and '&' as %26.
    expect(dest).toContain('q=Pikachu%20%26%20Zekrom')
  })
})
