// src/lib/editorial/writer/assembler.ts
//
// EIC Block 9 — WriterDraft → StudioDocument.
//
// Pure server-side conversion. Every block intent is passed through
// the Block 8 factories, which apply payload validation, quarantine
// exclusion, and provenance. Every prose paragraph is linkified from
// the Writer's link intents against an allowlist derived from the
// evidence pack and the existing-content context.
//
// The AI never assembles the final document. This function does.

import type { EvidencePack } from '@/lib/editorial/research/types'
import type { EditorialContext, EditorialContextArticle } from '@/lib/editorial/context'
import type { StudioDocument } from '@/lib/studio/types'
import { STUDIO_DOCUMENT_VERSION } from '@/lib/studio/types'
import type { CardIdentity } from '@/lib/studio/dataBlocks/types'
import {
  createMethodologyBlock, createStatCalloutFromFact, createRankingTableFromResearch,
  createRawPsaComparisonFromResearch, createPriceChartLive, createPriceChartSnapshot,
  createCardBlock,
} from '@/lib/studio/dataBlocks/factories'
import type { WriterDraft, WriterSection, BlockIntent, WriterAssemblyWarning, WriterLinkIntent } from './types'
import { isSafeArticleHref } from '@/lib/insights/richText'

export type AssembleInput = {
  draft:    WriterDraft
  pack:     EvidencePack
  context?: Pick<EditorialContext, 'articles'> | null
  themeKey?: string
  themeLabel?: string
  authorName?: string
  /** Card index for resolving cardSlug -> CardIdentity when the
   *  Writer emits card_block / card_grid / price_chart / comparison. */
  cardIndex?: Map<string, CardIdentity>
  today?:   string
}

export type AssembleResult = {
  studio:   StudioDocument
  warnings: WriterAssemblyWarning[]
  /** Actual block intents that survived assembly (dropped intents
   *  removed). Persisted to writer_json so the Fact Checker sees
   *  the same shape the reader will. */
  blocksBuilt: BlockIntent[]
}

export function assembleStudioFromDraft(input: AssembleInput): AssembleResult {
  const warnings: WriterAssemblyWarning[] = []
  const blocksBuilt: BlockIntent[] = []

  // Build the URL allowlist:
  //   * every pack.internalLinks.url (already normalised)
  //   * canonical /set/<setName>/card/<urlSlug> for every card the
  //     pack references directly (via dataTables + externalSources)
  //   * every pack.externalSources[].url (HTTPS only)
  //   * every existing insights article's slug
  const allowedInternal = new Set<string>()
  const allowedExternal = new Set<string>()
  for (const l of input.pack.internalLinks) if (l.url) allowedInternal.add(normaliseHref(l.url))
  for (const s of input.pack.externalSources) if (/^https:\/\//.test(s.url)) allowedExternal.add(s.url)
  for (const article of input.context?.articles ?? []) {
    const href = `/insights/${article.slug}`
    allowedInternal.add(href)
  }

  // BodyDoc content — collected as a TipTap doc.
  const nodes: any[] = []

  for (const section of input.draft.sections) {
    if (section.heading) {
      nodes.push({
        type: 'heading',
        attrs: { level: section.headingLevel === 3 ? 3 : 2 },
        content: [{ type: 'text', text: section.heading }],
      })
    }

    for (const paragraph of section.paragraphs) {
      const linkified = linkifyParagraph(paragraph, section.id, input.draft.internalLinkIntents, input.draft.externalLinkIntents, allowedInternal, allowedExternal, warnings)
      if (linkified.length === 0) continue
      nodes.push({ type: 'paragraph', content: linkified })
    }

    for (const intent of section.blockIntents) {
      try {
        const block = buildBlockFromIntent(intent, input)
        if (!block) {
          warnings.push({ kind: 'dropped_block_intent', detail: `${intent.kind}: returned null` })
          continue
        }
        nodes.push({ type: 'dataBlock', attrs: { variant: block.variant, payload: block.payload } })
        blocksBuilt.push(intent)
      } catch (e) {
        warnings.push({ kind: 'dropped_block_intent', detail: `${intent.kind}: ${e instanceof Error ? e.message : 'unknown'}` })
      }
    }
  }

  if (input.draft.conclusion) {
    const linkified = linkifyParagraph(input.draft.conclusion, 'conclusion', input.draft.internalLinkIntents, input.draft.externalLinkIntents, allowedInternal, allowedExternal, warnings)
    if (linkified.length > 0) nodes.push({ type: 'paragraph', content: linkified })
  }

  // Trailing empty paragraph so TipTap has a landing cursor after
  // the last atom node.
  nodes.push({ type: 'paragraph' })

  const studio: StudioDocument = {
    version:    STUDIO_DOCUMENT_VERSION,
    headline:   input.draft.headline,
    intro:      input.draft.intro,
    themeKey:   input.themeKey ?? 'market',
    themeLabel: input.themeLabel ?? '',
    authorName: input.authorName ?? '',
    seo: {
      title:       input.draft.seoTitle,
      description: input.draft.seoDescription,
    },
    heroImage: null,
    bodyDoc:   { type: 'doc', content: nodes },
    updatedAt: new Date().toISOString(),
  }

  return { studio, warnings, blocksBuilt }
}

// ─────────────────────────────────────────────────────────────────
// Block intent → data block via Block 8 factories
// ─────────────────────────────────────────────────────────────────

function buildBlockFromIntent(intent: BlockIntent, input: AssembleInput): { variant: string; payload: any } | null {
  switch (intent.kind) {
    case 'methodology':
      return createMethodologyBlock(input.pack)
    case 'stat_callout':
      return createStatCalloutFromFact(input.pack, intent.evidenceRefId, {
        value: intent.value, label: intent.label, context: intent.context,
      })
    case 'ranking_table':
      return createRankingTableFromResearch(input.pack, {
        dataTableId: intent.sourceTableId,
        title:       intent.title,
        intro:       intent.intro,
        limit:       intent.limit,
        columns:     intent.columns,
        cardFromRow: (row: Record<string, string | number | null>) => rowToCardIdentity(row, input.cardIndex),
      })
    case 'card_block': {
      const card = input.cardIndex?.get(intent.cardSlug) ?? { cardSlug: intent.cardSlug, cardName: intent.cardSlug }
      return createCardBlock({ card, mode: intent.mode ?? 'live', show: { raw: true, psa10: true } })
    }
    case 'card_grid': {
      const cards = intent.cardSlugs.map(slug => input.cardIndex?.get(slug) ?? null).filter(Boolean) as CardIdentity[]
      if (cards.length === 0) return null
      // No dedicated card_grid factory — build the payload manually
      // and pass through the registry validator.
      const payload = {
        title: intent.title,
        cards: cards.map(c => ({ card: c })),
        mode:  'live' as const,
      }
      return { variant: 'card_grid', payload }
    }
    case 'raw_psa_comparison': {
      const rows = intent.cardSlugs.map(slug => {
        const c = input.cardIndex?.get(slug)
        return c ? { card: c } : null
      }).filter(Boolean) as Array<{ card: CardIdentity }>
      if (rows.length === 0) return null
      return createRawPsaComparisonFromResearch(input.pack, {
        rows,
        showRatios: intent.showRatios,
        title:      intent.title,
      })
    }
    case 'price_chart': {
      const card = input.cardIndex?.get(intent.cardSlug) ?? { cardSlug: intent.cardSlug, cardName: intent.cardSlug }
      return createPriceChartLive({ card, series: intent.series, days: intent.days, title: intent.title })
    }
  }
}

function rowToCardIdentity(row: Record<string, string | number | null>, index?: Map<string, CardIdentity>): CardIdentity | null {
  // Try urlSlug first — matches the ranking-table row shape from
  // Block 8 acceptance packs. Then a lookup by cardSlug against the
  // shared index if we have one.
  const slugCell = pickStr(row, ['cardSlug', 'card_slug'])
  if (slugCell && index?.has(slugCell)) return index.get(slugCell)!
  const urlSlug = pickStr(row, ['urlSlug', 'url_slug'])
  const name    = pickStr(row, ['cardName', 'card', 'name'])
  const setName = pickStr(row, ['setName', 'set_name', 'set'])
  const number  = pickStr(row, ['cardNumber', 'card_number', 'number', '#'])
  if (!name) return null
  return {
    cardSlug: urlSlug ? urlSlug.replace(/^pc-/, '') : '',
    cardName: name,
    setName:  setName || undefined,
    cardNumber: number || undefined,
    urlSlug: urlSlug || undefined,
  }
}
function pickStr(row: Record<string, any>, keys: string[]): string {
  for (const k of keys) {
    if (typeof row[k] === 'string' && row[k]) return row[k]
    if (typeof row[k] === 'number') return String(row[k])
  }
  return ''
}

// ─────────────────────────────────────────────────────────────────
// Prose linkification
// ─────────────────────────────────────────────────────────────────

/**
 * Turn a plain-text paragraph into an array of TipTap inline nodes.
 * For each link intent whose sectionId matches (or is undefined),
 * the FIRST occurrence of the anchor gets a link mark. Every URL
 * must clear the allowlist; dropped links are reported.
 */
function linkifyParagraph(
  text: string,
  sectionId: string,
  internal: readonly WriterLinkIntent[],
  external: readonly WriterLinkIntent[],
  allowedInternal: Set<string>,
  allowedExternal: Set<string>,
  warnings: WriterAssemblyWarning[],
): any[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  // Build the set of link intents applicable to this section.
  const applicable: Array<{ url: string; anchor: string; internal: boolean }> = []
  for (const l of internal) {
    if (l.sectionId && l.sectionId !== sectionId) continue
    const url = normaliseHref(l.url)
    if (!allowedInternal.has(url)) { warnings.push({ kind: 'dropped_link', detail: `internal ${l.url} not in allowlist` }); continue }
    if (!isSafeArticleHref(url)) { warnings.push({ kind: 'dropped_link', detail: `unsafe href ${l.url}` }); continue }
    applicable.push({ url, anchor: l.anchor, internal: true })
  }
  for (const l of external) {
    if (l.sectionId && l.sectionId !== sectionId) continue
    if (!allowedExternal.has(l.url)) { warnings.push({ kind: 'dropped_link', detail: `external ${l.url} not in supplied sources` }); continue }
    if (!isSafeArticleHref(l.url))   { warnings.push({ kind: 'dropped_link', detail: `unsafe external ${l.url}` }); continue }
    applicable.push({ url: l.url, anchor: l.anchor, internal: false })
  }
  // Longest-anchor-first so nested phrases don't clobber each other.
  applicable.sort((a, b) => b.anchor.length - a.anchor.length)

  // Walk the paragraph. Each anchor is linked at its FIRST occurrence.
  const marks: Array<{ start: number; end: number; url: string }> = []
  const usedAnchors = new Set<string>()
  for (const spec of applicable) {
    if (usedAnchors.has(spec.anchor)) continue
    const start = findFirst(trimmed, spec.anchor)
    if (start < 0) continue
    // Overlap check: skip if this span collides with an existing mark.
    if (marks.some(m => start < m.end && start + spec.anchor.length > m.start)) continue
    marks.push({ start, end: start + spec.anchor.length, url: spec.url })
    usedAnchors.add(spec.anchor)
  }
  marks.sort((a, b) => a.start - b.start)

  const nodes: any[] = []
  let cursor = 0
  for (const m of marks) {
    if (m.start > cursor) nodes.push({ type: 'text', text: trimmed.slice(cursor, m.start) })
    nodes.push({
      type: 'text',
      text: trimmed.slice(m.start, m.end),
      marks: [{ type: 'link', attrs: { href: m.url } }],
    })
    cursor = m.end
  }
  if (cursor < trimmed.length) nodes.push({ type: 'text', text: trimmed.slice(cursor) })
  return nodes
}

function findFirst(hay: string, needle: string): number {
  if (!needle) return -1
  return hay.indexOf(needle)
}
function normaliseHref(href: string): string {
  return String(href ?? '').trim()
}
