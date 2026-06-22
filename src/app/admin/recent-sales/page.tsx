// src/app/admin/recent-sales/page.tsx
// Block 4B-W-3A — recent-sales admin inspection page.
//
// Fail-closed: when RECENT_SALES_ADMIN_VIEW_ENABLED is not the literal
// "true" the page returns a 404. There is no public navigation link to
// this route, and /admin/* is disallowed in robots.txt (see
// src/app/robots.ts).

import { notFound } from 'next/navigation'
import { isAdminViewEnabled } from '@/lib/recentSales/flags'
import RecentSalesAdminClient from './RecentSalesAdminClient'

export const metadata = {
  title: 'Recent Sales Admin | PokePrices',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default function RecentSalesAdminPage() {
  if (!isAdminViewEnabled()) {
    // 404 — the surface does not exist until the flag is set.
    notFound()
  }
  return <RecentSalesAdminClient />
}
