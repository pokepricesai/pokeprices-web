// Block 5A-W-4 — pure email digest builder.
// Covers subject/preview/html/text shape, severity grouping, rule
// branches, sample banner + subject prefix, no PII in the rendered
// output.

import { describe, it, expect } from 'vitest'
import {
  buildEmailDigest,
  buildSampleEvents,
  cardPriorityScore,
  dedupeEventsPerCardRule,
  groupEventsByCard,
  sortCardBlocksByPriority,
  type DigestCardBlock,
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

  it('prefixes [TEST] when test=true', () => {
    const d = buildEmailDigest([ev({})], { test: true })
    expect(d.subject.startsWith('[TEST] ')).toBe(true)
    expect(d.subject).not.toContain('[SAMPLE]')
  })

  it('stacks [TEST] [SAMPLE] in that order when both flags are set', () => {
    const d = buildEmailDigest(buildSampleEvents(), { test: true, sample: true })
    expect(d.subject.startsWith('[TEST] [SAMPLE] ')).toBe(true)
  })

  it('uses the empty-state subject when test=true and there are no events', () => {
    const d = buildEmailDigest([], { test: true })
    expect(d.subject).toBe('[TEST] Your PokePrices alert digest')
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
    // Block 5A-W-18 — footer now points at the unified Watchlist &
    // Alerts surface; reason copy and link label updated in lockstep.
    expect(d.html).toMatch(/You are receiving this because alerts are enabled for your Watchlist &amp; Alerts/)
    expect(d.html).toMatch(/href="https:\/\/www\.pokeprices\.io\/dashboard\/watchlist-alerts"[^>]*>Manage Watchlist &amp; Alerts<\/a>/)
    // The HTML contains the PokePrices wordmark at least twice (header + footer).
    expect((d.html.match(/PokePrices/g) ?? []).length).toBeGreaterThanOrEqual(2)

    // Plain text mirrors the structure.
    expect(d.text).toMatch(/You are receiving this because alerts are enabled for your Watchlist & Alerts/)
    expect(d.text).toMatch(/Manage Watchlist & Alerts at https:\/\/www\.pokeprices\.io\/dashboard\/watchlist-alerts/)
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

// ─────────────────────────────────────────────────────────────────────
// Block 5A-W-11 — card-first grouping helpers + renderer behaviour
// ─────────────────────────────────────────────────────────────────────

describe('groupEventsByCard', () => {
  it('collapses multiple events on the same cardSlug into one block', () => {
    const blocks = groupEventsByCard([
      ev({ cardSlug: '1', cardName: 'A', setName: 'S', rule: 'raw_change',   severity: 'high'   }),
      ev({ cardSlug: '1', cardName: 'A', setName: 'S', rule: 'psa10_change', severity: 'normal' }),
      ev({ cardSlug: '1', cardName: 'A', setName: 'S', rule: 'recent_sales', severity: 'normal' }),
    ])
    expect(blocks).toHaveLength(1)
    expect(blocks[0].cardSlug).toBe('1')
    expect(blocks[0].events).toHaveLength(3)
  })

  it('falls back to cardName|setName when cardSlug is missing', () => {
    const blocks = groupEventsByCard([
      ev({ cardName: 'X', setName: 'S', rule: 'raw_change' }),
      ev({ cardName: 'X', setName: 'S', rule: 'recent_sales' }),
      ev({ cardName: 'Y', setName: 'S', rule: 'raw_change' }),
    ])
    expect(blocks).toHaveLength(2)
    const xBlock = blocks.find(b => b.cardName === 'X') as DigestCardBlock
    expect(xBlock.events).toHaveLength(2)
  })

  it('lifts the block severity to the max of any event on the card', () => {
    const blocks = groupEventsByCard([
      ev({ cardSlug: '1', severity: 'low'    }),
      ev({ cardSlug: '1', severity: 'high'   }),
      ev({ cardSlug: '1', severity: 'normal' }),
    ])
    expect(blocks[0].severity).toBe('high')
  })

  it('orders events within a card by rule priority (price changes first)', () => {
    const blocks = groupEventsByCard([
      ev({ cardSlug: '1', rule: 'recent_sales' }),
      ev({ cardSlug: '1', rule: 'spread_change' }),
      ev({ cardSlug: '1', rule: 'raw_change' }),
    ])
    expect(blocks[0].events.map(e => e.rule)).toEqual(['raw_change', 'spread_change', 'recent_sales'])
  })

  it('preserves the first non-empty cardUrl seen for the block', () => {
    const blocks = groupEventsByCard([
      ev({ cardSlug: '1' }),
      ev({ cardSlug: '1', cardUrl: 'https://example.com/x' }),
    ])
    expect(blocks[0].cardUrl).toBe('https://example.com/x')
  })
})

describe('cardPriorityScore / sortCardBlocksByPriority', () => {
  function block(over: Partial<DigestCardBlock>): DigestCardBlock {
    return {
      key: 'k', cardName: 'C', setName: 'S',
      severity: 'normal', events: [],
      ...over,
    }
  }
  it('ranks high-severity blocks above normal-severity blocks', () => {
    const a = block({ key: 'a', severity: 'high',   events: [ev({ rule: 'raw_change', severity: 'high',   payload: { pct: 5 } })] })
    const b = block({ key: 'b', severity: 'normal', events: [ev({ rule: 'raw_change', severity: 'normal', payload: { pct: 50 } })] })
    expect(cardPriorityScore(a)).toBeGreaterThan(cardPriorityScore(b))
    expect(sortCardBlocksByPriority([b, a]).map(x => x.key)).toEqual(['a', 'b'])
  })

  it('ranks price-change rules over spread / activity within the same severity', () => {
    const a = block({ key: 'a', events: [ev({ rule: 'raw_change',    severity: 'normal', payload: { pct: 10 } })] })
    const b = block({ key: 'b', events: [ev({ rule: 'spread_change', severity: 'normal', payload: { pct: 10 } })] })
    const c = block({ key: 'c', events: [ev({ rule: 'recent_sales',  severity: 'normal', payload: { recent_active_count: 5 } })] })
    expect(sortCardBlocksByPriority([c, b, a]).map(x => x.key)).toEqual(['a', 'b', 'c'])
  })

  it('breaks ties by largest payload magnitude', () => {
    const small = block({ key: 'small', events: [ev({ rule: 'raw_change', severity: 'normal', payload: { pct: 5 } })] })
    const big   = block({ key: 'big',   events: [ev({ rule: 'raw_change', severity: 'normal', payload: { pct: 40 } })] })
    expect(sortCardBlocksByPriority([small, big]).map(x => x.key)).toEqual(['big', 'small'])
  })
})

describe('buildEmailDigest — card-first rendering', () => {
  it('renders one card block with bulleted reasons when a card has multiple events', () => {
    const d = buildEmailDigest([
      ev({ cardSlug: '1', cardName: 'Raichu', setName: 'Gym', rule: 'raw_change',   severity: 'high',
           payload: { old: 12500, new: 16875, pct: 35 } }),
      ev({ cardSlug: '1', cardName: 'Raichu', setName: 'Gym', rule: 'recent_sales', severity: 'normal',
           payload: { recent_active_count: 4, window_days: 7 } }),
    ])
    // Card name appears once in the HTML body; both reason labels show up.
    const heading = d.html.match(/Raichu/g) ?? []
    // It may appear in subject too, but the body should have ONE card heading
    // and TWO list items.
    expect(heading.length).toBeGreaterThanOrEqual(1)
    expect(d.html).toMatch(/Raw price changed/)
    expect(d.html).toMatch(/Fresh sales landed/)
    // The HTML wraps reasons in <ul>…<li>; assert at least two list items.
    const listItems = d.html.match(/<li\b/g) ?? []
    expect(listItems.length).toBeGreaterThanOrEqual(2)
  })

  it('mirrors the card-first structure in plain text — one card line, multiple reason lines indented', () => {
    const d = buildEmailDigest([
      ev({ cardSlug: '1', cardName: 'Raichu', setName: 'Gym', rule: 'raw_change',   severity: 'high',
           payload: { old: 12500, new: 16875, pct: 35 } }),
      ev({ cardSlug: '1', cardName: 'Raichu', setName: 'Gym', rule: 'recent_sales', severity: 'normal',
           payload: { recent_active_count: 4, window_days: 7 } }),
    ])
    // One "* Raichu" card line, two "    - " indented reason lines.
    expect(d.text).toMatch(/\* Raichu \(Gym\)/)
    const reasonLines = d.text.split('\n').filter(l => l.startsWith('    - '))
    expect(reasonLines.length).toBe(2)
    expect(reasonLines[0]).toMatch(/Raw price changed/)
    expect(reasonLines[1]).toMatch(/Fresh sales landed/)
  })

  it('keeps single-event-per-card cards rendering normally with one bullet', () => {
    const d = buildEmailDigest([ev({ cardSlug: '1', cardName: 'Pikachu' })])
    const listItems = d.html.match(/<li\b/g) ?? []
    expect(listItems.length).toBe(1)
  })
})

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

// ─────────────────────────────────────────────────────────────────────
// Block 5A-W-20 — pluralisation
// ─────────────────────────────────────────────────────────────────────

describe('reasonText — pluralisation (Block 5A-W-20)', () => {
  it('renders "1 new verified sale" (singular) for a count of 1', () => {
    const d = buildEmailDigest([ev({ rule: 'recent_sales', payload: { recent_active_count: 1, window_days: 7 } })])
    expect(d.text).toMatch(/1 new verified sale in the last 7 days/)
    expect(d.text).not.toMatch(/1 new verified sales/)
  })

  it('renders "2 new verified sales" (plural) for a count of 2', () => {
    const d = buildEmailDigest([ev({ rule: 'recent_sales', payload: { recent_active_count: 2, window_days: 7 } })])
    expect(d.text).toMatch(/2 new verified sales in the last 7 days/)
  })

  it('renders "1 verified sale in the last 14 days" for market_activity', () => {
    const d = buildEmailDigest([ev({ rule: 'market_activity', payload: { active_count: 1, window_days: 14 } })])
    expect(d.text).toMatch(/1 verified sale in the last 14 days/)
    expect(d.text).not.toMatch(/1 verified sales/)
  })

  it('singularises the day word too: "1 verified sale in the last 1 day"', () => {
    const d = buildEmailDigest([ev({ rule: 'market_activity', payload: { active_count: 1, window_days: 1 } })])
    expect(d.text).toMatch(/1 verified sale in the last 1 day/)
    expect(d.text).not.toMatch(/1 day s/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Block 5A-W-20 — threshold-aware copy
// ─────────────────────────────────────────────────────────────────────

describe('reasonText — threshold suffix (Block 5A-W-20)', () => {
  it('appends "above your N% alert threshold" when payload has threshold metadata', () => {
    const d = buildEmailDigest([ev({
      rule: 'raw_change',
      payload: { old: 1000, new: 1167, pct: 16.7, threshold_source: 'global', threshold_pct: 15, direction: 'rise' },
    })])
    expect(d.text).toMatch(/above your 15% alert threshold/)
  })

  it('appends threshold suffix for override-source payloads too', () => {
    const d = buildEmailDigest([ev({
      rule: 'raw_change',
      payload: { old: 1000, new: 800, pct: -20, threshold_source: 'override', threshold_pct: 10, direction: 'drop' },
    })])
    expect(d.text).toMatch(/above your 10% alert threshold/)
  })

  it('does NOT append the suffix for legacy payloads (no threshold metadata)', () => {
    const d = buildEmailDigest([ev({
      rule: 'raw_change',
      payload: { old: 1000, new: 1200, pct: 20 },
    })])
    expect(d.text).not.toMatch(/alert threshold/)
  })

  it('does NOT append the suffix for sales/activity rules (count-based)', () => {
    const d = buildEmailDigest([ev({
      rule: 'recent_sales',
      payload: { recent_active_count: 5, window_days: 7, threshold_source: 'global' },
    })])
    // Threshold copy is for price-style triggers; sales/activity lines
    // stay clean.
    expect(d.text).not.toMatch(/alert threshold/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Block 5A-W-20 — dedupe + single-block-per-card rendering
// ─────────────────────────────────────────────────────────────────────

describe('dedupeEventsPerCardRule (Block 5A-W-20)', () => {
  it('keeps one event per (card, rule); rolls losers into supersededByWinnerId', () => {
    const events: DigestEvent[] = [
      ev({ id: 'rs1', cardSlug: '1', rule: 'recent_sales',
           payload: { recent_active_count: 37, window_days: 7 },
           detectedAt: '2026-06-24T10:00:00Z' }),
      ev({ id: 'rs2', cardSlug: '1', rule: 'recent_sales',
           payload: { recent_active_count: 41, window_days: 7 },
           detectedAt: '2026-06-25T10:00:00Z' }),
    ]
    const { keptEvents, supersededByWinnerId } = dedupeEventsPerCardRule(events)
    expect(keptEvents).toHaveLength(1)
    expect(keptEvents[0].id).toBe('rs2')
    expect(supersededByWinnerId.get('rs2')).toEqual(['rs1'])
  })

  it('supersededByWinnerId omits the winner key when no loser exists for that rule', () => {
    const events: DigestEvent[] = [
      ev({ id: 'rs1', cardSlug: '1', rule: 'recent_sales',
           payload: { recent_active_count: 41, window_days: 7 } }),
    ]
    const { keptEvents, supersededByWinnerId } = dedupeEventsPerCardRule(events)
    expect(keptEvents).toHaveLength(1)
    expect(supersededByWinnerId.has('rs1')).toBe(false)
  })

  it('renders ONE card block per card even when duplicate events were supplied', () => {
    // Mirrors the user's reported email shape: Charizard with two
    // recent_sales + two market_activity events. After dedupe the
    // card has exactly two lines, not four.
    const events: DigestEvent[] = [
      ev({ id: '1', cardSlug: '1', cardName: 'Charizard #4', setName: 'Base Set',
           rule: 'recent_sales',
           payload: { recent_active_count: 37, window_days: 7 },
           detectedAt: '2026-06-24T10:00:00Z' }),
      ev({ id: '2', cardSlug: '1', cardName: 'Charizard #4', setName: 'Base Set',
           rule: 'recent_sales',
           payload: { recent_active_count: 41, window_days: 7 },
           detectedAt: '2026-06-25T10:00:00Z' }),
      ev({ id: '3', cardSlug: '1', cardName: 'Charizard #4', setName: 'Base Set',
           rule: 'market_activity',
           payload: { active_count: 48, window_days: 14 },
           detectedAt: '2026-06-24T10:00:00Z' }),
      ev({ id: '4', cardSlug: '1', cardName: 'Charizard #4', setName: 'Base Set',
           rule: 'market_activity',
           payload: { active_count: 48, window_days: 14 },
           detectedAt: '2026-06-25T10:00:00Z' }),
    ]
    const { keptEvents } = dedupeEventsPerCardRule(events)
    expect(keptEvents).toHaveLength(2)
    const ruleSet = new Set(keptEvents.map(e => e.rule))
    expect(ruleSet.has('recent_sales')).toBe(true)
    expect(ruleSet.has('market_activity')).toBe(true)
    // Winners: rs2 (count 41 beats 37), ma2 (tied on count → latest wins).
    const ids = new Set(keptEvents.map(e => e.id))
    expect(ids.has('2')).toBe(true)
    expect(ids.has('4')).toBe(true)
  })
})
