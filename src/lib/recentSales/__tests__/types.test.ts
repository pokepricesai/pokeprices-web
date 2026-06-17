// Block 4B-W-1 — invariants on the recent-sales type catalogue.
// These exist to fail loudly if a future block diverges the TS
// enums from the SQL CHECK constraints.

import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  RECENT_SALE_PARSE_STATUSES,
  RECENT_SALE_REVIEW_STATUSES,
  MARKET_IMPORT_RUN_STATUSES,
  MARKET_IMPORT_RUN_SOURCES,
  PROVIDER_CARD_LINK_MATCH_METHODS,
} from '../types'

describe('RECENT_SALE_PARSE_STATUSES', () => {
  it('matches the SQL CHECK in migrations/2026-06-17-recent-sales-stage-1.sql', () => {
    expect([...RECENT_SALE_PARSE_STATUSES].sort()).toEqual([
      'ok', 'quarantined', 'rejected',
    ].sort())
  })
})

describe('RECENT_SALE_REVIEW_STATUSES', () => {
  it('matches the SQL CHECK', () => {
    expect([...RECENT_SALE_REVIEW_STATUSES].sort()).toEqual([
      'active', 'corrected', 'dismissed', 'superseded',
    ].sort())
  })

  it('is intentionally orthogonal to parse_status (no overlap with parse values)', () => {
    const parse  = new Set(RECENT_SALE_PARSE_STATUSES as ReadonlyArray<string>)
    for (const r of (RECENT_SALE_REVIEW_STATUSES as ReadonlyArray<string>)) {
      expect(parse.has(r)).toBe(false)
    }
  })
})

describe('MARKET_IMPORT_RUN_STATUSES', () => {
  it('matches the SQL CHECK', () => {
    expect([...MARKET_IMPORT_RUN_STATUSES].sort()).toEqual([
      'failed', 'partial', 'running', 'success',
    ].sort())
  })

  it('mirrors the email_onboarding_runs Block 3D status set', () => {
    // Operators reading the dashboard expect the same four words.
    for (const s of MARKET_IMPORT_RUN_STATUSES) {
      expect(['running','success','partial','failed']).toContain(s)
    }
  })
})

describe('MARKET_IMPORT_RUN_SOURCES', () => {
  it('matches the SQL CHECK', () => {
    expect([...MARKET_IMPORT_RUN_SOURCES].sort()).toEqual([
      'admin_manual', 'backfill', 'pilot', 'scraper_nightly',
    ].sort())
  })
})

describe('PROVIDER_CARD_LINK_MATCH_METHODS', () => {
  it('matches the SQL CHECK', () => {
    expect([...PROVIDER_CARD_LINK_MATCH_METHODS].sort()).toEqual([
      'admin_override', 'automatic', 'heuristic', 'manual',
    ].sort())
  })
})
