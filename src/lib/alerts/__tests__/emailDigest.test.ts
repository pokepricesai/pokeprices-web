// Block 5A-W-4 — pure email digest builder.
// Covers subject/preview/html/text shape, severity grouping, rule
// branches, sample banner + subject prefix, no PII in the rendered
// output.

import { describe, it, expect } from 'vitest'
import {
  buildEmailDigest,
  buildSampleEvents,
  type DigestEvent,
} from '../emailDigest'

function ev(over: Partial<DigestEvent>): DigestEvent {
  return {
    cardName: 'Charizard',
    setName:  'Base Set',
    rule:     'raw_change',
    severity: 'normal',
    payload:  {},
    ...over,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Subject + preview text
// ─────────────────────────────────────────────────────────────────────

describe('buildEmailDigest — subject', () => {
  it('uses an empty-state subject when there are no events', () => {
    const d = buildEmailDigest([])
    expect(d.subject).toBe('Your PokePrices alert digest')
  })

  it('counts distinct cards (not events) in the subject', () => {
    const d = buildEmailDigest([
      ev({ cardName: 'A', setName: 'Base' }),
      ev({ cardName: 'A', setName: 'Base', rule: 'psa10_change' }),
      ev({ cardName: 'B', setName: 'Base' }),
    ])
    expect(d.subject).toBe('Your PokePrices alert digest — 2 cards moved')
  })

  it('uses singular when exactly one distinct card moved', () => {
    const d = buildEmailDigest([ev({ cardName: 'A', setName: 'Base' })])
    expect(d.subject).toBe('Your PokePrices alert digest — 1 card moved')
  })

  it('prefixes [SAMPLE] when sample=true', () => {
    const d = buildEmailDigest(buildSampleEvents(), { sample: true })
    expect(d.subject.startsWith('[SAMPLE] ')).toBe(true)
  })
})

describe('buildEmailDigest — preview text', () => {
  it('mentions the first high-severity event when present', () => {
    const d = buildEmailDigest([
      ev({ cardName: 'Pikachu', severity: 'normal' }),
      ev({ cardName: 'Charizard', severity: 'high', payload: { old: 10000, new: 15000, pct: 50 } }),
    ])
    expect(d.previewText).toMatch(/Charizard/)
    expect(d.previewText).toMatch(/and 1 more/)
  })

  it('does not pluralise when only the headline event exists', () => {
    const d = buildEmailDigest([ev({ cardName: 'X', payload: { old: 100, new: 110, pct: 10 } })])
    expect(d.previewText).not.toMatch(/and \d+ more/)
  })

  it('falls back to an empty-state line for zero events', () => {
    expect(buildEmailDigest([]).previewText).toBe('No new alerts since your last digest.')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Rule rendering
// ─────────────────────────────────────────────────────────────────────

describe('buildEmailDigest — reason text per rule', () => {
  it('formats raw_change as old → new (pct)', () => {
    const d = buildEmailDigest([ev({ rule: 'raw_change', payload: { old: 12500, new: 16875, pct: 35 } })])
    expect(d.text).toMatch(/Raw \$125\.00 → \$168\.75 \(\+35\.0%\)/)
  })

  it('formats psa10_change with the PSA 10 label', () => {
    const d = buildEmailDigest([ev({ rule: 'psa10_change', payload: { old: 35250, new: 39500, pct: 12.1 } })])
    expect(d.text).toMatch(/PSA 10 \$352\.50 → \$395\.00 \(\+12\.1%\)/)
  })

  it('formats spread_change with × suffix on the multiples', () => {
    const d = buildEmailDigest([ev({ rule: 'spread_change', payload: { old_spread: 5.2, new_spread: 7.8, pct: 50 } })])
    expect(d.text).toMatch(/Spread 5\.2× → 7\.8× \(\+50\.0%\)/)
  })

  it('formats recent_sales as N sales in last D days', () => {
    const d = buildEmailDigest([ev({ rule: 'recent_sales', payload: { recent_active_count: 4, window_days: 7 } })])
    expect(d.text).toMatch(/4 new verified sales in the last 7 days/)
  })

  it('formats market_activity with the activity count', () => {
    const d = buildEmailDigest([ev({ rule: 'market_activity', payload: { active_count: 8, window_days: 14 } })])
    expect(d.text).toMatch(/8 verified sales in the last 14 days/)
  })

  it('uses Raw/PSA 10 sub-labels for the generic price_move rule', () => {
    const dRaw = buildEmailDigest([ev({ rule: 'price_move', payload: { price_field: 'raw_usd',  old: 1000, new: 1200, pct: 20 } })])
    const dPsa = buildEmailDigest([ev({ rule: 'price_move', payload: { price_field: 'psa10_usd', old: 8000, new: 9000, pct: 12.5 } })])
    expect(dRaw.text).toMatch(/Raw \$10\.00 → \$12\.00/)
    expect(dPsa.text).toMatch(/PSA 10 \$80\.00 → \$90\.00/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Severity grouping + sample banner
// ─────────────────────────────────────────────────────────────────────

describe('buildEmailDigest — sections', () => {
  it('renders high-severity events before normal ones in HTML and text', () => {
    const d = buildEmailDigest([
      ev({ cardName: 'NormalCard', severity: 'normal' }),
      ev({ cardName: 'HighCard',   severity: 'high' }),
    ])
    expect(d.text.indexOf('HighCard')).toBeLessThan(d.text.indexOf('NormalCard'))
    expect(d.html.indexOf('HighCard')).toBeLessThan(d.html.indexOf('NormalCard'))
  })

  it('only renders sections that contain events', () => {
    const d = buildEmailDigest([ev({ severity: 'normal' })])
    expect(d.html).toContain('Notable changes')
    expect(d.html).not.toContain('Big moves')
    expect(d.html).not.toContain('For your awareness')
  })

  it('includes the sample banner in HTML and text when sample=true', () => {
    const d = buildEmailDigest(buildSampleEvents(), { sample: true })
    expect(d.html).toMatch(/Sample data/)
    expect(d.text).toMatch(/\[SAMPLE DATA/)
  })

  it('omits the sample banner when sample is false', () => {
    const d = buildEmailDigest([ev({})])
    expect(d.html).not.toMatch(/Sample data/)
    expect(d.text).not.toMatch(/\[SAMPLE DATA/)
  })

  it('renders an empty-state body when there are no events', () => {
    const d = buildEmailDigest([])
    expect(d.html).toMatch(/No new alerts since your last digest/)
    expect(d.text).toMatch(/No new alerts since your last digest/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Links + escaping
// ─────────────────────────────────────────────────────────────────────

describe('buildEmailDigest — links and escaping', () => {
  it('renders the View card button when cardUrl is present and omits it when absent', () => {
    const withUrl = buildEmailDigest([ev({ cardUrl: 'https://www.pokeprices.io/set/Base/card/x' })])
    expect(withUrl.html).toMatch(/href="https:\/\/www\.pokeprices\.io\/set\/Base\/card\/x"/)
    expect(withUrl.html).toMatch(/View card →<\/a>/)
    expect(withUrl.text).toMatch(/https:\/\/www\.pokeprices\.io\/set\/Base\/card\/x/)
    // No "View card" button when no URL is supplied — but the footer
    // Manage-alerts link does still appear, so we cannot blanket-assert
    // there is no href in the document.
    const noUrl = buildEmailDigest([ev({})])
    expect(noUrl.html).not.toMatch(/View card →/)
  })

  it('escapes HTML in card and set names', () => {
    const d = buildEmailDigest([ev({ cardName: '<script>alert(1)</script>', setName: 'A & B' })])
    expect(d.html).not.toMatch(/<script>/)
    expect(d.html).toMatch(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    expect(d.html).toMatch(/A &amp; B/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Sample data
// ─────────────────────────────────────────────────────────────────────

describe('buildSampleEvents', () => {
  it('returns events spanning multiple rules and at least one high severity', () => {
    const events = buildSampleEvents()
    expect(events.length).toBeGreaterThan(0)
    const rules = new Set(events.map(e => e.rule))
    expect(rules.size).toBeGreaterThanOrEqual(4)
    expect(events.some(e => e.severity === 'high')).toBe(true)
    // Every sample event has both a cardName + setName.
    for (const e of events) {
      expect(e.cardName.length).toBeGreaterThan(0)
      expect(e.setName.length).toBeGreaterThan(0)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────
// Branding
// ─────────────────────────────────────────────────────────────────────

describe('buildEmailDigest — branding', () => {
  it('renders the PokePrices wordmark in the HTML header and the plain text header', () => {
    const d = buildEmailDigest([ev({})])
    expect(d.html).toMatch(/PokePrices/)
    expect(d.text).toMatch(/^PokePrices$/m)
  })

  it('renders the tagline in both HTML and text', () => {
    const d = buildEmailDigest([ev({})])
    const tagline = 'Track your Pokémon card market moves'
    expect(d.html).toContain(tagline)
    expect(d.text).toContain(tagline)
  })

  it('renders View card as an anchor styled like a branded button', () => {
    const d = buildEmailDigest([ev({ cardUrl: 'https://www.pokeprices.io/set/Base/card/x' })])
    // Branded look: anchor uses the primary blue background + white text.
    expect(d.html).toMatch(/<a\b[^>]*href="https:\/\/www\.pokeprices\.io\/set\/Base\/card\/x"[^>]*background:#1a5fad/)
    expect(d.html).toMatch(/View card →<\/a>/)
  })

  it('renders a footer with the brand line, opt-in reason, and the manage-alerts link', () => {
    const d = buildEmailDigest([ev({})])
    // HTML footer must contain the reason copy + manage link + the
    // wordmark a second time (top + bottom).
    expect(d.html).toMatch(/You are receiving this because you enabled card alerts/)
    expect(d.html).toMatch(/href="https:\/\/www\.pokeprices\.io\/dashboard\/settings"[^>]*>Manage alerts<\/a>/)
    // The HTML contains the PokePrices wordmark at least twice (header + footer).
    expect((d.html.match(/PokePrices/g) ?? []).length).toBeGreaterThanOrEqual(2)

    // Plain text mirrors the structure.
    expect(d.text).toMatch(/You are receiving this because you enabled card alerts/)
    expect(d.text).toMatch(/Manage alerts at https:\/\/www\.pokeprices\.io\/dashboard\/settings/)
  })

  it('does NOT include an unsubscribe link (in-app settings is the opt-out flow)', () => {
    const d = buildEmailDigest([ev({})])
    expect(d.html.toLowerCase()).not.toMatch(/unsubscribe/)
    expect(d.text.toLowerCase()).not.toMatch(/unsubscribe/)
  })

  it('keeps the sample banner visible alongside the new header when sample=true', () => {
    const d = buildEmailDigest(buildSampleEvents(), { sample: true })
    expect(d.html).toMatch(/PokePrices/)
    expect(d.html).toMatch(/Sample data/)
    expect(d.text).toMatch(/PokePrices/)
    expect(d.text).toMatch(/\[SAMPLE DATA/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// PII / leakage
// ─────────────────────────────────────────────────────────────────────

describe('buildEmailDigest — PII guard', () => {
  it('never includes email addresses, user_id keys, or auth tokens in any output', () => {
    const events: DigestEvent[] = [
      // Deliberately stuff hostile/PII-looking fields into the payload
      // to prove the renderer ignores unknown keys rather than echoing
      // them verbatim.
      ev({
        cardName: 'Card', setName: 'Set',
        payload: {
          old: 100, new: 110, pct: 10,
          email:   'leak@example.com',
          user_id: 'u-should-not-leak',
          token:   'shhh',
        },
      }),
    ]
    const d = buildEmailDigest(events)
    const blob = [d.subject, d.previewText, d.html, d.text].join('\n')
    expect(blob).not.toMatch(/leak@example\.com/)
    expect(blob).not.toMatch(/u-should-not-leak/)
    expect(blob).not.toMatch(/"email"|"user_id"|"token"/i)
    expect(blob).not.toMatch(/shhh/)
  })
})
