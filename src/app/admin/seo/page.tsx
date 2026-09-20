// src/app/admin/seo/page.tsx
// ============================================================================
// SEO Mission Control — /admin/seo (Stage 3 · Mission Scoreboard)
//
// Admin-only operating dashboard for the mission to hit 4,000–5,000 organic
// clicks/day by 25 December 2026. Reads from the six existing SEO tables:
//   seo_pages · seo_gsc_page_daily · seo_page_rollups · seo_kpi_daily ·
//   seo_baseline_snapshots · seo_bq_ingest_runs
// No new database tables. Reuses the existing requireAdminPage() gate and
// the noindex/nofollow admin metadata pattern used elsewhere in /admin.
// ============================================================================

import type { Metadata } from 'next'
import { requireAdminPage } from '@/lib/adminAuth'
import { loadMissionControl } from '@/lib/seo/admin/loadMissionControl'
import SeoMissionControlClient from './SeoMissionControlClient'

export const metadata: Metadata = {
  title: 'SEO Mission Control · PokePrices admin',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
  alternates: { canonical: null },
}

// Revalidate every 30 minutes. Restored from the 5-minute value
// earlier this stage — the current Node-side aggregation is expensive
// (paged reads across seo_gsc_page_daily / seo_page_rollups /
// seo_pages producing 300+ Supabase requests per cold rebuild), so
// firing it every 5 minutes made cold renders visible to the user.
// The Stage 4A-perf follow-up will move aggregation into Postgres
// RPCs, after which revalidate can be tightened again if desired.
// Underlying search data updates at most daily so 30 minutes is
// comfortable for freshness. The "Generated at" bar at the top of
// the page tells the operator exactly which snapshot they're seeing.
export const revalidate = 1800

export default async function SeoMissionControlPage() {
  await requireAdminPage('/admin/seo')
  const payload = await loadMissionControl()
  return <SeoMissionControlClient payload={payload} />
}
