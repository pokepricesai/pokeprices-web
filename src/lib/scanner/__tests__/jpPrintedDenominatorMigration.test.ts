// Block 5A-W-51C — static contract tests on the JP printed-denominator
// data-correction migration. Locks down: correct target set names,
// language-scoped UPDATE, correct target denominators, English rows
// untouched, no schema changes, preflight + postflight in place.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION = readFileSync(
  join(process.cwd(), 'migrations', '2026-08-05-fix-jp-printed-denominators.sql'),
  'utf8',
)
const ACTIVE = MIGRATION.split(/\r?\n/).filter(l => !l.trim().startsWith('--')).join('\n')

describe('JP printed-denominator migration — target sets', () => {
  it('updates Japanese Battle Partners with the exact set_name and language', () => {
    expect(ACTIVE).toMatch(/UPDATE cards[\s\S]{0,180}set_printed_total = '100'[\s\S]{0,180}card_number \|\| '\/100'[\s\S]{0,180}WHERE set_name = 'Japanese Battle Partners'[\s\S]{0,80}AND language = 'jp'[\s\S]{0,80}AND card_number IS NOT NULL/)
  })

  it('updates Japanese Terastal Festival with the exact set_name and language', () => {
    expect(ACTIVE).toMatch(/UPDATE cards[\s\S]{0,180}set_printed_total = '187'[\s\S]{0,180}card_number \|\| '\/187'[\s\S]{0,180}WHERE set_name = 'Japanese Terastal Festival'[\s\S]{0,80}AND language = 'jp'[\s\S]{0,80}AND card_number IS NOT NULL/)
  })

  it('does NOT touch other Japanese sets (only the two CONFIRMED_MISMATCH names)', () => {
    // Grep every UPDATE in active SQL — every one must reference one
    // of the two whitelisted set names.
    const updates = ACTIVE.match(/UPDATE cards[\s\S]*?WHERE[\s\S]*?(?=;)/g) ?? []
    expect(updates.length).toBe(2)
    for (const u of updates) {
      const setMatch = u.match(/set_name = '([^']+)'/)
      expect(setMatch).not.toBeNull()
      expect(['Japanese Battle Partners', 'Japanese Terastal Festival']).toContain(setMatch![1])
    }
  })

  it('every active UPDATE is language-scoped to jp', () => {
    const updates = ACTIVE.match(/UPDATE cards[\s\S]*?(?=;)/g) ?? []
    for (const u of updates) {
      expect(u).toMatch(/AND language = 'jp'/)
    }
  })

  it('preserves card_number exactly (only set_printed_total and card_number_display change)', () => {
    // No UPDATE writes to card_number itself.
    expect(ACTIVE).not.toMatch(/UPDATE cards[\s\S]*?SET[\s\S]*?card_number\s*=/)
  })
})

describe('JP printed-denominator migration — schema discipline', () => {
  it('does NOT touch set_metadata (catalogue count stays as-is)', () => {
    expect(ACTIVE).not.toMatch(/UPDATE set_metadata/)
    expect(ACTIVE).not.toMatch(/ALTER TABLE set_metadata/)
  })

  it('does NOT add any new column', () => {
    expect(ACTIVE).not.toMatch(/ADD COLUMN/)
  })

  it('does NOT create or replace any function', () => {
    expect(ACTIVE).not.toMatch(/CREATE OR REPLACE FUNCTION/)
    expect(ACTIVE).not.toMatch(/CREATE FUNCTION/)
  })

  it('runs in a transaction', () => {
    expect(MIGRATION).toMatch(/^BEGIN;/m)
    expect(MIGRATION).toMatch(/^COMMIT;/m)
  })
})

describe('JP printed-denominator migration — preflight + postflight', () => {
  it('preflight asserts both sets are in the expected wrong state before update', () => {
    // Battle Partners must currently show single stored denom [130].
    expect(ACTIVE).toMatch(/Preflight failed for Battle Partners[\s\S]{0,80}\[130\]/)
    // Terastal Festival must currently show single stored denom [128].
    expect(ACTIVE).toMatch(/Preflight failed for Terastal Festival[\s\S]{0,80}\[128\]/)
  })

  it('postflight asserts the target rows now show the printed base', () => {
    expect(ACTIVE).toMatch(/Battle Partners set_printed_total is[\s\S]{0,120}expected 100/)
    expect(ACTIVE).toMatch(/Terastal Festival set_printed_total is[\s\S]{0,120}expected 187/)
  })

  it("postflight verifies N's Reshiram #109 now displays as 109/100 (the scan that motivated 51C)", () => {
    expect(ACTIVE).toMatch(/N''s Reshiram #109[\s\S]{0,220}expected 109\/100/)
  })
})

describe('JP printed-denominator migration — rollback + verification', () => {
  it('includes rollback SQL restoring both sets to their previous denominators', () => {
    // Rollback block lives in a comment section — inspect the raw file.
    const rollbackHeaderIdx = MIGRATION.indexOf('Rollback')
    expect(rollbackHeaderIdx, 'Rollback section not found').toBeGreaterThan(0)
    const rollbackBlock = MIGRATION.slice(rollbackHeaderIdx)
    // Both target set names appear.
    expect(rollbackBlock).toContain('Japanese Battle Partners')
    expect(rollbackBlock).toContain('Japanese Terastal Festival')
    // Both previous denominators are restored.
    expect(rollbackBlock).toContain(`'/130'`)
    expect(rollbackBlock).toContain(`'/128'`)
  })

  it('includes verification queries for N’s Reshiram, Articuno #102, and secret #132', () => {
    // Comment-based, but present as a paste-after-apply help.
    expect(MIGRATION).toMatch(/card_number = '109'/)
    expect(MIGRATION).toMatch(/card_number = '102'/)
    expect(MIGRATION).toMatch(/card_number = '132'/)
  })

  it('includes a scan_card_match probe for 109/100 (should now be a clean full match)', () => {
    expect(MIGRATION).toMatch(/scan_card_match\('109\/100'/)
  })

  it('includes a Ruler of the Black Flame cross-check (must remain /108)', () => {
    expect(MIGRATION).toMatch(/Ruler of the Black Flame[\s\S]{0,200}language = 'jp'/)
  })

  it('includes an English SV 151 cross-check (must remain /165)', () => {
    expect(MIGRATION).toMatch(/Scarlet & Violet 151[\s\S]{0,200}language = 'en'/)
  })
})
