// src/app/api/admin/editorial/strategist/route.ts
//
// EIC Block 5 — Editorial Strategist server endpoint.
//
// One POST route, two modes:
//   mode='recommend' — build EditorialContext + Radar server-side,
//                      hand them to Claude, return the initial
//                      "recommended this week" pack.
//   mode='chat'      — continue an ongoing conversation. The client
//                      sends the full history (see Session model
//                      below). Server rebuilds context + radar so
//                      the model always sees current PokePrices
//                      data.
//
// Session model (deliberately simple, per Block 5 §12):
//   * The client keeps `sessionId` + `history` + `rejectedRadarIds`
//     in React state + sessionStorage. No server persistence.
//   * Server is stateless between requests apart from ai_usage rows.
//
// Gate: requireAdmin + soft per-admin rate limit.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { checkAdminRateLimit } from '@/lib/adminRateLimit'
import { buildEditorialContext } from '@/lib/editorial/context'
import { buildOpportunityRadar } from '@/lib/editorial/opportunityRadar'
import { buildStrategistSystemPrompt, parseStrategistResponse, type StrategistResponse } from '@/lib/editorial/strategistPrompt'
import { auditStrategistStyle, buildStyleRepairUserTurn } from '@/lib/editorial/styleGuard'
import { callAnthropicAndLog, type AnthropicMessage } from '@/lib/ai/anthropic'
import { detectStrategistWriteIntent, extractLatestBriefFromHistory, buildGroundedConfirmation } from '@/lib/editorial/strategistIntents'
import { insertEditorialProject, findActiveProjectByExactTitle } from '@/lib/editorial/serverProjects'
import type { EditorialProject } from '@/lib/editorial/projects'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL       = 'claude-sonnet-4-6'
const MAX_TOKENS  = 3500
const TEMPERATURE = 0.4
const MAX_HISTORY_TURNS = 30       // hard cap to bound prompt growth
const MAX_USER_MSG_CHARS = 4000

const RATE_NAMESPACE = 'api/admin/editorial/strategist'
const RATE_LIMIT     = 40           // requests per window
const RATE_WINDOW_MS = 5 * 60 * 1000 // per 5 minutes per admin

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status })
}

// ── Request shape ────────────────────────────────────────────────

type HistoryTurn = { role: 'user' | 'assistant'; content: unknown }
type Body = {
  mode?:              unknown
  sessionId?:         unknown
  history?:           unknown
  userMessage?:       unknown
  rejectedRadarIds?:  unknown
  currentPlan?:       unknown   // Block 5C — active editorial plan the strategist should preserve
}

function isRole(v: unknown): v is 'user' | 'assistant' {
  return v === 'user' || v === 'assistant'
}
function cleanHistory(raw: unknown): AnthropicMessage[] {
  if (!Array.isArray(raw)) return []
  const out: AnthropicMessage[] = []
  for (const t of raw as HistoryTurn[]) {
    if (!t || typeof t !== 'object') continue
    if (!isRole(t.role)) continue
    if (typeof t.content !== 'string' || !t.content.trim()) continue
    out.push({ role: t.role, content: t.content.slice(0, 40_000) })
  }
  // Trim oldest first if over cap.
  return out.slice(-MAX_HISTORY_TURNS)
}
function cleanRejectedIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(x => typeof x === 'string' && x.length < 200).slice(0, 100) as string[]
}

function extractCurrentPlan(raw: unknown): { summary?: string; primary?: any[]; alternatives?: any[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as any
  const hasPrimary      = Array.isArray(p.primary)
  const hasAlternatives = Array.isArray(p.alternatives)
  if (!hasPrimary && !hasAlternatives) return null
  return {
    summary:      typeof p.summary === 'string' ? p.summary.slice(0, 400) : undefined,
    primary:      hasPrimary      ? p.primary.slice(0, 4)      : [],
    alternatives: hasAlternatives ? p.alternatives.slice(0, 8) : [],
  }
}

// ── Handler ──────────────────────────────────────────────────────

export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return bad(admin.status, admin.error)

  const rate = checkAdminRateLimit(RATE_NAMESPACE, admin.email, RATE_LIMIT, RATE_WINDOW_MS)
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: `Rate limit exceeded. Try again in ${rate.retryAfter}s.` },
      { status: 429, headers: { 'retry-after': String(rate.retryAfter) } },
    )
  }

  let body: Body
  try { body = await req.json() as Body }
  catch { return bad(400, 'Invalid JSON') }

  const mode = body.mode === 'chat' ? 'chat' : 'recommend'
  const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim()
    ? body.sessionId.slice(0, 100)
    : `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const history = cleanHistory(body.history)
  const rejectedRadarIds = cleanRejectedIds(body.rejectedRadarIds)
  const currentPlan = extractCurrentPlan(body.currentPlan)

  let userMessage = ''
  if (mode === 'chat') {
    if (typeof body.userMessage !== 'string' || !body.userMessage.trim()) {
      return bad(400, 'userMessage is required in chat mode')
    }
    userMessage = body.userMessage.trim().slice(0, MAX_USER_MSG_CHARS)
  }

  // ── Build authoritative context + radar server-side ──
  let context, radar
  try {
    context = await buildEditorialContext()
    radar   = await buildOpportunityRadar(context)
  } catch (e) {
    return bad(500, `Failed to build editorial context: ${e instanceof Error ? e.message : 'unknown'}`)
  }

  const { system } = buildStrategistSystemPrompt(context, radar, { rejectedRadarIds })

  const messages: AnthropicMessage[] = []
  if (mode === 'recommend') {
    // First (or explicit refresh) turn: ask for the initial pack.
    // Any prior history is included so the strategist doesn't lose
    // context if the admin refreshes.
    messages.push(...history)
    messages.push({
      role: 'user',
      content: buildRecommendUserTurn(rejectedRadarIds),
    })
  } else {
    messages.push(...history)
    // Block 5C — surface the current plan to the strategist so it
    // knows what to preserve vs what to change.
    const planPreamble = currentPlan
      ? `CURRENT ACTIVE EDITORIAL PLAN (preserve unless the user's message explicitly changes it):\n\`\`\`json\n${JSON.stringify(currentPlan, null, 2)}\n\`\`\`\n\nWhen you return an updated "recommendations" block, keep any primary or alternative item the user did not ask to change. Change only what this turn's message asks to change.\n\n`
      : ''
    messages.push({ role: 'user', content: `MODE=chat\n\n${planPreamble}${userMessage}` })
  }

  const result = await callAnthropicAndLog({
    feature:     mode === 'recommend' ? 'editorial_strategist_recommend' : 'editorial_strategist_chat',
    model:       MODEL,
    system,
    messages,
    max_tokens:  MAX_TOKENS,
    temperature: TEMPERATURE,
    cacheSystem: true,
    adminEmail:  admin.email,
    sessionId,
  })
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, detail: result.detail, status: result.status }, { status: result.status || 502 })
  }

  let parsed: StrategistResponse = parseStrategistResponse(result.text)
  let rawText = result.text
  let styleRepairFired = false
  let totalCostUsd = result.cost_usd
  let totalInput   = result.usage.input_tokens
  let totalOutput  = result.usage.output_tokens

  // Block 5C — one bounded style-repair pass. If the audit finds
  // any em dash or forbidden trope phrase, ask the model to rewrite
  // its own reply preserving facts and JSON. Max one repair call.
  const audit = auditStrategistStyle(parsed)
  if (audit.hasViolations) {
    const repairMessages: AnthropicMessage[] = [
      ...messages,
      { role: 'assistant', content: result.text },
      { role: 'user',      content: buildStyleRepairUserTurn(result.text, audit) },
    ]
    const repair = await callAnthropicAndLog({
      feature:     mode === 'recommend' ? 'editorial_strategist_recommend_repair' : 'editorial_strategist_chat_repair',
      model:       MODEL,
      system,
      messages:    repairMessages,
      max_tokens:  MAX_TOKENS,
      temperature: 0.2,   // more deterministic for a mechanical rewrite
      cacheSystem: true,
      adminEmail:  admin.email,
      sessionId,
    })
    if (repair.ok) {
      const repaired = parseStrategistResponse(repair.text)
      const secondAudit = auditStrategistStyle(repaired)
      styleRepairFired = true
      totalCostUsd += repair.cost_usd
      totalInput   += repair.usage.input_tokens
      totalOutput  += repair.usage.output_tokens
      // Only accept the repair if it removed at least one violation
      // and didn't destroy the response shape. Otherwise fall back
      // to the original so we never regress the reply.
      const repairImproved = !secondAudit.hasViolations
        || secondAudit.violations.length < audit.violations.length
      const stillHasContent = typeof repaired.assistantMessage === 'string' && repaired.assistantMessage.length > 0
      if (repairImproved && stillHasContent) {
        parsed = repaired
        rawText = repair.text
      }
    }
  }

  // ── Operational writes ─────────────────────────────────────────
  //
  // When the admin explicitly asks in chat to create / save / plan
  // an article, actually perform the DB write. Do NOT let the model
  // narrate a successful mutation without one. The intent detector
  // and brief extractor are deterministic — no AI second pass.
  let createdProject: EditorialProject | null = null
  let duplicateOfProject: EditorialProject | null = null
  let createError: string | null = null
  const writeIntent = mode === 'chat' ? detectStrategistWriteIntent(userMessage) : null
  if (writeIntent) {
    // History for extraction includes the assistant turn we just
    // produced, so a create-immediately-after-recommend also works.
    const historyForExtract: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: String(h.content ?? '') })),
      { role: 'assistant', content: rawText },
    ]
    const brief = extractLatestBriefFromHistory(historyForExtract)
    if (!brief) {
      parsed = { ...parsed, assistantMessage: buildGroundedConfirmation({ kind: 'no_brief' }) }
    } else {
      try {
        const existing = await findActiveProjectByExactTitle(brief.headline)
        if (existing) {
          duplicateOfProject = existing
          parsed = { ...parsed, assistantMessage: buildGroundedConfirmation({
            kind: 'duplicate', projectId: existing.id, title: existing.title, status: existing.status,
          }) }
        } else {
          const notesLines = [
            `Created by AI Editorial Strategist via chat (${new Date().toISOString().slice(0, 10)}).`,
            brief.whyNow ? `Why now: ${brief.whyNow}` : null,
            brief.whyUseful ? `Why useful: ${brief.whyUseful}` : null,
            brief.intent ? `Intent: ${brief.intent}` : null,
            brief.publishDayHint ? `Suggested day: ${brief.publishDayHint}` : null,
            brief.citationPotential ? `Citation potential: ${brief.citationPotential}` : null,
            brief.evidenceAvailable?.length ? '\nEvidence available:\n' + brief.evidenceAvailable.map(e => '• ' + e).join('\n') : null,
            brief.evidenceStillNeeded?.length ? '\nEvidence still needed:\n' + brief.evidenceStillNeeded.map(e => '• ' + e).join('\n') : null,
            brief.visuals?.length ? '\nSuggested visuals: ' + brief.visuals.join(', ') : null,
            brief.radarOpportunityId ? `\n[radar-opportunity: ${brief.radarOpportunityId}]` : null,
          ].filter(Boolean).join('\n')
          const priority = brief.confidence === 'high' ? 1 : brief.confidence === 'medium' ? 2 : 3
          createdProject = await insertEditorialProject({
            title:        brief.headline,
            angle:        brief.angle,
            article_type: brief.articleType,
            status:       writeIntent.targetStatus,
            priority,
            target_publish_at: null,
            notes:        notesLines,
          })
          parsed = { ...parsed, assistantMessage: buildGroundedConfirmation({
            kind: 'created', projectId: createdProject.id, title: createdProject.title,
            articleType: brief.articleType, mode: brief.mode, status: createdProject.status,
          }) }
        }
      } catch (e) {
        createError = e instanceof Error ? e.message : 'unknown'
        parsed = { ...parsed, assistantMessage: buildGroundedConfirmation({ kind: 'failed', error: createError }) }
      }
    }
  }

  return NextResponse.json({
    ok:          true,
    sessionId,
    response:    parsed,
    rawText,
    styleRepairFired,
    styleViolationsBefore: audit.violations,
    createdProject,
    duplicateOfProject,
    createError,
    usage: {
      model:                 result.model,
      input_tokens:          totalInput,
      output_tokens:         totalOutput,
      cache_creation_tokens: result.usage.cache_creation_tokens,
      cache_read_tokens:     result.usage.cache_read_tokens,
      cost_usd:              totalCostUsd,
      latency_ms:            result.latency_ms,
    },
  })
}

function buildRecommendUserTurn(rejected: readonly string[]): string {
  const lines = [
    'MODE=recommend',
    '',
    'Recommend the strongest articles for this week.',
    '',
    'Rules:',
    '  * Return a balanced mix of INTERNAL data-led ideas and EXTERNAL SEO/evergreen/news/release ideas. Neither lane is default-preferred. See TWO EDITORIAL LANES in the profile.',
    '  * Every recommendation MUST set "mode" to "internal" or "external" so the downstream workflow routes correctly.',
    '  * Quality over quota. Return one primary if only one is genuinely strong this week, and say so.',
    '  * For INTERNAL primary picks, the data-quality gate applies: strong/medium dataStrength, researchRequired=false, low/possible overlap. Weak-data or unconfirmed-release internal opportunities go to alternatives or "research first".',
    '  * For EXTERNAL primary picks, judge on likely search demand, timeliness, collector interest, topical relevance, internal-linking potential, and whether the article would be genuinely useful. Do NOT downgrade an external idea because PokePrices has no proprietary data on the subject.',
    '  * Preserve every qualifier the Radar provides. Do not invent PokePrices figures.',
    '  * Reference existing published articles by slug when overlap is a factor.',
    '  * Include up to five alternatives.',
    '  * Follow all writing-style rules in the editorial profile (American English, no em dashes, no AI tropes).',
  ]
  if (rejected.length) {
    lines.push('', `The following Radar opportunity ids were rejected earlier in this conversation and must not be re-recommended: ${rejected.join(', ')}.`)
  }
  return lines.join('\n')
}
