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
import { callAnthropicAndLog, type AnthropicMessage } from '@/lib/ai/anthropic'

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
    messages.push({ role: 'user', content: `MODE=chat\n\n${userMessage}` })
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

  const parsed: StrategistResponse = parseStrategistResponse(result.text)
  return NextResponse.json({
    ok:          true,
    sessionId,
    response:    parsed,
    rawText:     result.text,          // for debugging / audit; small
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

function buildRecommendUserTurn(rejected: readonly string[]): string {
  const lines = [
    'MODE=recommend',
    '',
    'Give me your recommended two articles for this week.',
    '',
    'Rules:',
    '• Prioritise citeable data-led work.',
    '• Quality over quota — if only one strong opportunity exists, return one and say so.',
    '• Preserve every qualifier the Radar provides. Do not invent PokePrices figures.',
    '• Reference existing published articles by slug when overlap is a factor.',
    '• Include up to five alternatives.',
  ]
  if (rejected.length) {
    lines.push('', `The following Radar opportunity IDs were rejected earlier in this conversation and must not be re-recommended: ${rejected.join(', ')}.`)
  }
  return lines.join('\n')
}
