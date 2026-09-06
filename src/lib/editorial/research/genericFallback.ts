// src/lib/editorial/research/genericFallback.ts
//
// EIC Block 6 — research recipe fallback.
//
// Used when the project's article type does not have a bespoke recipe.
// Produces a minimal EvidencePack containing the project brief, any
// Radar evidence attached to the project (via matching opportunity
// id), a list of related existing PokePrices articles, and an
// explicit research-recipe-unavailable warning.
//
// This exists so every project can enter the Research Room and get a
// consistent pack shape, even when no deterministic recipe applies
// yet. The pack is never `publishable`; it always requires a human
// to attach external sources / research notes.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import type { EditorialContext } from '../context'
import type { OpportunityRadar } from '../opportunityRadar'
import type {
  EvidencePack, VerifiedFact, DataTable, Warning,
  InternalSource, PackQuality, PackProjectRef,
} from './types'

export type GenericFallbackOptions = {
  today?: string
  context?: EditorialContext
  radar?:   OpportunityRadar
  matchingRadarOpportunityId?: string | null
}

export async function runGenericFallbackRecipe(
  project: PackProjectRef,
  options: GenericFallbackOptions = {},
): Promise<EvidencePack> {
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const generatedAt = new Date().toISOString()

  const warnings: Warning[] = [
    {
      id: 'no-recipe',
      severity: 'major',
      message: `No deterministic research recipe exists for article type "${project.articleType}". This pack is a bootstrap only; every claim must be substantiated by manually-attached research notes or external sources before approval.`,
    },
  ]

  const radarOpp = options.radar && options.matchingRadarOpportunityId
    ? options.radar.opportunities.find(o => o.id === options.matchingRadarOpportunityId) ?? null
    : null

  const relatedArticles = (options.context?.articles ?? [])
    .filter(a => matchesProject(project, a.headline))
    .slice(0, 6)

  const internalSources: InternalSource[] = []
  if (options.radar) internalSources.push({
    id: 'src-radar', kind: 'internal', label: 'opportunityRadar snapshot', table: '(computed)',
    asOf: today, note: 'Deterministic detector output at build time.',
  })
  if (options.context) internalSources.push({
    id: 'src-editorial-context', kind: 'internal', label: 'editorialContext (articles + release calendar + projects)',
    table: '(computed)', asOf: options.context.meta.today, note: 'Snapshot of the site content graph at build time.',
  })

  const dataTables: DataTable[] = relatedArticles.length > 0 ? [{
    id: 'related-articles',
    title: 'Existing PokePrices articles related to this project',
    source: 'editorialContext',
    asOf: today,
    columns: [
      { key: 'headline',    label: 'Headline' },
      { key: 'publishedAt', label: 'Published' },
      { key: 'wordCount',   label: 'Words', align: 'right' },
    ],
    rows: relatedArticles.map(a => ({
      headline: a.headline,
      publishedAt: a.publishedAt ?? '',
      wordCount: a.wordCount ?? 0,
    })),
  }] : []

  const verifiedFacts: VerifiedFact[] = [
    { id: 'fact-project', type: 'verified_fact', statement: `Project "${project.title}" is a ${project.articleType} article.`, evidenceRefs: [], asOf: today },
  ]
  if (radarOpp) verifiedFacts.push({
    id: 'fact-radar',
    type: 'verified_fact',
    statement: `Radar opportunity ${radarOpp.id} (${radarOpp.kind}) scored ${radarOpp.score} with data strength ${radarOpp.dataStrength}${radarOpp.researchRequired ? ' — flagged researchRequired' : ''}.`,
    evidenceRefs: ['src-radar'],
    asOf: today,
  })

  const gaps: string[] = ['Add at least one external source or research note before this pack can be approved.']
  if (radarOpp?.researchRequired) gaps.push(`Radar reason: ${radarOpp.researchReason ?? '(unspecified)'} — resolve before approval.`)

  const quality: PackQuality = {
    status: 'needs_review',
    dataStrength: 'weak',
    sampleSize: 0,
    freshness: { asOf: today, daysOld: 0, isStale: false },
    publishable: false,
    reasons: ['Generic fallback pack — a bespoke recipe is needed before this can be marked publishable.'],
  }

  return {
    version:     1,
    recipe:      'generic_fallback',
    project,
    generatedAt,
    dataAsOf:    today,
    methodology: {
      summary:   `No bespoke recipe available. Bootstrap pack combining the project brief, any matching Radar opportunity, and up to 6 related published PokePrices articles. Human researchers must attach external sources / notes for any claims the article intends to make.`,
      filters:   [{ label: 'Article type', value: project.articleType }],
      excludedGroups: [],
      dedupKey:  '(n/a)',
    },
    verifiedFacts,
    derivedFindings: [],
    dataTables,
    internalSources,
    externalSources: [],
    internalLinks: relatedArticles.map(a => ({ label: a.headline, slug: a.slug, url: a.publicUrl ?? `https://www.pokeprices.io/insights/${a.slug}` })),
    visualOpportunities: [],
    warnings,
    researchGaps: gaps,
    rejectedClaims: [],
    notes: [],
    quarantinedRows: [],
    quality,
  }
}

function matchesProject(project: PackProjectRef, headline: string | null): boolean {
  const h = String(headline ?? '').toLowerCase()
  const t = project.title.toLowerCase()
  const titleWords = t.split(/\s+/).filter(w => w.length > 4)
  return titleWords.some(w => h.includes(w))
}
