// src/app/admin/design/card-layout-a/page.tsx
// ============================================================================
// Prototype A — Market / Affiliate First
// Private admin-only card-page design experiment. See:
//   src/app/admin/design/layout.tsx        (chrome + section noindex)
//   src/app/admin/design/_lib/*            (shared data loader)
// ============================================================================

import type { Metadata } from 'next'
import { requireAdminPage } from '@/lib/adminAuth'
import { loadPrototypeCard } from '../_lib/loadPrototypeCard'
import PrototypeAClient from './PrototypeAClient'

export const metadata: Metadata = {
  title: 'Card prototype A · Market / Affiliate First',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
  alternates: { canonical: null },
}

export default async function CardPrototypeAPage() {
  await requireAdminPage('/admin/design/card-layout-a')
  const payload = await loadPrototypeCard()
  return <PrototypeAClient payload={payload} />
}
