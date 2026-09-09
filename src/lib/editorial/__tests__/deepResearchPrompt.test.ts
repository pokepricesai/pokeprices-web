// src/lib/editorial/__tests__/deepResearchPrompt.test.ts
//
// Tests for the Deep Research prompt generator.

import { describe, it, expect } from 'vitest'
import { buildDeepResearchPrompt, normalisePokePricesUrl } from '../deepResearchPrompt'

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
      'KEY QUESTIONS TO ANSWER:', 'WRITING REQUIREMENTS', 'FORMATTING RULES',
      'INTERNAL POKEPRICES LINKS AVAILABLE', 'BEFORE FINALIZING', 'OUTPUT FORMAT',
    ]) {
      expect(prompt).toContain(header)
    }
  })

  it('output format lists ARTICLE TITLE / INTRO SNIPPET / SEO TITLE / META DESCRIPTION / ARTICLE BODY / SOURCES in exact order', () => {
    // The prompt template inlines those labels; assert each appears
    // and check the ordering by index.
    const labels = ['ARTICLE TITLE', 'INTRO SNIPPET', 'SEO TITLE', 'META DESCRIPTION', 'ARTICLE BODY', 'SOURCES']
    const positions = labels.map(l => prompt.indexOf('\n' + l + '\n'))
    for (const p of positions) expect(p).toBeGreaterThan(-1)
    // Strictly ascending
    for (let i = 1; i < positions.length; i++) expect(positions[i]).toBeGreaterThan(positions[i - 1])
  })

  it('explicitly bans bold formatting in the article body', () => {
    expect(prompt).toContain('Do NOT use bold formatting inside the article body')
    expect(prompt).toContain('no **random words**')
    expect(prompt).toContain('no bold Pokémon names')
  })

  it('explicitly forbids inline citation artefacts and the methodology / bottom-line sections', () => {
    expect(prompt).toContain('inline citation artifacts')
    expect(prompt).toContain('【1†L2-L4】')
    expect(prompt).toContain('Do NOT include a "Methodology"')
    expect(prompt).toContain('Bottom line')
  })

  it('tells the model to start body with opening paragraph and not repeat the title', () => {
    // Case-insensitive so a minor "do" → "Do" edit does not break the
    // regression assertion.
    expect(prompt).toMatch(/do NOT repeat the article title at the top/i)
  })

  it('names all three source-priority tiers by their public names', () => {
    expect(prompt).toContain('Official Pokémon')
    expect(prompt).toContain('Pokémon Center')
    expect(prompt).toContain('PokeBeach')
    expect(prompt).toContain('Bulbapedia')
    expect(prompt).toContain('TCGplayer')
  })

  it('includes the writing requirements (word target + no em/en dashes + American English)', () => {
    // Wording of the word/heading targets is deliberately dash-free
    // now — earlier drafts used en dashes ("900–1,300") which the
    // model would then imitate. See dashPrompts.test.ts.
    expect(prompt).toMatch(/900 to 1,300 words/)
    expect(prompt).toMatch(/4 to 6 useful H2 sections/)
    expect(prompt).toContain('American English')
    expect(prompt).toMatch(/em dashes or en dashes/i)
    expect(prompt).toContain('Do not invent facts')
  })

  it('includes the finalize-checklist and the new labeled return contract', () => {
    expect(prompt).toContain('Re-check dates')
    expect(prompt).toContain('Re-check product names')
    expect(prompt).toContain('Re-check card/set numbers')
    // New labeled output structure
    expect(prompt).toContain('ARTICLE TITLE')
    expect(prompt).toContain('INTRO SNIPPET')
    expect(prompt).toContain('SEO TITLE')
    expect(prompt).toContain('META DESCRIPTION')
    expect(prompt).toContain('ARTICLE BODY')
    expect(prompt).toContain('SOURCES')
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
    expect(p2).toContain('ANGLE:\n(no angle specified. Infer from title)')
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
    // Separator between title and URL is a colon now (em dash
    // banished from the whole prompt — see dashPrompts.test.ts).
    expect(prompt).toContain('- Anniversary sets in Pokémon history: https://www.pokeprices.io/insights/anniversary-history')
    expect(prompt).toContain('- Celebration Collection set page: https://www.pokeprices.io/set/celebration-collection')
  })

  it('does NOT double-host already-absolute pokeprices.io URLs', () => {
    // Regression: previous bug produced
    // https://www.pokeprices.io/https://www.pokeprices.io/insights/...
    const prompt = buildDeepResearchPrompt({
      project: project(),
      today: TODAY,
      internalLinks: [
        // Already absolute
        { title: 'Full URL A', url: 'https://www.pokeprices.io/insights/a' },
        // Also already absolute
        { title: 'Full URL B', url: 'https://www.pokeprices.io/set/b' },
      ],
    })
    expect(prompt).toContain('- Full URL A: https://www.pokeprices.io/insights/a')
    expect(prompt).toContain('- Full URL B: https://www.pokeprices.io/set/b')
    // The regression string must NOT appear.
    expect(prompt).not.toContain('https://www.pokeprices.io/https://')
  })

  it('shows a friendly placeholder when there are no internal links', () => {
    const prompt = buildDeepResearchPrompt({ project: project(), today: TODAY, internalLinks: [] })
    expect(prompt).toContain('INTERNAL POKEPRICES LINKS AVAILABLE')
    expect(prompt).toContain('(none. Do not invent PokePrices URLs)')
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

// ─────────────────────────────────────────────────────────────────
// normalisePokePricesUrl — unit
// ─────────────────────────────────────────────────────────────────

describe('normalisePokePricesUrl', () => {
  it('leaves an already-fully-qualified pokeprices.io URL alone', () => {
    expect(normalisePokePricesUrl('https://www.pokeprices.io/insights/foo')).toBe('https://www.pokeprices.io/insights/foo')
    expect(normalisePokePricesUrl('https://www.pokeprices.io/set/bar')).toBe('https://www.pokeprices.io/set/bar')
  })
  it('leaves external absolute URLs alone', () => {
    expect(normalisePokePricesUrl('https://pokemon.com/x')).toBe('https://pokemon.com/x')
    expect(normalisePokePricesUrl('http://example.com')).toBe('http://example.com')
  })
  it('prepends the host to a relative path', () => {
    expect(normalisePokePricesUrl('/insights/foo')).toBe('https://www.pokeprices.io/insights/foo')
    expect(normalisePokePricesUrl('/set/bar')).toBe('https://www.pokeprices.io/set/bar')
  })
  it('prepends "/" when the relative path is missing it', () => {
    expect(normalisePokePricesUrl('insights/foo')).toBe('https://www.pokeprices.io/insights/foo')
  })
  it('never double-hosts', () => {
    // The previous concatenation bug — check the helper itself is
    // idempotent-safe on the buggy input pattern.
    expect(normalisePokePricesUrl('https://www.pokeprices.io/insights/x')).not.toContain('https://www.pokeprices.io/https://')
  })
  it('safe on empty / whitespace input', () => {
    expect(normalisePokePricesUrl('')).toBe('')
    expect(normalisePokePricesUrl('   ')).toBe('')
  })
})

describe('buildDeepResearchPrompt does not leak internal machinery', () => {
  const prompt = buildDeepResearchPrompt({
    project: project(),
    today: TODAY,
    internalLinks: [{ title: 'Anniversary sets in Pokémon history', url: '/insights/anniversary-history' }],
  })

  // Note: "Methodology" / "methodology" DOES appear — the prompt
  // explicitly instructs the model NOT to write a Methodology
  // section, which requires naming the concept.
  it.each([
    'EvidencePack', 'evidenceRefs', 'sourceTier', 'Tier 1', 'Tier 2', 'Tier 3',
    'claim trace', 'claimTrace', 'block intents', 'blockIntents',
    'quarantine', 'numericAudit', 'verifiedFacts',
    'stripCitationMarkup', 'run.stage', 'runId',
  ])('does not mention "%s"', jargon => {
    expect(prompt).not.toContain(jargon)
  })
})
