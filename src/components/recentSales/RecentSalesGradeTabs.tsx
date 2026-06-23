'use client'

import { useMemo, useState } from 'react'
import type { CardPageRecentSale, GradeGroup } from '@/lib/recentSales/cardQueries'
import EbayCompactLink from '@/components/affiliate/EbayCompactLink'
import { affiliateForGradeKey } from '@/lib/recentSales/affiliate'

export type RecentSalesCardContext = {
  cardName:    string
  setName:     string
  cardNumber:  string | null
  cardSlug:    string | null
  isSealed:    boolean
}

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
  card,
}: {
  groups:      GradeGroup[]
  defaultKey?: string
  card?:       RecentSalesCardContext
}) {
  const initial = useMemo(() => {
    if (defaultKey && groups.some(g => g.key === defaultKey)) return defaultKey
    return groups[0]?.key ?? 'all'
  }, [groups, defaultKey])
  const [selected, setSelected] = useState<string>(initial)

  const current = groups.find(g => g.key === selected) ?? groups[0]
  if (!current) return null

  const affiliate = card && !card.isSealed ? affiliateForGradeKey(selected) : null

  return (
    <div>
      <div
        role="tablist"
        aria-label="Filter recent sales by grade"
        style={{
          display:      'flex',
          flexWrap:     'wrap',
          gap:           8,
          marginBottom: 16,
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
                display:       'inline-flex',
                alignItems:    'center',
                gap:            6,
                padding:       '6px 12px',
                fontSize:       12,
                fontWeight:     active ? 700 : 600,
                background:     active ? 'var(--accent)' : 'var(--bg-light)',
                color:          active ? '#fff'          : 'var(--text)',
                border:        '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
                borderRadius:   999,
                cursor:        'pointer',
                fontFamily:    "'Figtree', sans-serif",
                lineHeight:     1,
                transition:    'background-color 0.12s, border-color 0.12s, color 0.12s',
              }}
            >
              <span>{g.label}</span>
              <span style={{
                display:        'inline-flex',
                alignItems:     'center',
                justifyContent: 'center',
                minWidth:        18,
                height:          18,
                padding:        '0 5px',
                borderRadius:    9,
                background:      active ? 'rgba(255,255,255,0.22)' : 'var(--card)',
                color:           active ? '#fff'                    : 'var(--text-muted)',
                fontSize:        11,
                fontWeight:      700,
                fontVariantNumeric: 'tabular-nums',
              }}>{g.rows.length}</span>
            </button>
          )
        })}
      </div>

      {affiliate && card && (
        <div style={{
          display:       'flex',
          flexWrap:      'wrap',
          gap:            6,
          alignItems:    'center',
          justifyContent:'flex-end',
          marginBottom:   12,
          fontFamily:    "'Figtree', sans-serif",
        }}>
          <EbayCompactLink
            cardName={card.cardName}
            setName={card.setName}
            cardNumber={card.cardNumber}
            cardSlug={card.cardSlug}
            setSlug={card.setName}
            intent={affiliate.intent}
            gradingCompany={affiliate.gradingCompany ?? null}
            grade={affiliate.grade ?? null}
            placement={affiliate.placement}
            pageType="card"
            sourceComponent="recent_sales_section"
            label={`${affiliate.label} →`}
            style={{
              fontSize: 12,
              color:   'var(--text)',
              background: 'var(--bg-light)',
              border:    '1px solid var(--border)',
              borderRadius: 999,
              padding: '4px 12px',
              fontWeight: 600,
            }}
          />
          <span style={{
            fontSize: 10,
            color:    'var(--text-muted)',
            opacity:   0.75,
          }}>Affiliate · we may earn commission</span>
        </div>
      )}

      <ul style={{
        listStyle: 'none',
        margin:    0,
        padding:   0,
        display:   'flex',
        flexDirection: 'column',
        gap:        8,
      }}>
        {current.rows.map((row, i) => {
          const bestOfferAccepted = row.bestOfferStatus === 'accepted'
          return (
            <li
              key={i}
              style={{
                display:        'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                gap:             '4px 16px',
                alignItems:      'center',
                padding:        '12px 14px',
                border:         '1px solid var(--border)',
                borderRadius:    10,
                background:     'var(--bg-light)',
              }}
            >
              {/* Left: meta block (date · marketplace · section · grade · condition) */}
              <div style={{ minWidth: 0 }}>
                <div style={{
                  display:    'flex',
                  flexWrap:   'wrap',
                  gap:         8,
                  alignItems: 'baseline',
                  marginBottom: 4,
                }}>
                  <span style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'var(--text)',
                    fontFamily: "'Figtree', sans-serif",
                  }}>{fmtDate(row.saleDate)}</span>
                  <span style={{
                    display:      'inline-flex',
                    alignItems:   'center',
                    padding:     '2px 8px',
                    fontSize:     11,
                    fontWeight:   700,
                    color:       'var(--text)',
                    background:  'var(--card)',
                    border:      '1px solid var(--border)',
                    borderRadius: 999,
                    lineHeight:   1.4,
                  }}>{gradeLabel(row)}</span>
                </div>
                <div style={{
                  fontSize: 12,
                  color:    'var(--text-muted)',
                  display:  'flex',
                  flexWrap: 'wrap',
                  gap:       6,
                  alignItems: 'center',
                }}>
                  <span>{marketplaceLabel(row)}</span>
                  {row.observedSection && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{row.observedSection}</span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>{conditionLabel(row)}</span>
                </div>
              </div>

              {/* Right: price (visually dominant) */}
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: 'var(--text)',
                  fontFamily: "'Outfit', sans-serif",
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1.2,
                }}>{fmtCents(row.salePriceCents)}</div>
                {bestOfferAccepted && (
                  <div
                    title="Best offer accepted"
                    style={{
                      fontSize:   10,
                      color:     'var(--text-muted)',
                      marginTop:  2,
                      letterSpacing: 0.2,
                    }}
                  >best offer accepted</div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
