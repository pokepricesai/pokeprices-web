// src/lib/insights/richText.ts
// Block 5A-W-47A — pure helpers for the Insights article rich-text
// block model.
//
// Adds two capabilities without changing the DB schema:
//   * paragraph blocks may carry a `content` array of typed segments
//     (plain text, bold, inline link) in addition to the legacy
//     `text: string` shape;
//   * a new `image` block type carries { src, alt, caption? }.
//
// Everything is JSON-safe. No HTML is stored. The admin editor writes
// segments; the renderer walks them into React nodes. No caller ever
// invokes dangerouslySetInnerHTML.

// ── Block model ─────────────────────────────────────────────

export type ParagraphSegment = {
  /** The visible text of the segment. Renders through React so any
   *  HTML metacharacters are automatically escaped. */
  text: string
  /** Optional: render as <strong>...</strong>. */
  bold?: boolean
  /** Optional: wrap the segment in an anchor. Must pass
   *  `isSafeArticleHref` at render time; unsafe hrefs degrade to
   *  plain text so a bad segment cannot inject an unsafe link. */
  href?: string
}

export type ParagraphBlockRich = {
  type:    'paragraph'
  content: ParagraphSegment[]
  /** Kept for backwards compatibility — a paragraph with BOTH
   *  `content` and `text` prefers `content`. Legacy renderer
   *  reads `text` when `content` is missing. */
  text?:   string
}

export type ParagraphBlockLegacy = {
  type: 'paragraph' | 'text'
  text: string
}

export type ParagraphBlock = ParagraphBlockRich | ParagraphBlockLegacy

export type HeadingBlock = {
  type: 'heading'
  text: string
}

export type ImageBlock = {
  type:     'image'
  src:      string
  alt:      string
  caption?: string
  /** Marks the image as decorative — permits empty alt text and
   *  emits aria-hidden on the rendered figure. Off by default. */
  decorative?: boolean
}

/** The concrete block types this module OWNS. Existing block types
 *  the renderer already handles (`card_grid`, `chart`) live outside
 *  this union and are untouched by W47A. */
export type ArticleBlock =
  | HeadingBlock
  | ParagraphBlock
  | ImageBlock

// ── Safe URL helpers ───────────────────────────────────────

const INTERNAL_HOST = 'www.pokeprices.io'

/** Article-body link href validator. Accepts:
 *    * "/…"        (site-internal path; not "//…")
 *    * "https://www.pokeprices.io/…"     (same-origin absolute)
 *    * "https://…"                        (external HTTPS)
 *  Rejects:
 *    * empty, null, undefined, non-string
 *    * "javascript:", "data:", "file:", "vbscript:"
 *    * protocol-relative "//host"
 *    * http:// (require HTTPS)
 *    * mailto:, tel:, sms:  (not needed for article body links) */
export function isSafeArticleHref(href: unknown): href is string {
  if (typeof href !== 'string') return false
  const trimmed = href.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('//')) return false
  if (trimmed.startsWith('/'))  return true
  if (/^https:\/\//i.test(trimmed)) {
    try { new URL(trimmed) } catch { return false }
    return true
  }
  return false
}

/** True when the href points at the same origin (either as "/path"
 *  or "https://www.pokeprices.io/…"). Used by the renderer to
 *  decide whether to add target="_blank" + rel="noopener noreferrer". */
export function isInternalArticleHref(href: string): boolean {
  if (!isSafeArticleHref(href)) return false
  if (href.startsWith('/')) return true
  try {
    return new URL(href).hostname === INTERNAL_HOST
  } catch { return false }
}

/** Article-image src validator. Only https:// URLs pass; on-site
 *  paths are rejected here because the editor is expected to store
 *  the resolved Supabase Storage public URL (or an equivalent
 *  publicly hosted image), not a client-relative path. */
export function isSafeArticleImageSrc(src: unknown): src is string {
  if (typeof src !== 'string') return false
  const trimmed = src.trim()
  if (!trimmed) return false
  if (!/^https:\/\//i.test(trimmed)) return false
  try {
    const u = new URL(trimmed)
    if (!u.hostname) return false
    return true
  } catch { return false }
}

// ── Image upload constraints (used by the admin editor) ─────

/** Accepted image MIME types for uploads. SVG is deliberately
 *  excluded — the existing infrastructure does not sanitise SVG. */
export const ARTICLE_IMAGE_MIME_ALLOWLIST: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
]

/** Reject uploads larger than this. Keeps the article-image bucket
 *  from bloating and matches typical hero-image dimensions. */
export const ARTICLE_IMAGE_MAX_BYTES = 5 * 1024 * 1024 // 5 MB

/** Pure validation for a File object — used before upload. Returns
 *  null when the file is acceptable; otherwise an admin-friendly
 *  error message. */
export function validateArticleImageFile(file: { type?: string; size?: number; name?: string } | null | undefined): string | null {
  if (!file) return 'No file selected.'
  if (typeof file.type !== 'string' || !ARTICLE_IMAGE_MIME_ALLOWLIST.includes(file.type)) {
    return `Unsupported image type${file.type ? ` (${file.type})` : ''}. Please upload a JPEG, PNG or WebP.`
  }
  if (typeof file.size === 'number' && file.size > ARTICLE_IMAGE_MAX_BYTES) {
    return `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${(ARTICLE_IMAGE_MAX_BYTES / 1024 / 1024).toFixed(0)} MB.`
  }
  return null
}

// ── Segment ↔ HTML conversion (for the contentEditable admin field) ─

/** Convert a segment array into a display-safe HTML string suitable
 *  for use as the initial innerHTML of a contentEditable editor. The
 *  admin UI never re-parses this string as HTML for storage — it
 *  reads the browser DOM back out via `htmlToSegments()`. */
export function segmentsToEditorHtml(segments: readonly ParagraphSegment[]): string {
  return segments.map(seg => renderOneSegment(seg)).join('')
}

function renderOneSegment(seg: ParagraphSegment): string {
  const escaped = escapeHtml(seg.text ?? '')
  const withBold = seg.bold ? `<strong>${escaped}</strong>` : escaped
  if (seg.href && isSafeArticleHref(seg.href)) {
    const hrefAttr = escapeAttr(seg.href)
    return `<a href="${hrefAttr}">${withBold}</a>`
  }
  return withBold
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
function escapeAttr(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}

/** Convert a DOM subtree back into the segment array shape. The
 *  caller passes the root node from a contentEditable div. Only
 *  <strong>, <b>, <a href="..."> and text nodes are honoured; every
 *  other element contributes its text-only content. */
export function domToSegments(root: Node): ParagraphSegment[] {
  const out: ParagraphSegment[] = []
  walk(root, { bold: false, href: undefined }, out)
  return coalesceSegments(out)
}

type WalkContext = { bold: boolean; href: string | undefined }

function walk(node: Node, ctx: WalkContext, out: ParagraphSegment[]): void {
  if (node.nodeType === 3 /* Node.TEXT_NODE */) {
    const text = (node as Text).data
    if (!text) return
    out.push({
      text,
      ...(ctx.bold ? { bold: true } : {}),
      ...(ctx.href ? { href: ctx.href } : {}),
    })
    return
  }
  if (node.nodeType !== 1 /* Node.ELEMENT_NODE */) return
  const el = node as Element
  const tag = el.tagName.toLowerCase()

  // Extract formatting introduced by this element.
  let nextCtx = ctx
  if (tag === 'strong' || tag === 'b') {
    nextCtx = { ...nextCtx, bold: true }
  } else if (tag === 'a') {
    const raw = el.getAttribute('href') || ''
    if (isSafeArticleHref(raw)) nextCtx = { ...nextCtx, href: raw }
    // Unsafe hrefs are ignored — the children still contribute text.
  } else if (tag === 'br') {
    // Treat <br> as a single space so the plain-text view stays readable.
    out.push({
      text: ' ',
      ...(ctx.bold ? { bold: true } : {}),
      ...(ctx.href ? { href: ctx.href } : {}),
    })
    return
  }

  for (const child of Array.from(el.childNodes)) walk(child, nextCtx, out)
}

/** Merge adjacent segments whose formatting is identical so the
 *  saved JSON stays compact and diffs cleanly. */
export function coalesceSegments(segments: readonly ParagraphSegment[]): ParagraphSegment[] {
  const out: ParagraphSegment[] = []
  for (const seg of segments) {
    if (!seg.text) continue
    const last = out[out.length - 1]
    if (last
      && !!last.bold === !!seg.bold
      && (last.href || '') === (seg.href || '')
    ) {
      last.text = last.text + seg.text
      continue
    }
    // Clone so the caller's array is not mutated.
    const copy: ParagraphSegment = { text: seg.text }
    if (seg.bold) copy.bold = true
    if (seg.href) copy.href = seg.href
    out.push(copy)
  }
  return out
}

/** Convenience: turn a legacy plain-text paragraph into a single
 *  segment array (bold=false, no href). */
export function plainTextToSegments(text: string): ParagraphSegment[] {
  if (typeof text !== 'string' || !text) return []
  return [{ text }]
}

/** Convenience: read whatever shape a paragraph block is stored in
 *  and return a normalised segment array for rendering / editing.
 *  Prefers `content` when both are present; falls back to `text`. */
export function readParagraphSegments(block: ParagraphBlock | null | undefined): ParagraphSegment[] {
  if (!block) return []
  if ('content' in block && Array.isArray((block as ParagraphBlockRich).content)) {
    return (block as ParagraphBlockRich).content.filter(s => s && typeof s.text === 'string' && s.text.length > 0)
  }
  const text = (block as ParagraphBlockLegacy).text
  return typeof text === 'string' && text ? [{ text }] : []
}
