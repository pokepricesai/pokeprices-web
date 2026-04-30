'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import DashboardNav from '../DashboardNav'
import { CardPortfolioAddModal } from '@/components/CardQuickActions'

interface WatchItem {
  id: string
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string | null
  image_url: string | null
  card_number: string | null
  notes: string | null
  added_at: string
  raw_at_add: number | null
  psa10_at_add: number | null
  current_raw: number | null
  current_psa9: number | null
  current_psa10: number | null
  pct_7d: number | null
  pct_30d: number | null
  psa10_premium: number | null
}

function fmtUsd(cents: number | null | undefined): string {
  if (!cents || cents <= 0) return '—'
  const v = cents / 100
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  return `$${v.toFixed(2)}`
}

function fmtPct(pct: number | null | undefined): { text: string; color: string } {
  if (pct == null) return { text: '—', color: 'var(--text-muted)' }
  const color = pct > 0 ? '#22c55e' : pct < 0 ? '#ef4444' : 'var(--text-muted)'
  return { text: `${pct > 0 ? '+' : ''}${Number(pct).toFixed(1)}%`, color }
}

function pctSinceAdd(now: number | null, then: number | null): number | null {
  if (!now || !then || then <= 0) return null
  return ((now - then) / then) * 100
}

// ── Add modal ────────────────────────────────────────────────────────────────

function AddWatchModal({ onAdd, onClose }: { onAdd: (card: any) => Promise<void>; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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

  async function handleSelect(card: any) {
    setSaving(true)
    setError('')
    try {
      await onAdd(card)
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Failed to add card')
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '7vh' }}
      onClick={onClose}
    >
      <div style={{ background: 'var(--card)', borderRadius: 18, padding: 22, width: '92%', maxWidth: 520, maxHeight: '80vh', overflow: 'auto', border: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: 0, color: 'var(--text)' }}>Add to watchlist</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>×</button>
        </div>

        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search a card by name…"
          style={{ width: '100%', padding: '11px 14px', fontSize: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box', marginBottom: 12 }}
        />

        {error && <p style={{ fontSize: 12, color: '#ef4444', fontFamily: "'Figtree', sans-serif", margin: '0 0 10px' }}>{error}</p>}
        {searching && <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '4px 0' }}>Searching…</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {results.map(r => (
            <button key={`${r.card_slug}|${r.set_name}`} onClick={() => !saving && handleSelect(r)} disabled={saving}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'var(--bg-light)',
                cursor: saving ? 'wait' : 'pointer', textAlign: 'left',
                fontFamily: "'Figtree', sans-serif",
              }}
            >
              {r.image_url
                ? <img src={r.image_url} alt={r.name} style={{ width: 32, height: 44, objectFit: 'contain', borderRadius: 3 }} />
                : <div style={{ width: 32, height: 44, background: 'var(--bg)', borderRadius: 3 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {r.subtitle || r.set_name}
                  {r.card_number_display && ` · ${r.card_number_display}`}
                </div>
              </div>
              {r.price_usd != null && r.price_usd > 0 && (
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--primary)', flexShrink: 0, fontFamily: "'Figtree', sans-serif" }}>
                  {fmtUsd(r.price_usd)}
                </div>
              )}
            </button>
          ))}
          {!searching && query.length >= 2 && results.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textAlign: 'center', padding: 20 }}>
              No cards found.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main client ──────────────────────────────────────────────────────────────

export default function WatchlistClient() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [items, setItems] = useState<WatchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [sortBy, setSortBy] = useState<'added' | 'pct_30d' | 'pct_since' | 'value' | 'name'>('added')
  const [portfolioAddItem, setPortfolioAddItem] = useState<WatchItem | null>(null)

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
    const { data, error } = await supabase.rpc('get_watchlist_with_prices', { p_user_id: user.id })
    if (error) {
      console.error('[watchlist] get_watchlist_with_prices failed:', error)
      // Fallback so the row at least appears even if the RPC is missing
      const { data: rows } = await supabase
        .from('watchlist')
        .select('id, card_slug, card_name, set_name, card_url_slug, image_url, card_number, notes, added_at, raw_at_add, psa10_at_add')
        .eq('user_id', user.id)
        .order('added_at', { ascending: false })
      setItems((rows || []).map(r => ({
        ...r,
        current_raw: null, current_psa9: null, current_psa10: null,
        pct_7d: null, pct_30d: null, psa10_premium: null,
      })))
    } else {
      setItems(data || [])
    }
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  async function handleAdd(card: any) {
    if (!user) return
    // search_global returns `url_slug`; card-page payloads supply `card_url_slug`
    const cardSlug = (card.url_slug || card.card_url_slug || card.card_slug || '').toString().replace(/^pc-/, '')
    const setName  = card.subtitle || card.set_name
    const cardName = card.name || card.card_name
    if (!cardSlug || !setName || !cardName) throw new Error('Missing card data')

    // Snapshot current prices to enable "since added" tracking
    const { data: trend } = await supabase
      .from('card_trends')
      .select('current_raw, current_psa10')
      .eq('card_name', cardName)
      .eq('set_name', setName)
      .maybeSingle()

    const { error } = await supabase.from('watchlist').insert([{
      user_id: user.id,
      card_slug: cardSlug,
      card_name: cardName,
      set_name: setName,
      card_url_slug: cardSlug,
      image_url: card.image_url || null,
      card_number: card.card_number_display || card.card_number || null,
      raw_at_add: trend?.current_raw ?? null,
      psa10_at_add: trend?.current_psa10 ?? null,
    }])
    if (error) {
      if (error.code === '23505') throw new Error('Already in your watchlist')
      throw error
    }
    await load()
  }

  async function handleRemove(id: string) {
    if (!confirm('Remove from watchlist?')) return
    await supabase.from('watchlist').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const sorted = [...items].sort((a, b) => {
    if (sortBy === 'pct_30d')   return (b.pct_30d   ?? -999) - (a.pct_30d   ?? -999)
    if (sortBy === 'value')     return (b.current_psa10 ?? b.current_raw ?? 0) - (a.current_psa10 ?? a.current_raw ?? 0)
    if (sortBy === 'name')      return a.card_name.localeCompare(b.card_name)
    if (sortBy === 'pct_since') {
      const ap = pctSinceAdd(a.current_raw, a.raw_at_add) ?? -999
      const bp = pctSinceAdd(b.current_raw, b.raw_at_add) ?? -999
      return bp - ap
    }
    return new Date(b.added_at).getTime() - new Date(a.added_at).getTime()
  })

  // Quick stats
  const total           = items.length
  const totalUsd        = items.reduce((s, i) => s + (i.current_raw || 0), 0)
  const avgPct30d       = items.filter(i => i.pct_30d != null).length
                          ? items.filter(i => i.pct_30d != null).reduce((s, i) => s + (i.pct_30d || 0), 0) / items.filter(i => i.pct_30d != null).length
                          : null
  const risers          = items.filter(i => (i.pct_30d ?? 0) > 0).length
  const fallers         = items.filter(i => (i.pct_30d ?? 0) < 0).length

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
      <DashboardNav current="watchlist" email={user?.email} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, margin: '0 0 4px', color: 'var(--text)' }}>Watchlist</h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0 }}>
            Cards you are watching — current value, 7d / 30d change, PSA premium.
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} style={{
          padding: '9px 20px', borderRadius: 10, border: 'none',
          background: 'var(--primary)', color: '#fff',
          fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
        }}>+ Watch a card</button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 78, borderRadius: 12 }} />)}
        </div>
      ) : items.length === 0 ? (
        <div style={{ background: 'var(--card)', border: '2px dashed var(--border)', borderRadius: 20, padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 14 }}>👁</div>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 8px', color: 'var(--text)' }}>Build your watchlist</h2>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 24px', maxWidth: 420, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
            Track cards you don&apos;t own yet. See current value, 7d/30d movement and PSA premium at a glance.
          </p>
          <button onClick={() => setShowAdd(true)} style={{
            padding: '12px 28px', borderRadius: 12, border: 'none',
            background: 'var(--primary)', color: '#fff',
            fontSize: 15, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
          }}>+ Watch a card</button>
        </div>
      ) : (
        <>
          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 18 }}>
            {[
              { label: 'Watching', value: String(total), sub: 'cards' },
              ...(avgPct30d != null ? [{ label: 'Avg 30d', value: fmtPct(avgPct30d).text, color: fmtPct(avgPct30d).color, sub: 'across watchlist' }] : []),
              { label: 'Rising 30d', value: String(risers), sub: `${fallers} falling`, color: '#22c55e' },
              { label: 'Total raw value', value: fmtUsd(totalUsd), sub: 'USD' },
            ].map((s, i) => (
              <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px' }}>
                <div style={{ fontSize: 20, fontWeight: 900, color: (s as any).color || 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1, marginBottom: 4 }}>{s.value}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>{s.label}</div>
                {s.sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{s.sub}</div>}
              </div>
            ))}
          </div>

          {/* Sort */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {([
              ['added',     'Recently added'],
              ['pct_30d',   'Best 30d'],
              ['pct_since', 'Best since added'],
              ['value',     'Highest value'],
              ['name',      'A–Z'],
            ] as const).map(([val, label]) => (
              <button key={val} onClick={() => setSortBy(val)}
                style={{
                  padding: '5px 11px', borderRadius: 14,
                  border: sortBy === val ? '1px solid var(--primary)' : '1px solid var(--border)',
                  background: sortBy === val ? 'rgba(26,95,173,0.08)' : 'transparent',
                  color: sortBy === val ? 'var(--primary)' : 'var(--text-muted)',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  fontFamily: "'Figtree', sans-serif",
                }}
              >{label}</button>
            ))}
          </div>

          {/* List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sorted.map(item => {
              const cardUrl  = `/set/${encodeURIComponent(item.set_name)}/card/${item.card_url_slug || item.card_slug}`
              const pct30    = fmtPct(item.pct_30d)
              const pct7     = fmtPct(item.pct_7d)
              const pctSince = pctSinceAdd(item.current_raw, item.raw_at_add)
              const sinceFmt = fmtPct(pctSince)
              const premium  = item.psa10_premium ? `${item.psa10_premium.toFixed(1)}×` : '—'

              return (
                <div key={item.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <Link href={cardUrl} style={{ flexShrink: 0 }}>
                    {item.image_url
                      ? <img src={item.image_url} alt={item.card_name} style={{ width: 42, height: 58, objectFit: 'contain', borderRadius: 4 }} loading="lazy" />
                      : <div style={{ width: 42, height: 58, background: 'var(--bg-light)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🃏</div>}
                  </Link>

                  <div style={{ flex: 1, minWidth: 140 }}>
                    <Link href={cardUrl} style={{ textDecoration: 'none' }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.3, marginBottom: 2 }}>
                        {item.card_name}{item.card_number ? ` · ${item.card_number}` : ''}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                        {item.set_name}
                      </div>
                    </Link>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: 18, alignItems: 'center' }}>
                    <Stat label="Raw"     value={fmtUsd(item.current_raw)} />
                    <Stat label="PSA 10"  value={fmtUsd(item.current_psa10)} />
                    <Stat label="30d"     value={pct30.text} color={pct30.color} />
                    <Stat label="Premium" value={premium} />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', minWidth: 100 }}>
                    {pctSince != null && (
                      <div style={{ fontSize: 11, fontFamily: "'Figtree', sans-serif", color: 'var(--text-muted)' }}>
                        Since added: <span style={{ color: sinceFmt.color, fontWeight: 700 }}>{sinceFmt.text}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button onClick={() => setPortfolioAddItem(item)}
                        style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, border: '1px solid var(--primary)', background: 'rgba(26,95,173,0.08)', color: 'var(--primary)', cursor: 'pointer', fontFamily: "'Figtree', sans-serif", fontWeight: 700 }}
                      >+ Add to portfolio</button>
                      <button onClick={() => handleRemove(item.id)}
                        style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: "'Figtree', sans-serif", fontWeight: 600 }}
                      >Remove</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {showAdd && <AddWatchModal onAdd={handleAdd} onClose={() => setShowAdd(false)} />}

      {portfolioAddItem && user && (
        <CardPortfolioAddModal
          card={{
            card_slug: portfolioAddItem.card_slug,
            card_name: portfolioAddItem.card_name,
            set_name: portfolioAddItem.set_name,
            card_url_slug: portfolioAddItem.card_url_slug,
            image_url: portfolioAddItem.image_url,
            card_number: portfolioAddItem.card_number,
            raw_usd: portfolioAddItem.current_raw,
            psa10_usd: portfolioAddItem.current_psa10,
          }}
          cardSlug={(portfolioAddItem.card_url_slug || portfolioAddItem.card_slug).replace(/^pc-/, '')}
          user={user}
          onClose={() => setPortfolioAddItem(null)}
        />
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 13, fontWeight: 800, fontFamily: "'Figtree', sans-serif", color: color || 'var(--text)', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.7, fontFamily: "'Figtree', sans-serif", marginTop: 2 }}>{label}</div>
    </div>
  )
}
