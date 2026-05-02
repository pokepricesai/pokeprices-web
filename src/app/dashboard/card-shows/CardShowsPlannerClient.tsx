'use client'
// Card Show Planner — lists every event the logged-in user has starred,
// sorted by start date. Joins client-side against the static cardShows
// array (the source of truth lives in src/data/cardShows.ts; the DB only
// stores the show_id key).

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import DashboardNav from '../DashboardNav'
import {
  cardShows,
  formatShowDate,
  EVENT_TYPE_LABEL,
  type CardShow,
} from '@/data/cardShows'

type StarRow = { show_id: string; created_at: string }

export default function CardShowsPlannerClient() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [stars, setStars] = useState<StarRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/dashboard/login?next=/dashboard/card-shows'); return }
      setUser(session.user)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) router.push('/dashboard/login?next=/dashboard/card-shows')
      else setUser(session.user)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user) return
    let live = true
    supabase
      .from('card_show_stars')
      .select('show_id, created_at')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (!live) return
        setStars((data || []) as StarRow[])
        setLoading(false)
      })
    return () => { live = false }
  }, [user])

  // Join stars to the static cardShows array. Drop dangling stars (show
  // removed from the static list) silently.
  const today = new Date().toISOString().slice(0, 10)
  const items = useMemo(() => {
    const byId = new Map(cardShows.map(s => [s.id, s]))
    return stars
      .map(r => byId.get(r.show_id))
      .filter((s): s is CardShow => !!s)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
  }, [stars])

  const upcoming = items.filter(s => (s.endDate || s.startDate) >= today)
  const past = items.filter(s => (s.endDate || s.startDate) < today)

  async function unstar(showId: string) {
    if (!user) return
    setStars(prev => prev.filter(r => r.show_id !== showId))
    await supabase
      .from('card_show_stars')
      .delete()
      .eq('user_id', user.id)
      .eq('show_id', showId)
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '24px 16px' }}>
      <DashboardNav current={'card-shows' as any} email={user?.email} />

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, margin: '0 0 4px', color: 'var(--text)' }}>
          Card Show Planner
        </h1>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.6 }}>
          Every Pokémon card show you&apos;ve starred, sorted by date. Star events from
          the <Link href="/card-shows" style={{ color: 'var(--primary)', fontWeight: 700, textDecoration: 'none' }}>card shows directory</Link> to
          add them here.
        </p>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 120, borderRadius: 14 }} />
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {upcoming.length > 0 && (
            <Section title={`Upcoming (${upcoming.length})`}>
              {upcoming.map(s => <Row key={s.id} show={s} onUnstar={unstar} />)}
            </Section>
          )}
          {past.length > 0 && (
            <Section title={`Past (${past.length})`}>
              {past.map(s => <Row key={s.id} show={s} onUnstar={unstar} faded />)}
            </Section>
          )}
        </>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{
      background: 'var(--card)', border: '2px dashed var(--border)', borderRadius: 18,
      padding: '50px 24px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🌟</div>
      <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, margin: '0 0 8px', color: 'var(--text)' }}>
        No starred shows yet
      </h2>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 auto 18px', maxWidth: 440, lineHeight: 1.6 }}>
        Browse the card shows directory and tap the ☆ on any event you&apos;re thinking
        about going to. Starred shows show up here, sorted by date, so you&apos;ve got
        a single planner across UK and US events.
      </p>
      <Link href="/card-shows" style={{
        display: 'inline-block', padding: '11px 20px', borderRadius: 12,
        background: 'var(--primary)', color: '#fff',
        fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif", textDecoration: 'none',
      }}>
        Browse card shows
      </Link>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{
        fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2,
        color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 10,
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </section>
  )
}

function Row({ show, onUnstar, faded }: {
  show: CardShow
  onUnstar: (id: string) => void
  faded?: boolean
}) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '12px 14px',
      display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap',
      opacity: faded ? 0.55 : 1,
    }}>
      <div style={{
        flexShrink: 0, minWidth: 78,
        background: 'rgba(26,95,173,0.08)',
        border: '1px solid rgba(26,95,173,0.18)',
        borderRadius: 9, padding: '6px 10px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif" }}>
          {new Date(show.startDate).toLocaleDateString('en-GB', { month: 'short' })}
        </div>
        <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)', fontFamily: "'Outfit', sans-serif", lineHeight: 1, marginTop: 2 }}>
          {new Date(show.startDate).getDate()}
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", fontWeight: 700, marginTop: 3 }}>
          {new Date(show.startDate).getFullYear()}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 200 }}>
        <Link href={`/card-shows/${show.country}/${show.slug}`} style={{ textDecoration: 'none' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
            <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 15, margin: 0, color: 'var(--text)' }}>
              {show.name}
            </h3>
            <span style={{
              fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2,
              background: 'rgba(26,95,173,0.10)', color: 'var(--primary)',
              padding: '2px 7px', borderRadius: 7,
              fontFamily: "'Figtree', sans-serif",
            }}>
              {EVENT_TYPE_LABEL[show.eventType]}
            </span>
            <span style={{
              fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2,
              background: 'var(--bg-light)', color: 'var(--text-muted)',
              padding: '2px 7px', borderRadius: 7,
              fontFamily: "'Figtree', sans-serif",
            }}>
              {show.country.toUpperCase()}
            </span>
          </div>
        </Link>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
          {show.city}{show.region ? ` · ${show.region}` : ''}{show.venue ? ` · ${show.venue}` : ''}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 3, fontWeight: 700 }}>
          {formatShowDate(show)}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        {show.ticketUrl && (
          <a href={show.ticketUrl} target="_blank" rel="noopener noreferrer" style={{
            padding: '5px 10px', borderRadius: 8,
            border: '1px solid var(--primary)', background: 'transparent', color: 'var(--primary)',
            fontSize: 11, fontWeight: 700, fontFamily: "'Figtree', sans-serif", textDecoration: 'none',
          }}>Tickets ↗</a>
        )}
        <button onClick={() => onUnstar(show.id)} title="Remove from planner" style={{
          width: 28, height: 28, borderRadius: 999,
          border: '1px solid #f59e0b', background: 'rgba(245,158,11,0.14)',
          color: '#b45309', cursor: 'pointer', fontSize: 14,
        }}>★</button>
      </div>
    </div>
  )
}
