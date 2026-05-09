'use client'
import { useState } from 'react'

// All keys match the daily_prices column names verbatim. Values are USD
// dollars (already divided from cents by the caller). Any may be null.
export interface GradePrices {
  raw_usd?: number | null
  psa7_usd?: number | null
  psa8_usd?: number | null
  psa9_usd?: number | null
  psa10_usd?: number | null
  cgc95_usd?: number | null
  bgs95_usd?: number | null
  grade1_usd?: number | null
  grade2_usd?: number | null
  grade3_usd?: number | null
  grade4_usd?: number | null
  grade5_usd?: number | null
  grade6_usd?: number | null
  tag10_usd?: number | null
  ace10_usd?: number | null
  sgc10_usd?: number | null
  cgc10_usd?: number | null
  bgs10_usd?: number | null
  bgs10black_usd?: number | null
  cgc10pristine_usd?: number | null
}

interface Props {
  prices: GradePrices
  className?: string
  mode?: 'card' | 'sealed'
}

const HEADLINE: { label: string; key: keyof GradePrices }[] = [
  { label: 'Ungraded',         key: 'raw_usd'           },
  { label: 'PSA 7',            key: 'psa7_usd'          },
  { label: 'PSA 8',            key: 'psa8_usd'          },
  { label: 'PSA 9',            key: 'psa9_usd'          },
  { label: 'PSA 10',           key: 'psa10_usd'         },
  { label: 'ACE 10',           key: 'ace10_usd'         },
  { label: 'BGS 10 Black',     key: 'bgs10black_usd'    },
  { label: 'CGC 10 Pristine',  key: 'cgc10pristine_usd' },
]

const EXPANDED: { label: string; key: keyof GradePrices }[] = [
  { label: 'BGS 10',  key: 'bgs10_usd' },
  { label: 'CGC 10',  key: 'cgc10_usd' },
  { label: 'SGC 10',  key: 'sgc10_usd' },
  { label: 'TAG 10',  key: 'tag10_usd' },
  { label: 'CGC 9.5', key: 'cgc95_usd' },
  { label: 'BGS 9.5', key: 'bgs95_usd' },
  { label: 'PSA 6',   key: 'grade6_usd' },
  { label: 'PSA 5',   key: 'grade5_usd' },
  { label: 'PSA 4',   key: 'grade4_usd' },
  { label: 'PSA 3',   key: 'grade3_usd' },
  { label: 'PSA 2',   key: 'grade2_usd' },
  { label: 'PSA 1',   key: 'grade1_usd' },
]

function fmtUsd(v: number | null | undefined): string {
  if (v == null) return '—'
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function Tile({ label, value, small = false }: { label: string; value: number | null | undefined; small?: boolean }) {
  const isNull = value == null
  return (
    <div style={{
      background: 'var(--bg-light)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: small ? '10px 12px' : '12px 14px',
      minWidth: 0,
    }}>
      <div style={{
        fontSize: small ? 9 : 10,
        fontWeight: 700,
        color: 'var(--text-muted)',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        marginBottom: 4,
        fontFamily: "'Figtree', sans-serif",
      }}>{label}</div>
      <div style={{
        fontSize: small ? 14 : 16,
        fontWeight: 700,
        fontFamily: "'Figtree', sans-serif",
        color: isNull ? 'var(--border)' : 'var(--text)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>{fmtUsd(value)}</div>
    </div>
  )
}

function ToggleButton({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls="grade-ladder-expanded"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'transparent',
        border: 'none',
        padding: '10px 0 4px',
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--text-muted)',
        fontFamily: "'Figtree', sans-serif",
        cursor: 'pointer',
      }}
    >
      {expanded ? 'Hide all grades' : 'Show all grades'}
      <svg
        width="12" height="12" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round"
        style={{
          transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
          transition: 'transform 0.18s ease',
        }}
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  )
}

export default function GradeLadder({ prices, className, mode = 'card' }: Props) {
  const [expanded, setExpanded] = useState(false)

  if (mode === 'sealed') {
    const headlinePopulated = HEADLINE.filter(g => prices[g.key] != null)
    const expandedPopulated = EXPANDED.filter(g => prices[g.key] != null)

    if (headlinePopulated.length === 0 && expandedPopulated.length === 0) return null

    return (
      <div className={className}>
        {headlinePopulated.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
            gap: 8,
          }}>
            {headlinePopulated.map(g => <Tile key={g.key} label={g.label} value={prices[g.key]} />)}
          </div>
        )}

        {expandedPopulated.length > 0 && (
          <>
            <ToggleButton expanded={expanded} onClick={() => setExpanded(e => !e)} />
            <div
              id="grade-ladder-expanded"
              role="region"
              aria-label="Additional grade prices"
              style={{
                display: expanded ? 'grid' : 'none',
                gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
                gap: 6,
                marginTop: 4,
              }}
            >
              {expandedPopulated.map(g => <Tile key={g.key} label={g.label} value={prices[g.key]} small />)}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className={className}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
        gap: 8,
      }}>
        {HEADLINE.map(g => <Tile key={g.key} label={g.label} value={prices[g.key]} />)}
      </div>

      <ToggleButton expanded={expanded} onClick={() => setExpanded(e => !e)} />

      <div
        id="grade-ladder-expanded"
        role="region"
        aria-label="Additional grade prices"
        style={{
          display: expanded ? 'grid' : 'none',
          gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
          gap: 6,
          marginTop: 4,
        }}
      >
        {EXPANDED.map(g => <Tile key={g.key} label={g.label} value={prices[g.key]} small />)}
      </div>
    </div>
  )
}
