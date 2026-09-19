// src/app/admin/design/layout.tsx
// ============================================================================
// Admin design-experiment section. The three card-page prototypes live at:
//   /admin/design/card-layout-a
//   /admin/design/card-layout-b
//   /admin/design/card-layout-c
//
// This layout enforces two invariants across the whole section:
//
//   1. NOINDEX / NOFOLLOW at the metadata level. robots.ts already
//      disallows /admin/*, and the parent admin routes carry no
//      internal links from public pages. This section-level noindex
//      is defence-in-depth. Individual prototype pages also set the
//      same robots block so the guarantee survives even if the layout
//      is ever refactored.
//
//   2. Tiny admin chrome (top bar with "back to /admin", section
//      label, "view live card" link). Deliberately minimal so the
//      prototype fills the viewport and is judged like a real card
//      page rather than a page-in-an-iframe.
//
// Auth: each prototype page performs its own requireAdminPage() gate
// so a missing/wrong session hits notFound() before any prototype
// data is loaded. This layout does NOT run the gate itself — layouts
// in Next.js render around notFound() results, so gating here would
// still render the chrome for unauthorised visitors.
// ============================================================================

import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { PROTOTYPE_LIVE_HREF } from './_lib/prototypeCard'

export const metadata: Metadata = {
  title: 'Card page design prototypes · PokePrices admin',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
  alternates: { canonical: null },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function DesignLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '10px 16px',
          background: 'var(--bg-light)',
          borderBottom: '1px solid var(--border)',
          fontFamily: "'Figtree', sans-serif",
          fontSize: 12,
        }}
      >
        <Link href="/admin" style={{ color: 'var(--primary)', fontWeight: 800, textDecoration: 'none' }}>
          ← Admin
        </Link>
        <span style={{
          padding: '2px 8px', borderRadius: 4,
          background: '#fff3cd', color: '#8a6d1a',
          border: '1px solid #ffd97a',
          fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 10,
        }}>
          Private design prototype · noindex
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          Comparison card: <strong style={{ color: 'var(--text)' }}>Charizard [1st Edition] #4 — Base Set</strong>
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
          <Link href="/admin/design/card-layout-a" style={{ color: 'var(--text)', textDecoration: 'none' }}>Layout A</Link>
          <Link href="/admin/design/card-layout-b" style={{ color: 'var(--text)', textDecoration: 'none' }}>Layout B</Link>
          <Link href="/admin/design/card-layout-c" style={{ color: 'var(--text)', textDecoration: 'none' }}>Layout C</Link>
          <Link href={PROTOTYPE_LIVE_HREF} target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
            View live card ↗
          </Link>
        </span>
      </div>
      {children}
    </div>
  )
}
