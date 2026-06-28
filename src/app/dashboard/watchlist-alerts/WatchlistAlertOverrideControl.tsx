'use client'

// Block 5A-W-19 — compact per-card watchlist alert override control.
// Renders inline beneath each watchlist row. Default is "Using global
// defaults · Customise"; Customise expands into a small inline form
// for asymmetric rise/drop thresholds + optional recent-sales /
// market-activity overrides. Saves are upserts against
// watchlist_alert_overrides scoped by user_id + card_slug.
//
// Stays tight on real estate by default — no override row shows just
// a single line so a busy watchlist isn't drowned in chrome.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { trackEvent } from '@/lib/analytics'
import {
  DEFAULT_ROW,
  SUGGESTED_RISE,
  SUGGESTED_DROP,
  describeOverrideState,
  type OverrideRow,
} from './overrideStatus'

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 10
  return Math.max(1, Math.min(100, Math.round(n)))
}

export default function WatchlistAlertOverrideControl({
  userId,
  cardSlug,
}: {
  userId:   string
  cardSlug: string
}) {
  // Bugfix — never start with `row=null` so the panel can render
  // immediately. The load effect overwrites this with the real row
  // (or leaves it as default + sets `loadError` when the table
  // doesn't exist yet on production). Previously the gate
  // `if (loading || !row)` got stuck showing a tiny "Loading…"
  // placeholder forever when the load query failed — making the
  // whole control invisible in practice on a fresh deploy.
  const [row,       setRow]       = useState<OverrideRow>({ ...DEFAULT_ROW })
  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [open,      setOpen]      = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const { data, error } = await supabase
        .from('watchlist_alert_overrides')
        .select('id, enabled, use_global_defaults, rise_pct, drop_pct, recent_sales_enabled, market_activity_enabled')
        .eq('user_id', userId)
        .eq('card_slug', cardSlug)
        .maybeSingle()
      if (!live) return
      if (error && error.code !== 'PGRST116') {
        // ANY error other than PGRST116 ("no rows") is treated as a
        // load failure. The most common cause in production is
        // "relation public.watchlist_alert_overrides does not exist"
        // (Postgres 42P01) when the migration hasn't been applied
        // yet. Either way: keep DEFAULT_ROW so the control renders
        // and surface the error inline so the operator knows to
        // apply the migration / fix the policy.
        setLoadError(error.message)
        setLoading(false)
        return
      }
      if (data) setRow(data as OverrideRow)
      setLoading(false)
    })()
    return () => { live = false }
  }, [userId, cardSlug])

  async function persist(next: OverrideRow, telemetryKey: string) {
    setRow(next)
    setSaving(true)
    setSaveError(null)
    const payload = {
      user_id:                 userId,
      card_slug:               cardSlug,
      enabled:                 next.enabled,
      use_global_defaults:     next.use_global_defaults,
      rise_pct:                next.rise_pct,
      drop_pct:                next.drop_pct,
      recent_sales_enabled:    next.recent_sales_enabled,
      market_activity_enabled: next.market_activity_enabled,
    }
    const { error } = await supabase
      .from('watchlist_alert_overrides')
      .upsert(payload, { onConflict: 'user_id,card_slug' })
    if (error) setSaveError(error.message)
    setSaving(false)
    trackEvent('settings_saved', { feature_name: telemetryKey, source_component: 'watchlist_alert_override' })
  }

  async function update(patch: Partial<OverrideRow>) {
    await persist({ ...row, ...patch }, Object.keys(patch)[0] ?? 'override_change')
  }

  /** Switch from "global defaults" to a real custom override. Seeds
   *  rise/drop with the suggested values so the user sees concrete
   *  numbers as soon as the panel opens. */
  async function startCustomising() {
    await persist({
      ...row,
      use_global_defaults: false,
      rise_pct:            row.rise_pct ?? SUGGESTED_RISE,
      drop_pct:            row.drop_pct ?? SUGGESTED_DROP,
    }, 'use_global_defaults_off')
  }

  /** Reset back to global defaults — keeps the row (with enabled
   *  state intact) but flips use_global_defaults=true. Easier for the
   *  user to undo a customisation than DELETE + INSERT later. */
  async function resetToGlobal() {
    await persist({
      ...row,
      use_global_defaults: true,
    }, 'use_global_defaults_on')
  }

  // Bugfix — the panel ALWAYS renders, even during load or after
  // load failure. The summary chip + "Customise alerts" button stay
  // visible so a user on a fresh deploy (no migration yet) still
  // sees "Card alerts: Alerts ON · Using global defaults" instead
  // of an invisible / "Loading alert settings…" forever placeholder.
  const { stateLabel, summary } = describeOverrideState(row)

  return (
    <div style={panelStyle}>
      <div style={lineStyle}>
        <span style={prefixLabelStyle}>Card alerts:</span>
        <span style={labelChip(row.enabled)}>
          Alerts {stateLabel}
        </span>
        <span style={subStyle}>{summary}</span>
        {loading && <span style={subStyleMuted}>· loading…</span>}
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          style={primaryButtonStyle}
        >
          {open ? 'Hide' : 'Customise alerts'}
        </button>
      </div>

      {loadError && (
        <div style={warnBoxStyle}>
          Couldn&apos;t load saved alert settings for this card. Showing global defaults; saving is unavailable until this is fixed.
          {' '}<span style={{ color: 'var(--text-muted)' }}>({loadError})</span>
        </div>
      )}

      {open && (
        <div style={openStyle}>
          {/* Master enable */}
          <RowToggle
            label="Alerts on for this card"
            sub="When off, this card is silenced even when your global alerts are on."
            value={row.enabled}
            onChange={v => update({ enabled: v })}
          />

          {/* Use-global toggle */}
          <RowToggle
            label="Use my global Watchlist defaults"
            sub="When on, this card inherits your Watchlist alert sensitivity. Turn off to set custom thresholds for this card."
            value={row.use_global_defaults}
            onChange={v => v ? void resetToGlobal() : void startCustomising()}
            disabled={!row.enabled}
          />

          {/* Custom thresholds */}
          {!row.use_global_defaults && row.enabled && (
            <>
              <PctRow
                label="Alert me if price rises by"
                value={row.rise_pct ?? SUGGESTED_RISE}
                onChange={n => update({ rise_pct: clampPct(n) })}
                suffix="%"
              />
              <PctRow
                label="Alert me if price drops by"
                value={row.drop_pct ?? SUGGESTED_DROP}
                onChange={n => update({ drop_pct: clampPct(n) })}
                suffix="%"
              />
              <RowToggle
                label="New recent sales"
                sub="Trigger when fresh verified sales land for this card."
                value={row.recent_sales_enabled}
                onChange={v => update({ recent_sales_enabled: v })}
              />
              <RowToggle
                label="Unusual market activity"
                sub="Trigger on bursts of recent sales activity."
                value={row.market_activity_enabled}
                onChange={v => update({ market_activity_enabled: v })}
              />
            </>
          )}

          <div style={{ minHeight: 12, fontSize: 10.5, color: saveError ? '#ef4444' : 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
            {saveError ? saveError : saving ? 'Saving…' : ''}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components — kept local to avoid leaking a new public surface.
// ─────────────────────────────────────────────────────────────────────

function RowToggle({ label, sub, value, onChange, disabled }: {
  label:    string
  sub?:     string
  value:    boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '6px 0', opacity: disabled ? 0.5 : 1 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{label}</div>
        {sub && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.4 }}>{sub}</div>}
      </div>
      <button
        onClick={() => !disabled && onChange(!value)}
        aria-pressed={value}
        disabled={disabled}
        style={{
          width: 36, height: 20, borderRadius: 10,
          background: value ? 'var(--primary)' : 'var(--bg-light)',
          border: '1px solid ' + (value ? 'var(--primary)' : 'var(--border)'),
          position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer', padding: 0,
          flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 1, left: value ? 17 : 1,
          width: 16, height: 16, borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
        }} />
      </button>
    </div>
  )
}

function PctRow({ label, value, onChange, suffix }: {
  label:    string
  value:    number
  onChange: (n: number) => void
  suffix:   string
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '6px 0' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{label}</div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }}>
        <input
          type="number"
          value={draft}
          min={1}
          max={100}
          step={1}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => {
            const n = parseInt(draft, 10)
            if (Number.isFinite(n) && n !== value) onChange(n)
            else setDraft(String(value))
          }}
          style={{
            width: 46, padding: 0, border: 'none', background: 'transparent',
            color: 'var(--text)', fontSize: 12.5, fontFamily: "'Figtree', sans-serif",
            textAlign: 'right', outline: 'none',
          }}
        />
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{suffix}</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────

function labelChip(enabled: boolean): React.CSSProperties {
  return {
    fontSize: 10, fontWeight: 800,
    letterSpacing: 0.6, textTransform: 'uppercase',
    padding: '2px 7px', borderRadius: 6,
    background: enabled ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.10)',
    color:      enabled ? '#15803d'              : '#b91c1c',
    fontFamily: "'Figtree', sans-serif",
    border: '1px solid ' + (enabled ? 'rgba(34,197,94,0.30)' : 'rgba(239,68,68,0.25)'),
  }
}

const panelStyle: React.CSSProperties = {
  // flex: '0 0 100%' makes the panel claim its own line inside the
  // parent watchlist row (which is itself a flex container with
  // flexWrap:wrap). Previously `width:100%` worked in steady state
  // but the loading-state placeholder didn't carry it, so the strip
  // shrank onto the existing actions row and was easy to miss.
  flex: '0 0 100%',
  width: '100%',
  marginTop: 8,
  paddingTop: 8,
  borderTop: '1px dashed var(--border-light)',
}

const lineStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  flexWrap: 'wrap',
  width: '100%',
}

const prefixLabelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 800,
  letterSpacing: 0.6, textTransform: 'uppercase',
  color: 'var(--text-muted)',
  fontFamily: "'Figtree', sans-serif",
}

const subStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
}

const subStyleMuted: React.CSSProperties = {
  fontSize: 10.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
  fontStyle: 'italic',
}

const primaryButtonStyle: React.CSSProperties = {
  marginLeft: 'auto',
  background: 'rgba(26,95,173,0.08)',
  border: '1px solid var(--primary)',
  color: 'var(--primary)',
  fontSize: 11.5, fontWeight: 700,
  fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
  padding: '4px 10px',
  borderRadius: 8,
}

const warnBoxStyle: React.CSSProperties = {
  marginTop: 6,
  padding: '6px 8px',
  fontSize: 11,
  fontFamily: "'Figtree', sans-serif",
  color: '#92400e',
  background: 'rgba(245,158,11,0.10)',
  border: '1px solid rgba(245,158,11,0.30)',
  borderRadius: 6,
}

const openStyle: React.CSSProperties = {
  marginTop: 8,
  paddingTop: 8,
  borderTop: '1px solid var(--border-light)',
}
