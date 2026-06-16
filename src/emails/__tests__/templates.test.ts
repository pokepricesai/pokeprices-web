// Verifies the three approved templates render to HTML that contains
// expected markers AND that their plain-text fallbacks line up. We do
// not assert exact HTML — that would be too brittle — but we do
// guarantee category, subject and content invariants the send service
// depends on.

import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { renderTemplate, isApprovedTemplateKey, TEMPLATE_KEYS } from '../render'
import { EMAIL_CATEGORIES } from '@/lib/email/categories'

describe('isApprovedTemplateKey', () => {
  it('accepts only allow-listed keys', () => {
    for (const k of TEMPLATE_KEYS) expect(isApprovedTemplateKey(k)).toBe(true)
    expect(isApprovedTemplateKey('made_up')).toBe(false)
    expect(isApprovedTemplateKey('')).toBe(false)
    expect(isApprovedTemplateKey(null)).toBe(false)
  })
})

describe('renderTemplate — delivery_test', () => {
  it('returns transactional category + the expected subject + text containing Resend API', async () => {
    const r = await renderTemplate({ key: 'delivery_test', timestamp: '2026-06-15T10:00:00Z', vercelEnv: 'production' })
    expect(r.subject).toBe('PokePrices Vercel email test')
    expect(r.category).toBe(EMAIL_CATEGORIES.TRANSACTIONAL)
    expect(r.html).toContain('PokePrices')
    expect(r.html).toContain('Resend API')
    expect(r.html).toContain('2026-06-15T10:00:00Z')
    expect(r.html).toContain('production')
    expect(r.text).toContain('Resend API')
    expect(r.text).toContain('2026-06-15T10:00:00Z')
  })
})

describe('renderTemplate — transactional_test', () => {
  it('uses service_product category and addresses the recipient', async () => {
    const r = await renderTemplate({ key: 'transactional_test', displayName: 'Luke' })
    expect(r.category).toBe(EMAIL_CATEGORIES.SERVICE_PRODUCT)
    // React Email may insert HTML comments between text siblings; the
    // plain-text fallback is the stable check.
    expect(r.text).toContain('Hi Luke')
    expect(r.html).toMatch(/Luke/)
    // Transactional layout MUST NOT carry an unsubscribe URL.
    expect(r.html).not.toContain('Email preferences')
  })

  it('falls back to "there" when no display name is given', async () => {
    const r = await renderTemplate({ key: 'transactional_test' })
    expect(r.text).toContain('Hi there')
    expect(r.html).toMatch(/there/)
  })
})

describe('renderTemplate — marketing_preview', () => {
  it('uses marketing_newsletter category and renders the preferences link slot', async () => {
    const r = await renderTemplate({
      key: 'marketing_preview',
      preferencesUrl: 'https://www.pokeprices.io/dashboard/settings',
    })
    expect(r.category).toBe(EMAIL_CATEGORIES.MARKETING_NEWSLETTER)
    expect(r.html).toContain('Email preferences')
    expect(r.html).toContain('https://www.pokeprices.io/dashboard/settings')
    expect(r.text).toContain('https://www.pokeprices.io/tools')
  })
})

describe('renderTemplate — html / text invariants', () => {
  it('every template produces non-empty html AND text', async () => {
    for (const key of TEMPLATE_KEYS) {
      const r = await renderTemplate({ key })
      expect(r.html.length).toBeGreaterThan(40)
      expect(r.text.length).toBeGreaterThan(10)
    }
  })
})
