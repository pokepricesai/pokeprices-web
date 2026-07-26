// Block 5A-W-47A — pure tests for the article rich-text helpers.

import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  isSafeArticleHref,
  isInternalArticleHref,
  isSafeArticleImageSrc,
  ARTICLE_IMAGE_MIME_ALLOWLIST,
  ARTICLE_IMAGE_MAX_BYTES,
  validateArticleImageFile,
  segmentsToEditorHtml,
  domToSegments,
  coalesceSegments,
  plainTextToSegments,
  readParagraphSegments,
} from '../richText'

// ── URL guards ──

describe('isSafeArticleHref', () => {
  it('accepts internal paths that start with "/"', () => {
    expect(isSafeArticleHref('/insights')).toBe(true)
    expect(isSafeArticleHref('/insights/may-2026-pokemon-card-market-trends')).toBe(true)
    expect(isSafeArticleHref('/pokemon/greninja')).toBe(true)
  })
  it('accepts external https:// URLs', () => {
    expect(isSafeArticleHref('https://en.wikipedia.org/wiki/Pikachu')).toBe(true)
    expect(isSafeArticleHref('https://www.pokeprices.io/insights')).toBe(true)
  })
  it('rejects protocol-relative //host', () => {
    expect(isSafeArticleHref('//evil.example.com/x')).toBe(false)
    expect(isSafeArticleHref('//www.pokeprices.io/x')).toBe(false)
  })
  it('rejects unsafe protocols', () => {
    expect(isSafeArticleHref('javascript:alert(1)')).toBe(false)
    expect(isSafeArticleHref('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
    expect(isSafeArticleHref('file:///etc/passwd')).toBe(false)
    expect(isSafeArticleHref('vbscript:msgbox("x")')).toBe(false)
  })
  it('rejects http:// (plain HTTP) — external must be https', () => {
    expect(isSafeArticleHref('http://example.com')).toBe(false)
  })
  it('rejects mailto: / tel: / sms:', () => {
    expect(isSafeArticleHref('mailto:x@y.z')).toBe(false)
    expect(isSafeArticleHref('tel:+15551234')).toBe(false)
    expect(isSafeArticleHref('sms:+15551234')).toBe(false)
  })
  it('rejects empty / null / undefined / non-string', () => {
    expect(isSafeArticleHref('')).toBe(false)
    expect(isSafeArticleHref('  ')).toBe(false)
    expect(isSafeArticleHref(null)).toBe(false)
    expect(isSafeArticleHref(undefined)).toBe(false)
    expect(isSafeArticleHref(123 as any)).toBe(false)
    expect(isSafeArticleHref({} as any)).toBe(false)
  })
})

describe('isInternalArticleHref', () => {
  it('true for "/path"', () => {
    expect(isInternalArticleHref('/insights')).toBe(true)
  })
  it('true for www.pokeprices.io absolute URLs', () => {
    expect(isInternalArticleHref('https://www.pokeprices.io/pokemon/pikachu')).toBe(true)
  })
  it('false for external hosts', () => {
    expect(isInternalArticleHref('https://en.wikipedia.org/wiki/x')).toBe(false)
  })
  it('false for unsafe hrefs', () => {
    expect(isInternalArticleHref('javascript:alert(1)')).toBe(false)
    expect(isInternalArticleHref('//www.pokeprices.io/x')).toBe(false)
  })
})

// ── Image src guard ──

describe('isSafeArticleImageSrc', () => {
  it('accepts https:// URLs', () => {
    expect(isSafeArticleImageSrc('https://images.pokeprices.io/x.jpg')).toBe(true)
    expect(isSafeArticleImageSrc('https://egidpsrkqvymvioidatc.supabase.co/storage/v1/object/public/creator-images/insights/body/1.png')).toBe(true)
  })
  it('rejects protocol-relative and http', () => {
    expect(isSafeArticleImageSrc('//example.com/x.jpg')).toBe(false)
    expect(isSafeArticleImageSrc('http://example.com/x.jpg')).toBe(false)
  })
  it('rejects data:, javascript:, file:', () => {
    expect(isSafeArticleImageSrc('data:image/png;base64,iVB…')).toBe(false)
    expect(isSafeArticleImageSrc('javascript:alert(1)')).toBe(false)
    expect(isSafeArticleImageSrc('file:///etc/passwd')).toBe(false)
  })
  it('rejects internal /path (article images must be publicly hosted)', () => {
    expect(isSafeArticleImageSrc('/images/x.jpg')).toBe(false)
  })
  it('rejects empty / non-string', () => {
    expect(isSafeArticleImageSrc('')).toBe(false)
    expect(isSafeArticleImageSrc(null)).toBe(false)
    expect(isSafeArticleImageSrc(undefined)).toBe(false)
  })
})

// ── validateArticleImageFile ──

describe('validateArticleImageFile', () => {
  it('accepts the standard allowlist', () => {
    for (const type of ARTICLE_IMAGE_MIME_ALLOWLIST) {
      expect(validateArticleImageFile({ type, size: 1000, name: 'x' })).toBeNull()
    }
  })
  it('rejects SVG', () => {
    expect(validateArticleImageFile({ type: 'image/svg+xml', size: 1000, name: 'x.svg' })).toMatch(/unsupported/i)
  })
  it('rejects executables and text', () => {
    expect(validateArticleImageFile({ type: 'application/x-msdownload', size: 1000, name: 'x.exe' })).toMatch(/unsupported/i)
    expect(validateArticleImageFile({ type: 'text/plain', size: 1000, name: 'x.txt' })).toMatch(/unsupported/i)
    expect(validateArticleImageFile({ type: 'application/pdf', size: 1000, name: 'x.pdf' })).toMatch(/unsupported/i)
  })
  it('rejects oversize files', () => {
    expect(validateArticleImageFile({ type: 'image/jpeg', size: ARTICLE_IMAGE_MAX_BYTES + 1, name: 'x.jpg' })).toMatch(/too large/i)
  })
  it('null / undefined input reports "no file"', () => {
    expect(validateArticleImageFile(null)).toMatch(/no file/i)
    expect(validateArticleImageFile(undefined)).toMatch(/no file/i)
  })
})

// ── segments ↔ editor HTML round-trip ──

describe('segmentsToEditorHtml + domToSegments', () => {
  function roundTrip(segments: Parameters<typeof segmentsToEditorHtml>[0]) {
    const html = segmentsToEditorHtml(segments)
    const dom = new JSDOM(`<div id="root">${html}</div>`)
    const root = dom.window.document.getElementById('root')!
    return domToSegments(root)
  }
  it('plain text round-trips', () => {
    expect(roundTrip([{ text: 'Hello world' }])).toEqual([{ text: 'Hello world' }])
  })
  it('bold segment round-trips', () => {
    expect(roundTrip([{ text: 'important', bold: true }])).toEqual([{ text: 'important', bold: true }])
  })
  it('internal link round-trips', () => {
    expect(roundTrip([{ text: 'read more', href: '/insights' }])).toEqual([{ text: 'read more', href: '/insights' }])
  })
  it('bold + link combines', () => {
    expect(roundTrip([{ text: 'strong link', bold: true, href: '/insights' }])).toEqual(
      [{ text: 'strong link', bold: true, href: '/insights' }],
    )
  })
  it('sequence of segments preserves order', () => {
    const segs = [
      { text: 'Some ' },
      { text: 'bold', bold: true },
      { text: ' text with a ' },
      { text: 'link', href: '/x' },
      { text: '.' },
    ]
    expect(roundTrip(segs)).toEqual(segs)
  })
  it('escapes HTML metacharacters in text', () => {
    const html = segmentsToEditorHtml([{ text: '<script>alert(1)</script>' }])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
  it('escapes href attribute', () => {
    const html = segmentsToEditorHtml([{ text: 'x', href: '/a"onerror="' }])
    // Regardless of whether we accept the href, we must not close the attribute early.
    expect(html).not.toMatch(/href="\/a"onerror/)
  })
  it('dom round-trip drops unsafe hrefs but keeps the visible text', () => {
    const dom = new JSDOM(`<div id="r"><a href="javascript:alert(1)">click me</a></div>`)
    const segs = domToSegments(dom.window.document.getElementById('r')!)
    expect(segs).toEqual([{ text: 'click me' }])
  })
  it('dom round-trip: <b> is treated as bold', () => {
    const dom = new JSDOM(`<div id="r">plain <b>bold</b> plain</div>`)
    const segs = domToSegments(dom.window.document.getElementById('r')!)
    expect(segs).toEqual([
      { text: 'plain ' },
      { text: 'bold', bold: true },
      { text: ' plain' },
    ])
  })
  it('dom round-trip: <br> becomes a single space (coalesced with siblings)', () => {
    const dom = new JSDOM(`<div id="r">a<br>b</div>`)
    const segs = domToSegments(dom.window.document.getElementById('r')!)
    // Coalesce merges the three adjacent plain-text pieces.
    expect(segs).toEqual([{ text: 'a b' }])
  })
  it('dom round-trip: unknown elements contribute text only (coalesced)', () => {
    const dom = new JSDOM(`<div id="r">before <em>italic</em> after</div>`)
    const segs = domToSegments(dom.window.document.getElementById('r')!)
    // <em> is unknown, so its text merges into the surrounding plain runs.
    expect(segs).toEqual([{ text: 'before italic after' }])
  })
  it('dom round-trip: <em> around bold preserves bold and merges plain text', () => {
    const dom = new JSDOM(`<div id="r">before <em><strong>bold</strong></em> after</div>`)
    const segs = domToSegments(dom.window.document.getElementById('r')!)
    expect(segs).toEqual([
      { text: 'before ' },
      { text: 'bold', bold: true },
      { text: ' after' },
    ])
  })
})

// ── coalesceSegments ──

describe('coalesceSegments', () => {
  it('merges adjacent identical-format segments', () => {
    expect(coalesceSegments([{ text: 'a' }, { text: 'b' }])).toEqual([{ text: 'ab' }])
    expect(coalesceSegments([{ text: 'a', bold: true }, { text: 'b', bold: true }])).toEqual([{ text: 'ab', bold: true }])
  })
  it('does not merge across formatting boundaries', () => {
    expect(coalesceSegments([{ text: 'a' }, { text: 'b', bold: true }])).toEqual([{ text: 'a' }, { text: 'b', bold: true }])
    expect(coalesceSegments([{ text: 'a', href: '/x' }, { text: 'b', href: '/y' }])).toEqual([{ text: 'a', href: '/x' }, { text: 'b', href: '/y' }])
  })
  it('drops empty-text segments', () => {
    expect(coalesceSegments([{ text: '' }, { text: 'x' }, { text: '' }])).toEqual([{ text: 'x' }])
  })
  it('does not mutate its input', () => {
    const input = [{ text: 'a' }, { text: 'b' }]
    const before = JSON.stringify(input)
    coalesceSegments(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})

// ── readParagraphSegments + backward compat ──

describe('readParagraphSegments', () => {
  it('reads a legacy { type: "paragraph", text: "…" } block', () => {
    expect(readParagraphSegments({ type: 'paragraph', text: 'Hello' })).toEqual([{ text: 'Hello' }])
  })
  it('reads a modern { type: "paragraph", content: [...] } block', () => {
    expect(readParagraphSegments({ type: 'paragraph', content: [{ text: 'A' }, { text: 'B', bold: true }] } as any))
      .toEqual([{ text: 'A' }, { text: 'B', bold: true }])
  })
  it('prefers content over text when both are present', () => {
    expect(readParagraphSegments({ type: 'paragraph', text: 'IGNORED', content: [{ text: 'USED' }] } as any))
      .toEqual([{ text: 'USED' }])
  })
  it('returns empty array for null / undefined / empty text', () => {
    expect(readParagraphSegments(null as any)).toEqual([])
    expect(readParagraphSegments(undefined as any)).toEqual([])
    expect(readParagraphSegments({ type: 'paragraph', text: '' })).toEqual([])
  })
  it('filters out empty-text segments in content', () => {
    expect(readParagraphSegments({ type: 'paragraph', content: [{ text: '' }, { text: 'x' }] } as any))
      .toEqual([{ text: 'x' }])
  })
})

describe('plainTextToSegments', () => {
  it('wraps plain text in a single segment', () => {
    expect(plainTextToSegments('Hello')).toEqual([{ text: 'Hello' }])
  })
  it('empty or non-string returns []', () => {
    expect(plainTextToSegments('')).toEqual([])
    expect(plainTextToSegments(null as any)).toEqual([])
  })
})
