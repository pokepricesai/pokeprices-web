'use client'

// src/components/home/HomeMarketTicker.tsx
// Block 5A-W-41A — full-width market status strip that opens the
// homepage. Purely a presentation layer over data the homepage has
// already loaded via existing Supabase RPCs; no new queries.
//
// Design goals:
//   * feel like a data terminal / trading board, not a hero CTA
//   * tabular numerals, monospace-ish, low chrome
//   * dark navy background so it sits below the site nav without
//     competing with card sections further down the page
//   * degrades gracefully when data is missing — hide the whole strip
//     if no market total is available yet, or drop individual cells
//   * horizontally scrollable on mobile so tight widths don't wrap
//     every cell onto its own line
//
// Copy is deliberately plain (MKT INDEX / 30D / CARDS / SETS / …) —
// no emoji labels, no marketing verbs.

export type MarketTickerInput = {
  /** Ungraded market total in cents, or null if unavailable. */
  marketValueCents: number | null
  /** 30-day percent change on the raw market index (already parsed). */
  pct30d:           number | null
  /** Distinct cards tracked (null hides the cell). */
  cardsTracked:    number | null
  /** Distinct sets tracked. Static "156+" if null — the site publicly
   *  quotes this everywhere else. */
  setsTracked:     number | null
  /** Latest-set label ("Chaos Rising") or null. */
  latestSetName:   string | null
  /** Top-riser card + percentage from the weekly report. */
  topRiser:        { name: string; pctLabel: string } | null
  /** Top-faller card + percentage. */
  topFaller:       { name: string; pctLabel: string } | null
}

function formatMarketTotal(cents: number): string {
  const dollars = cents / 100
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(2)}M`
  if (dollars >= 1_000)     return `$${(dollars / 1_000).toFixed(0)}K`
  return `$${dollars.toFixed(0)}`
}

function formatPct(pct: number): string {
  const arrow = pct >= 0 ? '▲' : '▼'
  return `${arrow} ${Math.abs(pct).toFixed(1)}%`
}

const cellStyle: React.CSSProperties = {
  display:        'inline-flex',
  alignItems:     'center',
  gap:            8,
  padding:        '0 18px',
  height:         '100%',
  whiteSpace:     'nowrap',
  borderLeft:     '1px solid rgba(255,255,255,0.10)',
  fontFamily:     "'Figtree', sans-serif",
  fontVariantNumeric: 'tabular-nums',
}

const labelStyle: React.CSSProperties = {
  fontSize:      10,
  fontWeight:    800,
  letterSpacing: 1.4,
  color:         'rgba(255,255,255,0.55)',
  textTransform: 'uppercase',
}

const valueStyle: React.CSSProperties = {
  fontSize:      13,
  fontWeight:    800,
  color:         '#fff',
}

export default function HomeMarketTicker(input: MarketTickerInput) {
  const {
    marketValueCents, pct30d, cardsTracked, setsTracked,
    latestSetName, topRiser, topFaller,
  } = input

  // Hide the whole strip if we can't build a meaningful lead cell.
  const hasIndex   = typeof marketValueCents === 'number' && marketValueCents > 0
  const hasAnyCell =
    hasIndex ||
    (typeof cardsTracked === 'number' && cardsTracked > 0) ||
    (topRiser !== null) || (topFaller !== null) ||
    (latestSetName !== null)
  if (!hasAnyCell) return null

  const setsLabel = typeof setsTracked === 'number' && setsTracked > 0
    ? `${setsTracked}+`
    : '156+'

  return (
    <section
      aria-label="Pokémon TCG market status"
      style={{
        background: 'linear-gradient(90deg, #0b1e36 0%, #133863 55%, #1a5fad 100%)',
        color:      '#fff',
        borderTop:    '1px solid rgba(255,255,255,0.10)',
        borderBottom: '1px solid rgba(255,255,255,0.12)',
      }}
    >
      <div style={{
        maxWidth:  1440,
        margin:    '0 auto',
        height:    44,
        display:   'flex',
        alignItems:'center',
        overflowX: 'auto',
        overflowY: 'hidden',
        WebkitOverflowScrolling: 'touch',
      }}>
        {hasIndex && (
          <div style={{ ...cellStyle, borderLeft: 'none' }}>
            <span style={labelStyle}>Mkt Index</span>
            <span style={valueStyle}>{formatMarketTotal(marketValueCents!)}</span>
            {typeof pct30d === 'number' && (
              <span style={{
                ...valueStyle,
                color: pct30d >= 0 ? '#4ade80' : '#f87171',
                fontSize: 12,
              }}>{formatPct(pct30d)} 30d</span>
            )}
          </div>
        )}
        {typeof cardsTracked === 'number' && cardsTracked > 0 && (
          <div style={cellStyle}>
            <span style={labelStyle}>Cards</span>
            <span style={valueStyle}>{cardsTracked.toLocaleString('en-GB')}</span>
          </div>
        )}
        <div style={cellStyle}>
          <span style={labelStyle}>Sets</span>
          <span style={valueStyle}>{setsLabel}</span>
        </div>
        {topRiser && (
          <div style={cellStyle}>
            <span style={{ ...labelStyle, color: '#4ade80' }}>Top Riser</span>
            <span style={valueStyle}>{topRiser.name}</span>
            <span style={{ ...valueStyle, color: '#4ade80', fontSize: 12 }}>{topRiser.pctLabel}</span>
          </div>
        )}
        {topFaller && (
          <div style={cellStyle}>
            <span style={{ ...labelStyle, color: '#f87171' }}>Top Faller</span>
            <span style={valueStyle}>{topFaller.name}</span>
            <span style={{ ...valueStyle, color: '#f87171', fontSize: 12 }}>{topFaller.pctLabel}</span>
          </div>
        )}
        {latestSetName && (
          <div style={cellStyle}>
            <span style={labelStyle}>Latest Set</span>
            <span style={valueStyle}>{latestSetName}</span>
          </div>
        )}
        <div style={cellStyle}>
          <span style={labelStyle}>Updated</span>
          <span style={valueStyle}>Nightly</span>
        </div>
      </div>
    </section>
  )
}
