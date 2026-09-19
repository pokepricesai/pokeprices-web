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

// Long-ish revalidate window — the underlying data refreshes at most daily
// (BigQuery ingest runs nightly, KPI/rollup refresh after that). Serving a
// slightly stale snapshot for up to an hour keeps the page snappy and
// avoids re-aggregating 146k rows on every hit.
export const revalidate = 1800

export default async function SeoMissionControlPage() {
  await requireAdminPage('/admin/seo')
  const payload = await loadMissionControl()
  return <SeoMissionControlClient payload={payload} />
}
