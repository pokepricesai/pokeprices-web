// src/lib/editorial/writer/__tests__/twoStageExternal.test.ts
//
// EIC two-stage external Writer — parser + brief + salvage tests
// covering the research_and_write + check_and_fix flow.

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import {
  parseResearchAndWriteResponse,
  buildResearchAndWriteUserTurn,
  RESEARCH_AND_WRITE_SYSTEM_PROMPT,
} from '../researchAndWrite'
import {
  parseCheckAndFixResponse,
  buildCheckAndFixUserTurn,
  CHECK_AND_FIX_SYSTEM_PROMPT,
} from '../checkAndFix'

// ─────────────────────────────────────────────────────────────────
// researchAndWrite parser + salvage
// ─────────────────────────────────────────────────────────────────

describe('parseResearchAndWriteResponse', () => {
  it('parses a well-formed ```json response', () => {
    const raw = '```json\n' + JSON.stringify({
      title: 'The 30th Anniversary Set',
      metaTitle: '30th Anniversary Set: Everything We Know',
      metaDescription: 'Everything collectors need to know about the anniversary release.',
      bodyMarkdown: '## What It Is\n\nProse here.',
      sources: [
        { url: 'https://www.pokemon.com/us/celebration', title: 'Official announcement', publisher: 'The Pokémon Company' },
        { url: 'https://www.tcgplayer.com/product/xyz',   title: 'Preorder listing',       publisher: 'TCGplayer' },
      ],
    }) + '\n```'
    const parsed = parseResearchAndWriteResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.title).toBe('The 30th Anniversary Set')
    expect(parsed!.sources).toHaveLength(2)
    expect(parsed!.sources[0].url).toBe('https://www.pokemon.com/us/celebration')
    expect(parsed!.salvaged).toBe(false)
  })

  it('accepts alternate field names (headline/seoTitle/body/references)', () => {
    const raw = '```json\n' + JSON.stringify({
      headline: 'Alt', seoTitle: 'A', seoDescription: 'D',
      body: '## H\n\nProse.',
      references: [{ url: 'https://pokemon.com/x' }],
    }) + '\n```'
    const parsed = parseResearchAndWriteResponse(raw)
    expect(parsed!.title).toBe('Alt')
    expect(parsed!.sources).toHaveLength(1)
  })

  it('deduplicates sources and drops non-HTTP URLs', () => {
    const raw = '```json\n' + JSON.stringify({
      title: 'T', metaTitle: 'T', metaDescription: 'D', bodyMarkdown: '## H\n\nProse.',
      sources: [
        { url: 'https://pokemon.com/x' },
        { url: 'https://pokemon.com/x' },  // dup
        { url: 'ftp://ignored.example' },  // not http
        { url: 'https://tcgplayer.com/y' },
      ],
    }) + '\n```'
    const parsed = parseResearchAndWriteResponse(raw)
    expect(parsed!.sources.map(s => s.url).sort()).toEqual(['https://pokemon.com/x', 'https://tcgplayer.com/y'])
  })

  it('salvages plain Markdown when JSON is absent', () => {
    const raw = '# The Anniversary Set\n\nOpening paragraph long enough to serve as usable prose for a collector article about the set.\n\n## Details\n\nMore prose with plenty of detail.\n\nCitations: https://www.pokemon.com/us/celebration and https://www.tcgplayer.com/product/xyz'
    const parsed = parseResearchAndWriteResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.salvaged).toBe(true)
    expect(parsed!.title).toBe('The Anniversary Set')
    // URLs in the raw prose are salvaged as sources
    expect(parsed!.sources.map(s => s.url)).toEqual(expect.arrayContaining(['https://www.pokemon.com/us/celebration', 'https://www.tcgplayer.com/product/xyz']))
  })

  it('salvages plain Markdown when JSON is present but bodyMarkdown is empty', () => {
    const raw = '# Real Title\n\nBody prose the model actually wrote instead of using the JSON envelope properly this time.\n\n' +
      '```json\n' + JSON.stringify({ title: 'Envelope', metaTitle: '', metaDescription: '', bodyMarkdown: '' }) + '\n```'
    const parsed = parseResearchAndWriteResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.salvaged).toBe(true)
    expect(parsed!.title).toBe('Real Title')
  })

  it('returns null when the response is too short to be an article', () => {
    expect(parseResearchAndWriteResponse('')).toBeNull()
    expect(parseResearchAndWriteResponse('nope')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────
// checkAndFix parser + salvage
// ─────────────────────────────────────────────────────────────────

describe('parseCheckAndFixResponse', () => {
  it('parses a corrected-article JSON with correctionsSummary', () => {
    const raw = '```json\n' + JSON.stringify({
      title: 'The 30th Anniversary Set',
      metaTitle: '30th Anniversary Set',
      metaDescription: 'What collectors need to know.',
      bodyMarkdown: '## Section\n\nCorrected prose.',
      sources: [{ url: 'https://pokemon.com/x' }],
      correctionsSummary: 'Fixed release date from November to October per official Pokémon site.',
    }) + '\n```'
    const parsed = parseCheckAndFixResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.correctionsSummary).toContain('release date')
    expect(parsed!.bodyMarkdown).toContain('Corrected prose')
    expect(parsed!.salvaged).toBe(false)
  })

  it('defaults correctionsSummary to "No changes needed." when omitted', () => {
    const raw = '```json\n' + JSON.stringify({
      title: 'T', metaTitle: 'T', metaDescription: 'D',
      bodyMarkdown: '## H\n\nBody.',
      sources: [],
    }) + '\n```'
    const parsed = parseCheckAndFixResponse(raw)
    expect(parsed!.correctionsSummary).toBe('No changes needed.')
  })

  it('salvages plain Markdown when the checker returns bare prose', () => {
    const raw = '# Fixed Article\n\nFirst paragraph is the fixed body prose long enough to look like an actual article body.\n\n## Section\n\nMore prose here.'
    const parsed = parseCheckAndFixResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.salvaged).toBe(true)
    expect(parsed!.correctionsSummary).toMatch(/Salvaged/)
    expect(parsed!.title).toBe('Fixed Article')
  })

  it('returns null when there is no usable content at all', () => {
    expect(parseCheckAndFixResponse('')).toBeNull()
    expect(parseCheckAndFixResponse('nope')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────
// User-turn briefs — omissions + shape
// ─────────────────────────────────────────────────────────────────

describe('buildResearchAndWriteUserTurn', () => {
  const brief = buildResearchAndWriteUserTurn({
    project: { id: 12, title: 'Pokémon TCG: 30th Celebration - Everything We Know So Far', angle: null, articleType: 'upcoming_set' },
    today: '2026-09-08',
  })

  it('includes topic, articleType, todaysDate', () => {
    expect(brief).toContain('30th Celebration')
    expect(brief).toContain('upcoming_set')
    expect(brief).toContain('2026-09-08')
  })

  it('omits EvidencePack machinery', () => {
    expect(brief).not.toContain('EvidencePack')
    expect(brief).not.toContain('verifiedFacts')
    expect(brief).not.toContain('evidenceRefs')
    expect(brief).not.toContain('claim trace')
    expect(brief).not.toContain('block intents')
    expect(brief).not.toContain('methodology')
    expect(brief).not.toContain('Tier 1')
    expect(brief).not.toContain('sourceTier')
    expect(brief).not.toContain('researchSummary')
  })
})

describe('buildCheckAndFixUserTurn', () => {
  const brief = buildCheckAndFixUserTurn({
    article: {
      title: 'The 30th Anniversary Set',
      metaTitle: '30th Anniversary Set',
      metaDescription: 'What collectors need to know.',
      bodyMarkdown: '## Section\n\nProse.',
      sources: [{ url: 'https://pokemon.com/x' }],
    },
    today: '2026-09-08',
  })

  it('includes the article + today + sources', () => {
    expect(brief).toContain('The 30th Anniversary Set')
    expect(brief).toContain('2026-09-08')
    expect(brief).toContain('pokemon.com/x')
  })

  it('omits provenance machinery', () => {
    expect(brief).not.toContain('evidenceRefs')
    expect(brief).not.toContain('numericAudit')
    expect(brief).not.toContain('quarantine')
    expect(brief).not.toContain('EvidencePack')
    expect(brief).not.toContain('claim trace')
  })
})

// ─────────────────────────────────────────────────────────────────
// System prompt sanity — the DELETE-COMPLEXITY guardrails are in place
// ─────────────────────────────────────────────────────────────────

describe('system prompts', () => {
  it('research_and_write prompt requires the small output shape', () => {
    expect(RESEARCH_AND_WRITE_SYSTEM_PROMPT).toContain('"title"')
    expect(RESEARCH_AND_WRITE_SYSTEM_PROMPT).toContain('"metaTitle"')
    expect(RESEARCH_AND_WRITE_SYSTEM_PROMPT).toContain('"bodyMarkdown"')
    expect(RESEARCH_AND_WRITE_SYSTEM_PROMPT).toContain('"sources"')
    // No forbidden internal jargon leaking to the article
    expect(RESEARCH_AND_WRITE_SYSTEM_PROMPT).toContain('do NOT expose that machinery')
  })

  it('check_and_fix prompt bans forensic issue lists', () => {
    expect(CHECK_AND_FIX_SYSTEM_PROMPT).toContain('DIRECTLY FIX')
    expect(CHECK_AND_FIX_SYSTEM_PROMPT).toContain('Do NOT')
    expect(CHECK_AND_FIX_SYSTEM_PROMPT).toContain('forensic issue list')
    expect(CHECK_AND_FIX_SYSTEM_PROMPT).toContain('correctionsSummary')
  })
})

// ─────────────────────────────────────────────────────────────────
// External routing — chooseRecipe still returns external for the
// article types we now bypass the approval gate for.
// ─────────────────────────────────────────────────────────────────

describe('routing: chooseRecipe identifies external article types', () => {
  it.each([
    ['upcoming_set',         'Pokémon TCG: 30th Celebration - Everything We Know So Far'],
    ['new_set',              'Prismatic Evolutions launch guide'],
    ['news',                 'Pokémon announces new event'],
    ['product_announcement', 'Pokémon Center reveals new box'],
    ['set_preview',          'Preview: upcoming set'],
    ['release_news',         'Release news round-up'],
  ] as const)('routes %s to external_research', async (articleType, title) => {
    const { chooseRecipe } = await import('../../research/dispatch')
    expect(chooseRecipe({ id: 1, title, angle: null, articleType, targetPublishAt: null })).toBe('external_research')
  })
})
