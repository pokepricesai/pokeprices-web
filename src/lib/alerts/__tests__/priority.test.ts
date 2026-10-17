// Block 5A-W-8 — priority score formula + migration shape tests.
// The SQL function refresh_user_interest_priorities() and the view
// user_interest_cards live in the migration; we cannot run SQL here,
// so this test pins:
//   * the JS mirror of the score formula (semantically identical),
//   * the migration file's structural shape (no destructive DDL, the
//     three expected columns added, both views + the function
//     created, RLS / security DEFINER on the function).

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

import {
  MIN_USER_INTEREST_SCORE,
  USER_INTEREST_SOURCE,
  priorityScoreFromInterest,
} from '../priority'

const MIGRATION_PATH = path.join(
  process.cwd(),
  'migrations',
  '2026-06-24-user-interest-priority.sql',
)

function readMigration(): string {
  if (!existsSync(MIGRATION_PATH)) return ''
  return readFileSync(MIGRATION_PATH, 'utf8')
}

// ─────────────────────────────────────────────────────────────────────
// Constants + formula
// ─────────────────────────────────────────────────────────────────────

describe('priority constants', () => {
  it('uses the exact source tag the SQL function stamps on rows', () => {
    expect(USER_INTEREST_SOURCE).toBe('user_interest')
    expect(readMigration()).toMatch(/'user_interest'/)
  })

  it('sets a minimum priority of 1 so any interest beats the implicit 0', () => {
    expect(MIN_USER_INTEREST_SCORE).toBe(1)
  })
})

describe('priorityScoreFromInterest', () => {
  it('returns the minimum for null / undefined / NaN / negative input', () => {
    expect(priorityScoreFromInterest(null)).toBe(MIN_USER_INTEREST_SCORE)
    expect(priorityScoreFromInterest(undefined)).toBe(MIN_USER_INTEREST_SCORE)
    expect(priorityScoreFromInterest(Number.NaN)).toBe(MIN_USER_INTEREST_SCORE)
    expect(priorityScoreFromInterest(-3)).toBe(MIN_USER_INTEREST_SCORE)
  })

  it('returns 1 + N for N >= 0', () => {
    expect(priorityScoreFromInterest(0)).toBe(1)
    expect(priorityScoreFromInterest(1)).toBe(2)
    expect(priorityScoreFromInterest(7)).toBe(8)
    expect(priorityScoreFromInterest(100)).toBe(101)
  })

  it('floors fractional counts so the SQL INT cast lines up', () => {
    expect(priorityScoreFromInterest(2.9)).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Migration shape — additive only, expected DDL present
// ─────────────────────────────────────────────────────────────────────

describe('user-interest-priority migration', () => {
  it('exists and is non-empty', () => {
    const sql = readMigration()
    expect(sql.length).toBeGreaterThan(0)
  })

  it('adds the three priority columns to recent_sales_card_allow_list', () => {
    const sql = readMigration()
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.recent_sales_card_allow_list/i)
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+priority_source/i)
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+priority_score/i)
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+priority_updated_at/i)
  })

  it('creates the user_interest_cards view + the stats view', () => {
    const sql = readMigration()
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.user_interest_cards/i)
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.user_interest_card_stats/i)
  })

  it('joins through cards.card_url_slug → cards.card_slug → provider_card_links (the right path)', () => {
    const sql = readMigration()
    // The watchlist + portfolio_items columns store the URL slug,
    // and provider_card_links indexes the bare numeric. The view
    // MUST go through cards to bridge them.
    expect(sql).toMatch(/LEFT\s+JOIN\s+public\.cards\s+c/i)
    expect(sql).toMatch(/c\.card_url_slug\s*=\s*agg\.card_url_slug/i)
    expect(sql).toMatch(/pl\.card_slug\s*=\s*c\.card_slug/i)
  })

  it('creates the refresh function as SECURITY DEFINER with REVOKE FROM PUBLIC', () => {
    const sql = readMigration()
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.refresh_user_interest_priorities/i)
    expect(sql).toMatch(/SECURITY\s+DEFINER/i)
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.refresh_user_interest_priorities\(\)\s+FROM\s+PUBLIC/i)
  })

  it('uses the 1 + GREATEST(0, distinct_user_count) score formula (matches the JS mirror)', () => {
    const sql = readMigration()
    expect(sql).toMatch(/1\s*\+\s*GREATEST\(\s*0\s*,\s*COALESCE\(v\.distinct_user_count,\s*0\)\s*\)/i)
  })

  it('creates the partial priority index on the allow_list', () => {
    const sql = readMigration()
    expect(sql).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_allow_list_priority/i)
    expect(sql).toMatch(/WHERE\s+enabled\s*=\s*TRUE\s+AND\s+priority_score\s*>\s*0/i)
  })

  it('contains no destructive DDL against existing tables', () => {
    const raw = readMigration()
    // Strip line comments so the operator playbook in trailing
    // comments does not trip these checks.
    const sql = raw.replace(/--[^\n]*/g, '')
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i)
    expect(sql).not.toMatch(/\bTRUNCATE\b/i)
    expect(sql).not.toMatch(/\bDELETE\s+FROM\s+public\.(watchlist|portfolio_items|portfolios|cards|provider_card_links|alert_events|user_alert_preferences)\b/i)
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+public\.(watchlist|portfolio_items|portfolios|cards|provider_card_links)\b/i)
  })

  it('does not store or echo user_id / email in any new column or view definition', () => {
    const sql = readMigration()
    // The view exposes aggregate COUNTS by user, never individual ids.
    expect(sql).not.toMatch(/SELECT[^;]*\buser_id\b[^;]*FROM\s+public\.user_interest_cards/i)
    // No mention of email anywhere in the new artefacts.
    expect(sql).not.toMatch(/\bemail\b/i)
  })

  it('wraps the schema-changing block in a single transaction with sanity checks at the end', () => {
    const sql = readMigration()
    expect(sql).toMatch(/^BEGIN\s*;/im)
    expect(sql).toMatch(/COMMIT\s*;/m)
    expect(sql).toMatch(/expected\s+3\s+priority\s+columns/i)
    expect(sql).toMatch(/expected\s+2\s+views/i)
    expect(sql).toMatch(/refresh function missing/i)
  })
})
