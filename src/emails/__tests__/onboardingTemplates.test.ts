// Block 3B — onboarding template rendering invariants.

import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { renderTemplate, TEMPLATE_KEYS } from '../render'
import { EMAIL_CATEGORIES } from '@/lib/email/categories'

describe('onboarding templates are approved', () => {
  it('all three keys are in the allow-list', () => {
    expect(TEMPLATE_KEYS).toContain('onboarding_welcome')
    expect(TEMPLATE_KEYS).toContain('onboarding_activation')
    expect(TEMPLATE_KEYS).toContain('onboarding_discovery')
  })
})

describe('onboarding_welcome', () => {
  it('renders subject, html and text', async () => {
    const r = await renderTemplate({ key: 'onboarding_welcome' })
    expect(r.subject).toBe('Welcome to PokePrices')
    expect(r.category).toBe(EMAIL_CATEGORIES.ONBOARDING)
    expect(r.text).toMatch(/Welcome to PokePrices/)
    expect(r.text).toMatch(/dashboard/i)
    // No paid plan / urgency words.
    expect(r.text).not.toMatch(/upgrade|pro plan|premium|expires|limited time|act now/i)
    expect(r.html).toMatch(/PokePrices/)
  })

  it('testPrefix prepends [TEST] to subject', async () => {
    const r = await renderTemplate({ key: 'onboarding_welcome', testPrefix: true })
    expect(r.subject).toMatch(/^\[TEST\] /)
  })
})

describe('onboarding_activation', () => {
  it('renders each branch with the documented headline', async () => {
    const a = await renderTemplate({ key: 'onboarding_activation', activationBranch: 'A' })
    const b = await renderTemplate({ key: 'onboarding_activation', activationBranch: 'B' })
    const c = await renderTemplate({ key: 'onboarding_activation', activationBranch: 'C' })
    const d = await renderTemplate({ key: 'onboarding_activation', activationBranch: 'D' })
    expect(a.text).toMatch(/Start with one card/)
    expect(b.text).toMatch(/add the ones you own/)
    expect(c.text).toMatch(/cards you are eyeing/i)
    expect(d.text).toMatch(/next layer/i)
    // Each branch carries category=onboarding.
    for (const r of [a, b, c, d]) {
      expect(r.category).toBe(EMAIL_CATEGORIES.ONBOARDING)
    }
  })

  it('defaults to branch A when no branch is supplied', async () => {
    const r = await renderTemplate({ key: 'onboarding_activation' })
    expect(r.text).toMatch(/Start with one card/)
  })

  it('never carries card-specific content (no card name, price or note placeholders)', async () => {
    for (const b of ['A', 'B', 'C', 'D'] as const) {
      const r = await renderTemplate({ key: 'onboarding_activation', activationBranch: b })
      // The template strings only ever mention "card" generically.
      // We catch a regression that would insert a {{cardName}}-style
      // placeholder by looking for unresolved Mustache or React-style
      // interpolation in the rendered text.
      expect(r.text).not.toMatch(/\{\{[^}]+\}\}/)
      expect(r.text).not.toMatch(/\$\{[^}]+\}/)
    }
  })
})

describe('onboarding_discovery', () => {
  it('renders subject + body + reply-to invitation', async () => {
    const r = await renderTemplate({ key: 'onboarding_discovery' })
    expect(r.subject).toMatch(/features you may have missed/i)
    expect(r.text).toMatch(/AI assistant/)
    expect(r.text).toMatch(/Grading comparison|grading comparison/)
    expect(r.text).toMatch(/roadmap/i)
    expect(r.text).toMatch(/Reply to this email/)
    expect(r.category).toBe(EMAIL_CATEGORIES.ONBOARDING)
  })
})

describe('no eBay affiliate links in any onboarding template', () => {
  it('text + html contain no ebay.* references', async () => {
    for (const key of ['onboarding_welcome', 'onboarding_activation', 'onboarding_discovery'] as const) {
      const r = await renderTemplate({ key, activationBranch: 'A' })
      expect(r.html).not.toMatch(/ebay\./i)
      expect(r.text).not.toMatch(/ebay\./i)
    }
  })
})

describe('absolute production URLs', () => {
  it('every link in the welcome plain-text fallback is absolute HTTPS to www.pokeprices.io', async () => {
    const r = await renderTemplate({ key: 'onboarding_welcome' })
    const urls = r.text.match(/https?:\/\/\S+/g) ?? []
    expect(urls.length).toBeGreaterThan(0)
    for (const u of urls) {
      expect(u.startsWith('https://www.pokeprices.io')).toBe(true)
    }
  })
})
