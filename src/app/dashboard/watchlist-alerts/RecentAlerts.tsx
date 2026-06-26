'use client'

// Block 5A-W-18 — user-facing "Recent alerts" section.
// Reads alert_events scoped to the signed-in user via RLS (the
// browser supabase client uses the user's JWT, so they only see
// their own rows). Groups by card_slug and presents a friendly
// rule/severity label. No internal IDs, no rule code names, no
// user_id — everything that shows up is something the user can
// look at without explanation.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { AlertRule } from '@/lib/alerts/preferences'

type AlertEventRow = {
  id:           string
  card_slug:    string
  card_name:    string | null
  set_name:     string | null
  rule:         AlertRule
  severity:     'low' | 'normal' | 'high'
  detected_at:  string
  delivered_at: string | null
}

type CardGroup = {
  cardSlug:    string
  cardName:    string
  setName:     string
  cardUrl:     string
  latestAt:    string
  reasons:     Array<{ rule: AlertRule; severity: 'low' | 'normal' | 'high' }>
  delivered:   boolean
  eventCount:  number
}

// Friendly labels — mirror the strings used in the email digest so
// the UI and the email speak the same language.
const RULE_LABEL: Record<AlertRule, string> = {
  raw_change:      'Raw price changed',
  psa10_change:    'PSA 10 price changed',
  recent_sales:    'Fresh sales landed',
  market_activity: 'Unusual market activity',
  spread_change:   'Raw → PSA 10 spread shifted',
  price_move:      'Price moved',
}

const SEVERITY_LABEL: Record<'low' | 'normal' | 'high', string> = {
  high:   'Big move',
  normal: 'Notable',
  low:    'For your awareness',
}

const SEVERITY_COLOUR: Record<'low' | 'normal' | 'high', string> = {
  high:   '#ef4444',
  normal: 'var(--primary)',
  low:    'var(--text-muted)',
}

function fmtWhen(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const secs = (Date.now() - t) / 1000
  if (secs < 60)      return 'just now'
  if (secs < 3600)    return `${Math.floor(secs / 60)}m ago`
  if (secs < 86_400)  return `${Math.floor(secs / 3600)}h ago`
  if (secs < 604_800) return `${Math.floor(secs / 86_400)}d ago`
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function groupByCard(rows: AlertEventRow[]): CardGroup[] {
  const map = new Map<string, CardGroup>()
  for (const r of rows) {
    const cardName = r.card_name ?? r.card_slug
    const setName  = r.set_name  ?? ''
    const cardUrl  = setName
      ? `/set/${encodeURIComponent(setName)}/card/${r.card_slug}`
      : '#'
    const existing = map.get(r.card_slug)
    if (existing) {
      existing.reasons.push({ rule: r.rule, severity: r.severity })
      existing.delivered = existing.delivered || r.delivered_at != null
      existing.eventCount += 1
      if (r.detected_at > existing.latestAt) existing.latestAt = r.detected_at
    } else {
      map.set(r.card_slug, {
        cardSlug:   r.card_slug,
        cardName,
        setName,
        cardUrl,
        latestAt:   r.detected_at,
        reasons:    [{ rule: r.rule, severity: r.severity }],
        delivered:  r.delivered_at != null,
        eventCount: 1,
      })
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime(),
  )
}

export default function RecentAlerts({ userId }: { userId: string }) {
  const [rows, setRows]   = useState<AlertEventRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      // Pull the 50 most recent — that's plenty for a panel; older
      // events are still preserved server-side but irrelevant here.
      const { data, error } = await supabase
        .from('alert_events')
        .select('id, card_slug, card_name, set_name, rule, severity, detected_at, delivered_at')
        .eq('user_id', userId)
        .order('detected_at', { ascending: false })
        .limit(50)
      if (!live) return
      if (error) { setError(error.message); setRows([]); return }
      setRows((data as AlertEventRow[] | null) ?? [])
    })()
    return () => { live = false }
  }, [userId])

  if (rows === null) {
    return (
      <div style={panelStyle}>
        <SectionHeader>Recent alerts</SectionHeader>
        <div className="skeleton" style={{ height: 64, borderRadius: 12 }} />
      </div>
    )
  }
  if (error) {
    return (
      <div style={panelStyle}>
        <SectionHeader>Recent alerts</SectionHeader>
        <p style={subStyle}>Couldn&apos;t load alerts right now.</p>
      </div>
    )
  }

  const groups = groupByCard(rows)
  if (groups.length === 0) {
    return (
      <div style={panelStyle}>
        <SectionHeader>Recent alerts</SectionHeader>
        <p style={subStyle}>No alerts yet. We&apos;ll show them here when your watched cards move.</p>
      </div>
    )
  }

  return (
    <div style={panelStyle}>
      <SectionHeader>Recent alerts</SectionHeader>
      <p style={subStyle}>
        Grouped by card. Most recent first. We only count alerts that match your current thresholds.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {groups.map(g => (
          <div key={g.cardSlug} style={{
            border: '1px solid var(--border)', borderRadius: 12,
            padding: '12px 14px', background: 'var(--bg-light)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <Link href={g.cardUrl} style={{ textDecoration: 'none' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.3 }}>
                    {g.cardName}
                  </div>
                  {g.setName && (
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                      {g.setName}
                    </div>
                  )}
                </Link>
              </div>
              <div style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textAlign: 'right' }}>
                <div>{fmtWhen(g.latestAt)}</div>
                <div style={{ marginTop: 2, color: g.delivered ? '#22c55e' : 'var(--text-muted)' }}>
                  {g.delivered ? 'Emailed' : 'Pending'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {g.reasons.map((r, i) => (
                <span key={i} style={{
                  fontSize: 11, fontWeight: 700,
                  padding: '3px 8px', borderRadius: 8,
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  fontFamily: "'Figtree', sans-serif",
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                  {RULE_LABEL[r.rule] ?? r.rule}
                  <span style={{
                    fontSize: 10, fontWeight: 800,
                    color: SEVERITY_COLOUR[r.severity],
                    textTransform: 'uppercase', letterSpacing: 0.6,
                  }}>{SEVERITY_LABEL[r.severity]}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontFamily: "'Outfit', sans-serif", fontSize: 17, margin: '0 0 4px',
      color: 'var(--text)',
    }}>{children}</h2>
  )
}

const panelStyle: React.CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 16, padding: 22, marginBottom: 16,
}

const subStyle: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
  margin: '0 0 0',
}
