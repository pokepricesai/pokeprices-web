'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import DashboardNav from '../DashboardNav'

interface AlertRow {
  id: string
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string | null
  image_url: string | null
  grade: 'raw' | 'psa9' | 'psa10'
  alert_type: 'price_below' | 'price_above'
  threshold_cents: number
  is_active: boolean
  triggered_at: string | null
  created_at: string
  current_cents: number | null
  distance_pct: number | null
}

const GRADE_LABELS: Record<string, string> = {
  raw: 'Raw', psa9: 'PSA 9', psa10: 'PSA 10',
}

function fmtUsd(cents: number | null | undefined): string {
  if (cents == null) return '—'
  const v = cents / 100
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  return `$${v.toFixed(2)}`
}

// ── Modal: create / edit alert ───────────────────────────────────────────────

function AlertModal({
  initialCard,
  onSave,
  onClose,
}: {
  initialCard?: any
  onSave: (data: any) => Promise<void>
  onClose: () => void
}) {
  const [step, setStep]               = useState<'card' | 'config'>(initialCard ? 'config' : 'card')
  const [card, setCard]               = useState<any>(initialCard || null)
  const [query, setQuery]             = useState('')
  const [results, setResults]         = useState<any[]>([])
  const [searching, setSearching]     = useState(false)
  const [grade, setGrade]             = useState<'raw' | 'psa9' | 'psa10'>('psa10')
  const [alertType, setAlertType]     = useState<'price_below' | 'price_above'>('price_below')
  const [thresholdUsd, setThresholdUsd] = useState('')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  useEffect(() => {
    if (!query.trim() || query.length < 2) { setResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      const { data } = await supabase.rpc('search_global', { query })
      const cards = (data || []).filter((r: any) => r.result_type === 'card').slice(0, 12)
      setResults(cards)
      setSearching(false)
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  async function handleSave() {
    if (!card) { setError('Select a card first'); return }
    const usd = parseFloat(thresholdUsd)
    if (!Number.isFinite(usd) || usd <= 0) { setError('Enter a valid USD price'); return }
    setSaving(true)
    setError('')
    try {
      await onSave({
        card,
        grade,
        alert_type: alertType,
        threshold_cents: Math.round(usd * 100),
      })
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Failed to save alert')
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '7vh' }}
      onClick={onClose}
    >
      <div style={{ background: 'var(--card)', borderRadius: 18, padding: 22, width: '92%', maxWidth: 480, maxHeight: '80vh', overflow: 'auto', border: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: 0, color: 'var(--text)' }}>
            {step === 'card' ? 'Pick a card' : 'Set alert'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>×</button>
        </div>

        {step === 'card' ? (
          <>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search a card by name…"
              style={{ width: '100%', padding: '11px 14px', fontSize: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box', marginBottom: 12 }}
            />
            {searching && <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Searching…</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {results.map(r => (
                <button key={`${r.card_slug}|${r.set_name}`}
                  onClick={() => { setCard(r); setStep('config') }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 10,
                    border: '1px solid var(--border)', background: 'var(--bg-light)',
                    cursor: 'pointer', textAlign: 'left',
                    fontFamily: "'Figtree', sans-serif",
                  }}
                >
                  {r.image_url
                    ? <img src={r.image_url} alt={r.name} style={{ width: 32, height: 44, objectFit: 'contain', borderRadius: 3 }} />
                    : <div style={{ width: 32, height: 44, background: 'var(--bg)', borderRadius: 3 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.subtitle || r.set_name}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Card preview */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--bg-light)', marginBottom: 16 }}>
              {card?.image_url
                ? <img src={card.image_url} alt={card.name || card.card_name} style={{ width: 36, height: 50, objectFit: 'contain', borderRadius: 3 }} />
                : <div style={{ width: 36, height: 50, background: 'var(--bg)', borderRadius: 3 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
                  {card?.name || card?.card_name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                  {card?.subtitle || card?.set_name}
                </div>
              </div>
              {!initialCard && (
                <button onClick={() => setStep('card')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', fontFamily: "'Figtree', sans-serif", textDecoration: 'underline' }}>
                  Change
                </button>
              )}
            </div>

            {/* Grade */}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Grade</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['raw', 'psa9', 'psa10'] as const).map(g => (
                  <button key={g} onClick={() => setGrade(g)}
                    style={{
                      flex: 1, padding: '9px 12px', borderRadius: 10,
                      border: grade === g ? '1px solid var(--primary)' : '1px solid var(--border)',
                      background: grade === g ? 'rgba(26,95,173,0.08)' : 'transparent',
                      color: grade === g ? 'var(--primary)' : 'var(--text)',
                      fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
                    }}
                  >{GRADE_LABELS[g]}</button>
                ))}
              </div>
            </div>

            {/* Type */}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Alert me when price</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['price_below', 'price_above'] as const).map(t => (
                  <button key={t} onClick={() => setAlertType(t)}
                    style={{
                      flex: 1, padding: '9px 12px', borderRadius: 10,
                      border: alertType === t ? '1px solid var(--primary)' : '1px solid var(--border)',
                      background: alertType === t ? 'rgba(26,95,173,0.08)' : 'transparent',
                      color: alertType === t ? 'var(--primary)' : 'var(--text)',
                      fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
                    }}
                  >{t === 'price_below' ? '↓ Drops below' : '↑ Rises above'}</button>
                ))}
              </div>
            </div>

            {/* Threshold */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Threshold (USD)</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", fontSize: 14 }}>$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={thresholdUsd}
                  onChange={e => setThresholdUsd(e.target.value)}
                  placeholder="100.00"
                  style={{ width: '100%', padding: '11px 14px 11px 26px', fontSize: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            {error && <p style={{ fontSize: 12, color: '#ef4444', fontFamily: "'Figtree', sans-serif", margin: '0 0 12px' }}>{error}</p>}

            <button onClick={handleSave} disabled={saving}
              style={{ width: '100%', padding: '11px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Saving…' : 'Save alert'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: 6,
  fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: 0.8,
  fontFamily: "'Figtree', sans-serif",
}

// ── Main client ──────────────────────────────────────────────────────────────

export default function AlertsClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const newFromCard = searchParams.get('new')
  const [user, setUser] = useState<any>(null)
  const [alerts, setAlerts] = useState<AlertRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [prefilledCard, setPrefilledCard] = useState<any>(null)
  const [filter, setFilter] = useState<'active' | 'triggered' | 'paused' | 'all'>('active')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/dashboard/login'); return }
      setUser(session.user)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) router.push('/dashboard/login')
      else setUser(session.user)
    })
    return () => subscription.unsubscribe()
  }, [])

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data, error } = await supabase.rpc('get_alerts_with_prices', { p_user_id: user.id })
    if (error) {
      console.error('[alerts] get_alerts_with_prices failed:', error)
      // Fall back to direct table read so the alert at least shows up
      const { data: rows, error: tableErr } = await supabase
        .from('user_alerts')
        .select('id, card_slug, card_name, set_name, card_url_slug, image_url, grade, alert_type, threshold_cents, is_active, triggered_at, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (tableErr) console.error('[alerts] fallback select failed:', tableErr)
      setAlerts((rows || []).map(r => ({ ...r, current_cents: null, distance_pct: null })))
    } else {
      setAlerts(data || [])
    }
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  // Deep-link from /watchlist?new=card_slug — pre-fill the modal
  useEffect(() => {
    if (!newFromCard || !user) return
    async function loadCard() {
      // The deep-link slug is the URL slug (matches watchlist.card_slug convention)
      const { data } = await supabase
        .from('cards')
        .select('card_name, set_name, card_slug, card_url_slug, image_url')
        .eq('card_url_slug', newFromCard)
        .maybeSingle()
      if (data) {
        setPrefilledCard({
          ...data,
          name: data.card_name,
          subtitle: data.set_name,
          url_slug: data.card_url_slug || data.card_slug,
        })
        setShowModal(true)
      }
    }
    loadCard()
  }, [newFromCard, user])

  async function handleSave(input: any) {
    if (!user) return
    const c = input.card
    const cardSlug = (c.url_slug || c.card_url_slug || c.card_slug || '').toString().replace(/^pc-/, '')
    const setName  = c.subtitle || c.set_name
    const cardName = c.name || c.card_name
    if (!cardSlug || !setName || !cardName) throw new Error('Missing card data')
    const { error } = await supabase.from('user_alerts').insert([{
      user_id: user.id,
      card_slug: cardSlug,
      card_name: cardName,
      set_name: setName,
      card_url_slug: cardSlug,
      image_url: c.image_url || null,
      grade: input.grade,
      alert_type: input.alert_type,
      threshold_cents: input.threshold_cents,
    }])
    if (error) throw error
    await load()
  }

  async function togglePause(id: string, isActive: boolean) {
    await supabase.from('user_alerts').update({ is_active: !isActive, triggered_at: null }).eq('id', id)
    await load()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this alert?')) return
    await supabase.from('user_alerts').delete().eq('id', id)
    setAlerts(prev => prev.filter(a => a.id !== id))
  }

  const filtered = alerts.filter(a => {
    if (filter === 'active')    return a.is_active
    if (filter === 'triggered') return a.triggered_at != null
    if (filter === 'paused')    return !a.is_active
    return true
  })

  const counts = {
    active:    alerts.filter(a => a.is_active).length,
    triggered: alerts.filter(a => a.triggered_at != null).length,
    paused:    alerts.filter(a => !a.is_active).length,
    all:       alerts.length,
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
      <DashboardNav current="alerts" email={user?.email} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, margin: '0 0 4px', color: 'var(--text)' }}>Smart Alerts</h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0 }}>
            Get notified when a card drops below — or rises above — your target price.
          </p>
        </div>
        <button onClick={() => { setPrefilledCard(null); setShowModal(true) }} style={{
          padding: '9px 20px', borderRadius: 10, border: 'none',
          background: 'var(--primary)', color: '#fff',
          fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
        }}>+ New alert</button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 78, borderRadius: 12 }} />)}
        </div>
      ) : alerts.length === 0 ? (
        <div style={{ background: 'var(--card)', border: '2px dashed var(--border)', borderRadius: 20, padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 14 }}>🔔</div>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 8px', color: 'var(--text)' }}>No alerts yet</h2>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 24px', maxWidth: 420, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
            Set a target price for any card. We&apos;ll let you know the moment it crosses your threshold.
          </p>
          <button onClick={() => setShowModal(true)} style={{
            padding: '12px 28px', borderRadius: 12, border: 'none',
            background: 'var(--primary)', color: '#fff',
            fontSize: 15, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
          }}>+ Create your first alert</button>
        </div>
      ) : (
        <>
          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {([
              ['active',    `Active (${counts.active})`],
              ['triggered', `Triggered (${counts.triggered})`],
              ['paused',    `Paused (${counts.paused})`],
              ['all',       `All (${counts.all})`],
            ] as const).map(([val, label]) => (
              <button key={val} onClick={() => setFilter(val)}
                style={{
                  padding: '6px 12px', borderRadius: 14,
                  border: filter === val ? '1px solid var(--primary)' : '1px solid var(--border)',
                  background: filter === val ? 'rgba(26,95,173,0.08)' : 'transparent',
                  color: filter === val ? 'var(--primary)' : 'var(--text-muted)',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  fontFamily: "'Figtree', sans-serif",
                }}
              >{label}</button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(a => {
              const cardUrl = `/set/${encodeURIComponent(a.set_name)}/card/${a.card_url_slug || a.card_slug}`
              const dirSym  = a.alert_type === 'price_below' ? '↓' : '↑'
              const dirText = a.alert_type === 'price_below' ? 'Below' : 'Above'
              const triggered = a.triggered_at != null

              return (
                <div key={a.id} style={{
                  background: 'var(--card)',
                  border: triggered ? '1px solid #22c55e' : '1px solid var(--border)',
                  borderRadius: 14, padding: '12px 14px',
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  opacity: a.is_active ? 1 : 0.55,
                  boxShadow: triggered ? '0 0 0 4px rgba(34,197,94,0.1)' : undefined,
                }}>
                  <Link href={cardUrl} style={{ flexShrink: 0 }}>
                    {a.image_url
                      ? <img src={a.image_url} alt={a.card_name} style={{ width: 42, height: 58, objectFit: 'contain', borderRadius: 4 }} loading="lazy" />
                      : <div style={{ width: 42, height: 58, background: 'var(--bg-light)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🃏</div>}
                  </Link>

                  <div style={{ flex: 1, minWidth: 160 }}>
                    <Link href={cardUrl} style={{ textDecoration: 'none' }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.3, marginBottom: 2 }}>
                        {a.card_name}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                        {a.set_name}
                      </div>
                    </Link>
                    <div style={{ marginTop: 6, fontSize: 12, fontFamily: "'Figtree', sans-serif", color: 'var(--text)' }}>
                      <span style={{ fontWeight: 700 }}>{GRADE_LABELS[a.grade]}</span>{' '}
                      <span style={{ color: 'var(--text-muted)' }}>{dirSym} {dirText}</span>{' '}
                      <span style={{ fontWeight: 800 }}>{fmtUsd(a.threshold_cents)}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, minWidth: 120 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, fontFamily: "'Figtree', sans-serif", color: 'var(--text)' }}>
                      Now: {fmtUsd(a.current_cents)}
                    </div>
                    {a.distance_pct != null && (
                      <div style={{
                        fontSize: 11, fontFamily: "'Figtree', sans-serif",
                        color: triggered ? '#22c55e'
                          : a.alert_type === 'price_below'
                            ? (a.distance_pct >= 0 ? 'var(--text-muted)' : '#22c55e')
                            : (a.distance_pct >= 0 ? '#22c55e' : 'var(--text-muted)'),
                        fontWeight: 700,
                      }}>
                        {triggered ? '✓ Triggered' : `${a.distance_pct >= 0 ? '+' : ''}${a.distance_pct.toFixed(1)}% from target`}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => togglePause(a.id, a.is_active)}
                      style={{ fontSize: 11, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: "'Figtree', sans-serif", fontWeight: 600 }}
                    >{a.is_active ? 'Pause' : 'Resume'}</button>
                    <button onClick={() => handleDelete(a.id)}
                      style={{ fontSize: 11, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: "'Figtree', sans-serif", fontWeight: 600 }}
                    >Delete</button>
                  </div>
                </div>
              )
            })}
            {filtered.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textAlign: 'center', padding: 24 }}>
                No alerts in this view.
              </p>
            )}
          </div>
        </>
      )}

      {showModal && (
        <AlertModal
          initialCard={prefilledCard}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setPrefilledCard(null); router.replace('/dashboard/alerts') }}
        />
      )}
    </div>
  )
}
