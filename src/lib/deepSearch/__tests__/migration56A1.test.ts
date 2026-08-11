// Block 5A-W-56A.1 → 56A.7a — migration source-contract pins.
//
// 56A.7a split the single 56A.7 migration into three files because
// the one-shot DISTINCT ON backfill timed out in the Supabase SQL
// Editor:
//   * Migration A (schema + trigger)
//   * Migration B (batched backfill helper)
//   * Migration C (Deep Search cutover — view + RPC)
//
// The tests read from all three files and pin the contract each one
// owns.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const A = readFileSync(
  join(process.cwd(), 'migrations', '2026-08-11a-card-latest-prices-schema.sql'),
  'utf8',
)
const B = readFileSync(
  join(process.cwd(), 'migrations', '2026-08-11b-card-latest-prices-backfill.sql'),
  'utf8',
)
const C = readFileSync(
  join(process.cwd(), 'migrations', '2026-08-11c-deep-search-latest-price-cutover.sql'),
  'utf8',
)

// ── Migration A — schema + trigger ─────────────────────────────────────

describe('56A.7a Migration A — card_latest_prices table', () => {
  it('creates a table with card_slug PRIMARY KEY (pc-prefixed convention)', () => {
    expect(A).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.card_latest_prices\s*\([\s\S]*?card_slug\s+TEXT PRIMARY KEY/i,
    )
  })

  it('carries exactly raw + psa7 + psa8 + psa9 + psa10 + price_date + updated_at', () => {
    const tableStart = A.indexOf('CREATE TABLE IF NOT EXISTS public.card_latest_prices')
    const tableEnd   = A.indexOf(');', tableStart)
    const tableBlock = A.slice(tableStart, tableEnd)
    for (const c of [
      'card_slug   TEXT PRIMARY KEY',
      'price_date  DATE NOT NULL',
      'raw_usd     INTEGER',
      'psa7_usd    INTEGER',
      'psa8_usd    INTEGER',
      'psa9_usd    INTEGER',
      'psa10_usd   INTEGER',
      'updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()',
    ]) {
      expect(tableBlock).toContain(c)
    }
    // Scope guard — 56A.7a inherits 56A.7's narrow shape.
    for (const c of ['cgc10_usd', 'cgc95_usd', 'bgs10_usd', 'bgs95_usd', 'tag10_usd', 'ace10_usd', 'sgc10_usd', 'tcgplayer_usd', 'cardmarket_eur', 'grade1_usd']) {
      expect(tableBlock).not.toMatch(new RegExp(`\\b${c}\\b`, 'i'))
    }
  })

  it('grants SELECT to anon so the search page can read via the view', () => {
    expect(A).toMatch(/GRANT SELECT ON public\.card_latest_prices TO anon, authenticated, service_role/i)
  })

  it('runs no backfill and does not touch cards_search_v / search_cards_deep', () => {
    // §1: Migration A must be fast+safe.  It creates no view, no RPC
    // change, and NEVER runs a bulk INSERT SELECT ... FROM daily_prices.
    expect(A).not.toMatch(/CREATE (?:OR REPLACE )?VIEW public\.cards_search_v/i)
    expect(A).not.toMatch(/CREATE OR REPLACE FUNCTION public\.search_cards_deep/i)
    expect(A).not.toMatch(/INSERT INTO public\.card_latest_prices[\s\S]*?FROM public\.daily_prices/i)
  })
})

describe('56A.7a Migration A — trigger keeps snapshot fresh', () => {
  it('defines an AFTER INSERT OR UPDATE trigger on daily_prices', () => {
    expect(A).toMatch(
      /CREATE TRIGGER trg_daily_prices_upsert_latest\s+AFTER INSERT OR UPDATE ON public\.daily_prices\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.upsert_card_latest_prices/i,
    )
  })

  it('trigger drops-before-creates so re-applying the migration is safe', () => {
    expect(A).toMatch(
      /DROP TRIGGER IF EXISTS trg_daily_prices_upsert_latest ON public\.daily_prices/i,
    )
  })

  it('trigger UPSERT guarded by EXCLUDED.price_date >= lp.price_date so backfill cannot overwrite fresher data', () => {
    const start = A.indexOf('CREATE OR REPLACE FUNCTION public.upsert_card_latest_prices')
    const end   = A.indexOf('$$;', start)
    const block = A.slice(start, end)
    expect(block).toMatch(/ON CONFLICT \(card_slug\) DO UPDATE/i)
    expect(block).toMatch(/WHERE EXCLUDED\.price_date >= lp\.price_date/i)
    for (const c of ['raw_usd', 'psa7_usd', 'psa8_usd', 'psa9_usd', 'psa10_usd']) {
      expect(block).toMatch(new RegExp(`${c}\\s*=\\s*EXCLUDED\\.${c}`, 'i'))
    }
  })
})

// ── Migration B — batched backfill helper ─────────────────────────────

describe('56A.7a Migration B — batched backfill helper', () => {
  it('creates a singleton state table for cursor persistence', () => {
    expect(B).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.card_latest_prices_backfill_state\s*\([\s\S]*?singleton\s+BOOLEAN PRIMARY KEY[\s\S]*?CHECK \(singleton\)/i,
    )
    expect(B).toMatch(/INSERT INTO public\.card_latest_prices_backfill_state[\s\S]*?ON CONFLICT \(singleton\) DO NOTHING/i)
  })

  it('creates backfill_card_latest_prices_batch(p_limit INT DEFAULT 1000)', () => {
    expect(B).toMatch(
      /CREATE OR REPLACE FUNCTION public\.backfill_card_latest_prices_batch\(\s*p_limit INT DEFAULT 1000\s*\)/i,
    )
  })

  it('returns processed_slugs / last_processed_slug / more_remaining (stable contract for the operator)', () => {
    const sig = B.match(/RETURNS TABLE\s*\(([\s\S]*?)\)/)
    expect(sig).toBeTruthy()
    const cols = sig![1]
    expect(cols).toMatch(/processed_slugs\s+INT/i)
    expect(cols).toMatch(/last_processed_slug\s+TEXT/i)
    expect(cols).toMatch(/more_remaining\s+BOOLEAN/i)
  })

  it('uses a recursive keyset skip-scan over (card_slug), not a full DISTINCT ON', () => {
    // §1: no giant DISTINCT ON.  We insist on the recursive-CTE
    // MIN(card_slug) WHERE card_slug > x pattern that walks the
    // existing (card_slug, date) index one seek at a time.
    expect(B).toMatch(/WITH RECURSIVE distinct_slugs AS/i)
    expect(B).toMatch(/SELECT MIN\(card_slug\) FROM public\.daily_prices\s+WHERE card_slug > COALESCE\(v_cursor, ''\)/i)
    expect(B).toMatch(/SELECT MIN\(card_slug\) FROM public\.daily_prices\s+WHERE card_slug > ds\.slug/i)
    // And no monolithic DISTINCT ON in code paths (comments allowed —
    // the file explains WHY we avoid it).
    expect(B.replace(/--.*$/gm, '')).not.toMatch(/SELECT DISTINCT ON \(card_slug\)/i)
  })

  it('LATERAL fires against a bounded slug set (never against raw daily_prices)', () => {
    // The LATERAL exists (that is the point — resolve latest row per
    // slug) but must be joined to the `slugs` CTE, so its outer set is
    // at most p_limit rows.
    const lateralMatches = B.match(/LEFT JOIN LATERAL[\s\S]*?ON TRUE/g) || []
    expect(lateralMatches.length).toBe(1)
    expect(lateralMatches[0]).toMatch(/FROM public\.daily_prices dp/i)
    expect(lateralMatches[0]).toMatch(/dp\.card_slug\s*=\s*s\.slug/i)
    expect(lateralMatches[0]).toMatch(/ORDER BY dp\.date DESC/i)
    expect(lateralMatches[0]).toMatch(/LIMIT 1/i)
    // Regression pin: LATERAL is joined from `slugs`, not from cards
    // or daily_prices.  If someone re-wires the FROM clause we want
    // the test to fail loudly.
    const rpc = B.slice(B.indexOf('CREATE OR REPLACE FUNCTION public.backfill_card_latest_prices_batch'))
    expect(rpc).toMatch(/FROM slugs s\s+LEFT JOIN LATERAL/i)
  })

  it('UPSERT preserves the same freshness guard the trigger uses', () => {
    const rpc = B.slice(B.indexOf('CREATE OR REPLACE FUNCTION public.backfill_card_latest_prices_batch'))
    expect(rpc).toMatch(/ON CONFLICT \(card_slug\) DO UPDATE/i)
    expect(rpc).toMatch(/WHERE EXCLUDED\.price_date >= clp\.price_date/i)
  })

  it('clamps p_limit to a safe range so the operator cannot ask for a runaway batch', () => {
    expect(B).toMatch(/IF p_limit IS NULL OR p_limit <= 0 THEN[\s\S]*?p_limit := 1000/i)
    expect(B).toMatch(/ELSIF p_limit > 5000 THEN[\s\S]*?p_limit := 5000/i)
  })

  it('persists the cursor only when the batch produced work, so end-of-data is a no-op', () => {
    // Prevents cursor thrash and makes final "done" calls idempotent.
    expect(B).toMatch(
      /IF v_new_cursor IS NOT NULL THEN\s+UPDATE public\.card_latest_prices_backfill_state[\s\S]*?WHERE singleton = TRUE/i,
    )
  })
})

// ── Migration C — Deep Search cutover ─────────────────────────────────

describe('56A.7a Migration C — Deep Search view', () => {
  it('view LEFT JOINs card_latest_prices on pc-prefixed card_slug', () => {
    expect(C).toMatch(
      /LEFT JOIN public\.card_latest_prices lp ON lp\.card_slug = 'pc-' \|\| c\.card_slug/i,
    )
  })

  it('view LEFT JOINs card_trends on card_slug — trends only, not a price fallback', () => {
    expect(C).toMatch(
      /LEFT JOIN public\.card_trends\s+ct ON ct\.card_slug = c\.card_slug/i,
    )
  })

  it('view sources ALL grade prices from card_latest_prices, NOT card_trends', () => {
    const viewStart = C.indexOf('CREATE VIEW public.cards_search_v')
    const viewEnd   = C.indexOf('GRANT SELECT ON public.cards_search_v')
    const block     = C.slice(viewStart, viewEnd)
    for (const c of ['lp.raw_usd', 'lp.psa7_usd', 'lp.psa8_usd', 'lp.psa9_usd', 'lp.psa10_usd']) {
      expect(block).toContain(c)
    }
    for (const c of ['ct.current_raw', 'ct.current_psa9', 'ct.current_psa10']) {
      expect(block).not.toContain(c)
    }
    for (const c of ['ct.raw_pct_7d', 'ct.raw_pct_30d', 'ct.raw_pct_90d']) {
      expect(block).toContain(c)
    }
  })

  it('view has NO LATERAL — anti-regression for the 56A.4 timeout root cause', () => {
    const viewStart = C.indexOf('CREATE VIEW public.cards_search_v')
    const viewEnd   = C.indexOf('GRANT SELECT ON public.cards_search_v')
    expect(C.slice(viewStart, viewEnd).replace(/--.*$/gm, '')).not.toMatch(/LATERAL/i)
  })

  it('sealed products still excluded at the view level', () => {
    expect(C).toMatch(/WHERE\s+COALESCE\(c\.is_sealed,\s*FALSE\)\s*=\s*FALSE/i)
  })

  it('multiple/uplift derived expressions still guard against raw=0 / NULL', () => {
    expect(C).toMatch(/CASE WHEN lp\.raw_usd > 0 AND lp\.psa9_usd\s+IS NOT NULL/i)
    expect(C).toMatch(/CASE WHEN lp\.raw_usd > 0 AND lp\.psa10_usd IS NOT NULL/i)
  })
})

describe('56A.7a Migration C — Pokémon membership + SECURITY DEFINER preserved from 56A.3', () => {
  it('uses EXISTS against card_pokemon.species_slug', () => {
    const codeOnly = C.replace(/--.*$/gm, '')
    expect(codeOnly).toMatch(
      /EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.card_pokemon\s+cp\s+WHERE\s+cp\.card_slug\s*=\s*v\.card_slug\s+AND\s+cp\.species_slug\s*=\s*p_pokemon_slug\s*\)/i,
    )
  })

  it('does NOT OR-in primary_pokemon_slug (would over-include vs species page)', () => {
    const codeOnly = C.replace(/--.*$/gm, '')
    const pikaClauses = codeOnly.match(/p_pokemon_slug IS NULL[\s\S]*?\)\s*(?:\n\s*AND|\n\s*ORDER)/g) || []
    expect(pikaClauses.length).toBeGreaterThanOrEqual(1)
    for (const cl of pikaClauses) {
      expect(cl).not.toMatch(/v\.primary_pokemon_slug\s*=\s*p_pokemon_slug/i)
    }
  })

  it('primary_pokemon_slug still projected on the view for the pokemon_asc sort', () => {
    expect(C).toContain('c.primary_pokemon_slug')
    expect(C).toContain("p_sort = 'pokemon_asc'")
    expect(C).toContain('primary_pokemon_slug END ASC')
  })

  it('search_cards_deep is declared SECURITY DEFINER and pins search_path', () => {
    const codeOnly = C.replace(/--.*$/gm, '')
    expect(codeOnly).toMatch(/CREATE OR REPLACE FUNCTION public\.search_cards_deep[\s\S]*?LANGUAGE plpgsql STABLE SECURITY DEFINER/i)
    expect(codeOnly).toMatch(/SECURITY DEFINER\s*\n\s*SET search_path = public/i)
  })
})

describe('56A.7a Migration C — RPC has one code path, no PSA7/8 branch', () => {
  it('search_cards_deep does NOT emit the 56A.6 unsupported flag anymore', () => {
    expect(C).not.toMatch(/psa7_psa8_requires_filter/i)
  })

  it('search_cards_deep does not declare v_uses_psa78 / v_has_narrowing helpers', () => {
    expect(C).not.toMatch(/v_uses_psa78 BOOLEAN/i)
    expect(C).not.toMatch(/v_has_narrowing BOOLEAN/i)
  })

  it('PSA 7/8 filters and sort keys reach the WHERE / ORDER BY of the fast path', () => {
    const rpcStart = C.indexOf('CREATE OR REPLACE FUNCTION public.search_cards_deep')
    const block    = C.slice(rpcStart)
    expect(block).toMatch(/p_psa7_min\s+IS NULL OR v\.psa7_usd\s*>=\s*p_psa7_min/i)
    expect(block).toMatch(/p_psa7_max\s+IS NULL OR v\.psa7_usd\s*<=\s*p_psa7_max/i)
    expect(block).toMatch(/p_psa8_min\s+IS NULL OR v\.psa8_usd\s*>=\s*p_psa8_min/i)
    expect(block).toMatch(/p_psa8_max\s+IS NULL OR v\.psa8_usd\s*<=\s*p_psa8_max/i)
    expect(block).toMatch(/p_sort = 'psa7_asc'\s+THEN psa7_usd\s+END ASC\s+NULLS LAST/i)
    expect(block).toMatch(/p_sort = 'psa8_desc'\s+THEN psa8_usd\s+END DESC NULLS LAST/i)
  })

  it('daily_prices is NOT referenced inside the RPC (fast path uses cards_search_v exclusively)', () => {
    const rpcStart = C.indexOf('CREATE OR REPLACE FUNCTION public.search_cards_deep')
    const rpcEnd   = C.indexOf('GRANT EXECUTE ON FUNCTION public.search_cards_deep', rpcStart)
    const block    = C.slice(rpcStart, rpcEnd).replace(/--.*$/gm, '')
    expect(block).not.toMatch(/\bdaily_prices\b/i)
  })
})

describe('56A.7a Migration C — cheap catalogue-count fast path preserved', () => {
  it('declares v_filters_empty covering every filter param including psa7/8', () => {
    expect(C).toMatch(/v_filters_empty BOOLEAN/i)
    const guardStart = C.indexOf('v_filters_empty BOOLEAN')
    const guardEnd   = C.indexOf(');', guardStart)
    const emptyBlock = C.slice(guardStart, guardEnd)
    for (const p of [
      'p_pokemon_slug', 'p_card_name', 'p_set_name', 'p_language',
      'p_year_min', 'p_year_max',
      'p_raw_min', 'p_raw_max',
      'p_psa7_min', 'p_psa7_max',
      'p_psa8_min', 'p_psa8_max',
      'p_psa9_min', 'p_psa9_max',
      'p_psa10_min', 'p_psa10_max',
      'p_change_7d_min', 'p_change_7d_max',
      'p_change_30d_min', 'p_change_30d_max',
      'p_change_90d_min', 'p_change_90d_max',
      'p_psa9_uplift_min', 'p_psa10_uplift_min',
      'p_psa9_multiple_min', 'p_psa10_multiple_min',
    ]) {
      expect(emptyBlock).toContain(p)
    }
  })

  it('uses count_deep_search_catalogue() when v_filters_empty', () => {
    expect(C).toMatch(/IF v_filters_empty THEN\s*\n\s*v_total := public\.count_deep_search_catalogue\(\);/i)
  })

  it('count_deep_search_catalogue mirrors the sealed exclusion (unchanged since 56A)', () => {
    const ORIGINAL = readFileSync(
      join(process.cwd(), 'migrations', '2026-08-09-deep-card-search.sql'),
      'utf8',
    )
    expect(ORIGINAL).toMatch(
      /count_deep_search_catalogue[\s\S]*?FROM public\.cards WHERE COALESCE\(is_sealed, FALSE\) = FALSE/i,
    )
  })
})

// ── Scope guards across the whole set ─────────────────────────────────

describe('56A.7a — scope guards (§4 / §14)', () => {
  it('no migration in the set adds a secondary index on card_latest_prices', () => {
    for (const [name, sql] of [['A', A], ['B', B], ['C', C]] as const) {
      const idx = sql.match(/CREATE INDEX[^\n;]*card_latest_prices/gi) || []
      expect(idx, `${name} should not create secondary card_latest_prices indexes`).toHaveLength(0)
    }
  })

  it('no migration alters cards / daily_prices / card_trends schema', () => {
    for (const [name, sql] of [['A', A], ['B', B], ['C', C]] as const) {
      for (const t of ['cards', 'daily_prices', 'card_trends']) {
        expect(sql, `${name} should not ALTER TABLE ${t}`).not.toMatch(
          new RegExp(`ALTER TABLE[^\\n]*\\b${t}\\b`, 'i'),
        )
      }
    }
  })

  it('no migration creates a cron / scheduler / worker / materialised view', () => {
    for (const [name, sql] of [['A', A], ['B', B], ['C', C]] as const) {
      for (const kw of ['cron', 'schedule', 'worker', 'queue']) {
        const rx = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:TABLE|MATERIALIZED VIEW|EXTENSION)[^\\n]*${kw}`, 'i')
        expect(sql, `${name} should not create ${kw} artefacts`).not.toMatch(rx)
      }
      expect(sql, `${name} should not create a materialized view`).not.toMatch(/CREATE MATERIALIZED VIEW/i)
    }
  })
})

// ── Perf-index migration (from 56A.4) still stands ─────────────────────

describe('56A.3 — perf-index migration is present, single-line, reversible', () => {
  const PERF = readFileSync(
    join(process.cwd(), 'migrations', '2026-08-10-deep-card-search-perf.sql'),
    'utf8',
  )

  it('creates exactly one index on card_trends(card_name, set_name)', () => {
    const matches = PERF.match(/CREATE INDEX/gi) || []
    expect(matches.length).toBe(1)
    expect(PERF).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_card_trends_name_set\s+ON public\.card_trends \(card_name, set_name\);/i,
    )
  })

  it('adds no other schema objects', () => {
    for (const kw of ['TABLE', 'FUNCTION', 'VIEW', 'TRIGGER', 'MATERIALIZED']) {
      expect(PERF).not.toMatch(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?${kw}`, 'i'))
    }
  })
})
