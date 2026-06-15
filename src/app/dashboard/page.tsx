// src/app/dashboard/page.tsx
import { requireAuthUser } from '@/lib/auth-server'
import DashboardHubClient from './DashboardHubClient'

export default async function DashboardPage() {
  await requireAuthUser('/dashboard')
  return <DashboardHubClient />
}
