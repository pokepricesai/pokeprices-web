// src/app/dashboard/watchlist/page.tsx
// Block 5A-W-18 — /dashboard/watchlist now redirects to the unified
// Watchlist & Alerts surface. WatchlistClient.tsx is still imported
// (in embedded mode) by /dashboard/watchlist-alerts; the standalone
// page is kept only as a stable URL for any existing bookmarks or
// inbound links.

import { redirect } from 'next/navigation'

export const dynamic = 'force-static'

export default function WatchlistPage() {
  redirect('/dashboard/watchlist-alerts')
}
