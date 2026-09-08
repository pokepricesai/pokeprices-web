// src/lib/editorial/writer/__tests__/twoStageInternal.test.ts
//
// EIC two-stage internal-data Writer — parser + brief + salvage
// tests covering the writer_internal + validate_and_fix flow.
//
// Mirrors twoStageExternal.test.ts in spirit: the new internal
// pipeline is intentionally simpler than the legacy plan → parts →
// assemble machine, so we lean on the SAME forgiving parser
// philosophy (fenced JSON → unlabeled fence → whole-text →
// balanced-brace → Markdown salvage).

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import {
  parseInternalArticleResponse,
  buildInternalWriterBrief,
  buildInternalWriterUserTurn,
  INTERNAL_WRITER_SYSTEM_PROMPT,
} from '../writerInternal'
import {
  parseValidateAndFixResponse,
  buildValidateAndFixUserTurn,
  VALIDATE_AND_FIX_SYSTEM_PROMPT,
} from '../validateAndFix'
import type { EvidencePack } from '../../research/types'

// ─────────────────────────────────────────────────────────────────
// writer_internal parser + salvage
// ─────────────────────────────────────────────────────────────────

describe('parseInternalArticleResponse', () => {
  it('parses a well-formed ```json response', () => {
    const raw = '```json\n' + JSON.stringify({
      articleTitle:    'August 2026: Vintage Steadied While Modern Cooled',
      introSnippet:    'A month of small swings and one loud outlier.',
      seoTitle:        'August 2026 Pokémon Card Market Report',
      metaDescription: 'The month\'s biggest movers, the sets that held up, and why the median is quietly the story.',
      bodyMarkdown:    '## Where the month landed\n\nProse here about medians.\n\n## Featured risers\n\nMore prose.',
    }) + '\n```'
    const parsed = parseInternalArticleResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.title).toBe('August 2026: Vintage Steadied While Modern Cooled')
    expect(parsed!.metaTitle).toBe('August 2026 Pokémon Card Market Report')
    expect(parsed!.bodyMarkdown).toContain('Where the month landed')
    expect(parsed!.salvaged).toBe(false)
  })

  it('accepts alternate field names (title / headline / seoDescription / body)', () => {
    const raw = '```json\n' + JSON.stringify({
      headline: 'Alt Title', seoTitle: 'SEO T', seoDescription: 'SEO D',
      body: '## H\n\nProse.',
    }) + '\n```'
    const parsed = parseInternalArticleResponse(raw)
    expect(parsed!.title).toBe('Alt Title')
    expect(parsed!.metaTitle).toBe('SEO T')
    expect(parsed!.metaDescription).toBe('SEO D')
    expect(parsed!.bodyMarkdown).toContain('Prose.')
  })

  it('recovers from an unlabeled fenced block', () => {
    const raw = '```\n' + JSON.stringify({
      articleTitle: 'T', metaDescription: 'D', bodyMarkdown: '## H\n\nProse.',
    }) + '\n```'
    const parsed = parseInternalArticleResponse(raw)
    expect(parsed!.bodyMarkdown).toContain('Prose.')
  })

  it('recovers via balanced-brace extraction when preface/suffix chatter surrounds the JSON', () => {
    const raw = 'Here is the article:\n\n' + JSON.stringify({
      articleTitle: 'Balanced', metaDescription: 'D',
      bodyMarkdown: '## Section\n\nBalanced body prose with lots of words to satisfy any body length checks.',
    }) + '\n\nHope that helps.'
    const parsed = parseInternalArticleResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.title).toBe('Balanced')
  })

  it('salvages plain Markdown when no JSON is emitted', () => {
    const raw = [
      '# August 2026 Was Quieter Than It Sounded',
      '',
      'A month of small swings and one loud outlier. The median was almost flat, but the story sits in the tails.',
      '',
      '## Where the median landed',
      '',
      'A paragraph of prose that has enough substance to survive the ≥100-char salvage threshold and give the CMS something worth publishing.',
      '',
      '## What moved',
      '',
      'Another paragraph of prose. More words about card movements.',
    ].join('\n')
    const parsed = parseInternalArticleResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.title).toBe('August 2026 Was Quieter Than It Sounded')
    expect(parsed!.bodyMarkdown).toContain('Where the median landed')
    expect(parsed!.salvaged).toBe(true)
  })

  it('strips web-search citation markup that leaked into the response', () => {
    const raw = '```json\n' + JSON.stringify({
      articleTitle: 'T', metaDescription: 'D',
      bodyMarkdown: 'This is (cite index="21-14">a cited claim</cite> from the model. It should be clean text after parsing.',
    }) + '\n```'
    const parsed = parseInternalArticleResponse(raw)
    expect(parsed!.bodyMarkdown).toContain('a cited claim')
    expect(parsed!.bodyMarkdown).not.toMatch(/cite index/)
    expect(parsed!.bodyMarkdown).not.toMatch(/<\/cite>/)
  })

  it('returns null for empty or unparseable non-Markdown input', () => {
    expect(parseInternalArticleResponse('')).toBeNull()
    expect(parseInternalArticleResponse('yes.')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────
// buildInternalWriterBrief — the compact deterministic input
// ─────────────────────────────────────────────────────────────────

function makePack(overrides: Partial<EvidencePack> = {}): EvidencePack {
  return {
    generatedAt: '2026-09-01T00:00:00Z',
    dataAsOf:    '2026-09-01',
    recipe:      'monthly_market_report',
    seedQuery:   null,
    quality: {
      sampleSize: 12345,
      freshness:  { newestObservationAt: '2026-08-31', oldestObservationAt: '2026-08-01', daysOld: 1 },
      warnings:   [],
    } as any,
    externalSources: [],
    verifiedFacts: [] as any,
    derivedFindings: [
      { id: 'finding-median', statement: 'The median monthly move was +0.4% across 12,345 cards.', kind: 'summary' } as any,
      { id: 'finding-iqr',    statement: 'The interquartile range spanned -3.1% to +4.8%.',           kind: 'summary' } as any,
      { id: 'finding-dir',    statement: '312 cards rose more than 1%, 268 fell more than 1%, 41 were within ±1%.', kind: 'summary' } as any,
    ] as any,
    dataTables: [
      {
        id: 'featured-risers-2026-08',
        title: 'Featured risers',
        rows: [
          { cardName: 'Charizard', cardNumber: '4/102', setName: 'Base Set', startUsd: 100, endUsd: 112, pct: 12, startObs: 8, endObs: 9, reasons: 'iconic' },
        ],
      } as any,
      {
        id: 'featured-fallers-2026-08',
        title: 'Featured fallers',
        rows: [
          { cardName: 'Mewtwo', cardNumber: '10/102', setName: 'Base Set', startUsd: 80, endUsd: 70, pct: -12.5, startObs: 6, endObs: 5, reasons: 'iconic' },
        ],
      } as any,
      {
        id: 'featured-sets-2026-08',
        title: 'Featured sets',
        rows: [
          { setName: 'Base Set', moverCount: 5, medianPct: 3.4, totalEndUsd: 500, editorialScore: 0.87 },
        ],
      } as any,
      {
        id: 'mover-review-2026-08',
        title: 'Manual review — large movers',
        rows: [
          { cardSlug: '111', cardName: 'ApprovedCard',  setName: 'X', startUsd: 10, endUsd: 30, pct: 200 },
          { cardSlug: '222', cardName: 'Unapproved',    setName: 'X', startUsd: 10, endUsd: 40, pct: 300 },
        ],
      } as any,
      // Non-featured raw ranking table — should be IGNORED by the
      // brief builder (writer must lean on featured lists).
      {
        id: 'mover-risers-2026-08',
        title: 'Full mover ranking',
        rows: [
          { cardName: 'Random', cardNumber: '99/999', setName: 'X', startUsd: 1, endUsd: 2, pct: 100 },
        ],
      } as any,
    ] as any,
    approvedLargeMoverSlugs: ['111'],
    warnings: [
      { severity: 'critical', message: 'Coverage below usual on August 4-6.' } as any,
      { severity: 'info',     message: 'ignored' } as any,
    ] as any,
    rejectedClaims: [
      { claim: 'Charizard exploded because of a viral TikTok', reason: 'no evidence', sourceIds: [] } as any,
    ] as any,
    methodology: {
      summary: 'PokePrices proprietary methodology.',
      filters: [{ label: 'Window', value: '30 days' }],
    } as any,
    quarantinedRows: [] as any,
    marketSignalStrength: 'moderate' as any,
    marketSignalReason:   'ordinary month' as any,
    ...overrides,
  } as unknown as EvidencePack
}

describe('buildInternalWriterBrief', () => {
  it('extracts featured risers / fallers / sets and skips non-featured tables', () => {
    const brief = buildInternalWriterBrief({
      project: { title: 'August 2026', articleType: 'monthly_market_report', angle: null, targetPublishAt: null },
      pack: makePack(),
      internalLinks: [{ title: 'Base Set page', url: '/set/base-set' }],
    })
    expect(brief.featuredRisers).toHaveLength(1)
    expect(brief.featuredRisers[0].cardName).toBe('Charizard')
    expect(brief.featuredFallers[0].cardName).toBe('Mewtwo')
    expect(brief.featuredSets[0].setName).toBe('Base Set')
  })

  it('includes ONLY approved manual-review rows', () => {
    const brief = buildInternalWriterBrief({
      project: { title: 'August 2026', articleType: 'monthly_market_report', angle: null, targetPublishAt: null },
      pack: makePack(),
      internalLinks: [],
    })
    expect(brief.approvedManualRows).toHaveLength(1)
    expect(brief.approvedManualRows[0].cardName).toBe('ApprovedCard')
  })

  it('parses aggregate stats out of the derivedFindings statements', () => {
    const brief = buildInternalWriterBrief({
      project: { title: 'August 2026', articleType: 'monthly_market_report', angle: null, targetPublishAt: null },
      pack: makePack(),
      internalLinks: [],
    })
    expect(brief.market.sampleSize).toBe(12345)
    expect(brief.market.medianPct).toBeCloseTo(0.4)
    expect(brief.market.iqrLowPct).toBeCloseTo(-3.1)
    expect(brief.market.iqrHighPct).toBeCloseTo(4.8)
    expect(brief.market.risingCount).toBe(312)
    expect(brief.market.fallingCount).toBe(268)
    expect(brief.market.flatCount).toBe(41)
  })

  it('carries warnings (critical/major only) and rejected claims through to the writer brief', () => {
    const brief = buildInternalWriterBrief({
      project: { title: 'August 2026', articleType: 'monthly_market_report', angle: null, targetPublishAt: null },
      pack: makePack(),
      internalLinks: [],
    })
    expect(brief.warnings).toHaveLength(1)
    expect(brief.warnings[0]).toMatch(/Coverage below usual/)
    expect(brief.rejectedClaims).toHaveLength(1)
    expect(brief.rejectedClaims[0]).toMatch(/viral TikTok/)
  })

  it('infers reportingPeriod from the project title when a month/year phrase is present', () => {
    const brief = buildInternalWriterBrief({
      project: { title: 'August 2026 Pokémon Card Market Report', articleType: 'monthly_market_report', angle: null, targetPublishAt: null },
      pack: makePack(),
      internalLinks: [],
    })
    expect(brief.project.reportingPeriod?.toLowerCase()).toContain('august 2026')
  })
})

// ─────────────────────────────────────────────────────────────────
// buildInternalWriterUserTurn / prompt sanity
// ─────────────────────────────────────────────────────────────────

describe('buildInternalWriterUserTurn + system prompt', () => {
  it('emits a MODE tag and embeds the brief as JSON', () => {
    const brief = buildInternalWriterBrief({
      project: { title: 'August 2026', articleType: 'monthly_market_report', angle: null, targetPublishAt: null },
      pack: makePack(),
      internalLinks: [],
    })
    const turn = buildInternalWriterUserTurn(brief)
    expect(turn).toContain('MODE=internal_article')
    expect(turn).toContain('```json')
    expect(turn).toContain('"featuredRisers"')
  })

  it('system prompt tells the writer NOT to use em dashes or bold in the body', () => {
    expect(INTERNAL_WRITER_SYSTEM_PROMPT).toMatch(/No em dashes/i)
    expect(INTERNAL_WRITER_SYSTEM_PROMPT).toMatch(/No bold formatting/i)
  })

  it('system prompt forbids describing endpoint observations as "sales"', () => {
    expect(INTERNAL_WRITER_SYSTEM_PROMPT).toMatch(/sales.*transactions/i)
  })

  it('system prompt requires a JSON envelope with the CMS field set', () => {
    expect(INTERNAL_WRITER_SYSTEM_PROMPT).toMatch(/articleTitle/)
    expect(INTERNAL_WRITER_SYSTEM_PROMPT).toMatch(/introSnippet/)
    expect(INTERNAL_WRITER_SYSTEM_PROMPT).toMatch(/seoTitle/)
    expect(INTERNAL_WRITER_SYSTEM_PROMPT).toMatch(/metaDescription/)
    expect(INTERNAL_WRITER_SYSTEM_PROMPT).toMatch(/bodyMarkdown/)
  })
})

// ─────────────────────────────────────────────────────────────────
// validate_and_fix — parser + prompt structure + user-turn packaging
// ─────────────────────────────────────────────────────────────────

describe('parseValidateAndFixResponse', () => {
  it('parses a well-formed JSON response', () => {
    const raw = '```json\n' + JSON.stringify({
      articleTitle: 'August 2026 Report',
      introSnippet: 'A month of small swings.',
      seoTitle:     'August 2026 Report',
      metaDescription: 'Meta desc.',
      bodyMarkdown: '## Section\n\nCorrected prose.',
      correctionsSummary: 'Replaced +18% with +12% on Charizard.',
    }) + '\n```'
    const parsed = parseValidateAndFixResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.articleTitle).toBe('August 2026 Report')
    expect(parsed!.correctionsSummary).toMatch(/Charizard/)
    expect(parsed!.salvaged).toBe(false)
  })

  it('salvages Markdown when the model forgot the JSON envelope', () => {
    const raw = [
      '# Salvaged Title',
      '',
      'First paragraph with enough substance to clear the salvage length threshold and give the CMS something publishable to render.',
      '',
      '## Section',
      '',
      'More prose that is corrected.',
    ].join('\n')
    const parsed = parseValidateAndFixResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.articleTitle).toBe('Salvaged Title')
    expect(parsed!.salvaged).toBe(true)
    expect(parsed!.correctionsSummary).toMatch(/salvaged/i)
  })

  it('defaults correctionsSummary to "No changes needed." when absent', () => {
    const raw = '```json\n' + JSON.stringify({
      articleTitle: 'T', introSnippet: 'I', seoTitle: 'T', metaDescription: 'D',
      bodyMarkdown: '## H\n\nProse.',
    }) + '\n```'
    const parsed = parseValidateAndFixResponse(raw)
    expect(parsed!.correctionsSummary).toBe('No changes needed.')
  })
})

describe('buildValidateAndFixUserTurn', () => {
  it('surfaces "(none)" when no numeric issues + no rejected claims', () => {
    const turn = buildValidateAndFixUserTurn({
      article: { articleTitle: 'T', introSnippet: 'I', seoTitle: 'T', metaDescription: 'D', bodyMarkdown: '## H\n\nP.' },
      brief: {},
      numericIssues:  [],
      rejectedClaims: [],
      today: '2026-09-08',
    })
    expect(turn).toContain('DETERMINISTIC NUMERIC AUDIT ISSUES:')
    expect(turn).toContain('(none')
    expect(turn).toContain('REJECTED CLAIMS')
    expect(turn).toContain('MODE=validate_and_fix_internal')
  })

  it('lists numeric issues + rejected claims when present', () => {
    const turn = buildValidateAndFixUserTurn({
      article: { articleTitle: 'T', introSnippet: 'I', seoTitle: 'T', metaDescription: 'D', bodyMarkdown: '## H\n\nP.' },
      brief: {},
      numericIssues: [
        { token: { raw: '18%', value: 18, kind: 'percent', location: 'paragraph' }, reason: 'not in evidence' } as any,
      ],
      rejectedClaims: ['Viral TikTok caused the spike'],
      today: '2026-09-08',
    })
    expect(turn).toMatch(/"18%".*percent.*paragraph/)
    expect(turn).toMatch(/Viral TikTok/)
  })
})

describe('VALIDATE_AND_FIX_SYSTEM_PROMPT', () => {
  it('does NOT permit web_search (internal articles are proprietary data only)', () => {
    expect(VALIDATE_AND_FIX_SYSTEM_PROMPT).toMatch(/do NOT have web_search/i)
  })
  it('forbids inserting bold formatting or em dashes as an incidental "improvement"', () => {
    expect(VALIDATE_AND_FIX_SYSTEM_PROMPT).toMatch(/em dashes/i)
    expect(VALIDATE_AND_FIX_SYSTEM_PROMPT).toMatch(/bold formatting/i)
  })
  it('requires JSON output with correctionsSummary', () => {
    expect(VALIDATE_AND_FIX_SYSTEM_PROMPT).toMatch(/correctionsSummary/)
  })
})
