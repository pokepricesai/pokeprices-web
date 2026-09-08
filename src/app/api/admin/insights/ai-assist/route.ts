// src/app/api/admin/insights/ai-assist/route.ts
//
// EIC Block 0 — server-side AI-assist endpoint for the Insights admin
// editor. The three existing "write with AI" buttons (intro / body /
// meta) previously called api.anthropic.com directly from the browser
// with no key, which meant either the request silently failed or the
// key would have had to be exposed via NEXT_PUBLIC_. Neither is
// acceptable. This route moves the call server-side using the
// server-only CLAUDE_API_KEY (fall back to ANTHROPIC_API_KEY) and
// gates access via the existing ADMIN_ALLOWED_EMAILS allow-list.
//
// Gate:
//   1. requireAdmin: Bearer token + ADMIN_ALLOWED_EMAILS allow-list.
//   2. POST-only. No GET / PUT / DELETE.
//
// The client sends { kind, headline, theme_label, intro? }; the server
// owns the prompts and returns plain text so prompts can only be
// changed with a deploy. Model + system prompt are preserved from the
// previous client implementation so article-generation behaviour is
// unchanged.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { checkAdminRateLimit } from '@/lib/adminRateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL = 'claude-sonnet-4-20250514'
const MAX_TOKENS = 1000

// EIC Block 0B — soft per-admin rate limit. Sized generously so normal
// editorial use (5–10 assists per article) is never blocked, but a
// malfunctioning client or compromised session cannot burn Anthropic
// quota in a runaway loop. Per-instance in-memory: this is a SOFT cap.
const AI_ASSIST_RATE_LIMIT       = 30           // requests
const AI_ASSIST_RATE_WINDOW_MS   = 60 * 1000    // per 60 seconds
const AI_ASSIST_RATE_NAMESPACE   = 'api/admin/insights/ai-assist'

const SYSTEM_PROMPT = `You are a writer for PokePrices.io — a UK-focused Pokémon TCG price and market intelligence site.
Write in a knowledgeable, direct, collector-friendly tone. No hype, no waffle, no AI-sounding preamble.
Write as if a well-informed collector is talking to other collectors.
Use UK English. Never say "delve", "realm", "embark", "unleash", or similar AI clichés.`

type Kind = 'intro' | 'body' | 'meta'

type Body = {
  kind?:        unknown
  headline?:    unknown
  theme_label?: unknown
  intro?:       unknown
}

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function buildPrompt(kind: Kind, headline: string, themeLabel: string, intro: string): string {
  if (kind === 'intro') {
    return `Write a 2-3 sentence introduction for an article titled "${headline}" about ${themeLabel}.
Hook the reader with a specific, concrete observation. Don't start with "In the world of".`
  }
  if (kind === 'body') {
    return `Write a full article body for "${headline}".
Theme: ${themeLabel}.
${intro ? `Intro already written: "${intro}"` : ''}

Write 400-600 words. Structure with 3-4 clear sections. Each section should have a short bold heading followed by 2-3 paragraphs.
Focus on practical, actionable information for collectors. Use specific examples where possible.
Format: use ## for section headings, regular paragraphs otherwise. No bullet points.`
  }
  // meta
  return `Write SEO meta title and description for: "${headline}"
Theme: ${themeLabel}

Return ONLY this format (no other text):
TITLE: [60 char max title]
DESC: [155 char max description]`
}

export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return bad(admin.status, admin.error)
  }

  // Soft rate limit keyed by admin identity — see constants above.
  const rate = checkAdminRateLimit(
    AI_ASSIST_RATE_NAMESPACE,
    admin.email,
    AI_ASSIST_RATE_LIMIT,
    AI_ASSIST_RATE_WINDOW_MS,
  )
  if (!rate.ok) {
    return NextResponse.json(
      { error: `Rate limit exceeded. Try again in ${rate.retryAfter}s.` },
      { status: 429, headers: { 'retry-after': String(rate.retryAfter) } },
    )
  }

  const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || ''
  if (!apiKey) {
    return bad(503, 'AI assist not configured')
  }

  let body: Body = {}
  try { body = (await req.json()) as Body } catch { return bad(400, 'Invalid JSON') }

  const kindRaw = body.kind
  if (kindRaw !== 'intro' && kindRaw !== 'body' && kindRaw !== 'meta') {
    return bad(400, 'kind must be "intro", "body" or "meta"')
  }
  const kind: Kind = kindRaw

  if (!isNonEmptyString(body.headline)) return bad(400, 'headline is required')
  const headline = body.headline.trim().slice(0, 300)
  const themeLabel = isNonEmptyString(body.theme_label) ? body.theme_label.trim().slice(0, 100) : ''
  const intro = isNonEmptyString(body.intro) ? body.intro.trim().slice(0, 1000) : ''

  const prompt = buildPrompt(kind, headline, themeLabel, intro)

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
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'AI upstream failed', detail: msg }, { status: 502 })
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return NextResponse.json(
      { error: 'AI upstream error', status: res.status, detail: detail.slice(0, 500) },
      { status: 502 },
    )
  }

  const data: any = await res.json().catch(() => null)
  const text: string = data?.content?.[0]?.text ?? ''
  return NextResponse.json({ text })
}
