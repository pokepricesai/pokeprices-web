// app/admin/insights/page.tsx
//
// EIC Block 0 — server-side authentication gate. Anyone not signed in
// via Supabase is redirected to /dashboard/login with a safe returnTo;
// anyone signed in but not on the ADMIN_ALLOWED_EMAILS allow-list gets
// a 404 (fail-closed, mirrors requireAdmin's 403 posture for the API
// gate). This replaces the previous "public HTML + client-side
// sessionStorage password" flow, which offered no real protection.

import { requireAdminPage } from '@/lib/adminAuth'
import InsightsAdminClient from './InsightsAdminClient'

export const metadata = {
  title: 'Insights Admin | PokePrices',
  robots: { index: false, follow: false },
}

// Force dynamic so the auth check runs on every request (never cached).
export const dynamic = 'force-dynamic'

export default async function AdminInsightsPage() {
  await requireAdminPage('/admin/insights')
  return <InsightsAdminClient />
}
