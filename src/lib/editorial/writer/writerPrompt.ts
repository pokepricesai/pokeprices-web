// src/lib/editorial/writer/writerPrompt.ts
//
// EIC Block 9 — AI Writer role prompt + input compaction + response
// parsing.
//
// The Writer is Claude Sonnet 4.6. It reads:
//   * the approved EvidencePack (compacted, minus quarantined rows)
//   * the ResearchAnalysis (if present)
//   * a short existing-content context (headline + slug + intro of
//     related published insights)
//
// And returns a WriterDraft JSON that our server code then assembles
// into the Studio document via the Block 8 factories.

import { POKEPRICES_EDITORIAL_PROFILE } from '../strategistPrompt'
import type { EvidencePack, ResearchAnalysis } from '../research/types'
import type { EditorialContext } from '../context'
import type { WriterDraft, WriterSection, BlockIntent, WriterLinkIntent, WriterClaimTrace } from './types'
import { WRITER_DRAFT_VERSION, isBlockIntentKind } from './types'

// ─────────────────────────────────────────────────────────────────
// System prompt
// ─────────────────────────────────────────────────────────────────

export const WRITER_ROLE_RULES = `You are the PokePrices AI Writer. Your job is to write a single polished article for PokePrices from an APPROVED research evidence pack. Everything you write must be traceable to the pack.

NON-NEGOTIABLE

1. Evidence is authoritative. If a fact is not in the evidence pack, an approved external source, or existing PokePrices content context supplied to you, you do NOT know it. Do not invent card prices, populations, dates, movements, methodology numbers, external sources, or any other factual claim. If you would need something you do not have, either omit it or write "the dataset does not establish X".

2. Do not use quarantined-row data. The pack summary tells you how many rows were quarantined and why. You may reference the count in methodology, never the values.

3. Do not restate rejected claims. Every claim in \`pack.rejectedClaims\` is off-limits phrasing.

4. Preserve every required caveat. If a caveat says "PSA population data as of May 13, 2026", every population figure in your prose must respect that framing. Do not write "currently", "today", or "now" against a stale number.

5. Preserve sample scope. If the pack says "tracked sample of N cards", never generalise to "the entire Pokémon market".

6. Fact vs derived finding vs interpretation.
   * Verified facts may be stated directly.
   * Derived findings may be stated when the underlying evidence + formula supports them.
   * Interpretation must be framed as interpretation: "This suggests…", "One possible reading is…".
   * Do not convert correlation into causation.

7. Do not produce investment language. No "best buys", "must own", "guaranteed", "invest now".

8. Do not build data-block payloads. When you want a table, a stat callout, a methodology box, a chart, a card block, or a raw/PSA comparison, emit a BlockIntent inside a section. Server code passes the intent through the Block 8 factories, which enforce validation, quarantine exclusion, and provenance. A block-intent that references evidence that does not exist will be dropped by the factory.

WRITING STYLE

Follow the PokePrices editorial profile above. American English. No em dashes. No AI-writing tropes. Use tables and charts for dense values and prose for meaning. Prefer short paragraphs and specific language.

STRUCTURE

Follow the story, not a generic template. A market report might go: what actually happened, distribution, biggest clean movers, notable set signals, what the data does not show, methodology. A population study might go: what was measured, ranking, patterns, examples, limitations, methodology. Do not force a "Why It Matters" section on every article.

Typical article: 1,200 to 2,500 words. Thin evidence should produce a shorter article, not padded prose. Dense evidence may run longer.

INTERNAL + EXTERNAL LINKS

* Internal links: pick from \`context.internalLinks\` and canonical cards/sets referenced by the pack or its dataTables. Never invent an internal URL.
* External links: only from \`pack.externalSources[].url\`. Never invent a URL, publisher, or citation.
* Link the first useful mention of a concept. Do not link every repeated entity. Aim for 4-10 internal prose links in a typical article, plus whatever structured components emit.

SEO

* headline: article H1, evidence-led, no clickbait.
* seoTitle: ideally ~50-60 characters. Vary from H1 if a stronger search variation exists.
* seoDescription: ideally ~140-160 characters. Concise summary of the article's value.

EVIDENCE TRACE

For every important factual claim you write, add an \`evidenceTrace\` entry linking the sentence to one or more pack ids (fact-*, finding-*, and dataTable ids). This is not exhaustive line-by-line provenance; it is enough for the Fact Checker and editor to audit major claims.

OUTPUT FORMAT

Reply with ONE JSON object wrapped in a fenced code block tagged \`json\`. Schema (TypeScript):

  {
    "version": 1,
    "headline": string,
    "intro": string,                     // 2-3 sentences that will render as the article deck
    "seoTitle": string,
    "seoDescription": string,
    "sections": [
      {
        "id": string,                    // stable slug, unique per section
        "heading": string | null,        // H2 by default
        "headingLevel": 2 | 3,           // 2 unless a section is a subhead
        "paragraphs": [ string, ... ],   // plain prose, no markdown
        "blockIntents": [
          { "kind": "methodology" }
          | { "kind": "stat_callout", "evidenceRefId": "fact-*|finding-*", "value": string, "label": string, "context"?: string }
          | { "kind": "ranking_table", "sourceTableId": string, "title"?: string, "intro"?: string, "limit"?: number, "columns"?: string[] }
          | { "kind": "card_grid", "cardSlugs": string[], "title"?: string }
          | { "kind": "card_block", "cardSlug": string, "mode"?: "live" | "snapshot" }
          | { "kind": "raw_psa_comparison", "cardSlugs": string[], "showRatios"?: boolean, "title"?: string }
          | { "kind": "price_chart", "cardSlug": string, "series": Array<"raw" | "psa9" | "psa10">, "days"?: number, "title"?: string }
        ]
      }
    ],
    "conclusion": string | null,
    "internalLinkIntents": [ { "url": "/…", "anchor": string, "sectionId"?: string } ],
    "externalLinkIntents": [ { "url": "https://…", "anchor": string, "sectionId"?: string } ],
    "evidenceTrace": [ { "sectionId": string, "claim": string, "evidenceRefs": string[] } ]
  }`

export const WRITER_SYSTEM_PROMPT = `${POKEPRICES_EDITORIAL_PROFILE}

${WRITER_ROLE_RULES}`

// ─────────────────────────────────────────────────────────────────
// Compaction of Writer inputs
// ─────────────────────────────────────────────────────────────────

export type WriterInputBundle = {
  project:  { id: number; title: string; angle: string | null; articleType: string; targetPublishAt: string | null }
  pack:     EvidencePack
  analysis: ResearchAnalysis | null
  context:  Pick<EditorialContext, 'meta' | 'articles'> | null
}

/**
 * Trim the raw inputs to what the Writer actually needs. Every
 * removal here is deliberate: we do NOT give the Writer quarantined
 * rows, extended internal-source detail, or the whole editorial
 * context — only enough to write and link.
 */
export function compactWriterInputs(bundle: WriterInputBundle): unknown {
  const { project, pack, analysis, context } = bundle
  return {
    project,
    pack: {
      recipe:            pack.recipe,
      generatedAt:       pack.generatedAt,
      dataAsOf:          pack.dataAsOf,
      methodology:       pack.methodology,
      verifiedFacts:     pack.verifiedFacts,
      derivedFindings:   pack.derivedFindings,
      dataTables:        pack.dataTables.map(t => ({
        id: t.id, title: t.title, source: t.source, asOf: t.asOf,
        columns: t.columns.map(c => ({ key: c.key, label: c.label, align: c.align })),
        rows: t.rows.slice(0, 30),
        totalRows: t.rows.length,
      })),
      externalSources:   pack.externalSources.map(s => ({ id: s.id, url: s.url, title: s.title, publisher: s.publisher, publicationDate: s.publicationDate })),
      internalLinks:     pack.internalLinks,
      visualOpportunities: pack.visualOpportunities,
      warnings:          pack.warnings,
      researchGaps:      pack.researchGaps,
      rejectedClaims:    pack.rejectedClaims,
      quality:           pack.quality,
      quarantinedRowsSummary: {
        count:  pack.quarantinedRows.length,
        reasons: countBy(pack.quarantinedRows.map(q => q.reason)),
        note:   'Quarantined rows are excluded from every publishable table. You may reference the count in methodology, never the values.',
      },
      notesCount:        pack.notes.length,
    },
    analysis: analysis ? {
      summary:              analysis.summary,
      recommendedAngle:     analysis.recommendedAngle,
      strongestFindings:    analysis.strongestFindings,
      weakerFindings:       analysis.weakerFindings,
      requiredCaveats:      analysis.requiredCaveats,
      recommendedVisuals:   analysis.recommendedVisuals,
      headlineCandidates:   analysis.headlineCandidates,
      unresolvedQuestions:  analysis.unresolvedQuestions,
      publishRecommendation: analysis.publishRecommendation,
      publishRecommendationReasons: analysis.publishRecommendationReasons,
    } : null,
    existingContent: context ? {
      today: context.meta.today,
      articles: context.articles.slice(0, 25).map(a => ({
        slug:       a.slug,
        headline:   a.headline,
        publicUrl:  a.publicUrl,
        intro:      a.intro,
        themeLabel: a.themeLabel,
        wordCount:  a.wordCount,
      })),
    } : null,
  }
}

function countBy(arr: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const x of arr) out[x] = (out[x] ?? 0) + 1
  return out
}

export function buildWriterUserTurn(bundle: WriterInputBundle): string {
  const compact = compactWriterInputs(bundle)
  return [
    'MODE=generate',
    '',
    'Write a single PokePrices article from the approved evidence pack below. Return one JSON object matching the schema in the system prompt.',
    '',
    'Rules recap:',
    '  * Evidence is authoritative. Do not invent facts.',
    '  * Emit BlockIntents; do not construct data-block payloads.',
    '  * Preserve required caveats and rejected-claim boundaries.',
    '  * Never use quarantined rows.',
    '  * Follow the PokePrices writing style.',
    '',
    '```json',
    JSON.stringify(compact, null, 2),
    '```',
  ].join('\n')
}

export function buildWriterRepairUserTurn(previousRaw: string, factCheckIssues: string, numericIssues: string): string {
  return [
    'MODE=repair',
    '',
    'Your previous draft has factual or numeric issues. Rewrite the SAME draft correcting only what is necessary. Do not introduce new facts. Preserve every claim that was fine. Return the FULL JSON object again in the same schema.',
    '',
    'Fact Checker issues:',
    factCheckIssues,
    '',
    'Numeric audit issues:',
    numericIssues,
    '',
    'Previous draft (verbatim):',
    previousRaw,
  ].join('\n')
}

// ─────────────────────────────────────────────────────────────────
// Response parsing
// ─────────────────────────────────────────────────────────────────

export function parseWriterResponse(rawText: string): WriterDraft | null {
  const fence = rawText.match(/```json\s*([\s\S]*?)\s*```/)
  const jsonText = fence ? fence[1] : rawText
  let parsed: any
  try { parsed = JSON.parse(jsonText) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null

  const sections = sanitiseSections(parsed.sections)
  if (sections.length === 0) return null

  return {
    version:             WRITER_DRAFT_VERSION,
    headline:            str(parsed.headline, 500),
    intro:               str(parsed.intro, 4000),
    seoTitle:            str(parsed.seoTitle, 200),
    seoDescription:      str(parsed.seoDescription, 400),
    sections,
    conclusion:          parsed.conclusion ? str(parsed.conclusion, 4000) : undefined,
    internalLinkIntents: sanitiseLinkIntents(parsed.internalLinkIntents),
    externalLinkIntents: sanitiseLinkIntents(parsed.externalLinkIntents),
    evidenceTrace:       sanitiseClaimTraces(parsed.evidenceTrace),
  }
}

function sanitiseSections(v: unknown): WriterSection[] {
  if (!Array.isArray(v)) return []
  const out: WriterSection[] = []
  const seen = new Set<string>()
  for (const s of v.slice(0, 30)) {
    if (!s || typeof s !== 'object') continue
    const ss = s as any
    const rawId = str(ss.id, 80)
    const id = uniqueSlug(rawId || 'section', seen)
    seen.add(id)
    const paragraphs = Array.isArray(ss.paragraphs) ? ss.paragraphs.filter((p: unknown) => typeof p === 'string' && p.trim()).slice(0, 40).map((p: string) => p.slice(0, 4000)) : []
    const heading    = str(ss.heading, 300) || undefined
    const level      = ss.headingLevel === 3 ? 3 : 2
    const intents    = sanitiseBlockIntents(ss.blockIntents)
    // Sections must have SOME content: heading + prose, or intents.
    if (!heading && paragraphs.length === 0 && intents.length === 0) continue
    out.push({ id, heading, headingLevel: level, paragraphs, blockIntents: intents })
  }
  return out
}

function sanitiseBlockIntents(v: unknown): BlockIntent[] {
  if (!Array.isArray(v)) return []
  const out: BlockIntent[] = []
  for (const b of v.slice(0, 20)) {
    if (!b || typeof b !== 'object') continue
    const bb = b as any
    if (!isBlockIntentKind(bb.kind)) continue
    switch (bb.kind) {
      case 'methodology':
        out.push({ kind: 'methodology' }); break
      case 'stat_callout':
        if (typeof bb.evidenceRefId !== 'string' || !bb.evidenceRefId) break
        out.push({
          kind: 'stat_callout',
          evidenceRefId: str(bb.evidenceRefId, 80),
          value:         str(bb.value, 60),
          label:         str(bb.label, 200),
          context:       bb.context ? str(bb.context, 400) : undefined,
        })
        break
      case 'ranking_table':
        if (typeof bb.sourceTableId !== 'string' || !bb.sourceTableId) break
        out.push({
          kind: 'ranking_table',
          sourceTableId: str(bb.sourceTableId, 100),
          title:   bb.title  ? str(bb.title, 300)  : undefined,
          intro:   bb.intro  ? str(bb.intro, 4000) : undefined,
          limit:   Number.isInteger(bb.limit)  ? Math.min(100, Math.max(1, bb.limit))  : undefined,
          columns: Array.isArray(bb.columns) ? bb.columns.filter((c: unknown) => typeof c === 'string').slice(0, 15) : undefined,
        })
        break
      case 'card_grid':
        out.push({
          kind: 'card_grid',
          cardSlugs: Array.isArray(bb.cardSlugs) ? bb.cardSlugs.filter((s: unknown) => typeof s === 'string' && s).slice(0, 24) : [],
          title: bb.title ? str(bb.title, 300) : undefined,
        })
        break
      case 'card_block':
        if (typeof bb.cardSlug !== 'string' || !bb.cardSlug) break
        out.push({ kind: 'card_block', cardSlug: str(bb.cardSlug, 80), mode: bb.mode === 'snapshot' ? 'snapshot' : 'live' })
        break
      case 'raw_psa_comparison':
        out.push({
          kind: 'raw_psa_comparison',
          cardSlugs: Array.isArray(bb.cardSlugs) ? bb.cardSlugs.filter((s: unknown) => typeof s === 'string' && s).slice(0, 12) : [],
          showRatios: bb.showRatios === true,
          title: bb.title ? str(bb.title, 300) : undefined,
        })
        break
      case 'price_chart':
        if (typeof bb.cardSlug !== 'string' || !bb.cardSlug) break
        out.push({
          kind: 'price_chart',
          cardSlug: str(bb.cardSlug, 80),
          series: Array.isArray(bb.series) ? bb.series.filter((s: any) => s === 'raw' || s === 'psa9' || s === 'psa10') : ['raw'],
          days: Number.isInteger(bb.days) ? Math.min(365 * 3, Math.max(30, bb.days)) : 180,
          title: bb.title ? str(bb.title, 300) : undefined,
        })
        break
    }
  }
  return out
}

function sanitiseLinkIntents(v: unknown): WriterLinkIntent[] {
  if (!Array.isArray(v)) return []
  const out: WriterLinkIntent[] = []
  for (const l of v.slice(0, 40)) {
    if (!l || typeof l !== 'object') continue
    const url = str((l as any).url, 800)
    const anchor = str((l as any).anchor, 300)
    if (!url || !anchor) continue
    const sectionId = (l as any).sectionId ? str((l as any).sectionId, 80) : undefined
    out.push({ url, anchor, sectionId })
  }
  return out
}

function sanitiseClaimTraces(v: unknown): WriterClaimTrace[] {
  if (!Array.isArray(v)) return []
  const out: WriterClaimTrace[] = []
  for (const t of v.slice(0, 200)) {
    if (!t || typeof t !== 'object') continue
    const claim = str((t as any).claim, 800)
    const sectionId = str((t as any).sectionId, 80)
    if (!claim || !sectionId) continue
    const refs = Array.isArray((t as any).evidenceRefs) ? (t as any).evidenceRefs.filter((r: unknown) => typeof r === 'string').slice(0, 12) : []
    out.push({ claim, sectionId, evidenceRefs: refs })
  }
  return out
}

function str(v: unknown, cap: number): string { return typeof v === 'string' ? v.slice(0, cap) : '' }
function uniqueSlug(base: string, seen: Set<string>): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section'
  if (!seen.has(clean)) return clean
  for (let i = 2; i < 999; i++) { const c = `${clean}-${i}`; if (!seen.has(c)) return c }
  return `${clean}-${Date.now()}`
}
