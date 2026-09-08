// src/lib/editorial/research/externalResearch.ts
//
// External Research Fix — the external_research recipe.
//
// This recipe covers editorial pieces whose evidence is NOT the
// PokePrices database — release news, "everything we know" pieces,
// set announcements, product previews, evergreen guides. The recipe
// itself is deterministic (it does NOT call the AI at build time).
// The web-research call lives in externalResearchAnalyst.ts and is
// triggered by an explicit "Research web" user action.
//
// Build responsibilities:
//   * Produce a bootstrap EvidencePack with methodology + brief.
//   * Preserve any prior manual sources, notes, research questions,
//     verified facts sourced from manual entries, and prior
//     web-research telemetry when rebuilding.
//   * Compute quality based on what evidence is actually present
//     (external-only articles CAN reach publishable when the fact
//     count / source-tier mix is strong enough).

import 'server-only'
import type { EditorialContext } from '../context'
import type {
  EvidencePack, VerifiedFact, Warning, InternalSource,
  ExternalSource, PackProjectRef, PackQuality, DataTable,
  ResearchNote, ClaimContradiction, WebResearchMeta,
} from './types'

export type ExternalResearchBuildOptions = {
  today?:   string
  context?: EditorialContext
  /** Optional prior pack to preserve manual evidence from. */
  previous?: EvidencePack | null
}

// ─────────────────────────────────────────────────────────────────
// Build (deterministic)
// ─────────────────────────────────────────────────────────────────

export async function runExternalResearchRecipe(
  project: PackProjectRef,
  options: ExternalResearchBuildOptions = {},
): Promise<EvidencePack> {
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const generatedAt = new Date().toISOString()
  const previous = options.previous ?? null

  // Preserve manual sources across rebuild. Anything without `origin`
  // (pre-fix rows) is treated as manual — safer than deleting.
  const preservedManualSources: ExternalSource[] = (previous?.externalSources ?? [])
    .filter(s => (s.origin ?? 'manual') === 'manual')

  const preservedNotes: ResearchNote[] = previous?.notes ?? []
  const preservedQuestions: string[] = previous?.researchQuestions ?? []

  // Preserve verified facts that trace ONLY to preserved-manual
  // sources — the web-discovered facts are dropped so the next web
  // run can re-derive them fresh.
  const preservedSourceIds = new Set(preservedManualSources.map(s => s.id))
  const preservedFacts: VerifiedFact[] = (previous?.verifiedFacts ?? []).filter(f => {
    // The "brief" bootstrap fact has no external refs — always preserve.
    if (f.evidenceRefs.length === 0) return false
    return f.evidenceRefs.every(ref => preservedSourceIds.has(ref))
  })

  const preservedContradictions: ClaimContradiction[] = (previous?.contradictions ?? []).filter(c => {
    // Keep only contradictions grounded entirely in preserved sources.
    const refs = Array.from(new Set(c.positions.flatMap(p => p.evidenceRefs)))
    for (const r of refs) if (!preservedSourceIds.has(r)) return false
    return true
  })

  const preservedWebResearch: WebResearchMeta | undefined = previous?.webResearch

  const projectFact: VerifiedFact = {
    id: 'fact-project',
    type: 'verified_fact',
    statement: `Project "${project.title}" is a ${project.articleType} article covered by the external_research recipe.`,
    evidenceRefs: [],
    asOf: today,
  }

  const verifiedFacts: VerifiedFact[] = [projectFact, ...preservedFacts]

  const internalSources: InternalSource[] = []
  if (options.context) internalSources.push({
    id: 'src-editorial-context', kind: 'internal',
    label: 'editorialContext (articles + release calendar + projects)',
    table: '(computed)', asOf: options.context.meta.today,
    note: 'Snapshot of the site content graph at build time. Used to suggest internal links.',
  })

  // Related articles table — same shape as generic fallback, for
  // the Writer's internal-link picking.
  const relatedArticles = (options.context?.articles ?? [])
    .filter(a => matchesProject(project, a.headline))
    .slice(0, 8)

  const dataTables: DataTable[] = relatedArticles.length > 0 ? [{
    id: 'related-articles',
    title: 'Existing PokePrices articles related to this project',
    source: 'editorialContext',
    asOf: today,
    columns: [
      { key: 'headline',    label: 'Headline' },
      { key: 'publishedAt', label: 'Published' },
    ],
    rows: relatedArticles.map(a => ({
      headline: a.headline,
      publishedAt: a.publishedAt ?? '',
    })),
  }] : []

  const warnings: Warning[] = []
  if (preservedManualSources.length === 0 && !preservedWebResearch) {
    warnings.push({
      id: 'ext-no-sources',
      severity: 'major',
      message: `No external sources or web research yet. Attach at least one Tier-1 or two Tier-2 sources, or click "Research web" to discover them.`,
    })
  }

  const researchGaps: string[] = []
  if (!preservedWebResearch && preservedManualSources.length === 0) {
    researchGaps.push('Run "Research web" or attach reputable external sources before approval.')
  }

  const quality = computeExternalQuality({
    externalSources:  preservedManualSources,
    verifiedFacts:    preservedFacts,
    hasWebResearch:   !!preservedWebResearch,
    today,
  })

  return {
    version:     1,
    recipe:      'external_research',
    project,
    generatedAt,
    dataAsOf:    today,
    methodology: buildExternalMethodology({
      project,
      manualSources: preservedManualSources,
      allSources:    preservedManualSources,     // rebuild-time snapshot; web sources come later
      notes:         preservedNotes,
      webResearch:   preservedWebResearch,
    }),
    verifiedFacts,
    derivedFindings: [],
    dataTables,
    internalSources,
    externalSources: preservedManualSources,
    internalLinks: relatedArticles.map(a => ({
      label: a.headline,
      slug:  a.slug,
      url:   a.publicUrl ?? `https://www.pokeprices.io/insights/${a.slug}`,
    })),
    visualOpportunities: [],
    warnings,
    researchGaps,
    rejectedClaims: [],
    notes: preservedNotes,
    quarantinedRows: [],
    quality,
    researchQuestions: preservedQuestions,
    contradictions: preservedContradictions,
    webResearch: preservedWebResearch,
  }
}

// ─────────────────────────────────────────────────────────────────
// Methodology helper — reused after Research web / re-extract so the
// pack's summary + filters stay current instead of freezing at
// build-time state.
// ─────────────────────────────────────────────────────────────────

export function buildExternalMethodology(args: {
  project:       PackProjectRef
  manualSources: readonly ExternalSource[]
  allSources:    readonly ExternalSource[]
  notes:         readonly { id: string }[]
  webResearch?:  { researchedAt: string; searchesUsed: number; costUsd: number } | undefined
}) {
  const discoveredCount = args.allSources.filter(s => (s.origin ?? 'manual') === 'web').length
  const lastResearched = args.webResearch?.researchedAt
    ? `${args.webResearch.researchedAt.slice(0, 10)} (${args.webResearch.searchesUsed} search${args.webResearch.searchesUsed === 1 ? '' : 'es'}, $${args.webResearch.costUsd.toFixed(4)})`
    : '(never)'
  return {
    summary: [
      `External-research pack for "${args.project.title}". Facts must come from reputable external sources (official > specialist > community).`,
      `Manual sources are preserved across rebuilds and used as seeds for web discovery. Web-discovered sources may be replaced by a fresh "Research web" run.`,
    ].join(' '),
    filters: [
      { label: 'Article type',       value: args.project.articleType },
      { label: 'Recipe',             value: 'external_research' },
      { label: 'Preserved manual',   value: `${args.manualSources.length} source(s), ${args.notes.length} note(s)` },
      { label: 'Discovered (web)',   value: `${discoveredCount} source(s)` },
      { label: 'Last web research',  value: lastResearched },
    ],
    excludedGroups: [],
    dedupKey: 'externalSource.url',
  }
}

// ─────────────────────────────────────────────────────────────────
// Quality computation
// ─────────────────────────────────────────────────────────────────
//
// An external pack is publishable when:
//   * At least ONE Tier-1 source, OR at least TWO Tier-2 sources
//     (independent publishers, distinct domains), AND
//   * At least 3 verifiedFacts backed by those sources, AND
//   * No unresolved critical warnings.

export function computeExternalQuality(args: {
  externalSources:   readonly ExternalSource[]
  verifiedFacts:     readonly VerifiedFact[]
  hasWebResearch:    boolean
  today:             string
  webResearchedAt?:  string
}): PackQuality {
  const t1 = args.externalSources.filter(s => s.sourceTier === 1)
  const t2Domains = new Set(
    args.externalSources
      .filter(s => s.sourceTier === 2)
      .map(s => domainOf(s.url))
      .filter(Boolean),
  )
  const sourceOk = t1.length >= 1 || t2Domains.size >= 2

  const factCount = args.verifiedFacts.filter(f => f.evidenceRefs.length > 0).length
  const factsOk = factCount >= 3

  const reasons: string[] = []
  if (!args.hasWebResearch && args.externalSources.length === 0) {
    reasons.push('No external evidence yet.')
  }
  if (!sourceOk) reasons.push('Insufficient source authority (need 1× Tier-1 or 2× Tier-2 from distinct domains).')
  if (!factsOk)  reasons.push(`Fewer than 3 externally-sourced facts (currently ${factCount}).`)

  const publishable = sourceOk && factsOk && reasons.length === 0
  const status: PackQuality['status'] = publishable ? 'ok' : (args.externalSources.length === 0 && !args.hasWebResearch ? 'needs_review' : 'needs_review')

  // Freshness: use the web-research date when we have one, otherwise
  // "today" so the pack isn't marked stale for missing what we
  // haven't run yet.
  const asOf = args.webResearchedAt ?? args.today
  const daysOld = Math.max(0, Math.floor((Date.parse(args.today) - Date.parse(asOf)) / (24 * 60 * 60 * 1000)))

  return {
    status,
    dataStrength: publishable ? 'strong' : (args.externalSources.length > 0 || args.hasWebResearch ? 'medium' : 'weak'),
    sampleSize:   args.externalSources.length,
    freshness:    { asOf, daysOld, isStale: false }, // staleness is article-type-aware; enforced in preflight
    publishable,
    reasons,
  }
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

export function domainOf(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname.toLowerCase().replace(/^www\./, '')
  } catch { return '' }
}

function matchesProject(project: PackProjectRef, headline: string | null): boolean {
  const h = String(headline ?? '').toLowerCase()
  const t = project.title.toLowerCase()
  const titleWords = t.split(/\s+/).filter(w => w.length > 4)
  return titleWords.some(w => h.includes(w))
}

// ─────────────────────────────────────────────────────────────────
// Source-hierarchy classifier
// ─────────────────────────────────────────────────────────────────
//
// The hierarchy is transparent and small on purpose. Domains that
// are strictly authoritative for their own factual claims are Tier 1.
// Established specialist outlets are Tier 2. Everything else defaults
// to Tier 3.
//
// This is intentionally NOT a blocklist — Tier 3 is fine for
// establishing community reaction, sentiment, or as a lead source.
// It just cannot alone establish a release-critical fact.

const TIER_1: readonly string[] = [
  'pokemon.com',
  'pokemoncenter.com',
  'pokemon.co.uk',
  'pokemon-tcg.com',
  'pokemon.co.jp',
  'psacard.com',
  'cgccards.com',
  'tpci.com',
]

const TIER_2: readonly string[] = [
  'tcgplayer.com',
  'infinite.tcgplayer.com',
  'bulbapedia.bulbagarden.net',
  'pokebeach.com',
  'pokeguardian.com',
  'pokedata.io',
]

const TIER_3_HINT: readonly string[] = [
  'reddit.com',
  'youtube.com',
  'twitter.com',
  'x.com',
  'facebook.com',
]

export function classifySourceTier(url: string): 1 | 2 | 3 {
  const host = domainOf(url)
  if (!host) return 3
  for (const d of TIER_1) if (host === d || host.endsWith('.' + d)) return 1
  for (const d of TIER_2) if (host === d || host.endsWith('.' + d)) return 2
  for (const d of TIER_3_HINT) if (host === d || host.endsWith('.' + d)) return 3
  // Default: unclassified specialist -> Tier 2, unclassified generic
  // (blogs, retailers, aggregators without a strong track record) ->
  // Tier 3. We lean cautious: unknown domain -> Tier 3.
  return 3
}
