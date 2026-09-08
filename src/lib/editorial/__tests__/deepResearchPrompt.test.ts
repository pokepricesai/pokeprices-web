// src/lib/editorial/__tests__/deepResearchPrompt.test.ts
//
// Tests for the Deep Research prompt generator.

import { describe, it, expect } from 'vitest'
import { buildDeepResearchPrompt } from '../deepResearchPrompt'

const TODAY = '2026-09-08'

function project(overrides: Partial<{ id: number; title: string; angle: string | null; articleType: string; targetPublishAt: string | null }> = {}) {
  return {
    id:              overrides.id ?? 12,
    title:           overrides.title ?? 'Pokémon TCG: 30th Celebration - Everything We Know So Far',
    angle:           overrides.angle ?? null,
    articleType:     overrides.articleType ?? 'upcoming_set',
    targetPublishAt: overrides.targetPublishAt ?? null,
  }
}

// ─────────────────────────────────────────────────────────────────
// Template shape — matches spec verbatim
// ─────────────────────────────────────────────────────────────────

describe('buildDeepResearchPrompt template shape', () => {
  const prompt = buildDeepResearchPrompt({ project: project(), today: TODAY, internalLinks: [] })

  it('starts with the exact PokePrices header line', () => {
    expect(prompt.startsWith('You are writing a finished SEO article for PokePrices')).toBe(true)
  })

  it('contains every section header from the spec', () => {
    for (const header of [
      'TOPIC:', 'PROPOSED TITLE:', 'ANGLE:', 'WHY NOW:', 'CURRENT DATE:',
      'KEY QUESTIONS TO ANSWER:', 'Writing requirements:',
      'INTERNAL POKEPRICES LINKS AVAILABLE:', 'Before finalizing:', 'Return:',
    ]) {
      expect(prompt).toContain(header)
    }
  })

  it('names all three source-priority tiers by their public names', () => {
    expect(prompt).toContain('Official Pokémon')
    expect(prompt).toContain('Pokémon Center')
    expect(prompt).toContain('PokeBeach')
    expect(prompt).toContain('Bulbapedia')
    expect(prompt).toContain('TCGplayer')
  })

  it('includes the writing requirements verbatim (word target + no em dashes + American English)', () => {
    expect(prompt).toContain('900–1,300 words')
    expect(prompt).toContain('4–6 useful H2 sections')
    expect(prompt).toContain('American English')
    expect(prompt).toContain('Do not use em dashes')
    expect(prompt).toContain('Do not invent facts')
  })

  it('includes the finalize-checklist and the Return: contract', () => {
    expect(prompt).toContain('Re-check dates')
    expect(prompt).toContain('Re-check product names')
    expect(prompt).toContain('Re-check card/set numbers')
    expect(prompt).toContain('Final article title')
    expect(prompt).toContain('SEO title')
    expect(prompt).toContain('Meta description')
    expect(prompt).toContain('Finished article body')
    expect(prompt).toContain('Source list used')
  })
})

// ─────────────────────────────────────────────────────────────────
// Substitutions
// ─────────────────────────────────────────────────────────────────

describe('buildDeepResearchPrompt substitutions', () => {
  it('substitutes topic + title + currentDate', () => {
    const prompt = buildDeepResearchPrompt({ project: project(), today: TODAY, internalLinks: [] })
    expect(prompt).toContain('TOPIC:\nPokémon TCG: 30th Celebration - Everything We Know So Far')
    expect(prompt).toContain('PROPOSED TITLE:\nPokémon TCG: 30th Celebration - Everything We Know So Far')
    expect(prompt).toContain(`CURRENT DATE:\n${TODAY}`)
  })

  it('uses angle when supplied and a friendly placeholder otherwise', () => {
    const p1 = buildDeepResearchPrompt({ project: project({ angle: 'What collectors need to know about the anniversary release.' }), today: TODAY, internalLinks: [] })
    expect(p1).toContain('ANGLE:\nWhat collectors need to know about the anniversary release.')

    const p2 = buildDeepResearchPrompt({ project: project({ angle: null }), today: TODAY, internalLinks: [] })
    expect(p2).toContain('ANGLE:\n(no angle specified — infer from title)')
  })

  it('derives whyNow from targetPublishAt when present', () => {
    const prompt = buildDeepResearchPrompt({ project: project({ targetPublishAt: '2026-10-08' }), today: TODAY, internalLinks: [] })
    // Sept 8 → Oct 8 is 30 days.
    expect(prompt).toMatch(/WHY NOW:\nTarget publish in 30 day\(s\), on 2026-10-08\./)
  })

  it('flags a past target publish date', () => {
    const prompt = buildDeepResearchPrompt({ project: project({ targetPublishAt: '2026-08-01' }), today: TODAY, internalLinks: [] })
    expect(prompt).toMatch(/WHY NOW:\nTarget publish date \(2026-08-01\) has passed/)
  })

  it('uses an explicit whyNow override when supplied', () => {
    const prompt = buildDeepResearchPrompt({ project: project(), today: TODAY, internalLinks: [], whyNow: 'PokemonCenter listing leaked yesterday.' })
    expect(prompt).toContain('WHY NOW:\nPokemonCenter listing leaked yesterday.')
  })

  it('falls back to a sensible whyNow for article-type only (no target date)', () => {
    const prompt = buildDeepResearchPrompt({ project: project({ articleType: 'upcoming_set', targetPublishAt: null }), today: TODAY, internalLinks: [] })
    expect(prompt).toMatch(/WHY NOW:\nTime-sensitive coverage/)
  })

  it('renders internal links with the full pokeprices.io host', () => {
    const prompt = buildDeepResearchPrompt({
      project: project(),
      today: TODAY,
      internalLinks: [
        { title: 'Anniversary sets in Pokémon history', url: '/insights/anniversary-history' },
        { title: 'Celebration Collection set page',     url: '/set/celebration-collection' },
      ],
    })
    expect(prompt).toContain('- Anniversary sets in Pokémon history — https://www.pokeprices.io/insights/anniversary-history')
    expect(prompt).toContain('- Celebration Collection set page — https://www.pokeprices.io/set/celebration-collection')
  })

  it('shows a friendly placeholder when there are no internal links', () => {
    const prompt = buildDeepResearchPrompt({ project: project(), today: TODAY, internalLinks: [] })
    expect(prompt).toContain('INTERNAL POKEPRICES LINKS AVAILABLE:\n\n(none — do not invent PokePrices URLs)')
  })
})

// ─────────────────────────────────────────────────────────────────
// Research questions per article type
// ─────────────────────────────────────────────────────────────────

describe('buildDeepResearchPrompt research questions by article type', () => {
  it('upcoming_set / new_set / release_news get release-focused questions', () => {
    for (const type of ['upcoming_set', 'new_set', 'release_news', 'set_preview', 'product_announcement']) {
      const prompt = buildDeepResearchPrompt({ project: project({ articleType: type }), today: TODAY, internalLinks: [] })
      expect(prompt).toContain('Has the set / product been officially announced')
      expect(prompt).toContain('confirmed release date')
      expect(prompt).toContain('booster boxes, ETBs')
      expect(prompt).toContain('Japanese counterpart')
    }
  })

  it('news gets impact-focused questions', () => {
    const prompt = buildDeepResearchPrompt({ project: project({ articleType: 'news' }), today: TODAY, internalLinks: [] })
    expect(prompt).toContain('What exactly happened, according to which sources')
    expect(prompt).toContain('Which collectors, products, or storefronts are affected')
  })

  it('evergreen_guide gets stable-topic questions', () => {
    const prompt = buildDeepResearchPrompt({ project: project({ articleType: 'evergreen_guide' }), today: TODAY, internalLinks: [] })
    expect(prompt).toContain('common misconceptions')
    expect(prompt).toContain('what has changed in the last 12 months'.replace(/^what/, 'What'))
  })
})

// ─────────────────────────────────────────────────────────────────
// Forbidden internal jargon — none of it leaks to the prompt
// ─────────────────────────────────────────────────────────────────

describe('buildDeepResearchPrompt does not leak internal machinery', () => {
  const prompt = buildDeepResearchPrompt({
    project: project(),
    today: TODAY,
    internalLinks: [{ title: 'Anniversary sets in Pokémon history', url: '/insights/anniversary-history' }],
  })

  it.each([
    'EvidencePack', 'evidenceRefs', 'sourceTier', 'Tier 1', 'Tier 2', 'Tier 3',
    'claim trace', 'claimTrace', 'block intents', 'blockIntents',
    'quarantine', 'methodology', 'numericAudit', 'verifiedFacts',
    'stripCitationMarkup', 'run.stage', 'runId',
  ])('does not mention "%s"', jargon => {
    expect(prompt).not.toContain(jargon)
  })
})
