// src/lib/editorial/writer/__tests__/internalLinks.test.ts
//
// Tests for the lightweight internal-link candidate picker + the
// prompt guardrails around internal linking.

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import {
  pickInternalLinkCandidates,
  pickSetPageCandidates,
  mergeInternalLinkCandidates,
  buildResearchAndWriteUserTurn,
  RESEARCH_AND_WRITE_SYSTEM_PROMPT,
} from '../researchAndWrite'
import { CHECK_AND_FIX_SYSTEM_PROMPT } from '../checkAndFix'
import type { EditorialContextArticle } from '../../context'
import type { ReleaseContext, ReleaseItem } from '../../releaseContext'

function releaseItem(overrides: Partial<ReleaseItem> = {}): ReleaseItem {
  return {
    kind:                'upcoming',
    setName:             overrides.setName ?? 'Some Set',
    altSetNames:         overrides.altSetNames ?? [],
    setCode:             null,
    releaseDate:         '2026-11-01',
    jpReleaseDate:       null,
    region:              null,
    confirmed:           true,
    cardCount:           null,
    daysDelta:           30,
    releaseCalendarId:   null,
    pokePricesSetUrl:    overrides.pokePricesSetUrl ?? null,
    sources:             ['release_calendar'],
    coverage:            { publishedInsights: [], plannedProjects: [], status: 'none' },
    timingOpportunities: [],
    notes:               null,
    ...overrides,
  }
}
function releaseContext(items: { recent?: ReleaseItem[]; upcoming?: ReleaseItem[] } = {}): ReleaseContext {
  return {
    today: '2026-09-08', windowDaysBack: 45, windowDaysForward: 120,
    recent: items.recent ?? [], upcoming: items.upcoming ?? [],
    upcomingCoverageIsThin: false, gapNote: null,
  }
}

function article(overrides: Partial<EditorialContextArticle> = {}): EditorialContextArticle {
  return {
    id:            overrides.id ?? 'a',
    slug:          overrides.slug ?? 'slug',
    headline:      overrides.headline ?? 'Headline',
    intro:         overrides.intro ?? null,
    publishedAt:   overrides.publishedAt ?? '2026-08-01',
    theme:         overrides.theme ?? null,
    themeLabel:    overrides.themeLabel ?? null,
    seoTitle:      null,
    seoDescription: null,
    setRefs:       null,
    cardRefs:      null,
    wordCount:     0,
    bodyExcerpt:   '',
    publicUrl:     `https://www.pokeprices.io/insights/${overrides.slug ?? 'slug'}`,
  }
}

// ─────────────────────────────────────────────────────────────────
// pickInternalLinkCandidates
// ─────────────────────────────────────────────────────────────────

describe('pickInternalLinkCandidates', () => {
  it('returns [] when no articles are provided', () => {
    expect(pickInternalLinkCandidates({
      project: { title: 'X', angle: null, articleType: 'upcoming_set' },
      articles: [],
    })).toEqual([])
  })

  it('ranks by keyword overlap with the project title/angle', () => {
    const articles = [
      article({ id: 'a', slug: 'celebration-preorder',   headline: 'Celebration Set: preorder guide',          intro: 'Anniversary anniversary release',       publishedAt: '2026-08-01' }),
      article({ id: 'b', slug: 'random-guide',           headline: 'Grading guide for beginners',              intro: 'PSA and CGC comparison.',                publishedAt: '2026-08-15' }),
      article({ id: 'c', slug: 'anniversary-history',    headline: 'Anniversary sets in Pokémon history',      intro: 'Every anniversary release compared.',    publishedAt: '2026-07-01' }),
    ]
    const picked = pickInternalLinkCandidates({
      project: { title: 'Pokémon TCG: 30th Celebration - Everything We Know So Far', angle: 'What collectors need to know about the anniversary release.', articleType: 'upcoming_set' },
      articles,
    })
    // Overlap articles surface first; the unrelated grading guide is
    // dropped entirely (zero overlap).
    expect(picked.map(p => p.url)).toEqual([
      'https://www.pokeprices.io/insights/celebration-preorder',
      'https://www.pokeprices.io/insights/anniversary-history',
    ])
  })

  it('respects the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => article({
      id: String(i), slug: `celebration-${i}`, headline: `Celebration article ${i}`, intro: 'anniversary release preview',
      publishedAt: `2026-08-${(i % 28) + 1}`,
    }))
    const picked = pickInternalLinkCandidates({
      project:  { title: 'Celebration Collection preview', angle: null, articleType: 'upcoming_set' },
      articles: many,
      limit:    5,
    })
    expect(picked).toHaveLength(5)
  })

  it('returns only { title, url } — no other fields leak', () => {
    const articles = [article({ headline: 'Anniversary article', intro: 'anniversary release', slug: 'x' })]
    const picked = pickInternalLinkCandidates({
      project: { title: 'Anniversary preview', angle: null, articleType: 'upcoming_set' },
      articles,
    })
    expect(picked[0]).toEqual({ title: 'Anniversary article', url: 'https://www.pokeprices.io/insights/x' })
    expect(Object.keys(picked[0])).toEqual(['title', 'url'])
  })

  it('returns [] when the project brief has no tokenizable keywords (no recent-fallback)', () => {
    const articles = [
      article({ id: '1', slug: 'a', headline: 'A', publishedAt: '2026-07-01' }),
      article({ id: '2', slug: 'b', headline: 'B', publishedAt: '2026-08-01' }),
    ]
    expect(pickInternalLinkCandidates({
      project:  { title: 'the', angle: 'a', articleType: 'x' },   // all stop-words / too short
      articles,
    })).toEqual([])
  })

  it('returns [] when no article has any keyword overlap (no recent-fallback)', () => {
    const articles = [
      article({ id: '1', slug: 'grading', headline: 'Grading guide',     intro: 'psa cgc' }),
      article({ id: '2', slug: 'market',  headline: 'Market snapshot',   intro: 'raw prices' }),
    ]
    expect(pickInternalLinkCandidates({
      project:  { title: 'Celebration anniversary preview', angle: null, articleType: 'upcoming_set' },
      articles,
    })).toEqual([])
  })

  it('is stable — same inputs produce the same output', () => {
    const articles = [
      article({ id: 'a', slug: 'anniversary', headline: 'Anniversary set',        intro: 'anniversary', publishedAt: '2026-08-01' }),
      article({ id: 'b', slug: 'grading',     headline: 'Grading guide',          intro: 'grading',     publishedAt: '2026-08-02' }),
    ]
    const args = { project: { title: 'Anniversary set preview', angle: null, articleType: 'upcoming_set' }, articles }
    expect(pickInternalLinkCandidates(args)).toEqual(pickInternalLinkCandidates(args))
  })
})

// ─────────────────────────────────────────────────────────────────
// pickSetPageCandidates — uses ReleaseContext pokePricesSetUrl
// ─────────────────────────────────────────────────────────────────

describe('pickSetPageCandidates', () => {
  const project = { title: 'Pokémon TCG: 30th Celebration - Everything We Know So Far', angle: null, articleType: 'upcoming_set' }

  it('returns [] when release context is missing', () => {
    expect(pickSetPageCandidates({ project, release: null })).toEqual([])
    expect(pickSetPageCandidates({ project, release: undefined })).toEqual([])
  })

  it('returns [] when no release items match project keywords', () => {
    const release = releaseContext({ upcoming: [
      releaseItem({ setName: 'Grading Standards Update', pokePricesSetUrl: '/set/grading-x' }),
    ] })
    expect(pickSetPageCandidates({ project, release })).toEqual([])
  })

  it('returns only sets whose tokens actually match the project brief', () => {
    // Note: tokenizer does NOT stem — "Celebrations" and "celebration"
    // are treated as different tokens, so only exact-word matches
    // qualify. This is the intended, conservative behaviour.
    const release = releaseContext({
      recent: [
        releaseItem({ setName: 'Celebrations',          pokePricesSetUrl: '/set/celebrations' }),          // NO match (plural s)
      ],
      upcoming: [
        releaseItem({ setName: 'Celebration Collection', pokePricesSetUrl: '/set/celebration-collection' }), // matches "celebration"
        releaseItem({ setName: 'Grading Standards',      pokePricesSetUrl: '/set/grading-standards' }),      // no match
      ],
    })
    const picked = pickSetPageCandidates({ project, release })
    expect(picked.map(p => p.url)).toEqual([
      '/set/celebration-collection',
    ])
    expect(Object.keys(picked[0])).toEqual(['title', 'url'])
  })

  it('altSetNames are considered for matching too', () => {
    const release = releaseContext({ upcoming: [
      releaseItem({ setName: 'JP Original Name', altSetNames: ['Celebration Collection'], pokePricesSetUrl: '/set/celebration-collection' }),
    ] })
    const picked = pickSetPageCandidates({ project, release })
    expect(picked).toHaveLength(1)
    expect(picked[0].url).toBe('/set/celebration-collection')
  })

  it('skips items without a pokePricesSetUrl (not indexed on the site)', () => {
    const release = releaseContext({ upcoming: [
      releaseItem({ setName: 'Celebration Collection', pokePricesSetUrl: null }),
    ] })
    expect(pickSetPageCandidates({ project, release })).toEqual([])
  })

  it('dedupes when the same set URL appears in both recent and upcoming', () => {
    const release = releaseContext({
      recent:   [releaseItem({ setName: 'Celebration Collection', pokePricesSetUrl: '/set/celebration-collection' })],
      upcoming: [releaseItem({ setName: 'Celebration Collection', pokePricesSetUrl: '/set/celebration-collection' })],
    })
    const picked = pickSetPageCandidates({ project, release })
    expect(picked).toHaveLength(1)
  })

  it('respects the limit', () => {
    const release = releaseContext({ upcoming: Array.from({ length: 12 }, (_, i) => releaseItem({
      setName: `Celebration set ${i}`, pokePricesSetUrl: `/set/celebration-${i}`,
    })) })
    expect(pickSetPageCandidates({ project, release, limit: 3 })).toHaveLength(3)
  })
})

// ─────────────────────────────────────────────────────────────────
// mergeInternalLinkCandidates — dedupes by URL, caps at limit
// ─────────────────────────────────────────────────────────────────

describe('mergeInternalLinkCandidates', () => {
  it('merges two lists, dedupes by URL, preserves primary-first order', () => {
    const primary   = [{ title: 'A article', url: '/insights/a' }, { title: 'B article', url: '/insights/b' }]
    const secondary = [{ title: 'A set',     url: '/insights/a' /* dup */ }, { title: 'C set', url: '/set/c' }]
    const merged = mergeInternalLinkCandidates(primary, secondary, 10)
    expect(merged.map(m => m.url)).toEqual(['/insights/a', '/insights/b', '/set/c'])
    // Primary "A article" wins the dup, secondary "A set" is dropped.
    expect(merged[0].title).toBe('A article')
  })

  it('caps at the supplied limit', () => {
    const primary   = Array.from({ length: 10 }, (_, i) => ({ title: `P${i}`, url: `/p${i}` }))
    const secondary = Array.from({ length: 10 }, (_, i) => ({ title: `S${i}`, url: `/s${i}` }))
    expect(mergeInternalLinkCandidates(primary, secondary, 10)).toHaveLength(10)
  })

  it('skips entries with no URL', () => {
    const merged = mergeInternalLinkCandidates(
      [{ title: 'good', url: '/x' }, { title: 'empty', url: '' }, { title: 'missing', url: undefined as any }],
      [],
      10,
    )
    expect(merged.map(m => m.url)).toEqual(['/x'])
  })
})

// ─────────────────────────────────────────────────────────────────
// buildResearchAndWriteUserTurn — internalLinks passthrough
// ─────────────────────────────────────────────────────────────────

describe('buildResearchAndWriteUserTurn with internalLinks', () => {
  const project = { id: 12, title: 'Celebration Collection', angle: null, articleType: 'upcoming_set' }
  const today = '2026-09-08'

  it('includes internalLinks when provided', () => {
    const brief = buildResearchAndWriteUserTurn({
      project, today,
      internalLinks: [
        { title: 'Anniversary sets in Pokémon history', url: 'https://www.pokeprices.io/insights/anniversary-history' },
      ],
    })
    expect(brief).toContain('internalLinks')
    expect(brief).toContain('anniversary-history')
  })

  it('omits internalLinks field entirely when empty', () => {
    const brief = buildResearchAndWriteUserTurn({ project, today, internalLinks: [] })
    expect(brief).not.toContain('internalLinks')
  })

  it('omits internalLinks field entirely when undefined', () => {
    const brief = buildResearchAndWriteUserTurn({ project, today })
    expect(brief).not.toContain('internalLinks')
  })
})

// ─────────────────────────────────────────────────────────────────
// System prompt guardrails
// ─────────────────────────────────────────────────────────────────

describe('system prompt guardrails for internal linking', () => {
  it('research_and_write prompt tells the model to use 2-5 natural internal links and never invent a URL', () => {
    expect(RESEARCH_AND_WRITE_SYSTEM_PROMPT).toContain('INTERNAL LINKS')
    expect(RESEARCH_AND_WRITE_SYSTEM_PROMPT).toContain('2-5 natural internal links')
    expect(RESEARCH_AND_WRITE_SYSTEM_PROMPT).toContain('Do NOT invent an internal URL')
    expect(RESEARCH_AND_WRITE_SYSTEM_PROMPT).toContain('Zero internal links is fine')
  })

  it('check_and_fix prompt tells the checker to preserve valid internal links', () => {
    expect(CHECK_AND_FIX_SYSTEM_PROMPT).toContain('PRESERVE valid internal links')
    expect(CHECK_AND_FIX_SYSTEM_PROMPT).toContain('/path')
  })
})
