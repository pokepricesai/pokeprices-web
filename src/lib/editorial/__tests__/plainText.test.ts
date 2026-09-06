// src/lib/editorial/__tests__/plainText.test.ts
//
// EIC Block 3 — plain-text extraction from every body_json shape the
// public renderer supports.

import { describe, it, expect } from 'vitest'
import { bodyJsonToPlainText, normaliseSetName, tokeniseForSearch } from '../plainText'

describe('bodyJsonToPlainText', () => {
  it('returns empty string for null / undefined / random junk', () => {
    expect(bodyJsonToPlainText(null)).toBe('')
    expect(bodyJsonToPlainText(undefined)).toBe('')
    expect(bodyJsonToPlainText(42)).toBe('')
    expect(bodyJsonToPlainText({})).toBe('')
  })

  it('handles { blocks: [] }', () => {
    expect(bodyJsonToPlainText({ blocks: [] })).toBe('')
  })

  it('handles a bare array (legacy shape)', () => {
    const body = [{ type: 'paragraph', text: 'Hello there.' }]
    expect(bodyJsonToPlainText(body)).toBe('Hello there.')
  })

  it('extracts heading + paragraph text in order', () => {
    const body = {
      blocks: [
        { type: 'heading', text: 'Why grading matters' },
        { type: 'paragraph', text: 'Because PSA 10s command a premium.' },
      ],
    }
    expect(bodyJsonToPlainText(body)).toBe('Why grading matters Because PSA 10s command a premium.')
  })

  it('handles rich paragraph segments (bold + link)', () => {
    const body = {
      blocks: [{
        type: 'paragraph',
        content: [
          { text: 'The ' },
          { text: 'Base Set Charizard', bold: true, href: '/set/Base%20Set/card/x' },
          { text: ' still matters.' },
        ],
      }],
    }
    expect(bodyJsonToPlainText(body)).toBe('The Base Set Charizard still matters.')
  })

  it('extracts image captions but skips images without them', () => {
    const body = {
      blocks: [
        { type: 'image', src: 'https://x/y.png', alt: 'decorative', decorative: true },
        { type: 'image', src: 'https://x/y.png', alt: 'a', caption: 'PSA 10 population reference.' },
      ],
    }
    expect(bodyJsonToPlainText(body)).toBe('PSA 10 population reference.')
  })

  it('extracts headings from card_grid and titles/descriptions from chart', () => {
    const body = {
      blocks: [
        { type: 'card_grid', heading: 'Top movers this week', card_slugs: ['pc-1'] },
        { type: 'chart', title: '90-day price', description: 'A quiet climb.' },
      ],
    }
    expect(bodyJsonToPlainText(body)).toBe('Top movers this week 90-day price A quiet climb.')
  })

  it('respects maxChars with an ellipsis', () => {
    const body = { blocks: [{ type: 'paragraph', text: 'x'.repeat(200) }] }
    const out = bodyJsonToPlainText(body, { maxChars: 50 })
    expect(out.length).toBe(51) // 50 chars + '…'
    expect(out.endsWith('…')).toBe(true)
  })

  it('degrades gracefully on unknown block types (best-effort text)', () => {
    const body = {
      blocks: [
        { type: 'quote', text: 'A wise thing.' },
        { type: 'callout', body: 'A callout body string.' },
      ],
    }
    // 'text' is handled explicitly; 'body' comes through the "unknown types" scoop.
    expect(bodyJsonToPlainText(body)).toContain('A wise thing.')
    expect(bodyJsonToPlainText(body)).toContain('A callout body string.')
  })

  it('never throws on malformed blocks', () => {
    const body = { blocks: [null, 1, 'raw string ok', { text: 42 }] }
    expect(() => bodyJsonToPlainText(body)).not.toThrow()
    expect(bodyJsonToPlainText(body)).toContain('raw string ok')
  })
})

describe('normaliseSetName', () => {
  it('strips "Mega Evolution -" prefix', () => {
    expect(normaliseSetName('Mega Evolution - Chaos Rising')).toBe('chaos rising')
    expect(normaliseSetName('Mega Evolution — Perfect Order')).toBe('perfect order')
    expect(normaliseSetName('Mega Evolution : Ascended Heroes')).toBe('ascended heroes')
  })
  it('strips "Japanese " prefix', () => {
    expect(normaliseSetName('Japanese Abyss Eye')).toBe('abyss eye')
    expect(normaliseSetName('Japanese Ninja Spinner')).toBe('ninja spinner')
  })
  it('collapses whitespace and lowercases', () => {
    expect(normaliseSetName('  Ascended    Heroes  ')).toBe('ascended heroes')
  })
  it('is safe on empty / null / undefined', () => {
    expect(normaliseSetName('')).toBe('')
    expect(normaliseSetName(undefined as any)).toBe('')
  })
})

describe('tokeniseForSearch', () => {
  it('lowercases, splits on non-word, drops short tokens and pure numbers', () => {
    expect(tokeniseForSearch('PSA 10 vs PSA 9: What Actually Matters?')).toEqual([
      'psa', 'vs', 'psa', 'what', 'actually', 'matters',
    ])
  })
  it('handles empty input', () => {
    expect(tokeniseForSearch('')).toEqual([])
  })
})
