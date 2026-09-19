// src/app/admin/design/card-layout-b/page.tsx
// ============================================================================
// Prototype B — Collector Dashboard
// Private admin-only card-page design experiment.
// ============================================================================

import type { Metadata } from 'next'
import { requireAdminPage } from '@/lib/adminAuth'
import { loadPrototypeCard } from '../_lib/loadPrototypeCard'
import PrototypeBClient from './PrototypeBClient'

export const metadata: Metadata = {
  title: 'Card prototype B · Collector Dashboard',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
  alternates: { canonical: null },
}

export default async function CardPrototypeBPage() {
  await requireAdminPage('/admin/design/card-layout-b')
  const payload = await loadPrototypeCard()
  return <PrototypeBClient payload={payload} />
}
