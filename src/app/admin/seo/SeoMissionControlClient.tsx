'use client'

// src/app/admin/seo/SeoMissionControlClient.tsx
// ============================================================================
// SEO Mission Control Scoreboard — client component.
//
// Every number rendered here comes from the MissionControlPayload the
// server loader assembled from the six SEO tables. This file does not
// fetch, compute, or fabricate anything on the client. It is the
// presentation layer only.
//
// Chart library: recharts (already installed for other admin pages).
// ============================================================================

import { useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from 'recharts'
import type {
  MissionControlPayload, PageTypeRow, TopPageRow, DailyPoint,
} from '@/lib/seo/admin/types'

// ─── formatting helpers ─────────────────────────────────────────────────
const nf = new Intl.NumberFormat('en-GB')
const int = (v: number | null | undefined) => v == null ? '—' : nf.format(Math.round(v))
const pct = (v: number | null | undefined, digits = 2) =>
  v == null ? '—' : `${(v * 100).toFixed(digits)}%`
const pctPoints = (v: number | null | undefined, digits = 2) =>
  v == null ? '—' : `${(v * 100 >= 0 ? '+' : '')}${(v * 100).toFixed(digits)}pp`
const pos = (v: number | null | undefined) => v == null ? '—' : v.toFixed(2)
const signed = (v: number | null | undefined, digits = 1) =>
  v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(digits) + '%'
const shortDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
const shortDateTime = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Momentum arrow — up-good vs down-good depends on the metric. */
function directionColor(pctChange: number | null | undefined, higherIsBetter = true): string {
  if (pctChange == null) return 'var(--text-muted)'
  const better = higherIsBetter ? pctChange > 0 : pctChange < 0
  const neutral = Math.abs(pctChange) < 0.01
  if (neutral) return 'var(--text-muted)'
  return better ? '#15803d' : '#b91c1c'
}
function positionDeltaColor(delta: number | null | undefined): string {
  if (delta == null) return 'var(--text-muted)'
  // For position, LOWER is better. Negative delta = improvement.
  if (Math.abs(delta) < 0.01) return 'var(--text-muted)'
  return delta < 0 ? '#15803d' : '#b91c1c'
}

// ─── layout primitives ──────────────────────────────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: '20px 20px 24px', maxWidth: 1400, margin: '0 auto' }}>
      <h2 style={{
        fontFamily: "'Outfit', sans-serif", fontSize: 18, fontWeight: 800,
        margin: '0 0 4px', letterSpacing: -0.2,
      }}>{title}</h2>
      {subtitle ? <p style={{ color: 'var(--text-muted)', fontSize: 12.5, margin: '0 0 12px' }}>{subtitle}</p> : null}
      {children}
    </section>
  )
}

function CardShell({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: 14, ...style,
    }}>{children}</div>
  )
}

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <CardShell>
      <div style={{
        fontSize: 10, fontWeight: 900, letterSpacing: 1.3,
        textTransform: 'uppercase', color: 'var(--text-muted)',
      }}>{label}</div>
      <div style={{
        fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginTop: 4,
        color: color ?? 'var(--text)', fontFeatureSettings: '"tnum"',
      }}>{value}</div>
      {sub ? <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>{sub}</div> : null}
    </CardShell>
  )
}

function DeltaChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'baseline', gap: 6,
      padding: '3px 10px', borderRadius: 20,
      background: 'var(--bg-light)', border: '1px solid var(--border)',
      fontSize: 12,
    }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <strong style={{ color: color ?? 'var(--text)', fontFeatureSettings: '"tnum"' }}>{value}</strong>
    </span>
  )
}

// ─── section: mission header ───────────────────────────────────────────

function MissionHeader({ payload }: { payload: MissionControlPayload }) {
  const runRate28 = payload.kpi.clicks_28d / 28
  const runRate7  = payload.momentum?.current.days ? payload.momentum.current.clicks / payload.momentum.current.days : null
  const progressMin = payload.target_clicks_per_day_min > 0 ? runRate28 / payload.target_clicks_per_day_min * 100 : 0
  const progressMax = payload.target_clicks_per_day_max > 0 ? runRate28 / payload.target_clicks_per_day_max * 100 : 0
  return (
    <header style={{
      padding: '22px 20px 12px', maxWidth: 1400, margin: '0 auto',
    }}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start',
        gap: 20, justifyContent: 'space-between',
      }}>
        <div>
          <div style={{
            fontSize: 11, fontWeight: 900, letterSpacing: 1.6,
            textTransform: 'uppercase', color: 'var(--primary)',
          }}>SEO Mission Control</div>
          <h1 style={{
            fontSize: 30, fontWeight: 800, margin: '4px 0 2px',
            fontFamily: "'Outfit', sans-serif", letterSpacing: -0.5,
          }}>
            {payload.target_clicks_per_day_min.toLocaleString()}–{payload.target_clicks_per_day_max.toLocaleString()} organic clicks/day
          </h1>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Target: <strong style={{ color: 'var(--text)' }}>{shortDate(payload.target_date)}</strong>
            {'  ·  '}
            <strong style={{ color: 'var(--text)' }}>{payload.days_to_target}</strong> days remaining
          </div>
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10, flex: '1 1 480px',
        }}>
          <KpiCard label="Latest data (Google)" value={shortDate(payload.latest_gsc_date ?? payload.as_of_date)}
                   sub={payload.latest_gsc_date && payload.latest_gsc_date !== payload.as_of_date
                     ? `KPI snapshot: ${shortDate(payload.as_of_date)}` : `KPI snapshot`} />
          <KpiCard label="Current 28d run rate" value={`${int(runRate28)} /day`}
                   sub={`= ${int(payload.kpi.clicks_28d)} clicks / 28 days`} />
          <KpiCard label="Current 7d run rate"  value={runRate7 != null ? `${int(runRate7)} /day` : '—'}
                   sub={payload.momentum ? `= ${int(payload.momentum.current.clicks)} / ${payload.momentum.current.days}d` : ''} />
          <KpiCard label="Progress to target"
                   value={`${progressMax.toFixed(1)}–${progressMin.toFixed(1)}%`}
                   sub={`vs ${payload.target_clicks_per_day_min}–${payload.target_clicks_per_day_max} /day`} />
        </div>
      </div>
    </header>
  )
}

// ─── section: primary KPI cards ────────────────────────────────────────

function KpiScoreboard({ payload }: { payload: MissionControlPayload }) {
  const k = payload.kpi
  const m = payload.momentum
  const productiveShare = k.total_urls_known > 0 ? k.pages_ge28_click_28d / k.total_urls_known : 0
  const visibleShareOfKnown = k.total_urls_known > 0 ? k.pages_with_impressions_28d / k.total_urls_known : 0
  const visibleShareOfSitemap = k.urls_in_sitemap > 0 ? k.pages_with_impressions_28d / k.urls_in_sitemap : 0

  return (
    <Section title="Scoreboard" subtitle="Live numbers from seo_kpi_daily · seo_page_rollups · seo_pages.">
      <div style={{
        display: 'grid', gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      }}>
        <KpiCard label="Clicks · 7d"
                 value={int(m?.current.clicks ?? null)}
                 sub={m ? `28d: ${int(k.clicks_28d)} · rate ${int((k.clicks_28d ?? 0) / 28)}/day` : ''} />
        <KpiCard label="Impressions · 7d"
                 value={int(m?.current.impressions ?? null)}
                 sub={`28d: ${int(k.impressions_28d)}`} />
        <KpiCard label="CTR · 7d"
                 value={pct(m?.current.ctr ?? null)}
                 sub={`28d: ${pct(k.ctr_28d)}`} />
        <KpiCard label="Avg position · 7d"
                 value={pos(m?.current.avg_position ?? null)}
                 sub={`28d: ${pos(k.avg_position_28d)}    (lower is better)`} />
        <KpiCard label="Productive pages (≥28 clicks 28d)"
                 value={int(k.pages_ge28_click_28d)}
                 sub={`${(productiveShare * 100).toFixed(3)}% of ${int(k.total_urls_known)} known URLs`} />
        <KpiCard label="Visible pages (impressions 28d)"
                 value={int(k.pages_with_impressions_28d)}
                 sub={`${(visibleShareOfKnown * 100).toFixed(1)}% of known · ${(visibleShareOfSitemap * 100).toFixed(1)}% of sitemap`} />
        <KpiCard label="Clicking pages"
                 value={int(k.pages_ge1_click_28d)}
                 sub={`≥10 clicks: ${int(k.pages_ge10_click_28d)} · ≥28 clicks: ${int(k.pages_ge28_click_28d)}`} />
        <KpiCard label="Catalogue coverage"
                 value={int(k.total_urls_known)}
                 sub={`Sitemap: ${int(k.urls_in_sitemap)} · Cards confirmed indexable: ${int(k.urls_indexable)}`} />
      </div>
    </Section>
  )
}

// ─── section: funnel ──────────────────────────────────────────────────

function Funnel({ payload }: { payload: MissionControlPayload }) {
  const f = payload.funnel
  const stages = [
    { label: 'Known URLs',            value: f.known,            base: f.known },
    { label: 'In sitemap',            value: f.in_sitemap,       base: f.known },
    { label: 'Visible in Google (28d impressions)', value: f.visible_28d,    base: f.in_sitemap },
    { label: 'Got ≥1 click (28d)',    value: f.clicks_ge1_28d,   base: f.visible_28d },
    { label: 'Got ≥10 clicks (28d)',  value: f.clicks_ge10_28d,  base: f.clicks_ge1_28d },
    { label: 'Productive (≥28 clicks 28d)', value: f.clicks_ge28_28d, base: f.clicks_ge10_28d },
  ]
  const globalMax = stages[0].value || 1
  return (
    <Section title="Discovery → visibility → productivity funnel"
             subtitle="Every stage read from live DB values. Percentages are conversion from the previous stage.">
      <div style={{ display: 'grid', gap: 8 }}>
        {stages.map((s, i) => {
          const share = globalMax > 0 ? s.value / globalMax : 0
          const stepPct = i === 0 ? null : (s.base > 0 ? s.value / s.base : null)
          return (
            <div key={s.label} style={{
              display: 'grid', gap: 8,
              gridTemplateColumns: 'minmax(260px, 1fr) minmax(120px, 130px) minmax(90px, 100px)',
              alignItems: 'center',
              background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '8px 12px',
            }}>
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'relative', height: 18, borderRadius: 4, background: 'var(--bg-light)', overflow: 'hidden' }}>
                  <div style={{
                    position: 'absolute', inset: 0,
                    width: `${Math.max(0, Math.min(100, share * 100))}%`,
                    background: i === 0 ? 'var(--primary)'
                              : i === stages.length - 1 ? '#15803d' : '#2563eb',
                    opacity: 0.85,
                  }} />
                  <div style={{
                    position: 'absolute', inset: 0, padding: '0 10px',
                    display: 'flex', alignItems: 'center',
                    fontSize: 12, fontWeight: 800, color: 'var(--text)',
                    letterSpacing: -0.2,
                    mixBlendMode: 'multiply',
                  }}>{s.label}</div>
                </div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 900, fontFeatureSettings: '"tnum"' }}>{int(s.value)}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFeatureSettings: '"tnum"' }}>
                {stepPct == null ? '—' : `${(stepPct * 100).toFixed(2)}%`}
                {stepPct != null ? <span style={{ opacity: 0.7 }}> from prev</span> : null}
              </div>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

// ─── section: daily trend chart ────────────────────────────────────────

function DailyTrend({ payload }: { payload: MissionControlPayload }) {
  const [metric, setMetric] = useState<'clicks' | 'impressions'>('clicks')
  const data = useMemo(() => payload.daily.map(d => ({
    date: d.date,
    clicks: d.clicks,
    impressions: d.impressions,
  })), [payload.daily])

  const first = data[0]?.date
  const last  = data[data.length - 1]?.date
  const yLabel = metric === 'clicks' ? 'Clicks' : 'Impressions'
  const stroke = metric === 'clicks' ? '#2563eb' : '#a855f7'

  return (
    <Section title="Daily trend" subtitle={
      data.length === 0
        ? 'No seo_gsc_page_daily rows found.'
        : `${first} → ${last} · aggregated from seo_gsc_page_daily.`
    }>
      <CardShell>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, marginBottom: 10, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 999, background: 'var(--bg-light)' }}>
            {(['clicks', 'impressions'] as const).map(m => (
              <button key={m} onClick={() => setMetric(m)} style={{
                padding: '6px 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 800,
                background: metric === m ? 'var(--primary)' : 'transparent',
                color: metric === m ? '#fff' : 'var(--text)',
              }}>{m === 'clicks' ? 'Clicks' : 'Impressions'}</button>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Marker at <strong style={{ color: 'var(--text)' }}>{payload.bq_export_started_on}</strong>: BigQuery bulk export begins
          </div>
        </div>
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }}
                     tickFormatter={(v) => v.slice(5)}
                     minTickGap={20} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => nf.format(v)} />
              <Tooltip
                labelFormatter={(v) => shortDate(v as string)}
                formatter={(v: number) => [nf.format(v), yLabel]}
                contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              />
              <ReferenceLine x={payload.bq_export_started_on}
                             stroke="var(--text-muted)" strokeDasharray="3 3"
                             label={{ value: 'BQ export starts', position: 'insideTopRight', fontSize: 10, fill: 'var(--text-muted)' }} />
              <Line type="monotone" dataKey={metric} stroke={stroke} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardShell>
    </Section>
  )
}

// ─── section: momentum (7d vs prev 7d) ─────────────────────────────────

function Momentum({ payload }: { payload: MissionControlPayload }) {
  const m = payload.momentum
  if (!m) return null
  const cur = m.current, prev = m.previous
  return (
    <Section title="7d vs previous 7d"
             subtitle={`Current window: ${cur.from} → ${cur.to}    ·    Previous window: ${prev.from} → ${prev.to}`}>
      <div style={{
        display: 'grid', gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      }}>
        <KpiCard label="Clicks"
                 value={int(cur.clicks)}
                 color={directionColor(m.click_pct_change, true)}
                 sub={`vs ${int(prev.clicks)} — ${m.click_pct_change == null ? '—' : signed(m.click_pct_change)}`} />
        <KpiCard label="Impressions"
                 value={int(cur.impressions)}
                 color={directionColor(m.impression_pct_change, true)}
                 sub={`vs ${int(prev.impressions)} — ${m.impression_pct_change == null ? '—' : signed(m.impression_pct_change)}`} />
        <KpiCard label="CTR"
                 value={pct(cur.ctr)}
                 color={directionColor(m.ctr_delta == null ? null : m.ctr_delta * 100, true)}
                 sub={`vs ${pct(prev.ctr)} — ${pctPoints(m.ctr_delta)}`} />
        <KpiCard label="Avg position   (lower = better)"
                 value={pos(cur.avg_position)}
                 color={positionDeltaColor(m.avg_position_delta)}
                 sub={m.avg_position_delta == null
                    ? `vs ${pos(prev.avg_position)}`
                    : `vs ${pos(prev.avg_position)} — ${(m.avg_position_delta > 0 ? '+' : '') + m.avg_position_delta.toFixed(2)}`} />
      </div>
    </Section>
  )
}

// ─── section: page-type breakdown ──────────────────────────────────────

function PageTypeBreakdown({ rows, reconciliation }: { rows: PageTypeRow[]; reconciliation: MissionControlPayload['reconciliation'] }) {
  // Suppress page types with 0 known AND 0 clicks AND 0 impressions —
  // they add noise. The `unmatched` bucket is always shown when it
  // has any rollup activity so no data is silently hidden.
  const shown = rows.filter(r => r.urls_known > 0 || r.clicks_28d > 0 || r.impressions_28d > 0)
  const totals = shown.reduce((acc, r) => ({
    urls_known: acc.urls_known + r.urls_known,
    visible: acc.visible + r.urls_visible_28d,
    clicks: acc.clicks + r.clicks_28d,
    impressions: acc.impressions + r.impressions_28d,
    productive: acc.productive + r.productive_28d,
  }), { urls_known: 0, visible: 0, clicks: 0, impressions: 0, productive: 0 })
  const inv = reconciliation.invariants
  const allInvariantsPass =
    inv.clicks_match_rollup && inv.impressions_match_rollup &&
    inv.visible_match_rollup && inv.productive_match_rollup
  return (
    <Section title="Page-type performance · 28 days"
             subtitle="Rollups (canonicalised, deduped) joined with seo_pages.page_type. Sorted by 28d clicks. The `unmatched` bucket carries rollup rows whose canonical URL has no registry row.">
      <CardShell style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-light)' }}>
              <Th>Page type</Th>
              <Th right>Known URLs</Th>
              <Th right>Visible 28d</Th>
              <Th right>Clicks 28d</Th>
              <Th right>Impressions 28d</Th>
              <Th right>CTR</Th>
              <Th right>Avg pos</Th>
              <Th right>Productive</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.page_type} style={{
                borderTop: '1px solid var(--border)',
                background: r.page_type === 'unmatched' ? '#fff8e1' : undefined,
              }}>
                <Td>
                  {r.page_type === 'unmatched'
                    ? <span style={{ color: '#8a6d1a', fontWeight: 800 }}>unmatched</span>
                    : r.page_type}
                </Td>
                <Td right>{int(r.urls_known)}</Td>
                <Td right>{int(r.urls_visible_28d)}</Td>
                <Td right>{int(r.clicks_28d)}</Td>
                <Td right>{int(r.impressions_28d)}</Td>
                <Td right>{pct(r.ctr_28d)}</Td>
                <Td right>{pos(r.avg_position_28d)}</Td>
                <Td right>{int(r.productive_28d)}</Td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-light)' }}>
              <Td><strong>Totals (displayed rows)</strong></Td>
              <Td right><strong>{int(totals.urls_known)}</strong></Td>
              <Td right><strong>{int(totals.visible)}</strong></Td>
              <Td right><strong>{int(totals.clicks)}</strong></Td>
              <Td right><strong>{int(totals.impressions)}</strong></Td>
              <Td right>{totals.impressions > 0 ? pct(totals.clicks / totals.impressions) : '—'}</Td>
              <Td right>—</Td>
              <Td right><strong>{int(totals.productive)}</strong></Td>
            </tr>
          </tbody>
        </table>
      </CardShell>
      <div style={{
        marginTop: 10, padding: '10px 12px', borderRadius: 10,
        background: allInvariantsPass ? '#f0fdf4' : '#fef2f2',
        border: `1px solid ${allInvariantsPass ? '#bbf7d0' : '#fecaca'}`,
        fontSize: 12.5, lineHeight: 1.55,
      }}>
        <strong style={{ color: allInvariantsPass ? '#15803d' : '#b91c1c' }}>
          {allInvariantsPass
            ? 'Reconciliation OK — page-type sums equal the canonical-deduped rollup totals exactly.'
            : 'Reconciliation FAILURE — page-type sums do not equal canonical-deduped rollup totals. Table is incomplete.'}
        </strong>
        <div style={{ color: 'var(--text-muted)', marginTop: 4, display: 'grid', gap: 2 }}>
          <span>Σ page_types.clicks_28d      = {int(totals.clicks)}      vs rollup {int(reconciliation.rollup_clicks_28d)}      {inv.clicks_match_rollup ? '✓' : '✗'}</span>
          <span>Σ page_types.impressions_28d = {int(totals.impressions)} vs rollup {int(reconciliation.rollup_impressions_28d)} {inv.impressions_match_rollup ? '✓' : '✗'}</span>
          <span>Σ page_types.urls_visible_28d = {int(totals.visible)}     vs rollup {int(reconciliation.rollup_visible_28d)}     {inv.visible_match_rollup ? '✓' : '✗'}</span>
          <span>Σ page_types.productive_28d  = {int(totals.productive)}  vs rollup {int(reconciliation.rollup_productive_28d)}  {inv.productive_match_rollup ? '✓' : '✗'}</span>
        </div>
      </div>
    </Section>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th style={{
      padding: '10px 12px', fontSize: 10.5, fontWeight: 800,
      textTransform: 'uppercase', letterSpacing: 0.8,
      color: 'var(--text-muted)', textAlign: right ? 'right' : 'left',
      whiteSpace: 'nowrap',
    }}>{children}</th>
  )
}
function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <td style={{
      padding: '9px 12px', fontFeatureSettings: '"tnum"',
      textAlign: right ? 'right' : 'left',
      whiteSpace: 'nowrap',
    }}>{children}</td>
  )
}

// ─── section: visibility gap ───────────────────────────────────────────

function VisibilityGap({ payload }: { payload: MissionControlPayload }) {
  const v = payload.visibility
  const total = payload.kpi.total_urls_known
  return (
    <Section title="Visibility gap · catalogue coverage"
             subtitle="How much of the catalogue Google is actually rendering. Zeroes point to the expansion opportunity.">
      <div style={{
        display: 'grid', gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      }}>
        <KpiCard label="Known URLs with zero 28d visibility"
                 value={int(v.known_zero_visibility)}
                 sub={total > 0 ? `${(v.known_zero_visibility / total * 100).toFixed(1)}% of all known URLs` : ''} />
        <KpiCard label="Sitemap URLs with zero 28d visibility"
                 value={int(v.sitemap_zero_visibility)}
                 sub={payload.kpi.urls_in_sitemap > 0
                   ? `${(v.sitemap_zero_visibility / payload.kpi.urls_in_sitemap * 100).toFixed(1)}% of sitemap URLs`
                   : ''} />
        <KpiCard label="Visible but zero clicks (28d)"
                 value={int(v.visible_no_clicks)}
                 sub="Impressions but no engagement — CTR opportunity" />
        <KpiCard label="Clicking pages (≥1 click 28d)"
                 value={int(v.visible_ge1_click)}
                 sub={`Productive (≥28 clicks): ${int(v.visible_productive)}`} />
      </div>
    </Section>
  )
}

// ─── section: top pages ────────────────────────────────────────────────

function TopPages({ rows }: { rows: TopPageRow[] }) {
  return (
    <Section title="Top pages · 28 days"
             subtitle="Top 20 URLs by 28-day clicks. URLs open the live page in a new tab.">
      <CardShell style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-light)' }}>
              <Th>URL</Th>
              <Th>Page type</Th>
              <Th right>Clicks 28d</Th>
              <Th right>Impressions 28d</Th>
              <Th right>CTR</Th>
              <Th right>Avg pos</Th>
              <Th right>Productive</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const folded = r.raw_urls.length > 1
              return (
                <tr key={r.url} style={{ borderTop: '1px solid var(--border)' }}>
                  <Td>
                    <a href={r.url} target="_blank" rel="noopener noreferrer"
                       style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>
                      {r.url.replace('https://www.pokeprices.io', '') || '/'}
                    </a>
                    {folded ? (
                      <span title={r.raw_urls.join('\n')} style={{
                        marginLeft: 6, fontSize: 10, padding: '1px 6px',
                        borderRadius: 999, background: 'var(--bg-light)',
                        color: 'var(--text-muted)', border: '1px solid var(--border)',
                      }}>+{r.raw_urls.length - 1} variant{r.raw_urls.length > 2 ? 's' : ''}</span>
                    ) : null}
                  </Td>
                  <Td>
                    {r.page_type === 'unmatched'
                      ? <span style={{ color: '#8a6d1a', fontWeight: 700 }}>unmatched</span>
                      : r.page_type}
                  </Td>
                  <Td right>{int(r.clicks_28d)}</Td>
                  <Td right>{int(r.impressions_28d)}</Td>
                  <Td right>{pct(r.ctr_28d)}</Td>
                  <Td right>{pos(r.avg_position_28d)}</Td>
                  <Td right>{r.productive_28d ? '✓' : ''}</Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </CardShell>
    </Section>
  )
}

// ─── section: data health ──────────────────────────────────────────────

function DataHealth({ payload }: { payload: MissionControlPayload }) {
  const h = payload.data_health
  const r = payload.reconciliation
  const kpiDelta = r.kpi_vs_rollup_delta
  const kpiDrift =
    kpiDelta.clicks !== 0 || kpiDelta.impressions !== 0 ||
    kpiDelta.visible !== 0 || kpiDelta.productive !== 0
  return (
    <Section title="Data health"
             subtitle="Ingest freshness, recent failures, and rollup/KPI reconciliation. If any of these are stale or diverge, the numbers above are stale too.">
      <div style={{
        display: 'grid', gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      }}>
        <KpiCard label="Latest GSC daily date" value={shortDate(h.latest_gsc_date)}
                 sub={h.latest_gsc_date_source ? `source: ${h.latest_gsc_date_source}` : ''} />
        <KpiCard label="Latest KPI snapshot" value={shortDate(h.latest_kpi_date)}
                 sub={h.latest_kpi_refreshed_at ? `refreshed ${shortDateTime(h.latest_kpi_refreshed_at)}` : ''} />
        <KpiCard label="Latest successful ingest" value={shortDateTime(h.latest_ingest_at)}
                 sub={h.latest_ingest_kind ? `${h.latest_ingest_kind} · ${h.latest_ingest_status ?? ''}` : ''} />
        <KpiCard label="Registry"
                 value={int(h.registry_size)}
                 sub={h.registry_last_seen_max ? `last_seen ${shortDateTime(h.registry_last_seen_max)}` : ''} />
      </div>

      {/* Canonical join audit + KPI/rollup drift — surfaced here so the
          dashboard is honest about the state of its own aggregation. */}
      <div style={{ marginTop: 12 }}>
        <CardShell>
          <div style={{
            fontSize: 10, fontWeight: 900, letterSpacing: 1.3,
            textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8,
          }}>Join audit · rollup ↔ registry</div>
          <div style={{ display: 'grid', gap: 4, fontSize: 12.5, lineHeight: 1.55 }}>
            <span>Rollup rows loaded:                 <strong style={{ fontFeatureSettings: '"tnum"' }}>{int(r.rollup_rows_loaded)}</strong></span>
            <span>Canonicalisation failures (dropped host / unparseable): <strong>{int(r.rollup_rows_canonicalisation_failed)}</strong></span>
            <span>Distinct canonical URLs after dedup: <strong>{int(r.rollup_canonical_urls)}</strong>  <span style={{ color: 'var(--text-muted)' }}>({int(r.rollup_rows_loaded - r.rollup_canonical_urls)} raw variants folded)</span></span>
            <span>Canonical URLs matched to seo_pages:  <strong style={{ color: r.unmatched_pages_lookup === 0 ? '#15803d' : '#b91c1c' }}>{int(r.matched_pages_lookup)}</strong></span>
            <span>Canonical URLs unmatched (unmatched bucket): <strong style={{ color: r.unmatched_pages_lookup === 0 ? '#15803d' : '#b91c1c' }}>{int(r.unmatched_pages_lookup)}</strong>{r.unmatched_pages_lookup > 0
              ? ` — ${int(r.unmatched_visible_28d)} visible, ${int(r.unmatched_clicks_28d)} clicks, ${int(r.unmatched_impressions_28d)} impressions`
              : ''}</span>
          </div>
        </CardShell>
      </div>

      <div style={{ marginTop: 12 }}>
        <CardShell>
          <div style={{
            fontSize: 10, fontWeight: 900, letterSpacing: 1.3,
            textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8,
          }}>Rollup ↔ KPI cross-check</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
            {kpiDrift ? (
              <div style={{ color: '#b91c1c', fontWeight: 700, marginBottom: 6 }}>
                Warning: canonical-deduped rollup totals differ from the KPI row for {shortDate(h.latest_kpi_date)}.
              </div>
            ) : (
              <div style={{ color: '#15803d', fontWeight: 700, marginBottom: 6 }}>
                Rollup totals match the KPI row exactly.
              </div>
            )}
            <div style={{ color: 'var(--text-muted)', display: 'grid', gap: 2 }}>
              <span>clicks_28d       — rollup {int(r.rollup_clicks_28d)}       · KPI {int(r.kpi_clicks_28d)}       · Δ {kpiDelta.clicks >= 0 ? '+' : ''}{int(kpiDelta.clicks)}</span>
              <span>impressions_28d  — rollup {int(r.rollup_impressions_28d)}  · KPI {int(r.kpi_impressions_28d)}  · Δ {kpiDelta.impressions >= 0 ? '+' : ''}{int(kpiDelta.impressions)}</span>
              <span>pages_visible_28d — rollup {int(r.rollup_visible_28d)}     · KPI {int(r.kpi_visible_28d)}     · Δ {kpiDelta.visible >= 0 ? '+' : ''}{int(kpiDelta.visible)}</span>
              <span>pages_productive — rollup {int(r.rollup_productive_28d)}  · KPI {int(r.kpi_productive_28d)}  · Δ {kpiDelta.productive >= 0 ? '+' : ''}{int(kpiDelta.productive)}</span>
            </div>
          </div>
        </CardShell>
      </div>
      {h.recent_failures.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div style={{
            fontSize: 11, fontWeight: 800, letterSpacing: 1,
            textTransform: 'uppercase', color: '#b91c1c', marginBottom: 6,
          }}>Recent ingest failures (last 14 days)</div>
          <CardShell style={{ padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-light)' }}>
                  <Th>Started</Th>
                  <Th>Job kind</Th>
                  <Th>Source</Th>
                  <Th>Error</Th>
                </tr>
              </thead>
              <tbody>
                {h.recent_failures.map((f, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <Td>{shortDateTime(f.started_at)}</Td>
                    <Td>{f.job_kind}</Td>
                    <Td>{f.source}</Td>
                    <Td><span style={{ color: '#b91c1c' }}>{f.error ?? '—'}</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardShell>
        </div>
      ) : null}
    </Section>
  )
}

// ─── page shell ────────────────────────────────────────────────────────

export default function SeoMissionControlClient({ payload }: { payload: MissionControlPayload }) {
  return (
    <div style={{ fontFamily: "'Figtree', sans-serif", background: 'var(--bg)', minHeight: '100vh' }}>
      <MissionHeader payload={payload} />
      <KpiScoreboard payload={payload} />
      <Funnel payload={payload} />
      <DailyTrend payload={payload} />
      <Momentum payload={payload} />
      <PageTypeBreakdown rows={payload.page_types} reconciliation={payload.reconciliation} />
      <VisibilityGap payload={payload} />
      <TopPages rows={payload.top_pages} />
      <DataHealth payload={payload} />
      <div style={{
        color: 'var(--text-muted)', fontSize: 11, textAlign: 'center',
        padding: '20px 20px 40px',
      }}>
        Admin-only · noindex · every number read from seo_kpi_daily · seo_page_rollups · seo_gsc_page_daily · seo_pages · seo_bq_ingest_runs
      </div>
    </div>
  )
}
