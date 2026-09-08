// src/app/admin/editorial/research/[projectId]/page.tsx
//
// EIC Block 6 — Research Room server entry.
//
// Enforces the real admin gate, loads the project + current research
// row server-side, and hands both to the client component.

import { notFound } from 'next/navigation'
import { requireAdminPage } from '@/lib/adminAuth'
import { fetchProject, fetchResearch } from '@/lib/editorial/research/serverActions'
import { chooseRecipe } from '@/lib/editorial/research/dispatch'
import ResearchRoomClient from './ResearchRoomClient'

export const metadata = {
  title: 'Research Room | PokePrices',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function ResearchRoomPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId: raw } = await params
  await requireAdminPage(`/admin/editorial/research/${raw}`)

  const projectId = Number(raw)
  if (!Number.isSafeInteger(projectId) || projectId <= 0) notFound()

  const project = await fetchProject(projectId)
  if (!project) notFound()

  const research = await fetchResearch(projectId)
  const chosenRecipe = chooseRecipe({
    id: project.id, title: project.title, angle: project.angle,
    articleType: project.article_type, targetPublishAt: project.target_publish_at,
  })

  return <ResearchRoomClient project={project} initialResearch={research} chosenRecipe={chosenRecipe} />
}
