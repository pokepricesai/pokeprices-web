// src/app/dashboard/alerts/page.tsx
// Block 5A-W-18 — /dashboard/alerts redirects to the unified
// Watchlist & Alerts surface. Replaces the prior "coming soon"
// placeholder. AlertsClient.tsx is kept on disk for git history
// but is no longer reachable through routing.

import { redirect } from 'next/navigation'

export const dynamic = 'force-static'

export default function AlertsPage() {
  redirect('/dashboard/watchlist-alerts')
}
