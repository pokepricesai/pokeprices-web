// src/lib/editorial/writer/__tests__/sanitizeCitations.test.ts
//
// Tests for the deterministic web-search citation stripper.
// Sanitizer must:
//   * strip <cite>, (cite, escaped variants, multi-index tags
//   * leave inner text intact
//   * leave normal Markdown links unchanged
//   * be applied by both parsers (research_and_write + check_and_fix)

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import { stripCitationMarkup } from '../sanitizeCitations'
import { parseResearchAndWriteResponse } from '../researchAndWrite'
import { parseCheckAndFixResponse } from '../checkAndFix'

// ─────────────────────────────────────────────────────────────────
// stripCitationMarkup — unit
// ─────────────────────────────────────────────────────────────────

describe('stripCitationMarkup', () => {
  it('removes a standard paren-form cite tag while preserving inner text', () => {
    const md = '(cite index="29-7">Every pack contains a Pokémon card</cite>'
    expect(stripCitationMarkup(md)).toBe('Every pack contains a Pokémon card')
  })

  it('removes an angle-bracket cite tag', () => {
    const md = '<cite index="21-14">the anniversary release</cite>'
    expect(stripCitationMarkup(md)).toBe('the anniversary release')
  })

  it('removes multi-index tags such as (cite index="21-14,21-15">', () => {
    const md = '(cite index="21-14,21-15">both sources agree on this</cite>'
    expect(stripCitationMarkup(md)).toBe('both sources agree on this')
  })

  it('removes Markdown-escaped tags: \\(cite ...\\> ... \\</cite\\>', () => {
    const md = '\\(cite index="29-7"\\>escaped opening + close\\</cite\\>'
    expect(stripCitationMarkup(md)).toBe('escaped opening + close')
  })

  it('handles cite tags scattered inside a paragraph', () => {
    const md = 'The set is (cite index="1-1">officially announced</cite>, and (cite index="2-4">preorders are live</cite> at TCGplayer.'
    expect(stripCitationMarkup(md)).toBe('The set is officially announced, and preorders are live at TCGplayer.')
  })

  it('handles multi-line inner content', () => {
    const md = '(cite index="1-1">line one\nline two\nline three</cite>'
    expect(stripCitationMarkup(md)).toBe('line one\nline two\nline three')
  })

  it('leaves normal Markdown links unchanged', () => {
    const md = 'See the [official announcement](https://www.pokemon.com/us/celebration) for details.'
    expect(stripCitationMarkup(md)).toBe(md)
  })

  it('leaves prose containing the word "cite" outside a tag unchanged', () => {
    const md = 'Collectors often cite the anniversary Pikachu illustrations as the hook.'
    expect(stripCitationMarkup(md)).toBe(md)
  })

  it('leaves headings, paragraphs, and list markers untouched', () => {
    const md = '## Heading\n\nParagraph.\n\n- Bullet\n- Bullet with (cite index="1-1">a cite</cite> inside it'
    expect(stripCitationMarkup(md)).toBe('## Heading\n\nParagraph.\n\n- Bullet\n- Bullet with a cite inside it')
  })

  it('does not match a word like "<citefoo>" (word boundary required)', () => {
    const md = 'A tag like <citefoo>should stay</citefoo> as-is.'
    expect(stripCitationMarkup(md)).toBe(md)
  })

  it('handles empty and falsy input safely', () => {
    expect(stripCitationMarkup('')).toBe('')
    expect(stripCitationMarkup(null as any)).toBeNull()
    expect(stripCitationMarkup(undefined as any)).toBeUndefined()
  })

  it('strips citations from title/heading strings too', () => {
    expect(stripCitationMarkup('The Set (cite index="1-1">confirmed</cite> for release'))
      .toBe('The Set confirmed for release')
  })
})

// ─────────────────────────────────────────────────────────────────
// Integration — research_and_write parser strips citations
// ─────────────────────────────────────────────────────────────────

describe('parseResearchAndWriteResponse strips citation markup', () => {
  it('strips from bodyMarkdown when returned inside JSON', () => {
    const raw = '```json\n' + JSON.stringify({
      title: 'Celebration Set',
      metaTitle: 'Celebration Set',
      metaDescription: 'Everything collectors need to know.',
      bodyMarkdown: '## What It Is\n\nThe (cite index="21-14">30th Celebration set</cite> is confirmed.\n\nSee [the official page](https://pokemon.com/x) for more.',
      sources: [{ url: 'https://pokemon.com/x' }],
    }) + '\n```'
    const parsed = parseResearchAndWriteResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.bodyMarkdown).not.toMatch(/cite\s+index/i)
    expect(parsed!.bodyMarkdown).toContain('The 30th Celebration set is confirmed.')
    // Normal Markdown link preserved
    expect(parsed!.bodyMarkdown).toContain('[the official page](https://pokemon.com/x)')
  })

  it('strips from title, metaTitle, and metaDescription', () => {
    const raw = '```json\n' + JSON.stringify({
      title: 'The (cite index="1-1">Anniversary Set</cite>',
      metaTitle: 'Anniversary (cite index="1-1">Set</cite>',
      metaDescription: '(cite index="1-1">Everything collectors need</cite> to know.',
      bodyMarkdown: '## H\n\nClean body prose.',
      sources: [],
    }) + '\n```'
    const parsed = parseResearchAndWriteResponse(raw)
    expect(parsed!.title).toBe('The Anniversary Set')
    expect(parsed!.metaTitle).toBe('Anniversary Set')
    expect(parsed!.metaDescription).toBe('Everything collectors need to know.')
  })

  it('strips from salvaged plain Markdown response too', () => {
    const raw = '# The Anniversary Set\n\nOpening (cite index="21-14">officially announced</cite> paragraph long enough to serve as usable prose for a collector article about the set.\n\n## Details\n\nMore prose here with plenty of detail to survive the length check.'
    const parsed = parseResearchAndWriteResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.salvaged).toBe(true)
    expect(parsed!.bodyMarkdown).not.toMatch(/cite\s+index/i)
    expect(parsed!.bodyMarkdown).toContain('Opening officially announced paragraph')
  })
})

// ─────────────────────────────────────────────────────────────────
// Integration — check_and_fix parser strips citations
// (i.e. the checker cannot reintroduce them)
// ─────────────────────────────────────────────────────────────────

describe('parseCheckAndFixResponse strips citation markup', () => {
  it('strips citations even when the checker reintroduces them', () => {
    const raw = '```json\n' + JSON.stringify({
      title: 'Celebration Set',
      metaTitle: 'Celebration Set',
      metaDescription: 'What collectors need to know.',
      bodyMarkdown: '## What It Is\n\nThe set is (cite index="29-7">officially announced</cite> — corrected from the leak-based date.\n\nSee [pokemon.com](https://pokemon.com/x).',
      sources: [{ url: 'https://pokemon.com/x' }],
      correctionsSummary: 'Fixed release date per official source.',
    }) + '\n```'
    const parsed = parseCheckAndFixResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.bodyMarkdown).not.toMatch(/cite\s+index/i)
    expect(parsed!.bodyMarkdown).toContain('The set is officially announced')
    expect(parsed!.bodyMarkdown).toContain('[pokemon.com](https://pokemon.com/x)')
    // correctionsSummary preserved verbatim (no cite markup in it)
    expect(parsed!.correctionsSummary).toContain('Fixed release date')
  })

  it('strips escaped and multi-index cite tags in the checker output', () => {
    const raw = '```json\n' + JSON.stringify({
      title: 'T', metaTitle: 'T', metaDescription: 'D',
      bodyMarkdown: 'Line A \\(cite index="1-1"\\>escaped\\</cite\\>. Line B (cite index="21-14,21-15">multi-index</cite>.',
      sources: [],
      correctionsSummary: 'No changes needed.',
    }) + '\n```'
    const parsed = parseCheckAndFixResponse(raw)
    expect(parsed!.bodyMarkdown).not.toMatch(/cite/i)
    expect(parsed!.bodyMarkdown).toContain('Line A escaped')
    expect(parsed!.bodyMarkdown).toContain('Line B multi-index')
  })
})
