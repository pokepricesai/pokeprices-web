'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  todayKey, todaysMatchup, readLs, writeLs, buildXShareUrl, cleanCardName, fmtUsd,
  type MatchupSide, type DailyMatchup,
} from '@/lib/gamesUtil'

interface CardData {
  card_name: string
  set_name: string
  image_url: string | null
  card_url_slug: string | null
  current_raw: number | null
}

interface Tallies { option_a_votes: number; option_b_votes: number }
interface VotedState { choice: 'a' | 'b'; tallies: Tallies; date: string }

export default function DailyPickClient() {
  const matchup = todaysMatchup()
  const [aCard, setACard] = useState<CardData | null>(null)
  const [bCard, setBCard] = useState<CardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [voted, setVoted] = useState<VotedState | null>(null)
  const [voting, setVoting] = useState<'a' | 'b' | null>(null)
  const [tallies, setTallies] = useState<Tallies>({ option_a_votes: 0, option_b_votes: 0 })

  useEffect(() => {
    (async () => {
      // Restore prior vote if any.
      const prev = readLs<VotedState>(`daily-pick-${matchup.id}`)
      if (prev) { setVoted(prev); setTallies(prev.tallies) }
      // Hydrate both cards from the popular_card_trends view; fall back to
      // the matchup label if the slug isn't found.
      const slugs = [matchup.a.card_url_slug, matchup.b.card_url_slug].filter(Boolean) as string[]
      const { data } = await supabase.from('popular_card_trends')
        .select('card_name, set_name, image_url, card_url_slug, current_raw')
        .in('card_url_slug', slugs)
      const bySlug = new Map<string, CardData>()
      for (const r of (data || [])) bySlug.set((r as any).card_url_slug, r as CardData)
      setACard(bySlug.get(matchup.a.card_url_slug) || fallbackCard(matchup.a))
      setBCard(bySlug.get(matchup.b.card_url_slug) || fallbackCard(matchup.b))
      // Always pull live tallies even if user has voted previously.
      const { data: rows } = await supabase.from('daily_vote_tallies')
        .select('option_a_votes, option_b_votes')
        .eq('vote_date', todayKey()).eq('matchup_id', matchup.id).maybeSingle()
      if (rows) setTallies(rows as Tallies)
      setLoading(false)
    })()
  }, [matchup.id])

  async function vote(choice: 'a' | 'b') {
    setVoting(choice)
    const { data, error } = await supabase.rpc('cast_daily_vote', {
      p_date: todayKey(), p_matchup_id: matchup.id, p_choice: choice,
    })
    setVoting(null)
    if (error) { alert('Vote failed: ' + error.message); return }
    // RPC returns { a_votes, b_votes } — remap to our state shape.
    const row = (Array.isArray(data) ? data[0] : data) as { a_votes?: number; b_votes?: number; option_a_votes?: number; option_b_votes?: number }
    const t: Tallies = {
      option_a_votes: row?.a_votes ?? row?.option_a_votes ?? 0,
      option_b_votes: row?.b_votes ?? row?.option_b_votes ?? 0,
    }
    const next: VotedState = { choice, tallies: t, date: todayKey() }
    writeLs(`daily-pick-${matchup.id}`, next)
    setVoted(next)
    setTallies(t)
  }

  if (loading || !aCard || !bCard) {
    return <Center>Loading today's pick…</Center>
  }

  const totalVotes = (tallies.option_a_votes || 0) + (tallies.option_b_votes || 0)
  const pctA = totalVotes > 0 ? Math.round((tallies.option_a_votes / totalVotes) * 100) : 50
  const pctB = 100 - pctA

  const myLabel = voted?.choice === 'a' ? matchup.a.label : matchup.b.label
  const myPct = voted?.choice === 'a' ? pctA : pctB
  const shareText = voted
    ? `I picked ${myLabel} in today's PokePrices matchup (${myPct}% of collectors agreed). Which side are you on?`
    : ''

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 16px 60px', fontFamily: "'Figtree', sans-serif" }}>
      <BackBar />

      <div style={{ textAlign: 'center', marginTop: 16, marginBottom: 22 }}>
        <div style={{ display: 'inline-block', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--text-muted)', marginBottom: 6 }}>
          Today's Pick · {todayKey()}
        </div>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 30, margin: '0 0 6px' }}>
          {matchup.question}
        </h1>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          {voted ? `You picked: ${myLabel}` : 'Pick a side. See where collectors land.'}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <VoteCard
          card={aCard} label={matchup.a.label} pct={pctA} votes={tallies.option_a_votes}
          chosen={voted?.choice === 'a'} voted={!!voted} pulse={voting === 'a'}
          onClick={() => !voted && !voting && vote('a')}
        />
        <VoteCard
          card={bCard} label={matchup.b.label} pct={pctB} votes={tallies.option_b_votes}
          chosen={voted?.choice === 'b'} voted={!!voted} pulse={voting === 'b'}
          onClick={() => !voted && !voting && vote('b')}
        />
      </div>

      {voted && (
        <div style={{ textAlign: 'center', marginTop: 22 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
            {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'} so far today
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href={buildXShareUrl(shareText)} target="_blank" rel="noopener noreferrer"
              style={{ padding: '10px 18px', borderRadius: 10, background: '#000', color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
              Post on X
            </a>
            <Link href="/games" style={{ padding: '10px 18px', borderRadius: 10, background: 'var(--bg-light)', color: 'var(--text)', fontSize: 13, fontWeight: 700, textDecoration: 'none', border: '1px solid var(--border)' }}>
              Other games
            </Link>
          </div>
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 30, lineHeight: 1.6 }}>
        New matchup every day. Vote counts shared with the whole community.
      </p>
    </div>
  )
}

function VoteCard({ card, label, pct, votes, chosen, voted, pulse, onClick }: {
  card: CardData; label: string; pct: number; votes: number
  chosen: boolean; voted: boolean; pulse: boolean
  onClick: () => void
}) {
  return (
    <button onClick={onClick} disabled={voted || pulse}
      style={{
        textAlign: 'left',
        background: 'var(--card)', border: `2px solid ${chosen ? 'var(--primary)' : 'var(--border)'}`,
        borderRadius: 14, padding: 14,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        cursor: voted ? 'default' : 'pointer',
        transition: 'transform 0.15s, border-color 0.15s',
        position: 'relative', overflow: 'hidden',
        fontFamily: "'Figtree', sans-serif",
      }}
      onMouseEnter={e => { if (!voted) (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.transform = ''}
    >
      {/* Result fill bar when voted */}
      {voted && (
        <div style={{
          position: 'absolute', left: 0, bottom: 0, height: 6, width: `${pct}%`,
          background: chosen ? 'var(--primary)' : 'var(--text-muted)',
          transition: 'width 0.6s',
        }} />
      )}

      {card.image_url
        ? <img src={card.image_url} alt={label} style={{ width: '100%', maxWidth: 220, height: 'auto', borderRadius: 8 }} />
        : <div style={{ width: 220, height: 308, background: 'var(--bg-light)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 60 }}>🃏</div>}

      <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "'Outfit', sans-serif", textAlign: 'center', lineHeight: 1.2 }}>
        {label || cleanCardName(card.card_name)}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
        {card.set_name}{card.current_raw ? ` · raw ${fmtUsd(card.current_raw)}` : ''}
      </div>

      {voted ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 900, fontFamily: "'Outfit', sans-serif", color: chosen ? 'var(--primary)' : 'var(--text-muted)', lineHeight: 1 }}>
            {pct}%
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 }}>
            {votes} {votes === 1 ? 'vote' : 'votes'}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 4 }}>
          {pulse ? 'Voting…' : 'Tap to vote'}
        </div>
      )}
    </button>
  )
}

function fallbackCard(side: MatchupSide): CardData {
  return {
    card_name: side.label, set_name: '', image_url: side.fallback_image || null,
    card_url_slug: side.card_url_slug, current_raw: null,
  }
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
