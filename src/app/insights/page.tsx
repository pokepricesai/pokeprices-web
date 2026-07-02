// app/insights/page.tsx
import type { Metadata } from 'next'
import InsightsPageClient from './InsightsPageClient'
import {
  INSIGHTS_HUB_CANONICAL,
  INSIGHTS_HUB_DESCRIPTION,
  INSIGHTS_HUB_OG_DESCRIPTION,
  INSIGHTS_HUB_OG_TITLE,
  INSIGHTS_HUB_TITLE,
} from '@/lib/seo-helpers'

// Block 5A-W-34A — hub metadata rewritten to target the queries the
// GSC export shows people actually use: "pokemon card market trends",
// "psa 10 values", "pokemon card price guide", "grading". Baseline
// before this change: 1,917 impressions, 4 clicks, 0.21% CTR, pos 11.8.
export const metadata: Metadata = {
  title:       INSIGHTS_HUB_TITLE,
  description: INSIGHTS_HUB_DESCRIPTION,
  openGraph: {
    title:       INSIGHTS_HUB_OG_TITLE,
    description: INSIGHTS_HUB_OG_DESCRIPTION,
    url:         INSIGHTS_HUB_CANONICAL,
    siteName:    'PokePrices',
    type:        'website',
  },
  twitter: {
    card:        'summary',
    title:       INSIGHTS_HUB_OG_TITLE,
    description: INSIGHTS_HUB_OG_DESCRIPTION,
  },
  alternates: { canonical: INSIGHTS_HUB_CANONICAL },
}

export default function InsightsPage() {
  return <InsightsPageClient />
}