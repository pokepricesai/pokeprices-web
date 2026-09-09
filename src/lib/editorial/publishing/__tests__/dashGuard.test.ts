// src/lib/editorial/publishing/__tests__/dashGuard.test.ts
//
// Deterministic em/en dash cleanup — the last-line safety net that
// runs on the finalised insights payload immediately before it is
// written to the database. These tests lock down the invariants
// spelled out in the change spec:
//
//   * No em dash (—, U+2014) or en dash (–, U+2013) ever reaches the
//     published body prose, headline, intro, or SEO fields.
//   * Ordinary hyphens in compound words are LEFT ALONE.
//   * URLs are LEFT ALONE — the guard never corrupts a link href.
//   * Applied to the shape produced by studioDocumentToInsightBody.

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import {
  stripDashesFromText,
  stripDashesFromInsightBody,
  stripDashesFromMarkdown,
  containsAnyDash,
  findDashInBody,
} from '../dashGuard'

// ── stripDashesFromText ──────────────────────────────────────────

describe('stripDashesFromText', () => {
  it('passes an untouched string through when there are no dashes', () => {
    const s = 'A normal sentence with 30-year hyphens and first-edition compounds.'
    expect(stripDashesFromText(s)).toBe(s)
  })

  it('replaces " — " (em dash, spaced) with ", "', () => {
    expect(stripDashesFromText('Charizard climbed 12% — collectors piled in.')).toBe('Charizard climbed 12%, collectors piled in.')
  })

  it('rewrites bare-numeric en dash ranges as " to " instead of commas', () => {
    expect(stripDashesFromText('900–1300 words')).toBe('900 to 1300 words')
  })

  it('replaces multiple non-range dashes in the same string with commas', () => {
    expect(stripDashesFromText('one — two – three — four'))
      .toBe('one, two, three, four')
  })

  // ── Numeric range handling ─────────────────────────────────────
  //
  // En dashes between two numeric-ish tokens are ranges — replacing
  // them with commas produced nonsense like "1996, 2026" or "$50, $100".
  // The guard rewrites them as " to " so the finished prose stays
  // readable. Em dashes never mean "range" and continue to become ", ".

  it('rewrites a year range as " to "', () => {
    expect(stripDashesFromText('The set spans 1996–2026 for the anniversary.')).toBe('The set spans 1996 to 2026 for the anniversary.')
  })

  it('rewrites a currency range as " to "', () => {
    expect(stripDashesFromText('Chase cards sit in the $50–$100 band.')).toBe('Chase cards sit in the $50 to $100 band.')
  })

  it('rewrites a small quantity range as " to "', () => {
    expect(stripDashesFromText('Grade 5–10 cards a session.')).toBe('Grade 5 to 10 cards a session.')
  })

  it('rewrites a percent range as " to "', () => {
    expect(stripDashesFromText('Premiums of 12%–15% held steady.')).toBe('Premiums of 12% to 15% held steady.')
  })

  it('rewrites a shorthand-unit range as " to " ($5k–$10k, 1M–2M)', () => {
    expect(stripDashesFromText('Prices moved from $5k–$10k range.')).toBe('Prices moved from $5k to $10k range.')
    expect(stripDashesFromText('Population between 1M–2M copies.')).toBe('Population between 1M to 2M copies.')
  })

  it('tolerates surrounding whitespace around a range en dash', () => {
    expect(stripDashesFromText('1996 – 2026 covered the whole span.')).toBe('1996 to 2026 covered the whole span.')
  })

  it('applies range rewriting FIRST, then converts remaining prose dashes to commas', () => {
    expect(stripDashesFromText('From 1996–2026 the market grew — steadily.')).toBe('From 1996 to 2026 the market grew, steadily.')
  })

  it('does NOT rewrite an em dash between numbers as "to" (em dashes are prose, not ranges)', () => {
    // "1996 — 2026" is ambiguous but em dashes are almost always
    // prose (parenthetical). Keep the safe comma substitution.
    expect(stripDashesFromText('The Base Set launched in 1996 — 30 years later, the anniversary set arrived.'))
      .toBe('The Base Set launched in 1996, 30 years later, the anniversary set arrived.')
  })

  it('preserves hyphens inside compound words', () => {
    const s = 'The 30-year, first-edition, high-value example.'
    expect(stripDashesFromText(s)).toBe(s)
  })

  it('collapses stray double commas that substitution can produce', () => {
    expect(stripDashesFromText('word, — next')).toBe('word, next')
  })

  it('collapses ", ." into "." at sentence boundary', () => {
    expect(stripDashesFromText('a phrase —.')).toBe('a phrase.')
  })

  it('trims a trailing comma left after substitution', () => {
    expect(stripDashesFromText('finished —')).toBe('finished')
  })
})

// ── stripDashesFromMarkdown ──────────────────────────────────────

describe('stripDashesFromMarkdown', () => {
  it('cleans prose while leaving link URLs intact', () => {
    const md = 'Read [the guide — updated](https://pokeprices.io/guide) for more.'
    const out = stripDashesFromMarkdown(md)
    expect(out).toContain('https://pokeprices.io/guide')  // URL untouched
    expect(out).not.toMatch(/—|–/)                        // dashes gone from prose
    expect(out).toContain('the guide, updated')
  })

  it('does NOT touch URLs even when they contain unusual characters', () => {
    const md = 'Source: [PokéBeach](https://pokebeach.com/some—weird—url)'
    const out = stripDashesFromMarkdown(md)
    expect(out).toContain('https://pokebeach.com/some—weird—url')
  })

  it('is a no-op when the input has no dashes', () => {
    const md = 'Plain [text](https://example.com) with 30-year compound.'
    expect(stripDashesFromMarkdown(md)).toBe(md)
  })
})

// ── stripDashesFromInsightBody ───────────────────────────────────

describe('stripDashesFromInsightBody', () => {
  it('strips dashes from paragraph text', () => {
    const body = { blocks: [{ type: 'paragraph', content: [{ text: 'One — two – three' }] }] }
    const out = stripDashesFromInsightBody(body) as any
    expect(out.blocks[0].content[0].text).toBe('One, two, three')
  })

  it('strips dashes from heading text', () => {
    const body = { blocks: [{ type: 'heading', text: 'History — of Pikachu' }] }
    const out = stripDashesFromInsightBody(body) as any
    expect(out.blocks[0].text).toBe('History, of Pikachu')
  })

  it('strips dashes inside list items', () => {
    const body = { blocks: [{ type: 'list', items: [[{ text: 'item — one' }], [{ text: 'item – two' }]] }] }
    const out = stripDashesFromInsightBody(body) as any
    expect(out.blocks[0].items[0][0].text).toBe('item, one')
    expect(out.blocks[0].items[1][0].text).toBe('item, two')
  })

  it('does NOT touch data-block payloads (opaque market data + slugs)', () => {
    const body = { blocks: [{ type: 'dataBlock', attrs: { variant: 'card_block', payload: { card: { cardSlug: 'first-edition-charizard', cardName: 'Charizard' } } } }] }
    const out = stripDashesFromInsightBody(body) as any
    expect(out.blocks[0].attrs.payload.card.cardSlug).toBe('first-edition-charizard')
  })

  it('returns undefined/null passthrough safely', () => {
    expect(stripDashesFromInsightBody(null)).toBeNull()
    expect(stripDashesFromInsightBody(undefined)).toBeUndefined()
  })
})

// ── Detection helpers ────────────────────────────────────────────

describe('containsAnyDash / findDashInBody', () => {
  it('detects a bare em dash', () => { expect(containsAnyDash('x — y')).toBe(true) })
  it('detects a bare en dash', () => { expect(containsAnyDash('x – y')).toBe(true) })
  it('rejects an ordinary hyphen', () => { expect(containsAnyDash('30-year')).toBe(false) })

  it('surfaces the first offending fragment from a body', () => {
    const body = { blocks: [
      { type: 'paragraph', content: [{ text: 'clean prose' }] },
      { type: 'paragraph', content: [{ text: 'this — is bad' }] },
    ] }
    expect(findDashInBody(body)).toMatch(/this/)
  })

  it('returns null when the body is clean', () => {
    const body = { blocks: [{ type: 'paragraph', content: [{ text: 'clean 30-year compound' }] }] }
    expect(findDashInBody(body)).toBeNull()
  })
})

// ── Roundtrip: nothing left after cleanup ────────────────────────

describe('roundtrip guarantee', () => {
  it('containsAnyDash is FALSE for every output of stripDashesFromText', () => {
    const samples = [
      'one — two',
      'first – second',
      'word — mid — end',
      '30-year, first-edition, high-value',   // ordinary hyphens
      'em—dash smashed together',              // no surrounding whitespace
      'ends with a dash —',
      'plain text',
    ]
    for (const s of samples) {
      expect(containsAnyDash(stripDashesFromText(s))).toBe(false)
    }
  })

  it('findDashInBody is null after stripDashesFromInsightBody', () => {
    const body = { blocks: [
      { type: 'heading',   text: 'One — heading' },
      { type: 'paragraph', content: [{ text: 'lead – in' }, { text: ' further — comment' }] },
      { type: 'list',      items: [[{ text: 'a — b' }], [{ text: 'c – d' }]] },
    ] }
    const out = stripDashesFromInsightBody(body) as any
    expect(findDashInBody(out)).toBeNull()
  })
})
