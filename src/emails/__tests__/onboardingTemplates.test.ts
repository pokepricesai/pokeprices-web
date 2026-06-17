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
    expect(r.text).toMatch(/Welcome to PokePrices/i)
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
    expect(b.text).toMatch(/Add the cards you own/i)
    expect(c.text).toMatch(/Watchlist what you are weighing up|cards you are considering/i)
    expect(d.text).toMatch(/next layer|deeper tools/i)
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
    expect(r.text).toMatch(/reply to this email/i)
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

// ─────────────────────────────────────────────────────────────────────
// Block 3C — design-system polish invariants
// ─────────────────────────────────────────────────────────────────────

describe('Block 3C — onboarding templates carry preheaders', () => {
  it('welcome preheader is present and non-empty', async () => {
    const r = await renderTemplate({ key: 'onboarding_welcome' })
    expect(r.preheader).toBeTruthy()
    expect((r.preheader ?? '').length).toBeGreaterThan(8)
  })

  it('each activation branch carries a distinct preheader', async () => {
    const seen = new Set<string>()
    for (const b of ['A', 'B', 'C', 'D'] as const) {
      const r = await renderTemplate({ key: 'onboarding_activation', activationBranch: b })
      expect(r.preheader).toBeTruthy()
      expect(seen.has(r.preheader!)).toBe(false)
      seen.add(r.preheader!)
    }
  })

  it('discovery preheader is present', async () => {
    const r = await renderTemplate({ key: 'onboarding_discovery' })
    expect(r.preheader).toBeTruthy()
  })
})

describe('Block 3C — branding + logo invariants', () => {
  it('every onboarding template references the email-optimised logo with width + height + alt', async () => {
    for (const key of ['onboarding_welcome', 'onboarding_activation', 'onboarding_discovery'] as const) {
      const r = await renderTemplate({ key, activationBranch: 'A' })
      // Absolute HTTPS URL on the canonical origin, using the
      // email-optimised PNG (not the heavy site logo).
      expect(r.html).toMatch(/https:\/\/www\.pokeprices\.io\/email-logo\.png/)
      // The heavy site logo MUST NOT be linked in email any more.
      expect(r.html).not.toMatch(/https:\/\/www\.pokeprices\.io\/logo\.png/)
      // Image carries width, height and alt attributes.
      expect(r.html).toMatch(/<img\b[^>]*\balt="PokePrices"/i)
      expect(r.html).toMatch(/<img\b[^>]*\bwidth="160"/i)
      expect(r.html).toMatch(/<img\b[^>]*\bheight="61"/i)
    }
  })

  it('wordmark fallback text is present alongside the image', async () => {
    const r = await renderTemplate({ key: 'onboarding_welcome' })
    // The plain "PokePrices" wordmark string is the image-disabled fallback.
    const occurrences = (r.html.match(/PokePrices/g) ?? []).length
    expect(occurrences).toBeGreaterThanOrEqual(3) // alt + wordmark + footer at minimum
  })

  it('no SVG images anywhere — only PNG allowed', async () => {
    for (const key of ['onboarding_welcome', 'onboarding_activation', 'onboarding_discovery'] as const) {
      const r = await renderTemplate({ key, activationBranch: 'A' })
      expect(r.html).not.toMatch(/\.svg["']/i)
      expect(r.html).not.toMatch(/<svg\b/i)
    }
  })

  it('no base64 image data ever embedded', async () => {
    for (const key of ['onboarding_welcome', 'onboarding_activation', 'onboarding_discovery'] as const) {
      const r = await renderTemplate({ key, activationBranch: 'A' })
      expect(r.html).not.toMatch(/data:image\/[a-z]+;base64/i)
    }
  })
})

describe('Block 3C — primary CTA + secondary action', () => {
  it('welcome carries a primary CTA pointing at the dashboard AND a secondary CTA pointing at /browse', async () => {
    const r = await renderTemplate({ key: 'onboarding_welcome' })
    expect(r.html).toMatch(/https:\/\/www\.pokeprices\.io\/dashboard"/)
    expect(r.html).toMatch(/https:\/\/www\.pokeprices\.io\/browse"/)
    // Plain text fallback also carries both URLs.
    expect(r.text).toMatch(/https:\/\/www\.pokeprices\.io\/dashboard/)
    expect(r.text).toMatch(/https:\/\/www\.pokeprices\.io\/browse/)
  })

  it('every activation branch carries a primary CTA URL in HTML + text', async () => {
    for (const b of ['A', 'B', 'C', 'D'] as const) {
      const r = await renderTemplate({ key: 'onboarding_activation', activationBranch: b })
      expect(r.html).toMatch(/https:\/\/www\.pokeprices\.io\//)
      expect(r.text).toMatch(/https:\/\/www\.pokeprices\.io\//)
    }
  })

  it('discovery carries a primary CTA URL', async () => {
    const r = await renderTemplate({ key: 'onboarding_discovery' })
    expect(r.html).toMatch(/https:\/\/www\.pokeprices\.io\/dashboard"/)
    expect(r.text).toMatch(/https:\/\/www\.pokeprices\.io\/dashboard/)
  })
})

describe('Block 3C — activation branch badges', () => {
  it('each branch carries its distinct badge label', async () => {
    const expected: Record<'A'|'B'|'C'|'D', RegExp> = {
      A: /Start your collection/i,
      B: /Build your portfolio/i,
      C: /Track your next purchase/i,
      D: /Explore more tools/i,
    }
    for (const b of ['A','B','C','D'] as const) {
      const r = await renderTemplate({ key: 'onboarding_activation', activationBranch: b })
      expect(r.html).toMatch(expected[b])
      expect(r.text).toMatch(expected[b])
    }
  })
})

describe('Block 3C — preferences + reply-to footer slots', () => {
  it('every onboarding HTML carries the email preferences link', async () => {
    for (const key of ['onboarding_welcome', 'onboarding_activation', 'onboarding_discovery'] as const) {
      const r = await renderTemplate({ key, activationBranch: 'A' })
      expect(r.html).toMatch(/Email preferences/i)
      expect(r.html).toMatch(/https:\/\/www\.pokeprices\.io\/dashboard\/settings/)
    }
  })

  it('every onboarding template carries the reply-to mailto link in HTML', async () => {
    for (const key of ['onboarding_welcome', 'onboarding_activation', 'onboarding_discovery'] as const) {
      const r = await renderTemplate({ key, activationBranch: 'A' })
      expect(r.html).toMatch(/mailto:hello@pokeprices\.io/)
    }
  })
})

describe('Block 3C — banned copy + email-client safety', () => {
  for (const key of ['onboarding_welcome', 'onboarding_activation', 'onboarding_discovery'] as const) {
    it(`${key} carries no investment-guarantee or paid-plan or urgency language`, async () => {
      const r = await renderTemplate({ key, activationBranch: 'A' })
      const combined = (r.html + ' ' + r.text).toLowerCase()
      const banned = [
        'guaranteed', 'guarantee returns', 'investment opportunity',
        'pro plan', 'premium plan', 'upgrade now', 'subscribe now',
        'limited time', 'act now', 'expires today', 'last chance',
        '24 hours only',
      ]
      for (const b of banned) expect(combined).not.toContain(b)
    })

    it(`${key} contains no <script>, no flex/grid CSS, no JS`, async () => {
      const r = await renderTemplate({ key, activationBranch: 'A' })
      expect(r.html).not.toMatch(/<script\b/i)
      expect(r.html).not.toMatch(/javascript:/i)
      expect(r.html).not.toMatch(/onclick=/i)
      expect(r.html).not.toMatch(/display\s*:\s*(flex|grid)/i)
    })

    it(`${key} carries the color-scheme + supported-color-schemes meta`, async () => {
      const r = await renderTemplate({ key, activationBranch: 'A' })
      expect(r.html).toMatch(/name="color-scheme"/i)
      expect(r.html).toMatch(/name="supported-color-schemes"/i)
    })

    it(`${key} rendered HTML stays under 100KB`, async () => {
      const r = await renderTemplate({ key, activationBranch: 'A' })
      const sizeKb = Buffer.byteLength(r.html, 'utf8') / 1024
      expect(sizeKb).toBeLessThan(100)
    })

    it(`${key} contains no unresolved {{template}} or \${js} placeholders`, async () => {
      const r = await renderTemplate({ key, activationBranch: 'A' })
      expect(r.html).not.toMatch(/\{\{[^}]+\}\}/)
      expect(r.html).not.toMatch(/\$\{[^}]+\}/)
      expect(r.text).not.toMatch(/\{\{[^}]+\}\}/)
      expect(r.text).not.toMatch(/\$\{[^}]+\}/)
    })
  }
})

describe('Block 3C — testPrefix retains [TEST] for every key', () => {
  it('all six approved keys honour the [TEST] prefix', async () => {
    for (const key of TEMPLATE_KEYS) {
      const r = await renderTemplate({ key, activationBranch: 'A', testPrefix: true })
      expect(r.subject.startsWith('[TEST] ')).toBe(true)
    }
  })
})

describe('Block 3C — describeTemplate', () => {
  it('returns subject + preheader without rendering the template', async () => {
    const { describeTemplate } = await import('../render')
    const d1 = describeTemplate({ key: 'onboarding_welcome' })
    expect(d1.subject).toBe('Welcome to PokePrices')
    expect(d1.preheader.length).toBeGreaterThan(0)
    const d2 = describeTemplate({ key: 'onboarding_activation', activationBranch: 'D' })
    expect(d2.subject).toMatch(/deeper tools/i)
    const d3 = describeTemplate({ key: 'onboarding_welcome', testPrefix: true })
    expect(d3.subject.startsWith('[TEST] ')).toBe(true)
  })
})

