// Block 5A-W-50F / FIX1+FIX2 — text-based assertions on the
// dashboard + migration contract that only source-file review can
// realistically pin (SQL DDL, trigger body, JSX effect deps).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/dashboard/portfolio/PortfolioDashboard.tsx'),
  'utf8',
)

const CQA_SRC = readFileSync(
  join(process.cwd(), 'src/components/CardQuickActions.tsx'),
  'utf8',
)

// FIX5 — the split component SQL files have been moved out of the
// migration execution path. The atomic cutover file is the ONE
// production migration and is the authoritative source of truth for
// the ledger DDL, trigger and backfill. All schema/trigger/backfill
// contract tests below read from it.
const MIG = readFileSync(
  join(process.cwd(), 'migrations/2026-08-02-portfolio-history-cutover.sql'),
  'utf8',
)
const BACKFILL = MIG

describe('PortfolioDashboard — mutation refresh (FIX1)', () => {
  it('declares a portfolioMutationVersion counter', () => {
    expect(SRC).toMatch(/const \[portfolioMutationVersion, setPortfolioMutationVersion\] = useState\(0\)/)
  })

  it('chart-load effect depends on portfolioMutationVersion', () => {
    expect(SRC).toMatch(/\}, \[portfolioId, valueHistoryRange, currency, portfolioMutationVersion\]\)/)
  })

  it('every mutation site bumps the version', () => {
    expect(SRC).toMatch(/handleAddCard[\s\S]{0,4000}setPortfolioMutationVersion\(v => v \+ 1\)/)
    expect(SRC).toMatch(/handleQuickScanAdd[\s\S]{0,4000}setPortfolioMutationVersion\(v => v \+ 1\)/)
    expect(SRC).toMatch(/handleRemove[\s\S]{0,2000}setPortfolioMutationVersion\(v => v \+ 1\)/)
    expect(SRC).toMatch(/handleEditSave[\s\S]{0,4000}setPortfolioMutationVersion\(v => v \+ 1\)/)
  })
})

describe('Client-side event recording is removed (FIX1)', () => {
  it('PortfolioDashboard no longer imports or calls recordPortfolioEvent', () => {
    expect(SRC).not.toMatch(/import[^\n]*recordPortfolioEvent/)
    expect(SRC).not.toMatch(/recordPortfolioEvent\(/)
  })

  it('CardQuickActions no longer imports or calls recordPortfolioEvent', () => {
    expect(CQA_SRC).not.toMatch(/import[^\n]*recordPortfolioEvent/)
    expect(CQA_SRC).not.toMatch(/recordPortfolioEvent\(/)
  })

  it('recordPortfolioEvent is no longer exported from the events module', () => {
    const events = readFileSync(
      join(process.cwd(), 'src/lib/portfolio/events.ts'),
      'utf8',
    )
    expect(events).not.toMatch(/export (async )?function recordPortfolioEvent/)
    expect(events).toMatch(/export function classifyQuantityChange/)
  })
})

// ── Migration + trigger contract (FIX1) ────────────────────

describe('Migration + trigger contract', () => {
  it('creates a SECURITY DEFINER trigger function with locked search_path', () => {
    expect(MIG).toMatch(/CREATE OR REPLACE FUNCTION record_portfolio_item_event\(\)/)
    expect(MIG).toMatch(/SECURITY DEFINER/)
    expect(MIG).toMatch(/SET search_path = public, pg_temp/)
  })

  it('trigger fires AFTER INSERT OR UPDATE OR DELETE on portfolio_items', () => {
    expect(MIG).toMatch(/CREATE TRIGGER trg_portfolio_items_events[\s\S]{0,200}AFTER INSERT OR UPDATE OR DELETE[\s\S]{0,80}ON portfolio_items/)
  })

  it('portfolio_item_id FK uses ON DELETE SET NULL', () => {
    expect(MIG).toMatch(/pie_portfolio_item_id_fk[\s\S]{0,200}ON DELETE SET NULL/)
  })

  it('no client INSERT/UPDATE/DELETE RLS policy exposes the ledger', () => {
    expect(MIG).toMatch(/CREATE POLICY pie_owner_select[\s\S]{0,150}FOR SELECT/)
    expect(MIG).not.toMatch(/CREATE POLICY[\s\S]{0,150}FOR INSERT/)
    expect(MIG).not.toMatch(/CREATE POLICY[\s\S]{0,150}FOR UPDATE/)
    expect(MIG).not.toMatch(/CREATE POLICY[\s\S]{0,150}FOR DELETE/)
  })

  it('trigger function is revoked from PUBLIC', () => {
    expect(MIG).toMatch(/REVOKE EXECUTE ON FUNCTION record_portfolio_item_event\(\) FROM PUBLIC/)
  })
})

// ── FIX2 — event_order + multi-field + ownership + initial manual ──

describe('FIX2 — event_order IDENTITY', () => {
  it('adds event_order as GENERATED ALWAYS AS IDENTITY (idempotently)', () => {
    expect(MIG).toMatch(/ADD COLUMN event_order bigint GENERATED ALWAYS AS IDENTITY/)
    // Guarded by an IF NOT EXISTS check so re-running the migration
    // does not error.
    expect(MIG).toMatch(/IF NOT EXISTS \([\s\S]{0,200}column_name = 'event_order'/)
  })

  it('composite indexes include event_order for deterministic query ordering', () => {
    expect(MIG).toMatch(/idx_pie_portfolio_date_order[\s\S]{0,200}\(portfolio_id, event_date, event_order\)/)
    expect(MIG).toMatch(/idx_pie_user_date_order[\s\S]{0,200}\(user_id, event_date, event_order\)/)
  })
})

describe('FIX2 — multi-field UPDATE ordering', () => {
  it('trigger UPDATE branch emits (purchase_date, holding_type, manual, quantity) in that order', () => {
    // Extract the UPDATE branch by anchoring on the branch header and
    // the DELETE branch header comment (survives future comment
    // formatting changes as long as the DELETE header stays first).
    // Both "IF TG_OP = 'UPDATE'" and "IF TG_OP = 'DELETE'" appear
    // twice in the file — once in the ownership derivation and once
    // as the actual branch heads. We want the branch heads, which
    // are the LAST occurrence of each in the file.
    const updateStart = MIG.lastIndexOf("IF TG_OP = 'UPDATE' THEN")
    const deleteStart = MIG.lastIndexOf("IF TG_OP = 'DELETE' THEN")
    expect(updateStart).toBeGreaterThan(0)
    expect(deleteStart).toBeGreaterThan(updateStart)
    const updateBlock = MIG.slice(updateStart, deleteStart)
    // Use metadata-key markers that appear ONLY inside each event's
    // INSERT VALUES clause so the ordering is unambiguous. Event-type
    // literals like 'manual_value_changed' also appear in validation
    // clauses so we don't use them as position markers.
    const orderMarkers = [
      updateBlock.indexOf("'correction_kind', 'purchase_date'"),
      updateBlock.indexOf("'correction_kind', 'holding_type'"),
      updateBlock.indexOf("'manual_value_cents_before'"),
      updateBlock.indexOf("'quantity_before'"),
    ]
    expect(orderMarkers.every(i => i > -1)).toBe(true)
    for (let i = 1; i < orderMarkers.length; i++) {
      expect(orderMarkers[i]).toBeGreaterThan(orderMarkers[i - 1])
    }
  })
})

describe('FIX2 — ownership verification in trigger', () => {
  it('derives owner from portfolios then raises on client user_id mismatch', () => {
    expect(MIG).toMatch(/SELECT user_id INTO v_user_id FROM portfolios WHERE id = NEW.portfolio_id/)
    expect(MIG).toMatch(/RAISE EXCEPTION[^;]{0,200}portfolio ownership not resolvable/)
    expect(MIG).toMatch(/NEW\.user_id IS NOT NULL AND NEW\.user_id <> v_user_id[\s\S]{0,300}RAISE EXCEPTION/)
    expect(MIG).toMatch(/OLD\.user_id IS NOT NULL AND OLD\.user_id <> v_user_id[\s\S]{0,300}RAISE EXCEPTION/)
  })
})

describe('FIX2 — INSERT embeds initial_manual_value_cents instead of emitting a separate manual_value_changed', () => {
  it('INSERT branch adds initial_manual_value_cents to holding_added metadata only', () => {
    // Look for the INSERT branch specifically.
    const insertBlock = MIG.match(/IF TG_OP = 'INSERT' THEN[\s\S]+?RETURN NEW;\s+END IF;/)?.[0] ?? ''
    expect(insertBlock).toContain("'initial_manual_value_cents'")
    // The INSERT branch must NOT emit a separate manual_value_changed
    // event — that would produce a false adjustment on day 0.
    expect(insertBlock).not.toContain("'manual_value_changed'")
  })
})

// ── Backfill contract (FIX2) ───────────────────────────────

describe('Backfill — FIX2+FIX3 idempotency', () => {
  it('excludes rows with either opening_balance OR holding_added (not opening_balance alone)', () => {
    expect(BACKFILL).toMatch(/e\.event_type IN \('opening_balance', 'holding_added'\)/)
  })

  it('embeds legacy manual_value_cents in metadata via jsonb_strip_nulls', () => {
    expect(BACKFILL).toMatch(/'initial_manual_value_cents',\s+pi\.manual_value_cents/)
    expect(BACKFILL).toMatch(/jsonb_strip_nulls/)
  })

  it('FIX3 — the idempotency check matches by holding_instance_id (survives deletion)', () => {
    expect(BACKFILL).toMatch(/e\.holding_instance_id = pi\.id/)
  })

  it('FIX3 — every backfilled opening event sets holding_instance_id = portfolio_items.id', () => {
    expect(BACKFILL).toMatch(/pi\.id\s+AS holding_instance_id/)
  })

  it('FIX3 — duplicate-audit SQL is grouped by holding_instance_id', () => {
    expect(BACKFILL).toMatch(/GROUP BY holding_instance_id[\s\S]{0,200}HAVING COUNT\(\*\)\s*>\s*1/)
  })
})

// ── FIX3 — holding_instance_id + purchase-date validation ───

describe('FIX3 — immutable holding_instance_id in the schema + trigger', () => {
  it('creates holding_instance_id NOT NULL in the CREATE TABLE', () => {
    expect(MIG).toMatch(/holding_instance_id\s+uuid NOT NULL/)
  })

  it('idempotently adds holding_instance_id on an existing table, populates from portfolio_item_id, then enforces NOT NULL', () => {
    expect(MIG).toMatch(/ALTER TABLE portfolio_item_events\s+ADD COLUMN holding_instance_id uuid/)
    expect(MIG).toMatch(/UPDATE portfolio_item_events\s+SET holding_instance_id = portfolio_item_id/)
    expect(MIG).toMatch(/ALTER COLUMN holding_instance_id SET NOT NULL/)
  })

  it('raises rather than accepting orphaned events with no resolvable holding identity', () => {
    expect(MIG).toMatch(/RAISE EXCEPTION 'portfolio_item_events has rows with no holding_instance_id/)
  })

  it('index (portfolio_id, holding_instance_id, event_date, event_order) is created', () => {
    expect(MIG).toMatch(/idx_pie_portfolio_holding_date_order[\s\S]{0,200}\(portfolio_id, holding_instance_id, event_date, event_order\)/)
  })

  it('every trigger-inserted event sets holding_instance_id explicitly', () => {
    // Count trigger INSERT INTO ... VALUES ( ... , NEW.id, NEW.id, ...
    // pattern (portfolio_item_id then holding_instance_id) for both
    // INSERT and each UPDATE emitter.
    const insertsSetBoth = MIG.match(/VALUES \(\s*v_user_id,\s+NEW\.portfolio_id,\s+NEW\.id,\s+NEW\.id/g) || []
    expect(insertsSetBoth.length).toBeGreaterThanOrEqual(4)
    // DELETE branch uses OLD.id.
    expect(MIG).toMatch(/VALUES \(\s*v_user_id,\s+OLD\.portfolio_id,\s+NULL,\s+OLD\.id/)
  })
})

describe('FIX3 — purchase-date validation in the trigger', () => {
  it('rejects a future purchase_date', () => {
    expect(MIG).toMatch(/NEW\.purchase_date > CURRENT_DATE[\s\S]{0,200}RAISE EXCEPTION 'The purchase date cannot be in the future/)
  })

  it('rejects a purchase_date after the earliest value-relevant subsequent event for this holding_instance_id', () => {
    expect(MIG).toMatch(/SELECT MIN\(event_date\) INTO v_earliest_activity[\s\S]{0,500}WHERE holding_instance_id = NEW\.id/)
    expect(MIG).toMatch(/NEW\.purchase_date > v_earliest_activity[\s\S]{0,300}RAISE EXCEPTION 'The purchase date cannot be later than activity already recorded/)
  })

  it('purchase_date correction events themselves are excluded from the subsequent-activity check', () => {
    expect(MIG).toMatch(/metadata->>'correction_kind'\)\s+IS DISTINCT FROM 'purchase_date'/)
  })
})

// ── FIX4 — DELETE cascade + purchase_date clearing + cutover ─

describe('FIX4 — DELETE branch does not insert OLD.id into the nullable FK', () => {
  it('writes NULL explicitly for portfolio_item_id in the holding_removed event', () => {
    // The DELETE branch VALUES tuple must be:
    //   (v_user_id, OLD.portfolio_id, NULL, OLD.id, OLD.card_slug, ...)
    // NOT (v_user_id, OLD.portfolio_id, OLD.id, ...) — a fresh INSERT
    // with portfolio_item_id = OLD.id would violate the FK because
    // the parent row is already gone at AFTER DELETE time.
    expect(MIG).toMatch(/VALUES \(\s*v_user_id,\s+OLD\.portfolio_id,\s+NULL,\s+OLD\.id/)
    // Sanity: the wrong shape should NOT appear.
    expect(MIG).not.toMatch(/VALUES \(\s*v_user_id,\s+OLD\.portfolio_id,\s+OLD\.id,\s+OLD\.id/)
  })

  it('writes OLD.id into holding_instance_id so the delete event joins the chain', () => {
    // The 4th positional argument in the DELETE VALUES clause is
    // holding_instance_id and must be OLD.id.
    expect(MIG).toMatch(/VALUES \(\s*v_user_id,\s+OLD\.portfolio_id,\s+NULL,\s+OLD\.id,\s+OLD\.card_slug/)
  })
})

describe('FIX4 — cascade-safe ownership derivation in DELETE branch', () => {
  it('DELETE case attempts owner resolution before deciding whether to insert', () => {
    // FIX4 introduced cascade safety; FIX5 replaced the "fall back
    // to OLD.user_id + insert" pattern with "RETURN OLD without
    // insert" (see the dedicated FIX5 test suite below). This test
    // now pins only the ordering: the DELETE branch still runs the
    // portfolios SELECT first so the cascade decision can be made.
    expect(MIG).toMatch(/IF TG_OP = 'DELETE' THEN\s+SELECT user_id INTO v_user_id FROM portfolios WHERE id = OLD\.portfolio_id;/)
  })
})

describe('FIX4 — trigger rejects clearing a recorded purchase_date', () => {
  it('raises "The purchase date cannot be cleared" when NEW.purchase_date IS NULL AND OLD.purchase_date IS NOT NULL', () => {
    expect(MIG).toMatch(/NEW\.purchase_date IS NULL AND OLD\.purchase_date IS NOT NULL[\s\S]{0,300}RAISE EXCEPTION 'The purchase date cannot be cleared\. Change it to the correct date instead\./)
  })

  it('clearing is rejected BEFORE any correction event is emitted for this UPDATE', () => {
    // The clearing check must sit inside the same
    // "IF NEW.purchase_date IS DISTINCT FROM OLD.purchase_date" block
    // and precede the INSERT of the correction event, so the RAISE
    // rolls back atomically without any event being written first.
    const updateStart  = MIG.lastIndexOf("IF TG_OP = 'UPDATE' THEN")
    const deleteStart  = MIG.lastIndexOf("IF TG_OP = 'DELETE' THEN")
    const updateBlock  = MIG.slice(updateStart, deleteStart)
    const clearRaise   = updateBlock.indexOf('purchase date cannot be cleared')
    const purchaseIns  = updateBlock.indexOf("'correction_kind', 'purchase_date'")
    expect(clearRaise).toBeGreaterThan(0)
    expect(purchaseIns).toBeGreaterThan(clearRaise)
  })
})

describe('FIX4 — atomic cutover migration file', () => {
  const CUTOVER = readFileSync(
    join(process.cwd(), 'migrations/2026-08-02-portfolio-history-cutover.sql'),
    'utf8',
  )

  it('exists and wraps the full install + backfill in one BEGIN..COMMIT', () => {
    expect(CUTOVER.length).toBeGreaterThan(1000)
    // Exactly one top-level BEGIN and COMMIT.
    expect(CUTOVER.match(/^BEGIN;$/gm)?.length).toBe(1)
    expect(CUTOVER.match(/^COMMIT;$/gm)?.length).toBe(1)
    // BEGIN precedes COMMIT.
    expect(CUTOVER.indexOf('BEGIN;')).toBeLessThan(CUTOVER.indexOf('COMMIT;'))
  })

  it('installs both the trigger AND the backfill inside the transaction', () => {
    const begin  = CUTOVER.indexOf('BEGIN;')
    const commit = CUTOVER.indexOf('COMMIT;')
    const inner  = CUTOVER.slice(begin, commit)
    expect(inner).toContain('CREATE TRIGGER trg_portfolio_items_events')
    expect(inner).toContain("'opening_balance'")
    expect(inner).toContain('NOT EXISTS')
    expect(inner).toContain('holding_instance_id')
  })

  it('runs every named integrity check inside the transaction', () => {
    const begin  = CUTOVER.indexOf('BEGIN;')
    const commit = CUTOVER.indexOf('COMMIT;')
    const inner  = CUTOVER.slice(begin, commit)
    // No event has NULL holding_instance_id
    expect(inner).toMatch(/RAISE EXCEPTION 'cutover: % events have NULL holding_instance_id/)
    // No initial-event duplicates per holding_instance_id
    expect(inner).toMatch(/RAISE EXCEPTION 'cutover: % holding_instance_ids have more than one initial event/)
    // Every current portfolio_item has one initial event
    expect(inner).toMatch(/RAISE EXCEPTION 'cutover: % current portfolio_items have no initial event/)
    // Every event owner matches the portfolio owner
    expect(inner).toMatch(/RAISE EXCEPTION 'cutover: % events have user_id that does not match their portfolio owner/)
    // No NULL event_date
    expect(inner).toMatch(/RAISE EXCEPTION 'cutover: % events have NULL event_date/)
    // Trigger is enabled
    expect(inner).toMatch(/RAISE EXCEPTION 'cutover: trg_portfolio_items_events trigger is not installed or is disabled/)
  })

  it('idempotency-guards every DDL statement', () => {
    expect(CUTOVER).toMatch(/CREATE TABLE IF NOT EXISTS portfolio_item_events/)
    expect(CUTOVER).toMatch(/CREATE INDEX IF NOT EXISTS/)
    expect(CUTOVER).toMatch(/DROP TRIGGER IF EXISTS/)
    expect(CUTOVER).toMatch(/DROP POLICY IF EXISTS/)
    expect(CUTOVER).toMatch(/CREATE OR REPLACE FUNCTION/)
    // Backfill dedupes by holding_instance_id
    expect(CUTOVER).toMatch(/e\.holding_instance_id = pi\.id/)
  })
})

describe('FIX4 — portfolio-deletion cascade is documented (no app path deletes portfolios)', () => {
  it('the app does not delete portfolios anywhere in src/', () => {
    // Walk src/ recursively for any .from('portfolios').delete()
    // call. If a future block adds a portfolio-delete UI, this test
    // forces an explicit design decision about history + cascade.
    // Portable (no external ripgrep required — matters on Windows).
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    const root = path.join(process.cwd(), 'src')
    const hits: string[] = []
    // Match: .from('portfolios').delete(  OR  .from("portfolios").delete(
    const pattern = /\.from\((['"])portfolios\1\)\s*\.delete\s*\(/

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue
          walk(full)
        } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
          const src = fs.readFileSync(full, 'utf8')
          if (pattern.test(src)) hits.push(full)
        }
      }
    }
    walk(root)
    expect(hits).toEqual([])
  })
})

// ── FIX5 — final production migration invariants ─────────────

describe('FIX5 — file layout has ONE production migration', () => {
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')

  it('only migrations/2026-08-02-portfolio-history-cutover.sql remains in migrations/', () => {
    const migrationsDir = path.join(process.cwd(), 'migrations')
    const dated = fs.readdirSync(migrationsDir)
      .filter(f => f.startsWith('2026-08-02-portfolio-'))
      .sort()
    expect(dated).toEqual(['2026-08-02-portfolio-history-cutover.sql'])
  })

  it('the split component files are moved to docs/sql-reference/portfolio-history/', () => {
    const ref = path.join(process.cwd(), 'docs', 'sql-reference', 'portfolio-history')
    expect(fs.existsSync(path.join(ref, 'portfolio-item-events-reference.sql'))).toBe(true)
    expect(fs.existsSync(path.join(ref, 'portfolio-opening-balances-reference.sql'))).toBe(true)
  })

  it('the verification SQL is moved to scripts/sql/', () => {
    expect(fs.existsSync(
      path.join(process.cwd(), 'scripts', 'sql', 'portfolio-history-verification.sql'),
    )).toBe(true)
  })

  it('no test or source file references the old migration paths', () => {
    // Guard: after the move, nothing should still point at
    // migrations/2026-08-02-portfolio-{item-events,opening-balances-backfill,history-verification}.sql
    const root = path.join(process.cwd(), 'src')
    const bad: string[] = []
    const patterns = [
      /migrations\/2026-08-02-portfolio-item-events\.sql/,
      /migrations\/2026-08-02-portfolio-opening-balances-backfill\.sql/,
      /migrations\/2026-08-02-portfolio-history-verification\.sql/,
    ]
    function walk(dir: string) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name === 'node_modules') continue
          walk(full)
        } else if (/\.(ts|tsx|mjs|js|md)$/.test(e.name)) {
          const src = fs.readFileSync(full, 'utf8')
          if (patterns.some(p => p.test(src))) bad.push(full)
        }
      }
    }
    walk(root)
    expect(bad).toEqual([])
  })
})

describe('FIX5 — INSERT rejects a future purchase_date', () => {
  it('trigger INSERT branch raises the same future-date exception as UPDATE', () => {
    // The INSERT branch check must fire BEFORE the holding_added
    // INSERT so no event is written when the trigger raises.
    const insertStart = MIG.indexOf("IF TG_OP = 'INSERT' THEN")
    const updateStart = MIG.lastIndexOf("IF TG_OP = 'UPDATE' THEN")
    expect(insertStart).toBeGreaterThan(0)
    expect(updateStart).toBeGreaterThan(insertStart)
    const insertBlock = MIG.slice(insertStart, updateStart)
    // The reject must appear in the INSERT block.
    expect(insertBlock).toMatch(/NEW\.purchase_date IS NOT NULL\s+AND NEW\.purchase_date > CURRENT_DATE[\s\S]{0,200}RAISE EXCEPTION 'The purchase date cannot be in the future\./)
    // And it must appear BEFORE the holding_added INSERT VALUES.
    const raiseIdx  = insertBlock.indexOf("The purchase date cannot be in the future")
    const insertIdx = insertBlock.indexOf("'holding_added'")
    expect(raiseIdx).toBeGreaterThan(0)
    expect(insertIdx).toBeGreaterThan(raiseIdx)
  })
})

describe('FIX5 — DELETE branch skips event insert when portfolios row is gone (cascade)', () => {
  it('DELETE returns OLD without inserting when SELECT user_id FROM portfolios returns NULL', () => {
    // Must be RETURN OLD (not fallback insert with OLD.user_id) so
    // the new event does not violate pie_portfolio_id_fk during a
    // portfolios cascade.
    expect(MIG).toMatch(
      /IF TG_OP = 'DELETE' THEN\s+SELECT user_id INTO v_user_id FROM portfolios WHERE id = OLD\.portfolio_id;\s+IF v_user_id IS NULL THEN\s+-- [^\n]*\s+RETURN OLD;/,
    )
  })

  it('the ordinary DELETE (portfolios still exists) still inserts the holding_removed event with NULL portfolio_item_id', () => {
    // The DELETE-branch INSERT below the cascade skip has the FIX3+
    // shape unchanged.
    expect(MIG).toMatch(/VALUES \(\s*v_user_id,\s+OLD\.portfolio_id,\s+NULL,\s+OLD\.id,\s+OLD\.card_slug/)
  })

  it('DELETE branch no longer falls back to OLD.user_id and attempts an event insert', () => {
    // FIX4's fallback attempted `v_user_id := OLD.user_id` when
    // portfolios was gone. FIX5 replaces that with RETURN OLD.
    // The stale fallback pattern must not appear anywhere in the
    // final trigger body.
    expect(MIG).not.toMatch(/IF v_user_id IS NULL THEN\s+v_user_id := OLD\.user_id;/)
  })
})

describe('FIX5 — cutover integrity checks for future dates', () => {
  it('checks that no current portfolio_items row has a future purchase_date', () => {
    expect(MIG).toMatch(/portfolio_items WHERE purchase_date > CURRENT_DATE[\s\S]{0,300}RAISE EXCEPTION 'cutover: % portfolio_items rows have purchase_date in the future/)
  })

  it('checks that no portfolio_item_events row has a future event_date', () => {
    expect(MIG).toMatch(/portfolio_item_events WHERE event_date > CURRENT_DATE[\s\S]{0,300}RAISE EXCEPTION 'cutover: % portfolio_item_events rows have event_date in the future/)
  })
})

describe('FIX5 — preflight and reconciliation SQL are documented in the cutover file', () => {
  it('preflight queries appear in the header (comment) block', () => {
    // These three queries are pasted READ-ONLY before running the file.
    expect(MIG).toContain('AS current_holdings')
    expect(MIG).toContain('AS future_purchase_dates')
    expect(MIG).toContain('AS portfolios_without_owner')
  })

  it('post-cutover reconciliation queries appear too', () => {
    expect(MIG).toContain('AS current_holdings_with_one_initial_event')
    expect(MIG).toContain('SELECT event_type, COUNT(*)')
  })
})

// ── FIX5 — verification SQL exercises a REAL later-than-activity ─
//    rejection (same-day is intentionally NOT a violation, so the
//    smoke must backdate an activity event to construct a genuine
//    "later" scenario).

describe('FIX5-FINAL — verification SQL later-purchase-date reject is deterministic', () => {
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const VERIFY = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'sql', 'portfolio-history-verification.sql'),
    'utf8',
  )

  it('declares the deterministic-verification variables', () => {
    // Every variable named in the FIX5-FINAL spec must be present.
    expect(VERIFY).toMatch(/v_holding_instance_id\s+uuid/)
    expect(VERIFY).toMatch(/v_backdated_rows\s+integer/)
    expect(VERIFY).toMatch(/v_earliest_activity\s+date/)
    expect(VERIFY).toMatch(/v_rejected\s+boolean\s*:=\s*false/)
    expect(VERIFY).toMatch(/v_events_before\s+integer/)
    expect(VERIFY).toMatch(/v_events_after\s+integer/)
    expect(VERIFY).toMatch(/v_purchase_date_before\s+date/)
  })

  it('resolves holding_instance_id from the ledger using a DIFFERENT key than it later checks', () => {
    // The SELECT ... INTO STRICT lookup must key on
    // portfolio_item_id = v_item_id (the OTHER identity column) and
    // pull the holding_added row so a match proves both identities
    // point at the same row.
    expect(VERIFY).toMatch(
      /SELECT holding_instance_id\s+INTO STRICT v_holding_instance_id\s+FROM portfolio_item_events\s+WHERE portfolio_item_id = v_item_id\s+AND event_type = 'holding_added'\s+ORDER BY event_order\s+LIMIT 1/,
    )
  })

  it('asserts the resolved holding_instance_id matches v_item_id', () => {
    expect(VERIFY).toMatch(
      /IF v_holding_instance_id <> v_item_id THEN\s+RAISE EXCEPTION\s+'verification setup failed: holding_instance_id % does not match portfolio item id %'/,
    )
  })

  it('backdates exactly one quantity_added event to CURRENT_DATE - 2', () => {
    // The backdate is TWO days earlier so the attempt at CURRENT_DATE - 1
    // is unambiguously later than the activity date without touching
    // future dates.
    expect(VERIFY).toMatch(
      /UPDATE portfolio_item_events\s+SET event_date = CURRENT_DATE - 2\s+WHERE holding_instance_id = v_holding_instance_id\s+AND event_type = 'quantity_added'/,
    )
    // GET DIAGNOSTICS captures ROW_COUNT and asserts exactly 1.
    expect(VERIFY).toMatch(/GET DIAGNOSTICS v_backdated_rows = ROW_COUNT/)
    expect(VERIFY).toMatch(
      /IF v_backdated_rows <> 1 THEN\s+RAISE EXCEPTION\s+'verification setup failed: expected to backdate exactly one quantity_added event, updated %'/,
    )
  })

  it('reads the earliest activity date and asserts it equals CURRENT_DATE - 2', () => {
    // The predicate matches the production trigger exactly.
    expect(VERIFY).toMatch(/SELECT MIN\(event_date\)\s+INTO v_earliest_activity/)
    expect(VERIFY).toMatch(
      /IF v_earliest_activity IS DISTINCT FROM CURRENT_DATE - 2 THEN\s+RAISE EXCEPTION\s+'verification setup failed: expected earliest activity %, found %'/,
    )
  })

  it('captures purchase_date_before and events_before as separate variables', () => {
    expect(VERIFY).toMatch(/SELECT purchase_date\s+INTO v_purchase_date_before/)
    expect(VERIFY).toMatch(/SELECT COUNT\(\*\)\s+INTO v_events_before/)
  })

  it('attempts the invalid update with CURRENT_DATE - 1 (never CURRENT_DATE)', () => {
    // The invalid date must be CURRENT_DATE - 1 so the trigger's
    // (NEW.purchase_date > v_earliest_activity) comparison is
    // strictly true given CURRENT_DATE - 2 activity.
    expect(VERIFY).toMatch(
      /UPDATE portfolio_items\s+SET purchase_date = CURRENT_DATE - 1\s+WHERE id = v_item_id/,
    )
    // And crucially NOT `SET purchase_date = CURRENT_DATE` (the old
    // shape that succeeded because same-day is valid).
    expect(VERIFY).not.toMatch(/SET purchase_date = CURRENT_DATE\s+WHERE id = v_item_id/)
  })

  it('uses v_rejected instead of throwing/catching its own sentinel', () => {
    // The EXCEPTION handler must set v_rejected := true on the
    // expected message and MUST NOT contain a sentinel-raise-then-
    // catch pattern like FIX5 had.
    expect(VERIFY).toMatch(
      /BEGIN\s+UPDATE portfolio_items\s+SET purchase_date = CURRENT_DATE - 1[\s\S]{0,500}EXCEPTION\s+WHEN OTHERS THEN\s+IF SQLERRM = 'The purchase date cannot be later than activity already recorded for this holding\.' THEN\s+v_rejected := true;/,
    )
    // The nested block does NOT raise its own "expected... to be
    // rejected but it succeeded" sentinel (that was the fragile FIX5
    // pattern). Instead we assert v_rejected AFTER the block.
    expect(VERIFY).not.toMatch(/RAISE EXCEPTION 'expected the later-purchase-date UPDATE to be rejected but it succeeded'/)
    expect(VERIFY).toMatch(
      /IF NOT v_rejected THEN\s+RAISE EXCEPTION\s+'later-purchase-date verification failed: trigger allowed purchase date % despite earliest activity %'/,
    )
  })

  it('verifies purchase_date remains unchanged after the rejected UPDATE', () => {
    expect(VERIFY).toMatch(
      /IF \(\s+SELECT purchase_date\s+FROM portfolio_items\s+WHERE id = v_item_id\s+\) IS DISTINCT FROM v_purchase_date_before THEN\s+RAISE EXCEPTION\s+'later-purchase-date verification failed: rejected update changed portfolio_items\.purchase_date'/,
    )
  })

  it('verifies the event count remains unchanged after the rejected UPDATE', () => {
    expect(VERIFY).toMatch(/SELECT COUNT\(\*\)\s+INTO v_events_after/)
    expect(VERIFY).toMatch(
      /IF v_events_after <> v_events_before THEN\s+RAISE EXCEPTION\s+'later-purchase-date verification failed: rejected update changed event count from % to %'/,
    )
  })

  it('documents that same-day purchase dates are valid', () => {
    // Comment must state the CURRENT_DATE - 2 / CURRENT_DATE - 1
    // rationale so future maintainers do not "simplify" back to
    // same-day dates.
    expect(VERIFY).toMatch(/Same-day purchase dates are valid/)
    expect(VERIFY).toMatch(/CURRENT_DATE - 2/)
    expect(VERIFY).toMatch(/CURRENT_DATE - 1/)
  })

  it('the whole script remains wrapped in BEGIN / ROLLBACK with no COMMIT', () => {
    expect(VERIFY.match(/^BEGIN;$/gm)?.length).toBe(1)
    expect(VERIFY.match(/^ROLLBACK;$/gm)?.length).toBe(1)
    expect(VERIFY).not.toMatch(/^COMMIT;$/gm)
  })
})
