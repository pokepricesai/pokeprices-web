'use client'
// Block 5A-W-47C — unified admin dashboard.
//
// Landing page for the Insights, Content Studio, Newsletter Studio and
// Recent Sales admin tools. Nothing is rebuilt here — this is a
// summary + launcher. Each tool card links to its existing route.
//
// Auth: shares the `admin_authed` sessionStorage key with the Insights
// admin (Content Studio and Newsletter Studio are updated in this same
// block to read/write the same key). Recent Sales retains its
// env-flag + Supabase-Auth gate, since that is a genuinely different
// access model.
//
// Data loading:
//   * Every summary card is a separate independent Supabase query.
//   * One failure surfaces "Unavailable" for THAT card only; the rest
//     of the dashboard continues to work.
//   * Zero counts render as "0", not as "Unavailable" — deriveAttention
//     also distinguishes the two, so a fetch failure never triggers a
//     false alarm.

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  parseCountRange,
  formatMetric,
  UNAVAILABLE,
  deriveAttention,
  mergeActivity,
  humanTimeAgo,
  type ActivityRow,
  type MetricValue,
} from '@/lib/admin/summary'

const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'pokeprices2024'
/** W47C — shared sessionStorage key for the three password-gated
 *  admin tools. Content Studio and Newsletter Studio also read/write
 *  this key so moving between tools doesn't re-prompt. Recent Sales
 *  uses a different (env-flag + Supabase Auth) model and is not
 *  covered by this session. */
const ADMIN_SESSION_KEY = 'admin_authed'

// ── Types ─────────────────────────────────────────────────────

type Summary = {
  publishedArticles: MetricValue
  draftArticles:     MetricValue
  approvedCreators:  MetricValue
  pendingCreators:   MetricValue
  activeVendors:     MetricValue
  pendingVendors:    MetricValue
  cardsInCatalogue:  MetricValue
  contentPosts:      MetricValue
  latestPriceDate:   string | null
  latestPriceStatus: 'ok' | 'unavailable'
  latestMarketDate:  string | null
  latestMarketStatus:'ok' | 'unavailable'
}

const EMPTY_SUMMARY: Summary = {
  publishedArticles: UNAVAILABLE,
  draftArticles:     UNAVAILABLE,
  approvedCreators:  UNAVAILABLE,
  pendingCreators:   UNAVAILABLE,
  activeVendors:     UNAVAILABLE,
  pendingVendors:    UNAVAILABLE,
  cardsInCatalogue:  UNAVAILABLE,
  contentPosts:      UNAVAILABLE,
  latestPriceDate:   null,
  latestPriceStatus: 'unavailable',
  latestMarketDate:  null,
  latestMarketStatus:'unavailable',
}

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL  || ''
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// ── Data helpers (bounded queries; one failure isolated) ─────

async function countRows(table: string, filter = ''): Promise<MetricValue> {
  try {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1${filter}`
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
        Prefer: 'count=exact',
      },
    })
    if (!r.ok) return UNAVAILABLE
    const n = parseCountRange(r.headers.get('content-range'))
    return n ?? UNAVAILABLE
  } catch {
    return UNAVAILABLE
  }
}

async function latestDate(table: string): Promise<string | null> {
  try {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=date&order=date.desc&limit=1`
    const r = await fetch(url, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    })
    if (!r.ok) return null
    const rows = await r.json()
    const d = rows?.[0]?.date
    return typeof d === 'string' ? d : null
  } catch {
    return null
  }
}

async function loadActivity() {
  const zero = { insights: [], creators: [], vendors: [] }
  try {
    const [i, c, v] = await Promise.all([
      supabase.from('insights')
        .select('id, headline, slug, status, created_at')
        .order('created_at', { ascending: false })
        .limit(6),
      supabase.from('creators')
        .select('id, name, slug, status, created_at')
        .order('created_at', { ascending: false })
        .limit(6),
      supabase.from('vendors')
        .select('id, name, slug, active, created_at')
        .order('created_at', { ascending: false })
        .limit(6),
    ])
    return {
      insights: (i.data as any[]) || [],
      creators: (c.data as any[]) || [],
      vendors:  (v.data as any[]) || [],
    }
  } catch {
    return zero
  }
}

// ── Login gate — shared session key ──────────────────────────

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [pw, setPw]   = useState('')
  const [err, setErr] = useState(false)
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pw === ADMIN_PASSWORD) {
      try { sessionStorage.setItem(ADMIN_SESSION_KEY, '1') } catch {}
      onLogin()
    } else {
      setErr(true); setPw('')
    }
  }
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '36px 44px', width: 360, textAlign: 'center' }}>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 6px', color: 'var(--text)' }}>PokePrices Admin</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 24px' }}>Central control panel</p>
        <form onSubmit={submit}>
          <input
            type="password"
            value={pw}
            onChange={e => { setPw(e.target.value); setErr(false) }}
            placeholder="Password"
            autoFocus
            style={{ width: '100%', padding: '11px 14px', fontSize: 14, borderRadius: 10, border: `1px solid ${err ? '#ef4444' : 'var(--border)'}`, background: 'var(--bg-light)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box', marginBottom: 12 }}
          />
          {err && <p style={{ fontSize: 12, color: '#ef4444', margin: '0 0 12px' }}>Incorrect password</p>}
          <button type="submit" style={{ width: '100%', padding: '11px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
            Enter
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Main dashboard ───────────────────────────────────────────

export type AdminDashboardClientProps = {
  /** Server-passed availability of the /admin/recent-sales tool.
   *  When false, the tool card renders a disabled "Not enabled in
   *  this environment" state and does NOT link to a known-404 route. */
  recentSalesAvailable: boolean
}

export default function AdminDashboardClient({ recentSalesAvailable }: AdminDashboardClientProps) {
  const [authed, setAuthed] = useState(false)
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY)
  const [activity, setActivity] = useState<ActivityRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem(ADMIN_SESSION_KEY) === '1') setAuthed(true)
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [
      publishedArticles, draftArticles,
      approvedCreators, pendingCreators,
      activeVendors, pendingVendors,
      cardsInCatalogue, contentPosts,
      latestPriceDate, latestMarketDate,
      activityInputs,
    ] = await Promise.all([
      countRows('insights',             '&status=eq.published'),
      countRows('insights',             '&status=eq.draft'),
      countRows('creators',             '&status=eq.approved'),
      countRows('creators',             '&status=eq.pending'),
      countRows('vendors',              '&active=eq.true'),
      countRows('vendors',              '&active=eq.false'),
      countRows('cards'),
      countRows('social_content_posts'),
      latestDate('daily_prices'),
      latestDate('market_index'),
      loadActivity(),
    ])
    setSummary({
      publishedArticles, draftArticles,
      approvedCreators, pendingCreators,
      activeVendors, pendingVendors,
      cardsInCatalogue, contentPosts,
      latestPriceDate,
      latestPriceStatus:  latestPriceDate  ? 'ok' : 'unavailable',
      latestMarketDate,
      latestMarketStatus: latestMarketDate ? 'ok' : 'unavailable',
    })
    setActivity(mergeActivity(activityInputs, new Date(), 8))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (authed) loadAll()
  }, [authed, loadAll])

  if (!authed) return <LoginScreen onLogin={() => { setAuthed(true) }} />

  const today = new Date().toISOString().slice(0, 10)
  const attention = deriveAttention({
    draftArticles:    summary.draftArticles,
    pendingCreators:  summary.pendingCreators,
    pendingVendors:   summary.pendingVendors,
    latestPriceDate:  summary.latestPriceDate,
    today,
  })

  return (
    <div style={{ maxWidth: 1160, margin: '0 auto', padding: '32px 24px', fontFamily: "'Figtree', sans-serif" }}>

      {/* Top nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, margin: '0 0 4px', color: 'var(--text)' }}>Admin</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            {loading ? 'Loading…' : 'Overview of Insights, Community and Data Pipeline'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={loadAll} style={secondaryBtn}>Refresh</button>
          <Link href="/" style={secondaryBtn as any}>Return to site</Link>
        </div>
      </div>

      {/* ── Needs attention ── */}
      <section style={sectionStyle} aria-labelledby="attn-heading">
        <h2 id="attn-heading" style={h2Style}>Needs attention</h2>
        {attention.length === 0 ? (
          <div style={calmEmptyStyle}>No urgent admin actions detected.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {attention.map(item => {
              // FIX1 — informational items (no moderation tool) render
              // as a non-clickable row so we never send Luke to a
              // public directory as if it were an admin surface.
              const content = (
                <>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{item.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{item.reason}</div>
                  </div>
                  <div style={attentionCountStyle}>{item.count}</div>
                </>
              )
              if (item.href) {
                return (
                  <Link key={item.key} href={item.href} style={attentionRowStyle}>
                    {content}
                  </Link>
                )
              }
              return (
                <div key={item.key} style={{ ...attentionRowStyle, cursor: 'default' }} data-informational="true">
                  {content}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Summary metrics ── */}
      <section style={sectionStyle} aria-labelledby="summary-heading">
        <h2 id="summary-heading" style={h2Style}>Overview</h2>
        <div style={metricGridStyle}>
          <MetricCard label="Published articles" value={summary.publishedArticles} href="/admin/insights" hint="Live on /insights" />
          <MetricCard label="Draft articles"     value={summary.draftArticles}     href="/admin/insights" hint="Not yet public" />
          <MetricCard label="Approved creators"  value={summary.approvedCreators}  href="/creators"       hint="View public directory" />
          {/* FIX1 — pending creator/vendor cards are informational
              (no moderation tool yet). No link. */}
          <MetricCard label="Pending creators"   value={summary.pendingCreators}   href={null}            hint="Submitted, no admin review tool available" />
          <MetricCard label="Active vendors"     value={summary.activeVendors}     href="/vendors"        hint="View public directory" />
          <MetricCard label="Pending vendors"    value={summary.pendingVendors}    href={null}            hint="Submitted, no admin review tool available" />
          <MetricCard label="Cards in catalogue" value={summary.cardsInCatalogue}  href={null}            hint="From cards table" />
          <MetricCard label="Content-studio posts" value={summary.contentPosts}    href="/admin/content-studio" hint="Saved posts total" />
        </div>
      </section>

      {/* ── Data freshness ── */}
      <section style={sectionStyle} aria-labelledby="data-heading">
        <h2 id="data-heading" style={h2Style}>Data freshness</h2>
        <div style={metricGridStyle}>
          <FreshnessCard
            label="Latest daily_prices date"
            date={summary.latestPriceDate}
            status={summary.latestPriceStatus}
            today={today}
          />
          <FreshnessCard
            label="Latest market_index date"
            date={summary.latestMarketDate}
            status={summary.latestMarketStatus}
            today={today}
          />
        </div>
      </section>

      {/* ── Admin tools ── */}
      <section style={sectionStyle} aria-labelledby="tools-heading">
        <h2 id="tools-heading" style={h2Style}>Admin tools</h2>
        <div style={toolGridStyle}>
          <ToolCard
            name="Insights (Articles)"
            purpose="Create, edit and publish Insights articles with rich text and images."
            href="/admin/insights"
            primary="Open editor"
          />
          <ToolCard
            name="Content Studio"
            purpose="Generate social-media posts (Twitter/Instagram) from card and market data."
            href="/admin/content-studio"
            primary="Open Content Studio"
          />
          <ToolCard
            name="Newsletter Studio"
            purpose="Compose newsletters using movers, market-index and card data."
            href="/admin/newsletter-studio"
            primary="Open Newsletter Studio"
          />
          {recentSalesAvailable ? (
            <ToolCard
              name="Recent Sales pipeline"
              purpose="Read-only inspection of the recent-sales import pipeline (env-flag gated)."
              href="/admin/recent-sales"
              primary="Open pipeline"
              note="Requires RECENT_SALES_ADMIN_VIEW_ENABLED"
            />
          ) : (
            <ToolCard
              name="Recent Sales pipeline"
              purpose="Read-only inspection of the recent-sales import pipeline."
              href={null}
              primary="Not enabled in this environment"
              note="Set RECENT_SALES_ADMIN_VIEW_ENABLED to enable this tool."
            />
          )}
        </div>
      </section>

      {/* ── Recent activity ── */}
      <section style={sectionStyle} aria-labelledby="activity-heading">
        <h2 id="activity-heading" style={h2Style}>Recent activity</h2>
        {activity.length === 0 ? (
          <div style={calmEmptyStyle}>No recent activity to display.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {activity.map(row => {
              // FIX1 — render as a Link only when a genuinely useful
              // destination exists (individual profile page for a
              // creator/vendor, or the article editor for an insight).
              // Rows without a href render as plain text so we don't
              // send Luke to a public directory as an "admin action".
              const inner = (
                <Fragment>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flex: 1, minWidth: 0 }}>
                    <span style={sourcePillStyle(row.source)}>{sourceLabel(row.source)}</span>
                    <span style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.title}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 12 }}>
                    {row.timeAgo}
                  </span>
                </Fragment>
              )
              if (row.href) {
                return (
                  <Link key={row.key} href={row.href} style={activityRowStyle}>
                    {inner}
                  </Link>
                )
              }
              return (
                <div key={row.key} style={{ ...activityRowStyle, cursor: 'default' }}>
                  {inner}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Quick actions ── */}
      <section style={sectionStyle} aria-labelledby="qa-heading">
        <h2 id="qa-heading" style={h2Style}>Quick actions</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <QuickAction href="/admin/insights"        label="New article" />
          <QuickAction href="/admin/content-studio"  label="Content Studio" />
          <QuickAction href="/admin/newsletter-studio" label="Newsletter Studio" />
          <QuickAction href="/insights"              label="View public Insights" />
          <QuickAction href="/creators"              label="View creators" />
          <QuickAction href="/vendors"               label="View vendors" />
          <QuickAction href="/card-shows"            label="View card shows" />
          <QuickAction href="/"                      label="Return to site" />
        </div>
      </section>
    </div>
  )
}

// ── Card components ──────────────────────────────────────────

function MetricCard({ label, value, href, hint }: { label: string; value: MetricValue; href: string | null; hint?: string }) {
  const body = (
    <div style={metricCardStyle}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text-muted)', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: value === 'unavailable' ? 'var(--text-muted)' : 'var(--text)', fontFamily: "'Outfit', sans-serif", lineHeight: 1.1 }}>
        {formatMetric(value)}
      </div>
      {hint && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
  return href ? <Link href={href} style={{ textDecoration: 'none' }}>{body}</Link> : body
}

function FreshnessCard({ label, date, status, today }: { label: string; date: string | null; status: 'ok' | 'unavailable'; today: string }) {
  if (status === 'unavailable' || !date) {
    return (
      <div style={metricCardStyle}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-muted)', fontFamily: "'Outfit', sans-serif" }}>Unavailable</div>
      </div>
    )
  }
  const isToday = date === today
  return (
    <div style={metricCardStyle}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', fontFamily: "'Outfit', sans-serif" }}>{date}</div>
      <div style={{ fontSize: 12, color: isToday ? '#22c55e' : 'var(--text-muted)', marginTop: 4 }}>
        {isToday ? 'Up to date' : 'As of ' + humanTimeAgo(date + 'T00:00:00Z', new Date())}
      </div>
    </div>
  )
}

function ToolCard({ name, purpose, href, primary, note }: {
  name: string; purpose: string; href: string | null; primary: string; note?: string
}) {
  // FIX1 — when href is null the tool is unavailable in this
  // environment. Render the primary action as a disabled label
  // rather than a link to a route that would 404.
  return (
    <div style={toolCardStyle}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: "'Outfit', sans-serif", marginBottom: 4 }}>{name}</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, flex: 1 }}>{purpose}</div>
      {note && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic' }}>{note}</div>}
      <div style={{ marginTop: 12 }}>
        {href
          ? <Link href={href} style={primaryBtn as any}>{primary}</Link>
          : <span style={disabledBtnStyle} data-disabled="true" aria-disabled="true">{primary}</span>}
      </div>
    </div>
  )
}

const disabledBtnStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '8px 14px',
  borderRadius: 8,
  background: 'var(--bg-light)',
  color: 'var(--text-muted)',
  fontSize: 13,
  fontWeight: 700,
  border: '1px dashed var(--border)',
  fontFamily: "'Figtree', sans-serif",
  cursor: 'not-allowed',
}

function QuickAction({ href, label }: { href: string; label: string }) {
  return <Link href={href} style={quickActionStyle as any}>{label}</Link>
}

function sourceLabel(s: ActivityRow['source']): string {
  return s === 'insight' ? 'Article' : s === 'creator' ? 'Creator' : 'Vendor'
}

// ── Styles ────────────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: '20px 22px',
  marginBottom: 16,
}
const h2Style: React.CSSProperties = {
  fontFamily: "'Outfit', sans-serif",
  fontSize: 16,
  margin: '0 0 14px',
  color: 'var(--text)',
  fontWeight: 700,
}
const metricGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: 10,
}
const metricCardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '14px 16px',
  background: 'var(--bg-light)',
}
const toolGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
  gap: 12,
}
const toolCardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '16px 18px',
  background: 'var(--bg-light)',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 150,
}
const attentionRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg-light)',
  textDecoration: 'none',
}
const attentionCountStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  color: 'var(--text)',
  fontFamily: "'Outfit', sans-serif",
  padding: '2px 12px',
  border: '1px solid var(--border)',
  borderRadius: 20,
  background: 'var(--card)',
  flexShrink: 0,
}
const activityRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 4px',
  borderBottom: '1px solid var(--border)',
  textDecoration: 'none',
}
const calmEmptyStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text-muted)',
  padding: '14px 4px',
}
const primaryBtn: React.CSSProperties = {
  display: 'inline-block',
  padding: '8px 14px',
  borderRadius: 8,
  background: 'var(--primary)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 700,
  textDecoration: 'none',
  fontFamily: "'Figtree', sans-serif",
}
const secondaryBtn: React.CSSProperties = {
  display: 'inline-block',
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-light)',
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'none',
  fontFamily: "'Figtree', sans-serif",
}
const quickActionStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '7px 14px',
  borderRadius: 20,
  border: '1px solid var(--border)',
  background: 'var(--bg-light)',
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: 600,
  textDecoration: 'none',
}

function sourcePillStyle(source: ActivityRow['source']): React.CSSProperties {
  const bg = source === 'insight' ? 'rgba(59,130,246,0.10)'
           : source === 'creator' ? 'rgba(34,197,94,0.10)'
                                  : 'rgba(245,197,24,0.15)'
  const fg = source === 'insight' ? '#3b82f6'
           : source === 'creator' ? '#22c55e'
                                  : '#a17e0b'
  return {
    display: 'inline-block',
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    padding: '2px 8px',
    borderRadius: 20,
    background: bg,
    color: fg,
    flexShrink: 0,
  }
}
