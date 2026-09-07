// src/app/admin/editorial/studio/[projectId]/page.tsx
//
// EIC Block 7 — Article Studio server entry.

import { notFound } from 'next/navigation'
import { requireAdminPage } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { fetchResearch } from '@/lib/editorial/research/serverActions'
import type { StudioDocument } from '@/lib/studio/types'
import { emptyStudioDocument } from '@/lib/studio/types'
import StudioClient from './StudioClient'

export const metadata = {
  title: 'Article Studio | PokePrices',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function StudioPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId: raw } = await params
  await requireAdminPage(`/admin/editorial/studio/${raw}`)

  const projectId = Number(raw)
  if (!Number.isSafeInteger(projectId) || projectId <= 0) notFound()

  const supa = getSupabaseServiceClient()
  const { data: project, error } = await supa
    .from('editorial_projects')
    .select('id, title, angle, article_type, status, priority, target_publish_at, notes, insights_id, studio_json, writer_json, created_at, updated_at')
    .eq('id', projectId)
    .maybeSingle()
  if (error || !project) notFound()

  const research = await fetchResearch(projectId)

  const initialDoc: StudioDocument =
    ((project as any).studio_json as StudioDocument | null)
    ?? emptyStudioDocument({ headline: project.title ?? '', intro: '', themeKey: 'market' })

  return (
    <StudioClient
      project={{
        id: Number(project.id),
        title: String(project.title),
        angle: project.angle ?? null,
        article_type: String(project.article_type),
        status: String(project.status),
        target_publish_at: project.target_publish_at ?? null,
        insights_id: project.insights_id ?? null,
      }}
      initialDoc={initialDoc}
      research={research}
      initialWriter={((project as any).writer_json ?? null)}
    />
  )
}
