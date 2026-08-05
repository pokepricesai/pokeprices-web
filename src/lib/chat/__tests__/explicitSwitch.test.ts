// Block 5A-W-52A.2 — deterministic explicit-card-switch signal
// with card-name and language switching.

import { describe, it, expect } from 'vitest'
import { detectExplicitCardSwitch } from '@/lib/chat/explicitSwitch'
import type { CardContext } from '@/lib/chat/cardContext'

const kleavor: CardContext = {
  cardRecordId: null,
  cardUrlSlug: 'kleavor-holo-86',
  priceChartingProductId: '3489584',
  cardName: 'Kleavor',
  setName: 'Astral Radiance',
  cardNumber: '86',
  cardNumberDisplay: '86/189',
  language: 'en',
}

const charizardBase: CardContext = {
  cardRecordId: null,
  cardUrlSlug: 'charizard-holo-4',
  priceChartingProductId: '111',
  cardName: 'Charizard',
  setName: 'Base Set',
  cardNumber: '4',
  cardNumberDisplay: '4/102',
  language: 'en',
}

describe('detectExplicitCardSwitch — reuse-active-card cases', () => {
  it('"what about PSA 9?" does NOT trigger a switch', () => {
    expect(detectExplicitCardSwitch('what about PSA 9?', kleavor)).toBe(false)
  })
  it('"365 days" does NOT trigger a switch', () => {
    expect(detectExplicitCardSwitch('365 days', kleavor)).toBe(false)
  })
  it('"and the holo" does NOT trigger a switch (raw treated as dimension)', () => {
    expect(detectExplicitCardSwitch('and the holo', kleavor)).toBe(false)
  })
  it('"in dollars" does NOT trigger a switch', () => {
    expect(detectExplicitCardSwitch('in dollars', kleavor)).toBe(false)
  })
  it('the SAME card number "#86" does NOT trigger a switch', () => {
    expect(detectExplicitCardSwitch('what about grade #86', kleavor)).toBe(false)
  })
  it('"Should I sell it?" does NOT trigger a switch', () => {
    expect(detectExplicitCardSwitch('Should I sell it?', kleavor)).toBe(false)
  })
  it('"it" alone does NOT trigger a switch', () => {
    expect(detectExplicitCardSwitch('it', kleavor)).toBe(false)
  })
  it('"this card" does NOT trigger a switch', () => {
    expect(detectExplicitCardSwitch('this card', kleavor)).toBe(false)
  })
  it('"raw" alone does NOT trigger a switch', () => {
    expect(detectExplicitCardSwitch('raw', kleavor)).toBe(false)
  })
  it('"reverse holo" as a printing question does NOT trigger a switch', () => {
    expect(detectExplicitCardSwitch('what about the reverse holo?', kleavor)).toBe(false)
  })
  it('"grade it" does NOT trigger a switch', () => {
    expect(detectExplicitCardSwitch('grade it', kleavor)).toBe(false)
  })
  it('"I own the reverse holo" does NOT trigger a switch', () => {
    expect(detectExplicitCardSwitch('I own the reverse holo.', kleavor)).toBe(false)
  })
  it('"Why is the PSA 10 so expensive?" does NOT trigger a switch', () => {
    expect(detectExplicitCardSwitch('Why is the PSA 10 so expensive?', kleavor)).toBe(false)
  })
  it('"How has it performed this year?" does NOT trigger a switch', () => {
    expect(detectExplicitCardSwitch('How has it performed this year?', kleavor)).toBe(false)
  })
})

describe('detectExplicitCardSwitch — different-set cases', () => {
  it('naming a different set triggers a switch', () => {
    expect(detectExplicitCardSwitch('How much is Charizard from Base Set?', kleavor)).toBe(true)
  })
  it('mentioning "Crown Zenith" (a different set) triggers a switch', () => {
    expect(detectExplicitCardSwitch('What about Crown Zenith Pikachu?', kleavor)).toBe(true)
  })
})

describe('detectExplicitCardSwitch — different-card-number cases', () => {
  it('a different collector number "#58" triggers a switch', () => {
    expect(detectExplicitCardSwitch('and #58?', kleavor)).toBe(true)
  })
  it('a different "58/102" collector-number ratio triggers a switch', () => {
    expect(detectExplicitCardSwitch('what about 58/102', kleavor)).toBe(true)
  })
})

describe('detectExplicitCardSwitch — card-name switch (52A.2)', () => {
  it('active Charizard + "What about Blastoise?" triggers a switch', () => {
    expect(detectExplicitCardSwitch('What about Blastoise?', charizardBase)).toBe(true)
  })
  it('active Charizard + "What about Blastoise instead?" triggers a switch', () => {
    expect(detectExplicitCardSwitch('What about Blastoise instead?', charizardBase)).toBe(true)
  })
  it('active Kleavor + "How much is Charizard?" triggers a switch', () => {
    expect(detectExplicitCardSwitch('How much is Charizard?', kleavor)).toBe(true)
  })
  it('active Charizard + "What about PSA 9?" does NOT trigger a switch', () => {
    expect(detectExplicitCardSwitch('What about PSA 9?', charizardBase)).toBe(false)
  })
  it('active Charizard + "Should I sell Charizard?" does NOT trigger a switch (name matches)', () => {
    expect(detectExplicitCardSwitch('Should I sell Charizard?', charizardBase)).toBe(false)
  })
})

describe('detectExplicitCardSwitch — language switch (52A.2)', () => {
  it('active English Charizard + explicit Japanese request triggers a switch', () => {
    expect(detectExplicitCardSwitch('What about the Japanese Charizard?', charizardBase)).toBe(true)
  })
  it('active English + "Japanese version" triggers a switch', () => {
    expect(detectExplicitCardSwitch('What about the Japanese version?', charizardBase)).toBe(true)
  })
  it('active JP + explicit English request triggers a switch', () => {
    const jp: CardContext = { ...charizardBase, language: 'jp', setName: 'Japanese Base Set' }
    expect(detectExplicitCardSwitch('And the English one?', jp)).toBe(true)
  })
  it('active English + "How is the price?" (no language mention) does NOT trigger a switch', () => {
    expect(detectExplicitCardSwitch('How is the price?', charizardBase)).toBe(false)
  })
})

describe('detectExplicitCardSwitch — edge cases', () => {
  it('empty text returns false', () => {
    expect(detectExplicitCardSwitch('', kleavor)).toBe(false)
  })
  it('a set-name substring in a different context does not falsely fire', () => {
    // Fossil is a set. If activeCard IS Fossil, mentioning "Fossil
    // Aerodactyl" (which contains "Fossil") should not switch on the
    // set signal.
    const fossilCtx: CardContext = {
      ...kleavor, setName: 'Fossil', cardUrlSlug: 'aerodactyl-1',
      priceChartingProductId: '901', cardName: 'Aerodactyl', cardNumber: '1',
    }
    expect(detectExplicitCardSwitch('is Aerodactyl worth grading?', fossilCtx)).toBe(false)
  })
  it('capitalized grader tokens (PSA, CGC, BGS) do not fire the name signal', () => {
    expect(detectExplicitCardSwitch('What about PSA 9 vs CGC 9?', charizardBase)).toBe(false)
  })
})
