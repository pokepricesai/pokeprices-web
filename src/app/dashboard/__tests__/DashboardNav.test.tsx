// Block 5A-W-42B — invariants for the shared DashboardNav.
//
// DashboardNav is rendered by every visible /dashboard sub-page
// (portfolio, watchlist-alerts, settings, card-shows, grading,
// quick-price, sets) AND by the hub itself. The Back-to-Dashboard
// link surfaces on the sub-pages and hides on the hub so users
// aren't shown a link to the page they're already on.
//
// The component uses supabase.auth + useRouter + usePathname on
// mount, which is heavy for our vitest 'node' environment. Pin the
// structural invariants by reading the source directly.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, '..', 'DashboardNav.tsx'), 'utf8')

describe('DashboardNav — W42B Back to Dashboard link', () => {
  it('renders a "Back to Dashboard" link with href="/dashboard"', () => {
    // Label + href are pinned literally so a well-meaning refactor
    // can't quietly change either. The label choice matches every
    // other dashboard-adjacent CTA on the site.
    expect(SRC).toContain('Back to Dashboard')
    expect(SRC).toMatch(/<Link href="\/dashboard"[\s\S]*?aria-label="Back to Dashboard"/)
    // Standard secondary-button treatment — bordered pill on transparent
    // background, muted text, uppercase + letter-spacing.
    expect(SRC).toContain("border: '1px solid var(--border)'")
  })

  it('is gated on usePathname !== "/dashboard" so it hides on the hub itself', () => {
    expect(SRC).toContain("import { useRouter, usePathname } from 'next/navigation'")
    expect(SRC).toContain('const pathname = usePathname()')
    expect(SRC).toContain("const showBackLink = pathname !== '/dashboard'")
    // The Link is behind the gate — no unconditional back link.
    expect(SRC).toMatch(/showBackLink \? \(/)
  })

  it('carries the arrow glyph "←" for direction only (not an emoji)', () => {
    // Plain ← (LEFTWARDS ARROW, U+2190) is text, not an emoji. The
    // literal "Back to Dashboard" copy must be adjacent so the visual
    // reads "← Back to Dashboard".
    expect(SRC).toContain('←')
    expect(SRC).toMatch(/<span aria-hidden="true">←<\/span>\s*\n\s*Back to Dashboard/)
  })

  it('does not use emoji-led labels on the Back link', () => {
    // The rest of DashboardNav still carries per-tool emoji glyphs
    // (💼 👁 🧩 🎯 ⚡ 📍 ⚙️) which are out of scope for this block.
    // Guard specifically against emoji glyphs sneaking into the Back
    // link — the substring assertion below fails if any of these
    // appear inside the aria-labelled Back link block.
    const backBlock = SRC.split('aria-label="Back to Dashboard"')[1]?.split('</Link>')[0] ?? ''
    for (const glyph of ['🃏', '⚡', '📦', '📈', '🚀', '📊', '👁', '💼', '✨', '🎯', '🎨', '📍', '📬', '🔒', '🛒', '⚙️', '🧩']) {
      expect(backBlock).not.toContain(glyph)
    }
  })
})
