// src/lib/editorial/__tests__/projects.test.ts
//
// EIC Block 2 — unit tests for the shared editorial helpers.

import { describe, it, expect, vi } from 'vitest'

// projects.ts imports 'server-only'.
vi.mock('server-only', () => ({}))

import {
  pickWritableProjectFields,
  validateProjectWrite,
  currentWeekWindowUtc,
  isThisWeek,
  EDITORIAL_STATUSES,
  EDITORIAL_ARTICLE_TYPES,
  ARTICLE_TYPE_LABELS,
} from '../projects'
import { getEditorialMode } from '../editorialMode'

describe('pickWritableProjectFields', () => {
  it('keeps writable columns and drops server-controlled ones', () => {
    const out = pickWritableProjectFields({
      title: 'x', status: 'idea', priority: 3,
      id: 42, created_at: 'bad', updated_at: 'bad',
      random: 'nope',
    } as any)
    expect(out).toEqual({ title: 'x', status: 'idea', priority: 3 })
  })
})

describe('validateProjectWrite', () => {
  it('accepts a minimal payload', () => {
    expect(validateProjectWrite({ title: 'A good idea' })).toBeNull()
  })
  it('rejects unknown status', () => {
    expect(validateProjectWrite({ status: 'weird' } as any)).toMatch(/status/)
  })
  it('rejects unknown article_type', () => {
    expect(validateProjectWrite({ article_type: 'weird' } as any)).toMatch(/article_type/)
  })
  it('accepts every declared status + type', () => {
    for (const s of EDITORIAL_STATUSES) expect(validateProjectWrite({ status: s } as any)).toBeNull()
    for (const t of EDITORIAL_ARTICLE_TYPES) expect(validateProjectWrite({ article_type: t } as any)).toBeNull()
  })
  it('rejects out-of-range priority', () => {
    expect(validateProjectWrite({ priority: 0 } as any)).toMatch(/priority/)
    expect(validateProjectWrite({ priority: 6 } as any)).toMatch(/priority/)
    expect(validateProjectWrite({ priority: 2.5 } as any)).toMatch(/priority/)
  })
  it('rejects bad target_publish_at', () => {
    expect(validateProjectWrite({ target_publish_at: '2026/09/06' } as any)).toMatch(/target_publish_at/)
    expect(validateProjectWrite({ target_publish_at: '1999-01-01' } as any)).toMatch(/year/)
  })
  it('accepts null target_publish_at', () => {
    expect(validateProjectWrite({ target_publish_at: null } as any)).toBeNull()
  })
  it('rejects malformed insights_id', () => {
    expect(validateProjectWrite({ insights_id: 'not-a-uuid' } as any)).toMatch(/insights_id/)
  })
  it('accepts null insights_id', () => {
    expect(validateProjectWrite({ insights_id: null } as any)).toBeNull()
  })
  it('rejects empty title string', () => {
    expect(validateProjectWrite({ title: '   ' } as any)).toMatch(/title/)
  })

  // ── Strategist materialization acceptance ─────────────────────
  //
  // Regression for the "Save as Idea / Add to Plan does nothing" bug
  // on external Strategist recommendations. Root cause was that
  // EDITORIAL_ARTICLE_TYPES was stale and didn't include the new
  // external/internal types the Strategist can suggest, so every
  // external recommendation failed validateProjectWrite and the UI
  // showed no visible feedback.

  it('accepts an external evergreen recommendation (Pikachu history)', () => {
    expect(validateProjectWrite({
      title: 'The History of Pikachu Pokémon Cards: From Base Set to Modern Chases',
      angle: 'A collector-focused history of Pikachu cards from the earliest English and Japanese releases through major promos, iconic artworks and modern chase cards.',
      article_type: 'evergreen_guide',
      status: 'idea',
      priority: 2,
    } as any)).toBeNull()
  })

  it('accepts an external release recommendation (upcoming set)', () => {
    expect(validateProjectWrite({
      title: '30th Celebration: Everything We Know',
      article_type: 'upcoming_set',
      status: 'planned',
      priority: 1,
    } as any)).toBeNull()
  })

  it('accepts an internal price-analysis recommendation', () => {
    expect(validateProjectWrite({
      title: 'Pikachu Price Trends in PokePrices Data',
      article_type: 'price_analysis',
      status: 'idea',
      priority: 2,
    } as any)).toBeNull()
  })

  it('accepts every previously-suggested external type', () => {
    for (const t of ['news', 'release_news', 'product_announcement', 'set_preview', 'external_research', 'new_set'] as const) {
      expect(validateProjectWrite({ article_type: t } as any)).toBeNull()
    }
  })

  it('accepts every previously-suggested internal type', () => {
    for (const t of ['population_scarcity', 'market_analysis', 'grading_analysis', 'search_trends', 'movers', 'data_study'] as const) {
      expect(validateProjectWrite({ article_type: t } as any)).toBeNull()
    }
  })

  it('keeps the legacy "evergreen" value working for old rows', () => {
    expect(validateProjectWrite({ article_type: 'evergreen' } as any)).toBeNull()
  })
})

describe('EDITORIAL_ARTICLE_TYPES + ARTICLE_TYPE_LABELS', () => {
  it('has a matching label for every declared type (no drift)', () => {
    for (const t of EDITORIAL_ARTICLE_TYPES) {
      expect(ARTICLE_TYPE_LABELS[t]).toBeTruthy()
      expect(ARTICLE_TYPE_LABELS[t].length).toBeGreaterThan(0)
    }
  })
})

// ── Canonical routing round-trip ─────────────────────────────────
//
// Every whitelisted article_type must resolve to a lane via
// getEditorialMode. Legacy 'evergreen' falls through the article-
// type-first branch and lands on the "internal by default" bucket
// (see editorialMode.ts) unless the title carries an external hint.

describe('article_type → editorial mode routing', () => {
  it('routes the Pikachu evergreen recommendation to external', () => {
    expect(getEditorialMode({
      article_type: 'evergreen_guide',
      title: 'The History of Pikachu Pokémon Cards',
    })).toBe('external')
  })

  it('routes an upcoming-set recommendation to external', () => {
    expect(getEditorialMode({
      article_type: 'upcoming_set',
      title: '30th Celebration: Everything We Know',
    })).toBe('external')
  })

  it('routes an internal price-analysis recommendation to internal', () => {
    expect(getEditorialMode({
      article_type: 'price_analysis',
      title: 'Pikachu Price Trends in PokePrices Data',
    })).toBe('internal')
  })

  it('routes every canonical external type to external', () => {
    for (const t of ['upcoming_set', 'new_set', 'news', 'release_news', 'product_announcement', 'set_preview', 'evergreen_guide', 'external_research'] as const) {
      expect(getEditorialMode({ article_type: t, title: 't' })).toBe('external')
    }
  })

  it('routes every canonical internal type to internal', () => {
    for (const t of ['monthly_market_report', 'population_scarcity', 'data_study', 'market_analysis', 'price_analysis', 'grading_analysis', 'search_trends', 'movers'] as const) {
      expect(getEditorialMode({ article_type: t, title: 't' })).toBe('internal')
    }
  })
})

describe('currentWeekWindowUtc', () => {
  it('produces a Monday–Sunday window covering 7 days', () => {
    // Pick a known Wednesday in UTC (2026-09-02 was a Wednesday).
    const w = currentWeekWindowUtc(new Date('2026-09-02T12:00:00Z'))
    expect(w.startIso).toBe('2026-08-31') // Monday
    expect(w.endIso).toBe('2026-09-06')   // Sunday
  })
  it('treats Sunday as the last day of the current week, not first of the next', () => {
    const w = currentWeekWindowUtc(new Date('2026-09-06T23:59:59Z'))
    expect(w.startIso).toBe('2026-08-31')
    expect(w.endIso).toBe('2026-09-06')
  })
  it('rolls over correctly on a Monday', () => {
    const w = currentWeekWindowUtc(new Date('2026-09-07T00:00:01Z'))
    expect(w.startIso).toBe('2026-09-07')
    expect(w.endIso).toBe('2026-09-13')
  })
})

describe('isThisWeek', () => {
  const ref = new Date('2026-09-02T12:00:00Z') // Wed
  it('returns true for dates in the current week', () => {
    expect(isThisWeek('2026-08-31', ref)).toBe(true) // Mon
    expect(isThisWeek('2026-09-06', ref)).toBe(true) // Sun
  })
  it('returns false for dates outside the current week', () => {
    expect(isThisWeek('2026-08-30', ref)).toBe(false)
    expect(isThisWeek('2026-09-07', ref)).toBe(false)
  })
  it('returns false for null / malformed input', () => {
    expect(isThisWeek(null, ref)).toBe(false)
    expect(isThisWeek('nope', ref)).toBe(false)
  })
})
