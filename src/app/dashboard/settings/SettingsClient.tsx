'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import DashboardNav from '../DashboardNav'
import Avatar from '@/components/Avatar'
import AvatarPicker from '@/components/AvatarPicker'
import {
  cleanDisplayName,
  cleanCountryCode,
  cleanMarketplacePreference,
  PROFILE_LIMITS,
  type MarketplacePreference,
} from '@/lib/profileValidation'

interface Prefs {
  weekly_digest_enabled: boolean
  alert_emails_enabled: boolean
  alert_cadence: 'instant' | 'daily'
  display_currency: 'GBP' | 'USD'
  unsubscribe_token: string
  last_digest_sent_at: string | null
}

interface Profile {
  display_name:           string | null
  country_code:           string | null
  marketplace_preference: MarketplacePreference | null
}

// Currency intentionally stays on user_email_preferences in Block 2A.
// A future block will consolidate it onto profiles.preferred_currency.

export default function SettingsClient() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  // profileDraft holds the editable view; the persisted snapshot from
  // the database is loaded straight into the draft and the draft is what
  // every save reads from.
  const [profileDraft, setProfileDraft] = useState<Profile>({ display_name: '', country_code: '', marketplace_preference: null })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSavedAt, setProfileSavedAt] = useState<number | null>(null)
  const [profileError, setProfileError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [avatarPokemonId, setAvatarPokemonId] = useState<number | null>(null)

  useEffect(() => {
    function applySession(u: any) {
      if (!u) { router.replace('/dashboard/login'); return }
      setUser(u)
      const pid = u.user_metadata?.avatar_pokemon_id
      setAvatarPokemonId(typeof pid === 'number' ? pid : null)
    }
    supabase.auth.getSession().then(({ data: { session } }) => applySession(session?.user || null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      applySession(session?.user || null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user) return
    async function load() {
      // Ensure prefs row exists, then fetch
      await supabase.rpc('ensure_email_preferences')
      // Try with display_currency; if the column hasn't been migrated yet,
      // PostgREST returns an error (data === null) — retry without it so the
      // settings page still loads.
      let { data, error } = await supabase
        .from('user_email_preferences')
        .select('weekly_digest_enabled, alert_emails_enabled, alert_cadence, display_currency, unsubscribe_token, last_digest_sent_at')
        .eq('user_id', user.id)
        .maybeSingle()
      if (error || !data) {
        const fallback = await supabase
          .from('user_email_preferences')
          .select('weekly_digest_enabled, alert_emails_enabled, alert_cadence, unsubscribe_token, last_digest_sent_at')
          .eq('user_id', user.id)
          .maybeSingle()
        data = fallback.data as any
      }
      if (data) setPrefs({ ...(data as any), display_currency: (data as any).display_currency ?? 'GBP' } as Prefs)
      setLoading(false)
    }
    load()
  }, [user])

  async function update<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    if (!prefs || !user) return
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    setSaving(true)
    await supabase
      .from('user_email_preferences')
      .update({ [key]: value, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
    setSaving(false)
    setSavedAt(Date.now())
  }

  // ── Profile load ────────────────────────────────────────────────────────
  // The Block 2A migration backfills a row for every existing user and a
  // trigger creates one for every new signup, so a row should always be
  // present. The defensive `maybeSingle` allows the page to keep loading
  // if the migration has not yet been applied.
  useEffect(() => {
    if (!user) return
    let live = true
    supabase
      .from('profiles')
      .select('display_name, country_code, marketplace_preference')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!live) return
        setProfileDraft({
          display_name:           ((data as any)?.display_name           ?? '') as string,
          country_code:           ((data as any)?.country_code           ?? '') as string,
          marketplace_preference: ((data as any)?.marketplace_preference ?? null) as MarketplacePreference | null,
        })
      })
    return () => { live = false }
  }, [user])

  async function saveProfile() {
    if (!user) return
    setProfileError(null)
    const displayName  = cleanDisplayName(profileDraft.display_name)
    const countryInput = (profileDraft.country_code ?? '').toString().trim()
    const countryCode  = countryInput === '' ? null : cleanCountryCode(countryInput)
    if (countryInput !== '' && countryCode === null) {
      setProfileError('Country must be a two-letter code, e.g. GB or US.')
      return
    }
    const marketplace = cleanMarketplacePreference(profileDraft.marketplace_preference)
    const patch = {
      display_name:           displayName,
      country_code:           countryCode,
      marketplace_preference: marketplace,
      updated_at:             new Date().toISOString(),
    }
    setProfileSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('user_id', user.id)
    setProfileSaving(false)
    if (error) {
      setProfileError(error.message || 'Could not save profile.')
      return
    }
    // Reflect the clean values back into the editor so the user sees
    // exactly what hit the database (e.g. uppercased country code).
    setProfileDraft({
      display_name:           displayName ?? '',
      country_code:           countryCode ?? '',
      marketplace_preference: marketplace,
    })
    setProfileSavedAt(Date.now())
  }

  async function deleteAccount() {
    if (!confirm('Permanently delete your account and all watchlist / alerts / portfolio data? This cannot be undone.')) return
    if (!confirm('Really delete? This wipes everything.')) return
    // Cascade rules in the DB will remove watchlist, alerts, prefs, portfolio_items etc.
    // We can't delete auth.users from the client; sign the user out and email luke for manual deletion if needed.
    alert('Sign-out only — to fully delete your account, please email contact@pokeprices.io and we will remove all your data within 7 days (UK GDPR).')
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
      <DashboardNav current="settings" email={user?.email} />

      <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, margin: '0 0 4px', color: 'var(--text)' }}>Settings</h1>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 24px' }}>
        Email preferences and account.
      </p>

      {loading || !prefs ? (
        <div className="skeleton" style={{ height: 200, borderRadius: 16 }} />
      ) : (
        <>
          {/* Avatar */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, marginBottom: 16 }}>
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 17, margin: '0 0 4px', color: 'var(--text)' }}>Avatar</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 18px' }}>
              The Pokémon that appears next to your name in the top bar.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Avatar
                pokemonId={avatarPokemonId}
                seed={user?.id}
                displayName={user?.user_metadata?.display_name || (user?.email ? user.email.split('@')[0] : null)}
                email={user?.email}
                size={64}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 8 }}>
                  {avatarPokemonId ? 'You have an avatar set. Pick a different one any time.' : 'No avatar yet — pick a Gen 1 Pokémon.'}
                </div>
                <button onClick={() => setPickerOpen(true)}
                  style={{
                    background: 'var(--primary)', color: '#fff', border: 'none',
                    padding: '7px 14px', borderRadius: 10, fontSize: 12, fontWeight: 800,
                    fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
                  }}
                >{avatarPokemonId ? 'Change avatar' : 'Choose avatar'}</button>
              </div>
            </div>
          </div>

          {/* Profile (Block 2A) */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, marginBottom: 16 }}>
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 17, margin: '0 0 4px', color: 'var(--text)' }}>Profile</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 18px' }}>
              Used to personalise your dashboard and to default new affiliate links to the marketplace closest to you.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, fontFamily: "'Figtree', sans-serif", display: 'block', marginBottom: 6 }}>
                  Display name
                </label>
                <input
                  type="text"
                  value={profileDraft.display_name ?? ''}
                  onChange={e => setProfileDraft(d => ({ ...d, display_name: e.target.value }))}
                  maxLength={PROFILE_LIMITS.displayName.max}
                  placeholder="What should we call you?"
                  style={{ width: '100%', padding: '10px 12px', fontSize: 13, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, fontFamily: "'Figtree', sans-serif", display: 'block', marginBottom: 6 }}>
                  Country (ISO code)
                </label>
                <input
                  type="text"
                  value={profileDraft.country_code ?? ''}
                  onChange={e => setProfileDraft(d => ({ ...d, country_code: e.target.value.toUpperCase().slice(0, 2) }))}
                  placeholder="GB, US…"
                  style={{ width: '100%', padding: '10px 12px', fontSize: 13, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box', textTransform: 'uppercase' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, fontFamily: "'Figtree', sans-serif", display: 'block', marginBottom: 6 }}>
                  Preferred marketplace
                </label>
                <select
                  value={profileDraft.marketplace_preference ?? ''}
                  onChange={e => setProfileDraft(d => ({ ...d, marketplace_preference: (e.target.value || null) as MarketplacePreference | null }))}
                  style={{ width: '100%', padding: '10px 12px', fontSize: 13, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box' }}
                >
                  <option value="">No preference</option>
                  {PROFILE_LIMITS.marketplacePreference.values.map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            </div>

            {profileError && (
              <p style={{ fontSize: 12, color: '#ef4444', fontFamily: "'Figtree', sans-serif", margin: '12px 0 0' }}>
                {profileError}
              </p>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
              <button onClick={saveProfile} disabled={profileSaving}
                style={{
                  background: 'var(--primary)', color: '#fff', border: 'none',
                  padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 800,
                  fontFamily: "'Figtree', sans-serif", cursor: profileSaving ? 'not-allowed' : 'pointer',
                  opacity: profileSaving ? 0.6 : 1,
                }}
              >
                {profileSaving ? 'Saving…' : 'Save profile'}
              </button>
              <span style={{ fontSize: 12, color: profileSavedAt ? '#22c55e' : 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                {profileSavedAt && Date.now() - profileSavedAt < 2500 ? 'Saved.' : ''}
              </span>
            </div>
          </div>

          {/* Display preferences */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, marginBottom: 16 }}>
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 17, margin: '0 0 4px', color: 'var(--text)' }}>Display preferences</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 18px' }}>
              How prices appear across your dashboard.
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '8px 0' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>Currency</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 3, lineHeight: 1.5 }}>
                  Card prices and your portfolio totals are displayed in this currency. Conversion is approximate (USD ↔ GBP at 1.27 / 0.79).
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {(['GBP', 'USD'] as const).map(c => (
                  <button
                    key={c}
                    onClick={() => update('display_currency', c)}
                    style={{
                      padding: '7px 14px', borderRadius: 10,
                      border: prefs.display_currency === c ? '1px solid var(--primary)' : '1px solid var(--border)',
                      background: prefs.display_currency === c ? 'rgba(26,95,173,0.08)' : 'transparent',
                      color: prefs.display_currency === c ? 'var(--primary)' : 'var(--text)',
                      fontSize: 13, fontWeight: 800, fontFamily: "'Figtree', sans-serif",
                      cursor: 'pointer',
                    }}
                  >
                    {c === 'GBP' ? '£ GBP' : '$ USD'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Email preferences card */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, marginBottom: 16 }}>
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 17, margin: '0 0 4px', color: 'var(--text)' }}>Email preferences</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 18px' }}>
              These are transactional emails about cards you watch. We never send marketing or share your address.
            </p>

            <Toggle
              label="Weekly digest"
              sub="Your watchlist this week — biggest movers and any cards near a target."
              value={prefs.weekly_digest_enabled}
              onChange={v => update('weekly_digest_enabled', v)}
            />

            <Toggle
              label="Alert emails"
              sub="When a smart alert triggers, send me an email."
              value={prefs.alert_emails_enabled}
              onChange={v => update('alert_emails_enabled', v)}
            />

            {prefs.alert_emails_enabled && (
              <div style={{ marginTop: 14, paddingLeft: 14, borderLeft: '2px solid var(--border)' }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, fontFamily: "'Figtree', sans-serif", display: 'block', marginBottom: 8 }}>
                  Alert delivery
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['daily', 'instant'] as const).map(c => (
                    <button key={c} onClick={() => update('alert_cadence', c)}
                      style={{
                        padding: '7px 14px', borderRadius: 10,
                        border: prefs.alert_cadence === c ? '1px solid var(--primary)' : '1px solid var(--border)',
                        background: prefs.alert_cadence === c ? 'rgba(26,95,173,0.08)' : 'transparent',
                        color: prefs.alert_cadence === c ? 'var(--primary)' : 'var(--text)',
                        fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
                      }}
                    >{c === 'daily' ? 'Daily digest' : 'Instant'}</button>
                  ))}
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '8px 0 0' }}>
                  {prefs.alert_cadence === 'daily'
                    ? 'One email per day with all triggered alerts. Recommended.'
                    : 'One email per alert as soon as it triggers. Can get noisy.'}
                </p>
              </div>
            )}

            {prefs.last_digest_sent_at && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '18px 0 0' }}>
                Last weekly digest sent: {new Date(prefs.last_digest_sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            )}

            <div style={{ marginTop: 12, fontSize: 11, color: savedAt ? '#22c55e' : 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", height: 14 }}>
              {saving ? 'Saving…' : savedAt && Date.now() - savedAt < 2000 ? 'Saved.' : ''}
            </div>
          </div>

          {/* Account card */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22 }}>
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 17, margin: '0 0 16px', color: 'var(--text)' }}>Account</h2>
            <Row label="Email" value={user?.email || '—'} />
            <Row label="Member since" value={user?.created_at ? new Date(user.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'} />

            <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--border-light)' }}>
              <button onClick={deleteAccount}
                style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', padding: '7px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}
              >Delete account</button>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '10px 0 0', lineHeight: 1.5 }}>
                Removes your watchlist, alerts and portfolio. Email contact@pokeprices.io to fully delete the auth record.
              </p>
            </div>
          </div>
        </>
      )}

      <AvatarPicker
        open={pickerOpen}
        currentPokemonId={avatarPokemonId}
        onClose={() => setPickerOpen(false)}
        onSaved={(id) => setAvatarPokemonId(id)}
      />
    </div>
  )
}

function Toggle({ label, sub, value, onChange }: {
  label: string; sub?: string; value: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '12px 0', borderBottom: '1px solid var(--border-light)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 3, lineHeight: 1.5 }}>{sub}</div>}
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-light)', fontFamily: "'Figtree', sans-serif" }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{value}</span>
    </div>
  )
}
