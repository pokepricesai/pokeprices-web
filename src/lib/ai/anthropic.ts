// src/lib/ai/anthropic.ts
//
// EIC Block 5 — shared server-side Anthropic caller + AI usage
// telemetry writer. Used by:
//   * /api/admin/insights/ai-assist  (Block 0)
//   * /api/admin/editorial/strategist (Block 5)
//   * any future admin AI endpoint.
//
// This is a THIN wrapper. It does not add abstraction over the
// Anthropic API — routes still assemble their own system prompts and
// messages. Its jobs are:
//   1. Read the key from the correct server-only env var (never
//      NEXT_PUBLIC_*).
//   2. Call api.anthropic.com with an appropriate anthropic-version.
//   3. Surface a strongly-typed response including usage.
//   4. Compute an estimated USD cost from usage + a small model
//      pricing table.
//   5. Write one telemetry row to public.ai_usage (best-effort;
//      failing to log must never break the AI call).

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

// ── Pricing table ────────────────────────────────────────────────
//
// USD per million tokens. Kept intentionally small and explicit —
// review before adding new models. Fallback is "assume Sonnet-tier"
// so we never under-report cost for an unrecognised model.

const PRICING: Record<string, { input: number; output: number; cacheWrite?: number; cacheRead?: number }> = {
  'claude-sonnet-4-6':        { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-haiku-4-5':         { input: 1.00, output: 5.00,  cacheWrite: 1.25, cacheRead: 0.10 },
  'claude-haiku-4-5-20251001':{ input: 1.00, output: 5.00,  cacheWrite: 1.25, cacheRead: 0.10 },
  'claude-opus-4-7':          { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
}

function costFor(model: string, usage: AiUsage): number {
  const p = PRICING[model] ?? PRICING['claude-sonnet-4-6']  // safe default
  const u  = (usage.input_tokens         / 1_000_000) * p.input
  const o  = (usage.output_tokens        / 1_000_000) * p.output
  const cw = (usage.cache_creation_tokens / 1_000_000) * (p.cacheWrite ?? p.input)
  const cr = (usage.cache_read_tokens    / 1_000_000) * (p.cacheRead  ?? p.input)
  return Number((u + o + cw + cr).toFixed(6))
}

// ── Types ────────────────────────────────────────────────────────

export type AnthropicMessage = { role: 'user' | 'assistant'; content: string }

export type CallAnthropicInput = {
  model:       string
  system:      string
  messages:    readonly AnthropicMessage[]
  max_tokens:  number
  temperature?: number
  /** Enable ephemeral prompt caching on the system prompt. */
  cacheSystem?: boolean
}

export type AiUsage = {
  input_tokens:          number
  output_tokens:         number
  cache_creation_tokens: number
  cache_read_tokens:     number
}

/** Flat result type so TS narrowing works with tsconfig `strict: false`. */
export type CallAnthropicResult = {
  ok:          boolean
  text:        string
  model:       string
  usage:       AiUsage
  cost_usd:    number
  latency_ms:  number
  stop_reason: string | null
  status:      number
  error:       string
  detail:      string
}
const EMPTY_USAGE: AiUsage = { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 }
function failResult(status: number, error: string, latency_ms: number, detail = '', model = ''): CallAnthropicResult {
  return { ok: false, text: '', model, usage: EMPTY_USAGE, cost_usd: 0, latency_ms, stop_reason: null, status, error, detail }
}

// ── Main call ────────────────────────────────────────────────────

export async function callAnthropic(input: CallAnthropicInput): Promise<CallAnthropicResult> {
  const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || ''
  const started = Date.now()
  if (!apiKey) {
    return failResult(503, 'AI backend not configured', Date.now() - started, '', input.model)
  }

  const systemBlocks = input.cacheSystem
    ? [{ type: 'text' as const, text: input.system, cache_control: { type: 'ephemeral' as const } }]
    : input.system

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:       input.model,
        max_tokens:  input.max_tokens,
        temperature: input.temperature ?? 0.4,
        system:      systemBlocks,
        messages:    input.messages,
      }),
    })
  } catch (e) {
    return failResult(502, 'AI upstream network failure', Date.now() - started, e instanceof Error ? e.message : 'unknown', input.model)
  }
  const latency_ms = Date.now() - started

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return failResult(502, `Anthropic ${res.status}`, latency_ms, detail.slice(0, 500), input.model)
  }

  const data = await res.json().catch(() => null) as any
  const text = data?.content?.[0]?.text ?? ''
  const stop_reason = data?.stop_reason ?? null
  const usage: AiUsage = {
    input_tokens:          Number(data?.usage?.input_tokens          ?? 0),
    output_tokens:         Number(data?.usage?.output_tokens         ?? 0),
    cache_creation_tokens: Number(data?.usage?.cache_creation_input_tokens ?? 0),
    cache_read_tokens:     Number(data?.usage?.cache_read_input_tokens     ?? 0),
  }
  return {
    ok: true,
    text,
    model:       input.model,
    usage,
    cost_usd:    costFor(input.model, usage),
    latency_ms,
    stop_reason,
    status:      200,
    error:       '',
    detail:      '',
  }
}

// ── Telemetry writer ─────────────────────────────────────────────
//
// Best-effort. Never throws — if the insert fails (e.g. table missing
// during migration rollout), we log to the server console and move
// on. AI calls must not be blocked on telemetry.

export type LogAiUsageInput = {
  feature:     string
  model:       string
  adminEmail?: string | null
  sessionId?:  string | null
  usage:       AiUsage
  cost_usd:    number
  latency_ms:  number
  error?:      string | null
}

export async function logAiUsage(input: LogAiUsageInput): Promise<void> {
  try {
    const supa = getSupabaseServiceClient()
    const { error } = await supa.from('ai_usage').insert([{
      feature:               input.feature,
      model:                 input.model,
      admin_email:           input.adminEmail ?? null,
      session_id:            input.sessionId  ?? null,
      input_tokens:          input.usage.input_tokens,
      output_tokens:         input.usage.output_tokens,
      cache_creation_tokens: input.usage.cache_creation_tokens,
      cache_read_tokens:     input.usage.cache_read_tokens,
      cost_usd:              input.cost_usd,
      latency_ms:            input.latency_ms,
      error:                 input.error ?? null,
    }])
    if (error) console.warn('[ai_usage] insert failed:', error.message)
  } catch (e) {
    console.warn('[ai_usage] insert threw:', e instanceof Error ? e.message : 'unknown')
  }
}

// ── Convenience: call + log in one step ─────────────────────────

export type CallAndLogInput = CallAnthropicInput & {
  feature:     string
  adminEmail?: string | null
  sessionId?:  string | null
}

export async function callAnthropicAndLog(input: CallAndLogInput): Promise<CallAnthropicResult> {
  const { feature, adminEmail, sessionId, ...callArgs } = input
  const result = await callAnthropic(callArgs)
  await logAiUsage({
    feature,
    model: input.model,
    adminEmail,
    sessionId,
    usage: result.ok
      ? result.usage
      : { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 },
    cost_usd: result.ok ? result.cost_usd : 0,
    latency_ms: result.latency_ms,
    error: result.ok ? null : `${result.status}: ${result.error}${result.detail ? ' - ' + result.detail : ''}`,
  })
  return result
}
