'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  buildXShareUrl,
  fmtUsd, fmtGbp, priceAccuracyPct, cleanCardName,
} from '@/lib/gamesUtil'

interface DailyCard {
  card_name: string
  set_name: string
  image_url: string | null
  card_url_slug: string | null
  card_number: string | null
  card_number_display: string | null
  set_printed_total: string | null
  current_raw: number
  current_psa10: number | null
  sales_30d: number | null
}

interface Result {
  guess: number      // user's guess in cents
  actual: number     // actual raw_usd in cents
  accuracy: number   // 0-100
}

export default function GuessPriceClient() {
  const [pool, setPool] = useState<DailyCard[]>([])
  const [card, setCard] = useState<DailyCard | null>(null)
  const [loading, setLoading] = useState(true)
  const [guess, setGuess] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load the candidate pool once, then pick a fresh card per game.
  useEffect(() => {
    (async () => {
      const { data, error: e } = await supabase.from('popular_card_trends')
        .select('card_name, set_name, image_url, card_url_slug, card_number, card_number_display, set_printed_total, current_raw, current_psa10, sales_30d, is_sealed')
        .gte('current_raw', 1500)
        .lte('current_raw', 200000)
        .order('sales_30d', { ascending: false })
        .limit(200)
      if (e) { setError(e.message); setLoading(false); return }
      const cleaned = (data || []).filter((c: any) => {
        if (c.is_sealed) return false
        const n = c.card_name || ''
        if (/booster|elite|tin|blister|bundle|binder|collection|deck|2[-\s]*pack|3[-\s]*pack/i.test(n)) return false
        return true
      }) as DailyCard[]
      if (cleaned.length === 0) { setError('No cards available'); setLoading(false); return }
      setPool(cleaned)
      setCard(pickRandom(cleaned, null))
      setLoading(false)
    })()
  }, [])

  function pickRandom(src: DailyCard[], avoid: DailyCard | null): DailyCard {
    if (src.length === 1) return src[0]
    // Try a few times to pick a different card from the previous one so
    // "play another" never gives the same card twice in a row.
    for (let i = 0; i < 5; i++) {
      const candidate = src[Math.floor(Math.random() * src.length)]
      if (!avoid || candidate.card_url_slug !== avoid.card_url_slug) return candidate
    }
    return src[Math.floor(Math.random() * src.length)]
  }

  const startNewGame = useCallback(() => {
    if (pool.length === 0) return
    setCard(pickRandom(pool, card))
    setGuess('')
    setResult(null)
    setReveal(false)
  }, [pool, card])

  function submitGuess(e: React.FormEvent) {
    e.preventDefault()
    if (!card) return
    const value = parseFloat(guess)
    if (isNaN(value) || value < 0) return
    const guessCents = Math.round(value * 100)
    const actual = card.current_raw
    const accuracy = priceAccuracyPct(guessCents, actual)
    setResult({ guess: guessCents, actual, accuracy })
    setReveal(true)
  }

  if (loading) return <Center>Loading a card…</Center>
  if (error) return <Center>Error: {error}</Center>
  if (!card) return <Center>No cards available right now.</Center>

  const numLabel = card.card_number_display && Number(card.set_printed_total || 0) > 1
    ? card.card_number_display
    : card.card_number ? `#${card.card_number}` : ''

  const shareText = result
    ? `Scored ${result.accuracy}% on PokePrices Guess the Price. ${result.accuracy === 100 ? 'Nailed it.' : result.accuracy >= 80 ? 'Pretty close.' : 'Tough one.'} Beat me?`
    : ''

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 16px 60px', fontFamily: "'Figtree', sans-serif" }}>
      <BackBar />

      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ display: 'inline-block', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--text-muted)', marginBottom: 6 }}>
          Quick Quiz · play anytime
        </div>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 32, margin: '0 0 4px', color: 'var(--text)' }}>
          Guess the Price
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          What did this card actually sell for (raw, ungraded)?
        </p>
      </div>

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 18, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        {/* Card image */}
        {card.image_url ? (
          <img src={card.image_url} alt={card.card_name} style={{ width: 240, borderRadius: 12, boxShadow: '0 12px 36px rgba(0,0,0,0.18)' }} />
        ) : (
          <div style={{ width: 240, height: 336, background: 'var(--bg-light)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 80 }}>🃏</div>
        )}

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Outfit', sans-serif", color: 'var(--text)' }}>
            {cleanCardName(card.card_name)} {numLabel}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 2 }}>
            {card.set_name}
          </div>
        </div>

        {!reveal ? (
          <form onSubmit={submitGuess} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: '100%', maxWidth: 340 }}>
            <label style={{ width: '100%' }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--text-muted)', marginBottom: 6, textAlign: 'center' }}>
                Your guess (USD)
              </div>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 22, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Outfit', sans-serif" }}>$</span>
                <input type="number" inputMode="decimal" step="0.01" min={0}
                  value={guess} onChange={e => setGuess(e.target.value)} autoFocus
                  placeholder="0.00"
                  style={{ width: '100%', padding: '14px 14px 14px 38px', fontSize: 22, fontWeight: 700, fontFamily: "'Outfit', sans-serif", borderRadius: 12, border: '2px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', outline: 'none', textAlign: 'center', boxSizing: 'border-box' }} />
              </div>
            </label>
            <button type="submit" disabled={!guess}
              style={{ padding: '14px 28px', fontSize: 15, fontWeight: 800, fontFamily: "'Outfit', sans-serif", background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 12, cursor: !guess ? 'not-allowed' : 'pointer', opacity: !guess ? 0.5 : 1, letterSpacing: 0.5, minWidth: 200 }}>
              Lock it in
            </button>
          </form>
        ) : (
          <Result card={card} result={result!} shareText={shareText} onPlayAgain={startNewGame} />
        )}
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 18, lineHeight: 1.6 }}>
        Price = current raw market value from confirmed sold listings. Play as many rounds as you like.
      </p>
    </div>
  )
}

function Result({ card, result, shareText, onPlayAgain }: { card: DailyCard; result: Result; shareText: string; onPlayAgain: () => void }) {
  const off = result.guess - result.actual
  const offLabel = off === 0 ? 'Exact' : off > 0 ? `Over by ${fmtUsd(off)}` : `Under by ${fmtUsd(-off)}`
  const bandColor =
    result.accuracy >= 90 ? '#22c55e' :
    result.accuracy >= 70 ? '#f59e0b' :
    '#ef4444'
  const bandLabel =
    result.accuracy >= 90 ? 'Dead on.' :
    result.accuracy >= 70 ? 'Pretty close.' :
    result.accuracy >= 40 ? 'Way off — happens.' :
    'Tough one.'

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ width: '100%', background: 'var(--bg-light)', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--text-muted)' }}>Actual price</div>
        <div style={{ fontSize: 38, fontWeight: 900, fontFamily: "'Outfit', sans-serif", color: 'var(--primary)' }}>
          {fmtUsd(card.current_raw)}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{fmtGbp(card.current_raw)}</div>
      </div>

      <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        <Stat label="Your guess"   value={fmtUsd(result.guess)} />
        <Stat label="Off by"       value={offLabel} />
      </div>

      <div style={{ width: '100%', textAlign: 'center', padding: '14px 16px', background: `${bandColor}15`, border: `1px solid ${bandColor}40`, borderRadius: 14 }}>
        <div style={{ fontSize: 44, fontWeight: 900, color: bandColor, fontFamily: "'Outfit', sans-serif", lineHeight: 1 }}>
          {result.accuracy}%
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: bandColor, textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 }}>
          accuracy · {bandLabel}
        </div>
      </div>

      {card.current_psa10 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
          For reference: PSA 10 is {fmtUsd(card.current_psa10)}
          {card.sales_30d ? ` · ${card.sales_30d}+ sales in last 30d` : ''}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={onPlayAgain}
          style={{ padding: '10px 18px', borderRadius: 10, background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
          Play another
        </button>
        <a href={buildXShareUrl(shareText)} target="_blank" rel="noopener noreferrer"
          style={{ padding: '10px 18px', borderRadius: 10, background: '#000', color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
          Post on X
        </a>
        {card.card_url_slug && (
          <Link href={`/set/${encodeURIComponent(card.set_name)}/card/${card.card_url_slug}`}
            style={{ padding: '10px 18px', borderRadius: 10, background: 'var(--bg-light)', color: 'var(--text)', fontSize: 13, fontWeight: 700, textDecoration: 'none', border: '1px solid var(--border)' }}>
            See full card →
          </Link>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--bg-light)', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Outfit', sans-serif", color: 'var(--text)', marginTop: 2 }}>{value}</div>
    </div>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '60px 16px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
      <BackBar />
      <div style={{ marginTop: 40 }}>{children}</div>
    </div>
  )
}

function BackBar() {
  return (
    <Link href="/games" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textDecoration: 'none', textTransform: 'uppercase', letterSpacing: 1.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      ← All games
    </Link>
  )
}
