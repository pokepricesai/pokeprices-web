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
import type { WriterDraft, WriterSection, BlockIntent, WriterLinkIntent, WriterClaimTrace, WriterPlan, WriterPlanSection } from './types'
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

STATISTICAL IMPORTANCE VS EDITORIAL IMPORTANCE

Statistical importance and editorial importance are two different things. A metric that exists is not automatically a story worth leading with.

  * A market median near zero is context, not the headline. Do NOT write "The big story in August was a 0% median." Write "The tracked raw-card sample was broadly flat in August," then move on to whatever meaningful patterns actually exist.
  * When the pack carries \`marketSignalStrength: weak\`, treat the month as quiet. Say so plainly. Do not manufacture excitement. A quiet month is an acceptable article.
  * A breadth split of 39% falling vs 36% rising is a 2.7-point difference. That is not a dramatic bearish signal.
  * Reserve strong verbs like "surge", "collapse", "crash", "soaring", "major shift" for cases where robust evidence genuinely supports them. If the signal is weak or moderate, use neutral language ("moved higher", "eased back", "remained flat").
  * Prefer tables and charts for dense values; use prose to explain meaning. Do not restate the same numbers three times to fill space.

EXTREME MOVES ARE ALREADY EXCLUDED

The pack has already filtered out cards outside the editorial band ([-60%, +200%] on monthly moves) and unstable-endpoint cards. You will NEVER see a +5,000% or -95% mover as an editorial candidate. If you find yourself wanting to write about one of these, you are looking at the wrong source; the editorial-safe table is the one to use.

EXTERNAL-RESEARCH ARTICLES (recipe = external_research)

When the pack recipe is \`external_research\`, facts come from reputable external sources rather than PokePrices data. The authoritative research artefact is the pack's \`researchSummary\` (plus \`researchPrimaryText\` + \`researchSupportingText\` if you need more depth), not a structured \`verifiedFacts\` list. Extra rules apply:

  * Read \`researchSummary\` — it's a synthesis of the primary + supporting web research with inline citations. That is your source of truth.
  * Every externally-sourced claim in prose MUST be traceable to one of the pack's \`externalSources\` and must appear (or be implied) in the research prose. Never invent a source, publisher, URL, or fact that is not in the research.
  * If \`verifiedFacts\` is populated on this pack, those facts carry \`status\` (confirmed/reported/rumored/unverified) and \`sourceTier\` (1/2/3). Preserve status language — do NOT upgrade "reported" to "confirmed", do NOT present Tier-3 alone as official news. If \`verifiedFacts\` is empty, apply the same discipline based on the research prose's own hedging.
  * The pack's \`contradictions\` array (when populated) lists claims where sources disagree. You MUST surface each contradiction in prose, name at least one source per position, and not silently pick a side. Example: "Official channels have not confirmed a release date. Retailer listings currently point to November, but these should not be presented as confirmed."
  * The pack's \`researchQuestions\` array shows what was actually investigated. Use it as a scaffold for structure, not verbatim as headings.
  * Synthesize into original PokePrices prose. Do not closely reproduce or paraphrase source wording; write as an editorial synthesis of what is known, reported, and unknown.
  * Explicitly cover \`researchGaps\` — a "What we do not know yet" section is expected on release/news pieces.

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
      dataTables:        pack.dataTables.map(t => {
        // Final Data Trust Patch — for monthly market reports, the
        // Writer never receives the manual-review candidate tables
        // as usable evidence unless a slug has been human-approved
        // in pack.approvedLargeMoverSlugs. Approved slugs move into
        // the corresponding high-confidence table before the pack
        // is sent to the Writer.
        const isReviewTable = /^mover-review-(risers|fallers)-/.test(t.id)
        const approvedSet   = new Set(pack.approvedLargeMoverSlugs ?? [])
        const rows = isReviewTable
          ? t.rows.filter(r => approvedSet.has(String((r as any).cardSlug ?? '')))
          : t.rows.slice(0, 30)
        return {
          id: t.id, title: t.title, source: t.source, asOf: t.asOf,
          columns: t.columns.map(c => ({ key: c.key, label: c.label, align: c.align })),
          rows,
          totalRows: t.rows.length,
        }
      }),
      externalSources:   pack.externalSources.map(s => ({
        id: s.id, url: s.url, title: s.title,
        publisher: s.publisher, publicationDate: s.publicationDate,
        origin: s.origin ?? 'manual', sourceTier: s.sourceTier,
      })),
      internalLinks:     pack.internalLinks,
      visualOpportunities: pack.visualOpportunities,
      warnings:          pack.warnings,
      researchGaps:      pack.researchGaps,
      rejectedClaims:    pack.rejectedClaims,
      quality:           pack.quality,
      // External Research Fix — surface the fact-status /
      // contradictions / research-question fields to the Writer.
      // Undefined for internal-data packs; the prompt gates its own
      // handling on pack.recipe.
      researchQuestions: pack.researchQuestions,
      contradictions:    pack.contradictions,
      webResearch:       pack.webResearch ? { researchedAt: pack.webResearch.researchedAt, searchesUsed: pack.webResearch.searchesUsed, model: pack.webResearch.model } : undefined,
      // v5 — human-facing research synthesis. This is the primary
      // artefact for external_research articles. Bounded to keep the
      // Writer prompt lean; full prose lives on the run.
      researchSummary:   pack.researchSummary ? pack.researchSummary.slice(0, 10_000) : undefined,
      researchFindings:  pack.researchFindings,
      // Also expose raw stage prose when present so the Writer can
      // consult specific claims verbatim. Bounded per side.
      researchPrimaryText:    pack.externalResearchRun?.primaryText    ? pack.externalResearchRun.primaryText.slice(0, 10_000) : undefined,
      researchSupportingText: pack.externalResearchRun?.supportingText ? pack.externalResearchRun.supportingText.slice(0, 8_000)  : undefined,
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
      // Final Cleanup — rank articles by naive keyword overlap with
      // the project title + angle, keep only the 8 strongest so the
      // Writer prompt stops shipping 25 stubs it does not use. Falls
      // back to the newest 8 when the pack has no textual signal.
      articles: rankExistingArticlesForContext(project, context.articles, 8).map(a => ({
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

/** Score each existing article by shared meaningful tokens with the
 *  project brief. Deterministic, cheap, no AI. Returns up to `limit`
 *  best matches; ties broken by publish recency. */
function rankExistingArticlesForContext(
  project: WriterInputBundle['project'],
  articles: NonNullable<WriterInputBundle['context']>['articles'],
  limit: number,
): NonNullable<WriterInputBundle['context']>['articles'] {
  if (!articles || articles.length === 0) return []
  const projectTokens = tokenize(`${project.title} ${project.angle ?? ''} ${project.articleType}`)
  if (projectTokens.size === 0) {
    return [...articles].sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? ''))).slice(0, limit)
  }
  const scored = articles.map(a => {
    const t = tokenize(`${a.headline} ${a.intro ?? ''} ${a.themeLabel ?? ''}`)
    let overlap = 0
    for (const tok of Array.from(projectTokens)) if (t.has(tok)) overlap += 1
    return { a, overlap, published: String(a.publishedAt ?? '') }
  })
  scored.sort((x, y) => (y.overlap - x.overlap) || y.published.localeCompare(x.published))
  return scored.slice(0, limit).map(s => s.a)
}
function tokenize(s: string): Set<string> {
  const out = new Set<string>()
  for (const raw of String(s ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4) continue
    if (STOP_WORDS.has(raw)) continue
    out.add(raw)
  }
  return out
}
const STOP_WORDS = new Set(['pokemon','pokémon','article','report','study','data','with','from','that','this','have','been','will','their','other','more','some','into','they','than','when','where','which','about','across','over','under','through','among','while','also','only','many','most','both','also','made','make','around','after','before','because','though'])

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

// ─────────────────────────────────────────────────────────────────
// Block 9C — split Writer (plan → part1 → part2 → assemble)
// ─────────────────────────────────────────────────────────────────
//
// A single Sonnet call producing a 2,000-word article on 44 sourced
// facts was hitting Cloudflare's ~100s edge idle ceiling and
// returning HTTP 504 to the browser. The split lets each Claude
// call finish in ~30-45s and lets the browser resume via the
// existing stage-machine poll.
//
// Cost is one extra Sonnet call vs the old path (plan + 2 parts vs
// 1 monolithic). Plan output is small (~1500 tokens); parts see
// only the evidence relevant to their sections, so total input
// tokens are roughly the same, not doubled.

// PLAN STAGE — planning-only system prompt.
// Reuses the shared POKEPRICES_EDITORIAL_PROFILE. The plan is a
// structural blueprint the two drafting calls consume.

export const WRITER_PLAN_ROLE_RULES = `You are the PokePrices AI Writer, in PLAN MODE. You will NOT write article prose in this call. You produce a structural plan that two downstream drafting calls will consume.

INPUT

You will see the full APPROVED research pack, any analyst notes, and prior published content. Read the evidence carefully. Then produce a plan.

OUTPUT

Reply with ONE JSON object wrapped in a fenced code block tagged \`json\`. Schema:

  {
    "headline":       string,                       // the article H1
    "intro":          string,                       // 2-3 sentences that render as the article deck
    "seoTitle":       string,                       // ~50-60 chars
    "seoDescription": string,                       // ~140-160 chars
    "hasConclusion":  boolean,                      // true if a short concluding section will help
    "sections": [
      {
        "id":           string,                     // stable slug (lowercase, hyphenated), unique per section
        "heading":      string | null,              // H2 heading text
        "headingLevel": 2 | 3,                      // 2 unless this is a subhead
        "brief":        string,                     // 1-2 sentence guide for the drafter (what this section must cover, in what tone)
        "evidenceRefs": [ string, ... ],            // ids from the pack (fact-*, finding-*, table-*, source-*, src_*) this section will use
        "blockIntents": [ {...} ],                  // block intents planned for this section — same schema as WriterDraft.sections[].blockIntents
        "assignedTo":   "part1" | "part2"           // which drafting call produces this section
      }
    ],
    "internalLinkIntents": [ { "url": "/…",  "anchor": string, "sectionId"?: string } ],
    "externalLinkIntents": [ { "url": "https://…", "anchor": string, "sectionId"?: string } ]
  }

PLANNING RULES

* Design 5-9 sections. Roughly split them between part1 and part2 (aim ~50/50 by section count). part1 covers earlier sections; part2 covers the rest AND the conclusion if hasConclusion is true.
* Every fact you intend to state in an evidence-derived section MUST have an evidenceRef here. The drafter will not invent facts.
* Each section's brief must be concrete: "Introduce the tracked-sample scope. Cite verifiedFacts fact-scope and fact-methodology. Set expectations for the numbers to come." No fluffy briefs.
* Do NOT write any article prose in this stage. Briefs are instructions for the drafter, not sentences that will appear in the article.
* Follow the same rules as the full Writer: evidence-only, preserve caveats, do not invent sources, do not use quarantined values, no investment language.

STYLE

American English. No em dashes. No AI-writing tropes. Concise, editor-facing planning language.`

export const WRITER_PLAN_SYSTEM_PROMPT = `${POKEPRICES_EDITORIAL_PROFILE}

${WRITER_PLAN_ROLE_RULES}`

// PART STAGE — shared for part1 and part2. The user turn tells the
// model which sections to draft and passes only the evidence subset
// referenced by those sections (plus continuity headings from the
// other part).

export const WRITER_PART_ROLE_RULES = `You are the PokePrices AI Writer, in PART MODE. You are drafting a subset of the article's sections. Another call is (or has already) drafted the other sections; a deterministic assembler joins them into one final draft.

INPUT

You will see:
  * The APPROVED plan (headline / intro / SEO / section outline). Do NOT change these — they are already fixed for the article.
  * Your assigned sections (the sections you must draft).
  * The OTHER PART'S section headings — for continuity (so you don't repeat those points).
  * The evidence subset referenced by your assigned sections' evidenceRefs.
  * For external-research articles: the research summary/prose and cited sources.

OUTPUT

Reply with ONE JSON object wrapped in a fenced code block tagged \`json\`:

  {
    "sections": [
      {
        "id":           string,                     // MUST match the plan's section id verbatim
        "heading":      string | null,              // MUST match the plan's heading verbatim
        "headingLevel": 2 | 3,
        "paragraphs":   [ string, ... ],            // your prose for this section (plain text, no markdown)
        "blockIntents": [ {...} ]                   // may keep, refine, or add block intents; must not fabricate sourceTableId / cardSlug / evidenceRefId
      }
    ],
    "conclusion":   string | null,                  // ONLY set on part2 AND ONLY when plan.hasConclusion is true. Otherwise null.
    "internalLinkIntents": [ ... ],                 // links you actually used inside your sections. Never invent URLs.
    "externalLinkIntents": [ ... ],
    "evidenceTrace":       [ { "sectionId": string, "claim": string, "evidenceRefs": [string, ...] } ]
  }

DRAFTING RULES

* Draft ONLY your assigned sections. Do not draft any section that belongs to the other part.
* Do NOT re-emit the headline / intro / SEO fields — those are fixed.
* Do NOT duplicate points already covered by the other part's headings. Reference them only if the narrative requires continuity ("Building on the population data above,…").
* Only part2 may set conclusion (and only when plan.hasConclusion is true).
* Follow every other Writer rule: evidence-only, preserve caveats, no invented sources, no quarantined values, no investment language, no em dashes, American English, no AI-writing tropes.
* Section headings must match the plan verbatim. Section ids must match the plan verbatim.

Keep prose tight — a section with a two-sentence brief is not a five-paragraph section.`

export const WRITER_PART_SYSTEM_PROMPT = `${POKEPRICES_EDITORIAL_PROFILE}

${WRITER_PART_ROLE_RULES}`

// ── Plan user turn ────────────────────────────────────────────────

export function buildWriterPlanUserTurn(bundle: WriterInputBundle): string {
  const compact = compactWriterInputs(bundle)
  return [
    'MODE=plan',
    '',
    'Produce a structural plan for this article. Return one JSON object matching the schema in the system prompt.',
    '',
    'Rules recap:',
    '  * 5-9 sections, roughly split assignedTo part1 / part2.',
    '  * Every evidence-derived section names its evidenceRefs.',
    '  * Briefs are instructions for the drafter, not article prose.',
    '  * hasConclusion is your call — true when a concluding section adds value, false when the last section already lands the story.',
    '',
    '```json',
    JSON.stringify(compact, null, 2),
    '```',
  ].join('\n')
}

// ── Part user turn ────────────────────────────────────────────────

export type PartTurnArgs = {
  bundle:         WriterInputBundle
  plan:           WriterPlan
  part:           'part1' | 'part2'
  /** Section-heading strings from the OTHER part, in order — used
   *  as continuity context so the drafter does not repeat points. */
  otherPartHeadings: string[]
}

export function buildWriterPartUserTurn(args: PartTurnArgs): string {
  const { plan, part, otherPartHeadings, bundle } = args
  const assigned = plan.sections.filter(s => s.assignedTo === part)
  const evidenceIds = new Set<string>(assigned.flatMap(s => s.evidenceRefs))

  // Filter evidence to just what these sections reference. External
  // research prose is still passed as a whole because it's the
  // authoritative narrative and much of it is already bounded.
  const pack = bundle.pack
  const factSubset  = pack.verifiedFacts.filter(f => evidenceIds.has(f.id))
  const findingSubset = pack.derivedFindings.filter(f => evidenceIds.has(f.id))
  const tableSubset = pack.dataTables.filter(t => evidenceIds.has(t.id))
  const sourceSubset = pack.externalSources.filter(s => evidenceIds.has(s.id))

  // If the section refs a source or fact we couldn't match by id
  // (e.g. it referenced src_007 which isn't in externalSources by
  // that id), fall back to sending the whole externalSources list —
  // never leave the drafter without a source to link to.
  const externalSourcesForPrompt = sourceSubset.length > 0
    ? sourceSubset
    : pack.externalSources

  const partPack = {
    recipe: pack.recipe,
    project: pack.project,
    dataAsOf: pack.dataAsOf,
    verifiedFacts:   factSubset,
    derivedFindings: findingSubset,
    dataTables:      tableSubset.map(t => ({
      id: t.id, title: t.title, source: t.source, asOf: t.asOf,
      columns: t.columns.map(c => ({ key: c.key, label: c.label, align: c.align })),
      rows: t.rows.slice(0, 30),
      totalRows: t.rows.length,
    })),
    externalSources: externalSourcesForPrompt.map(s => ({
      id: s.id, url: s.url, title: s.title, publisher: s.publisher, publicationDate: s.publicationDate,
      origin: s.origin ?? 'manual', sourceTier: s.sourceTier,
    })),
    warnings:          pack.warnings,
    researchGaps:      pack.researchGaps,
    rejectedClaims:    pack.rejectedClaims,
    researchQuestions: pack.researchQuestions,
    contradictions:    pack.contradictions,
    // External-research packs: bounded prose so the drafter can
    // consult specific cited claims verbatim. Bounded per side.
    researchSummary:        pack.researchSummary ? pack.researchSummary.slice(0, 8_000) : undefined,
    researchPrimaryText:    pack.externalResearchRun?.primaryText    ? pack.externalResearchRun.primaryText.slice(0, 8_000) : undefined,
    researchSupportingText: pack.externalResearchRun?.supportingText ? pack.externalResearchRun.supportingText.slice(0, 6_000) : undefined,
  }

  const assignedForPrompt = assigned.map(s => ({
    id: s.id, heading: s.heading, headingLevel: s.headingLevel ?? 2,
    brief: s.brief, evidenceRefs: s.evidenceRefs, blockIntents: s.blockIntents,
  }))

  const planForPrompt = {
    headline:       plan.headline,
    intro:          plan.intro,
    seoTitle:       plan.seoTitle,
    seoDescription: plan.seoDescription,
    hasConclusion:  plan.hasConclusion,
  }

  return [
    `MODE=${part}`,
    '',
    `Draft ONLY your assigned sections (${assigned.length} sections). Return one JSON object matching the schema in the system prompt.`,
    '',
    'FIXED PLAN (do not restate):',
    '```json',
    JSON.stringify(planForPrompt, null, 2),
    '```',
    '',
    otherPartHeadings.length > 0
      ? `OTHER PART headings (already assigned to the ${part === 'part1' ? 'part2' : 'part1'} drafter; do NOT repeat them):\n  * ${otherPartHeadings.join('\n  * ')}`
      : `No other-part sections.`,
    '',
    'YOUR ASSIGNED SECTIONS:',
    '```json',
    JSON.stringify(assignedForPrompt, null, 2),
    '```',
    '',
    'EVIDENCE SUBSET (only what your sections reference):',
    '```json',
    JSON.stringify(partPack, null, 2),
    '```',
    '',
    part === 'part2' && plan.hasConclusion
      ? 'You MAY set conclusion (short concluding paragraph). Set it to null if it would be padding.'
      : 'DO NOT set conclusion — it belongs to the other part or the plan says no conclusion.',
  ].join('\n')
}

// ── Parsers ───────────────────────────────────────────────────────

export function parseWriterPlanResponse(rawText: string): WriterPlan | null {
  const fence = rawText.match(/```json\s*([\s\S]*?)\s*```/)
  const jsonText = fence ? fence[1] : rawText
  let parsed: any
  try { parsed = JSON.parse(jsonText) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null

  const sections = sanitisePlanSections(parsed.sections)
  if (sections.length === 0) return null
  return {
    headline:            str(parsed.headline, 500),
    intro:               str(parsed.intro, 4000),
    seoTitle:            str(parsed.seoTitle, 200),
    seoDescription:      str(parsed.seoDescription, 400),
    hasConclusion:       parsed.hasConclusion === true,
    sections,
    internalLinkIntents: sanitiseLinkIntents(parsed.internalLinkIntents),
    externalLinkIntents: sanitiseLinkIntents(parsed.externalLinkIntents),
  }
}

function sanitisePlanSections(v: unknown): WriterPlanSection[] {
  if (!Array.isArray(v)) return []
  const out: WriterPlanSection[] = []
  const seen = new Set<string>()
  for (const s of v.slice(0, 20)) {
    if (!s || typeof s !== 'object') continue
    const ss = s as any
    const rawId = str(ss.id, 80)
    const id = uniqueSlug(rawId || 'section', seen)
    seen.add(id)
    const heading = str(ss.heading, 300) || null
    const level: 2 | 3 = ss.headingLevel === 3 ? 3 : 2
    const brief = str(ss.brief, 1200)
    const evidenceRefs = Array.isArray(ss.evidenceRefs)
      ? ss.evidenceRefs.filter((r: unknown) => typeof r === 'string' && r.trim()).slice(0, 20)
      : []
    const blockIntents = sanitiseBlockIntents(ss.blockIntents)
    const assignedTo: 'part1' | 'part2' = ss.assignedTo === 'part2' ? 'part2' : 'part1'
    out.push({ id, heading, headingLevel: level, brief, evidenceRefs, blockIntents, assignedTo })
  }
  return out
}

/** Parse a part-drafter response. Returns just the sections +
 *  conclusion + link + trace fields. The plan-provided fields
 *  (headline/intro/seo) come from the plan, not the part output. */
export function parseWriterPartResponse(rawText: string): {
  sections:            WriterSection[]
  conclusion:          string | null
  internalLinkIntents: WriterLinkIntent[]
  externalLinkIntents: WriterLinkIntent[]
  evidenceTrace:       WriterClaimTrace[]
} | null {
  const fence = rawText.match(/```json\s*([\s\S]*?)\s*```/)
  const jsonText = fence ? fence[1] : rawText
  let parsed: any
  try { parsed = JSON.parse(jsonText) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const sections = sanitiseSections(parsed.sections)
  const conclusion = typeof parsed.conclusion === 'string' && parsed.conclusion.trim().length > 0 ? str(parsed.conclusion, 4000) : null
  return {
    sections,
    conclusion,
    internalLinkIntents: sanitiseLinkIntents(parsed.internalLinkIntents),
    externalLinkIntents: sanitiseLinkIntents(parsed.externalLinkIntents),
    evidenceTrace:       sanitiseClaimTraces(parsed.evidenceTrace),
  }
}

// ── Deterministic assembler (plan + parts → WriterDraft) ─────────

export function assembleDraftFromPlanAndParts(
  plan: WriterPlan,
  part1: ReturnType<typeof parseWriterPartResponse>,
  part2: ReturnType<typeof parseWriterPartResponse>,
): WriterDraft {
  const p1Sections = part1?.sections ?? []
  const p2Sections = part2?.sections ?? []
  const byId = new Map<string, WriterSection>()
  for (const s of p1Sections) byId.set(s.id, s)
  for (const s of p2Sections) byId.set(s.id, s)   // part2 wins on any accidental id collision

  // Emit sections in the plan's declared order, using each part's
  // drafted content when present. Sections the part omitted are
  // dropped rather than empty-stubbed.
  const orderedSections: WriterSection[] = []
  for (const planned of plan.sections) {
    const drafted = byId.get(planned.id)
    if (drafted) {
      orderedSections.push(drafted)
    }
  }

  // Only part2 may contribute a conclusion, and only when the plan
  // said hasConclusion. Drop otherwise even if the model emits one.
  const conclusion = plan.hasConclusion && part2?.conclusion ? part2.conclusion : undefined

  // Merge link intents, deduping by url+anchor.
  const linkKey = (l: WriterLinkIntent) => `${l.url}||${l.anchor.toLowerCase()}`
  const mergeLinks = (a: WriterLinkIntent[], b: WriterLinkIntent[]) => {
    const seen = new Set<string>(); const out: WriterLinkIntent[] = []
    for (const l of [...a, ...b]) { const k = linkKey(l); if (seen.has(k)) continue; seen.add(k); out.push(l) }
    return out
  }
  const internalLinkIntents = mergeLinks(
    plan.internalLinkIntents,
    mergeLinks(part1?.internalLinkIntents ?? [], part2?.internalLinkIntents ?? []),
  )
  const externalLinkIntents = mergeLinks(
    plan.externalLinkIntents,
    mergeLinks(part1?.externalLinkIntents ?? [], part2?.externalLinkIntents ?? []),
  )
  const evidenceTrace = [...(part1?.evidenceTrace ?? []), ...(part2?.evidenceTrace ?? [])]

  return {
    version:             WRITER_DRAFT_VERSION,
    headline:            plan.headline,
    intro:               plan.intro,
    seoTitle:            plan.seoTitle,
    seoDescription:      plan.seoDescription,
    sections:            orderedSections,
    conclusion,
    internalLinkIntents,
    externalLinkIntents,
    evidenceTrace,
  }
}
