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

// Revalidate every 5 minutes. The underlying data refreshes at most
// daily (BigQuery ingest is nightly, KPI/rollup refresh follows), but a
// 30-minute window was long enough that a fresh ingest could sit
// invisible for a noticeable time. 5 minutes keeps the DB cost trivial
// — this is an admin-only page with a single user, and Vercel dedups
// concurrent renders — while making cache staleness easy to spot.
// Anyone worried about a rendered snapshot's freshness can consult the
// "Generated at" footer and the two data dates in the header.
export const revalidate = 300

export default async function SeoMissionControlPage() {
  await requireAdminPage('/admin/seo')
  const payload = await loadMissionControl()
  return <SeoMissionControlClient payload={payload} />
}
