// src/lib/editorial/plainText.ts
//
// EIC Block 3 — safe body_json → plain text extraction.
//
// Purpose: give the editorial context, the overlap helper and the
// future AI copilot a compact, format-free view of an article's text.
// It does NOT try to reproduce visual formatting — only the words the
// article actually contains, in reading order.
//
// Handles every shape the public renderer already supports:
//   * { blocks: [...] }               — modern (all live rows today)
//   * [...]                           — bare array (legacy)
//   * heading                         — { type:'heading', text }
//   * paragraph (legacy plain text)   — { type:'paragraph', text: '...\n\n...' }
//   * paragraph (rich segments)       — { type:'paragraph', content:[{text,bold?,href?}] }
//   * image                           — caption text (visible on-page)
//   * card_grid                       — heading text (visible on-page)
//   * chart                           — title + description (visible on-page)
//   * unknown block types             — best-effort text extraction from any
//                                        string-valued property; never throws
//
// Pure. No I/O. No React. Safe to import from anywhere.

// The shape guards below are intentionally loose (unknown → best effort)
// because the live table's block objects are stored as arbitrary jsonb.
// We never trust `type` alone to imply a shape.

export type PlainTextOptions = {
  /** Words joined by this separator between blocks. Default: ' '. Set
   *  to '\n\n' for a more paragraph-like layout. */
  separator?: string
  /** Cap the returned string at this many characters. 0 = no cap.
   *  Default 0. Useful when passing text to an LLM. */
  maxChars?: number
}

export function bodyJsonToPlainText(bodyJson: unknown, opts: PlainTextOptions = {}): string {
  const separator = opts.separator ?? ' '
  const maxChars  = opts.maxChars ?? 0

  const chunks: string[] = []
  for (const block of extractBlocks(bodyJson)) collectBlockText(block, chunks)

  let out = chunks
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(separator)

  if (maxChars > 0 && out.length > maxChars) out = out.slice(0, maxChars).trimEnd() + '…'
  return out
}

/** Return the block list from any of the shapes we accept. */
function extractBlocks(bodyJson: unknown): unknown[] {
  if (Array.isArray(bodyJson)) return bodyJson
  if (bodyJson && typeof bodyJson === 'object') {
    const blocks = (bodyJson as any).blocks
    if (Array.isArray(blocks)) return blocks
  }
  return []
}

function collectBlockText(block: unknown, out: string[]): void {
  if (!block || typeof block !== 'object') {
    if (typeof block === 'string') out.push(block)
    return
  }
  const b = block as Record<string, unknown>
  const t = typeof b.type === 'string' ? b.type : ''

  // Rich paragraph with typed segments — take each segment.text.
  if (Array.isArray(b.content)) {
    for (const seg of b.content) {
      if (seg && typeof seg === 'object' && typeof (seg as any).text === 'string') {
        out.push((seg as any).text)
      }
    }
    // The rich shape sometimes ALSO carries `text` as a legacy fallback;
    // if content produced nothing usable, fall through to the string branch.
    if (b.content.length > 0) return
  }

  // Common single-string fields — one branch per known block kind, and
  // a defensive scan for anything else.
  if (typeof b.text === 'string')        out.push(b.text)
  if (typeof b.heading === 'string')     out.push(b.heading)
  if (typeof b.title === 'string')       out.push(b.title)
  if (typeof b.caption === 'string')     out.push(b.caption)
  if (typeof b.description === 'string') out.push(b.description)

  // For any unknown block kind we haven't matched above, scoop up any
  // remaining top-level string properties so we never lose editorial
  // signal to schema drift. Never throws.
  if (!t || !KNOWN_TYPES.has(t)) {
    for (const [k, v] of Object.entries(b)) {
      if (k === 'type' || k === 'id') continue
      if (typeof v === 'string' && v.length > 0 && !SEEN_STRING_KEYS.has(k)) out.push(v)
    }
  }
}

const KNOWN_TYPES = new Set(['heading', 'paragraph', 'text', 'image', 'card_grid', 'chart'])
const SEEN_STRING_KEYS = new Set(['text', 'heading', 'title', 'caption', 'description'])

// ── Small helpers for downstream editorial code ─────────────────

/** Very cheap word tokenisation for search/overlap. Lowercases,
 *  splits on non-word, filters empties and pure numbers. */
export function tokeniseForSearch(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9éúöé]+/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !/^\d+$/.test(w))
}

/** Normalise a set name for cross-source deduplication and matching.
 *  Strips known prefixes ("Mega Evolution -", "Japanese ") and lowercases.
 *  Non-destructive: the original name is not mutated in-place. */
export function normaliseSetName(setName: string): string {
  return (setName || '')
    .replace(/^\s*mega\s+evolution\s*[-–—:]\s*/i, '')
    .replace(/^\s*japanese\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}
