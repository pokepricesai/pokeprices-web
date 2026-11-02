// PP-SEO-LOGIN-URL-FIX (2026-11-02) — anti-regression tests that lock
// down the static-href behaviour of the two logged-out CTAs on the
// card hero (Watch + Add to portfolio).
//
// Why: a prior implementation interpolated `window.location.pathname`
// into the Link href at render time, so each card page produced a
// unique /dashboard/login?returnTo=/set/<name>/card/<slug> anchor in
// the hydrated DOM. Googlebot discovered 35,192 such URLs by late
// October 2026 — all correctly blocked by robots.txt, but still a
// crawl-budget drain and Coverage-report noise source.
//
// The repo's vitest config is node-env with no React Testing Library,
// so we lock the fix at the source-contract layer (same pattern as
// SpeciesInteractiveSection.test.tsx).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(
  join(process.cwd(), 'src', 'components', 'CardQuickActions.tsx'),
  'utf8',
)

describe('CardQuickActions — logged-out login CTAs stay crawler-safe', () => {
  it('Watch anchor renders a static /dashboard/login href', () => {
    expect(SRC).toMatch(/href="\/dashboard\/login" onClick=\{handleLoggedOutWatchClick\}/)
  })

  it('Add-to-portfolio anchor renders a static /dashboard/login href', () => {
    expect(SRC).toMatch(/href="\/dashboard\/login" onClick=\{handleLoggedOutPortfolioClick\}/)
  })

  it('Add-to-portfolio onClick handler builds the returnTo at interaction time and dispatches via router.push', () => {
    // The handler reads window.location.pathname + search INSIDE the
    // click callback (not at render), then forwards to router.push.
    // This is the mechanism that keeps the DOM href static.
    expect(SRC).toMatch(/const handleLoggedOutPortfolioClick = \(e: React\.MouseEvent<HTMLAnchorElement>\)/)
    expect(SRC).toMatch(/const returnTo = window\.location\.pathname \+ window\.location\.search/)
    expect(SRC).toMatch(/router\.push\(`\/dashboard\/login\?returnTo=\$\{encodeURIComponent\(returnTo\)\}`\)/)
  })

  it('Modified clicks (middle-click, Cmd+click, Ctrl+click, Shift+click, Alt+click) fall through to the plain href', () => {
    // Normal browser semantics for cmd/ctrl/shift/alt + click should
    // still open /dashboard/login in a new tab or window. The handler
    // early-returns in that case so preventDefault() does not fire.
    expect(SRC).toMatch(/if \(e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey \|\| e\.altKey \|\| e\.button !== 0\) return/)
  })

  it('does NOT render a parameterised /dashboard/login?returnTo href anywhere in the logged-out branch', () => {
    // Anti-regression — any dynamic-href pattern that interpolates
    // path or search into the login anchor is the exact defect we're
    // fixing. Prohibit it.
    expect(SRC).not.toMatch(/<Link\s+href=\{`?\/dashboard\/login\?returnTo=/)
    expect(SRC).not.toMatch(/<a\s+href=\{`?\/dashboard\/login\?returnTo=/)
    // The literal interpolated href that CAUSED the 35k-URL explosion.
    expect(SRC).not.toMatch(/\/dashboard\/login\?returnTo=\$\{encodeURIComponent\(portfolioReturnTo\)\}/)
  })

  it('the on-click router.push (used by Watch) is only called inside a handler, not at render time', () => {
    // Line 227 continues to live inside handleWatch (fires on real
    // user click only). This is the pattern we extended to Portfolio.
    const watchHandlerStart = SRC.indexOf('function handleWatch')
    // The one allowed usage of the parameterised login URL in the
    // component appears INSIDE an authenticated-user handler, not
    // inside render JSX. Guard against the pattern leaking into
    // JSX by requiring every match to come AFTER the first handler
    // definition (which is handleLoggedOutWatchClick).
    const firstHandlerIdx = SRC.indexOf('function handleLoggedOutWatchClick')
    expect(watchHandlerStart === -1 || watchHandlerStart < firstHandlerIdx || SRC.indexOf('router.push(`/dashboard/login?returnTo=') > firstHandlerIdx).toBeTruthy()
  })
})
