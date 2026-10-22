// Enrollment prioritisation determines in what order the cron will
// activate cards. GSC-ranked cards must come first (so our highest-
// traffic cards are migrated first and we can rollback safely before
// any no-traffic batch runs).

import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { prioritise, assignPriority } from '../enroll'
import type { ReconciliationRow } from '../strict'

function row(partial: Partial<ReconciliationRow>): ReconciliationRow {
  return {
    pp_card_slug: partial.pp_card_slug ?? 'slug',
    pp_card_name: 'name',
    pp_set_name:  partial.pp_set_name ?? 'set-a',
    pp_language:  partial.pp_language ?? 'en',
    outcome: 'approved_active', risk_class: 'catalogue_corroborated',
    confidence: 'verified', review_status: 'approved',
    printing_active_status: 'active', has_image: true,
    has_market_prices: true, has_graded_prices: true,
    effective_eligibility: partial.effective_eligibility ?? 'bulk_safe',
    gsc_rank: partial.gsc_rank ?? null,
  }
}

describe('prioritise(strategy=gsc_rank)', () => {
  it('ranked rows come before unranked rows', () => {
    const rows = [
      row({ pp_card_slug: 'c-unranked', gsc_rank: null }),
      row({ pp_card_slug: 'a-ranked-100', gsc_rank: 100 }),
      row({ pp_card_slug: 'b-ranked-10', gsc_rank: 10 }),
    ]
    const out = prioritise(rows, 'gsc_rank')
    expect(out.map(r => r.pp_card_slug)).toEqual([
      'b-ranked-10', 'a-ranked-100', 'c-unranked',
    ])
  })

  it('ties on gsc_rank break by slug alphabetically', () => {
    const rows = [
      row({ pp_card_slug: 'z', gsc_rank: 5 }),
      row({ pp_card_slug: 'a', gsc_rank: 5 }),
    ]
    const out = prioritise(rows, 'gsc_rank')
    expect(out.map(r => r.pp_card_slug)).toEqual(['a', 'z'])
  })
})

describe('prioritise(strategy=all_strict)', () => {
  it('ordering is deterministic by slug — rank is ignored', () => {
    const rows = [
      row({ pp_card_slug: 'c', gsc_rank: 1 }),
      row({ pp_card_slug: 'a', gsc_rank: 999 }),
      row({ pp_card_slug: 'b', gsc_rank: null }),
    ]
    const out = prioritise(rows, 'all_strict')
    expect(out.map(r => r.pp_card_slug)).toEqual(['a', 'b', 'c'])
  })
})

describe('prioritise(strategy=set_proximity_then_rank)', () => {
  it('ranked rows first, then unranked grouped by hottest set', () => {
    const rows = [
      // set-a has 2 ranked, set-b has 1 ranked
      row({ pp_set_name: 'set-a', pp_card_slug: 'r1', gsc_rank: 10 }),
      row({ pp_set_name: 'set-a', pp_card_slug: 'r2', gsc_rank: 20 }),
      row({ pp_set_name: 'set-b', pp_card_slug: 'r3', gsc_rank: 15 }),
      // unranked
      row({ pp_set_name: 'set-a', pp_card_slug: 'u-a', gsc_rank: null }),
      row({ pp_set_name: 'set-b', pp_card_slug: 'u-b', gsc_rank: null }),
    ]
    const out = prioritise(rows, 'set_proximity_then_rank')
    // Ranked first in rank order, then unranked with set-a (2 ranked) first.
    expect(out.map(r => r.pp_card_slug)).toEqual(['r1','r3','r2','u-a','u-b'])
  })
})

describe('assignPriority tiers', () => {
  it('rank ≤ 500 → gsc_top_500', () => {
    expect(assignPriority(row({ gsc_rank: 500 }), 0)).toEqual({ tier: 'gsc_top_500', rank: 500 })
    expect(assignPriority(row({ gsc_rank: 1 }), 0)).toEqual({ tier: 'gsc_top_500', rank: 1 })
  })
  it('500 < rank ≤ 1000 → gsc_1k', () => {
    expect(assignPriority(row({ gsc_rank: 501 }), 0)).toEqual({ tier: 'gsc_1k', rank: 501 })
    expect(assignPriority(row({ gsc_rank: 1000 }), 0)).toEqual({ tier: 'gsc_1k', rank: 1000 })
  })
  it('rank > 1000 → gsc_tail', () => {
    expect(assignPriority(row({ gsc_rank: 1001 }), 0)).toEqual({ tier: 'gsc_tail', rank: 1001 })
  })
  it('null rank → unranked_set_prio with globalIdx as rank', () => {
    expect(assignPriority(row({ gsc_rank: null }), 42)).toEqual({ tier: 'unranked_set_prio', rank: 42 })
  })
})
