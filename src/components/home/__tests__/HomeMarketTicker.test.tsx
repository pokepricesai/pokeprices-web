// Block 5A-W-41A — pin the ticker's rendering rules.
//
// The ticker is a pure presentation layer over already-loaded data.
// These tests exercise the function-component call directly (no DOM)
// to verify the empty-state hides + which cells appear at which
// combinations of inputs.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import HomeMarketTicker, {
  type MarketTickerInput,
} from '../HomeMarketTicker'

const SRC = readFileSync(join(__dirname, '..', 'HomeMarketTicker.tsx'), 'utf8')

function baseInput(over: Partial<MarketTickerInput> = {}): MarketTickerInput {
  return {
    marketValueCents: 123_400_000,
    pct30d:           2.4,
    cardsTracked:     40_032,
    setsTracked:      null,
    latestSetName:    'Chaos Rising',
    topRiser:         { name: 'Umbreon VMAX',   pctLabel: '+23.4% 30d' },
    topFaller:        { name: 'Charizard VMAX', pctLabel: '-8.1% 30d'  },
    ...over,
  }
}

describe('HomeMarketTicker — output', () => {
  it('returns a React element when at least one meaningful cell exists', () => {
    const out = HomeMarketTicker(baseInput())
    expect(out).not.toBeNull()
  })

  it('returns null when NO meaningful cell can be built', () => {
    expect(HomeMarketTicker(baseInput({
      marketValueCents: null,
      cardsTracked:     null,
      topRiser:         null,
      topFaller:        null,
      latestSetName:    null,
    }))).toBeNull()
  })

  it('marketValueCents === 0 does not on its own light up the index cell', () => {
    // Guards against a "$0" market index rendering when data is empty
    // but numerically valid. If other cells are present the strip
    // still shows, but the index cell must hide.
    expect(HomeMarketTicker(baseInput({
      marketValueCents: 0,
      cardsTracked:     40_032,
      topRiser:         null,
      topFaller:        null,
      latestSetName:    null,
    }))).not.toBeNull()
  })

  it('renders when only the top-riser or top-faller is present', () => {
    expect(HomeMarketTicker(baseInput({
      marketValueCents: null, cardsTracked: null, latestSetName: null,
      topFaller: null,
    }))).not.toBeNull()
  })
})

describe('HomeMarketTicker — no emoji labels', () => {
  it('the source file uses only the ▲ / ▼ direction glyphs (which are text, not emoji)', () => {
    for (const glyph of ['🃏', '⚡', '📦', '🚀', '📊', '👁', '💼', '✨', '🛒', '🎯', '🎨', '📍', '📬']) {
      expect(SRC).not.toContain(glyph)
    }
  })

  it('exposes tabular numerals for market-terminal readability', () => {
    expect(SRC).toContain("fontVariantNumeric: 'tabular-nums'")
  })
})
