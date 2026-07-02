// Block 5A-W-41A — pin the account-rail label sets for both auth
// states. The component uses the module-level supabase browser
// client; stub it so the file resolves in vitest's node env.

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: {
    getSession:        async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  } },
  CHAT_ENDPOINT: 'https://stub.example.com/functions/v1/chat',
}))

import {
  LOGGED_IN_LINKS,
  LOGGED_OUT_LINKS,
} from '../HomeAccountRail'

const SRC = readFileSync(join(__dirname, '..', 'HomeAccountRail.tsx'), 'utf8')

describe('HomeAccountRail — exported link sets', () => {
  it('logged-out CTA set: Sign up free (accent) + Log in (text)', () => {
    expect(LOGGED_OUT_LINKS.map(l => l.label)).toEqual(['Sign up free', 'Log in'])
    expect(LOGGED_OUT_LINKS.find(l => l.label === 'Sign up free')?.href).toBe('/dashboard/login?mode=signup')
    expect(LOGGED_OUT_LINKS.find(l => l.label === 'Log in')?.href).toBe('/dashboard/login')
    expect(LOGGED_OUT_LINKS.find(l => l.label === 'Sign up free')?.variant).toBe('accent')
  })

  it('logged-in link set: Dashboard (accent) + Watchlist + Portfolio', () => {
    expect(LOGGED_IN_LINKS.map(l => l.label)).toEqual([
      'My Dashboard',
      'My Watchlist',
      'My Portfolio',
    ])
    expect(LOGGED_IN_LINKS.find(l => l.label === 'My Dashboard')?.href).toBe('/dashboard')
    expect(LOGGED_IN_LINKS.find(l => l.label === 'My Watchlist')?.href).toBe('/dashboard/watchlist-alerts')
    expect(LOGGED_IN_LINKS.find(l => l.label === 'My Portfolio')?.href).toBe('/dashboard/portfolio')
    expect(LOGGED_IN_LINKS.find(l => l.label === 'My Dashboard')?.variant).toBe('accent')
  })
})

describe('HomeAccountRail — no emoji labels + no SaaS hype copy', () => {
  it('exported labels contain no banned glyphs', () => {
    for (const l of [...LOGGED_OUT_LINKS, ...LOGGED_IN_LINKS]) {
      for (const glyph of ['🃏', '⚡', '📦', '📈', '🚀', '📊', '👁', '💼', '✨', '🛒', '🎯', '🎨', '📍']) {
        expect(l.label).not.toContain(glyph)
      }
    }
  })

  it('the source file avoids the emoji glyph set on any label', () => {
    for (const glyph of ['🃏', '⚡', '📦', '📈', '🚀', '📊', '👁', '💼', '✨', '🛒', '🎯', '🎨', '📍', '📬']) {
      expect(SRC).not.toContain(glyph)
    }
  })

  it('the source file avoids banned SaaS-hype copy', () => {
    for (const banned of ['Unlock', 'Supercharge', 'AI-powered', 'Discover your next opportunity']) {
      expect(SRC).not.toContain(banned)
    }
  })
})
