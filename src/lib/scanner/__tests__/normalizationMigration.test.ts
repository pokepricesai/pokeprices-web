// Block 5A-W-51B.1 — static assertions on the promoted normalization
// migration. Guarantees the SQL file has the exact shape production
// needs and rules out common regressions (accidentally reverting the
// regex, dropping the REINDEX, touching card/set_metadata data,
// modifying scan_card_match).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION = readFileSync(
  join(process.cwd(), 'migrations', '2026-08-05-fix-card-number-normalisation.sql'),
  'utf8',
)
// Non-comment lines only — negative assertions run against this so
// the informational Rollback / Smoke-query blocks (which legitimately
// mention buggy patterns and 51B column names) do not trigger false
// positives.
const MIGRATION_ACTIVE = MIGRATION
  .split(/\r?\n/)
  .filter(l => !l.trim().startsWith('--'))
  .join('\n')

describe('normalisation migration — regex fix', () => {
  it('uses the corrected regex with a leading-boundary anchor', () => {
    // The corrected pattern requires the zero run to be at string start
    // OR immediately after a non-digit character.
    expect(MIGRATION).toContain(`'(^|[^0-9])0+([0-9])', '\\1\\2', 'g'`)
  })

  it('does NOT reintroduce the buggy unanchored pattern in active SQL', () => {
    // A future edit that reverts to `'0+([0-9])', '\1'` would silently
    // re-corrupt normalisation for ~15% of the catalogue. The rollback
    // block legitimately shows the buggy pattern (inside comments), so
    // we scan only active (non-comment) lines.
    expect(MIGRATION_ACTIVE).not.toMatch(/regexp_replace\([^,]+,\s*'0\+\(\[0-9\]\)'\s*,\s*'\\1'/)
  })

  it('replaces _normalize_card_number(text) via CREATE OR REPLACE (grants preserved)', () => {
    expect(MIGRATION).toMatch(/CREATE OR REPLACE FUNCTION _normalize_card_number\(s text\)/)
  })
})

describe('normalisation migration — scope discipline', () => {
  it('runs inside a transaction', () => {
    expect(MIGRATION).toMatch(/^BEGIN;/m)
    expect(MIGRATION).toMatch(/^COMMIT;/m)
  })

  it('does NOT touch scan_card_match (the live 51B body must be preserved unchanged)', () => {
    expect(MIGRATION).not.toMatch(/CREATE[^\n]*FUNCTION[^\n]*scan_card_match/i)
    expect(MIGRATION).not.toMatch(/DROP[^\n]*FUNCTION[^\n]*scan_card_match/i)
  })

  it('does NOT UPDATE / INSERT / DELETE any table row', () => {
    // Comments in the file may reference the word UPDATE for context;
    // ensure no actual SQL statement issues one.
    for (const stmt of ['UPDATE ', 'INSERT INTO', 'DELETE FROM']) {
      // Allow the words only inside SQL comments (lines starting with `--`).
      const lines = MIGRATION.split(/\r?\n/)
      const activeStmts = lines
        .filter(l => !l.trim().startsWith('--'))
        .filter(l => l.includes(stmt))
      expect(activeStmts, `Found active statement using "${stmt}"`).toEqual([])
    }
  })

  it('does NOT reference cards or set_metadata as targets', () => {
    // Column reads inside function bodies are fine; there must be no
    // ALTER TABLE / TRUNCATE / etc against those tables.
    for (const op of ['ALTER TABLE cards', 'ALTER TABLE set_metadata', 'TRUNCATE cards', 'TRUNCATE set_metadata']) {
      expect(MIGRATION).not.toContain(op)
    }
  })
})

describe('normalisation migration — index rebuild', () => {
  it('REINDEXes both dependent expression indexes', () => {
    expect(MIGRATION).toContain('REINDEX INDEX idx_cards_norm_card_number')
    expect(MIGRATION).toContain('REINDEX INDEX idx_cards_norm_card_number_display')
  })
})

describe('normalisation migration — preflight + postflight', () => {
  it('preflight asserts the buggy regex is still live (fails loudly if already fixed)', () => {
    expect(MIGRATION).toMatch(/Preflight failed:[\s\S]{0,150}buggy value ''12''/)
  })

  it('postflight asserts every required example from the block spec', () => {
    // Each required case appears as a DO-block line of the form:
    //   SELECT _normalize_card_number('INPUT') INTO v; IF v <> 'EXPECTED' THEN RAISE...
    // Assert both the input+INTO line and the corresponding IF+expected are present.
    const requiredCases: Array<[string, string]> = [
      ["'001'",       "'1'"],
      ["'012'",       "'12'"],
      ["'030/086'",   "'30/86'"],
      ["'SWSH-001'",  "'swsh-1'"],
      ["'102'",       "'102'"],
      ["'100'",       "'100'"],
      ["'102/100'",   "'102/100'"],
      ["'12/100'",    "'12/100'"],
      ["'200/100'",   "'200/100'"],
      ["'20/10'",     "'20/10'"],
      ["'TG12/TG30'", "'tg12/tg30'"],
    ]
    for (const [input, expected] of requiredCases) {
      expect(MIGRATION_ACTIVE, `postflight missing SELECT for ${input}`).toContain(`_normalize_card_number(${input})`)
      expect(MIGRATION_ACTIVE, `postflight missing expected value ${expected} for ${input}`).toMatch(new RegExp(`IF v <> ${expected.replace(/[/\-]/g, '\\$&')}`))
    }
  })

  it('postflight asserts distinctness (102 vs 12, 102/100 vs 12/100, 200/100 vs 20/10)', () => {
    expect(MIGRATION).toMatch(/_normalize_card_number\('102'\)[\s\S]{0,60}=[\s\S]{0,60}_normalize_card_number\('12'\)[\s\S]{0,100}collides with 12/)
    expect(MIGRATION).toMatch(/_normalize_card_number\('102\/100'\)[\s\S]{0,60}=[\s\S]{0,60}_normalize_card_number\('12\/100'\)[\s\S]{0,100}collides with 12\/100/)
    expect(MIGRATION).toMatch(/_normalize_card_number\('200\/100'\)[\s\S]{0,60}=[\s\S]{0,60}_normalize_card_number\('20\/10'\)[\s\S]{0,100}collides with 20\/10/)
  })
})

describe('normalisation migration — smoke queries + rollback', () => {
  it('includes the block-spec smoke queries as informational comments', () => {
    expect(MIGRATION).toContain(`SELECT _normalize_card_number('102')`)
    expect(MIGRATION).toContain(`SELECT _normalize_card_number('102/100') = _normalize_card_number('12/100')`)
    expect(MIGRATION).toContain(`FROM scan_card_match('102/100', NULL, NULL, NULL, FALSE, 'jp')`)
  })

  it('includes an inline rollback block', () => {
    expect(MIGRATION).toMatch(/Rollback[\s\S]{0,600}0\+\(\[0-9\]\)/)
  })
})

describe('normalisation migration — preserves live 51B safety net', () => {
  it('makes no reference to denominator_conflict, language_match, or p_language in active SQL', () => {
    // Sanity: this migration ONLY replaces _normalize_card_number.
    // It must not accidentally alter the return shape or scoring of
    // scan_card_match. Any reference to those columns in active SQL
    // would mean we reached for the wrong function. Comments may
    // legitimately reference these column names to explain intent.
    expect(MIGRATION_ACTIVE).not.toMatch(/\bp_language\b/)
    expect(MIGRATION_ACTIVE).not.toMatch(/\blanguage_match\b/)
    expect(MIGRATION_ACTIVE).not.toMatch(/\bdenominator_conflict\b/)
  })
})
