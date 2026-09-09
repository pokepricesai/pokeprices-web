// src/app/api/admin/editorial/idea-chat/route.ts
//
// Simplified Editorial HQ — idea chat endpoint.
//
// POST body: { lane: 'external' | 'internal', history?: [...], userMessage: string,
//              developIdea?: { title, angle, articleType } }
//
// Returns:   { ok, response: { message, ideas: CandidateIdea[] }, usage, rawText }
//
// - Deterministic mode routing (`lane` selected by the admin).
// - For internal lane, injects a compact analytics summary drawn from
//   the same OpportunityRadar the old HQ used, so ideas are grounded
//   in real PokePrices data without any Research Room / EvidencePack
//   workflow being invoked.
// - No side effects. This endpoint NEVER writes to editorial_projects.
//   Persistence happens only when the admin clicks Yes on a candidate
//   card, which POSTs to /api/admin/editorial/projects.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { checkAdminRateLimit } from '@/lib/adminRateLimit'
import { callAnthropicAndLog, type AnthropicMessage } from '@/lib/ai/anthropic'
import {
  IDEA_CHAT_SYSTEM_PROMPT,
  buildDiscoverUserTurn,
  buildDevelopUserTurn,
  parseIdeaChatResponse,
} from '@/lib/editorial/ideaChatPrompt'
import { buildEditorialContext } from '@/lib/editorial/context'
import { loadOrComputeRadar } from '@/lib/editorial/opportunityRadarCache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL       = 'claude-sonnet-4-6'
const MAX_TOKENS  = 3000
const TEMPERATURE = 0.5
const RATE_NS     = 'api/admin/editorial/idea-chat'
const RATE_MAX    = 60
const RATE_WIN    = 5 * 60 * 1000
const MAX_HISTORY_TURNS = 20
const MAX_USER_MSG_CHARS = 3000

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status })
}

type Body = {
  lane?:         unknown
  history?:      unknown
  userMessage?:  unknown
  sessionId?:    unknown
  developIdea?:  unknown
}

function isRole(v: unknown): v is 'user' | 'assistant' { return v === 'user' || v === 'assistant' }
function cleanHistory(raw: unknown): AnthropicMessage[] {
  if (!Array.isArray(raw)) return []
  const out: AnthropicMessage[] = []
  for (const t of raw as any[]) {
    if (!t || typeof t !== 'object') continue
    if (!isRole(t.role)) continue
    if (typeof t.content !== 'string' || !t.content.trim()) continue
    out.push({ role: t.role, content: t.content.slice(0, 20_000) })
  }
  return out.slice(-MAX_HISTORY_TURNS)
}

function extractDevelopIdea(raw: unknown): { title: string; angle: string | null; articleType: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as any
  const title = typeof r.title === 'string' ? r.title.trim() : ''
  if (!title) return null
  return {
    title:       title.slice(0, 300),
    angle:       typeof r.angle === 'string' ? r.angle.slice(0, 1000) : null,
    articleType: typeof r.articleType === 'string' ? r.articleType : 'evergreen_guide',
  }
}

export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return bad(admin.status, admin.error)
  const rate = checkAdminRateLimit(RATE_NS, admin.email, RATE_MAX, RATE_WIN)
  if (!rate.ok) return NextResponse.json({ ok: false, error: `Rate limit exceeded. Try again in ${rate.retryAfter}s.` }, { status: 429, headers: { 'retry-after': String(rate.retryAfter) } })

  let body: Body
  try { body = await req.json() as Body }
  catch { return bad(400, 'Invalid JSON') }

  const lane = body.lane === 'external' ? 'external' : body.lane === 'internal' ? 'internal' : null
  if (!lane) return bad(400, 'lane must be "external" or "internal"')
  if (typeof body.userMessage !== 'string' || !body.userMessage.trim()) return bad(400, 'userMessage is required')
  const userMessage = body.userMessage.trim().slice(0, MAX_USER_MSG_CHARS)
  const history = cleanHistory(body.history)
  const developIdea = extractDevelopIdea(body.developIdea)
  const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.slice(0, 100) : `idea_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  // Compact PokePrices analytics summary for the internal lane.
  // Reuses the same daily-cached OpportunityRadar; no extra DB work.
  let internalSummary: string | undefined
  if (lane === 'internal') {
    try {
      const ctx    = await buildEditorialContext()
      const cached = await loadOrComputeRadar(ctx)
      internalSummary = summariseRadarForModel(cached.radar)
    } catch (e) {
      internalSummary = `(analytics summary unavailable: ${e instanceof Error ? e.message : 'unknown'})`
    }
  }

  const userTurn = developIdea
    ? buildDevelopUserTurn({ lane, userMessage, internalSummary, existingIdea: developIdea })
    : buildDiscoverUserTurn({ lane, userMessage, internalSummary })

  const messages: AnthropicMessage[] = [...history, { role: 'user', content: userTurn }]

  const result = await callAnthropicAndLog({
    feature:     'editorial_idea_chat',
    model:       MODEL,
    system:      IDEA_CHAT_SYSTEM_PROMPT,
    messages,
    max_tokens:  MAX_TOKENS,
    temperature: TEMPERATURE,
    cacheSystem: true,
    adminEmail:  admin.email,
    sessionId,
  })
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error, detail: result.detail, status: result.status }, { status: result.status || 502 })

  const parsed = parseIdeaChatResponse(result.text, lane)

  return NextResponse.json({
    ok:        true,
    sessionId,
    response:  parsed,
    rawText:   result.text,
    usage: {
      model:                 result.model,
      input_tokens:          result.usage.input_tokens,
      output_tokens:         result.usage.output_tokens,
      cache_creation_tokens: result.usage.cache_creation_tokens,
      cache_read_tokens:     result.usage.cache_read_tokens,
      cost_usd:              result.cost_usd,
      latency_ms:            result.latency_ms,
    },
  })
}

// ── Radar → compact model-facing summary ─────────────────────────

function summariseRadarForModel(radar: any): string {
  const lines: string[] = []
  const meta = radar?.meta
  if (meta?.dataFreshness?.cardTrendsAsOf) lines.push(`Data as of: ${meta.dataFreshness.cardTrendsAsOf}`)
  const opportunities = Array.isArray(radar?.opportunities) ? radar.opportunities : []
  if (opportunities.length === 0) {
    lines.push('No strong opportunities detected right now (quiet week or thin data).')
    return lines.join('\n')
  }
  lines.push(`Currently ${opportunities.length} live signal(s) in the analytics:`)
  for (const o of opportunities.slice(0, 8)) {
    const parts: string[] = []
    parts.push(`- [${o.kind ?? 'unknown'}] "${o.headlineSuggestion ?? '(no headline)'}"`)
    if (o.dataStrength) parts.push(`strength=${o.dataStrength}`)
    if (typeof o.score === 'number') parts.push(`score=${o.score}`)
    if (o.suggestedArticleType) parts.push(`type=${o.suggestedArticleType}`)
    if (Array.isArray(o.relatedSets) && o.relatedSets.length) parts.push(`sets=${o.relatedSets.slice(0, 3).join(', ')}`)
    lines.push(parts.join(' · '))
    if (o.angle)   lines.push(`    angle: ${o.angle}`)
    if (o.whyNow)  lines.push(`    whyNow: ${o.whyNow}`)
    const evidence = Array.isArray(o.evidenceSummary) ? o.evidenceSummary.slice(0, 2) : []
    for (const e of evidence) lines.push(`    · ${e}`)
  }
  return lines.join('\n')
}
