// PP-TCG-MIGRATE-02: private TCGGraph preview per card.
//
// Admin-only, noindex. Mirrors the public card-page visual language
// but reads EXCLUSIVELY from the new provider tables. The pricing
// eligibility gate is enforced (variants never show aggregate
// graded; identity_only shows no prices).
//
// This route is a renderer-only preview — zero mutation.

import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireAdminPage } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { getProviderSnapshot, type ProviderMarketPrice, type ProviderGradedPrice } from '@/lib/providerData/snapshot'
import { getProviderHistorySeries, type ProviderHistorySeries } from '@/lib/providerData/history'

export const metadata: Metadata = {
  title: 'TCGGraph card preview',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
}
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps { params: Promise<{ slug: string }> }

function fmtPrice(value: number | null | undefined, currency: string): string {
  if (value == null) return '—'
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency + ' '
  const v = Number(value)
  if (v >= 1000) return `${sym}${Math.round(v).toLocaleString('en-US')}`
  return `${sym}${v.toFixed(2)}`
}

// Simple inline SVG spark chart. ~200px wide, no deps. Each series
// gets its own line colour. Date label at ends.
function Spark({ series }: { series: ProviderHistorySeries }) {
  const w = 420, h = 90, pad = 18
  const pts = series.points
    .map(p => ({ day: p.day, v: p.market ?? p.low ?? null }))
    .filter(p => p.v != null && Number.isFinite(Number(p.v))) as Array<{ day: string, v: number }>
  if (pts.length < 2) return <div style={{ fontSize: 11, color: '#888' }}>(not enough points to chart — {pts.length})</div>
  const vals = pts.map(p => p.v)
  const min = Math.min(...vals), max = Math.max(...vals)
  const spanV = Math.max(1, max - min)
  const spanT = Math.max(1, pts.length - 1)
  const xy = (i: number, v: number) =>
    [pad + (i / spanT) * (w - pad * 2), h - pad - ((v - min) / spanV) * (h - pad * 2)]
  const d = pts.map((p, i) => {
    const [x, y] = xy(i, p.v); return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={w} height={h} role="img" aria-label="price history">
      <rect x={0} y={0} width={w} height={h} fill="#fff" stroke="#eee" />
      <path d={d} fill="none" stroke="#2a56c8" strokeWidth={1.5} />
      <text x={pad} y={h - 2} fontSize={9} fill="#666">{pts[0].day}</text>
      <text x={w - pad} y={h - 2} fontSize={9} fill="#666" textAnchor="end">{pts[pts.length - 1].day}</text>
      <text x={pad} y={10} fontSize={9} fill="#666">{fmtPrice(max, series.currency)}</text>
      <text x={pad} y={h - 24} fontSize={9} fill="#666">{fmtPrice(min, series.currency)}</text>
    </svg>
  )
}

function MarketPricesTable({ rows }: { rows: ProviderMarketPrice[] }) {
  if (rows.length === 0) return <div style={{ fontSize: 12, color: '#888' }}>no market prices for this printing</div>
  // Group by source, then by finish, then by list_type
  const bySource: Record<string, ProviderMarketPrice[]> = {}
  for (const r of rows) {
    const k = r.source
    ;(bySource[k] = bySource[k] || []).push(r)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Object.entries(bySource).map(([source, srows]) => (
        <div key={source} style={{ border: '1px solid #e8e8e8', borderRadius: 4, padding: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>{source}</div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#555', textAlign: 'left' }}>
                <th style={{ padding: '3px 6px' }}>finish</th>
                <th style={{ padding: '3px 6px' }}>list</th>
                <th style={{ padding: '3px 6px' }}>market</th>
                <th style={{ padding: '3px 6px' }}>low</th>
                <th style={{ padding: '3px 6px' }}>trend</th>
                <th style={{ padding: '3px 6px' }}>updated</th>
              </tr>
            </thead>
            <tbody>
              {srows.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '3px 6px' }}><code>{r.finish ?? '—'}</code></td>
                  <td style={{ padding: '3px 6px' }}>{r.list_type}</td>
                  <td style={{ padding: '3px 6px', fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(r.market, r.currency)}</td>
                  <td style={{ padding: '3px 6px', fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(r.low, r.currency)}</td>
                  <td style={{ padding: '3px 6px', fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(r.trend, r.currency)}</td>
                  <td style={{ padding: '3px 6px', fontSize: 11, color: '#777' }}>{r.source_updated_at ? new Date(r.source_updated_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

function GradedPricesTable({ rows }: { rows: ProviderGradedPrice[] }) {
  if (rows.length === 0) return <div style={{ fontSize: 12, color: '#888' }}>no graded prices on this card (pricing_eligibility may be market_only / identity_only, which deliberately suppresses graded)</div>
  // Keep per-grader grade-10 separate from pooled 7/8/9/9.5. Pooled rows (grader='any') must be labelled honestly.
  const ten = rows.filter(r => r.grade === '10')
  const pooled = rows.filter(r => r.grader === 'any')
  const raw = rows.filter(r => r.grader === 'raw')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {raw.length > 0 && (
        <div style={{ fontSize: 13 }}>
          <strong>Raw ungraded:</strong> {fmtPrice(raw[0]?.price, raw[0]?.currency ?? 'USD')}
          {' '}<span style={{ fontSize: 11, color: '#777' }}>({raw[0]?.sales_volume ?? 0} sales in last year)</span>
        </div>
      )}
      {ten.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Grade 10 (per grader)</div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#555', textAlign: 'left' }}>
                <th style={{ padding: '3px 6px' }}>grader</th>
                <th style={{ padding: '3px 6px' }}>price</th>
                <th style={{ padding: '3px 6px' }}>updated</th>
              </tr>
            </thead>
            <tbody>
              {ten.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '3px 6px' }}><code>{r.grader.toUpperCase()}</code></td>
                  <td style={{ padding: '3px 6px', fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(r.price, r.currency)}</td>
                  <td style={{ padding: '3px 6px', fontSize: 11, color: '#777' }}>{r.source_updated_at ? new Date(r.source_updated_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pooled.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Grade 7 / 8 / 9 / 9.5 (pooled across graders — <em>not PSA-specific</em>)</div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#555', textAlign: 'left' }}>
                <th style={{ padding: '3px 6px' }}>grade</th>
                <th style={{ padding: '3px 6px' }}>price (pooled)</th>
                <th style={{ padding: '3px 6px' }}>updated</th>
              </tr>
            </thead>
            <tbody>
              {pooled.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '3px 6px' }}>{r.grade}</td>
                  <td style={{ padding: '3px 6px', fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(r.price, r.currency)}</td>
                  <td style={{ padding: '3px 6px', fontSize: 11, color: '#777' }}>{r.source_updated_at ? new Date(r.source_updated_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default async function TcgPreviewCard({ params }: PageProps) {
  await requireAdminPage('/admin/tcg-preview')
  const { slug } = await params
  const decoded = decodeURIComponent(slug)
  const sb = getSupabaseServiceClient()

  // Fetch PP card metadata + the new provider snapshot in parallel
  const [ppRes, snap] = await Promise.all([
    sb.from('cards').select('card_slug, card_name, set_name, card_number, language, card_url_slug, image_url, set_release_date').eq('card_slug', decoded).maybeSingle(),
    getProviderSnapshot(sb, decoded, { previewMode: true }),
  ])
  const pp = ppRes.data as { card_slug: string; card_name: string; set_name: string | null; card_number: string | null; language: string; card_url_slug: string | null; image_url: string | null; set_release_date: string | null } | null
  if (!pp) notFound()

  // Also fetch legacy prices for side-by-side comparison
  const trendRes = await sb.from('card_trends').select('current_raw, current_psa10, current_psa9, as_of').eq('card_slug', decoded).maybeSingle()
  const trend = trendRes.data as { current_raw: number | null; current_psa10: number | null; current_psa9: number | null; as_of: string | null } | null

  // History (only if snapshot exists)
  let historySeries: ProviderHistorySeries[] = []
  if (snap?.tcg_card_id && snap?.tcg_printing_key) {
    historySeries = await getProviderHistorySeries(sb, snap.tcg_card_id, snap.tcg_printing_key, { ignoreFlag: true })
  }

  const publicUrl = pp.card_url_slug && pp.set_name
    ? `https://www.pokeprices.io/set/${encodeURIComponent(pp.set_name)}/card/${encodeURIComponent(pp.card_url_slug)}`
    : null

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1100, margin: '0 auto', color: '#1a1a1a' }}>
      <div style={{ marginBottom: 10 }}>
        <Link href="/admin/tcg-preview" style={{ fontSize: 12, color: '#666' }}>← Back to preview index</Link>
      </div>

      <header style={{ borderBottom: '1px solid #e0e0e0', paddingBottom: 10, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{pp.card_name}</h1>
        <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
          {pp.set_name} · #{pp.card_number} · language <code>{pp.language}</code>
          {publicUrl && <> · <a href={publicUrl} target="_blank" rel="noreferrer">live page ↗</a></>}
          {snap?.pricing_eligibility && (
            <> · pricing_eligibility <code style={{ background: '#f1f8f1', padding: '0 4px' }}>{snap.pricing_eligibility}</code></>
          )}
        </div>
      </header>

      {!snap ? (
        <div style={{ padding: 16, border: '1px solid #e5c0c0', background: '#fdf1f1', borderRadius: 4, fontSize: 13 }}>
          <strong>No provider snapshot for this card.</strong> Either the mapping is unmatched or the TCGGraph identity is not yet verified. This is the honest absent-field state — the public page would continue to show legacy PriceCharting data (unchanged by this preview).
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) 2fr', gap: 20 }}>
          {/* LEFT: image + identity */}
          <aside>
            {snap.image_normal ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={snap.image_normal} alt="" style={{ width: '100%', borderRadius: 6, border: '1px solid #e0e0e0' }} />
            ) : pp.image_url ? (
              <div>
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={pp.image_url} alt="" style={{ width: '100%', borderRadius: 6, border: '1px solid #e0e0e0', opacity: 0.6 }} />
                <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                  (legacy image — provider image withheld by pricing_eligibility gate)
                </div>
              </div>
            ) : (
              <div style={{ padding: 40, textAlign: 'center', background: '#f6f8fa', border: '1px dashed #ccc', borderRadius: 6, fontSize: 12, color: '#888' }}>no image available</div>
            )}
            <div style={{ fontSize: 11, color: '#777', marginTop: 8, lineHeight: 1.5 }}>
              <div>TCG id: <code>{snap.tcg_card_id}</code></div>
              <div>printing_key: <code>{snap.tcg_printing_key}</code></div>
              <div>set: <code>{snap.tcg_set_code}</code> · lang <code>{snap.tcg_language}</code></div>
              {snap.image_source && <div>image_source: <code>{snap.image_source}</code></div>}
            </div>
          </aside>

          {/* RIGHT: prices + history */}
          <section>
            <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>Marketplace prices</h2>
            <MarketPricesTable rows={snap.market_prices} />

            <h2 style={{ fontSize: 15, margin: '20px 0 10px' }}>Graded values</h2>
            <GradedPricesTable rows={snap.graded_prices} />

            <h2 style={{ fontSize: 15, margin: '20px 0 10px' }}>History</h2>
            {historySeries.length === 0 ? (
              <div style={{ fontSize: 12, color: '#888' }}>
                No TCGGraph historical series ingested for this card yet. The chart would render as "History unavailable" to users rather than fabricating points.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {historySeries.map((s, i) => (
                  <div key={i} style={{ border: '1px solid #e8e8e8', borderRadius: 4, padding: 10 }}>
                    <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>
                      <strong>{s.kind}</strong> ·{' '}
                      {s.kind === 'market'
                        ? <>source=<code>{s.source}</code> · finish=<code>{s.finish ?? '—'}</code></>
                        : <>grader=<code>{s.grader}</code> · grade=<code>{s.grade}</code></>}
                      {' '}· currency={s.currency} · {s.points.length} points
                    </div>
                    <Spark series={s} />
                  </div>
                ))}
              </div>
            )}

            <h2 style={{ fontSize: 15, margin: '20px 0 10px' }}>Legacy prices (for reference — current PP display)</h2>
            {trend ? (
              <div style={{ fontSize: 13, padding: 10, background: '#fafafa', border: '1px solid #eee', borderRadius: 4 }}>
                <div>raw: {fmtPrice(trend.current_raw != null ? trend.current_raw / 100 : null, 'USD')}</div>
                <div>PSA 10: {fmtPrice(trend.current_psa10 != null ? trend.current_psa10 / 100 : null, 'USD')}</div>
                <div>PSA 9: {fmtPrice(trend.current_psa9 != null ? trend.current_psa9 / 100 : null, 'USD')}</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>as of {trend.as_of ?? '—'} · PriceCharting-derived</div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#888' }}>no card_trends row</div>
            )}
          </section>
        </div>
      )}
    </main>
  )
}
