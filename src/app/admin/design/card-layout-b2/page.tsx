// src/app/admin/design/card-layout-b2/page.tsx
// ============================================================================
// Prototype B2 — Collector Dashboard, refined
//
// Refinement of Prototype B focused on information-architecture rather than
// visual redesign. The core additions vs B:
//
//   • True sticky LEFT section-navigation rail on wide desktop
//     (>=1200px), with grouped items, active-section highlighting via
//     IntersectionObserver, and contextual price data next to key rows.
//   • Grading concept is split into three distinct nav destinations:
//     "Grading" (should-I-grade insight), "Grade ladder" (per-tier prices),
//     and "PSA population".
//   • Below 1200px the left nav collapses into a compact sticky horizontal
//     chip strip so the main dashboard + eBay rail keep breathing room.
//
// Route is admin-only + noindex/nofollow — identical protections to B/C.
// Data loader, shared helpers, and existing affiliate components are
// re-used verbatim; no production code is touched.
// ============================================================================

import type { Metadata } from 'next'
import { requireAdminPage } from '@/lib/adminAuth'
import { loadPrototypeCard } from '../_lib/loadPrototypeCard'
import PrototypeB2Client from './PrototypeB2Client'

export const metadata: Metadata = {
  title: 'Card prototype B2 · Collector Dashboard (refined)',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
  alternates: { canonical: null },
}

export default async function CardPrototypeB2Page() {
  await requireAdminPage('/admin/design/card-layout-b2')
  const payload = await loadPrototypeCard()
  return <PrototypeB2Client payload={payload} />
}
