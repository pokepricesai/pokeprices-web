// src/app/admin/design/card-layout-c/page.tsx
// ============================================================================
// Prototype C — SEO / Answer-First
// Private admin-only card-page design experiment.
// ============================================================================

import type { Metadata } from 'next'
import { requireAdminPage } from '@/lib/adminAuth'
import { loadPrototypeCard } from '../_lib/loadPrototypeCard'
import PrototypeCClient from './PrototypeCClient'

export const metadata: Metadata = {
  title: 'Card prototype C · SEO Answer-First',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
  alternates: { canonical: null },
}

export default async function CardPrototypeCPage() {
  await requireAdminPage('/admin/design/card-layout-c')
  const payload = await loadPrototypeCard()
  return <PrototypeCClient payload={payload} />
}
