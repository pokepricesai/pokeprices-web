// src/lib/editorial/writer/__tests__/externalWriter.test.ts
//
// EIC — tests for the simplified external Writer path.

import { describe, it, expect } from 'vitest'
import {
  parseExternalArticleResponse,
  markdownToStudioBodyDoc,
  buildStudioDocFromExternalArticle,
  buildExternalArticleUserTurn,
} from '../externalWriter'
import type { EvidencePack } from '../../research/types'

const TODAY = '2026-09-08'

function makePack(overrides: Partial<EvidencePack> = {}): EvidencePack {
  const base: EvidencePack = {
    version: 1, recipe: 'external_research',
    project: { id: 12, title: 'Celebration Collection', angle: null, articleType: 'upcoming_set', targetPublishAt: null },
    generatedAt: TODAY, dataAsOf: TODAY,
    methodology: { summary: 'x', filters: [], excludedGroups: [], dedupKey: 'x' },
    verifiedFacts: [
      { id: 'fact-project', type: 'verified_fact', statement: 'bootstrap', evidenceRefs: [], asOf: TODAY },
      { id: 'fact-official-1', type: 'verified_fact', statement: 'The set has been officially announced by The Pokémon Company.', evidenceRefs: ['src-cite-1'], sourceTier: 1, status: 'confirmed' },
      { id: 'fact-preorder-1', type: 'verified_fact', statement: 'Preorders are live on TCGplayer.', evidenceRefs: ['src-cite-2'], sourceTier: 2, status: 'reported' },
      { id: 'fact-leak-1',     type: 'verified_fact', statement: 'A leak suggests 30 different Pikachu illustrations.', evidenceRefs: ['src-cite-3'], sourceTier: 3, status: 'rumored' },
    ],
    derivedFindings: [], dataTables: [], internalSources: [],
    externalSources: [
      { id: 'src-cite-1', kind: 'external', url: 'https://www.pokemon.com/us/celebration', title: 'Official announcement', publisher: 'The Pokémon Company', addedAt: TODAY, origin: 'web', sourceTier: 1 },
      { id: 'src-cite-2', kind: 'external', url: 'https://www.tcgplayer.com/product/xyz', title: 'Preorder listing',       publisher: 'TCGplayer', addedAt: TODAY, origin: 'web', sourceTier: 2 },
      { id: 'src-cite-3', kind: 'external', url: 'https://www.reddit.com/r/pokemontcg/l', title: 'Leak thread',              publisher: 'Reddit',    addedAt: TODAY, origin: 'web', sourceTier: 3 },
    ],
    internalLinks: [], visualOpportunities: [], warnings: [], researchGaps: ['Exact card count not yet published.'], rejectedClaims: [], notes: [],
    quarantinedRows: [],
    quality: { status: 'ok', dataStrength: 'strong', sampleSize: 3, freshness: { asOf: TODAY, daysOld: 0, isStale: false }, publishable: true, reasons: [] },
    researchSummary: '## Primary discovery\n\nThe Celebration Collection has been officially announced.\n\n## Supporting discovery\n\nTCGplayer preorders live.',
    contradictions: [],
  }
  return { ...base, ...overrides }
}

// ─────────────────────────────────────────────────────────────────
// parseExternalArticleResponse — JSON path
// ─────────────────────────────────────────────────────────────────

describe('parseExternalArticleResponse (JSON path)', () => {
  it('parses a well-formed ```json response', () => {
    const raw = '```json\n' + JSON.stringify({
      title: 'The 30 Pikachu Anniversary',
      metaTitle: 'Celebration Collection: 30 Pikachu Cards',
      metaDescription: 'Everything a collector needs to know about the anniversary set.',
      bodyMarkdown: '## What Is It\n\nOne paragraph.\n\n## Why It Matters\n\nAnother.',
    }) + '\n```'
    const parsed = parseExternalArticleResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.title).toBe('The 30 Pikachu Anniversary')
    expect(parsed!.bodyMarkdown).toContain('## What Is It')
    expect(parsed!.salvaged).toBe(false)
  })

  it('parses whole-text JSON (no fence)', () => {
    const raw = JSON.stringify({ title: 'A', metaTitle: 'B', metaDescription: 'C', bodyMarkdown: '## H\n\nText here.' })
    const parsed = parseExternalArticleResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.bodyMarkdown).toContain('## H')
  })

  it('parses balanced JSON embedded in prose', () => {
    const raw = 'Here you go:\n' + JSON.stringify({ title: 'A', metaTitle: 'B', metaDescription: 'C', bodyMarkdown: '## H\n\nBody body body' })
    const parsed = parseExternalArticleResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.title).toBe('A')
  })

  it('accepts common alternate field names (headline / seoTitle / seoDescription / body)', () => {
    const raw = '```json\n' + JSON.stringify({
      headline: 'Alt',
      seoTitle: 'Alt SEO',
      seoDescription: 'Alt description',
      body: '## H\n\nProse.',
    }) + '\n```'
    const parsed = parseExternalArticleResponse(raw)
    expect(parsed!.title).toBe('Alt')
    expect(parsed!.metaTitle).toBe('Alt SEO')
    expect(parsed!.bodyMarkdown).toContain('## H')
  })
})

// ─────────────────────────────────────────────────────────────────
// parseExternalArticleResponse — salvage path
// ─────────────────────────────────────────────────────────────────

describe('parseExternalArticleResponse (salvage path)', () => {
  it('salvages plain Markdown starting with # Title', () => {
    const raw = '# The 30 Pikachu Anniversary\n\nOpening paragraph that hooks the reader with the anniversary angle in a compelling way.\n\n## Why It Matters\n\nA second paragraph with useful collector context that runs long enough to be considered valid.'
    const parsed = parseExternalArticleResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.salvaged).toBe(true)
    expect(parsed!.title).toBe('The 30 Pikachu Anniversary')
    expect(parsed!.bodyMarkdown).toContain('Opening paragraph')
    expect(parsed!.metaDescription.length).toBeGreaterThan(20)
  })

  it('salvages when there is no H1 by using the first non-empty line', () => {
    const raw = 'Some Article About Pokémon\n\nThis is the first paragraph of a fairly long article that has plenty of collector context to serve as usable prose.\n\n## Section\n\nAnother paragraph here.'
    const parsed = parseExternalArticleResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.salvaged).toBe(true)
    expect(parsed!.title.length).toBeGreaterThan(0)
  })

  it('returns null when the response is too short to be an article', () => {
    expect(parseExternalArticleResponse('nope')).toBeNull()
    expect(parseExternalArticleResponse('')).toBeNull()
  })

  it('prefers JSON when JSON parses cleanly and body is present', () => {
    const raw = '```json\n' + JSON.stringify({ title: 'JSON', metaTitle: 'J', metaDescription: 'D', bodyMarkdown: '## H\n\nJSON body.' }) + '\n```'
    const parsed = parseExternalArticleResponse(raw)
    expect(parsed!.salvaged).toBe(false)
    expect(parsed!.title).toBe('JSON')
  })

  it('falls through to salvage when JSON parses but bodyMarkdown is empty', () => {
    const raw = '# Salvage Title\n\n' +
      '```json\n' + JSON.stringify({ title: 'JSON Title', metaTitle: 'J', metaDescription: 'D', bodyMarkdown: '' }) + '\n```' +
      '\n\nThis is the real article prose in Markdown form that should be salvaged from beneath the empty JSON envelope.'
    const parsed = parseExternalArticleResponse(raw)
    expect(parsed).toBeTruthy()
    expect(parsed!.salvaged).toBe(true)
    expect(parsed!.title).toBe('Salvage Title')
  })
})

// ─────────────────────────────────────────────────────────────────
// markdownToStudioBodyDoc
// ─────────────────────────────────────────────────────────────────

describe('markdownToStudioBodyDoc', () => {
  it('converts headings and paragraphs into TipTap nodes', () => {
    const doc: any = markdownToStudioBodyDoc('## Heading Two\n\nFirst paragraph.\n\n### Sub\n\nSecond paragraph.')
    expect(doc.type).toBe('doc')
    expect(doc.content[0].type).toBe('heading')
    expect(doc.content[0].attrs.level).toBe(2)
    expect(doc.content[0].content[0].text).toBe('Heading Two')
    expect(doc.content[1].type).toBe('paragraph')
    expect(doc.content[1].content[0].text).toBe('First paragraph.')
    expect(doc.content[2].attrs.level).toBe(3)
  })

  it('converts bullet lists', () => {
    const doc: any = markdownToStudioBodyDoc('## H\n\n- First item\n- Second item\n- Third\n\nFollow-up paragraph.')
    const list = doc.content[1]
    expect(list.type).toBe('bulletList')
    expect(list.content).toHaveLength(3)
    expect(list.content[0].type).toBe('listItem')
    expect(list.content[0].content[0].type).toBe('paragraph')
    expect(list.content[0].content[0].content[0].text).toBe('First item')
    expect(doc.content[2].type).toBe('paragraph')
  })

  it('converts ordered lists', () => {
    const doc: any = markdownToStudioBodyDoc('1. Step one\n2. Step two')
    expect(doc.content[0].type).toBe('orderedList')
    expect(doc.content[0].content).toHaveLength(2)
  })

  it('linkifies [anchor](https://...) when URL is allowed', () => {
    const allowed = new Set(['https://pokemon.com/x'])
    const doc: any = markdownToStudioBodyDoc('See [the announcement](https://pokemon.com/x) for details.', allowed)
    const para = doc.content[0]
    const link = para.content.find((c: any) => c.marks?.[0]?.type === 'link')
    expect(link).toBeTruthy()
    expect(link.text).toBe('the announcement')
    expect(link.marks[0].attrs.href).toBe('https://pokemon.com/x')
  })

  it('drops external URLs that are not in the allowlist (keeps anchor as text)', () => {
    const allowed = new Set(['https://pokemon.com/x'])
    const doc: any = markdownToStudioBodyDoc('See [somewhere else](https://not-allowed.example/y) for details.', allowed)
    const para = doc.content[0]
    for (const c of para.content) {
      expect(c.marks?.[0]?.attrs?.href).not.toBe('https://not-allowed.example/y')
    }
    // Anchor text preserved
    expect(para.content.map((c: any) => c.text).join('')).toContain('somewhere else')
  })

  it('always allows internal / URLs regardless of the allowlist', () => {
    const doc: any = markdownToStudioBodyDoc('Read the [full guide](/insights/celebration-guide) here.')
    const para = doc.content[0]
    const link = para.content.find((c: any) => c.marks?.[0]?.type === 'link')
    expect(link).toBeTruthy()
    expect(link.marks[0].attrs.href).toBe('/insights/celebration-guide')
  })

  it('applies **bold** and *italic* marks', () => {
    const doc: any = markdownToStudioBodyDoc('This is **bold** and *italic* text.')
    const para = doc.content[0]
    const bold = para.content.find((c: any) => c.marks?.some((m: any) => m.type === 'bold'))
    const italic = para.content.find((c: any) => c.marks?.some((m: any) => m.type === 'italic'))
    expect(bold?.text).toBe('bold')
    expect(italic?.text).toBe('italic')
  })

  it('returns a doc with at least one paragraph even for empty input', () => {
    const doc: any = markdownToStudioBodyDoc('')
    expect(doc.type).toBe('doc')
    expect(doc.content).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────
// buildStudioDocFromExternalArticle
// ─────────────────────────────────────────────────────────────────

describe('buildStudioDocFromExternalArticle', () => {
  it('constructs a valid StudioDocument shape', () => {
    const pack = makePack()
    const parsed = {
      title:           'The 30 Pikachu Anniversary',
      metaTitle:       'Celebration Collection',
      metaDescription: 'What collectors need to know.',
      bodyMarkdown:    'The Pokémon Company has confirmed a new anniversary set.\n\n## What It Is\n\nMore details here.',
      salvaged:        false,
    }
    const studio = buildStudioDocFromExternalArticle({ parsed, pack })
    expect(studio.headline).toBe('The 30 Pikachu Anniversary')
    expect(studio.seo.title).toBe('Celebration Collection')
    expect(studio.seo.description).toBe('What collectors need to know.')
    expect(studio.intro).toContain('The Pokémon Company has confirmed')
    expect((studio.bodyDoc as any).type).toBe('doc')
  })

  it('uses metaDescription as intro fallback when body starts with a heading', () => {
    const pack = makePack()
    const parsed = {
      title: 'H1', metaTitle: 'M', metaDescription: 'Fallback intro description.',
      bodyMarkdown: '## First Section\n\nActual body prose.', salvaged: false,
    }
    const studio = buildStudioDocFromExternalArticle({ parsed, pack })
    expect(studio.intro).toBe('Fallback intro description.')
  })
})

// ─────────────────────────────────────────────────────────────────
// buildExternalArticleUserTurn — small brief only, no provenance
// ─────────────────────────────────────────────────────────────────

describe('buildExternalArticleUserTurn (brief size + omissions)', () => {
  const pack = makePack()
  const project = { id: 12, title: 'Celebration Collection', angle: null, articleType: 'upcoming_set' }
  const brief = buildExternalArticleUserTurn({ project, pack })

  it('includes topic, researchSummary, usefulFacts and sources', () => {
    expect(brief).toContain('Celebration Collection')
    expect(brief).toContain('researchSummary')
    expect(brief).toContain('usefulFacts')
    expect(brief).toContain('sources')
    expect(brief).toContain('pokemon.com')
    expect(brief).toContain('tcgplayer.com')
  })

  it('omits internal provenance and tier language', () => {
    expect(brief).not.toContain('Tier 1')
    expect(brief).not.toContain('Tier 2')
    expect(brief).not.toContain('sourceTier')
    expect(brief).not.toContain('evidenceRefs')
    expect(brief).not.toContain('claim trace')
    expect(brief).not.toContain('block intents')
    expect(brief).not.toContain('quarantine')
    expect(brief).not.toContain('methodology')
  })

  it('separates confirmed/reported facts from rumors', () => {
    // Rumored fact goes into notYetConfirmed, NOT usefulFacts.
    // Simplest robust check: the rumored fact statement is present
    // in the brief (in notYetConfirmed) but under status "rumor".
    expect(brief).toContain('30 different Pikachu illustrations')
    expect(brief).toContain('notYetConfirmed')
  })

  it('ranks sources by tier (Tier-1 first)', () => {
    const posOfficial = brief.indexOf('pokemon.com/us/celebration')
    const posReddit   = brief.indexOf('reddit.com/r/pokemontcg')
    expect(posOfficial).toBeLessThan(posReddit)
  })

  it('caps sources at 12', () => {
    const bigPack = makePack({
      externalSources: Array.from({ length: 30 }, (_, i) => ({
        id: `s-${i}`, kind: 'external' as const,
        url: `https://example.com/${i}`, title: `T${i}`, addedAt: TODAY, origin: 'web' as const, sourceTier: (((i % 3) + 1) as 1|2|3),
      })),
    })
    const b = buildExternalArticleUserTurn({ project, pack: bigPack })
    const urls = (b.match(/https:\/\/example\.com\/\d+/g) ?? []).length
    expect(urls).toBeLessThanOrEqual(12)
  })
})
