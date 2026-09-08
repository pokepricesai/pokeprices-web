// src/app/admin/editorial/page.tsx
//
// EIC Block 3 — Editorial HQ landing page (server component).
//
// Server component: enforces the real admin gate first, then builds
// the full editorial context (articles, projects, release intelligence,
// coverage, timing) with the service-role client. The client component
// gets a fully-populated snapshot on first paint and only makes
// requests to /api/admin/editorial/* for mutations.

import { requireAdminPage } from '@/lib/adminAuth'
import { buildEditorialContext } from '@/lib/editorial/context'
import { loadOrComputeRadar } from '@/lib/editorial/opportunityRadarCache'
import { fetchResearchStatusForProjects } from '@/lib/editorial/research/serverActions'
import EditorialHqClient from './EditorialHqClient'

export const metadata = {
  title: 'Editorial HQ | PokePrices',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function EditorialHqPage() {
  await requireAdminPage('/admin/editorial')
  const context = await buildEditorialContext()
  // Radar runs at most once per calendar day. Same-day reloads
  // return the cached row from opportunity_radar_cache; the
  // Refresh Opportunities button POSTs to the refresh endpoint
  // which forces a recompute + upserts the row.
  const cached = await loadOrComputeRadar(context)
  // Block 6 — bulk-fetch research state so HQ can render a per-project chip.
  const projectIds = context.projects.map(p => Number(p.id)).filter(n => Number.isSafeInteger(n) && n > 0)
  const statusMap = await fetchResearchStatusForProjects(projectIds)
  const researchStatusById: Record<string, string> = {}
  for (const [id, status] of Array.from(statusMap.entries())) researchStatusById[String(id)] = status
  return <EditorialHqClient
    context={context}
    radar={cached.radar}
    radarComputedAt={cached.computedAt}
    researchStatusById={researchStatusById}
  />
}
