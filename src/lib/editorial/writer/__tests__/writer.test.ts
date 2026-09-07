// src/lib/editorial/writer/__tests__/writer.test.ts
//
// EIC Block 9 — Writer + Fact Checker regression tests.
//
// Covers:
//   * WriterDraft parsing + sanitisation
//   * Assembler URL allowlist enforcement
//   * Assembler drops block intents against invalid evidence
//   * Numeric audit: matches evidence values, flags unknown numbers
//   * Fact Checker parser: forces status per severity + strips 'pass'
//     from a blocked pack
//   * 32.4x regression: raw/PSA comparison intent from a blocked
//     pack is dropped by the assembler (via the Block 8 factory)

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import type { EvidencePack } from '@/lib/editorial/research/types'
import { parseWriterResponse } from '../writerPrompt'
import { assembleStudioFromDraft } from '../assembler'
import { extractNumericTokens, auditStudioNumerics } from '../numericAudit'
import { parseFactCheckerResponse } from '../factCheckerPrompt'
import type { NumericAuditResult, WriterDraft } from '../types'
import type { StudioDocument } from '@/lib/studio/types'

// ─────────────────────────────────────────────────────────────────
// Shared fixture — a small approved August-like pack
// ─────────────────────────────────────────────────────────────────

function augustPack(): EvidencePack {
  return {
    version: 1,
    recipe: 'monthly_market_report',
    project: { id: 42, title: 'Aug 2026 report', articleType: 'monthly_market_report', angle: null, targetPublishAt: null },
    generatedAt: '2026-09-06T00:00:00Z',
    dataAsOf: '2026-08-31',
    methodology: {
      summary: 'Compared raw card prices on 2026-08-01 and 2026-08-31.',
      filters: [
        { label: 'Start date', value: '2026-08-01' },
        { label: 'End date',   value: '2026-08-31' },
      ],
      excludedGroups: [{ label: 'start-only cards', reason: '221 cards' }],
      dedupKey: 'card_slug',
    },
    verifiedFacts: [
      { id: 'fact-both-raw', type: 'verified_fact', statement: '62,645 cards have a raw price on both dates.', evidenceRefs: [], asOf: '2026-08-31' },
    ],
    derivedFindings: [
      { id: 'finding-median', type: 'derived_finding', statement: 'Median raw-price change was +0.0%.', formula: 'median(rawPct)', evidenceRefs: ['fact-both-raw'], asOf: '2026-08-31' },
      { id: 'finding-fell',   type: 'derived_finding', statement: '39.1% of the sample fell by more than 1%.', formula: 'count/N', evidenceRefs: ['fact-both-raw'], asOf: '2026-08-31' },
    ],
    dataTables: [
      {
        id: 'top-risers', title: 'Top risers', source: 'daily_prices', asOf: '2026-08-31',
        columns: [
          { key: 'cardName', label: 'Card' }, { key: 'setName', label: 'Set' },
          { key: 'startUsd', label: 'Start $', align: 'right' }, { key: 'endUsd', label: 'End $', align: 'right' },
          { key: 'pct', label: '% change', align: 'right' },
        ],
        rows: [
          { cardName: 'Card A', setName: 'Set X', startUsd: 39.92, endUsd: 219.98, pct: 451.1 },
          { cardName: 'Card B', setName: 'Set X', startUsd: 17.97, endUsd: 92.51,  pct: 414.8 },
        ],
      },
    ],
    internalSources: [{ id: 'src-dp', kind: 'internal', label: 'daily_prices', table: 'daily_prices', asOf: '2026-08-31' }],
    externalSources: [{ id: 'src-ext', kind: 'external', url: 'https://example.com/report', title: 'External report', addedAt: '2026-09-06' }],
    internalLinks: [{ label: 'Set X', slug: 'set-x', url: '/set/set-x' }],
    visualOpportunities: [],
    warnings: [], researchGaps: [], rejectedClaims: [{ claim: 'The Pokemon market moved X% in August 2026.', reason: 'attribute to tracked catalogue' }],
    notes: [],
    quarantinedRows: [],
    quality: { status: 'ok', dataStrength: 'strong', sampleSize: 62_645, freshness: { asOf: '2026-08-31', daysOld: 6, isStale: false }, publishable: true, reasons: ['All gates cleared.'] },
  }
}

function blockedGradingPack(): EvidencePack {
  const p = augustPack()
  return {
    ...p,
    recipe: 'population_scarcity',
    quality: { ...p.quality, status: 'blocked', publishable: false, reasons: ['grading data unsuitable'] },
    warnings: [{ id: 'w1', severity: 'critical', message: '32x median is a data-composition artifact' }],
  }
}

function fencedDraft(overrides: Partial<any> = {}): string {
  const draft = {
    version: 1,
    headline: 'August 2026 Pokemon TCG Market Report',
    intro: 'August ended close to flat across 62,645 tracked cards, but the balance leaned slightly negative.',
    seoTitle: 'August 2026 Pokemon Market Report | PokePrices',
    seoDescription: 'Median monthly raw-price change was flat in August across 62,645 cards, with a slight edge to sellers.',
    sections: [
      {
        id: 'what-happened',
        heading: 'What actually happened in August',
        headingLevel: 2,
        paragraphs: [
          'Across the 62,645 cards priced on both endpoints, the median raw-price change was 0.0% in August 2026.',
        ],
        blockIntents: [
          { kind: 'stat_callout', evidenceRefId: 'fact-both-raw', value: '62,645', label: 'cards priced at both August endpoints' },
          { kind: 'stat_callout', evidenceRefId: 'finding-fell',   value: '39.1%', label: 'of the sample fell by more than 1%' },
          { kind: 'ranking_table', sourceTableId: 'top-risers', title: 'Top risers', limit: 2 },
          { kind: 'methodology' },
        ],
      },
    ],
    conclusion: null,
    internalLinkIntents: [{ url: '/set/set-x', anchor: 'Set X' }],
    externalLinkIntents: [{ url: 'https://example.com/report', anchor: 'External report' }],
    evidenceTrace: [
      { sectionId: 'what-happened', claim: '62,645 cards priced at both endpoints', evidenceRefs: ['fact-both-raw'] },
      { sectionId: 'what-happened', claim: 'median +0.0%',                          evidenceRefs: ['finding-median'] },
      { sectionId: 'what-happened', claim: '39.1% fell by more than 1%',            evidenceRefs: ['finding-fell'] },
    ],
    ...overrides,
  }
  return '```json\n' + JSON.stringify(draft) + '\n```'
}

// ─────────────────────────────────────────────────────────────────
// Writer parser
// ─────────────────────────────────────────────────────────────────

describe('parseWriterResponse', () => {
  it('parses a fenced JSON draft', () => {
    const d = parseWriterResponse(fencedDraft())
    expect(d).not.toBeNull()
    expect(d!.headline).toContain('August')
    expect(d!.sections).toHaveLength(1)
    expect(d!.sections[0].blockIntents.map(b => b.kind)).toEqual(['stat_callout', 'stat_callout', 'ranking_table', 'methodology'])
  })
  it('rejects a draft with no sections', () => {
    const d = parseWriterResponse('```json\n' + JSON.stringify({ version: 1, headline: 'x', intro: 'y', sections: [], seoTitle: '', seoDescription: '', internalLinkIntents: [], externalLinkIntents: [], evidenceTrace: [] }) + '\n```')
    expect(d).toBeNull()
  })
  it('drops block intents with an unknown kind', () => {
    const raw = fencedDraft({
      sections: [{ id: 's', heading: 'H', headingLevel: 2, paragraphs: ['p'], blockIntents: [{ kind: 'nonsense' }, { kind: 'methodology' }] }],
    })
    const d = parseWriterResponse(raw)!
    expect(d.sections[0].blockIntents.map(b => b.kind)).toEqual(['methodology'])
  })
})

// ─────────────────────────────────────────────────────────────────
// Assembler
// ─────────────────────────────────────────────────────────────────

describe('assembleStudioFromDraft', () => {
  it('emits data blocks for supported intents and drops the rest', () => {
    const pack = augustPack()
    const draft = parseWriterResponse(fencedDraft())!
    const { studio, warnings, blocksBuilt } = assembleStudioFromDraft({ draft, pack })
    const bodyNodes = (studio.bodyDoc as any).content as any[]
    const dataBlocks = bodyNodes.filter(n => n.type === 'dataBlock')
    expect(dataBlocks.map(b => b.attrs.variant).sort()).toEqual(['methodology', 'ranking_table', 'stat_callout', 'stat_callout'].sort())
    expect(blocksBuilt).toHaveLength(4)
    expect(warnings.filter(w => w.kind === 'dropped_block_intent')).toHaveLength(0)
  })

  it('drops block intents that fail the Block 8 factory (unknown fact id)', () => {
    const pack = augustPack()
    const raw = fencedDraft({
      sections: [{
        id: 's', heading: 'H', headingLevel: 2, paragraphs: [],
        blockIntents: [{ kind: 'stat_callout', evidenceRefId: 'fact-does-not-exist', value: '1', label: 'nope' }],
      }],
    })
    const draft = parseWriterResponse(raw)!
    const { warnings, blocksBuilt } = assembleStudioFromDraft({ draft, pack })
    expect(blocksBuilt).toHaveLength(0)
    expect(warnings.some(w => w.kind === 'dropped_block_intent')).toBe(true)
  })

  it('drops internal links not present in the allowlist', () => {
    const pack = augustPack()
    const raw = fencedDraft({
      internalLinkIntents: [{ url: '/set/not-in-pack', anchor: 'Set X' }, { url: '/set/set-x', anchor: 'Set X' }],
    })
    const draft = parseWriterResponse(raw)!
    const { warnings } = assembleStudioFromDraft({ draft, pack })
    expect(warnings.some(w => w.kind === 'dropped_link' && w.detail.includes('/set/not-in-pack'))).toBe(true)
  })

  it('rejects external URLs that are not in pack.externalSources', () => {
    const pack = augustPack()
    const raw = fencedDraft({
      externalLinkIntents: [{ url: 'https://malicious.example/x', anchor: 'External report' }],
    })
    const draft = parseWriterResponse(raw)!
    const { warnings } = assembleStudioFromDraft({ draft, pack })
    expect(warnings.some(w => w.kind === 'dropped_link' && w.detail.includes('malicious.example'))).toBe(true)
  })

  it('32.4x regression — raw/PSA comparison intent from a blocked pack is dropped', () => {
    const pack = blockedGradingPack()
    const raw = fencedDraft({
      sections: [{
        id: 's', heading: 'H', headingLevel: 2, paragraphs: ['prose'],
        blockIntents: [{
          kind: 'raw_psa_comparison',
          cardSlugs: ['999'],
          showRatios: true,
        }],
      }],
    })
    const draft = parseWriterResponse(raw)!
    const cardIndex = new Map([['999', { cardSlug: '999', cardName: 'X' }]])
    const { warnings, blocksBuilt } = assembleStudioFromDraft({ draft, pack, cardIndex })
    expect(blocksBuilt).toHaveLength(0)
    expect(warnings.some(w => w.kind === 'dropped_block_intent' && /blocked|research-required/i.test(w.detail))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────
// Numeric audit
// ─────────────────────────────────────────────────────────────────

describe('numeric audit', () => {
  const pack = augustPack()

  it('extracts currency / percent / count tokens', () => {
    const t = extractNumericTokens('62,645 cards fell by 39.1% in August; median $10.00 raw.', 'x')
    expect(t.map(x => x.kind)).toEqual(expect.arrayContaining(['count', 'percent', 'currency']))
    expect(t.find(x => x.raw.includes('62,645'))?.value).toBe(62645)
  })

  it('matches numbers that appear in verifiedFacts / derivedFindings', () => {
    const studio: StudioDocument = fakeStudio({
      headline: 'August 2026 Pokemon TCG Market Report',
      intro: 'Across 62,645 tracked cards, the median monthly move was 0.0%.',
      bodyDoc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '39.1% of the sample fell by more than 1%.' }] },
        ],
      },
    })
    const audit = auditStudioNumerics(studio, pack, [])
    expect(audit.status).toBe('pass')
    expect(audit.matched).toBeGreaterThan(0)
  })

  it('flags numbers absent from the evidence pack', () => {
    const studio: StudioDocument = fakeStudio({
      headline: 'Aug 2026',
      intro: 'x',
      bodyDoc: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The market rose 27,755% in August across 100 cards.' }] }],
      },
    })
    const audit = auditStudioNumerics(studio, pack, [])
    expect(audit.status).toBe('review_required')
    expect(audit.issues.some(i => i.token.raw.includes('27,755'))).toBe(true)
    expect(audit.issues.some(i => i.token.raw.includes('100'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────
// Fact Checker parser + guardrails
// ─────────────────────────────────────────────────────────────────

describe('parseFactCheckerResponse', () => {
  const pack = augustPack()

  it('forces status=fail when a critical issue is present', () => {
    const raw = '```json\n' + JSON.stringify({
      status: 'pass',
      issues: [{ kind: 'unsupported_factual_claim', severity: 'critical', claim: 'x', reason: 'y', evidenceRefs: [] }],
    }) + '\n```'
    const fc = parseFactCheckerResponse(raw, pack, emptyAudit(), { checkedStudioHash: 'h', autoCheck: true })
    expect(fc.status).toBe('fail')
  })

  it('appends deterministic numeric-audit issues', () => {
    const audit: NumericAuditResult = {
      status: 'review_required',
      checked: 1, matched: 0,
      issues: [{ token: { raw: '999,999', value: 999999, kind: 'count', location: 'body' }, reason: 'no match', nearest: undefined }],
    }
    const raw = '```json\n' + JSON.stringify({ status: 'pass', issues: [] }) + '\n```'
    const fc = parseFactCheckerResponse(raw, pack, audit, { checkedStudioHash: 'h', autoCheck: true })
    expect(fc.issues.some(i => i.kind === 'unsupported_numeric_claim' && i.claim.includes('999,999'))).toBe(true)
    expect(fc.status).not.toBe('pass')   // major appended → review_required
  })

  it('cannot upgrade a blocked pack to pass', () => {
    const blocked = blockedGradingPack()
    const raw = '```json\n' + JSON.stringify({ status: 'pass', issues: [] }) + '\n```'
    const fc = parseFactCheckerResponse(raw, blocked, emptyAudit(), { checkedStudioHash: 'h', autoCheck: true })
    expect(fc.status).toBe('fail')
  })
})

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function fakeStudio(overrides: Partial<StudioDocument>): StudioDocument {
  return {
    version: 1, headline: '', intro: '', themeKey: 'market', themeLabel: '', authorName: '',
    seo: { title: '', description: '' }, heroImage: null,
    bodyDoc: { type: 'doc', content: [] }, updatedAt: new Date().toISOString(),
    ...overrides,
  }
}
function emptyAudit(): NumericAuditResult {
  return { status: 'pass', checked: 0, matched: 0, issues: [] }
}
