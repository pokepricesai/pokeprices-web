// TCGGraph "additional data" panel.
//
// Rendered via the existing CardPageClient `quickFactsSlot` so no
// edits to the card page component are needed. Keeps the existing
// page design intact and tucks the new marketplace + condition +
// pooled-grade data into a compact, additive section.
//
// Discipline:
//   • Pooled grade 7/8/9/9.5 are labelled "Grade N (pooled across
//     graders)" with a tooltip-equivalent inline note. NEVER
//     labelled as PSA-specific.
//   • Variant-tag awareness: if snapshot.pricing_eligibility is
//     market_only, graded rows will be empty by construction (the
//     resolver suppresses them); this panel honours that.
//   • Prices render in their native currency with the correct
//     symbol — no silent EUR→USD conversion.

import type { ProviderSnapshot, ProviderMarketPrice, ProviderGradedPrice } from '@/lib/providerData/snapshot'

function fmt(value: number | null | undefined, currency: string): string {
  if (value == null) return '—'
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency + ' '
  const v = Number(value)
  if (v >= 1000) return `${sym}${Math.round(v).toLocaleString('en-US')}`
  return `${sym}${v.toFixed(2)}`
}

function groupBy<T, K extends string>(rows: T[], keyFn: (r: T) => K): Record<K, T[]> {
  const o: Record<string, T[]> = {}
  for (const r of rows) {
    const k = keyFn(r)
    ;(o[k] ||= []).push(r)
  }
  return o as Record<K, T[]>
}

interface Props {
  snapshot: ProviderSnapshot
}

export default function TcgGraphMarketPanel({ snapshot }: Props) {
  const bySource = groupBy(snapshot.market_prices, (r: ProviderMarketPrice) => r.source)
  const pooled = snapshot.graded_prices.filter((g: ProviderGradedPrice) => g.grader === 'any')
  const perGrader = snapshot.graded_prices.filter((g: ProviderGradedPrice) => g.grade === '10' && g.grader !== 'any' && g.grader !== 'raw')

  const hasAnyMarket = snapshot.market_prices.length > 0
  const hasAnyGraded = snapshot.graded_prices.length > 0

  if (!hasAnyMarket && !hasAnyGraded) {
    return (
      <aside style={styles.wrap}>
        <div style={styles.badge}>TCGGraph preview</div>
        <div style={styles.note}>
          No TCGGraph market or graded data is published for this printing.
          Pricing eligibility: <code>{snapshot.pricing_eligibility}</code>.
        </div>
      </aside>
    )
  }

  return (
    <aside style={styles.wrap}>
      <header style={styles.header}>
        <div style={styles.badge}>TCGGraph preview</div>
        <div style={styles.subtitle}>
          Additional marketplace + condition data. Eligibility: <code>{snapshot.pricing_eligibility}</code>.
          {snapshot.pricing_eligibility === 'market_only' && (
            <> · Graded values suppressed — this is a variant printing and TCGGraph graded quotes are aggregated across printings.</>
          )}
        </div>
      </header>

      {hasAnyMarket && (
        <section style={styles.block}>
          <h3 style={styles.h3}>Marketplace quotes</h3>
          <div style={styles.sourceGrid}>
            {Object.entries(bySource).map(([source, rows]) => (
              <div key={source} style={styles.sourceCard}>
                <div style={styles.sourceLabel}>{source}</div>
                <table style={styles.table}>
                  <thead>
                    <tr style={{ color: '#555' }}>
                      <th style={styles.th}>finish</th>
                      <th style={styles.th}>market</th>
                      <th style={styles.th}>low</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r: ProviderMarketPrice, i: number) => (
                      <tr key={i} style={styles.tr}>
                        <td style={styles.td}><code>{r.finish ?? '—'}</code></td>
                        <td style={styles.tdNum}>{fmt(r.market, r.currency)}</td>
                        <td style={styles.tdNum}>{fmt(r.low, r.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </section>
      )}

      {hasAnyGraded && (
        <section style={styles.block}>
          <h3 style={styles.h3}>Additional graded data</h3>
          {perGrader.length > 0 && (
            <div style={styles.gradeStrip}>
              {perGrader.map((g: ProviderGradedPrice, i: number) => (
                <div key={i} style={styles.gradeTile}>
                  <div style={styles.gradeTileLabel}>{g.grader.toUpperCase()} 10</div>
                  <div style={styles.gradeTileValue}>{fmt(g.price, g.currency)}</div>
                </div>
              ))}
            </div>
          )}
          {pooled.length > 0 && (
            <div>
              <div style={styles.pooledHeader}>
                Grade 7 / 8 / 9 / 9.5 <span style={{ color: '#8b1a1a' }}>pooled across graders — NOT PSA-specific</span>
              </div>
              <div style={styles.gradeStrip}>
                {pooled
                  .slice()
                  .sort((a, b) => Number(a.grade) - Number(b.grade))
                  .map((g, i) => (
                  <div key={i} style={{ ...styles.gradeTile, background: '#fff8f0' }}>
                    <div style={styles.gradeTileLabel}>Grade {g.grade} <span style={{ fontSize: 9, color: '#777' }}>pooled</span></div>
                    <div style={styles.gradeTileValue}>{fmt(g.price, g.currency)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <div style={styles.attribution}>
        TCG id <code>{snapshot.tcg_card_id}</code> · printing <code>{snapshot.tcg_printing_key}</code> · lang <code>{snapshot.tcg_language}</code>
      </div>
    </aside>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    marginTop: 16,
    padding: 14,
    border: '1px solid #d8e1ea',
    borderRadius: 10,
    background: '#f6faff',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
    color: '#1a1a1a',
  },
  header: { marginBottom: 10 },
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    background: '#2a56c8',
    color: '#fff',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.3,
  },
  subtitle: { fontSize: 12, color: '#555', marginTop: 6 },
  note: { fontSize: 13, color: '#555', marginTop: 10 },
  block: { marginTop: 12 },
  h3: { fontSize: 13, margin: '0 0 6px', color: '#333' },
  sourceGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 },
  sourceCard: { background: '#fff', border: '1px solid #e4e4e4', borderRadius: 6, padding: 8 },
  sourceLabel: { fontSize: 11, fontWeight: 700, color: '#444', textTransform: 'capitalize', marginBottom: 4 },
  table: { width: '100%', fontSize: 12, borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '3px 6px', fontWeight: 500, fontSize: 11 },
  tr: { borderTop: '1px solid #f0f0f0' },
  td: { padding: '3px 6px' },
  tdNum: { padding: '3px 6px', fontVariantNumeric: 'tabular-nums' },
  gradeStrip: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  gradeTile: { minWidth: 72, padding: '6px 8px', background: '#eef4ff', borderRadius: 4, textAlign: 'center' },
  gradeTileLabel: { fontSize: 10, color: '#555', fontWeight: 600, marginBottom: 2 },
  gradeTileValue: { fontSize: 13, fontVariantNumeric: 'tabular-nums' },
  pooledHeader: { fontSize: 11, color: '#555', margin: '10px 0 4px', fontWeight: 500 },
  attribution: { fontSize: 10, color: '#888', marginTop: 10, borderTop: '1px solid #e0e8f1', paddingTop: 6 },
}
