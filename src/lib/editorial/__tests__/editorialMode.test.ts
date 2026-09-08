// src/lib/editorial/__tests__/editorialMode.test.ts

import { describe, it, expect } from 'vitest'
import { getEditorialMode, isExternalProject, isInternalProject } from '../editorialMode'

describe('getEditorialMode — article_type first', () => {
  it.each([
    'upcoming_set', 'new_set', 'news', 'release_news',
    'product_announcement', 'set_preview', 'evergreen_guide', 'external_research',
  ] as const)('classifies %s as external', type => {
    expect(getEditorialMode({ article_type: type })).toBe('external')
  })

  it.each([
    'monthly_market_report', 'population_scarcity', 'data_study',
    'market_analysis', 'price_analysis', 'grading_analysis',
    'search_trends', 'movers',
  ] as const)('classifies %s as internal', type => {
    expect(getEditorialMode({ article_type: type })).toBe('internal')
  })

  it('accepts articleType (camel-case) as an alias for article_type', () => {
    expect(getEditorialMode({ articleType: 'new_set' as any })).toBe('external')
    expect(getEditorialMode({ articleType: 'monthly_market_report' as any })).toBe('internal')
  })

  it('title heuristic must NOT accidentally send an internal data article to external', () => {
    // The user's example: an internal market_analysis whose title
    // happens to contain "release" must stay internal.
    expect(getEditorialMode({
      article_type: 'market_analysis',
      title:        'August 2026 release-driven market movers',
    })).toBe('internal')

    // Also: "set" and "Pokémon" in a monthly-report title must not
    // flip it to external.
    expect(getEditorialMode({
      article_type: 'monthly_market_report',
      title:        'Pokémon TCG market report August 2026 — every set',
    })).toBe('internal')
  })

  it('unknown non-empty article_types default to internal (safer)', () => {
    expect(getEditorialMode({ article_type: 'some_new_type' })).toBe('internal')
    expect(getEditorialMode({ article_type: 'grading' })).toBe('internal')
  })
})

describe('getEditorialMode — legacy title fallback (very restrictive)', () => {
  it('empty article_type + "everything we know" title routes to external', () => {
    expect(getEditorialMode({ article_type: '', title: 'Celebration Collection: Everything We Know So Far' })).toBe('external')
  })

  it('empty article_type + generic Pokémon title stays internal by default', () => {
    // NEVER match on "Pokémon" / "release" / "set" alone.
    expect(getEditorialMode({ article_type: '', title: 'Pokémon release round-up' })).toBe('internal')
    expect(getEditorialMode({ article_type: '', title: 'Every set from 2026' })).toBe('internal')
  })

  it('evergreen + external phrase → external', () => {
    expect(getEditorialMode({ article_type: 'evergreen', title: 'Preview of upcoming Prismatic Evolutions' })).toBe('external')
  })

  it('evergreen + non-external phrasing → internal', () => {
    expect(getEditorialMode({ article_type: 'evergreen', title: 'A guide to PSA grading' })).toBe('internal')
  })
})

describe('convenience predicates', () => {
  it('isExternalProject / isInternalProject wrap getEditorialMode', () => {
    expect(isExternalProject({ article_type: 'upcoming_set' })).toBe(true)
    expect(isInternalProject({ article_type: 'upcoming_set' })).toBe(false)
    expect(isExternalProject({ article_type: 'monthly_market_report' })).toBe(false)
    expect(isInternalProject({ article_type: 'monthly_market_report' })).toBe(true)
  })
})

describe('acceptance — the Celebration Collection project resolves to external', () => {
  it('project 12 shape', () => {
    expect(getEditorialMode({
      article_type: 'upcoming_set',
      title:        'Pokémon TCG: 30th Celebration - Everything We Know So Far',
      angle:        null,
    })).toBe('external')
  })
})

describe('regression — a monthly_market_report never leaks to external', () => {
  it('article_type wins even against very external-looking titles', () => {
    expect(getEditorialMode({
      article_type: 'monthly_market_report',
      title:        'Pokémon TCG Market Report — August 2026: everything we know about new releases',
      angle:        'Deep dive into recent set announcements and market movers.',
    })).toBe('internal')
  })
})
