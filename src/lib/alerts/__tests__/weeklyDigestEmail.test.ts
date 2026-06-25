// Block 5A-W-15 — weeklyDigestEmail renderer tests.
//
// Covers:
//   * subject + previewText shape (incl. [TEST] / [SAMPLE] prefixes)
//   * section conditional rendering — portfolio / watchlist / alert
//   * "No major X changes this week." fallbacks when sections are
//     present but empty
//   * disabled-status bodies (master / weekly)
//   * sample banner rendered when sample=true
//   * HTML escaping protects card names + set names
//   * NO PII (no email addresses, no user_id strings)

import { describe, it, expect } from 'vitest'
import {
  buildWeeklyDigestEmail,
  buildSampleWeeklyDigestData,
} from '../weeklyDigestEmail'
import type {
  WeeklyDigestData,
  WeeklyDigestDiagnostics,
} from '../weeklyDigest'

function emptyDiagnostics(generatedAt = '2026-06-25T12:00:00Z'): WeeklyDigestDiagnostics {
  return {
    portfolioCardsConsidered:    0,
    watchlistCardsConsidered:    0,
    cardsWithNoSlugResolution:   0,
    cardsWithNoPriceData:        0,
    cardsWithNoRecentSales:      0,
    portfolioPriceBasisCounts:   { raw_usd: 0, psa9_usd: 0, psa10_usd: 0, unknown_fallback: 0 },
    sectionsOmittedByPreferences: [],
    generatedAt,
  }
}

function baseData(over: Partial<WeeklyDigestData> = {}): WeeklyDigestData {
  return {
    status:       'ok',
    asOf:         '2026-06-25T12:00:00Z',
    lookbackDays: 7,
    alertSummary: { totalEvents: 0, cardBlocks: [] },
    diagnostics:  emptyDiagnostics(),
    ...over,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Subject + preview text
// ─────────────────────────────────────────────────────────────────────

describe('buildWeeklyDigestEmail — subject', () => {
  it('uses the documented subject when no flags are set', () => {
    const out = buildWeeklyDigestEmail(baseData())
    expect(out.subject).toBe('Your weekly PokePrices update')
  })
  it('prefixes [SAMPLE] when sample=true', () => {
    const out = buildWeeklyDigestEmail(baseData(), { sample: true })
    expect(out.subject.startsWith('[SAMPLE] ')).toBe(true)
  })
  it('prefixes [TEST] when test=true', () => {
    const out = buildWeeklyDigestEmail(baseData(), { test: true })
    expect(out.subject.startsWith('[TEST] ')).toBe(true)
  })
  it('stacks [TEST] [SAMPLE] in that order when both flags are set', () => {
    const out = buildWeeklyDigestEmail(baseData(), { test: true, sample: true })
    expect(out.subject.startsWith('[TEST] [SAMPLE] ')).toBe(true)
  })
})

describe('buildWeeklyDigestEmail — previewText', () => {
  it('flags the disabled-master state', () => {
    const out = buildWeeklyDigestEmail(baseData({ status: 'disabled_master' }))
    expect(out.previewText).toMatch(/Smart alerts are turned off/)
  })
  it('flags the disabled-weekly state', () => {
    const out = buildWeeklyDigestEmail(baseData({ status: 'disabled_weekly' }))
    expect(out.previewText).toMatch(/Weekly overview is turned off/)
  })
  it('summarises counts when content is present', () => {
    const out = buildWeeklyDigestEmail(baseData({
      portfolio: { itemCount: 3, currentTotalCents: 1000, previousTotalCents: 900, absChangeCents: 100, pctChange: 11.1, topItems: [] },
      watchlist: { itemCount: 4, topItems: [] },
      alertSummary: { totalEvents: 2, cardBlocks: [] },
    }))
    expect(out.previewText).toMatch(/3 portfolio items/)
    expect(out.previewText).toMatch(/4 watchlist cards/)
    expect(out.previewText).toMatch(/2 alerts/)
  })
  it('falls back to a quiet-week message when no sections have counts', () => {
    const out = buildWeeklyDigestEmail(baseData())
    expect(out.previewText).toMatch(/quiet week/i)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Sections — conditional render
// ─────────────────────────────────────────────────────────────────────

describe('buildWeeklyDigestEmail — portfolio section', () => {
  it('includes the heading and totals when portfolio is provided', () => {
    const out = buildWeeklyDigestEmail(baseData({
      portfolio: {
        itemCount: 2, currentTotalCents: 250000, previousTotalCents: 200000,
        absChangeCents: 50000, pctChange: 25.0,
        topItems: [{
          cardSlug: '111', cardName: 'Charizard', setName: 'Base',
          cardUrl: 'https://www.pokeprices.io/set/Base/card/charizard-4',
          currentCents: 100000, previousCents: 80000, pctChange: 25, absChangeCents: 20000,
          recentSalesCount: 2, reason: 'biggest_riser',
        }],
      },
    }))
    expect(out.html).toMatch(/Portfolio overview/i)
    expect(out.html).toMatch(/\$2,500\.00/)
    expect(out.html).toMatch(/\+25\.0%/)
    expect(out.html).toMatch(/Charizard/)
    expect(out.html).toMatch(/Biggest riser/)
    expect(out.html).toMatch(/href="https:\/\/www\.pokeprices\.io\/set\/Base\/card\/charizard-4"/)
    // Text body mirrors it
    expect(out.text).toMatch(/PORTFOLIO OVERVIEW/)
    expect(out.text).toMatch(/Charizard/)
  })

  it('summary line makes the all-portfolios scope explicit (Block 5A-W-15B)', () => {
    const out = buildWeeklyDigestEmail(baseData({
      portfolio: {
        itemCount: 35, currentTotalCents: 8749300, previousTotalCents: 9120000,
        absChangeCents: -370700, pctChange: -4.0,
        topItems: [],
      },
    }))
    expect(out.html).toMatch(/Estimated value across all portfolios · 35 items/i)
    expect(out.text).toMatch(/Estimated value across all portfolios/i)
    // The old, ambiguous copy MUST be gone.
    expect(out.html).not.toMatch(/>Estimated value · 35 items</)
  })

  it('omits the portfolio section entirely when not provided', () => {
    const out = buildWeeklyDigestEmail(baseData())
    expect(out.html).not.toMatch(/Portfolio overview/i)
    expect(out.text).not.toMatch(/PORTFOLIO OVERVIEW/)
  })

  it('renders the friendly "no major portfolio changes" fallback when itemCount > 0 but topItems is empty', () => {
    const out = buildWeeklyDigestEmail(baseData({
      portfolio: {
        itemCount: 4, currentTotalCents: 1000, previousTotalCents: 1000,
        absChangeCents: 0, pctChange: 0, topItems: [],
      },
    }))
    expect(out.html).toMatch(/No major portfolio changes this week/)
    expect(out.text).toMatch(/No major portfolio changes this week/)
  })

  it('renders the "no portfolio items yet" empty-state when itemCount is 0', () => {
    const out = buildWeeklyDigestEmail(baseData({
      portfolio: { itemCount: 0, currentTotalCents: null, previousTotalCents: null, absChangeCents: null, pctChange: null, topItems: [] },
    }))
    expect(out.html).toMatch(/No portfolio items yet/)
    expect(out.text).toMatch(/No portfolio items yet/)
  })
})

describe('buildWeeklyDigestEmail — watchlist section', () => {
  it('includes the heading and items when watchlist is provided', () => {
    const out = buildWeeklyDigestEmail(baseData({
      watchlist: {
        itemCount: 5,
        topItems: [{
          cardSlug: '222', cardName: 'Haunter', setName: 'Fossil',
          cardUrl: 'https://www.pokeprices.io/set/Fossil/card/haunter-6',
          currentCents: 5000, previousCents: 4000, pctChange: 25, absChangeCents: 1000,
          recentSalesCount: 0, reason: 'biggest_riser',
        }],
      },
    }))
    expect(out.html).toMatch(/Watchlist overview/i)
    expect(out.html).toMatch(/Haunter/)
    expect(out.html).toMatch(/5 watched cards/)
    expect(out.text).toMatch(/WATCHLIST OVERVIEW/)
  })

  it('omits the watchlist section entirely when not provided', () => {
    const out = buildWeeklyDigestEmail(baseData())
    expect(out.html).not.toMatch(/Watchlist overview/i)
    expect(out.text).not.toMatch(/WATCHLIST OVERVIEW/)
  })

  it('renders the "no major watchlist changes" fallback when items present but topItems empty', () => {
    const out = buildWeeklyDigestEmail(baseData({
      watchlist: { itemCount: 3, topItems: [] },
    }))
    expect(out.html).toMatch(/No major watchlist changes this week/)
    expect(out.text).toMatch(/No major watchlist changes this week/)
  })

  it('renders an empty-state when itemCount is 0', () => {
    const out = buildWeeklyDigestEmail(baseData({
      watchlist: { itemCount: 0, topItems: [] },
    }))
    expect(out.html).toMatch(/Your watchlist is empty/)
    expect(out.text).toMatch(/Your watchlist is empty/)
  })
})

describe('buildWeeklyDigestEmail — alert highlights', () => {
  it('renders alert highlights when card blocks are present', () => {
    const out = buildWeeklyDigestEmail(baseData({
      alertSummary: {
        totalEvents: 3,
        cardBlocks: [
          {
            cardSlug: '111', cardName: 'Charizard', setName: 'Base',
            cardUrl: 'https://www.pokeprices.io/set/Base/card/charizard-4',
            eventCount: 2, severities: { high: 1, normal: 1, low: 0 },
            rules: ['raw_change', 'recent_sales'],
          },
          {
            cardSlug: '222', cardName: 'Haunter', setName: 'Fossil', cardUrl: null,
            eventCount: 1, severities: { high: 0, normal: 1, low: 0 },
            rules: ['psa10_change'],
          },
        ],
      },
    }))
    expect(out.html).toMatch(/Alert highlights/i)
    expect(out.html).toMatch(/3 alerts this week/)
    expect(out.html).toMatch(/1 high/i)
    expect(out.html).toMatch(/Charizard/)
    expect(out.html).toMatch(/Haunter/)
    expect(out.html).toMatch(/Raw change/i)
    expect(out.html).toMatch(/PSA 10 change/i)
    expect(out.text).toMatch(/ALERT HIGHLIGHTS/)
  })

  it('omits alert highlights when there are no card blocks', () => {
    const out = buildWeeklyDigestEmail(baseData())
    expect(out.html).not.toMatch(/Alert highlights/i)
    expect(out.text).not.toMatch(/ALERT HIGHLIGHTS/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Disabled status bodies
// ─────────────────────────────────────────────────────────────────────

describe('buildWeeklyDigestEmail — disabled bodies', () => {
  it('renders the master-disabled banner when status=disabled_master', () => {
    const out = buildWeeklyDigestEmail(baseData({ status: 'disabled_master' }))
    expect(out.html).toMatch(/Smart alerts are turned off/i)
    expect(out.text).toMatch(/Smart alerts are turned off/i)
    // Sections must NOT render in the disabled state, regardless of
    // whether the input happens to carry portfolio/watchlist objects.
    expect(out.html).not.toMatch(/Portfolio overview/i)
    expect(out.html).not.toMatch(/Watchlist overview/i)
  })

  it('renders the weekly-disabled banner when status=disabled_weekly', () => {
    const out = buildWeeklyDigestEmail(baseData({ status: 'disabled_weekly' }))
    expect(out.html).toMatch(/Weekly overview is turned off/i)
    expect(out.text).toMatch(/Weekly overview is turned off/i)
  })

  it('renders the quiet-week message when ok but all sections empty', () => {
    const out = buildWeeklyDigestEmail(baseData())
    expect(out.html).toMatch(/quiet week/i)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Sample banner + escaping
// ─────────────────────────────────────────────────────────────────────

describe('buildWeeklyDigestEmail — sample banner', () => {
  it('renders the sample banner in HTML and text when sample=true', () => {
    const out = buildWeeklyDigestEmail(buildSampleWeeklyDigestData(), { sample: true })
    expect(out.html).toMatch(/Sample data/)
    expect(out.text).toMatch(/\[SAMPLE DATA/)
  })

  it('omits the sample banner when sample is false', () => {
    const out = buildWeeklyDigestEmail(buildSampleWeeklyDigestData())
    expect(out.html).not.toMatch(/Sample data/)
    expect(out.text).not.toMatch(/\[SAMPLE DATA/)
  })
})

describe('buildWeeklyDigestEmail — HTML escaping', () => {
  it('escapes HTML in card and set names', () => {
    const out = buildWeeklyDigestEmail(baseData({
      portfolio: {
        itemCount: 1, currentTotalCents: 100, previousTotalCents: 90, absChangeCents: 10, pctChange: 11.1,
        topItems: [{
          cardSlug: '1', cardName: '<script>alert(1)</script>', setName: 'A & B',
          cardUrl: null, currentCents: 100, previousCents: 90, pctChange: 11.1, absChangeCents: 10,
          recentSalesCount: 0, reason: 'biggest_riser',
        }],
      },
    }))
    expect(out.html).not.toMatch(/<script>/)
    expect(out.html).toMatch(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    expect(out.html).toMatch(/A &amp; B/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Branding + footer
// ─────────────────────────────────────────────────────────────────────

describe('buildWeeklyDigestEmail — branding + footer', () => {
  it('renders the PokePrices wordmark in HTML and text headers', () => {
    const out = buildWeeklyDigestEmail(baseData())
    expect(out.html).toMatch(/PokePrices/)
    expect(out.text).toMatch(/^PokePrices$/m)
  })
  it('renders the tagline', () => {
    const out = buildWeeklyDigestEmail(baseData())
    const tagline = 'Your weekly portfolio and watchlist update'
    expect(out.html).toContain(tagline)
    expect(out.text).toContain(tagline)
  })
  it('renders a footer with the reason + manage link + portfolio link', () => {
    const out = buildWeeklyDigestEmail(baseData())
    expect(out.html).toMatch(/You are receiving this because you enabled the weekly overview/)
    expect(out.html).toMatch(/href="https:\/\/www\.pokeprices\.io\/dashboard\/settings"[^>]*>Manage alerts<\/a>/)
    expect(out.html).toMatch(/href="https:\/\/www\.pokeprices\.io\/dashboard\/portfolio"/)
    expect(out.text).toMatch(/Manage alerts at https:\/\/www\.pokeprices\.io\/dashboard\/settings/)
  })
  it('does NOT include an unsubscribe link (in-app settings is the opt-out flow)', () => {
    const out = buildWeeklyDigestEmail(baseData())
    expect(out.html.toLowerCase()).not.toMatch(/unsubscribe/)
    expect(out.text.toLowerCase()).not.toMatch(/unsubscribe/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Sample data shape + PII guard
// ─────────────────────────────────────────────────────────────────────

describe('buildSampleWeeklyDigestData', () => {
  it('returns a complete, ok-status digest covering every section', () => {
    const d = buildSampleWeeklyDigestData()
    expect(d.status).toBe('ok')
    expect(d.portfolio?.itemCount).toBeGreaterThan(0)
    expect(d.watchlist?.itemCount).toBeGreaterThan(0)
    expect(d.alertSummary.cardBlocks.length).toBeGreaterThan(0)
    expect(d.portfolio?.topItems.length).toBeGreaterThan(0)
    expect(d.watchlist?.topItems.length).toBeGreaterThan(0)
  })
})

describe('buildWeeklyDigestEmail — PII guard', () => {
  it('never leaks an email address or auth token from the data shape', () => {
    const out = buildWeeklyDigestEmail(buildSampleWeeklyDigestData())
    const blob = [out.subject, out.previewText, out.html, out.text].join('\n')
    expect(blob).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
    expect(blob).not.toMatch(/"user_id"|"email"|"token"/i)
  })
})
