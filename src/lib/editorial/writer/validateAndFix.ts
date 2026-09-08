// src/lib/editorial/writer/validateAndFix.ts
//
// EIC — simplified internal-data Writer, Stage 2.
//
// Reads the article produced by writer_internal. Runs the
// deterministic numeric audit against the featured/verified evidence
// (strict mode — no metadata numbers, no non-featured mover tables).
// Sonnet is asked to directly FIX any real problems and return the
// corrected article. This is the internal equivalent of the external
// check_and_fix stage.
//
// Sonnet does NOT get web_search here — internal articles are grounded
// in PokePrices data, not the wider web.

import { POKEPRICES_EDITORIAL_PROFILE } from '../strategistPrompt'
import { stripCitationMarkup } from './sanitizeCitations'
import type { NumericAuditIssue } from './types'

export const VALIDATE_AND_FIX_ROLE_RULES = `You are the PokePrices Internal Fact Checker. You are handed a data-driven article that was drafted from a compact evidence brief (medians, IQR, featured risers/fallers, featured sets, approved manual-review rows). Your job is to catch and DIRECTLY FIX meaningful problems and return the corrected article.

You do NOT have web_search. Every number and every card/set claim must be defensible from the evidence brief and the numeric-audit issue list below.

WHAT TO FIX

Only meaningful problems:
  * A number in the article that does not appear in the evidence brief (see numeric-audit issues below) — replace with the correct value from the brief, or rewrite the sentence to remove the unsupported figure.
  * A card or set claim that is not backed by any featured card / featured set / approved review row in the brief — either replace with a correctly-attributed claim or delete the sentence.
  * A causal explanation stated as fact ("Charizard climbed because collectors rushed back to vintage") when the brief only supports the observation — soften to observation-only language.
  * Endpoint observation counts described as "sales" / "sales volume" / "transactions" — rewrite to "pricing observations" / "tracked observations" / "endpoint observations".
  * Rejected claims from the brief that leaked back into the article — remove them.
  * Obvious internal contradictions.

If a claim is genuinely supported by the brief, leave it alone. Do NOT tinker with voice, opinion, structure, headings, or SEO fields unless they contain a factual error.

WHAT NOT TO DO

Do NOT:
  * Produce a forensic issue list. Fix and return.
  * Add a "Methodology" or "Data notes" section.
  * Insert bold formatting or em dashes.
  * Rewrite sections for style or shorten aggressively.
  * Add or remove sections.
  * Change the article length materially — small edits only.
  * Emit internal evidence identifiers (fact-*, finding-*, table-*) in reader-facing prose.
  * Include \`<cite>\`, citation-index, or tool-citation markup. Any such markup will be stripped anyway.

PRESERVE valid internal links. Existing Markdown links of the form \`[anchor](/insights/...)\` or \`[anchor](/set/...)\` are curated — leave them alone unless the anchor text is factually wrong.

If the article has no real problems (numeric audit is empty and nothing else is off), return it UNCHANGED and set \`correctionsSummary\` to "No changes needed."

OUTPUT FORMAT

Reply with ONE JSON object wrapped in a fenced code block tagged \`json\`. Nothing outside the block.

\`\`\`json
{
  "articleTitle":       string,
  "introSnippet":       string,
  "seoTitle":           string,
  "metaDescription":    string,
  "bodyMarkdown":       string,
  "correctionsSummary": string
}
\`\`\`

- articleTitle / introSnippet / seoTitle / metaDescription / bodyMarkdown: the FINAL article (identical to input if no changes needed, otherwise the corrected version).
- correctionsSummary: 1-3 sentences describing what you fixed, or "No changes needed."

If for any reason you cannot produce JSON exactly, still emit the article as plain Markdown starting with the title as \`# Title\` — a salvage path will recover it.`

export const VALIDATE_AND_FIX_SYSTEM_PROMPT = `${POKEPRICES_EDITORIAL_PROFILE}

${VALIDATE_AND_FIX_ROLE_RULES}`

// ─────────────────────────────────────────────────────────────────
// User turn
// ─────────────────────────────────────────────────────────────────

export function buildValidateAndFixUserTurn(args: {
  article: {
    articleTitle:    string
    introSnippet:    string
    seoTitle:        string
    metaDescription: string
    bodyMarkdown:    string
  }
  brief: unknown            // the same compact brief that writer_internal received
  numericIssues: NumericAuditIssue[]
  rejectedClaims: string[]
  today: string
}): string {
  const numericBlock = args.numericIssues.length === 0
    ? '(none — every number in the article was matched to the evidence brief)'
    : args.numericIssues.slice(0, 40).map(iss =>
        `- "${iss.token.raw}" (${iss.token.kind}) at ${iss.token.location} — ${iss.reason}`
      ).join('\n')

  const rejectedBlock = args.rejectedClaims.length === 0
    ? '(none)'
    : args.rejectedClaims.slice(0, 12).map(c => `- ${c}`).join('\n')

  return [
    'MODE=validate_and_fix_internal',
    '',
    `Today's date: ${args.today}`,
    '',
    'DETERMINISTIC NUMERIC AUDIT ISSUES:',
    numericBlock,
    '',
    'REJECTED CLAIMS (must not appear in article):',
    rejectedBlock,
    '',
    'ORIGINAL EVIDENCE BRIEF (identical to what the writer received):',
    '```json',
    JSON.stringify(args.brief, null, 2),
    '```',
    '',
    'DRAFT ARTICLE:',
    '```json',
    JSON.stringify(args.article, null, 2),
    '```',
    '',
    'Fix the meaningful problems flagged above and return the corrected article as JSON.',
  ].join('\n')
}

// ─────────────────────────────────────────────────────────────────
// Response parsing + salvage
// ─────────────────────────────────────────────────────────────────

export type ValidatedArticle = {
  articleTitle:       string
  introSnippet:       string
  seoTitle:           string
  metaDescription:    string
  bodyMarkdown:       string
  correctionsSummary: string
  salvaged:           boolean
}

export function parseValidateAndFixResponse(rawText: string): ValidatedArticle | null {
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

  const salvaged = salvageMarkdown(rawText)
  if (salvaged) return salvaged

  return null
}

function fromParsed(parsed: any, salvaged: boolean): ValidatedArticle {
  return {
    articleTitle:       clip(stripCitationMarkup(str(parsed.articleTitle ?? parsed.title ?? parsed.headline)), 300),
    introSnippet:       clip(stripCitationMarkup(str(parsed.introSnippet ?? parsed.intro ?? '')), 500),
    seoTitle:           clip(stripCitationMarkup(str(parsed.seoTitle ?? parsed.metaTitle ?? '')), 200),
    metaDescription:    clip(stripCitationMarkup(str(parsed.metaDescription ?? parsed.seoDescription ?? '')), 400),
    bodyMarkdown:       clip(stripCitationMarkup(str(parsed.bodyMarkdown ?? parsed.body ?? parsed.markdown ?? '')), 40_000),
    correctionsSummary: clip(str(parsed.correctionsSummary ?? parsed.summary ?? ''), 2000) || 'No changes needed.',
    salvaged,
  }
}

function salvageMarkdown(rawText: string): ValidatedArticle | null {
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
  const bodyMarkdown = stripCitationMarkup(lines.slice(bodyStart).join('\n').trim())
  if (bodyMarkdown.length < 100) return null
  const firstPara = bodyMarkdown.split(/\n\s*\n/, 1)[0] ?? ''
  const cleanTitle = stripCitationMarkup(title)
  return {
    articleTitle:       cleanTitle || 'Untitled article',
    introSnippet:       firstPara.replace(/[#*_`>]/g, '').slice(0, 160).trim(),
    seoTitle:           (cleanTitle || 'Untitled article').slice(0, 60),
    metaDescription:    firstPara.replace(/[#*_`>]/g, '').slice(0, 160).trim(),
    bodyMarkdown,
    correctionsSummary: 'Salvaged from unstructured validate_and_fix response.',
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
