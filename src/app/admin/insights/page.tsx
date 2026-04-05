// app/admin/insights/page.tsx
import InsightsAdminClient from './InsightsAdminClient'

export const metadata = {
  title: 'Insights Admin | PokePrices',
  robots: { index: false, follow: false },
}

export default function AdminInsightsPage() {
  return <InsightsAdminClient />
}
