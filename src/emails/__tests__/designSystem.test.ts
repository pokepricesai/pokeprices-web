// src/emails/__tests__/designSystem.test.ts
// Block 3C — invariants for the shared email design system.

import { describe, it, expect } from 'vitest'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { COLORS, FONT_STACK, RADIUS, SPACING, BUTTON, ASSETS, CONTAINER_MAX_WIDTH } from '../designTokens'

const REPO_ROOT     = process.cwd()
const EMAIL_LOGO_FS = path.join(REPO_ROOT, 'public', 'email-logo.png')

describe('design tokens', () => {
  it('logo URL is an absolute HTTPS production URL on pokeprices.io', () => {
    expect(ASSETS.logoUrl.startsWith('https://www.pokeprices.io/')).toBe(true)
    expect(ASSETS.logoUrl).toMatch(/\.(png|webp)$/i)
  })

  it('logo URL targets the email-optimised asset, not the heavy site logo', () => {
    expect(ASSETS.logoUrl).toBe('https://www.pokeprices.io/email-logo.png')
    expect(ASSETS.logoUrl).not.toContain('/logo.png')
  })

  it('logo has explicit width + height + alt text', () => {
    expect(ASSETS.logoWidth).toBeGreaterThan(0)
    expect(ASSETS.logoHeight).toBeGreaterThan(0)
    expect(typeof ASSETS.logoAlt).toBe('string')
    expect(ASSETS.logoAlt.length).toBeGreaterThan(0)
  })

  // ── Asset on disk ──
  it('public/email-logo.png exists at the repo root', () => {
    expect(existsSync(EMAIL_LOGO_FS)).toBe(true)
  })

  it('public/email-logo.png is below the 100 KB email-safe ceiling', () => {
    const bytes = statSync(EMAIL_LOGO_FS).size
    expect(bytes).toBeGreaterThan(0)
    expect(bytes).toBeLessThan(100 * 1024)
  })

  it('email logo file is a PNG (no SVG, no base64-encoded fallback)', () => {
    expect(ASSETS.logoUrl.endsWith('.png')).toBe(true)
    expect(ASSETS.logoUrl).not.toMatch(/\.svg/i)
    expect(ASSETS.logoUrl).not.toMatch(/^data:/i)
  })

  it('container max-width sits in the conservative 600-640 range', () => {
    expect(CONTAINER_MAX_WIDTH).toBeGreaterThanOrEqual(600)
    expect(CONTAINER_MAX_WIDTH).toBeLessThanOrEqual(640)
  })

  it('every brand colour is a literal hex string (no CSS variables)', () => {
    for (const [k, v] of Object.entries(COLORS)) {
      // Allow comma-separated CSS like `0 1px 2px rgba(...)` for shadow values.
      if (k === 'cardShadow') continue
      const value = String(v)
      const looksHex   = /^#[0-9a-f]{3,8}$/i.test(value)
      const looksRgba  = /^rgba?\(/i.test(value)
      expect(looksHex || looksRgba).toBe(true)
    }
  })

  it('primary + secondary buttons clear the touch-friendly minimum height', () => {
    expect(BUTTON.primary.minHeight).toBeGreaterThanOrEqual(44)
    expect(BUTTON.secondary.minHeight).toBeGreaterThanOrEqual(40)
  })

  it('font stack contains no external font dependency', () => {
    expect(FONT_STACK).not.toMatch(/url\(/i)
    expect(FONT_STACK).not.toMatch(/googleapis/i)
    expect(FONT_STACK).toMatch(/-apple-system/)
    expect(FONT_STACK).toMatch(/Arial/)
  })

  it('spacing scale is monotonically non-decreasing', () => {
    const ordered = [SPACING.xs, SPACING.sm, SPACING.md, SPACING.lg, SPACING.xl, SPACING.xxl, SPACING.hero]
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]).toBeGreaterThan(ordered[i - 1])
    }
  })

  it('radius scale exposes the documented buckets', () => {
    expect(RADIUS.sm).toBeGreaterThan(0)
    expect(RADIUS.md).toBeGreaterThan(RADIUS.sm)
    expect(RADIUS.lg).toBeGreaterThan(RADIUS.md)
    expect(RADIUS.pill).toBeGreaterThan(RADIUS.lg)
  })

  it('primary button uses brand colours (white text on brand blue)', () => {
    expect(COLORS.primary).toMatch(/^#1a5fad$/i)
    expect(COLORS.textOnPrimary).toBe('#ffffff')
  })

  it('secondary button uses the brand gold accent', () => {
    expect(COLORS.accent).toMatch(/^#ffcb05$/i)
    expect(COLORS.textOnAccent).toMatch(/^#1a3a5c$/i)
  })

  it('page background is the brand-tinted soft blue, not a neutral grey', () => {
    expect(COLORS.pageBg).toMatch(/^#eaf3ff$/i)
  })
})
