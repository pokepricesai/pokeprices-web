'use client'
// src/components/insights/DataBlockRenderer.tsx
//
// EIC Block 8 — public renderer for every data_block variant.
//
// One React component per variant. The dispatcher validates the
// payload via the registry before rendering, so a malformed block
// degrades to a small notice rather than crashing the article.
//
// Legacy safety: this component is only invoked for blocks of shape
// `{ type: 'data_block', variant, payload }`. All existing insight
// bodies are paragraph-only and never hit this path.

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { supabase } from '@/lib/supabase'
import { validateDataBlockPayload } from '@/lib/studio/dataBlocks/registry'
import type {
  DataBlockVariant, CardIdentity,
  RankingTablePayload, RankingTableRow, RankingTableColumn,
  CardBlockPayload, CardGridPayload, SetBlockPayload,
  StatCalloutPayload, MethodologyPayload,
  PriceChartPayload, PriceChartPoint,
  RawPsaComparisonPayload,
} from '@/lib/studio/dataBlocks/types'

// ─────────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────────

export function DataBlockRenderer({ variant, payload }: { variant: string; payload: unknown }) {
  const valid = useMemo(() => {
    if (!isKnownVariant(variant)) return null
    return validateDataBlockPayload(variant, payload)
  }, [variant, payload])

  if (!isKnownVariant(variant)) return <UnknownBlock label={variant} reason="unknown variant" />
  if (!valid)                   return <UnknownBlock label={variant} reason="payload failed validation" />

  switch (variant) {
    case 'ranking_table':       return <RankingTableBlock       payload={valid as RankingTablePayload} />
    case 'card_block':          return <CardBlockView           payload={valid as CardBlockPayload} />
    case 'card_grid':           return <CardGridBlock           payload={valid as CardGridPayload} />
    case 'set_block':           return <SetBlockView            payload={valid as SetBlockPayload} />
    case 'stat_callout':        return <StatCalloutBlock        payload={valid as StatCalloutPayload} />
    case 'methodology':         return <MethodologyBlock        payload={valid as MethodologyPayload} />
    case 'price_chart':         return <PriceChartBlock         payload={valid as PriceChartPayload} />
    case 'raw_psa_comparison':  return <RawPsaComparisonBlock   payload={valid as RawPsaComparisonPayload} />
  }
}

function isKnownVariant(v: string): v is DataBlockVariant {
  return ['ranking_table','card_block','card_grid','set_block','stat_callout','methodology','price_chart','raw_psa_comparison'].includes(v)
}

function UnknownBlock({ label, reason }: { label: string; reason: string }) {
  return (
    <div style={S.errorBox}>
      <strong>Unavailable block:</strong> {label} ({reason})
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Ranking table
// ─────────────────────────────────────────────────────────────────

function RankingTableBlock({ payload }: { payload: RankingTablePayload }) {
  const { title, intro, columns, rows, source, highlightRowIndex } = payload
  const showRankCol = !columns.some(c => c.key === 'rank')
  return (
    <div style={S.section}>
      <h3 style={S.h3}>{title}</h3>
      {intro && <p style={S.intro}>{intro}</p>}
      <div style={S.tableScroll}>
        <table style={S.table}>
          <thead>
            <tr>
              {showRankCol && <th style={S.th}>#</th>}
              {columns.map(c => <th key={c.key} style={{ ...S.th, textAlign: c.align === 'right' ? 'right' : 'left' }}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={i === highlightRowIndex ? S.trHighlight : undefined}>
                {showRankCol && <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>}
                {columns.map((c, j) => <td key={c.key} style={{ ...S.td, textAlign: c.align === 'right' ? 'right' : 'left' }}>{renderRankingCell(c, row, j === 0)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {source && <div style={S.sourceLine}>Source: {source}</div>}
    </div>
  )
}

function renderRankingCell(col: RankingTableColumn, row: RankingTableRow, isFirst: boolean): React.ReactNode {
  const raw = row.cells[col.key]
  const formatted = formatCell(col.format, raw)
  // If a card identity exists AND this is the first column, wrap the
  // value in a canonical link. This is what "internal links via
  // structured components" looks like in practice.
  if (isFirst && row.card?.urlSlug && row.card?.setName) {
    const href = internalCardHref(row.card)
    if (href) {
      return <Link href={href} style={S.rowLink}>{formatted}</Link>
    }
  }
  if (col.format === 'url' && typeof raw === 'string' && raw) {
    return <Link href={`/set/${slugifySet(row.card?.setName ?? '')}/card/${String(raw)}`} style={S.rowLink}>{formatted}</Link>
  }
  return formatted
}

function formatCell(format: RankingTableColumn['format'], v: string | number | null | undefined): string {
  if (v == null || v === '') return '—'
  const n = typeof v === 'number' ? v : Number(v)
  switch (format) {
    case 'usd':        return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : String(v)
    case 'gbp':        return Number.isFinite(n) ? `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : String(v)
    case 'percent':    return Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(1)}%` : String(v)
    case 'gem_rate':   return Number.isFinite(n) ? `${n.toFixed(2)}%` : String(v)
    case 'integer':    return Number.isFinite(n) ? Math.trunc(n).toLocaleString('en-US') : String(v)
    case 'date':       return String(v)
    case 'url':        return String(v)
    case 'text':
    default:           return String(v)
  }
}

function internalCardHref(card: CardIdentity): string | null {
  if (!card.urlSlug || !card.setName) return null
  return `/set/${encodeURIComponent(card.setName)}/card/${card.urlSlug}`
}
function slugifySet(setName: string): string {
  return String(setName ?? '').replace(/^Pokemon\s+/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// ─────────────────────────────────────────────────────────────────
// Card block
// ─────────────────────────────────────────────────────────────────

function CardBlockView({ payload }: { payload: CardBlockPayload }) {
  const { card, caption, show, mode, snapshot } = payload
  const [live, setLive] = useState<{ raw?: number | null; psa9?: number | null; psa10?: number | null; asOf?: string } | null>(null)

  useEffect(() => {
    if (mode !== 'live') return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('card_latest_prices')
        .select('raw_usd, psa9_usd, psa10_usd, price_date')
        .eq('card_slug', `pc-${card.cardSlug}`)
        .maybeSingle()
      if (!cancelled && data) setLive({ raw: data.raw_usd, psa9: data.psa9_usd, psa10: data.psa10_usd, asOf: data.price_date })
    })()
    return () => { cancelled = true }
  }, [mode, card.cardSlug])

  const source: { raw?: number | null; psa9?: number | null; psa10?: number | null } =
    mode === 'snapshot'
      ? { raw: snapshot?.rawUsd ?? null, psa9: snapshot?.psa9Usd ?? null, psa10: snapshot?.psa10Usd ?? null }
      : { raw: live?.raw ?? null,        psa9: live?.psa9 ?? null,        psa10: live?.psa10 ?? null }
  const asOfLabel = mode === 'snapshot' ? snapshot?.asOf : (live?.asOf ?? 'today')
  const href = internalCardHref(card)
  return (
    <div style={S.section}>
      <div style={S.cardBlockWrap}>
        {card.imageUrl && (
          <img src={card.imageUrl} alt={card.cardName} style={S.cardBlockImg} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.cardBlockName}>
            {href ? <Link href={href} style={S.rowLink}>{card.cardName}</Link> : card.cardName}
          </div>
          {(card.setName || card.cardNumber) && (
            <div style={S.cardBlockMeta}>
              {card.setName ?? ''}{card.setName && card.cardNumber ? ' · ' : ''}{card.cardNumber ? `#${card.cardNumber}` : ''}
            </div>
          )}
          {caption && <div style={{ ...S.cardBlockMeta, marginTop: 6 }}>{caption}</div>}
          <div style={S.pricesRow}>
            {show.raw   && <PriceCell label="Raw"    cents={source?.raw ?? null} />}
            {show.psa9  && <PriceCell label="PSA 9"  cents={source?.psa9 ?? null} />}
            {show.psa10 && <PriceCell label="PSA 10" cents={source?.psa10 ?? null} />}
          </div>
          <div style={S.sourceLine}>
            {mode === 'snapshot' ? `Snapshot as of ${asOfLabel}` : `Live prices${asOfLabel ? ` — last observed ${asOfLabel}` : ''}`}
          </div>
        </div>
      </div>
    </div>
  )
}

function PriceCell({ label, cents }: { label: string; cents: number | null | undefined }) {
  const value = typeof cents === 'number' && Number.isFinite(cents) && cents > 0
    ? `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'Unavailable'
  return (
    <div style={S.priceCell}>
      <div style={S.priceCellLabel}>{label}</div>
      <div style={S.priceCellValue}>{value}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Card grid
// ─────────────────────────────────────────────────────────────────

function CardGridBlock({ payload }: { payload: CardGridPayload }) {
  return (
    <div style={S.section}>
      {payload.title && <h3 style={S.h3}>{payload.title}</h3>}
      <div style={S.gridWrap}>
        {payload.cards.map((entry, i) => {
          const href = internalCardHref(entry.card)
          const inner = (
            <>
              {entry.card.imageUrl && (
                <img src={entry.card.imageUrl} alt={entry.card.cardName} style={S.gridImg} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
              )}
              <div style={S.gridName}>{entry.card.cardName}</div>
              {(entry.card.setName || entry.card.cardNumber) && (
                <div style={S.gridMeta}>{entry.card.setName ?? ''}{entry.card.setName && entry.card.cardNumber ? ' · ' : ''}{entry.card.cardNumber ? `#${entry.card.cardNumber}` : ''}</div>
              )}
              {entry.stat && (
                <div style={S.gridStat}><strong>{entry.stat.value}</strong> <span style={S.gridStatLabel}>{entry.stat.label}</span></div>
              )}
            </>
          )
          return href
            ? <Link key={i} href={href} style={S.gridTile}>{inner}</Link>
            : <div key={i} style={S.gridTile}>{inner}</div>
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Set block
// ─────────────────────────────────────────────────────────────────

function SetBlockView({ payload }: { payload: SetBlockPayload }) {
  const { set, caption, summary, mode } = payload
  const setHref = set.urlSlug ? `/set/${set.urlSlug}` : (set.setName ? `/set/${encodeURIComponent(set.setName)}` : null)
  return (
    <div style={S.section}>
      <div style={S.setBlockWrap}>
        {set.imageUrl && <img src={set.imageUrl} alt={set.setName} style={S.setBlockImg} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />}
        <div style={{ flex: 1 }}>
          <div style={S.h3}>{setHref ? <Link href={setHref} style={S.rowLink}>{set.setName}</Link> : set.setName}</div>
          <div style={S.setBlockMeta}>
            {set.releaseDate && <span>Released {set.releaseDate}</span>}
            {set.cardCount != null && <span>· {set.cardCount} cards</span>}
          </div>
          {caption && <div style={S.setBlockMeta}>{caption}</div>}
          {summary && (
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text)' }}>
              {summary.totalCards != null   && <div>Total cards: {summary.totalCards.toLocaleString()}</div>}
              {summary.cardsOver100 != null && <div>Cards over $100: {summary.cardsOver100.toLocaleString()}</div>}
              {summary.setTotalValue != null&& <div>Set total value: ${(summary.setTotalValue / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>}
              {summary.setMedianValue != null&& <div>Median card value: ${(summary.setMedianValue / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>}
              <div style={S.sourceLine}>{mode === 'snapshot' ? `Snapshot as of ${summary.asOf}` : 'Live overview'}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Stat callout
// ─────────────────────────────────────────────────────────────────

function StatCalloutBlock({ payload }: { payload: StatCalloutPayload }) {
  return (
    <div style={S.statBox}>
      <div style={S.statValue}>{payload.value}</div>
      <div style={S.statLabel}>{payload.label}</div>
      {payload.context && <div style={S.statContext}>{payload.context}</div>}
      {(payload.asOf || payload.source) && <div style={S.sourceLine}>{payload.source ? `Source: ${payload.source}` : ''}{payload.source && payload.asOf ? ' · ' : ''}{payload.asOf ? `as of ${payload.asOf}` : ''}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Methodology
// ─────────────────────────────────────────────────────────────────

function MethodologyBlock({ payload }: { payload: MethodologyPayload }) {
  return (
    <aside style={S.methBox} aria-label={payload.title}>
      <div style={S.methTitle}>{payload.title}</div>
      <p style={S.methSummary}>{payload.summary}</p>
      {payload.bullets.length > 0 && (
        <ul style={S.methList}>{payload.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
      )}
      {payload.caveats && payload.caveats.length > 0 && (
        <>
          <div style={S.methCaveatsTitle}>Caveats</div>
          <ul style={S.methList}>{payload.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </>
      )}
      <div style={S.sourceLine}>{payload.source ? `Source: ${payload.source} · ` : ''}as of {payload.asOf}</div>
    </aside>
  )
}

// ─────────────────────────────────────────────────────────────────
// Price chart (recharts)
// ─────────────────────────────────────────────────────────────────

function PriceChartBlock({ payload }: { payload: PriceChartPayload }) {
  const [livePoints, setLivePoints] = useState<PriceChartPoint[] | null>(null)

  useEffect(() => {
    if (payload.mode !== 'live') return
    let cancelled = false
    ;(async () => {
      const days = payload.days ?? 180
      const startIso = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
      const { data } = await supabase
        .from('daily_prices')
        .select('date, raw_usd, psa9_usd, psa10_usd')
        .eq('card_slug', `pc-${payload.card.cardSlug}`)
        .gte('date', startIso)
        .order('date', { ascending: true })
        .limit(400)
      if (cancelled) return
      setLivePoints((data ?? []).map((d: any) => ({ date: d.date, raw: d.raw_usd, psa9: d.psa9_usd, psa10: d.psa10_usd })))
    })()
    return () => { cancelled = true }
  }, [payload.mode, payload.card.cardSlug, payload.days])

  const points = payload.mode === 'snapshot' ? downsample(payload.points, 180) : (livePoints ?? [])
  const hasData = points.length >= 2
  const seriesColors: Record<string, string> = { raw: '#3b82f6', psa9: '#f59e0b', psa10: '#22c55e' }
  const seriesLabels: Record<string, string> = { raw: 'Raw', psa9: 'PSA 9', psa10: 'PSA 10' }

  const data = points.map(p => ({
    date: p.date,
    ...(payload.series.includes('raw')   ? { raw:   (p.raw   ?? 0) / 100 || null } : {}),
    ...(payload.series.includes('psa9')  ? { psa9:  (p.psa9  ?? 0) / 100 || null } : {}),
    ...(payload.series.includes('psa10') ? { psa10: (p.psa10 ?? 0) / 100 || null } : {}),
  }))

  return (
    <div style={S.section}>
      {payload.title && <h3 style={S.h3}>{payload.title}</h3>}
      {hasData ? (
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted, #64748b)' }} minTickGap={40} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted, #64748b)' }} width={50} />
              <Tooltip formatter={(v: any) => (typeof v === 'number' ? `$${v.toFixed(2)}` : v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {payload.series.map(k => (
                <Line key={k} type="monotone" dataKey={k} name={seriesLabels[k]} stroke={seriesColors[k]} dot={false} connectNulls strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div style={S.chartFallback}>
          {payload.mode === 'live'
            ? 'Live chart unavailable — no daily prices for this card in the selected window.'
            : 'Chart unavailable — no snapshot points provided.'}
        </div>
      )}
      <div style={S.sourceLine}>
        {payload.card.cardName}{payload.card.setName ? ` (${payload.card.setName})` : ''} — {payload.mode === 'snapshot' ? `snapshot as of ${payload.asOf ?? '(unspecified)'}` : `live (${payload.days ?? 180}-day window)`}
      </div>
    </div>
  )
}

function downsample(points: PriceChartPoint[], target: number): PriceChartPoint[] {
  if (points.length <= target) return points
  const step = Math.ceil(points.length / target)
  const out: PriceChartPoint[] = []
  for (let i = 0; i < points.length; i += step) out.push(points[i])
  const last = points[points.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

// ─────────────────────────────────────────────────────────────────
// Raw / PSA comparison
// ─────────────────────────────────────────────────────────────────

function RawPsaComparisonBlock({ payload }: { payload: RawPsaComparisonPayload }) {
  return (
    <div style={S.section}>
      {payload.title && <h3 style={S.h3}>{payload.title}</h3>}
      <div style={S.tableScroll}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Card</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Raw</th>
              <th style={{ ...S.th, textAlign: 'right' }}>PSA 9</th>
              <th style={{ ...S.th, textAlign: 'right' }}>PSA 10</th>
              {payload.showRatios && <>
                <th style={{ ...S.th, textAlign: 'right' }}>PSA 10 / Raw</th>
                <th style={{ ...S.th, textAlign: 'right' }}>PSA 9 / Raw</th>
              </>}
              {payload.rows.some(r => r.psa10Pop != null || r.totalGraded != null) && <>
                <th style={{ ...S.th, textAlign: 'right' }}>PSA 10 pop</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Total graded</th>
              </>}
            </tr>
          </thead>
          <tbody>
            {payload.rows.map((r, i) => {
              const raw = r.rawCents, p9 = r.psa9Cents, p10 = r.psa10Cents
              const href = internalCardHref(r.card)
              return (
                <tr key={i}>
                  <td style={S.td}>{href ? <Link href={href} style={S.rowLink}>{r.card.cardName}</Link> : r.card.cardName}</td>
                  <td style={{ ...S.td, textAlign: 'right' }}>{fmtUsdMaybe(raw)}</td>
                  <td style={{ ...S.td, textAlign: 'right' }}>{fmtUsdMaybe(p9)}</td>
                  <td style={{ ...S.td, textAlign: 'right' }}>{fmtUsdMaybe(p10)}</td>
                  {payload.showRatios && <>
                    <td style={{ ...S.td, textAlign: 'right' }}>{safeRatio(p10, raw)}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{safeRatio(p9,  raw)}</td>
                  </>}
                  {payload.rows.some(rr => rr.psa10Pop != null || rr.totalGraded != null) && <>
                    <td style={{ ...S.td, textAlign: 'right' }}>{r.psa10Pop    != null ? r.psa10Pop.toLocaleString() : 'Unavailable'}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{r.totalGraded != null ? r.totalGraded.toLocaleString() : 'Unavailable'}</td>
                  </>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {(payload.source || payload.asOf) && (
        <div style={S.sourceLine}>{payload.source ? `Source: ${payload.source}` : ''}{payload.source && payload.asOf ? ' · ' : ''}{payload.asOf ? `as of ${payload.asOf}` : ''}</div>
      )}
    </div>
  )
}

function fmtUsdMaybe(cents: number | null | undefined): string {
  return (typeof cents === 'number' && Number.isFinite(cents) && cents > 0)
    ? `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'Unavailable'
}
function safeRatio(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return 'Unavailable'
  return `${(a / b).toFixed(1)}×`
}

// ─────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  section:   { margin: '20px 0 28px' },
  h3:        { fontFamily: "'Outfit', sans-serif", fontSize: 18, fontWeight: 800, margin: '0 0 8px', color: 'var(--text)' },
  intro:     { fontSize: 14, color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: 1.55 },
  tableScroll: { overflowX: 'auto', border: '1px solid var(--border, #e2e8f0)', borderRadius: 10 },
  table:     { width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: "'Figtree', sans-serif" },
  th:        { padding: '10px 12px', background: 'var(--bg-light, #f8fafc)', borderBottom: '1px solid var(--border, #e2e8f0)', color: 'var(--text)', fontWeight: 700, textAlign: 'left' },
  td:        { padding: '10px 12px', borderBottom: '1px solid var(--border-subtle, #f1f5f9)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' },
  trHighlight: { background: 'rgba(59, 130, 246, 0.08)' },
  rowLink:   { color: 'var(--primary, #0369a1)', textDecoration: 'none', fontWeight: 700 },
  sourceLine:{ fontSize: 11, color: 'var(--text-muted, #64748b)', marginTop: 8, fontFamily: "'Figtree', sans-serif" },
  errorBox:  { padding: 12, background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', borderRadius: 6, fontSize: 13, margin: '20px 0' },
  cardBlockWrap: { display: 'flex', gap: 14, padding: 14, background: 'var(--card, #fff)', border: '1px solid var(--border, #e2e8f0)', borderRadius: 12, alignItems: 'flex-start' },
  cardBlockImg:  { width: 90, height: 126, objectFit: 'contain', flexShrink: 0, background: 'var(--bg-light, #f8fafc)', borderRadius: 6 },
  cardBlockName: { fontSize: 16, fontWeight: 800, color: 'var(--text)', fontFamily: "'Outfit', sans-serif" },
  cardBlockMeta: { fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 2 },
  pricesRow: { display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  priceCell: { padding: '6px 10px', background: 'var(--bg-light, #f8fafc)', borderRadius: 6, minWidth: 90 },
  priceCellLabel: { fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' as any, color: 'var(--text-muted, #64748b)' },
  priceCellValue: { fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" },
  gridWrap:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 },
  gridTile:  { display: 'block', padding: 10, background: 'var(--card, #fff)', border: '1px solid var(--border, #e2e8f0)', borderRadius: 10, textDecoration: 'none', color: 'inherit' },
  gridImg:   { width: '100%', height: 160, objectFit: 'contain', background: 'var(--bg-light, #f8fafc)', borderRadius: 6, marginBottom: 8 },
  gridName:  { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  gridMeta:  { fontSize: 11, color: 'var(--text-muted, #64748b)', marginTop: 2 },
  gridStat:  { marginTop: 6, fontSize: 12, color: 'var(--text)' },
  gridStatLabel: { color: 'var(--text-muted, #64748b)' },
  setBlockWrap: { display: 'flex', gap: 14, padding: 14, background: 'var(--card, #fff)', border: '1px solid var(--border, #e2e8f0)', borderRadius: 12 },
  setBlockImg: { width: 84, height: 84, objectFit: 'contain', flexShrink: 0, background: 'var(--bg-light, #f8fafc)', borderRadius: 8 },
  setBlockMeta: { fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 4 },
  statBox: { margin: '20px 0 28px', padding: '18px 20px', background: 'var(--card, #fff)', border: '1px solid var(--border, #e2e8f0)', borderLeft: '4px solid var(--primary, #0369a1)', borderRadius: 10 },
  statValue: { fontSize: 34, fontWeight: 900, color: 'var(--text)', lineHeight: 1.1, fontFamily: "'Outfit', sans-serif", fontVariantNumeric: 'tabular-nums' },
  statLabel: { fontSize: 13, color: 'var(--text)', marginTop: 4, fontFamily: "'Figtree', sans-serif" },
  statContext: { fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 6 },
  methBox:   { margin: '20px 0 28px', padding: '16px 20px', background: 'var(--bg-light, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', borderRadius: 10 },
  methTitle: { fontSize: 12, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase' as any, color: 'var(--text-muted, #64748b)', marginBottom: 8 },
  methSummary: { fontSize: 14, lineHeight: 1.65, color: 'var(--text)', margin: '0 0 10px', fontFamily: "'Figtree', sans-serif" },
  methList: { fontSize: 13, lineHeight: 1.6, color: 'var(--text)', margin: '0 0 8px 20px', fontFamily: "'Figtree', sans-serif" },
  methCaveatsTitle: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as any, letterSpacing: 0.4, color: '#b45309', marginTop: 8, marginBottom: 4 },
  chartFallback: { padding: 20, fontSize: 12, color: 'var(--text-muted, #64748b)', border: '1px dashed var(--border, #e2e8f0)', borderRadius: 8, textAlign: 'center' as any },
}
