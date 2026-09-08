// src/lib/editorial/writer/checkAndFix.ts
//
// EIC two-stage external Writer — Stage 2.
//
// Reads the article produced by research_and_write. Web-searches
// where useful with a small bounded budget. Directly FIXES
// meaningful factual risks and returns the corrected article. Does
// NOT emit a forensic issue list.
//
// Store only a short internal correctionsSummary.

import { POKEPRICES_EDITORIAL_PROFILE } from '../strategistPrompt'

export const CHECK_AND_FIX_ROLE_RULES = `You are the PokePrices Fact Checker. You are handed an article that has already been drafted from live web research. Your job is to catch and DIRECTLY FIX meaningful factual risks — not to produce an issue list.

You have the web_search tool. Use it sparingly to verify anything specific that looks risky. Bounded budget (~3 searches).

WHAT TO FIX

Only meaningful factual risks:
  * Wrong names (product, set, card, personal names)
  * Wrong dates (release dates, announcement dates, event dates)
  * Wrong card/set numbers, wrong prices, wrong quantities
  * Major internal contradictions inside the article
  * Rumor / leak / unconfirmed information presented as confirmed
  * Obviously unsupported strong claims

If a claim is genuinely correct, leave it. If a phrasing is fine, leave it. Do NOT tinker with voice, structure, headings, SEO, or opinion.

WHAT NOT TO DO

Do NOT:
  * Produce a forensic issue list.
  * Flag every sentence for lack of an evidence id.
  * Complain about ordinary numbers already present in the sources you were given.
  * Run a numeric allowlist audit.
  * Rewrite sections for style. Leave voice alone.
  * Add or remove sections.
  * Change the SEO title or meta description unless they contain a factual error.

If no meaningful problems exist, return the article UNCHANGED and set correctionsSummary to "No changes needed."

OUTPUT FORMAT

Reply with ONE JSON object wrapped in a fenced code block tagged \`json\`. Nothing outside the block.

\`\`\`json
{
  "title":              string,
  "metaTitle":          string,
  "metaDescription":    string,
  "bodyMarkdown":       string,
  "sources":            [ { "url": string, "title"?: string, "publisher"?: string } ],
  "correctionsSummary": string
}
\`\`\`

  * title / metaTitle / metaDescription / bodyMarkdown / sources: the FINAL article — identical to input if no changes needed, otherwise the corrected version.
  * correctionsSummary: 1-3 sentences describing what you fixed (or "No changes needed."). Never a list of every possible nit. Never an audit report.
  * If for any reason you cannot produce JSON exactly, still emit the article as plain Markdown starting with the title as \`# Title\` followed by the corrected body — a salvage path will recover it.`

export const CHECK_AND_FIX_SYSTEM_PROMPT = `${POKEPRICES_EDITORIAL_PROFILE}

${CHECK_AND_FIX_ROLE_RULES}`

export function buildCheckAndFixUserTurn(args: {
  article: {
    title:           string
    metaTitle:       string
    metaDescription: string
    bodyMarkdown:    string
    sources:         Array<{ url: string; title?: string; publisher?: string }>
  }
  today: string
}): string {
  return [
    'MODE=check_and_fix',
    '',
    `Today's date: ${args.today}`,
    '',
    'Check the article below for meaningful factual risks. Web-search sparingly where useful. Return the corrected article as JSON.',
    '',
    '```json',
    JSON.stringify(args.article, null, 2),
    '```',
  ].join('\n')
}

// ─────────────────────────────────────────────────────────────────
// Parser + salvage
// ─────────────────────────────────────────────────────────────────

export type CheckedArticle = {
  title:              string
  metaTitle:          string
  metaDescription:    string
  bodyMarkdown:       string
  sources:            Array<{ url: string; title?: string; publisher?: string }>
  correctionsSummary: string
  salvaged:           boolean
}

export function parseCheckAndFixResponse(rawText: string): CheckedArticle | null {
  if (!rawText || typeof rawText !== 'string') return null

  const fenced = rawText.match(/```json\s*([\s\S]*?)\s*```/i)
  if (fenced) {
    const j = safeParse(fenced[1])
    if (j && typeof j === 'object') {
      const built = fromParsed(j, false)
      if (built.bodyMarkdown.trim().length > 0) return built
    }
  }
  const anyFence = rawText.match(/```\s*(\{[\s\S]*?\})\s*```/)
  if (anyFence) {
    const j = safeParse(anyFence[1])
    if (j && typeof j === 'object') {
      const built = fromParsed(j, false)
      if (built.bodyMarkdown.trim().length > 0) return built
    }
  }
  const whole = safeParse(rawText.trim())
  if (whole && typeof whole === 'object') {
    const built = fromParsed(whole, false)
    if (built.bodyMarkdown.trim().length > 0) return built
  }
  const balanced = extractBalancedObject(rawText)
  if (balanced) {
    const built = fromParsed(balanced, false)
    if (built.bodyMarkdown.trim().length > 0) return built
  }
  // Salvage as plain Markdown; correctionsSummary defaults to
  // "Salvaged from unstructured response".
  const salvaged = salvageMarkdown(rawText)
  if (salvaged) return salvaged

  return null
}

function fromParsed(parsed: any, salvaged: boolean): CheckedArticle {
  return {
    title:              clip(str(parsed.title ?? parsed.headline), 300),
    metaTitle:          clip(str(parsed.metaTitle ?? parsed.seoTitle), 200),
    metaDescription:    clip(str(parsed.metaDescription ?? parsed.seoDescription), 400),
    bodyMarkdown:       clip(str(parsed.bodyMarkdown ?? parsed.body ?? parsed.markdown), 40_000),
    sources:            normaliseSources(parsed.sources ?? parsed.references),
    correctionsSummary: clip(str(parsed.correctionsSummary ?? parsed.summary ?? ''), 2000) || 'No changes needed.',
    salvaged,
  }
}

function normaliseSources(v: unknown): Array<{ url: string; title?: string; publisher?: string }> {
  if (!Array.isArray(v)) return []
  const out: Array<{ url: string; title?: string; publisher?: string }> = []
  const seen = new Set<string>()
  for (const s of v.slice(0, 40)) {
    if (!s) continue
    const url = typeof s === 'string' ? s : str((s as any).url)
    if (!url || !/^https?:\/\//i.test(url)) continue
    const key = url.toLowerCase().replace(/\/$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    if (typeof s === 'string') out.push({ url })
    else out.push({
      url,
      title:     (s as any).title     ? clip(str((s as any).title), 300)     : undefined,
      publisher: (s as any).publisher ? clip(str((s as any).publisher), 200) : undefined,
    })
  }
  return out
}

function salvageMarkdown(rawText: string): CheckedArticle | null {
  const clean = rawText.trim()
  if (clean.length < 120) return null
  const lines = clean.split(/\r?\n/)
  let title = '', bodyStart = 0
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim()
    if (!ln) continue
    if (ln.startsWith('# ')) { title = ln.slice(2).trim(); bodyStart = i + 1 }
    else                     { title = ln.replace(/^#+\s*/, '').slice(0, 300); bodyStart = i + (ln.startsWith('#') ? 1 : 0) }
    break
  }
  const bodyMarkdown = lines.slice(bodyStart).join('\n').trim()
  if (bodyMarkdown.length < 100) return null
  const firstPara = bodyMarkdown.split(/\n\s*\n/, 1)[0] ?? ''
  return {
    title:              title || 'Untitled article',
    metaTitle:          (title || 'Untitled article').slice(0, 60),
    metaDescription:    firstPara.replace(/[#*_`>]/g, '').slice(0, 160).trim(),
    bodyMarkdown,
    sources:            [],
    correctionsSummary: 'Salvaged from unstructured checker response.',
    salvaged:           true,
  }
}

function safeParse(s: string): any {
  try { const v = JSON.parse(s); return (v && typeof v === 'object') ? v : null }
  catch { return null }
}
function extractBalancedObject(raw: string): any {
  const start = raw.indexOf('{')
  if (start < 0) return null
  let depth = 0, inString = false, escape = false
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (inString) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') depth += 1
    else if (ch === '}') { depth -= 1; if (depth === 0) return safeParse(raw.slice(start, i + 1)) }
  }
  return null
}

function str(v: unknown): string { return typeof v === 'string' ? v : '' }
function clip(s: string, cap: number): string { return s.slice(0, cap) }
