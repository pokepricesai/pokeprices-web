'use client'

import { useMemo, useState } from 'react'
import type { CardPageRecentSale, GradeGroup } from '@/lib/recentSales/cardQueries'

function fmtCents(cents: number): string {
  if (!Number.isFinite(cents)) return '—'
  const dollars = cents / 100
  return '$' + dollars.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function fmtDate(d: string): string {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return d
  const [, y, mo, da] = m
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const monthIdx = Math.max(0, Math.min(11, Number(mo) - 1))
  return `${Number(da)} ${months[monthIdx]} ${y}`
}

function gradeLabel(row: CardPageRecentSale): string {
  if (row.gradingCompany) {
    return row.grade ? `${row.gradingCompany} ${row.grade}` : row.gradingCompany
  }
  if (row.rawOrGraded === 'raw')    return 'Raw'
  if (row.rawOrGraded === 'graded') return 'Graded'
  return '—'
}

function conditionLabel(row: CardPageRecentSale): string {
  if (row.conditionBucket) return row.conditionBucket.replace(/_/g, ' ')
  if (row.conditionText)   return row.conditionText
  return '—'
}

function marketplaceLabel(row: CardPageRecentSale): string {
  const m = row.marketplaceSource || '—'
  return row.marketplaceCountry ? `${m} · ${row.marketplaceCountry}` : m
}

export default function RecentSalesGradeTabs({
  groups,
  defaultKey,
}: {
  groups:      GradeGroup[]
  defaultKey?: string
}) {
  const initial = useMemo(() => {
    if (defaultKey && groups.some(g => g.key === defaultKey)) return defaultKey
    return groups[0]?.key ?? 'all'
  }, [groups, defaultKey])
  const [selected, setSelected] = useState<string>(initial)

  const current = groups.find(g => g.key === selected) ?? groups[0]
  if (!current) return null

  return (
    <div>
      <div
        role="tablist"
        aria-label="Filter recent sales by grade"
        style={{
          display:    'flex',
          flexWrap:   'wrap',
          gap:         6,
          marginBottom: 12,
        }}
      >
        {groups.map(g => {
          const active = g.key === selected
          return (
            <button
              key={g.key}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => setSelected(g.key)}
              style={{
                padding:    '4px 10px',
                fontSize:    12,
                fontWeight:  active ? 700 : 500,
                background:  active ? 'var(--accent)' : 'var(--bg-light)',
                color:       active ? '#fff'          : 'var(--text)',
                border:     '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
                borderRadius: 999,
                cursor:      'pointer',
                fontFamily: "'Figtree', sans-serif",
              }}
            >
              {g.label}
              <span style={{
                marginLeft: 6,
                opacity:    0.75,
                fontWeight: 500,
              }}>{g.rows.length}</span>
            </button>
          )
        })}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width:              '100%',
          borderCollapse:     'collapse',
          fontSize:            13,
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
            {current.rows.map((row, i) => {
              const bestOfferAccepted = row.bestOfferStatus === 'accepted'
              return (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px', color: 'var(--text)' }}>{fmtDate(row.saleDate)}</td>
                  <td style={{ padding: '8px', color: 'var(--text)' }}>
                    {marketplaceLabel(row)}
                    {row.observedSection && (
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>
                        {row.observedSection}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '8px', color: 'var(--text)' }}>{gradeLabel(row)}</td>
                  <td style={{ padding: '8px', color: 'var(--text)' }}>{conditionLabel(row)}</td>
                  <td style={{ padding: '8px', textAlign: 'right', color: 'var(--text)' }}>
                    {fmtCents(row.salePriceCents)}
                    {bestOfferAccepted && (
                      <span
                        title="Best offer accepted"
                        style={{
                          display:    'block',
                          fontSize:    10,
                          color:      'var(--text-muted)',
                          marginTop:   2,
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
  )
}
