// src/lib/editorial/overlap.ts
//
// EIC Block 3 — deterministic overlap detection between a proposed
// editorial project and the existing library of published articles.
//
// Explicit non-goal: this is NOT a cannibalisation model. At eight
// articles it doesn't need to be — a candidate's headline usually
// tells us more than any embedding would. When the article count
// grows enough that this genuinely breaks down (~50+), swap this
// for a proper AI check in a later block. Until then, transparent
// deterministic scoring is easier to trust and to debug.
//
// Signals combined:
//   * headline-token overlap (Jaccard on stemless normalised words,
//     with a stop-list to stop "the / a / of" dominating short titles)
//   * shared theme        (categorical bonus)
//   * shared article_type (categorical bonus)
//   * shared set references (from `set_refs` or references found in
//     text) — powerful signal for set-specific coverage
//   * shared card references (same)
//   * body-text token overlap on top-K terms (bounded work)
//
// The final label is one of:
//   'strong'   — clearly overlapping existing coverage
//   'possible' — worth a look
//   'low'      — safe to write
//
// Together with `matches` (top-N closest articles) this is enough for
// the future editorial copilot to say "hey, we already published
// something quite similar to this."

import { bodyJsonToPlainText, tokeniseForSearch, normaliseSetName } from './plainText'

// ── Types ────────────────────────────────────────────────────────

export type OverlapCandidate = {
  title:       string
  angle?:      string | null
  articleType?: string | null   // matches EditorialArticleType if applicable
  theme?:      string | null
  setRefs?:    readonly string[] | null
  cardRefs?:   readonly string[] | null
}

export type OverlapExistingArticle = {
  id:          string
  slug:        string
  headline:    string
  intro?:      string | null
  theme?:      string | null
  articleType?: string | null   // rarely known for existing insights today
  setRefs?:    readonly string[] | null
  cardRefs?:   readonly string[] | null
  /** Optional pre-computed plain body text. Falls back to `bodyJson`
   *  extraction when missing so callers can pass either. */
  plainText?:  string | null
  /** Raw body_json for text extraction when plainText isn't provided. */
  bodyJson?:   unknown
}

export type OverlapMatch = {
  articleId:   string
  slug:        string
  headline:    string
  score:       number             // 0..1
  reasons:     readonly string[]  // human-readable, e.g. ['shared theme "grading"', '3 shared headline terms']
}

export type OverlapReport = {
  verdict: 'low' | 'possible' | 'strong'
  score:   number                 // 0..1 — the top match's score
  matches: readonly OverlapMatch[]
}

// ── Scoring ──────────────────────────────────────────────────────

const STOP_WORDS = new Set<string>([
  // Ultra-common English words that would otherwise dominate short titles.
  'a','an','the','and','or','but','of','to','in','on','for','with','by','from','at','as','is','are','was','were','be','been','being',
  'this','that','these','those','it','its','our','your','their','my','me','you','we','us','they','them',
  'not','no','yes','so','if','then','than','also','just','only','too','very','more','most','less','least',
  'do','does','did','done','have','has','had','will','would','can','could','should','may','might','shall',
  'how','what','when','where','why','which','who','whom','whose','vs','versus','into','out','up','down','over','under','again','still',
  // Pokémon-domain filler that also dominates and doesn't discriminate.
  'pokemon','pokémon','tcg','card','cards','collectors','collector','collect','collecting','market','set','sets','right','now','really',
])

const HEADLINE_TOKEN_WEIGHT     = 0.60
const BODY_TOKEN_WEIGHT         = 0.15
const SHARED_THEME_WEIGHT       = 0.10
const SHARED_ARTICLE_TYPE_WEIGHT= 0.05
const SHARED_SET_WEIGHT         = 0.15
const SHARED_CARD_WEIGHT        = 0.05

// Thresholds tuned against the current 8-article live library so
// obvious near-duplicates surface as at least 'possible'. Deterministic
// scoring at this scale cannot reliably reach 'strong' unless titles
// are near-identical AND shared set/card refs exist — which is the
// documented limitation. A future block will move this to an AI
// check once the library is large enough for embeddings to earn
// their keep.
const STRONG_THRESHOLD   = 0.45
const POSSIBLE_THRESHOLD = 0.22

const TOP_MATCHES       = 3
const BODY_TOP_TOKENS   = 40   // cap work per article

function contentTokens(text: string): Set<string> {
  const set = new Set<string>()
  for (const w of tokeniseForSearch(text)) if (!STOP_WORDS.has(w)) set.add(w)
  return set
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  a.forEach(w => { if (b.has(w)) inter++ })
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

/** Take the top-K most-signal-ful body tokens by frequency then
 *  return them as a Set. This bounds the per-article overlap work. */
function topBodyTokens(text: string, k: number = BODY_TOP_TOKENS): Set<string> {
  const counts = new Map<string, number>()
  for (const w of tokeniseForSearch(text)) {
    if (STOP_WORDS.has(w)) continue
    counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  return new Set(
    Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([w]) => w),
  )
}

function normaliseSetSet(list: readonly string[] | null | undefined): Set<string> {
  if (!Array.isArray(list)) return new Set()
  return new Set(list.map(normaliseSetName).filter(Boolean))
}

function normaliseCardSet(list: readonly string[] | null | undefined): Set<string> {
  if (!Array.isArray(list)) return new Set()
  return new Set(list.map(s => (s || '').trim().toLowerCase()).filter(Boolean))
}

// ── Main API ─────────────────────────────────────────────────────

export function computeOverlap(
  candidate: OverlapCandidate,
  existing:  readonly OverlapExistingArticle[],
): OverlapReport {
  const candHeadline = contentTokens(`${candidate.title} ${candidate.angle ?? ''}`)
  const candSetRefs  = normaliseSetSet(candidate.setRefs)
  const candCardRefs = normaliseCardSet(candidate.cardRefs)

  const scored: OverlapMatch[] = []

  for (const art of existing) {
    const reasons: string[] = []
    let score = 0

    // Headline-token overlap
    const artHeadline = contentTokens(`${art.headline} ${art.intro ?? ''}`)
    const jH = jaccard(candHeadline, artHeadline)
    if (jH > 0) {
      score += jH * HEADLINE_TOKEN_WEIGHT
      const shared = Array.from(candHeadline).filter(w => artHeadline.has(w))
      if (shared.length) reasons.push(`${shared.length} shared headline term${shared.length === 1 ? '' : 's'}: ${shared.slice(0, 5).join(', ')}`)
    }

    // Shared theme (categorical)
    if (candidate.theme && art.theme && candidate.theme.toLowerCase() === art.theme.toLowerCase()) {
      score += SHARED_THEME_WEIGHT
      reasons.push(`shared theme "${art.theme}"`)
    }

    // Shared article_type (categorical — rarely known for existing insights today)
    if (candidate.articleType && art.articleType && candidate.articleType === art.articleType) {
      score += SHARED_ARTICLE_TYPE_WEIGHT
      reasons.push(`same article type "${art.articleType}"`)
    }

    // Set references
    const artSetRefs = normaliseSetSet(art.setRefs)
    if (candSetRefs.size && artSetRefs.size) {
      let hits = 0
      const hitNames: string[] = []
      candSetRefs.forEach(s => { if (artSetRefs.has(s)) { hits++; hitNames.push(s) } })
      if (hits > 0) {
        score += SHARED_SET_WEIGHT * Math.min(1, hits / Math.max(1, candSetRefs.size))
        reasons.push(`shared set${hits === 1 ? '' : 's'}: ${hitNames.slice(0, 3).join(', ')}`)
      }
    }

    // Card references
    const artCardRefs = normaliseCardSet(art.cardRefs)
    if (candCardRefs.size && artCardRefs.size) {
      let hits = 0
      candCardRefs.forEach(c => { if (artCardRefs.has(c)) hits++ })
      if (hits > 0) {
        score += SHARED_CARD_WEIGHT * Math.min(1, hits / Math.max(1, candCardRefs.size))
        reasons.push(`${hits} shared card reference${hits === 1 ? '' : 's'}`)
      }
    }

    // Body-token overlap on the top-K existing-article tokens vs the
    // candidate's headline tokens. This punches above its weight for
    // titles that omit an obvious keyword (e.g. "PSA" appears in the
    // body of half the library).
    const artBodyText = art.plainText ?? bodyJsonToPlainText(art.bodyJson, { maxChars: 20000 })
    if (artBodyText) {
      const bodyTop = topBodyTokens(artBodyText)
      const jB = jaccard(candHeadline, bodyTop)
      if (jB > 0) {
        score += jB * BODY_TOKEN_WEIGHT
        // Only add a reason if body-token contribution is meaningful.
        if (jB > 0.05) reasons.push('shared body vocabulary')
      }
    }

    if (score > 0) scored.push({ articleId: art.id, slug: art.slug, headline: art.headline, score: clamp01(score), reasons })
  }

  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, TOP_MATCHES)
  const topScore = top[0]?.score ?? 0
  const verdict: OverlapReport['verdict'] =
    topScore >= STRONG_THRESHOLD  ? 'strong'
    : topScore >= POSSIBLE_THRESHOLD ? 'possible'
    : 'low'

  return { verdict, score: topScore, matches: top }
}

function clamp01(n: number): number { return n < 0 ? 0 : n > 1 ? 1 : n }
