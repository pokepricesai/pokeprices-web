// app/admin/page.tsx
// Block 5A-W-47C (with FIX1) — server component landing for the
// unified admin dashboard. Auth is handled inside the client
// component (the existing session-storage password gate), so the
// server-rendered HTML never leaks any admin data or authorised
// state.
//
// FIX1: read the Recent Sales admin-view flag on the server and pass
// the boolean to the client. The flag helper is `import 'server-only'`
// so it cannot be called from the client bundle. A plain boolean prop
// keeps the flag value private (Vercel env vars stay out of the
// client bundle) while letting the tool card render a truthful
// "Not enabled in this environment" state.

import { isAdminViewEnabled } from '@/lib/recentSales/flags'
import AdminDashboardClient from './AdminDashboardClient'

export const metadata = {
  title: 'Admin | PokePrices',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default function AdminDashboardPage() {
  const recentSalesAvailable = isAdminViewEnabled()
  return <AdminDashboardClient recentSalesAvailable={recentSalesAvailable} />
}
