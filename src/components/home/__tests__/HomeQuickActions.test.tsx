// Block 5A-W-40B — pin the label + href set for the auth-aware
// homepage quick-actions grid.
//
// The rendered path uses the module-level supabase client + a session
// subscription, so DOM-mount testing is heavy for our vitest 'node'
// environment. Import the exported arrays directly and read the file
// source for the emoji / structural invariants.

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// HomeQuickActions transitively pulls in the module-level supabase
// browser client, which throws at import when env vars are missing.
// Stub the surface the module touches so vitest can resolve the file.
vi.mock('@/lib/supabase', () => ({
  supabase:      { auth: {
    getSession:          async () => ({ data: { session: null } }),
    onAuthStateChange:   () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  } },
  CHAT_ENDPOINT: 'https://stub.example.com/functions/v1/chat',
}))

import {
  LOGGED_IN_ACTIONS,
  LOGGED_OUT_ACTIONS,
} from '../HomeQuickActions'

const SRC = readFileSync(join(__dirname, '..', 'HomeQuickActions.tsx'), 'utf8')

describe('HomeQuickActions — labels and hrefs', () => {
  it('logged-out actions carry the W40B set', () => {
    expect(LOGGED_OUT_ACTIONS.map(a => a.label)).toEqual([
      'Browse Cards & Sets',
      'Browse Pokémon',
      'Market Movers',
      'View Insights',
      'Ask the AI Assistant',
      'Sign up free',
    ])
    expect(LOGGED_OUT_ACTIONS.find(a => a.label === 'Browse Cards & Sets')?.href).toBe('/browse')
    expect(LOGGED_OUT_ACTIONS.find(a => a.label === 'Browse Pokémon')?.href).toBe('/pokemon')
    expect(LOGGED_OUT_ACTIONS.find(a => a.label === 'Market Movers')?.href).toBe('#market-movers')
    expect(LOGGED_OUT_ACTIONS.find(a => a.label === 'View Insights')?.href).toBe('/insights')
    expect(LOGGED_OUT_ACTIONS.find(a => a.label === 'Ask the AI Assistant')?.href).toBe('/ai-assistant')
    expect(LOGGED_OUT_ACTIONS.find(a => a.label === 'Sign up free')?.href).toBe('/dashboard/login?mode=signup')
  })

  it('logged-in actions carry the W40B set', () => {
    expect(LOGGED_IN_ACTIONS.map(a => a.label)).toEqual([
      'Browse Cards & Sets',
      'Browse Pokémon',
      'Market Movers',
      'My Dashboard',
      'My Watchlist',
      'My Portfolio',
    ])
    expect(LOGGED_IN_ACTIONS.find(a => a.label === 'Browse Cards & Sets')?.href).toBe('/browse')
    expect(LOGGED_IN_ACTIONS.find(a => a.label === 'Browse Pokémon')?.href).toBe('/pokemon')
    expect(LOGGED_IN_ACTIONS.find(a => a.label === 'Market Movers')?.href).toBe('#market-movers')
    expect(LOGGED_IN_ACTIONS.find(a => a.label === 'My Dashboard')?.href).toBe('/dashboard')
    expect(LOGGED_IN_ACTIONS.find(a => a.label === 'My Watchlist')?.href).toBe('/dashboard/watchlist-alerts')
    expect(LOGGED_IN_ACTIONS.find(a => a.label === 'My Portfolio')?.href).toBe('/dashboard/portfolio')
  })

  it('has exactly 6 items per auth state (no layout shift on session flip)', () => {
    expect(LOGGED_OUT_ACTIONS.length).toBe(6)
    expect(LOGGED_IN_ACTIONS.length).toBe(6)
  })

  it('every action carries a non-empty label and href', () => {
    for (const a of [...LOGGED_OUT_ACTIONS, ...LOGGED_IN_ACTIONS]) {
      expect(a.label.length).toBeGreaterThan(0)
      expect(a.href.length).toBeGreaterThan(0)
    }
  })

  it('marks Sign up free (logged-out) and My Dashboard (logged-in) as the accent variant', () => {
    expect(LOGGED_OUT_ACTIONS.find(a => a.label === 'Sign up free')?.variant).toBe('accent')
    expect(LOGGED_IN_ACTIONS.find(a => a.label === 'My Dashboard')?.variant).toBe('accent')
  })
})

describe('HomeQuickActions — no emoji-led labels', () => {
  it('the exported label arrays contain no emoji glyphs from the W40 preview', () => {
    const banned = ['🃏', '⚡', '📦', '📈', '🚀', '📊', '👁', '💼', '✨', '🛒', '🎯', '🎨', '📍', '📬', '🔒']
    for (const a of [...LOGGED_OUT_ACTIONS, ...LOGGED_IN_ACTIONS]) {
      for (const glyph of banned) {
        expect(a.label).not.toContain(glyph)
      }
    }
  })

  it('the source file body carries no banned emoji glyphs on labels', () => {
    // Scope: entire component. Cheaper than reflecting the JSX tree.
    const banned = ['🃏', '⚡', '📦', '📈', '🚀', '📊', '👁', '💼', '✨', '🛒', '🎯', '🎨', '📍', '📬']
    for (const glyph of banned) {
      expect(SRC).not.toContain(glyph)
    }
  })
})
