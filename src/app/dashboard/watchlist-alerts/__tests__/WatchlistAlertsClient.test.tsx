// Block 5A-W-44B — invariants for the polished /dashboard/watchlist-alerts
// page. The client component runs live Supabase reads on mount so we
// pin structural invariants by reading the source directly.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CLIENT_SRC = readFileSync(
  join(__dirname, '..', 'WatchlistAlertsClient.tsx'), 'utf8',
)
const SUMMARY_SRC = readFileSync(
  join(__dirname, '..', 'WatchlistAlertsSummary.tsx'), 'utf8',
)
const WATCHLIST_SRC = readFileSync(
  join(__dirname, '..', '..', 'watchlist', 'WatchlistClient.tsx'), 'utf8',
)

describe('WatchlistAlertsClient — W44B page framing', () => {
  it('renders the new "Watchlist & alerts" heading (lowercase "alerts")', () => {
    // Brief-specified capitalisation. The old title-cased "Alerts"
    // must not linger anywhere in the visible H1.
    expect(CLIENT_SRC).toMatch(/<h1[\s\S]*?Watchlist &amp; alerts[\s\S]*?<\/h1>/)
    expect(CLIENT_SRC).not.toMatch(/<h1[\s\S]*?Watchlist &amp; Alerts[\s\S]*?<\/h1>/)
  })

  it('renders the new sub-copy from the brief', () => {
    expect(CLIENT_SRC).toContain('Track cards you care about and spot recent movement.')
    // Old developer-tone copy must be gone from the outer client.
    expect(CLIENT_SRC).not.toContain('Update what you watch and how loud the alerts are')
  })

  it('keeps Back to Dashboard via DashboardNav (W42B)', () => {
    // The nav component provides the back link on every sub-page;
    // this asserts the mount is present with the "watchlist" tab
    // selected. Direct assertion of the link string lives in
    // src/app/dashboard/__tests__/DashboardNav.test.tsx.
    expect(CLIENT_SRC).toMatch(/<DashboardNav[\s\S]*?current="watchlist"/)
  })

  it('keeps the four page sections + CTA footer intact', () => {
    // Watchlist summary + Watched cards + Alert defaults + Recent
    // history. Guard against a future rename accidentally dropping
    // one when we tweak copy elsewhere.
    expect(CLIENT_SRC).toContain('<WatchlistAlertsSummaryPanel')
    expect(CLIENT_SRC).toMatch(/Watched cards/)
    expect(CLIENT_SRC).toContain('<AlertPreferencesCard')
    expect(CLIENT_SRC).toContain('<RecentAlerts')
    expect(CLIENT_SRC).toContain('Browse cards →')
  })
})

describe('WatchlistAlertsSummary — W44B biggest mover', () => {
  it('imports and uses the new pickBiggestMover helper', () => {
    expect(SUMMARY_SRC).toContain('pickBiggestMover')
    // The fetch must use the SAME RPC the watchlist row list uses —
    // no new RPC introduced (safety constraint from the brief).
    expect(SUMMARY_SRC).toMatch(/supabase\.rpc\(['"]get_watchlist_with_prices['"]/)
  })

  it('renders the biggest-mover chip ONLY when a mover is available', () => {
    // Conditional render is the "no fake numbers" guard — an empty
    // watchlist or a watchlist with no price data yet must produce
    // no chip.
    expect(SUMMARY_SRC).toMatch(/\{biggestMover && <BiggestMoverChip mover=\{biggestMover\}/)
  })

  it('the mover chip links to the card page and includes card name + set', () => {
    // Regression guard on the deep-link path so a rename cannot leak
    // to the wrong card. The chip renders inside an <a> to /set/... .
    expect(SUMMARY_SRC).toContain('/set/${encodeURIComponent(mover.set_name)}/card/')
    expect(SUMMARY_SRC).toContain('mover.card_name')
    expect(SUMMARY_SRC).toContain('mover.set_name')
  })

  it('mover chip carries the 30d/7d window suffix and the % sign of the pct', () => {
    // The signed % is preserved so a drop renders red + downward.
    expect(SUMMARY_SRC).toContain('mover.window')
    expect(SUMMARY_SRC).toContain('Math.abs(mover.pct).toFixed(1)')
  })

  it('safety: no new schema — biggest-mover only reads get_watchlist_with_prices', () => {
    // Total set of supabase.rpc calls in the panel: the pre-existing
    // watchlist / overrides / events / prefs `.from(...)` reads plus
    // the W44B mover RPC — nothing else.
    const rpcMatches = SUMMARY_SRC.match(/supabase\.rpc\(['"]([^'"]+)['"]/g) || []
    for (const m of rpcMatches) {
      const name = m.replace(/^supabase\.rpc\(['"]/, '').replace(/['"]$/, '')
      expect(new Set(['get_watchlist_with_prices']).has(name)).toBe(true)
    }
  })
})

describe('WatchlistClient — W44B empty state + no cheap emojis', () => {
  it('empty state uses the exact brief-specified copy', () => {
    expect(WATCHLIST_SRC).toContain('Your watchlist is empty')
    expect(WATCHLIST_SRC).toContain('Add cards to track price movement and future alerts.')
    // The old "Build your watchlist" heading must be gone.
    expect(WATCHLIST_SRC).not.toContain('Build your watchlist')
  })

  it('empty state has a Browse cards CTA linking to /browse', () => {
    // Regex allows either quote style around the href.
    expect(WATCHLIST_SRC).toMatch(/href=["']\/browse["'][\s\S]*?Browse cards/)
  })

  it('empty state keeps the modal-trigger "+ Watch a card" as a secondary action', () => {
    expect(WATCHLIST_SRC).toContain('+ Watch a card')
  })

  it('drops the decorative 👁 empty-state glyph (W44B — no cheap emojis)', () => {
    expect(WATCHLIST_SRC).not.toContain('\u{1F441}')      // 👁
  })

  it('drops the 🃏 image-placeholder glyph in favour of a plain text placeholder', () => {
    expect(WATCHLIST_SRC).not.toContain('\u{1F0CF}')      // 🃏
    // Text placeholder must render "Card" so a screen-reader-hidden
    // slot exists in place of the emoji.
    expect(WATCHLIST_SRC).toMatch(/aria-hidden[\s\S]*?>Card<\/div>/)
  })

  it('sort controls remain present (Recently added / Best 30d / Best since added / Highest value / A–Z)', () => {
    for (const label of [
      'Recently added',
      'Best 30d',
      'Best since added',
      'Highest value',
      'A–Z',
    ]) {
      expect(WATCHLIST_SRC).toContain(label)
    }
  })

  it('each rendered watchlist row still links to the card page', () => {
    expect(WATCHLIST_SRC).toContain('/set/${encodeURIComponent(item.set_name)}/card/${item.card_url_slug || item.card_slug}')
  })
})
