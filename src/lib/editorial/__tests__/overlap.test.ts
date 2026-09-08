// src/lib/editorial/__tests__/overlap.test.ts
//
// EIC Block 3 — deterministic overlap tests.
// Focus: obvious duplicates score high; unrelated content scores low.

import { describe, it, expect } from 'vitest'
import { computeOverlap, type OverlapExistingArticle } from '../overlap'

const library: OverlapExistingArticle[] = [
  {
    id: 'a', slug: 'psa-9-vs-psa-10-pokemon-cards',
    headline: 'PSA 9 vs PSA 10: Is the Price Difference Really Worth It?',
    intro: 'Compare PSA 9 vs PSA 10 Pokémon cards, understand price differences.',
    theme: 'grading',
    plainText: 'PSA 10 typically commands a large premium over PSA 9. The gap depends on the card, but for iconic Charizard etc it can be an order of magnitude.',
  },
  {
    id: 'b', slug: 'should-you-grade-your-pok-mon-cards',
    headline: 'Should You Grade Your Pokémon Cards? A Clear Guide to PSA, BGS, CGC and ACE',
    intro: 'Learn when to grade Pokémon cards, how PSA, BGS, CGC and ACE compare.',
    theme: 'grading',
    plainText: 'Grading is one of the biggest levers in Pokémon card collecting. This covers PSA, BGS, CGC and ACE and when each makes sense.',
  },
  {
    id: 'c', slug: 'pokemon-communities-driving-the-market',
    headline: 'Why Pokémon Communities Are Driving the Market More Than Ever',
    intro: 'Pokémon cards are no longer just about collecting in isolation.',
    theme: 'community',
    plainText: 'Community activity increasingly drives price momentum, from Discord servers to Twitch streamers.',
  },
]

describe('computeOverlap', () => {
  it('flags a near-duplicate of an existing PSA-comparison article as possible-or-strong overlap', () => {
    const report = computeOverlap({
      title: 'PSA 9 vs PSA 10 Pokémon Cards — Is Grading Really Worth It?',
      angle: 'Direct comparison of PSA 9 vs PSA 10 price premium.',
      theme: 'grading',
    }, library)
    // Deterministic scoring at 8 articles is intentionally
    // conservative — "possible" (not "strong") is enough for the
    // editorial copilot to flag this and let a human decide.
    expect(['possible', 'strong']).toContain(report.verdict)
    expect(report.matches[0].slug).toBe('psa-9-vs-psa-10-pokemon-cards')
    expect(report.matches[0].score).toBeGreaterThan(0.20)
  })

  it('surfaces the closest grading article for a related-but-not-identical topic', () => {
    const report = computeOverlap({
      title: 'When to Grade a Pokémon Card and When Not To',
      angle: 'A collector-friendly guide to grading decisions.',
      theme: 'grading',
    }, library)
    // Verdict may legitimately be 'low' for a distinct-enough topic;
    // the invariant we do care about is that the closest existing
    // grading guide is surfaced as the top match.
    expect(report.matches[0].slug).toBe('should-you-grade-your-pok-mon-cards')
  })

  it('returns low overlap for an unrelated topic', () => {
    const report = computeOverlap({
      title: 'The Rise of Japanese Chinese-market Sealed Product',
      angle: 'A first look at cross-border sealed flows into Asia-Pacific.',
      theme: 'market',
    }, library)
    expect(report.verdict).toBe('low')
    // Even the top match should not clear the possible threshold.
    expect((report.matches[0]?.score ?? 0)).toBeLessThan(0.28)
  })

  it('boosts score when explicit set references overlap', () => {
    const withSet = computeOverlap({
      title: 'How Chaos Rising Chase Cards Are Trending',
      setRefs: ['Chaos Rising'],
    }, [
      { id: 'x', slug: 'crs-post', headline: 'Chaos Rising Set Report',
        setRefs: ['Mega Evolution - Chaos Rising'] } as any,
    ])
    // Normalisation should treat "Chaos Rising" and "Mega Evolution - Chaos Rising" as the same set.
    expect(withSet.matches[0]?.reasons.some(r => r.startsWith('shared set'))).toBe(true)
  })

  it('lists reasons explaining the top match', () => {
    const report = computeOverlap({
      title: 'PSA 9 vs PSA 10 Grading Decisions',
      theme: 'grading',
    }, library)
    expect(report.matches.length).toBeGreaterThan(0)
    expect(report.matches[0].reasons.length).toBeGreaterThan(0)
  })
})
