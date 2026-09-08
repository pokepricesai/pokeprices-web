// src/lib/editorial/research/serverActions.ts
//
// EIC Block 6 — server-side action handlers for the Research Room.
//
// These functions are the single source of truth for "what does a
// build / rebuild / approve / revoke / add-source / add-note mean".
// The API route is a thin dispatcher over them; the intent is that
// unit + integration tests can call these directly.
//
// All mutations are on the editorial_research table via the service-
// role client. Callers must have already passed requireAdmin().

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { runResearchRecipe, chooseRecipe } from './dispatch'
import { parseAnalystResponse, buildAnalystUserTurn, RESEARCH_ANALYST_SYSTEM_PROMPT, analystStyleFields } from './analystPrompt'
import { callAnthropicAndLog, type AnthropicMessage } from '@/lib/ai/anthropic'
import { auditFieldMap, buildStyleRepairUserTurn, type StyleAudit } from '../styleGuard'
import type {
  EvidencePack, ResearchAnalysis, EditorialResearchRow,
  ResearchStatus, ExternalSource, ResearchNote,
} from './types'

const ANALYST_MODEL = 'claude-sonnet-4-6'
const ANALYST_MAX_TOKENS = 3000

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

  const pack = await runResearchRecipe(
    { id: project.id, title: project.title, angle: project.angle, articleType: project.article_type, targetPublishAt: project.target_publish_at },
    { today: opts.today },
  )

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
  return { row: data as any, pack, recipe: chooseRecipe({ id: project.id, title: project.title, angle: project.angle, articleType: project.article_type, targetPublishAt: project.target_publish_at }) }
}

// ─────────────────────────────────────────────────────────────────
// Analyze (AI Research Analyst)
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
  const added: ExternalSource = {
    id: `ext-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    kind: 'external',
    addedAt: new Date().toISOString(),
    addedBy: adminEmail,
    url:  String(source.url ?? '').slice(0, 2000),
    title: String(source.title ?? '').slice(0, 500),
    publisher: source.publisher ? String(source.publisher).slice(0, 200) : undefined,
    publicationDate: source.publicationDate ? String(source.publicationDate).slice(0, 40) : undefined,
    note: source.note ? String(source.note).slice(0, 2000) : undefined,
    supportsFactId: source.supportsFactId ? String(source.supportsFactId).slice(0, 100) : undefined,
  }
  if (!added.url || !added.title) throw new Error('url and title are required')
  const newPack: EvidencePack = { ...pack, externalSources: [...pack.externalSources, added] }
  return persistPack(projectId, newPack)
}

export async function removeExternalSource(projectId: number, sourceId: string): Promise<EditorialResearchRow> {
  const existing = await fetchResearch(projectId)
  if (!existing || !existing.evidence_json) throw new Error('no evidence pack')
  const pack = existing.evidence_json as EvidencePack
  const newPack: EvidencePack = { ...pack, externalSources: pack.externalSources.filter(s => s.id !== sourceId) }
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
