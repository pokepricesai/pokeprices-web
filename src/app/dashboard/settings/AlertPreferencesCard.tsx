'use client'

// Block 5A-W-1 — settings card for the rule-based alert preferences.
// Renders the new user_alert_preferences row with sensible defaults
// when no row exists yet. Saving upserts via the user's own RLS-bound
// supabase client; no emails are sent from this block, no public API
// route is added.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { trackEvent } from '@/lib/analytics'
import {
  ALERT_PREFERENCE_BOUNDS,
  ALERT_PREFERENCE_DEFAULTS,
  applyPatch,
  loadUserAlertPreferences,
  preferencesToRow,
  type UserAlertPreferences,
} from '@/lib/alerts/preferences'

export default function AlertPreferencesCard({ userId }: { userId: string }) {
  const [prefs,   setPrefs]   = useState<UserAlertPreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    loadUserAlertPreferences(supabase, userId).then(p => {
      if (live) { setPrefs(p); setLoading(false) }
    })
    return () => { live = false }
  }, [userId])

  async function update(patch: Partial<UserAlertPreferences>) {
    if (!prefs) return
    const next = applyPatch(prefs, patch)
    setPrefs(next)
    setSaving(true)
    await supabase
      .from('user_alert_preferences')
      .upsert({ user_id: userId, ...preferencesToRow(next) }, { onConflict: 'user_id' })
    setSaving(false)
    setSavedAt(Date.now())
    const key = Object.keys(patch)[0]
    if (key) trackEvent('settings_saved', { feature_name: key, source_component: 'settings_alert_prefs' })
  }

  if (loading || !prefs) {
    return (
      <div style={cardStyle}>
        <h2 style={h2Style}>Smart alerts</h2>
        <div className="skeleton" style={{ height: 80, borderRadius: 10, marginTop: 12 }} />
      </div>
    )
  }

  const masterOff = !prefs.enabled

  return (
    <div style={cardStyle}>
      <h2 style={h2Style}>Smart alerts</h2>
      <p style={subStyle}>
        Decide when we should let you know a card on your watchlist or in your portfolio has moved.
        These preferences are saved now; emails are not sent yet — that arrives in a later release.
      </p>

      <Toggle
        label="Smart alerts"
        sub="Master switch. When off, no rule fires regardless of what you set below."
        value={prefs.enabled}
        onChange={v => update({ enabled: v })}
      />

      <div style={{ opacity: masterOff ? 0.5 : 1, pointerEvents: masterOff ? 'none' : 'auto' }}>
        <SectionLabel>Which cards count</SectionLabel>
        <Toggle
          label="My watchlist"
          sub="Cards you have added to your watchlist."
          value={prefs.scopeWatchlist}
          onChange={v => update({ scopeWatchlist: v })}
        />
        <Toggle
          label="My portfolio"
          sub="Cards you own and track in your portfolio."
          value={prefs.scopePortfolio}
          onChange={v => update({ scopePortfolio: v })}
        />

        <SectionLabel>What counts as a meaningful change</SectionLabel>

        <RuleRow
          label="Price moved up or down"
          sub="Trigger when any tracked price moves by at least this much."
          enabled={prefs.rulePriceMoveEnabled}
          onToggle={v => update({ rulePriceMoveEnabled: v })}
          pct={prefs.rulePriceMovePct}
          onPct={n => update({ rulePriceMovePct: n })}
          pctBounds={ALERT_PREFERENCE_BOUNDS.rulePriceMovePct}
        />

        <RuleRow
          label="Raw price changed"
          sub="Same as above but tied specifically to the raw price."
          enabled={prefs.ruleRawChangeEnabled}
          onToggle={v => update({ ruleRawChangeEnabled: v })}
          pct={prefs.ruleRawChangePct}
          onPct={n => update({ ruleRawChangePct: n })}
          pctBounds={ALERT_PREFERENCE_BOUNDS.ruleRawChangePct}
        />

        <RuleRow
          label="PSA 10 price changed"
          sub="Same as above but tied specifically to the PSA 10 price."
          enabled={prefs.ruleMyPSA10ChangeEnabled}
          onToggle={v => update({ ruleMyPSA10ChangeEnabled: v })}
          pct={prefs.ruleMyPSA10ChangePct}
          onPct={n => update({ ruleMyPSA10ChangePct: n })}
          pctBounds={ALERT_PREFERENCE_BOUNDS.ruleMyPSA10ChangePct}
        />

        <RuleRow
          label="Raw → PSA 10 spread widened or narrowed"
          sub="Useful when the grading premium changes meaningfully."
          enabled={prefs.ruleSpreadChangeEnabled}
          onToggle={v => update({ ruleSpreadChangeEnabled: v })}
          pct={prefs.ruleSpreadChangePct}
          onPct={n => update({ ruleSpreadChangePct: n })}
          pctBounds={ALERT_PREFERENCE_BOUNDS.ruleSpreadChangePct}
        />

        <Toggle
          label="New recent sales available"
          sub="Trigger when fresh marketplace sales land for a card you watch."
          value={prefs.ruleRecentSalesEnabled}
          onChange={v => update({ ruleRecentSalesEnabled: v })}
        />

        <Toggle
          label="Card has meaningful market activity"
          sub="A heuristic flag for unusual recent activity on a card."
          value={prefs.ruleMarketActivityEnabled}
          onChange={v => update({ ruleMarketActivityEnabled: v })}
        />

        <SectionLabel>Cooldown</SectionLabel>
        <div style={rowStyle}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Minimum hours between alerts</div>
            <div style={subTextStyle}>
              The same (card, rule) pair will not fire more than once in this window. 0 means no cooldown.
            </div>
          </div>
          <PctInput
            value={prefs.minHoursBetweenAlerts}
            onChange={n => update({ minHoursBetweenAlerts: n })}
            bounds={ALERT_PREFERENCE_BOUNDS.minHoursBetweenAlerts}
            suffix="hrs"
          />
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: savedAt ? '#22c55e' : 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", height: 14 }}>
        {saving ? 'Saving…' : savedAt && Date.now() - savedAt < 2000 ? 'Saved.' : ''}
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8,
      color: 'var(--text-muted)', margin: '18px 0 4px', fontFamily: "'Figtree', sans-serif",
    }}>{children}</div>
  )
}

function Toggle({ label, sub, value, onChange }: {
  label: string; sub?: string; value: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div style={rowStyle}>
      <div style={{ flex: 1 }}>
        <div style={labelStyle}>{label}</div>
        {sub && <div style={subTextStyle}>{sub}</div>}
      </div>
      <button
        onClick={() => onChange(!value)}
        style={{
          flexShrink: 0,
          width: 42, height: 24, borderRadius: 12,
          background: value ? 'var(--primary)' : 'var(--bg-light)',
          border: '1px solid ' + (value ? 'var(--primary)' : 'var(--border)'),
          position: 'relative', cursor: 'pointer', padding: 0,
          transition: 'background 0.18s, border-color 0.18s',
        }}
        aria-pressed={value}
      >
        <span style={{
          position: 'absolute', top: 2, left: value ? 20 : 2,
          width: 18, height: 18, borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.18s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </button>
    </div>
  )
}

function RuleRow({ label, sub, enabled, onToggle, pct, onPct, pctBounds }: {
  label:     string
  sub?:      string
  enabled:   boolean
  onToggle:  (v: boolean) => void
  pct:       number
  onPct:     (n: number) => void
  pctBounds: { min: number; max: number }
}) {
  return (
    <div style={rowStyle}>
      <div style={{ flex: 1 }}>
        <div style={labelStyle}>{label}</div>
        {sub && <div style={subTextStyle}>{sub}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <PctInput value={pct} onChange={onPct} bounds={pctBounds} suffix="%" disabled={!enabled} />
        <button
          onClick={() => onToggle(!enabled)}
          aria-pressed={enabled}
          style={{
            width: 42, height: 24, borderRadius: 12,
            background: enabled ? 'var(--primary)' : 'var(--bg-light)',
            border: '1px solid ' + (enabled ? 'var(--primary)' : 'var(--border)'),
            position: 'relative', cursor: 'pointer', padding: 0,
          }}
        >
          <span style={{
            position: 'absolute', top: 2, left: enabled ? 20 : 2,
            width: 18, height: 18, borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }} />
        </button>
      </div>
    </div>
  )
}

function PctInput({ value, onChange, bounds, suffix, disabled }: {
  value:    number
  onChange: (n: number) => void
  bounds:   { min: number; max: number }
  suffix:   string
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '4px 8px', borderRadius: 8,
      border: '1px solid var(--border)', background: 'var(--bg)',
      opacity: disabled ? 0.5 : 1,
    }}>
      <input
        type="number"
        value={draft}
        min={bounds.min}
        max={bounds.max}
        step={1}
        disabled={disabled}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          const n = parseInt(draft, 10)
          if (Number.isFinite(n) && n !== value) onChange(n)
          else setDraft(String(value))
        }}
        style={{
          width: 52, padding: 0, border: 'none', background: 'transparent',
          color: 'var(--text)', fontSize: 13, fontFamily: "'Figtree', sans-serif",
          textAlign: 'right', outline: 'none',
        }}
      />
      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{suffix}</span>
    </div>
  )
}

// ── Shared style helpers (mirror the existing card styling) ───────

const cardStyle: React.CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 16, padding: 22, marginBottom: 16,
}
const h2Style: React.CSSProperties = {
  fontFamily: "'Outfit', sans-serif", fontSize: 17, margin: '0 0 4px', color: 'var(--text)',
}
const subStyle: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 18px',
}
const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  gap: 16, padding: '12px 0', borderBottom: '1px solid var(--border-light)',
}
const labelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif",
}
const subTextStyle: React.CSSProperties = {
  fontSize: 11.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 3, lineHeight: 1.5,
}

// Quiet usage marker so the import is preserved even if a future
// refactor temporarily removes a callsite.
void ALERT_PREFERENCE_DEFAULTS
