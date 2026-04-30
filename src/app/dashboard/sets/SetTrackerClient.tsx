'use client'
// Set Completion Tracker
// ──────────────────────
// Auto-detects sets you are working on (any set where you own ≥1 card),
// shows progress against the printed-total numerator (no secret rares by
// default), and surfaces the cheapest cards still missing. Clicking + Add
// opens the shared CardPortfolioAddModal — same one as the watchlist and
// card-page quick-add — so this is bidirectional with the portfolio.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import DashboardNav from '../DashboardNav'
import { CardPortfolioAddModal } from '@/components/CardQuickActions'

type Currency = 'GBP' | 'USD'

interface CardRow {
  card_url_slug: string
  card_name: string
  set_name: string
  card_number: string | null
  card_number_display: string | null
  set_printed_total: string | null
  is_sealed: boolean
  image_url: string | null
  raw_usd: number | null
  psa10_usd: number | null
}

interface SetProgress {
  set_name: string
  printed_total: number
  owned_count: number
  owned_value_cents: number
  missing: CardRow[]
  cheapest_missing: CardRow[]
  biggest_missing: CardRow | null
}

function fmt(cents: number | null | undefined, currency: Currency): string {
  if (!cents || cents <= 0) return '—'
  const v = currency === 'USD' ? cents / 100 : cents / 127
  if (v >= 1_000_000) return `${currency === 'USD' ? '$' : '£'}${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1000)      return `${currency === 'USD' ? '$' : '£'}${(v / 1000).toFixed(1)}k`
  return `${currency === 'USD' ? '$' : '£'}${v.toFixed(2)}`
}

// Card numbers come in messy shapes ("95", "95a", "TG12", "001"). Treat
// anything that parses to a positive integer ≤ printed_total as part of
// the base set; everything else (secret rares, promos, trainer gallery,
// etc.) is a "variant" and excluded by default.
function isInBaseSet(cardNumber: string | null, printedTotal: number): boolean {
  if (!cardNumber) return false
  const n = parseInt(cardNumber, 10)
  if (isNaN(n)) return false
  return n >= 1 && n <= printedTotal
}

export default function SetTrackerClient() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState<SetProgress[]>([])
  const [currency, setCurrency] = useState<Currency>('GBP')
  const [includeVariants, setIncludeVariants] = useState(false)
  const [addCard, setAddCard] = useState<CardRow | null>(null)

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

    // Display currency
    const { data: prefs } = await supabase
      .from('user_email_preferences')
      .select('display_currency').eq('user_id', user.id).maybeSingle()
      .then((res: any) => res.error ? { data: null } : res)
    const cur = (prefs as any)?.display_currency
    if (cur === 'USD' || cur === 'GBP') setCurrency(cur)

    // Default portfolio
    const { data: portfolios } = await supabase.from('portfolios')
      .select('id').eq('user_id', user.id).eq('is_default', true).limit(1)
    const pid = portfolios?.[0]?.id
    if (!pid) { setProgress([]); setLoading(false); return }

    // Owned card_url_slugs for this user (across grades)
    const { data: ownedRows } = await supabase
      .from('portfolio_items')
      .select('card_slug')
      .eq('portfolio_id', pid)
    const ownedSlugs = new Set((ownedRows || []).map((r: any) => r.card_slug).filter(Boolean))
    if (!ownedSlugs.size) { setProgress([]); setLoading(false); return }

    // What sets are those cards in? Pull the cards for the owned slugs to get their set_names.
    const { data: ownedCards } = await supabase
      .from('cards')
      .select('card_url_slug, set_name, is_sealed')
      .in('card_url_slug', Array.from(ownedSlugs))
    const setsTouched = Array.from(new Set(
      (ownedCards || [])
        .filter((c: any) => !c.is_sealed) // sealed products don't belong to a "completion" set
        .map((c: any) => c.set_name)
        .filter(Boolean)
    ))
    if (!setsTouched.length) { setProgress([]); setLoading(false); return }

    // Pull every non-sealed card for those sets in one hit. We need the
    // raw + psa10 trends for the "cheapest missing" / "biggest missing"
    // ranking, so go through card_trends as well.
    const [{ data: setCards }, { data: trends }] = await Promise.all([
      supabase
        .from('cards')
        .select('card_url_slug, card_name, set_name, card_number, card_number_display, set_printed_total, is_sealed, image_url')
        .in('set_name', setsTouched)
        .eq('is_sealed', false),
      supabase
        .from('card_trends')
        .select('card_name, set_name, current_raw, current_psa10')
        .in('set_name', setsTouched),
    ])

    const trendByKey: Record<string, { current_raw: number | null; current_psa10: number | null }> = {}
    for (const t of (trends || [])) {
      trendByKey[`${t.card_name}::${t.set_name}`] = {
        current_raw: t.current_raw, current_psa10: t.current_psa10,
      }
    }

    // Group cards by set
    const bySet = new Map<string, CardRow[]>()
    for (const c of (setCards || [])) {
      const tr = trendByKey[`${c.card_name}::${c.set_name}`]
      const row: CardRow = {
        card_url_slug:       c.card_url_slug,
        card_name:           c.card_name,
        set_name:            c.set_name,
        card_number:         c.card_number,
        card_number_display: c.card_number_display,
        set_printed_total:   c.set_printed_total,
        is_sealed:           !!c.is_sealed,
        image_url:           c.image_url,
        raw_usd:             tr?.current_raw ?? null,
        psa10_usd:           tr?.current_psa10 ?? null,
      }
      if (!bySet.has(c.set_name)) bySet.set(c.set_name, [])
      bySet.get(c.set_name)!.push(row)
    }

    const out: SetProgress[] = []
    for (const [setName, cards] of Array.from(bySet.entries())) {
      const printedTotal = parseInt(cards[0]?.set_printed_total || '0', 10)
      // Filter to base set unless the user wants variants
      const inScope = (c: CardRow) =>
        includeVariants
          ? true
          : (printedTotal > 0 && isInBaseSet(c.card_number, printedTotal))
      const scoped = cards.filter(inScope)
      const owned   = scoped.filter(c => ownedSlugs.has(c.card_url_slug))
      const missing = scoped.filter(c => !ownedSlugs.has(c.card_url_slug))
      const ownedValue = owned.reduce((s, c) => s + (c.raw_usd || 0), 0)
      const cheapest = [...missing]
        .filter(c => (c.raw_usd ?? 0) > 0)
        .sort((a, b) => (a.raw_usd! - b.raw_usd!))
        .slice(0, 6)
      const biggest = [...missing]
        .filter(c => (c.raw_usd ?? 0) > 0)
        .sort((a, b) => (b.raw_usd! - a.raw_usd!))[0] || null

      const denom = includeVariants ? scoped.length : (printedTotal || scoped.length)
      out.push({
        set_name: setName,
        printed_total: denom,
        owned_count: owned.length,
        owned_value_cents: ownedValue,
        missing,
        cheapest_missing: cheapest,
        biggest_missing: biggest,
      })
    }

    // Sort by furthest-along first
    out.sort((a, b) => (b.owned_count / Math.max(1, b.printed_total)) - (a.owned_count / Math.max(1, a.printed_total)))
    setProgress(out)
    setLoading(false)
  }, [user, includeVariants])

  useEffect(() => { load() }, [load])

  const empty = useMemo(() => !loading && progress.length === 0, [loading, progress])

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
      <DashboardNav current="sets" email={user?.email} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, margin: '0 0 4px', color: 'var(--text)' }}>Set Completion</h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.6 }}>
            Sets you are working on, ranked by how close you are to finishing. Cards in your portfolio count automatically.
          </p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={includeVariants} onChange={e => setIncludeVariants(e.target.checked)} />
          Include secret rares + variants
        </label>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2].map(i => <div key={i} className="skeleton" style={{ height: 180, borderRadius: 16 }} />)}
        </div>
      ) : empty ? (
        <div style={{ background: 'var(--card)', border: '2px dashed var(--border)', borderRadius: 20, padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>🧩</div>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, margin: '0 0 8px', color: 'var(--text)' }}>Add a card to get started</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 20px', maxWidth: 420, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
            As soon as you have at least one card from a set in your portfolio, that set will appear here with progress, missing cards and cheapest path to finish.
          </p>
          <Link href="/dashboard/portfolio" style={{ padding: '11px 22px', borderRadius: 12, background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif", textDecoration: 'none' }}>
            Open portfolio
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {progress.map(p => <SetCard key={p.set_name} set={p} currency={currency} onAdd={c => setAddCard(c)} />)}
        </div>
      )}

      {addCard && user && (
        <CardPortfolioAddModal
          card={{
            card_slug: addCard.card_url_slug,
            card_name: addCard.card_name,
            set_name: addCard.set_name,
            card_url_slug: addCard.card_url_slug,
            image_url: addCard.image_url,
            card_number: addCard.card_number,
            card_number_display: addCard.card_number_display,
            raw_usd: addCard.raw_usd,
            psa10_usd: addCard.psa10_usd,
          }}
          cardSlug={addCard.card_url_slug.replace(/^pc-/, '')}
          user={user}
          onClose={() => { setAddCard(null); load() }}
        />
      )}
    </div>
  )
}

function SetCard({ set, currency, onAdd }: {
  set: SetProgress
  currency: Currency
  onAdd: (card: CardRow) => void
}) {
  const pct = Math.min(100, Math.round((set.owned_count / Math.max(1, set.printed_total)) * 100))
  const remainingCost = set.cheapest_missing.reduce((s, c) => s + (c.raw_usd || 0), 0)
  const allMissingCost = set.missing.reduce((s, c) => s + (c.raw_usd || 0), 0)

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        <div>
          <Link href={`/set/${encodeURIComponent(set.set_name)}`} style={{ textDecoration: 'none' }}>
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: '0 0 4px', color: 'var(--text)' }}>{set.set_name}</h2>
          </Link>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
            {set.owned_count} / {set.printed_total} owned · {set.missing.length} missing
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: pct === 100 ? '#22c55e' : 'var(--primary)', fontFamily: "'Figtree', sans-serif", lineHeight: 1 }}>{pct}%</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 2 }}>complete</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-light)', overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#22c55e' : 'var(--primary)', transition: 'width 0.3s' }} />
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Stat label="Value owned"  value={fmt(set.owned_value_cents, currency)} />
        <Stat label="To finish"    value={fmt(allMissingCost, currency)} sub="(raw, sum of missing)" />
        {set.biggest_missing && (
          <Stat
            label="Biggest gap"
            value={fmt(set.biggest_missing.raw_usd, currency)}
            sub={set.biggest_missing.card_name}
          />
        )}
      </div>

      {/* Cheapest missing */}
      {set.cheapest_missing.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 8 }}>
            Cheapest missing — {fmt(remainingCost, currency)} for the next {set.cheapest_missing.length}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
            {set.cheapest_missing.map(c => (
              <div key={c.card_url_slug} style={{ background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <Link href={`/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}`} style={{ textDecoration: 'none' }}>
                  {c.image_url
                    ? <img src={c.image_url} alt={c.card_name} style={{ width: 76, height: 106, objectFit: 'contain', borderRadius: 4 }} loading="lazy" />
                    : <div style={{ width: 76, height: 106, background: 'var(--bg)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🃏</div>}
                </Link>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", textAlign: 'center', lineHeight: 1.3, width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.card_name}>
                  {c.card_name}
                </div>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif" }}>
                  {fmt(c.raw_usd, currency)}
                </div>
                <button onClick={() => onAdd(c)}
                  style={{ width: '100%', padding: '5px 8px', borderRadius: 8, border: '1px solid var(--primary)', background: 'rgba(26,95,173,0.08)', color: 'var(--primary)', fontSize: 11, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}
                >+ Add</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: 'var(--bg-light)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.7, fontFamily: "'Figtree', sans-serif", marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  )
}
