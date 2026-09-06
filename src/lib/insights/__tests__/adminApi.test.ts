// src/lib/insights/__tests__/adminApi.test.ts
//
// EIC Block 1 — unit tests for the shared admin API helpers.

import { describe, it, expect, vi } from 'vitest'

// The module under test starts with `import 'server-only'` which
// throws when imported outside a Server Component context. Match the
// existing pattern used by src/app/api/admin/alerts/evaluate/__tests__.
vi.mock('server-only', () => ({}))

import {
  pickWritableArticleFields,
  validateArticleWrite,
  mirrorSeoFields,
  extForContentType,
  buildInsightsUploadPath,
  isUploadPurpose,
} from '../adminApi'

describe('pickWritableArticleFields', () => {
  it('keeps writable columns and drops unknown ones', () => {
    const out = pickWritableArticleFields({
      headline: 'x',
      slug:     'a',
      status:   'draft',
      id:       'should-drop',      // server-controlled
      created_at: 'should-drop',    // server-controlled
      card_refs: ['should-drop'],   // present in DB, not part of admin remit today
    } as any)
    expect(out).toEqual({ headline: 'x', slug: 'a', status: 'draft' })
  })

  it('drops the four phantom columns that never existed on the live table', () => {
    const out = pickWritableArticleFields({
      title:      'phantom',
      excerpt:    'phantom',
      body_text:  'phantom',
      updated_at: 'phantom',
      headline:   'real',
    } as any)
    expect(out).toEqual({ headline: 'real' })
  })

  it('keeps the SEO pair', () => {
    const out = pickWritableArticleFields({
      seo_title: 'a', seo_description: 'b',
      meta_title: 'c', meta_description: 'd',
    } as any)
    expect(out).toEqual({
      seo_title: 'a', seo_description: 'b',
      meta_title: 'c', meta_description: 'd',
    })
  })
})

describe('mirrorSeoFields', () => {
  it('copies meta_* into seo_* when only meta_* is present', () => {
    const out = mirrorSeoFields({ meta_title: 'T', meta_description: 'D' } as any)
    expect(out).toEqual({
      meta_title: 'T', meta_description: 'D',
      seo_title:  'T', seo_description:  'D',
    })
  })

  it('copies seo_* into meta_* when only seo_* is present', () => {
    const out = mirrorSeoFields({ seo_title: 'T', seo_description: 'D' } as any)
    expect(out).toEqual({
      seo_title:  'T', seo_description:  'D',
      meta_title: 'T', meta_description: 'D',
    })
  })

  it('does not overwrite when both sides are explicitly supplied', () => {
    const out = mirrorSeoFields({
      seo_title: 'S', meta_title: 'M',
      seo_description: 'SD', meta_description: 'MD',
    } as any)
    expect(out).toEqual({
      seo_title: 'S', meta_title: 'M',
      seo_description: 'SD', meta_description: 'MD',
    })
  })

  it('leaves unrelated fields untouched', () => {
    const out = mirrorSeoFields({ headline: 'h', body_json: { blocks: [] } } as any)
    expect(out).toEqual({ headline: 'h', body_json: { blocks: [] } })
  })
})

describe('validateArticleWrite', () => {
  it('accepts a minimal draft', () => {
    expect(validateArticleWrite({ headline: 'ok', status: 'draft' })).toBeNull()
  })
  it('rejects unknown status', () => {
    expect(validateArticleWrite({ status: 'weird' } as any)).toMatch(/status must be/)
  })
  it('rejects bad slug', () => {
    expect(validateArticleWrite({ slug: 'Not A Slug' } as any)).toMatch(/slug/)
    expect(validateArticleWrite({ slug: '-leading-dash' } as any)).toMatch(/slug/)
  })
  it('rejects oversize body_json (>512KB)', () => {
    const huge = { blocks: [{ type: 'paragraph', text: 'x'.repeat(600 * 1024) }] }
    expect(validateArticleWrite({ body_json: huge } as any)).toMatch(/too large/)
  })
})

describe('extForContentType + isUploadPurpose + buildInsightsUploadPath', () => {
  it('maps allow-listed MIME types to safe extensions', () => {
    expect(extForContentType('image/jpeg')).toBe('jpg')
    expect(extForContentType('image/png')).toBe('png')
    expect(extForContentType('image/webp')).toBe('webp')
  })
  it('rejects other MIME types', () => {
    expect(extForContentType('image/svg+xml')).toBeNull()
    expect(extForContentType('application/octet-stream')).toBeNull()
  })
  it('accepts hero and body purposes only', () => {
    expect(isUploadPurpose('hero')).toBe(true)
    expect(isUploadPurpose('body')).toBe(true)
    expect(isUploadPurpose('other')).toBe(false)
    expect(isUploadPurpose(undefined)).toBe(false)
  })
  it('builds a server-scoped path under insights/<purpose>/', () => {
    const p = buildInsightsUploadPath('hero', 'png')
    expect(p.startsWith('insights/hero/')).toBe(true)
    expect(p.endsWith('.png')).toBe(true)
    // No path traversal / bucket escape possible in the generated path.
    expect(p).not.toMatch(/\.\./)
    expect(p).not.toMatch(/^\//)
  })
})
