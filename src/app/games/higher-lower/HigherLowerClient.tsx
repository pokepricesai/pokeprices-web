'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  readLs, writeLs, buildXShareUrl,
  fmtUsd, cleanCardName,
} from '@/lib/gamesUtil'

// Fisher-Yates with Math.random for a fresh shuffle every game.
function randomShuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

interface HLCard {
  card_name: string
  set_name: string
  image_url: string | null
  card_url_slug: string | null
  card_number: string | null
  card_number_display: string | null
  set_printed_total: string | null
  current_raw: number
}

interface HLResult {
  best_streak: number
  finished: boolean
}

const CHAIN_LENGTH = 25

export default function HigherLowerClient() {
  const [pool, setPool] = useState<HLCard[]>([])
  const [chain, setChain] = useState<HLCard[]>([])
  const [loading, setLoading] = useState(true)
  const [idx, setIdx] = useState(0)            // index of "current" card (next is idx+1)
  const [streak, setStreak] = useState(0)
  const [phase, setPhase] = useState<'play' | 'reveal' | 'over' | 'win'>('play')
  const [lastPick, setLastPick] = useState<'higher' | 'lower' | null>(null)
  const [result, setResult] = useState<HLResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Pull the candidate pool once. The actual chain is built fresh per
  // game via buildChain so users can hit "Play again" without another
  // network round-trip.
  useEffect(() => {
    (async () => {
      const { data, error: e } = await supabase.from('popular_card_trends')
        .select('card_name, set_name, image_url, card_url_slug, card_number, card_number_display, set_printed_total, current_raw, is_sealed')
        .gte('current_raw', 500)
        .lte('current_raw', 200000)
        .order('sales_30d', { ascending: false })
        .limit(200)
      if (e) { setError(e.message); setLoading(false); return }
      const cleaned = (data || []).filter((c: any) => {
        if (c.is_sealed) return false
        const n = c.card_name || ''
        if (/booster|elite|tin|blister|bundle|binder|collection|deck/i.test(n)) return false
        return true
      }) as HLCard[]
      if (cleaned.length < CHAIN_LENGTH) { setError('Not enough cards'); setLoading(false); return }
      setPool(cleaned)
      setChain(buildChain(cleaned))
      setLoading(false)
    })()
  }, [])

  function buildChain(src: HLCard[]): HLCard[] {
    const shuffled = randomShuffle(src)
    const out: HLCard[] = []
    const seenNames = new Set<string>()
    for (const c of shuffled) {
      if (seenNames.has(c.card_name)) continue
      seenNames.add(c.card_name)
      out.push(c)
      if (out.length >= CHAIN_LENGTH) break
    }
    return out
  }

  const startNewGame = useCallback(() => {
    if (pool.length < CHAIN_LENGTH) return
    setChain(buildChain(pool))
    setIdx(0)
    setStreak(0)
    setPhase('play')
    setLastPick(null)
  }, [pool])

  function pick(choice: 'higher' | 'lower') {
    if (phase !== 'play' || idx >= chain.length - 1) return
    const current = chain[idx]
    const next = chain[idx + 1]
    const isHigher = next.current_raw > current.current_raw
    const correct = (choice === 'higher' && isHigher) || (choice === 'lower' && !isHigher)
    setLastPick(choice)
    setPhase('reveal')
    setTimeout(() => {
      if (!correct) {
        // Persist all-time best for nice "session best" displays — does
        // not gate the game anymore.
        const prior = readLs<HLResult>('higher-lower')
        const newBest = Math.max(prior?.best_streak || 0, streak)
        const final: HLResult = { best_streak: newBest, finished: false }
        writeLs('higher-lower', final)
        setResult({ best_streak: streak, finished: false })
        setPhase('over')
        return
      }
      const newStreak = streak + 1
      setStreak(newStreak)
      if (idx + 2 >= chain.length) {
        const prior = readLs<HLResult>('higher-lower')
        const newBest = Math.max(prior?.best_streak || 0, newStreak)
        writeLs('higher-lower', { best_streak: newBest, finished: true })
        setResult({ best_streak: newStreak, finished: true })
        setPhase('win')
        return
      }
      setIdx(idx + 1)
      setLastPick(null)
      setPhase('play')
    }, 1100)
  }

  if (loading) return <Center>Building your chain…</Center>
  if (error)   return <Center>Error: {error}</Center>
  if (chain.length < 2) return <Center>Not enough cards available.</Center>

  const current = chain[idx]
  const next    = chain[idx + 1]

  if (phase === 'over' || phase === 'win') {
    const allTimeBest = (readLs<HLResult>('higher-lower')?.best_streak) ?? result?.best_streak ?? 0
    const shareText = phase === 'win'
      ? `I cleared a perfect ${chain.length}/${chain.length} on PokePrices Higher or Lower. Beat me?`
      : `${result?.best_streak} streak on PokePrices Higher or Lower before I tripped up. Beat me?`
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 16px 60px', fontFamily: "'Figtree', sans-serif" }}>
        <BackBar />
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 36, margin: '0 0 4px' }}>
            {phase === 'win' ? 'Cleared the chain.' : 'Game over.'}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 24px' }}>
            {phase === 'win' ? `Perfect ${chain.length}/${chain.length}.` : `You strung ${result?.best_streak} correct in a row.`}
          </p>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 18, padding: 28, display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 260 }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--text-muted)' }}>This run</div>
            <div style={{ fontSize: 72, fontWeight: 900, fontFamily: "'Outfit', sans-serif", color: 'var(--accent)', lineHeight: 1 }}>
              {result?.best_streak ?? 0}
            </div>
            {allTimeBest > (result?.best_streak ?? 0) && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                All-time best: <strong style={{ color: 'var(--text)' }}>{allTimeBest}</strong>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
            <button onClick={startNewGame}
              style={{ padding: '10px 18px', borderRadius: 10, background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
              Play again
            </button>
            <a href={buildXShareUrl(shareText)} target="_blank" rel="noopener noreferrer"
              style={{ padding: '10px 18px', borderRadius: 10, background: '#000', color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
              Post on X
            </a>
            <Link href="/games" style={{ padding: '10px 18px', borderRadius: 10, background: 'var(--bg-light)', color: 'var(--text)', fontSize: 13, fontWeight: 700, textDecoration: 'none', border: '1px solid var(--border)' }}>
              Other games
            </Link>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 24 }}>
            Fresh shuffle every game — play as often as you like.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 16px 60px', fontFamily: "'Figtree', sans-serif" }}>
      <BackBar />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--text-muted)' }}>
            Higher or Lower · play anytime
          </div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 24, margin: '4px 0 0' }}>
            Which sold for more (raw)?
          </h1>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--text-muted)' }}>Streak</div>
          <div style={{ fontSize: 28, fontWeight: 900, fontFamily: "'Outfit', sans-serif", color: 'var(--accent)', lineHeight: 1 }}>{streak}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Left: anchor card with known price */}
        <CardTile c={current} priceShown={true} faded={false} />

        {/* Right: mystery card with action buttons or reveal */}
        <CardTile
          c={next}
          priceShown={phase === 'reveal'}
          faded={phase === 'reveal' && lastPick !== null && (
            (lastPick === 'higher' && next.current_raw <= current.current_raw) ||
            (lastPick === 'lower'  && next.current_raw  > current.current_raw)
          )}
        />
      </div>

      {phase === 'play' && (
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button onClick={() => pick('higher')}
            style={{ flex: 1, padding: '16px 12px', fontSize: 16, fontWeight: 800, fontFamily: "'Outfit', sans-serif", background: '#22c55e', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer', letterSpacing: 0.5 }}>
            ▲ Higher
          </button>
          <button onClick={() => pick('lower')}
            style={{ flex: 1, padding: '16px 12px', fontSize: 16, fontWeight: 800, fontFamily: "'Outfit', sans-serif", background: '#ef4444', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer', letterSpacing: 0.5 }}>
            ▼ Lower
          </button>
        </div>
      )}

      {phase === 'reveal' && (
        <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13, fontWeight: 700, color: 'var(--text-muted)' }}>
          {next.current_raw > current.current_raw ? '▲ Higher' : '▼ Lower'} — {fmtUsd(next.current_raw)}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 22, flexWrap: 'wrap' }}>
        {Array.from({ length: chain.length - 1 }).map((_, i) => (
          <div key={i} style={{
            width: 16, height: 4, borderRadius: 2,
            background: i < streak ? '#22c55e' : i === streak && phase === 'reveal' ? '#ef4444' : 'var(--border)',
            transition: 'background 0.15s',
          }} />
        ))}
      </div>
    </div>
  )
}

function CardTile({ c, priceShown, faded }: { c: HLCard; priceShown: boolean; faded: boolean }) {
  const numLabel = c.card_number_display && Number(c.set_printed_total || 0) > 1
    ? c.card_number_display
    : c.card_number ? `#${c.card_number}` : ''
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      opacity: faded ? 0.55 : 1, transition: 'opacity 0.25s',
    }}>
      {c.image_url
        ? <img src={c.image_url} alt={c.card_name} style={{ width: '100%', maxWidth: 200, height: 'auto', borderRadius: 8 }} />
        : <div style={{ width: 200, height: 280, background: 'var(--bg-light)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 60 }}>🃏</div>}
      <div style={{ fontSize: 14, fontWeight: 800, fontFamily: "'Outfit', sans-serif", textAlign: 'center', lineHeight: 1.2 }}>
        {cleanCardName(c.card_name)} {numLabel}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' }}>
        {c.set_name}
      </div>
      <div style={{ fontSize: 24, fontWeight: 900, fontFamily: "'Outfit', sans-serif", color: 'var(--primary)', minHeight: 30 }}>
        {priceShown ? fmtUsd(c.current_raw) : '$?'}
      </div>
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
