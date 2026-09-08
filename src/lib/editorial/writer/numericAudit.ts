// src/lib/editorial/writer/numericAudit.ts
//
// EIC Block 9 — deterministic numeric claim audit.
//
// Extracts numeric tokens from the article prose and compares them
// against an allowed-values set built from the evidence pack, the
// project dates, the block intents, and the small handful of dates
// mentioned in the Writer draft. Anything else is flagged as
// `unsupported_numeric_claim`.
//
// This is a safety net, not a mathematically perfect NLP pass. It
// tolerates format variation (currency, commas, %, "x"), plus
// small percentage rounding within 0.5 percentage points.

import type { EvidencePack } from '@/lib/editorial/research/types'
import type { BlockIntent, NumericToken, NumericAuditIssue, NumericAuditResult } from './types'
import type { StudioDocument } from '@/lib/studio/types'

const CURRENCY_PCT_TOLERANCE = 0.005     // half a cent
const PERCENT_TOLERANCE       = 0.5       // percentage points
const COUNT_TOLERANCE         = 0          // counts must match exactly (comma-insensitive)
const RATIO_TOLERANCE         = 0.15       // 15% relative

// ─────────────────────────────────────────────────────────────────
// Tokenizer
// ─────────────────────────────────────────────────────────────────

const NUMBER_TOKEN_RE = /(\$\s?[0-9][0-9,.]*[km]?)|([0-9][0-9,]*(?:\.[0-9]+)?\s?%)|([0-9][0-9,]*(?:\.[0-9]+)?\s?[xX])|(\b[0-9]{4}-[0-9]{2}-[0-9]{2}\b)|(\b[0-9][0-9,]*(?:\.[0-9]+)?\b)/g

export function extractNumericTokens(text: string, location: string): NumericToken[] {
  if (!text) return []
  const out: NumericToken[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(NUMBER_TOKEN_RE.source, 'g')
  while ((m = re.exec(text))) {
    const raw = m[0]
    const tok = normaliseToken(raw)
    if (tok == null) continue
    out.push({ raw, value: tok.value, kind: tok.kind, location })
  }
  return out
}

function normaliseToken(raw: string): { value: number; kind: NumericToken['kind'] } | null {
  const trimmed = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    // Date — treat as ISO
    const [y, mo, d] = trimmed.split('-').map(Number)
    return { value: y * 10_000 + mo * 100 + d, kind: 'date' }
  }
  if (trimmed.startsWith('$')) {
    const n = Number(trimmed.replace(/[$, ]/g, '').replace(/[km]$/i, ''))
    if (!Number.isFinite(n)) return null
    const mult = /k$/i.test(trimmed) ? 1_000 : /m$/i.test(trimmed) ? 1_000_000 : 1
    return { value: n * mult, kind: 'currency' }
  }
  if (trimmed.endsWith('%')) {
    const n = Number(trimmed.replace(/[%,\s]/g, ''))
    return Number.isFinite(n) ? { value: n, kind: 'percent' } : null
  }
  if (/[xX]$/.test(trimmed)) {
    const n = Number(trimmed.replace(/[xX,\s]/g, ''))
    return Number.isFinite(n) ? { value: n, kind: 'ratio' } : null
  }
  const n = Number(trimmed.replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  // Treat integers with no unit as counts.
  return { value: n, kind: 'count' }
}

// ─────────────────────────────────────────────────────────────────
// Build allowed values from the pack + block intents
// ─────────────────────────────────────────────────────────────────

type AllowedValue = { value: number; kind: NumericToken['kind']; source: string }

export function buildAllowedValues(pack: EvidencePack, blocksBuilt: BlockIntent[]): AllowedValue[] {
  const out: AllowedValue[] = []
  const push = (value: number, kind: NumericToken['kind'], source: string) => {
    if (Number.isFinite(value)) out.push({ value, kind, source })
  }

  // From every verified fact + derived finding statement.
  for (const f of pack.verifiedFacts) for (const tok of extractNumericTokens(f.statement, `fact:${f.id}`)) push(tok.value, tok.kind, `fact:${f.id}`)
  for (const f of pack.derivedFindings) for (const tok of extractNumericTokens(f.statement, `finding:${f.id}`)) push(tok.value, tok.kind, `finding:${f.id}`)

  // From every dataTable cell (numeric only).
  for (const t of pack.dataTables) {
    for (let i = 0; i < t.rows.length; i++) {
      const row = t.rows[i]
      for (const [k, v] of Object.entries(row)) {
        if (typeof v === 'number' && Number.isFinite(v)) push(v, guessNumericKind(k), `table:${t.id}:${i}:${k}`)
        else if (typeof v === 'string') for (const tok of extractNumericTokens(v, `table:${t.id}:${i}:${k}`)) push(tok.value, tok.kind, `table:${t.id}:${i}:${k}`)
      }
    }
  }

  // Provenance + quality numbers.
  push(pack.quality.sampleSize, 'count', 'quality.sampleSize')
  push(pack.quality.freshness.daysOld, 'count', 'quality.freshness.daysOld')
  push(pack.quarantinedRows.length, 'count', 'quality.quarantinedCount')

  // Direct block-intent values.
  for (const b of blocksBuilt) {
    if (b.kind === 'stat_callout') {
      for (const tok of extractNumericTokens(b.value, `blockIntent:${b.kind}`)) push(tok.value, tok.kind, `blockIntent:${b.kind}`)
    }
    if (b.kind === 'ranking_table' && typeof b.limit === 'number') push(b.limit, 'count', `blockIntent:${b.kind}:limit`)
  }

  // Any ISO date mentioned in the pack methodology filters.
  for (const f of pack.methodology.filters) for (const tok of extractNumericTokens(f.value, `methodology:${f.label}`)) push(tok.value, tok.kind, `methodology:${f.label}`)
  for (const tok of extractNumericTokens(pack.methodology.summary, 'methodology.summary')) push(tok.value, tok.kind, 'methodology.summary')

  // Simple ratios reachable from evidence prices (psa10/raw + psa9/raw
  // per table row that has both). Bounded to first 200 to avoid
  // enumeration blowup on huge tables.
  const derived = derivedRatiosFromTables(pack)
  for (const d of derived) push(d.value, 'ratio', d.source)

  // Also allow the years appearing in the pack's dataAsOf + provenance.
  const yr = Number(pack.dataAsOf.slice(0, 4))
  if (Number.isFinite(yr)) push(yr, 'count', 'pack.dataAsOf.year')

  return out
}

function derivedRatiosFromTables(pack: EvidencePack): Array<{ value: number; source: string }> {
  const out: Array<{ value: number; source: string }> = []
  for (const t of pack.dataTables) {
    for (let i = 0; i < Math.min(t.rows.length, 200); i++) {
      const r = t.rows[i]
      const raw   = numeric(r.rawUsd ?? r.raw_usd ?? r.raw)
      const psa10 = numeric(r.psa10Usd ?? r.psa10_usd ?? r.psa10)
      const psa9  = numeric(r.psa9Usd ?? r.psa9_usd ?? r.psa9)
      if (raw && psa10) out.push({ value: psa10 / raw, source: `derived:${t.id}:${i}:psa10/raw` })
      if (raw && psa9)  out.push({ value: psa9  / raw, source: `derived:${t.id}:${i}:psa9/raw` })
    }
  }
  return out
}
function numeric(v: unknown): number | null {
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? Number(v.replace(/[$, ]/g, '').replace(/%$/, '')) : NaN)
  return Number.isFinite(n) && n > 0 ? n : null
}
function guessNumericKind(colKey: string): NumericToken['kind'] {
  const k = colKey.toLowerCase()
  if (/usd|price/.test(k)) return 'currency'
  if (/pct|percent|rate/.test(k)) return 'percent'
  if (/ratio|multiple|x$/.test(k)) return 'ratio'
  if (/date/.test(k)) return 'date'
  return 'count'
}

// ─────────────────────────────────────────────────────────────────
// Public audit entry
// ─────────────────────────────────────────────────────────────────

export function auditStudioNumerics(studio: StudioDocument, pack: EvidencePack, blocksBuilt: BlockIntent[]): NumericAuditResult {
  const tokens: NumericToken[] = []
  // Extract from headline, intro, seo fields, and every paragraph in bodyDoc.
  tokens.push(...extractNumericTokens(studio.headline, 'headline'))
  tokens.push(...extractNumericTokens(studio.intro,    'intro'))
  tokens.push(...extractNumericTokens(studio.seo.title,       'seoTitle'))
  tokens.push(...extractNumericTokens(studio.seo.description, 'seoDescription'))
  walkTiptapForNumericTokens(studio.bodyDoc, tokens)

  const allowed = buildAllowedValues(pack, blocksBuilt)
  const issues: NumericAuditIssue[] = []
  let matched = 0
  for (const t of tokens) {
    const hit = findAllowedMatch(t, allowed)
    if (hit) { matched += 1; continue }
    issues.push({
      token: t,
      reason: describeMismatch(t),
      nearest: nearestAllowed(t, allowed),
    })
  }
  return {
    status: issues.length === 0 ? 'pass' : 'review_required',
    checked: tokens.length,
    matched,
    issues,
  }
}

function walkTiptapForNumericTokens(node: any, out: NumericToken[], loc = 'body'): void {
  if (!node || typeof node !== 'object') return
  if (typeof node.text === 'string') {
    out.push(...extractNumericTokens(node.text, loc))
  }
  if (Array.isArray(node.content)) {
    let next = loc
    if (node.type === 'heading') next = 'heading'
    if (node.type === 'paragraph') next = 'paragraph'
    if (node.type === 'dataBlock') return   // block payloads are audited separately at build time
    for (const c of node.content) walkTiptapForNumericTokens(c, out, next)
  }
}

function findAllowedMatch(tok: NumericToken, allowed: AllowedValue[]): AllowedValue | null {
  for (const a of allowed) {
    if (!isCompatibleKind(tok.kind, a.kind)) continue
    if (matches(tok, a)) return a
  }
  return null
}
function isCompatibleKind(a: NumericToken['kind'], b: NumericToken['kind']): boolean {
  if (a === b) return true
  // A raw number (kind=count) may be checked against currency, percent, ratio, count.
  if (a === 'count')  return b === 'count'  || b === 'currency' || b === 'percent' || b === 'ratio'
  if (b === 'count')  return true
  return false
}
function matches(tok: NumericToken, a: AllowedValue): boolean {
  const tol = tokenTolerance(tok.kind, tok.value)
  return Math.abs(tok.value - a.value) <= tol
}
function tokenTolerance(kind: NumericToken['kind'], value: number): number {
  switch (kind) {
    case 'currency': return Math.max(CURRENCY_PCT_TOLERANCE, value * 0.005)  // 0.5 % relative on currency
    case 'percent':  return PERCENT_TOLERANCE
    case 'ratio':    return Math.max(0.1, value * RATIO_TOLERANCE)
    case 'count':    return COUNT_TOLERANCE
    case 'date':     return 0
    default:         return 0
  }
}
function nearestAllowed(tok: NumericToken, allowed: AllowedValue[]): NumericAuditIssue['nearest'] | undefined {
  let best: NumericAuditIssue['nearest'] | undefined
  let bestDiff = Number.POSITIVE_INFINITY
  for (const a of allowed) {
    if (!isCompatibleKind(tok.kind, a.kind)) continue
    const diff = Math.abs(tok.value - a.value)
    if (diff < bestDiff) { bestDiff = diff; best = { value: a.value, source: a.source } }
  }
  return best
}
function describeMismatch(tok: NumericToken): string {
  return `Number "${tok.raw}" (${tok.kind}) at ${tok.location} does not match any allowed value derived from the evidence pack.`
}
