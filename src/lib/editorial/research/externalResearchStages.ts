// src/lib/editorial/research/externalResearchStages.ts
//
// External Research Fix v3 — resumable stage machine.
//
// The synchronous "one big Sonnet call" flow (~102s on the first
// live run) hit Cloudflare's edge idle limit and returned HTTP 524
// on the second production attempt. This mirrors the Writer's
// Block 9B stage-machine fix: split the work into bounded stages,
// persist state per stage, poll from the UI. Each stage does AT
// MOST one Claude call and completes well under any Vercel plan's
// synchronous ceiling.
//
// Stages
//   queued
//     → researching_primary        (≤ 3 web searches, Tier-1 focus)
//     → researching_supporting     (≤ 3 web searches, Tier-2 fill-in)
//     → extracting                 (Haiku, NO web_search)
//     → finalizing                 (deterministic merge into pack)
//     → complete
//   failed  (from any of the above; retry resumes at failedStage)
//
// Total web-search budget stays at 6 across the whole run — identical
// to the pre-split ceiling. If a browser refresh interrupts a run,
// the state persisted on `evidence_json.externalResearchRun` lets
// the same run resume without re-spending completed stages.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { callAnthropicAndLog } from '@/lib/ai/anthropic'
import type {
  EvidencePack, ExternalSource, VerifiedFact, ClaimContradiction,
  ExternalResearchRun, ExternalResearchStage, ResearchStatus,
  WebResearchMeta, EditorialResearchRow,
} from './types'
import {
  EXTERNAL_RESEARCH_PRIMARY_SYSTEM_PROMPT,
  EXTERNAL_RESEARCH_SUPPORTING_SYSTEM_PROMPT,
  EXTERNAL_RESEARCH_FALLBACK_SYSTEM_PROMPT,
  buildPrimaryStageUserTurn,
  buildSupportingStageUserTurn,
  buildExternalResearchFallbackUserTurn,
  parseExternalResearchResponse,
  mergeExternalResearchIntoPack,
  renumberSourcesForExtractor,
} from './externalResearchAnalyst'
import {
  classifySourceTier, computeExternalQuality,
  buildExternalMethodology, domainOf,
} from './externalResearch'
import type { ExtractionDiagnostics } from './types'

// ─────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────

const PRIMARY_MODEL     = 'claude-sonnet-4-6'
const SUPPORTING_MODEL  = 'claude-sonnet-4-6'
const EXTRACTOR_MODEL   = 'claude-haiku-4-5'

const PRIMARY_MAX_TOKENS    = 4000
const SUPPORTING_MAX_TOKENS = 4000
const EXTRACTOR_MAX_TOKENS  = 2500

/** Web-search budgets per stage. Total = 6, same as v1. */
const PRIMARY_MAX_SEARCHES    = 3
const SUPPORTING_MAX_SEARCHES = 3

/** Bounded prose stored per stage so the extractor can reason from
 *  the persisted evidence without hitting the web again. */
const PROSE_CAP = 30_000

const STAGE_LABEL: Record<ExternalResearchStage, string> = {
  queued:                 'Queued',
  researching_primary:    'Searching official sources',
  researching_supporting: 'Researching supporting sources',
  extracting:             'Building evidence',
  finalizing:             'Checking source quality',
  complete:               'Complete',
  failed:                 'Failed',
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

export type StageAdvanceResult = {
  ok:       true
  row:      EditorialResearchRow
  pack:     EvidencePack
  run:      ExternalResearchRun
  finished: boolean
}

/** Kick off a new run. If a run is already in progress and not
 *  failed/complete, resume it (returns current state, no work done). */
export async function startExternalResearchRun(projectId: number, adminEmail: string): Promise<{ row: EditorialResearchRow; pack: EvidencePack; run: ExternalResearchRun; resumed: boolean }> {
  const supa = getSupabaseServiceClient()
  const { data: rRow, error } = await supa.from('editorial_research').select('*').eq('project_id', projectId).maybeSingle()
  if (error) throw new Error(`fetchResearch: ${error.message}`)
  if (!rRow || !(rRow as any).evidence_json) throw new Error('no evidence pack — build research first')
  const pack = (rRow as any).evidence_json as EvidencePack
  if (pack.recipe !== 'external_research') {
    throw new Error(`research_web_start is only available for external_research packs (this pack is ${pack.recipe})`)
  }

  const existingRun = pack.externalResearchRun
  const inFlight = existingRun && existingRun.stage !== 'complete' && existingRun.stage !== 'failed'
  if (inFlight) {
    return { row: rRow as any, pack, run: existingRun!, resumed: true }
  }

  const now = new Date().toISOString()
  const run: ExternalResearchRun = {
    id:           `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    stage:        'queued',
    stageLabel:   STAGE_LABEL['queued'],
    startedAt:    now,
    updatedAt:    now,
    searchesUsed: 0,
    costUsd:      0,
    tokens:       { input: 0, output: 0 },
    discoveredSources: [],
    stageTimings: {},
    // Clear any prior failure state.
    failedStage:  undefined,
    error:        undefined,
  }

  const nextPack: EvidencePack = { ...pack, externalResearchRun: run }
  const persisted = await persistPack(supa, projectId, nextPack, existingStatusFor(pack.quality.status))
  return { row: persisted, pack: nextPack, run, resumed: false }
}

/** Advance the in-flight run by one stage. Never runs more than one
 *  Claude call per invocation. Callers (the UI) POST this
 *  repeatedly until run.stage === 'complete' or 'failed'. */
export async function advanceExternalResearchRun(projectId: number, adminEmail: string): Promise<StageAdvanceResult> {
  const supa = getSupabaseServiceClient()
  const { data: rRow, error } = await supa.from('editorial_research').select('*').eq('project_id', projectId).maybeSingle()
  if (error) throw new Error(`fetchResearch: ${error.message}`)
  if (!rRow || !(rRow as any).evidence_json) throw new Error('no evidence pack')
  const pack = (rRow as any).evidence_json as EvidencePack
  if (pack.recipe !== 'external_research') throw new Error(`stage machine is only for external_research packs`)
  const run = pack.externalResearchRun
  if (!run) throw new Error('no active run — call research_web_start first')
  if (run.stage === 'complete' || run.stage === 'failed') {
    return { ok: true, row: rRow as any, pack, run, finished: true }
  }

  const stageStartMs = Date.now()
  let updatedPack: EvidencePack
  try {
    switch (run.stage) {
      case 'queued': {
        const advanced: ExternalResearchRun = {
          ...run, stage: 'researching_primary', stageLabel: STAGE_LABEL['researching_primary'],
          updatedAt: new Date().toISOString(),
          stageTimings: { ...run.stageTimings, queued: Date.now() - stageStartMs },
        }
        updatedPack = { ...pack, externalResearchRun: advanced }
        break
      }
      case 'researching_primary':
        updatedPack = await stagePrimary(pack, adminEmail, stageStartMs)
        break
      case 'researching_supporting':
        updatedPack = await stageSupporting(pack, adminEmail, stageStartMs)
        break
      case 'extracting':
        updatedPack = await stageExtract(pack, adminEmail, stageStartMs)
        break
      case 'finalizing':
        updatedPack = stageFinalize(pack, stageStartMs)
        break
      default:
        return { ok: true, row: rRow as any, pack, run, finished: true }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    const failed: ExternalResearchRun = {
      ...run,
      stage:       'failed',
      stageLabel:  STAGE_LABEL['failed'],
      failedStage: run.stage,
      error:       message.slice(0, 500),
      updatedAt:   new Date().toISOString(),
    }
    updatedPack = { ...pack, externalResearchRun: failed }
  }

  const nextRun = updatedPack.externalResearchRun!
  const rowStatus = nextRun.stage === 'complete' ? existingStatusFor(updatedPack.quality.status) : (rRow as any).status as ResearchStatus
  const persisted = await persistPack(supa, projectId, updatedPack, rowStatus)
  const finished = nextRun.stage === 'complete' || nextRun.stage === 'failed'
  return { ok: true, row: persisted, pack: updatedPack, run: nextRun, finished }
}

/** Retry the most recent failed run from its failedStage. If the
 *  run isn't in failed state, this is a no-op returning current
 *  state. Never repeats successful stages. */
export async function retryExternalResearchRun(projectId: number, adminEmail: string): Promise<StageAdvanceResult> {
  const supa = getSupabaseServiceClient()
  const { data: rRow, error } = await supa.from('editorial_research').select('*').eq('project_id', projectId).maybeSingle()
  if (error) throw new Error(`fetchResearch: ${error.message}`)
  if (!rRow || !(rRow as any).evidence_json) throw new Error('no evidence pack')
  const pack = (rRow as any).evidence_json as EvidencePack
  const run = pack.externalResearchRun
  if (!run) throw new Error('no run to retry')
  if (run.stage !== 'failed' || !run.failedStage) {
    return { ok: true, row: rRow as any, pack, run, finished: run.stage === 'complete' }
  }
  const resumed: ExternalResearchRun = {
    ...run,
    stage:      run.failedStage,
    stageLabel: STAGE_LABEL[run.failedStage],
    error:      undefined,
    failedStage: undefined,
    updatedAt:  new Date().toISOString(),
  }
  const persistedPack: EvidencePack = { ...pack, externalResearchRun: resumed }
  await persistPack(supa, projectId, persistedPack, (rRow as any).status as ResearchStatus)
  return advanceExternalResearchRun(projectId, adminEmail)
}

// ─────────────────────────────────────────────────────────────────
// Stage handlers
// ─────────────────────────────────────────────────────────────────

async function stagePrimary(pack: EvidencePack, adminEmail: string, stageStartMs: number): Promise<EvidencePack> {
  const run = pack.externalResearchRun!
  const seedSources = pack.externalSources
    .filter(s => (s.origin ?? 'manual') === 'manual')
    .map(s => ({ ...s, sourceTier: s.sourceTier ?? classifySourceTier(s.url), isSeed: true }))

  const userMessage = buildPrimaryStageUserTurn({
    project:     pack.project,
    seedSources,
    today:       pack.dataAsOf,
  })

  const call = await callAnthropicAndLog({
    feature:     'editorial_external_research_primary',
    model:       PRIMARY_MODEL,
    system:      EXTERNAL_RESEARCH_PRIMARY_SYSTEM_PROMPT,
    messages:    [{ role: 'user', content: userMessage }],
    max_tokens:  PRIMARY_MAX_TOKENS,
    temperature: 0.2,
    cacheSystem: true,
    webSearch:   { max_uses: PRIMARY_MAX_SEARCHES },
    adminEmail,
    sessionId:   `external-research-${pack.project.id}-primary-${run.id}`,
  })
  if (!call.ok) throw new Error(`primary discovery failed: ${call.error || 'unknown'}${call.detail ? ' - ' + call.detail : ''}`)

  const discoveredFromCitations = citationsToSources(call.citations ?? [], new Set<string>(), new Date().toISOString())
  const nextRun: ExternalResearchRun = {
    ...run,
    stage:        'researching_supporting',
    stageLabel:   STAGE_LABEL['researching_supporting'],
    searchesUsed: run.searchesUsed + (call.webSearch?.searchesUsed ?? 0),
    costUsd:      round6(run.costUsd + call.cost_usd),
    tokens: {
      input:  run.tokens.input  + call.usage.input_tokens,
      output: run.tokens.output + call.usage.output_tokens,
    },
    discoveredSources: mergeSources(run.discoveredSources, discoveredFromCitations),
    primaryText:  clipText(call.text ?? '', PROSE_CAP),
    stageTimings: { ...run.stageTimings, researching_primary: Date.now() - stageStartMs },
    updatedAt:    new Date().toISOString(),
  }
  return { ...pack, externalResearchRun: nextRun }
}

async function stageSupporting(pack: EvidencePack, adminEmail: string, stageStartMs: number): Promise<EvidencePack> {
  const run = pack.externalResearchRun!
  const seedSources = pack.externalSources
    .filter(s => (s.origin ?? 'manual') === 'manual')
    .map(s => ({ ...s, sourceTier: s.sourceTier ?? classifySourceTier(s.url), isSeed: true }))

  const userMessage = buildSupportingStageUserTurn({
    project:        pack.project,
    seedSources,
    primarySources: run.discoveredSources,
    primaryText:    run.primaryText ?? '',
    today:          pack.dataAsOf,
  })

  const call = await callAnthropicAndLog({
    feature:     'editorial_external_research_supporting',
    model:       SUPPORTING_MODEL,
    system:      EXTERNAL_RESEARCH_SUPPORTING_SYSTEM_PROMPT,
    messages:    [{ role: 'user', content: userMessage }],
    max_tokens:  SUPPORTING_MAX_TOKENS,
    temperature: 0.2,
    cacheSystem: true,
    webSearch:   { max_uses: SUPPORTING_MAX_SEARCHES },
    adminEmail,
    sessionId:   `external-research-${pack.project.id}-supporting-${run.id}`,
  })
  if (!call.ok) throw new Error(`supporting discovery failed: ${call.error || 'unknown'}${call.detail ? ' - ' + call.detail : ''}`)

  const seenUrls = new Set(run.discoveredSources.map(s => normUrl(s.url)))
  const discoveredFromCitations = citationsToSources(call.citations ?? [], seenUrls, new Date().toISOString())
  const nextRun: ExternalResearchRun = {
    ...run,
    stage:         'extracting',
    stageLabel:    STAGE_LABEL['extracting'],
    searchesUsed:  run.searchesUsed + (call.webSearch?.searchesUsed ?? 0),
    costUsd:       round6(run.costUsd + call.cost_usd),
    tokens: {
      input:  run.tokens.input  + call.usage.input_tokens,
      output: run.tokens.output + call.usage.output_tokens,
    },
    discoveredSources: mergeSources(run.discoveredSources, discoveredFromCitations),
    supportingText: clipText(call.text ?? '', PROSE_CAP),
    stageTimings:  { ...run.stageTimings, researching_supporting: Date.now() - stageStartMs },
    updatedAt:     new Date().toISOString(),
  }
  return { ...pack, externalResearchRun: nextRun }
}

async function stageExtract(pack: EvidencePack, adminEmail: string, stageStartMs: number): Promise<EvidencePack> {
  const run = pack.externalResearchRun!

  // External Research Fix v4 — remap arbitrary discovered ids to
  // stable src_NNN ids for the extractor. Haiku must reproduce the
  // ids verbatim in evidenceRefs; short, uniform ids drop mis-typing
  // to near zero. After parsing, we translate refs BACK to the
  // pack's persistent ids before validation and persistence.
  const { remapped, idMap, toOriginal } = renumberSourcesForExtractor(run.discoveredSources)

  const userMessage = buildExternalResearchFallbackUserTurn({
    project:        pack.project,
    primaryText:    run.primaryText ?? '',
    supportingText: run.supportingText,
    discovered:     remapped,
  })

  const call = await callAnthropicAndLog({
    feature:     'editorial_external_research_extract',
    model:       EXTRACTOR_MODEL,
    system:      EXTERNAL_RESEARCH_FALLBACK_SYSTEM_PROMPT,
    messages:    [{ role: 'user', content: userMessage }],
    max_tokens:  EXTRACTOR_MAX_TOKENS,
    temperature: 0.1,
    cacheSystem: true,
    adminEmail,
    sessionId:   `external-research-${pack.project.id}-extract-${run.id}`,
  })
  if (!call.ok) throw new Error(`extraction failed: ${call.error || 'unknown'}${call.detail ? ' - ' + call.detail : ''}`)

  // Parse with the stable ids as the "known" set. The parser will
  // filter refs to only known ids at ref-level; we still do a
  // whole-fact validation below to build diagnostics on drops.
  const manualPackIds = pack.externalSources.filter(s => (s.origin ?? 'manual') === 'manual').map(s => s.id)
  const aliasesHit: string[] = []
  const stableKnown = idMap.map(m => m.stableId)
  const parsed = parseExternalResearchResponse(call.text, {
    knownManualSourceIds: [...stableKnown, ...manualPackIds],
    citationsFromApi:     [],
    now:                  new Date().toISOString(),
    adminEmail,
    aliasesHit,
    skipRefValidation:    true,   // we translate + validate below, feeds diagnostics
  })

  // Translate stable ids -> pack's persistent ids. Ref-level drops
  // (unknown ids after alias tolerance) are attributed to rejectionReasons.
  const rejectionReasons: ExtractionDiagnostics['rejectionReasons'] = []
  const translateRefs = (factId: string | undefined, refs: readonly string[]): { keep: boolean; translated: string[] } => {
    const translated: string[] = []
    const missing: string[] = []
    for (const r of refs) {
      const orig = toOriginal.get(r) ?? (manualPackIds.includes(r) ? r : undefined)
      if (orig) translated.push(orig)
      else missing.push(r)
    }
    if (missing.length > 0) rejectionReasons.push({ factId, refs: Array.from(refs), reason: `evidenceRef(s) not in src_NNN mapping: ${missing.join(', ')}` })
    return { keep: translated.length > 0, translated }
  }

  const rawFactCount = parsed.verifiedFacts.length
  const facts = parsed.verifiedFacts.reduce<typeof parsed.verifiedFacts>((acc, f) => {
    const { keep, translated } = translateRefs(f.id, f.evidenceRefs)
    if (keep) acc.push({ ...f, evidenceRefs: translated })
    return acc
  }, [])

  const contradictions = parsed.contradictions.reduce<typeof parsed.contradictions>((acc, c) => {
    const positions = c.positions.map(p => {
      const { keep, translated } = translateRefs(undefined, p.evidenceRefs)
      return { ...p, evidenceRefs: translated, __keep: keep } as any
    })
    if (positions.every((p: any) => p.__keep)) {
      acc.push({ ...c, positions: positions.map(({ __keep: _k, ...rest }: any) => rest) })
    } else {
      rejectionReasons.push({ factId: c.id, refs: c.positions.flatMap(p => Array.from(p.evidenceRefs)), reason: `contradiction dropped — at least one position had unresolved refs` })
    }
    return acc
  }, [])

  const diagnostics: ExtractionDiagnostics = {
    timestamp:                  new Date().toISOString(),
    extractorInputChars:        userMessage.length,
    extractorRawFactCount:      rawFactCount,
    extractorAcceptedFactCount: facts.length,
    extractorRejectedFactCount: Math.max(0, rawFactCount - facts.length),
    rejectionReasons:           rejectionReasons.slice(0, 40),
    rawResponsePreview:         (call.text ?? '').slice(0, 20_000),
    idMap,
    fieldAliasesHit:            aliasesHit.length > 0 ? aliasesHit : undefined,
  }

  const nextRun: ExternalResearchRun = {
    ...run,
    stage:      'finalizing',
    stageLabel: STAGE_LABEL['finalizing'],
    costUsd:    round6(run.costUsd + call.cost_usd),
    tokens: {
      input:  run.tokens.input  + call.usage.input_tokens,
      output: run.tokens.output + call.usage.output_tokens,
    },
    extractedFacts:          facts,
    extractedContradictions: contradictions,
    extractedQuestions:      parsed.researchQuestions,
    extractedGaps:           parsed.researchGaps,
    stageTimings: { ...run.stageTimings, extracting: Date.now() - stageStartMs },
    updatedAt:   new Date().toISOString(),
    extractionDiagnostics: diagnostics,
  }
  return { ...pack, externalResearchRun: nextRun }
}

function stageFinalize(pack: EvidencePack, stageStartMs: number): EvidencePack {
  const run = pack.externalResearchRun!
  const manualSources = pack.externalSources.filter(s => (s.origin ?? 'manual') === 'manual')
  const manualIds     = new Set(manualSources.map(s => s.id))
  // Preserve facts sourced purely by manual evidence + the bootstrap
  // fact; drop the prior discovered-fact set and replace with the
  // extractor's output.
  const survivingManualFacts = pack.verifiedFacts.filter(f => {
    if (f.evidenceRefs.length === 0) return true
    return f.evidenceRefs.every(r => manualIds.has(r))
  })
  const nextFacts = [...survivingManualFacts, ...(run.extractedFacts ?? [])]

  const nextExternal: ExternalSource[] = [...manualSources, ...run.discoveredSources]

  const webMeta: WebResearchMeta = {
    researchedAt:    new Date().toISOString(),
    searchesUsed:    run.searchesUsed,
    costUsd:         run.costUsd,
    model:           `${PRIMARY_MODEL} + ${EXTRACTOR_MODEL}`,
    latencyMs:       sumTimings(run.stageTimings),
    responsePreview: [run.primaryText ?? '', run.supportingText ?? ''].filter(Boolean).join('\n\n---\n\n').slice(0, PROSE_CAP),
    fallbackUsed:    true,
    fallbackModel:   EXTRACTOR_MODEL,
    // External Research Fix v4 — mirror the run's extraction
    // diagnostics onto webResearch so the Advanced panel can render
    // them without needing to inspect the run subobject.
    extractionDiagnostics: run.extractionDiagnostics,
  }

  const quality = computeExternalQuality({
    externalSources:  nextExternal,
    verifiedFacts:    nextFacts,
    hasWebResearch:   true,
    today:            pack.dataAsOf,
    webResearchedAt:  webMeta.researchedAt.slice(0, 10),
  })

  const methodology = buildExternalMethodology({
    project:       pack.project,
    manualSources,
    allSources:    nextExternal,
    notes:         pack.notes,
    webResearch:   webMeta,
  })

  const finishedRun: ExternalResearchRun = {
    ...run,
    stage:      'complete',
    stageLabel: STAGE_LABEL['complete'],
    stageTimings: { ...run.stageTimings, finalizing: Date.now() - stageStartMs },
    updatedAt:  new Date().toISOString(),
  }

  return {
    ...pack,
    externalSources:  nextExternal,
    verifiedFacts:    nextFacts,
    contradictions:   run.extractedContradictions ?? [],
    researchQuestions: run.extractedQuestions ?? pack.researchQuestions ?? [],
    researchGaps:     Array.from(new Set([...pack.researchGaps, ...(run.extractedGaps ?? [])])),
    webResearch:      webMeta,
    methodology,
    quality,
    warnings:         pack.warnings.filter(w => w.id !== 'ext-no-sources'),
    externalResearchRun: finishedRun,
  }
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function citationsToSources(citations: readonly { url: string; title?: string; publisher?: string }[], seen: Set<string>, now: string): ExternalSource[] {
  const out: ExternalSource[] = []
  for (const c of citations) {
    const url = c.url
    if (!url) continue
    const key = normUrl(url)
    if (seen.has(key)) continue
    seen.add(key)
    const tier = classifySourceTier(url)
    out.push({
      id:         `src-cite-${out.length + 1}-${Math.random().toString(36).slice(2, 6)}`,
      kind:       'external',
      url,
      title:      c.title || domainOf(url),
      publisher:  c.publisher || domainOf(url),
      addedAt:    now,
      addedBy:    'web_search',
      origin:     'web',
      sourceTier: tier,
      note:       'Cited by web search.',
    })
  }
  return out
}

function mergeSources(existing: readonly ExternalSource[], toAdd: readonly ExternalSource[]): ExternalSource[] {
  const seen = new Set(existing.map(s => normUrl(s.url)))
  const merged = [...existing]
  for (const s of toAdd) {
    const key = normUrl(s.url)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(s)
  }
  return merged
}

function normUrl(u: string): string {
  try {
    const x = new URL(u)
    x.hash = ''
    return x.toString().replace(/\/$/, '').toLowerCase()
  } catch { return String(u).toLowerCase() }
}

function clipText(s: string, cap: number): string {
  if (!s) return ''
  return s.length > cap ? s.slice(0, cap) + '\n\n[…truncated…]' : s
}

function round6(n: number): number { return Number(n.toFixed(6)) }

function sumTimings(t: Partial<Record<ExternalResearchStage, number>>): number {
  let total = 0
  for (const k of Object.keys(t) as ExternalResearchStage[]) total += t[k] ?? 0
  return total
}

function existingStatusFor(qualityStatus: EvidencePack['quality']['status']): ResearchStatus {
  return qualityStatus === 'blocked' ? 'blocked'
    : qualityStatus === 'needs_review' ? 'review_required'
    : 'gathering'
}

async function persistPack(supa: any, projectId: number, pack: EvidencePack, status: ResearchStatus): Promise<EditorialResearchRow> {
  const { data, error } = await supa
    .from('editorial_research')
    .update({ evidence_json: pack, status, updated_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .select('*')
    .single()
  if (error) throw new Error(`persistPack: ${error.message}`)
  return data as EditorialResearchRow
}

// Expose STAGE_LABEL for the UI so labels match server-side truth.
export { STAGE_LABEL as EXTERNAL_RESEARCH_STAGE_LABELS }
