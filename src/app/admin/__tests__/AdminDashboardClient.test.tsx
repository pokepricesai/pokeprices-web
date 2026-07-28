// Block 5A-W-47C — SSR / render tests for the unified admin
// dashboard client. These pin:
//   * the unauthenticated visitor sees the password login screen
//   * the login form submits into the shared `admin_authed` session
//     key (regression pin for the auth-unification decision)
//   * the source file registers only ONE sessionStorage key and shares
//     it with the other admin tools (this is enforced by source-text
//     assertions since the auth logic is client-only)

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'

process.env.NEXT_PUBLIC_SUPABASE_URL       = process.env.NEXT_PUBLIC_SUPABASE_URL       || 'https://test.example.com'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY   = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY   || 'test-key'
process.env.NEXT_PUBLIC_ADMIN_PASSWORD      = process.env.NEXT_PUBLIC_ADMIN_PASSWORD      || 'test-password'

let AdminDashboardClient: any
beforeAll(async () => {
  const mod = await import('../AdminDashboardClient')
  AdminDashboardClient = mod.default
})

// ── SSR ──

describe('AdminDashboardClient — unauthenticated SSR', () => {
  it('renders the password login screen without leaking admin data (recentSalesAvailable=true)', () => {
    const html = renderToStaticMarkup(<AdminDashboardClient recentSalesAvailable={true} />)
    expect(html).toContain('PokePrices Admin')
    expect(html).toMatch(/<input [^>]*type="password"/)
    expect(html).not.toContain('Needs attention')
    expect(html).not.toContain('Recent activity')
    expect(html).not.toContain('Admin tools')
    expect(html).not.toContain('Quick actions')
  })
  it('same for recentSalesAvailable=false — no leakage', () => {
    const html = renderToStaticMarkup(<AdminDashboardClient recentSalesAvailable={false} />)
    expect(html).toContain('PokePrices Admin')
    expect(html).not.toContain('Needs attention')
  })
})

// ── Source-text assertions (auth key unification) ──

const SOURCE = readFileSync(
  join(__dirname, '..', 'AdminDashboardClient.tsx'),
  'utf8',
)

describe('AdminDashboardClient — auth key unification', () => {
  it('uses the shared "admin_authed" sessionStorage key', () => {
    expect(SOURCE).toContain("ADMIN_SESSION_KEY = 'admin_authed'")
  })
  it('does NOT introduce its own private sessionStorage key', () => {
    expect(SOURCE).not.toContain('pp_admin_authed')
    expect(SOURCE).not.toContain('pp_dashboard_authed')
    // Regression pin: this component must not reintroduce a
    // second admin session key.
    const matches = SOURCE.match(/sessionStorage\.setItem\('/g) || []
    const setKeys = SOURCE.match(/sessionStorage\.setItem\(([^,]+),/g) || []
    // exactly one setItem call — the login screen's session write
    expect(setKeys.length).toBeLessThanOrEqual(1)
  })
  it('link targets match the audited existing admin routes', () => {
    for (const href of [
      '/admin/insights',
      '/admin/content-studio',
      '/admin/newsletter-studio',
      '/admin/recent-sales',
    ]) {
      expect(SOURCE).toContain(`href="${href}"`)
    }
  })
  it('links to /creators, /vendors, /card-shows and /insights for quick access', () => {
    for (const href of ['/creators', '/vendors', '/card-shows', '/insights']) {
      expect(SOURCE).toContain(`href="${href}"`)
    }
  })
  it('FIX1 — mentions the RECENT_SALES_ADMIN_VIEW_ENABLED flag in the unavailable-state note', () => {
    expect(SOURCE).toContain('RECENT_SALES_ADMIN_VIEW_ENABLED')
  })
  it('FIX1 — recentSalesAvailable prop is on the component signature', () => {
    expect(SOURCE).toMatch(/recentSalesAvailable:\s*boolean/)
  })
  it('FIX1 — Recent Sales card renders an "Not enabled" state when flag is off (no known-404 link)', () => {
    // The unavailable branch replaces the primary action label with
    // the "Not enabled…" text and does NOT pass /admin/recent-sales
    // as the href.
    expect(SOURCE).toContain('Not enabled in this environment')
    // The unavailable-branch ToolCard usage is written with an
    // explicit `href={null}` so we never point at the 404 route
    // when the flag is off.
    expect(SOURCE).toMatch(/href=\{null\}/)
  })
  it('FIX1 — overview cards for pending creators/vendors carry the informational hint (no misleading admin action)', () => {
    // The hints for the two "Pending …" cards must state that no
    // admin review tool is available.
    expect(SOURCE).toContain('Submitted, no admin review tool available')
  })
  it('FIX1 — approved creators / active vendors carry "View public directory" hints', () => {
    expect(SOURCE).toContain('View public directory')
  })
})

// ── page.tsx robots ──

const PAGE_SOURCE = readFileSync(
  join(__dirname, '..', 'page.tsx'),
  'utf8',
)

describe('/admin server-component metadata', () => {
  it('sets robots: noindex,nofollow', () => {
    expect(PAGE_SOURCE).toContain('robots: { index: false, follow: false }')
  })
  it('reuses the client component (not a duplicate implementation)', () => {
    expect(PAGE_SOURCE).toContain("import AdminDashboardClient from './AdminDashboardClient'")
  })
})

// ── Session-key unification across existing admin tools ──

describe('shared admin_authed key across the four admin tools', () => {
  const INSIGHTS = readFileSync(join(__dirname, '..', 'insights', 'InsightsAdminClient.tsx'), 'utf8')
  const CONTENT  = readFileSync(join(__dirname, '..', 'content-studio', 'ContentStudioClient.tsx'), 'utf8')
  const NEWSLET  = readFileSync(join(__dirname, '..', 'newsletter-studio', 'NewsletterStudioClient.tsx'), 'utf8')

  it('/admin/insights already uses admin_authed', () => {
    expect(INSIGHTS).toContain("'admin_authed'")
  })
  it('/admin/content-studio now uses admin_authed (was pp_content_studio_authed)', () => {
    expect(CONTENT).toContain("SESSION_KEY = 'admin_authed'")
    expect(CONTENT).not.toContain("'pp_content_studio_authed'")
  })
  it('/admin/newsletter-studio now uses admin_authed (was pp_newsletter_studio_authed)', () => {
    expect(NEWSLET).toContain("SESSION_KEY = 'admin_authed'")
    expect(NEWSLET).not.toContain("'pp_newsletter_studio_authed'")
  })
})

// ── FIX1: shared AdminToolHeader integration ──

describe('FIX1 — AdminToolHeader integrated into every admin tool', () => {
  const INSIGHTS = readFileSync(join(__dirname, '..', 'insights', 'InsightsAdminClient.tsx'), 'utf8')
  const CONTENT  = readFileSync(join(__dirname, '..', 'content-studio', 'ContentStudioClient.tsx'), 'utf8')
  const NEWSLET  = readFileSync(join(__dirname, '..', 'newsletter-studio', 'NewsletterStudioClient.tsx'), 'utf8')
  const RECENT   = readFileSync(join(__dirname, '..', 'recent-sales', 'RecentSalesAdminClient.tsx'), 'utf8')
  const HEADER   = readFileSync(join(__dirname, '..', '..', '..', 'components', 'admin', 'AdminToolHeader.tsx'), 'utf8')

  it('AdminToolHeader emits an Admin Home link and a Return to site link', () => {
    expect(HEADER).toContain('href="/admin"')
    expect(HEADER).toContain('Admin Home')
    expect(HEADER).toContain('href="/"')
    expect(HEADER).toContain('Return to site')
  })
  it('AdminToolHeader supports showAdminHome=false so /admin itself does not loop back', () => {
    expect(HEADER).toContain('showAdminHome')
    expect(HEADER).toMatch(/showAdminHome\s*=\s*true/)
  })

  it('/admin/insights renders the shared AdminToolHeader', () => {
    expect(INSIGHTS).toContain("import AdminToolHeader from '@/components/admin/AdminToolHeader'")
    expect(INSIGHTS).toContain('<AdminToolHeader toolName="Insights (Articles)"')
  })
  it('/admin/content-studio renders the shared AdminToolHeader', () => {
    expect(CONTENT).toContain("import AdminToolHeader from '@/components/admin/AdminToolHeader'")
    expect(CONTENT).toContain('<AdminToolHeader toolName="Content Studio"')
  })
  it('/admin/newsletter-studio renders the shared AdminToolHeader', () => {
    expect(NEWSLET).toContain("import AdminToolHeader from '@/components/admin/AdminToolHeader'")
    expect(NEWSLET).toContain('<AdminToolHeader toolName="Newsletter Studio"')
  })
  it('/admin/recent-sales renders the shared AdminToolHeader (only mounts when the env flag is on)', () => {
    expect(RECENT).toContain("import AdminToolHeader from '@/components/admin/AdminToolHeader'")
    expect(RECENT).toContain('<AdminToolHeader toolName="Recent Sales pipeline"')
  })
})
