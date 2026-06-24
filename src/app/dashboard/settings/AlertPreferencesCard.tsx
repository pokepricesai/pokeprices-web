'use client'

// Block 5A-W-13B — Smart Alerts settings card, simplified.
//
// Layout:
//   * SIMPLE controls (always visible)
//       - Master switch
//       - Weekly overview on/off + day-of-week
//       - Instant alerts on/off
//       - Sensitivity preset chooser (Conservative / Balanced / Active)
//   * ADVANCED settings (collapsed by default, native <details>)
//       - Portfolio / watchlist scope toggles
//       - Per-rule toggles + percentage / count thresholds
//       - Per-rule cooldown and per-user digest cooldown
//
// The presets write the same seven threshold fields the Advanced
// section exposes individually, so the DB shape is unchanged. The
// previous block's evaluator/delivery wiring is unchanged.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { trackEvent } from '@/lib/analytics'
import {
  ALERT_PREFERENCE_BOUNDS,
  ALERT_PREFERENCE_DEFAULTS,
  SENSITIVITY_PRESETS,
  SENSITIVITY_PRESET_LABELS,
  applyPatch,
  applySensitivityPreset,
  detectSensitivityPreset,
  loadUserAlertPreferences,
  preferencesToRow,
  type SensitivityPreset,
  type UserAlertPreferences,
} from '@/lib/alerts/preferences'

const DOW_LABELS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
]

const SENSITIVITY_HINTS: Record<SensitivityPreset, string> = {
  conservative: 'Fewer emails — only the biggest moves come through.',
  balanced:     'Balanced is recommended for most collectors.',
  active:       'More alerts — catch smaller moves and lower sales counts.',
}

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

  async function persist(next: UserAlertPreferences, telemetryKey: string) {
    setPrefs(next)
    setSaving(true)
    await supabase
      .from('user_alert_preferences')
      .upsert({ user_id: userId, ...preferencesToRow(next) }, { onConflict: 'user_id' })
    setSaving(false)
    setSavedAt(Date.now())
    trackEvent('settings_saved', { feature_name: telemetryKey, source_component: 'settings_alert_prefs' })
  }

  async function update(patch: Partial<UserAlertPreferences>) {
    if (!prefs) return
    const next = applyPatch(prefs, patch)
    const key  = Object.keys(patch)[0] ?? 'noop'
    await persist(next, key)
  }

  async function pickPreset(preset: SensitivityPreset) {
    if (!prefs) return
    const next = applySensitivityPreset(prefs, preset)
    await persist(next, `sensitivity_${preset}`)
  }

  if (loading || !prefs) {
    return (
      <div style={cardStyle}>
        <h2 style={h2Style}>Smart alerts</h2>
        <div className="skeleton" style={{ height: 80, borderRadius: 10, marginTop: 12 }} />
      </div>
    )
  }

  const masterOff    = !prefs.enabled
  const weeklyOff    = !prefs.weeklyDigestEnabled
  const currentPreset = detectSensitivityPreset(prefs)

  return (
    <div style={cardStyle}>
      <h2 style={h2Style}>Smart alerts</h2>
      <p style={subStyle}>
        Pick how PokePrices keeps you informed about cards you watch and own.
        Changes save as you go.
      </p>

      <Toggle
        label="Smart alerts"
        sub="Master switch. When off, no weekly digest and no instant alerts — regardless of what you set below."
        value={prefs.enabled}
        onChange={v => update({ enabled: v })}
      />

      <div style={{ opacity: masterOff ? 0.5 : 1, pointerEvents: masterOff ? 'none' : 'auto' }}>

        {/* ─── Weekly overview ───────────────────────────────────────── */}
        <SectionLabel>Weekly overview</SectionLabel>
        <Toggle
          label="Weekly overview email"
          sub="A short summary every week — biggest movers across your cards and portfolio total change."
          value={prefs.weeklyDigestEnabled}
          onChange={v => update({ weeklyDigestEnabled: v })}
        />
        <div style={{ opacity: weeklyOff ? 0.5 : 1, pointerEvents: weeklyOff ? 'none' : 'auto', paddingLeft: 14, borderLeft: '2px solid var(--border-light)' }}>
          <div style={rowStyle}>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>Send on</div>
              <div style={subTextStyle}>Which day of the week to receive the overview.</div>
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'wrap', maxWidth: 240, justifyContent: 'flex-end' }}>
              {DOW_LABELS.map(d => (
                <button
                  key={d.value}
                  onClick={() => update({ weeklyDigestDayOfWeek: d.value })}
                  aria-pressed={prefs.weeklyDigestDayOfWeek === d.value}
                  style={{
                    padding: '5px 9px', borderRadius: 8, fontSize: 11.5, fontWeight: 700,
                    fontFamily: "'Figtree', sans-serif",
                    border: prefs.weeklyDigestDayOfWeek === d.value ? '1px solid var(--primary)' : '1px solid var(--border)',
                    background: prefs.weeklyDigestDayOfWeek === d.value ? 'rgba(26,95,173,0.08)' : 'transparent',
                    color: prefs.weeklyDigestDayOfWeek === d.value ? 'var(--primary)' : 'var(--text)',
                    cursor: 'pointer',
                  }}
                >{d.label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* ─── Instant alerts ────────────────────────────────────────── */}
        <SectionLabel>Instant alerts</SectionLabel>
        <Toggle
          label="Instant alert emails"
          sub="Send me a short alert whenever a tracked card crosses an alert threshold. Independent from the weekly overview."
          value={prefs.instantAlertsEnabled}
          onChange={v => update({ instantAlertsEnabled: v })}
        />

        {/* ─── Sensitivity preset ────────────────────────────────────── */}
        <SectionLabel>Alert sensitivity</SectionLabel>
        <div style={rowStyle}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>How sensitive should alerts be?</div>
            <div style={subTextStyle}>
              {currentPreset === 'custom'
                ? 'Custom thresholds — adjust each one in Advanced settings below.'
                : SENSITIVITY_HINTS[currentPreset]}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {SENSITIVITY_PRESETS.map(p => {
              const active = currentPreset === p
              return (
                <button
                  key={p}
                  onClick={() => pickPreset(p)}
                  aria-pressed={active}
                  style={{
                    padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                    fontFamily: "'Figtree', sans-serif",
                    border: active ? '1px solid var(--primary)' : '1px solid var(--border)',
                    background: active ? 'rgba(26,95,173,0.08)' : 'transparent',
                    color:      active ? 'var(--primary)'        : 'var(--text)',
                    cursor: 'pointer',
                  }}
                >{SENSITIVITY_PRESET_LABELS[p]}</button>
              )
            })}
          </div>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '4px 0 0', lineHeight: 1.5 }}>
          You can fine-tune every rule in Advanced settings below.
        </p>

        {/* ─── Advanced settings (collapsed) ─────────────────────────── */}
        <details style={{ marginTop: 18, borderTop: '1px solid var(--border-light)', paddingTop: 8 }}>
          <summary style={{
            cursor: 'pointer', listStyle: 'none',
            fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8,
            color: 'var(--text)', fontFamily: "'Figtree', sans-serif",
            padding: '10px 0',
          }}>
            Advanced settings
            <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>
              — per-rule thresholds, scopes, cooldowns
            </span>
          </summary>

          {/* Scope */}
          <SectionLabel>Which cards count</SectionLabel>
          <Toggle
            label="Cards in my portfolio"
            sub="Cards you own and track."
            value={prefs.scopePortfolio}
            onChange={v => update({ scopePortfolio: v })}
          />
          <Toggle
            label="Cards on my watchlist"
            sub="Cards you have added to your watchlist."
            value={prefs.scopeWatchlist}
            onChange={v => update({ scopeWatchlist: v })}
          />
          <Toggle
            label="Include portfolio summary in weekly overview"
            value={prefs.weeklyOverviewPortfolioEnabled}
            onChange={v => update({ weeklyOverviewPortfolioEnabled: v })}
          />
          <Toggle
            label="Include watchlist summary in weekly overview"
            value={prefs.weeklyOverviewWatchlistEnabled}
            onChange={v => update({ weeklyOverviewWatchlistEnabled: v })}
          />

          {/* Thresholds */}
          <SectionLabel>Alert thresholds</SectionLabel>

          <RuleRow
            label="Portfolio price move"
            sub="Trigger when a card you OWN moves by at least this much."
            enabled={prefs.rulePriceMoveEnabled}
            onToggle={v => update({ rulePriceMoveEnabled: v })}
            pct={prefs.rulePriceMovePortfolioPct}
            onPct={n => update({ rulePriceMovePortfolioPct: n })}
            pctBounds={ALERT_PREFERENCE_BOUNDS.rulePriceMovePortfolioPct}
          />

          <RuleRow
            label="Watchlist price move"
            sub="Trigger when a card you WATCH moves by at least this much. Default is looser than portfolio."
            enabled={prefs.rulePriceMoveEnabled}
            onToggle={v => update({ rulePriceMoveEnabled: v })}
            pct={prefs.rulePriceMoveWatchlistPct}
            onPct={n => update({ rulePriceMoveWatchlistPct: n })}
            pctBounds={ALERT_PREFERENCE_BOUNDS.rulePriceMoveWatchlistPct}
          />

          <RuleRow
            label="Raw price changed"
            sub="Same as price move but tied specifically to the raw price."
            enabled={prefs.ruleRawChangeEnabled}
            onToggle={v => update({ ruleRawChangeEnabled: v })}
            pct={prefs.ruleRawChangePct}
            onPct={n => update({ ruleRawChangePct: n })}
            pctBounds={ALERT_PREFERENCE_BOUNDS.ruleRawChangePct}
          />

          <RuleRow
            label="PSA 10 price changed"
            sub="Same as price move but tied specifically to the PSA 10 price."
            enabled={prefs.ruleMyPSA10ChangeEnabled}
            onToggle={v => update({ ruleMyPSA10ChangeEnabled: v })}
            pct={prefs.ruleMyPSA10ChangePct}
            onPct={n => update({ ruleMyPSA10ChangePct: n })}
            pctBounds={ALERT_PREFERENCE_BOUNDS.ruleMyPSA10ChangePct}
          />

          <RuleRow
            label="Raw → PSA 10 spread shifted"
            sub="Useful when the grading premium changes meaningfully."
            enabled={prefs.ruleSpreadChangeEnabled}
            onToggle={v => update({ ruleSpreadChangeEnabled: v })}
            pct={prefs.ruleSpreadChangePct}
            onPct={n => update({ ruleSpreadChangePct: n })}
            pctBounds={ALERT_PREFERENCE_BOUNDS.ruleSpreadChangePct}
          />

          <CountRow
            label="New recent sales"
            sub="Trigger when this many fresh verified sales land for a card you follow."
            enabled={prefs.ruleRecentSalesEnabled}
            onToggle={v => update({ ruleRecentSalesEnabled: v })}
            count={prefs.ruleRecentSalesMinCount}
            onCount={n => update({ ruleRecentSalesMinCount: n })}
            countBounds={ALERT_PREFERENCE_BOUNDS.ruleRecentSalesMinCount}
            suffix="sales"
          />

          <CountRow
            label="Unusual market activity"
            sub="Trigger when a card has at least this many verified sales in the recent activity window."
            enabled={prefs.ruleMarketActivityEnabled}
            onToggle={v => update({ ruleMarketActivityEnabled: v })}
            count={prefs.ruleMarketActivityMinCount}
            onCount={n => update({ ruleMarketActivityMinCount: n })}
            countBounds={ALERT_PREFERENCE_BOUNDS.ruleMarketActivityMinCount}
            suffix="sales"
          />

          {/* Cooldowns */}
          <SectionLabel>Email frequency &amp; cooldown</SectionLabel>
          <div style={rowStyle}>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>Per-rule cooldown</div>
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
          <div style={rowStyle}>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>Minimum hours between alert emails</div>
              <div style={subTextStyle}>
                Even if multiple alerts trigger, you'll receive no more than one email per this many hours.
                The system minimum may apply on top of this value.
              </div>
            </div>
            <PctInput
              value={prefs.digestCooldownHours}
              onChange={n => update({ digestCooldownHours: n })}
              bounds={ALERT_PREFERENCE_BOUNDS.digestCooldownHours}
              suffix="hrs"
            />
          </div>
        </details>
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

function CountRow({ label, sub, enabled, onToggle, count, onCount, countBounds, suffix }: {
  label:       string
  sub?:        string
  enabled:     boolean
  onToggle:    (v: boolean) => void
  count:       number
  onCount:     (n: number) => void
  countBounds: { min: number; max: number }
  suffix:      string
}) {
  return (
    <div style={rowStyle}>
      <div style={{ flex: 1 }}>
        <div style={labelStyle}>{label}</div>
        {sub && <div style={subTextStyle}>{sub}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <PctInput value={count} onChange={onCount} bounds={countBounds} suffix={suffix} disabled={!enabled} />
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
