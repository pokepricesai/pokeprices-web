// Block 5A-W-42A-FIX4 — invariants for the shared portfolio summary
// helper. The helper's pipeline mirrors PortfolioDashboard.loadPortfolio;
// both surfaces (hub + portfolio page) render the same numbers.
//
// Two layers of coverage:
//   * `formatPortfolioValue` — pure currency formatting, tested
//     directly against the same shape PortfolioDashboard.fmtBig
//     produces (USD uses /100, GBP uses /127).
//   * `loadPortfolioSummary` — source-read invariants that pin the
//     pipeline order (primary-portfolio .limit(1), currency lookup,
//     RPC call, dedupe by id, card_trends recompute, daily_prices
//     recompute, aggregation).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatPortfolioValue } from '../portfolioSummary'

const SRC = readFileSync(join(__dirname, '..', 'portfolioSummary.ts'), 'utf8')

describe('formatPortfolioValue — currency + threshold parity with PortfolioDashboard.fmtBig', () => {
  it('renders "—" for null / zero / negative', () => {
    expect(formatPortfolioValue(null, 'USD')).toBe('—')
    expect(formatPortfolioValue(0,    'USD')).toBe('—')
    expect(formatPortfolioValue(-1,   'USD')).toBe('—')
    expect(formatPortfolioValue(null, 'GBP')).toBe('—')
  })

  it('USD divides cents by 100 and picks the right threshold', () => {
    expect(formatPortfolioValue(1000,     'USD')).toBe('$10.00')
    expect(formatPortfolioValue(50_000,   'USD')).toBe('$500.00')
    expect(formatPortfolioValue(100_000,  'USD')).toBe('$1.0k')
    expect(formatPortfolioValue(110_000,  'USD')).toBe('$1.1k')
    // $1,000,000 renders in the M bucket
    expect(formatPortfolioValue(100_000_000, 'USD')).toBe('$1.00M')
  })

  it('GBP divides cents by 127 (matches PortfolioDashboard.fmtBig)', () => {
    // 127 cents ≈ £1.00; 1270 cents ≈ £10.00
    expect(formatPortfolioValue(127,   'GBP')).toBe('£1.00')
    expect(formatPortfolioValue(1_270, 'GBP')).toBe('£10.00')
    // A user with ~$1.1k USD (110_000 cents) sees ~£866 in the GBP view
    // which crosses the 1k threshold in USD but stays £X.XX in GBP —
    // exactly the switch the portfolio page makes.
    expect(formatPortfolioValue(110_000, 'GBP')).toMatch(/^£\d+\.\d{2}$/)
  })
})

describe('loadPortfolioSummary — pipeline source invariants (mirrors PortfolioDashboard.loadPortfolio)', () => {
  it('resolves the primary portfolio via is_default = true with .limit(1)', () => {
    expect(SRC).toMatch(/\.eq\(['"]user_id['"], userId\)\.eq\(['"]is_default['"], true\)\.limit\(1\)/)
  })

  it('falls back to any-owned portfolio (also .limit(1)) for legacy users', () => {
    // Second query on portfolios — no is_default filter, still .limit(1)
    // so the hub picks the same "first" row the portfolio page would
    // pick if it needed to enumerate.
    expect(SRC).toContain('.from(\'portfolios\').select(\'id\')\n        .eq(\'user_id\', userId).limit(1)')
  })

  it('reads the display currency preference before the RPC call', () => {
    expect(SRC).toContain("from('user_email_preferences')")
    expect(SRC).toContain("select('display_currency')")
    const currencyIdx = SRC.indexOf('display_currency')
    // Helper uses the parameter name `supa`, not `supabase`.
    const rpcIdx      = SRC.indexOf("supa.rpc")
    // Currency-only clients would still misrender; enforce the order.
    expect(currencyIdx).toBeGreaterThan(-1)
    expect(rpcIdx).toBeGreaterThan(-1)
    expect(currencyIdx).toBeLessThan(rpcIdx)
  })

  it('calls the existing get_portfolio_summary RPC (no new RPC)', () => {
    expect(SRC).toContain("supa.rpc('get_portfolio_summary', { p_portfolio_id: primaryPid })")
    // Guard against a brand-new RPC sneaking in.
    const rpcMatches = SRC.match(/\.rpc\(['"]([^'"]+)['"]/g) || []
    for (const m of rpcMatches) {
      expect(m).toContain('get_portfolio_summary')
    }
  })

  it('dedupes RPC items by id (mirrors PortfolioDashboard.tsx:989-991)', () => {
    expect(SRC).toMatch(/new Map\(rawItems\.map\(\(i: any\) => \[i\.id, i\]\)\)/)
    expect(SRC).toContain('dedupedById')
  })

  it('recomputes raw / psa9 / psa10 pricing from card_trends', () => {
    expect(SRC).toContain("from('card_trends')")
    expect(SRC).toContain("current_raw, current_psa9, current_psa10, raw_pct_7d, raw_pct_30d")
    expect(SRC).toContain("i.holding_type === 'raw'")
    expect(SRC).toContain("i.holding_type === 'psa9'")
    expect(SRC).toContain("i.holding_type === 'psa10'")
  })

  it('recomputes extra-tier (PSA 1-8, BGS, CGC, SGC, TAG, ACE) pricing from daily_prices', () => {
    expect(SRC).toContain("from('daily_prices')")
    // Pin the (card_url_slug ↔ card_slug) translation via `cards`.
    expect(SRC).toContain("select('card_url_slug, card_slug, card_name, set_name')")
    expect(SRC).toContain('urlToNumerics')
    expect(SRC).toContain('nameSetToNumerics')
  })

  it('imports HOLDING_TYPE_TO_PRICE_COLUMN so the extra-tier column set stays in sync with the rest of the app', () => {
    expect(SRC).toContain("import { HOLDING_TYPE_TO_PRICE_COLUMN } from '@/lib/portfolioGrades'")
  })

  it('aggregates from deduped items only — sum(position_value_cents), sum(quantity), unique(card_slug)', () => {
    expect(SRC).toContain('for (const it of dedupedById)')
    expect(SRC).toContain('dedupedById.reduce')
    expect(SRC).toContain('i.quantity')
    expect(SRC).toMatch(/new Set\([\s\S]*?dedupedById\.map[\s\S]*?card_slug/)
  })

  it('exposes the display currency on the returned summary', () => {
    expect(SRC).toContain('currency,')
    expect(SRC).toContain("currency: PortfolioSummaryCurrency = 'GBP'")
  })

  it('flags the legacy-fallback case so callers can differentiate', () => {
    expect(SRC).toContain('usedLegacyFallback')
  })
})
