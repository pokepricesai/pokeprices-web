// src/components/recentSales/RecentSalesSection.tsx
// Block 4B-W-4A — "Recent verified sales" panel rendered below the
// existing card-page data when the free-preview flag is on AND there
// are rows to show.
//
// SERVER COMPONENT — no 'use client'. Receives pre-fetched rows from
// the card-page server component; never re-fetches. Importing this
// file from a client component would error at build time (a server
// component cannot be embedded inside a client component as a child
// type, and it has no client-bundle bindings anyway).

import type { CardPageRecentSale } from '@/lib/recentSales/cardQueries'

const TITLE = 'Recent verified sales'

function fmtCents(cents: number): string {
  if (!Number.isFinite(cents)) return '—'
  const dollars = cents / 100
  return '$' + dollars.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function fmtDate(d: string): string {
  // PostgreSQL DATE comes in as 'YYYY-MM-DD'. Render locale-neutral but
  // human-friendly. Avoid pulling in a date library.
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return d
  const [, y, mo, da] = m
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const monthIdx = Math.max(0, Math.min(11, Number(mo) - 1))
  return `${Number(da)} ${months[monthIdx]} ${y}`
}

function gradeLabel(row: CardPageRecentSale): string {
  // Prefer a "PSA 10" / "CGC 9.5" style label. Fall back to the raw/
  // graded tag. Plain "—" when neither is known.
  if (row.gradingCompany) {
    return row.grade
      ? `${row.gradingCompany} ${row.grade}`
      : row.gradingCompany
  }
  if (row.rawOrGraded === 'raw')    return 'Raw'
  if (row.rawOrGraded === 'graded') return 'Graded'
  return '—'
}

function conditionLabel(row: CardPageRecentSale): string {
  // Prefer the parser's bucketed value (clean enum); fall back to the
  // free-text condition only if the bucket is missing.
  if (row.conditionBucket) {
    return row.conditionBucket.replace(/_/g, ' ')
  }
  if (row.conditionText) return row.conditionText
  return '—'
}

function marketplaceLabel(row: CardPageRecentSale): string {
  const m = row.marketplaceSource || '—'
  return row.marketplaceCountry ? `${m} · ${row.marketplaceCountry}` : m
}

export default function RecentSalesSection({ rows }: { rows: CardPageRecentSale[] }) {
  // Per brief: prefer not showing the section publicly unless rows exist.
  if (!Array.isArray(rows) || rows.length === 0) return null

  return (
    <section
      aria-label="Recent verified sales"
      style={{
        maxWidth:   960,
        margin:    '0 auto 40px',
        padding:   '0 24px',
        fontFamily: "'Figtree', sans-serif",
      }}
    >
      <div style={{
        background:   'var(--card)',
        border:       '1px solid var(--border)',
        borderRadius: 14,
        padding:      '18px 20px',
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

        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width:          '100%',
            borderCollapse: 'collapse',
            fontSize:        13,
            fontVariantNumeric: 'tabular-nums',
          }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '6px 8px', fontWeight: 600 }}>Date</th>
                <th style={{ padding: '6px 8px', fontWeight: 600 }}>Marketplace</th>
                <th style={{ padding: '6px 8px', fontWeight: 600 }}>Grade</th>
                <th style={{ padding: '6px 8px', fontWeight: 600 }}>Condition</th>
                <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Price</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const bestOfferAccepted = row.bestOfferStatus === 'accepted'
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px', color: 'var(--text)' }}>
                      {fmtDate(row.saleDate)}
                    </td>
                    <td style={{ padding: '8px', color: 'var(--text)' }}>
                      {marketplaceLabel(row)}
                      {row.observedSection && (
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>
                          {row.observedSection}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px', color: 'var(--text)' }}>
                      {gradeLabel(row)}
                    </td>
                    <td style={{ padding: '8px', color: 'var(--text)' }}>
                      {conditionLabel(row)}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', color: 'var(--text)' }}>
                      {fmtCents(row.salePriceCents)}
                      {bestOfferAccepted && (
                        <span
                          title="Best offer accepted"
                          style={{
                            display:      'block',
                            fontSize:      10,
                            color:        'var(--text-muted)',
                            marginTop:     2,
                          }}
                        >best offer accepted</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
