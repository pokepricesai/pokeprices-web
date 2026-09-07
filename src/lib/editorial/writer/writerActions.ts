// src/lib/editorial/writer/writerActions.ts
//
// EIC Block 9 — server-side orchestrator for the AI Writer + Fact
// Checker pipeline.
//
// Pipeline:
//   1. Research approval gate — refuse unless status = 'approved'
//   2. Build Writer inputs (compacted pack + analysis + trimmed
//      editorial context) and call the Writer
//   3. Assemble StudioDocument from the WriterDraft via Block 8
//      factories
//   4. Run the shared style guard against the assembled draft; if
//      violations exist, ONE bounded repair pass
//   5. Deterministic numeric audit
//   6. Fact Checker pass (auto)
//   7. If Fact Checker returns actionable issues AND no repair has
//      run yet, ONE bounded Writer repair pass, then re-audit +
//      re-check
//   8. Save studio_json + writer_json + nudge project.status ->
//      'drafting'
//
// Callable through /api/admin/editorial/studio/[projectId]/write.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { callAnthropicAndLog, type AnthropicMessage } from '@/lib/ai/anthropic'
import type { EvidencePack, ResearchAnalysis, EditorialResearchRow } from '../research/types'
import { fetchProject, fetchResearch } from '../research/serverActions'
import { buildEditorialContext } from '../context'
import type { EditorialContext } from '../context'
import type { StudioDocument } from '@/lib/studio/types'
import { emptyStudioDocument } from '@/lib/studio/types'
import { auditFieldMap, buildStyleRepairUserTurn } from '../styleGuard'
import type { CardIdentity } from '@/lib/studio/dataBlocks/types'

import { WRITER_SYSTEM_PROMPT, buildWriterUserTurn, buildWriterRepairUserTurn, parseWriterResponse } from './writerPrompt'
import { assembleStudioFromDraft } from './assembler'
import { auditStudioNumerics } from './numericAudit'
import { FACT_CHECKER_SYSTEM_PROMPT, buildFactCheckerUserTurn, parseFactCheckerResponse } from './factCheckerPrompt'
import { hashStudioBody } from './hash'
import type {
  WriterDraft, WriterMetadata, WriterUsage, WriterClaimTrace, BlockIntent,
  FactCheckResult,
} from './types'
import { WRITER_METADATA_VERSION } from './types'

const WRITER_MODEL      = 'claude-sonnet-4-6'
const WRITER_MAX_TOKENS = 8000
const CHECKER_MAX_TOKENS = 4000

// ─────────────────────────────────────────────────────────────────
// Public entry points
// ─────────────────────────────────────────────────────────────────

export type GenerateOptions = {
  today?:            string
  /** True when the caller has already acknowledged overwriting an
   *  existing meaningful draft. Without confirmation the API
   *  refuses to overwrite. */
  overwriteExisting?: boolean
}

export type GenerateResult = {
  ok:            true
  studio:        StudioDocument
  writer:        WriterMetadata
  factCheck:     FactCheckResult
  wroteToDb:     boolean
  overwriteWarned?: boolean
}

export async function generateArticleForProject(projectId: number, adminEmail: string, opts: GenerateOptions = {}): Promise<GenerateResult> {
  // 1. Gate.
  const project = await fetchProject(projectId)
  if (!project) throw new Error('project not found')
  const research = await fetchResearch(projectId)
  ensureResearchApproved(research)
  const pack = research!.evidence_json as EvidencePack
  const analysis = (research!.analyst_json ?? null) as ResearchAnalysis | null

  const supa = getSupabaseServiceClient()

  // 1b. Existing-draft guard.
  const existingDoc = (project as any).studio_json as StudioDocument | null
  const isMeaningful = hasMeaningfulBody(existingDoc)
  if (isMeaningful && !opts.overwriteExisting) {
    throw new Error('existing draft has meaningful content; call with overwriteExisting=true to replace')
  }

  // 2. Writer call.
  const context = await buildEditorialContext()
  const cardIndex = buildCardIndex(pack, context)

  const inputBundle = {
    project: { id: Number(project.id), title: String(project.title), angle: project.angle ?? null, articleType: String(project.article_type), targetPublishAt: project.target_publish_at ?? null },
    pack, analysis, context,
  }

  const writerUser = buildWriterUserTurn(inputBundle)
  const initialMessages: AnthropicMessage[] = [{ role: 'user', content: writerUser }]

  const first = await callAnthropicAndLog({
    feature:     'editorial_writer_generate',
    model:       WRITER_MODEL,
    system:      WRITER_SYSTEM_PROMPT,
    messages:    initialMessages,
    max_tokens:  WRITER_MAX_TOKENS,
    temperature: 0.4,
    cacheSystem: true,
    adminEmail,
    sessionId:   `writer-${projectId}-${Date.now()}`,
  })
  if (!first.ok) throw new Error(`writer call failed: ${first.error}`)

  let draft = parseWriterResponse(first.text)
  if (!draft) throw new Error('writer produced no parsable draft')

  // 3. Assemble.
  let assembly = assembleStudioFromDraft({
    draft, pack, context, cardIndex,
    themeKey:   pack.recipe === 'monthly_market_report' ? 'market' : pack.recipe === 'population_scarcity' ? 'grading' : 'market',
    themeLabel: pack.recipe === 'monthly_market_report' ? 'Market' : pack.recipe === 'population_scarcity' ? 'Grading' : 'Market',
    today:      opts.today,
  })

  const usage: WriterUsage = { input_tokens: first.usage.input_tokens, output_tokens: first.usage.output_tokens, cache_creation_tokens: first.usage.cache_creation_tokens, cache_read_tokens: first.usage.cache_read_tokens, cost_usd: first.cost_usd, latency_ms: first.latency_ms }

  // 4. Style guard against the writer's own prose (paragraphs +
  //    headline + intro + SEO fields). This is the same tooling the
  //    Strategist uses.
  const styleAudit1 = auditFieldMap(styleAuditFields(draft))
  let styleRepairFired = false
  let rawWriterText = first.text
  if (styleAudit1.hasViolations) {
    const repairPrompt = buildStyleRepairUserTurn(first.text, styleAudit1)
    const styleRepair = await callAnthropicAndLog({
      feature:    'editorial_writer_style_repair',
      model:      WRITER_MODEL,
      system:     WRITER_SYSTEM_PROMPT,
      messages:   [...initialMessages, { role: 'assistant', content: first.text }, { role: 'user', content: repairPrompt }],
      max_tokens: WRITER_MAX_TOKENS,
      temperature: 0.2,
      cacheSystem: true,
      adminEmail,
      sessionId:  `writer-${projectId}-style-${Date.now()}`,
    })
    if (styleRepair.ok) {
      const repaired = parseWriterResponse(styleRepair.text)
      const secondAudit = repaired ? auditFieldMap(styleAuditFields(repaired)) : { hasViolations: true, violations: [] as any[] }
      styleRepairFired = true
      addUsage(usage, styleRepair)
      if (repaired && !secondAudit.hasViolations) {
        draft = repaired
        rawWriterText = styleRepair.text
        assembly = assembleStudioFromDraft({
          draft, pack, context, cardIndex,
          themeKey: assembly.studio.themeKey, themeLabel: assembly.studio.themeLabel, today: opts.today,
        })
      }
    }
  }

  // 5. Numeric audit.
  let numericAudit = auditStudioNumerics(assembly.studio, pack, assembly.blocksBuilt)

  // 6. Fact Check (auto).
  let studioHash = hashStudioBody(assembly.studio.bodyDoc)
  let factCheck  = await runFactChecker(pack, assembly.studio, draft.evidenceTrace, assembly.blocksBuilt, numericAudit, { checkedStudioHash: studioHash, autoCheck: true, adminEmail, sessionId: `factcheck-${projectId}-${Date.now()}`, usage })

  // 7. One bounded repair pass if the Fact Checker or numeric audit
  //    reports actionable issues.
  let repairFired = false
  const actionable = factCheck.issues.filter(i => i.severity !== 'minor').length > 0 || numericAudit.issues.length > 0
  if (actionable) {
    const factSummary = factCheck.issues.map((i, k) => `  ${k + 1}. [${i.severity}] ${i.kind} — ${i.claim} :: ${i.reason}${i.suggestedCorrection ? ` (suggest: ${i.suggestedCorrection})` : ''}`).join('\n') || '  (none)'
    const numSummary  = numericAudit.issues.map((i, k) => `  ${k + 1}. "${i.token.raw}" at ${i.token.location}${i.nearest ? ` — nearest allowed ${i.nearest.value} (${i.nearest.source})` : ''}`).join('\n') || '  (none)'
    const repairPrompt = buildWriterRepairUserTurn(rawWriterText, factSummary, numSummary)
    const rep = await callAnthropicAndLog({
      feature:     'editorial_writer_repair',
      model:       WRITER_MODEL,
      system:      WRITER_SYSTEM_PROMPT,
      messages:    [...initialMessages, { role: 'assistant', content: rawWriterText }, { role: 'user', content: repairPrompt }],
      max_tokens:  WRITER_MAX_TOKENS,
      temperature: 0.3,
      cacheSystem: true,
      adminEmail,
      sessionId:   `writer-${projectId}-repair-${Date.now()}`,
    })
    if (rep.ok) {
      const repDraft = parseWriterResponse(rep.text)
      repairFired = true
      addUsage(usage, rep)
      if (repDraft) {
        const repAssembly = assembleStudioFromDraft({
          draft: repDraft, pack, context, cardIndex,
          themeKey: assembly.studio.themeKey, themeLabel: assembly.studio.themeLabel, today: opts.today,
        })
        const repAudit = auditStudioNumerics(repAssembly.studio, pack, repAssembly.blocksBuilt)
        const repHash  = hashStudioBody(repAssembly.studio.bodyDoc)
        const repCheck = await runFactChecker(pack, repAssembly.studio, repDraft.evidenceTrace, repAssembly.blocksBuilt, repAudit, { checkedStudioHash: repHash, autoCheck: true, adminEmail, sessionId: `factcheck-${projectId}-repair-${Date.now()}`, usage })
        // Accept the repair only if it did not regress the issue count.
        const totalBefore = factCheck.issues.length + numericAudit.issues.length
        const totalAfter  = repCheck.issues.length  + repAudit.issues.length
        if (totalAfter <= totalBefore) {
          draft = repDraft
          rawWriterText = rep.text
          assembly = repAssembly
          numericAudit = repAudit
          factCheck = repCheck
          studioHash = repHash
        }
      }
    }
  }

  // 8. Save.
  const nextStatus = (project.status === 'idea' || project.status === 'planned') ? 'drafting' : project.status
  const meta: WriterMetadata = {
    version:              WRITER_METADATA_VERSION,
    generatedAt:          new Date().toISOString(),
    model:                WRITER_MODEL,
    researchId:           Number(research!.id),
    researchGeneratedAt:  pack.generatedAt,
    packRecipe:           pack.recipe,
    claimTrace:           draft.evidenceTrace,
    blockIntents:         assembly.blocksBuilt,
    assemblyWarnings:     assembly.warnings,
    factCheck,
    checkedStudioHash:    studioHash,
    generationCost:       usage,
    styleRepairFired,
    repairFired,
  }
  const { error } = await supa.from('editorial_projects').update({
    studio_json: assembly.studio,
    writer_json: meta,
    status:      nextStatus,
    updated_at:  new Date().toISOString(),
  }).eq('id', projectId)
  if (error) throw new Error(`save failed: ${error.message}`)

  return { ok: true, studio: assembly.studio, writer: meta, factCheck, wroteToDb: true }
}

// ─────────────────────────────────────────────────────────────────
// Standalone fact check (called by Studio "Run fact check" action)
// ─────────────────────────────────────────────────────────────────

export async function factCheckCurrentDraft(projectId: number, adminEmail: string): Promise<FactCheckResult> {
  const project = await fetchProject(projectId)
  if (!project) throw new Error('project not found')
  const research = await fetchResearch(projectId)
  if (!research || !research.evidence_json) throw new Error('no research evidence to check against')
  const pack = research.evidence_json as EvidencePack
  const studio = (project as any).studio_json as StudioDocument | null
  if (!studio) throw new Error('no draft to fact check')

  const supa = getSupabaseServiceClient()
  const { data: pRow } = await supa.from('editorial_projects').select('writer_json').eq('id', projectId).maybeSingle()
  const prevWriter = (pRow as any)?.writer_json as WriterMetadata | null
  const claimTrace: WriterClaimTrace[]     = prevWriter?.claimTrace   ?? []
  const blocksBuilt: BlockIntent[]         = prevWriter?.blockIntents ?? []

  const numericAudit = auditStudioNumerics(studio, pack, blocksBuilt)
  const usage: WriterUsage = { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, cost_usd: 0, latency_ms: 0 }
  const studioHash = hashStudioBody(studio.bodyDoc)
  const factCheck = await runFactChecker(pack, studio, claimTrace, blocksBuilt, numericAudit, { checkedStudioHash: studioHash, autoCheck: false, adminEmail, sessionId: `factcheck-${projectId}-manual-${Date.now()}`, usage })

  const nextMeta: WriterMetadata = {
    ...(prevWriter ?? {
      version: WRITER_METADATA_VERSION, generatedAt: new Date().toISOString(), model: 'manual', claimTrace: [], blockIntents: [], assemblyWarnings: [], generationCost: { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, cost_usd: 0, latency_ms: 0 },
    }),
    factCheck,
    checkedStudioHash: studioHash,
  } as WriterMetadata
  // Merge the new usage into whatever was already recorded.
  nextMeta.generationCost = mergeUsage(nextMeta.generationCost, usage)
  await supa.from('editorial_projects').update({ writer_json: nextMeta, updated_at: new Date().toISOString() }).eq('id', projectId)
  return factCheck
}

// ─────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────

function ensureResearchApproved(row: EditorialResearchRow | null): void {
  if (!row) throw new Error('approved research required')
  if (row.status !== 'approved') throw new Error(`approved research required (status: ${row.status})`)
}

function hasMeaningfulBody(doc: StudioDocument | null): boolean {
  if (!doc) return false
  const b = doc.bodyDoc as any
  if (!b || !Array.isArray(b.content)) return false
  return b.content.some((n: any) => n?.type === 'heading' || n?.type === 'dataBlock' || (n?.type === 'paragraph' && Array.isArray(n.content) && n.content.some((c: any) => typeof c?.text === 'string' && c.text.trim().length > 0)))
    || (doc.headline?.trim().length ?? 0) > 0
    || (doc.intro?.trim().length ?? 0) > 0
}

function styleAuditFields(draft: WriterDraft): Record<string, string | string[]> {
  const paragraphs: string[] = []
  for (const s of draft.sections) {
    if (s.heading) paragraphs.push(s.heading)
    paragraphs.push(...s.paragraphs)
  }
  if (draft.conclusion) paragraphs.push(draft.conclusion)
  return {
    'headline':        draft.headline,
    'intro':           draft.intro,
    'seoTitle':        draft.seoTitle,
    'seoDescription':  draft.seoDescription,
    'paragraphs':      paragraphs,
  }
}

function addUsage(base: WriterUsage, more: { usage: any; cost_usd: number; latency_ms: number }): void {
  base.input_tokens          += more.usage.input_tokens          ?? 0
  base.output_tokens         += more.usage.output_tokens         ?? 0
  base.cache_creation_tokens += more.usage.cache_creation_tokens ?? 0
  base.cache_read_tokens     += more.usage.cache_read_tokens     ?? 0
  base.cost_usd              += more.cost_usd                    ?? 0
  base.latency_ms             = Math.max(base.latency_ms, more.latency_ms ?? 0)
}
function mergeUsage(a: WriterUsage, b: WriterUsage): WriterUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_tokens: a.cache_creation_tokens + b.cache_creation_tokens,
    cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens,
    cost_usd: a.cost_usd + b.cost_usd,
    latency_ms: Math.max(a.latency_ms, b.latency_ms),
  }
}

async function runFactChecker(
  pack: EvidencePack, studio: StudioDocument, claimTrace: WriterClaimTrace[], blocksBuilt: BlockIntent[], numericAudit: ReturnType<typeof auditStudioNumerics>,
  opts: { checkedStudioHash: string; autoCheck: boolean; adminEmail: string; sessionId: string; usage: WriterUsage },
): Promise<FactCheckResult> {
  const userTurn = buildFactCheckerUserTurn({ pack, studio, claimTrace, blocksBuilt, numericAudit })
  const call = await callAnthropicAndLog({
    feature:     'editorial_writer_fact_check',
    model:       WRITER_MODEL,
    system:      FACT_CHECKER_SYSTEM_PROMPT,
    messages:    [{ role: 'user', content: userTurn }],
    max_tokens:  CHECKER_MAX_TOKENS,
    temperature: 0.2,
    cacheSystem: true,
    adminEmail:  opts.adminEmail,
    sessionId:   opts.sessionId,
  })
  if (!call.ok) {
    // Never let a failed fact-check call block the write; degrade
    // to a review_required result carrying the numeric audit + a
    // synthetic issue so the reviewer sees it clearly.
    return {
      version: 1,
      status: numericAudit.issues.length > 0 ? 'review_required' : 'review_required',
      checkedAt: new Date().toISOString(),
      packRecipe: pack.recipe,
      issues: [{ kind: 'other', severity: 'major', claim: 'Fact Checker call failed', reason: call.error ?? 'unknown', evidenceRefs: [] }],
      numericAudit,
      checkedStudioHash: opts.checkedStudioHash,
      autoCheck: opts.autoCheck,
    }
  }
  addUsage(opts.usage, call)
  return parseFactCheckerResponse(call.text, pack, numericAudit, { checkedStudioHash: opts.checkedStudioHash, autoCheck: opts.autoCheck })
}

// Build a cardSlug -> CardIdentity index the assembler can resolve
// against. Sources: dataTable rows (bare slug), pack.internalLinks,
// pack card refs on stat callouts, etc. Bounded to avoid excess.
function buildCardIndex(pack: EvidencePack, _context: EditorialContext | null): Map<string, CardIdentity> {
  const map = new Map<string, CardIdentity>()
  for (const t of pack.dataTables) {
    for (const row of t.rows) {
      const slug = String(row.cardSlug ?? row.card_slug ?? row.urlSlug ?? '')
      const name = String(row.cardName ?? row.card ?? row.name ?? '')
      const setName = String(row.setName ?? row.set_name ?? '')
      const num  = row.cardNumber != null ? String(row.cardNumber) : String(row.card_number ?? row['#'] ?? '')
      const url  = String(row.urlSlug ?? row.url_slug ?? '')
      if (!name) continue
      const key = slug || (url ? url.replace(/^pc-/, '') : `${setName}|${num}`)
      if (!key) continue
      if (!map.has(key)) map.set(key, {
        cardSlug: slug || (url ? url.replace(/^pc-/, '') : ''),
        cardName: name,
        setName:  setName || undefined,
        cardNumber: num || undefined,
        urlSlug:  url || undefined,
      })
    }
  }
  return map
}
