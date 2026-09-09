// src/app/admin/editorial/page.tsx
//
// Editorial HQ — simplified three-bucket workflow.
//
// The old EditorialHqClient (weekly slots, full Opportunity Radar
// panel, research-status chips, publish preflight browser) has been
// hidden. It stays in the repo (still imports and typechecks) but
// no page mounts it any more. If the simplified UI needs to be
// rolled back, restore the previous body of this file:
//
//   import { buildEditorialContext } from '@/lib/editorial/context'
//   import { loadOrComputeRadar } from '@/lib/editorial/opportunityRadarCache'
//   import { fetchResearchStatusForProjects } from '@/lib/editorial/research/serverActions'
//   import EditorialHqClient from './EditorialHqClient'
//   ... (see git history)
//
// The simplified client only needs the current project list. It
// pulls the AI analytics summary from the idea-chat endpoint on
// demand, so this page does no radar / research-context work.

import { requireAdminPage } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import type { EditorialProject } from '@/lib/editorial/projects'
import EditorialHqSimpleClient from './EditorialHqSimpleClient'

export const metadata = {
  title: 'Editorial HQ | PokePrices',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function EditorialHqPage() {
  await requireAdminPage('/admin/editorial')
  const supa = getSupabaseServiceClient()
  const { data } = await supa
    .from('editorial_projects')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(500)
  const projects = (data ?? []) as EditorialProject[]
  return <EditorialHqSimpleClient projects={projects} />
}
