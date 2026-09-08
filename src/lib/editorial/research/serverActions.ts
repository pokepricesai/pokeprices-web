// src/lib/editorial/research/serverActions.ts
//
// EIC Block 6 — server-side action handlers for the Research Room.
//
// These functions are the single source of truth for "what does a
// build / rebuild / approve / revoke / add-source / add-note /
// research-web / clear-discovered mean". The API route is a thin
// dispatcher over them; the intent is that unit + integration tests
// can call these directly.
//
// External Research Fix (2026-09):
//   * Rebuild preserves manual sources, notes, research questions,
//     and prior web-research telemetry (regardless of recipe).
//   * `researchWebForProject` runs one bounded Anthropic call with
//     the web_search tool; it merges discovered sources / facts /
//     contradictions into the current pack.
//   * `clearDiscoveredSources` is an Advanced reset that removes
//     web-discovered evidence but leaves manual + notes intact.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { runResearchRecipe, chooseRecipe } from './dispatch'
import { parseAnalystResponse, buildAnalystUserTurn, RESEARCH_ANALYST_SYSTEM_PROMPT, analystStyleFields } from './analystPrompt'
import { callAnthropicAndLog, type AnthropicMessage } from '@/lib/ai/anthropic'
import { auditFieldMap, buildStyleRepairUserTurn, type StyleAudit } from '../styleGuard'
import { buildEditorialContext } from '../context'
import {
  EXTERNAL_RESEARCH_SYSTEM_PROMPT,
  buildExternalResearchUserTurn,
  parseExternalResearchResponse,
  mergeExternalResearchIntoPack,
  EXTERNAL_RESEARCH_FALLBACK_SYSTEM_PROMPT,
  buildExternalResearchFallbackUserTurn,
} from './externalResearchAnalyst'
import { classifySourceTier, computeExternalQuality, buildExternalMethodology } from './externalResearch'
import type {
  EvidencePack, ResearchAnalysis, EditorialResearchRow,
  ResearchStatus, ExternalSource, ResearchNote, WebResearchMeta,
} from './types'

const ANALYST_MODEL = 'claude-sonnet-4-6'
const ANALYST_MAX_TOKENS = 3000
const EXTERNAL_RESEARCH_MODEL = 'claude-sonnet-4-6'
const EXTERNAL_RESEARCH_MAX_TOKENS = 6000
const EXTERNAL_RESEARCH_MAX_SEARCHES = 6
/** Fallback extractor uses the cheapest capable model. It never
 *  calls web_search — it only structures the primary call's output. */
const EXTERNAL_RESEARCH_FALLBACK_MODEL = 'claude-haiku-4-5'
const EXTERNAL_RESEARCH_FALLBACK_MAX_TOKENS = 2500
/** Cap the raw primary text we persist so the pack row stays small
 *  in Postgres jsonb. Enough to re-extract from; not so much that
 *  three back-to-back runs balloon storage. */
const EXTERNAL_RESEARCH_RAW_TEXT_CAP = 30_000

// ─────────────────────────────────────────────────────────────────
// Fetch
// ─────────────────────────────────────────────────────────────────

export async function fetchProject(projectId: number): Promise<{
  id:              number
  title:           string
  angle:           string | null
  article_type:    string
  status:          string
  target_publish_at: string | null
  notes:           string | null
  insights_id:     string | null
} | null> {
  const supa = getSupabaseServiceClient()
  const { data, error } = await supa.from('editorial_projects').select('*').eq('id', projectId).maybeSingle()
  if (error) throw new Error(`fetchProject: ${error.message}`)
  return (data ?? null) as any
}

export async function fetchResearch(projectId: number): Promise<EditorialResearchRow | null> {
  const supa = getSupabaseServiceClient()
  const { data, error } = await supa
    .from('editorial_research')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) throw new Error(`fetchResearch: ${error.message}`)
  return (data ?? null) as any
}

// ─────────────────────────────────────────────────────────────────
// Build / rebuild
// ─────────────────────────────────────────────────────────────────
//
// Rebuild ALWAYS passes the prior pack into the recipe so that
// manual sources, notes, research questions, and prior web-research
// telemetry can be preserved. Every recipe is responsible for
// honouring `options.previous`; the external_research recipe
// already does so.

export async function buildResearchForProject(projectId: number, opts: { rebuild?: boolean; force?: boolean; today?: string } = {}): Promise<{ row: EditorialResearchRow; pack: EvidencePack; recipe: string }> {
  const project = await fetchProject(projectId)
  if (!project) throw new Error('project not found')
  const existing = await fetchResearch(projectId)
  if (existing && existing.status === 'approved' && !opts.force) {
    throw new Error('research is currently approved; call rebuild with force=true to overwrite (this also revokes approval)')
  }
  if (existing && !opts.rebuild && existing.evidence_json) {
    throw new Error('research already exists; call rebuild instead')
  }

  const projectRef = {
    id: project.id, title: project.title, angle: project.angle,
    articleType: project.article_type, targetPublishAt: project.target_publish_at,
  }

  // External + generic recipes benefit from editorialContext for the
  // related-articles table + internal-link picking. Skip the fetch
  // for the internal-data recipes to keep them fast.
  const recipeId = chooseRecipe(projectRef)
  const context = (recipeId === 'external_research' || recipeId === 'generic_fallback')
    ? await safeBuildEditorialContext(opts.today)
    : undefined

  const previous = existing?.evidence_json ?? null

  const rawPack = await runResearchRecipe(projectRef, {
    today:    opts.today,
    context,
    previous,
  })

  // Cross-recipe preserve. Even the deterministic internal recipes
  // must not delete manually-attached external sources or notes on
  // rebuild — external editorial evidence can support an internal-
  // data article too.
  const pack = mergeManualEvidenceIntoRebuiltPack(rawPack, previous)

  const newStatus: ResearchStatus =
    pack.quality.status === 'blocked'       ? 'blocked'
    : pack.quality.status === 'needs_review' ? 'review_required'
    : 'gathering'

  const supa = getSupabaseServiceClient()
  const upsertPayload: Partial<EditorialResearchRow> & { project_id: number } = {
    project_id:    projectId,
    status:        newStatus,
    evidence_json: pack,
    // Rebuilds invalidate any prior analysis + revoke approval.
    analyst_json:  null,
    approved_at:   null,
    approved_by:   null,
    updated_at:    new Date().toISOString(),
  }
  const { data, error } = existing
    ? await supa.from('editorial_research').update(upsertPayload).eq('project_id', projectId).select('*').single()
    : await supa.from('editorial_research').insert([{ ...upsertPayload, created_at: new Date().toISOString() }]).select('*').single()
  if (error) throw new Error(`buildResearch upsert: ${error.message}`)
  return { row: data as any, pack, recipe: recipeId }
}

/** Cross-recipe safety net. If the newly-built pack doesn't already
 *  carry the manual sources / notes / questions from the previous
 *  pack, splice them in. External recipe already does this itself;
 *  this covers the deterministic internal recipes for the case
 *  where an admin attached an external source to a monthly report
 *  and then rebuilt. */
export function mergeManualEvidenceIntoRebuiltPack(next: EvidencePack, previous: EvidencePack | null): EvidencePack {
  if (!previous) return next
  const nextIds = new Set(next.externalSources.map(s => s.id))
  const missingManualSources = (previous.externalSources ?? [])
    .filter(s => (s.origin ?? 'manual') === 'manual')
    .filter(s => !nextIds.has(s.id))
  const missingNotes = (previous.notes ?? []).filter(n => !next.notes.some(x => x.id === n.id))
  return {
    ...next,
    externalSources:  missingManualSources.length === 0 ? next.externalSources : [...next.externalSources, ...missingManualSources],
    notes:            missingNotes.length === 0 ? next.notes : [...next.notes, ...missingNotes],
    researchQuestions: next.researchQuestions ?? previous.researchQuestions,
    webResearch:      next.webResearch ?? previous.webResearch,
    contradictions:   next.contradictions ?? previous.contradictions,
  }
}

async function safeBuildEditorialContext(_today?: string) {
  try { return await buildEditorialContext() }
  catch (e) {
    console.warn('[research] buildEditorialContext failed, continuing without:', e instanceof Error ? e.message : 'unknown')
    return undefined
  }
}

// ─────────────────────────────────────────────────────────────────
// Analyze (AI Research Analyst — internal-data packs)
// ─────────────────────────────────────────────────────────────────

export async function analyzeResearchForProject(projectId: number, adminEmail: string): Promise<{ row: EditorialResearchRow; analysis: ResearchAnalysis; styleRepairFired: boolean; usage: any }> {
  const existing = await fetchResearch(projectId)
  if (!existing || !existing.evidence_json) throw new Error('no evidence pack — build research first')
  const pack = existing.evidence_json as EvidencePack

  const userMessage = buildAnalystUserTurn(pack)
  const messages: AnthropicMessage[] = [{ role: 'user', content: userMessage }]

  const first = await callAnthropicAndLog({
    feature:     'editorial_research_analyst',
    model:       ANALYST_MODEL,
    system:      RESEARCH_ANALYST_SYSTEM_PROMPT,
    messages,
    max_tokens:  ANALYST_MAX_TOKENS,
    temperature: 0.3,
    cacheSystem: true,
    adminEmail,
    sessionId:   `research-${projectId}-${Date.now()}`,
  })
  if (!first.ok) throw new Error(`analyst call failed: ${first.error || 'unknown'}`)

  let analysis = parseAnalystResponse(first.text, pack)
  let audit: StyleAudit = auditFieldMap(analystStyleFields(analysis))
  let styleRepairFired = false
  let totalCostUsd = first.cost_usd
  let totalIn      = first.usage.input_tokens
  let totalOut     = first.usage.output_tokens

  if (audit.hasViolations) {
    const repairMessages: AnthropicMessage[] = [
      ...messages,
      { role: 'assistant', content: first.text },
      { role: 'user',      content: buildStyleRepairUserTurn(first.text, audit) },
    ]
    const repair = await callAnthropicAndLog({
      feature:     'editorial_research_analyst_repair',
      model:       ANALYST_MODEL,
      system:      RESEARCH_ANALYST_SYSTEM_PROMPT,
      messages:    repairMessages,
      max_tokens:  ANALYST_MAX_TOKENS,
      temperature: 0.2,
      cacheSystem: true,
      adminEmail,
      sessionId:   `research-${projectId}-repair-${Date.now()}`,
    })
    if (repair.ok) {
      const repaired = parseAnalystResponse(repair.text, pack)
      const secondAudit = auditFieldMap(analystStyleFields(repaired))
      styleRepairFired = true
      totalCostUsd += repair.cost_usd
      totalIn      += repair.usage.input_tokens
      totalOut     += repair.usage.output_tokens
      const improved = !secondAudit.hasViolations || secondAudit.violations.length < audit.violations.length
      if (improved && repaired.summary.length > 0) {
        analysis = repaired
      }
    }
  }

  analysis.usage = { input_tokens: totalIn, output_tokens: totalOut, cost_usd: totalCostUsd, latency_ms: first.latency_ms }

  const supa = getSupabaseServiceClient()
  const { data, error } = await supa
    .from('editorial_research')
    .update({ analyst_json: analysis, updated_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .select('*')
    .single()
  if (error) throw new Error(`analyst store: ${error.message}`)

  return { row: data as any, analysis, styleRepairFired, usage: analysis.usage }
}

// ─────────────────────────────────────────────────────────────────
// External Research Fix — web research call
// ─────────────────────────────────────────────────────────────────

export type ResearchWebResult = {
  row:            EditorialResearchRow
  pack:           EvidencePack
  discovered:     number
  facts:          number
  contradictions: number
  cost:           WebResearchMeta
}

export async function researchWebForProject(projectId: number, adminEmail: string, opts: { maxSearches?: number } = {}): Promise<ResearchWebResult> {
  const existing = await fetchResearch(projectId)
  if (!existing || !existing.evidence_json) throw new Error('no evidence pack — build research first')
  const pack = existing.evidence_json as EvidencePack
  if (pack.recipe !== 'external_research') {
    throw new Error(`research_web is only available for external_research packs (this pack is ${pack.recipe})`)
  }

  // Mark manual seeds so the prompt can list them and the pack can
  // show which sources were used as seeds.
  const seedSources = pack.externalSources
    .filter(s => (s.origin ?? 'manual') === 'manual')
    .map(s => ({
      ...s,
      sourceTier: s.sourceTier ?? classifySourceTier(s.url),
      isSeed:     true,
    }))

  const userMessage = buildExternalResearchUserTurn({
    project:         pack.project,
    seedSources,
    priorQuestions:  pack.researchQuestions ?? [],
    priorNotes:      pack.notes ?? [],
    today:           pack.dataAsOf,
  })

  const maxUses = Math.max(1, Math.min(12, opts.maxSearches ?? EXTERNAL_RESEARCH_MAX_SEARCHES))

  const call = await callAnthropicAndLog({
    feature:     'editorial_external_research',
    model:       EXTERNAL_RESEARCH_MODEL,
    system:      EXTERNAL_RESEARCH_SYSTEM_PROMPT,
    messages:    [{ role: 'user', content: userMessage }],
    max_tokens:  EXTERNAL_RESEARCH_MAX_TOKENS,
    temperature: 0.2,
    cacheSystem: true,
    webSearch:   { max_uses: maxUses },
    adminEmail,
    sessionId:   `external-research-${projectId}-${Date.now()}`,
  })
  if (!call.ok) throw new Error(`external research call failed: ${call.error || 'unknown'}${call.detail ? ' - ' + call.detail : ''}`)

  let parsed = parseExternalResearchResponse(call.text, {
    knownManualSourceIds: seedSources.map(s => s.id),
    citationsFromApi:     call.citations ?? [],
    now:                  new Date().toISOString(),
    adminEmail,
  })

  // External Research Fix v2 — if the primary Sonnet call returned
  // no structured facts but citations DID come through, fire a
  // single bounded Haiku extraction pass on the primary prose +
  // discovered sources. No web_search, no re-derivation.
  let fallbackCostUsd = 0
  let fallbackUsed = false
  const citationCount = (parsed.discoveredSources.length + (call.citations?.length ?? 0))
  if (parsed.verifiedFacts.length === 0 && citationCount >= 3 && call.text) {
    const fb = await runFactExtractionFallback({
      project:      pack.project,
      primaryText:  call.text,
      discovered:   parsed.discoveredSources,
      adminEmail,
      sessionSuffix: `external-research-${projectId}-fallback-${Date.now()}`,
    })
    if (fb) {
      parsed = {
        ...parsed,
        verifiedFacts:     fb.verifiedFacts,
        contradictions:    fb.contradictions.length > 0 ? fb.contradictions : parsed.contradictions,
        researchQuestions: fb.researchQuestions.length > 0 ? fb.researchQuestions : parsed.researchQuestions,
        researchGaps:      Array.from(new Set([...parsed.researchGaps, ...fb.researchGaps])),
      }
      fallbackCostUsd = fb.costUsd
      fallbackUsed = true
    }
  }

  const packWithSeedTiers: EvidencePack = {
    ...pack,
    externalSources: pack.externalSources.map(s => (s.origin ?? 'manual') === 'manual'
      ? { ...s, sourceTier: s.sourceTier ?? classifySourceTier(s.url) }
      : s,
    ),
  }

  const merged = mergeExternalResearchIntoPack(packWithSeedTiers, parsed)

  const webMeta: WebResearchMeta = {
    researchedAt: new Date().toISOString(),
    searchesUsed: call.webSearch?.searchesUsed ?? 0,
    costUsd:      Number((call.cost_usd + fallbackCostUsd).toFixed(6)),
    model:        call.model,
    latencyMs:    call.latency_ms,
    responsePreview: (call.text ?? '').slice(0, EXTERNAL_RESEARCH_RAW_TEXT_CAP),
    fallbackUsed,
    fallbackCostUsd: fallbackUsed ? fallbackCostUsd : undefined,
    fallbackModel:   fallbackUsed ? EXTERNAL_RESEARCH_FALLBACK_MODEL : undefined,
  }

  // Recompute quality from the enriched pack.
  const nextManualSources = merged.externalSources.filter(s => (s.origin ?? 'manual') === 'manual')
  const nextAllSources    = merged.externalSources
  const quality = computeExternalQuality({
    externalSources:  nextAllSources,
    verifiedFacts:    merged.verifiedFacts,
    hasWebResearch:   true,
    today:            pack.dataAsOf,
    webResearchedAt:  webMeta.researchedAt.slice(0, 10),
  })

  // Methodology summary must reflect the post-web state, not the
  // rebuild-time snapshot.
  const methodology = buildExternalMethodology({
    project:        pack.project,
    manualSources:  nextManualSources,
    allSources:     nextAllSources,
    notes:          merged.notes,
    webResearch:    webMeta,
  })

  const nextPack: EvidencePack = {
    ...merged,
    methodology,
    webResearch: webMeta,
    quality,
    warnings: merged.warnings.filter(w => w.id !== 'ext-no-sources'),
  }

  const supa = getSupabaseServiceClient()
  const newStatus: ResearchStatus = quality.status === 'blocked' ? 'blocked'
    : quality.status === 'needs_review' ? 'review_required'
    : 'gathering'
  const { data, error } = await supa
    .from('editorial_research')
    .update({ evidence_json: nextPack, status: newStatus, updated_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .select('*')
    .single()
  if (error) throw new Error(`research_web persist: ${error.message}`)

  return {
    row:            data as any,
    pack:           nextPack,
    discovered:     parsed.discoveredSources.length,
    facts:          parsed.verifiedFacts.length,
    contradictions: parsed.contradictions.length,
    cost:           webMeta,
  }
}

// ─────────────────────────────────────────────────────────────────
// External Research Fix v2 — fact-extraction helpers
// ─────────────────────────────────────────────────────────────────

type FallbackResult = {
  verifiedFacts:     import('./types').VerifiedFact[]
  contradictions:    import('./types').ClaimContradiction[]
  researchQuestions: string[]
  researchGaps:      string[]
  costUsd:           number
}

async function runFactExtractionFallback(args: {
  project:       EvidencePack['project']
  primaryText:   string
  discovered:    readonly ExternalSource[]
  adminEmail:    string
  sessionSuffix: string
}): Promise<FallbackResult | null> {
  const call = await callAnthropicAndLog({
    feature:     'editorial_external_research_fallback',
    model:       EXTERNAL_RESEARCH_FALLBACK_MODEL,
    system:      EXTERNAL_RESEARCH_FALLBACK_SYSTEM_PROMPT,
    messages:    [{ role: 'user', content: buildExternalResearchFallbackUserTurn({ project: args.project, primaryText: args.primaryText, discovered: args.discovered }) }],
    max_tokens:  EXTERNAL_RESEARCH_FALLBACK_MAX_TOKENS,
    temperature: 0.1,
    cacheSystem: true,
    adminEmail:  args.adminEmail,
    sessionId:   args.sessionSuffix,
  })
  if (!call.ok) {
    console.warn('[external_research_fallback] call failed:', call.error, call.detail)
    return null
  }
  const parsed = parseExternalResearchResponse(call.text, {
    knownManualSourceIds: [],
    citationsFromApi:     [],   // fallback must not invent new sources
    now:                  new Date().toISOString(),
    adminEmail:           args.adminEmail,
  })
  // The parser will drop facts whose evidenceRefs don't exist. Rebuild
  // the "known set" as {every discovered source id + any src-* the
  // fallback minted} so facts against the primary sources survive.
  const discoveredIds = new Set(args.discovered.map(s => s.id))
  const survivingFacts = parsed.verifiedFacts.filter(f => f.evidenceRefs.every(r => discoveredIds.has(r)))
  const survivingContradictions = parsed.contradictions.filter(c => c.positions.every(p => p.evidenceRefs.every(r => discoveredIds.has(r))))
  return {
    verifiedFacts:     survivingFacts,
    contradictions:    survivingContradictions,
    researchQuestions: parsed.researchQuestions,
    researchGaps:      parsed.researchGaps,
    costUsd:           call.cost_usd,
  }
}

export type ReExtractResult = {
  row:            EditorialResearchRow
  pack:           EvidencePack
  facts:          number
  contradictions: number
  costUsd:        number
  usedPrimaryText: boolean
}

/** External Research Fix v2 — re-run the Haiku fact extractor
 *  against the pack's already-persisted primary web-research prose +
 *  discovered sources. No new web_search. This is what recovers the
 *  facts from a run whose primary Sonnet call returned prose-only. */
export async function reExtractFactsForProject(projectId: number, adminEmail: string): Promise<ReExtractResult> {
  const existing = await fetchResearch(projectId)
  if (!existing || !existing.evidence_json) throw new Error('no evidence pack — build research first')
  const pack = existing.evidence_json as EvidencePack
  if (pack.recipe !== 'external_research') {
    throw new Error(`re_extract_facts is only available for external_research packs (this pack is ${pack.recipe})`)
  }
  if (!pack.webResearch) {
    throw new Error('no prior web research to re-extract from — click "Research web" first')
  }

  const primaryText = pack.webResearch.responsePreview ?? ''
  const discovered = pack.externalSources.filter(s => (s.origin ?? 'manual') === 'web')
  if (discovered.length === 0) {
    throw new Error('no web-discovered sources on this pack; nothing to extract from')
  }

  const fb = await runFactExtractionFallback({
    project:      pack.project,
    primaryText,               // '' is fine — prompt handles it (URL-only mode)
    discovered,
    adminEmail,
    sessionSuffix: `external-research-${projectId}-reextract-${Date.now()}`,
  })
  if (!fb) throw new Error('fact-extraction fallback call failed')

  // Keep existing facts that trace to manual sources; discard prior
  // web-derived facts and replace with the new extraction.
  const manualIds = new Set(pack.externalSources.filter(s => (s.origin ?? 'manual') === 'manual').map(s => s.id))
  const survivingManualFacts = pack.verifiedFacts.filter(f => {
    if (f.evidenceRefs.length === 0) return true
    return f.evidenceRefs.every(r => manualIds.has(r))
  })
  const nextFacts = [...survivingManualFacts, ...fb.verifiedFacts]

  const nextWebResearch: WebResearchMeta = {
    ...pack.webResearch,
    fallbackUsed: true,
    fallbackCostUsd: Number(((pack.webResearch.fallbackCostUsd ?? 0) + fb.costUsd).toFixed(6)),
    fallbackModel: EXTERNAL_RESEARCH_FALLBACK_MODEL,
    costUsd: Number(((pack.webResearch.costUsd ?? 0) + fb.costUsd).toFixed(6)),
  }

  const nextAllSources = pack.externalSources
  const nextManualSources = nextAllSources.filter(s => (s.origin ?? 'manual') === 'manual')
  const quality = computeExternalQuality({
    externalSources: nextAllSources,
    verifiedFacts:   nextFacts,
    hasWebResearch:  true,
    today:           pack.dataAsOf,
    webResearchedAt: pack.webResearch.researchedAt.slice(0, 10),
  })
  const methodology = buildExternalMethodology({
    project:       pack.project,
    manualSources: nextManualSources,
    allSources:    nextAllSources,
    notes:         pack.notes,
    webResearch:   nextWebResearch,
  })

  const nextPack: EvidencePack = {
    ...pack,
    verifiedFacts:     nextFacts,
    contradictions:    fb.contradictions.length > 0 ? fb.contradictions : pack.contradictions,
    researchQuestions: fb.researchQuestions.length > 0 ? fb.researchQuestions : pack.researchQuestions,
    researchGaps:      Array.from(new Set([...pack.researchGaps, ...fb.researchGaps])),
    webResearch:       nextWebResearch,
    methodology,
    quality,
  }

  const supa = getSupabaseServiceClient()
  const newStatus: ResearchStatus = quality.status === 'blocked' ? 'blocked'
    : quality.status === 'needs_review' ? 'review_required'
    : 'gathering'
  const { data, error } = await supa
    .from('editorial_research')
    .update({ evidence_json: nextPack, status: newStatus, updated_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .select('*')
    .single()
  if (error) throw new Error(`reExtractFacts persist: ${error.message}`)

  return {
    row:  data as any,
    pack: nextPack,
    facts:          fb.verifiedFacts.length,
    contradictions: fb.contradictions.length,
    costUsd:        fb.costUsd,
    usedPrimaryText: primaryText.length > 100,
  }
}

export async function clearDiscoveredSources(projectId: number): Promise<EditorialResearchRow> {
  const existing = await fetchResearch(projectId)
  if (!existing || !existing.evidence_json) throw new Error('no evidence pack')
  const pack = existing.evidence_json as EvidencePack
  const manualSources = pack.externalSources.filter(s => (s.origin ?? 'manual') === 'manual')
  const manualIds = new Set(manualSources.map(s => s.id))
  // Facts sourced purely by web are dropped.
  const survivingFacts = pack.verifiedFacts.filter(f => {
    if (f.evidenceRefs.length === 0) return true
    return f.evidenceRefs.every(r => manualIds.has(r))
  })
  const nextPack: EvidencePack = {
    ...pack,
    externalSources: manualSources,
    verifiedFacts:   survivingFacts,
    contradictions:  [],
    webResearch:     undefined,
    quality:         computeExternalQuality({
      externalSources: manualSources,
      verifiedFacts:   survivingFacts,
      hasWebResearch:  false,
      today:           pack.dataAsOf,
    }),
  }
  return persistPack(projectId, nextPack)
}

// ─────────────────────────────────────────────────────────────────
// Approve / revoke
// ─────────────────────────────────────────────────────────────────

export async function approveResearch(projectId: number, adminEmail: string): Promise<EditorialResearchRow> {
  const existing = await fetchResearch(projectId)
  if (!existing || !existing.evidence_json) throw new Error('no research pack to approve')
  const pack = existing.evidence_json as EvidencePack
  if (pack.quality.status === 'blocked')      throw new Error('pack is blocked — resolve quality issues before approving')
  if (!pack.quality.publishable)              throw new Error('pack is not publishable — see quality.reasons')
  if (pack.warnings.some(w => w.severity === 'critical')) throw new Error('pack has critical warnings — resolve them before approving')
  // Block 6B — refuse approval when a quarantined row is load-bearing
  // (identity collision on a card the article names, for example).
  // Passive contaminants (extreme monthly-mover outliers isolated
  // from the top-N tables) do NOT block approval — the philosophy
  // is "isolate bad evidence, don't let it contaminate the claim".
  const loadBearing = (pack.quarantinedRows ?? []).filter(q => q.contaminatesPublishable)
  if (loadBearing.length > 0) {
    throw new Error(`${loadBearing.length} quarantined row(s) contaminate a publishable claim and must be resolved before approval: ${loadBearing.map(q => q.message).join('; ').slice(0, 500)}`)
  }

  const supa = getSupabaseServiceClient()
  const { data, error } = await supa
    .from('editorial_research')
    .update({
      status:      'approved',
      approved_at: new Date().toISOString(),
      approved_by: adminEmail,
      updated_at:  new Date().toISOString(),
    })
    .eq('project_id', projectId)
    .select('*')
    .single()
  if (error) throw new Error(`approveResearch: ${error.message}`)
  return data as any
}

export async function revokeResearchApproval(projectId: number): Promise<EditorialResearchRow> {
  const existing = await fetchResearch(projectId)
  if (!existing) throw new Error('no research pack')
  const pack = existing.evidence_json as EvidencePack | null
  const newStatus: ResearchStatus =
    !pack                                  ? 'not_started'
    : pack.quality.status === 'blocked'    ? 'blocked'
    : pack.quality.status === 'needs_review' ? 'review_required'
    : 'gathering'
  const supa = getSupabaseServiceClient()
  const { data, error } = await supa
    .from('editorial_research')
    .update({
      status:      newStatus,
      approved_at: null,
      approved_by: null,
      updated_at:  new Date().toISOString(),
    })
    .eq('project_id', projectId)
    .select('*')
    .single()
  if (error) throw new Error(`revokeResearchApproval: ${error.message}`)
  return data as any
}

// ─────────────────────────────────────────────────────────────────
// External sources + research notes
// ─────────────────────────────────────────────────────────────────

export async function addExternalSource(projectId: number, source: Omit<ExternalSource, 'id' | 'kind' | 'addedAt' | 'addedBy'>, adminEmail: string): Promise<EditorialResearchRow> {
  const existing = await fetchResearch(projectId)
  if (!existing || !existing.evidence_json) throw new Error('no evidence pack; build first')
  const pack = existing.evidence_json as EvidencePack
  const url = String(source.url ?? '').slice(0, 2000)
  const title = String(source.title ?? '').slice(0, 500)
  if (!url || !title) throw new Error('url and title are required')
  const added: ExternalSource = {
    id: `ext-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    kind: 'external',
    addedAt: new Date().toISOString(),
    addedBy: adminEmail,
    url,
    title,
    publisher: source.publisher ? String(source.publisher).slice(0, 200) : undefined,
    publicationDate: source.publicationDate ? String(source.publicationDate).slice(0, 40) : undefined,
    note: source.note ? String(source.note).slice(0, 2000) : undefined,
    supportsFactId: source.supportsFactId ? String(source.supportsFactId).slice(0, 100) : undefined,
    origin:     'manual',
    sourceTier: source.sourceTier ?? classifySourceTier(url),
  }
  const newPack: EvidencePack = { ...pack, externalSources: [...pack.externalSources, added] }
  // If this is an external-research pack, recompute quality so a
  // freshly-attached Tier-1 source can flip it publishable.
  if (pack.recipe === 'external_research') {
    newPack.quality = computeExternalQuality({
      externalSources:  newPack.externalSources,
      verifiedFacts:    newPack.verifiedFacts,
      hasWebResearch:   !!newPack.webResearch,
      today:            newPack.dataAsOf,
      webResearchedAt:  newPack.webResearch?.researchedAt?.slice(0, 10),
    })
    newPack.warnings = newPack.warnings.filter(w => w.id !== 'ext-no-sources')
  }
  return persistPack(projectId, newPack)
}

export async function removeExternalSource(projectId: number, sourceId: string): Promise<EditorialResearchRow> {
  const existing = await fetchResearch(projectId)
  if (!existing || !existing.evidence_json) throw new Error('no evidence pack')
  const pack = existing.evidence_json as EvidencePack
  const newPack: EvidencePack = { ...pack, externalSources: pack.externalSources.filter(s => s.id !== sourceId) }
  if (pack.recipe === 'external_research') {
    newPack.quality = computeExternalQuality({
      externalSources:  newPack.externalSources,
      verifiedFacts:    newPack.verifiedFacts,
      hasWebResearch:   !!newPack.webResearch,
      today:            newPack.dataAsOf,
      webResearchedAt:  newPack.webResearch?.researchedAt?.slice(0, 10),
    })
  }
  return persistPack(projectId, newPack)
}

export async function addResearchNote(projectId: number, body: string, adminEmail: string): Promise<EditorialResearchRow> {
  const existing = await fetchResearch(projectId)
  if (!existing || !existing.evidence_json) throw new Error('no evidence pack')
  const pack = existing.evidence_json as EvidencePack
  const note: ResearchNote = {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    addedAt: new Date().toISOString(),
    addedBy: adminEmail,
    body: String(body ?? '').slice(0, 8000),
  }
  if (!note.body.trim()) throw new Error('note body is required')
  const newPack: EvidencePack = { ...pack, notes: [...pack.notes, note] }
  return persistPack(projectId, newPack)
}

export async function removeResearchNote(projectId: number, noteId: string): Promise<EditorialResearchRow> {
  const existing = await fetchResearch(projectId)
  if (!existing || !existing.evidence_json) throw new Error('no evidence pack')
  const pack = existing.evidence_json as EvidencePack
  const newPack: EvidencePack = { ...pack, notes: pack.notes.filter(n => n.id !== noteId) }
  return persistPack(projectId, newPack)
}

/** Final Data Trust Patch — approve a large-move candidate so the
 *  Writer may use it. Slug must appear in one of the pack's
 *  manual-review tables; anything else is rejected. */
export async function approveLargeMover(projectId: number, cardSlug: string): Promise<EditorialResearchRow> {
  const existing = await fetchResearch(projectId)
  if (!existing || !existing.evidence_json) throw new Error('no evidence pack')
  const pack = existing.evidence_json as EvidencePack
  const eligible = new Set<string>()
  for (const t of pack.dataTables) {
    if (!/^mover-review-(risers|fallers)-/.test(t.id)) continue
    for (const r of t.rows) if ((r as any).cardSlug) eligible.add(String((r as any).cardSlug))
  }
  if (!eligible.has(cardSlug)) throw new Error(`slug ${cardSlug} is not in any manual-review mover table`)
  const current = new Set<string>(pack.approvedLargeMoverSlugs ?? [])
  current.add(cardSlug)
  const newPack: EvidencePack = { ...pack, approvedLargeMoverSlugs: Array.from(current).sort() }
  return persistPack(projectId, newPack)
}

export async function revokeLargeMover(projectId: number, cardSlug: string): Promise<EditorialResearchRow> {
  const existing = await fetchResearch(projectId)
  if (!existing || !existing.evidence_json) throw new Error('no evidence pack')
  const pack = existing.evidence_json as EvidencePack
  const current = (pack.approvedLargeMoverSlugs ?? []).filter(s => s !== cardSlug)
  const newPack: EvidencePack = { ...pack, approvedLargeMoverSlugs: current }
  return persistPack(projectId, newPack)
}

async function persistPack(projectId: number, pack: EvidencePack): Promise<EditorialResearchRow> {
  const supa = getSupabaseServiceClient()
  const { data, error } = await supa
    .from('editorial_research')
    .update({ evidence_json: pack, updated_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .select('*')
    .single()
  if (error) throw new Error(`persistPack: ${error.message}`)
  return data as any
}

// ─────────────────────────────────────────────────────────────────
// Bulk fetch (for HQ chip rendering)
// ─────────────────────────────────────────────────────────────────

export async function fetchResearchStatusForProjects(projectIds: readonly number[]): Promise<Map<number, ResearchStatus>> {
  if (projectIds.length === 0) return new Map()
  const supa = getSupabaseServiceClient()
  const { data, error } = await supa
    .from('editorial_research')
    .select('project_id, status')
    .in('project_id', projectIds as number[])
  if (error) throw new Error(`fetchResearchStatusForProjects: ${error.message}`)
  const m = new Map<number, ResearchStatus>()
  for (const r of (data ?? []) as any[]) m.set(Number(r.project_id), r.status as ResearchStatus)
  return m
}
