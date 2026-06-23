// src/components/recentSales/RecentSalesSection.tsx
// Server component that renders the "Recent verified sales" panel
// below the card-page data. Receives pre-fetched, pre-grouped data
// from the card-page server component. The interactive grade-tab
// switch (and the grade-aware affiliate link) live in a child client
// component (RecentSalesGradeTabs).

import type { CardPageRecentSalesData } from '@/lib/recentSales/cardQueries'
import RecentSalesGradeTabs, { type RecentSalesCardContext } from './RecentSalesGradeTabs'

const TITLE = 'Recent verified sales'

export default function RecentSalesSection({
  data,
  card,
}: {
  data:  CardPageRecentSalesData
  card?: RecentSalesCardContext
}) {
  if (!data || data.total === 0 || data.groups.length === 0) return null

  return (
    <section
      aria-label="Recent verified sales"
      style={{
        maxWidth:    960,
        margin:     '0 auto 40px',
        padding:    '0 24px',
        fontFamily: "'Figtree', sans-serif",
      }}
    >
      <div style={{
        background:   'var(--card)',
        border:       '1px solid var(--border)',
        borderRadius: 14,
        padding:     '18px 20px',
      }}>
        <header style={{ marginBottom: 12 }}>
          <h2 style={{
            margin:      0,
            fontSize:    16,
            fontWeight:  800,
            color:      'var(--text)',
            fontFamily: "'Outfit', sans-serif",
          }}>{TITLE}</h2>
        </header>
        <RecentSalesGradeTabs groups={data.groups} card={card} />
      </div>
    </section>
  )
}
