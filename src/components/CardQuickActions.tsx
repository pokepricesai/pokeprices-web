'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

interface Card {
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug?: string | null
  image_url?: string | null
  card_number_display?: string | null
  card_number?: string | null
  raw_usd?: number | null
  psa10_usd?: number | null
}

export default function CardQuickActions({ card }: { card: Card }) {
  const [user, setUser] = useState<any>(null)
  const [watchId, setWatchId] = useState<string | null>(null)
  const [busy, setBusy]         = useState(false)
  // Canonical slug for user tables = card_url_slug (matches portfolio + search_global convention)
  const cardSlug = (card.card_url_slug || card.card_slug || '').toString().replace(/^pc-/, '')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user || !cardSlug) { setWatchId(null); return }
    supabase
      .from('watchlist')
      .select('id')
      .eq('user_id', user.id)
      .eq('card_slug', cardSlug)
      .maybeSingle()
      .then(({ data }) => setWatchId(data?.id ?? null))
  }, [user, cardSlug])

  async function handleWatch() {
    if (!user) return
    setBusy(true)
    if (watchId) {
      await supabase.from('watchlist').delete().eq('id', watchId)
      setWatchId(null)
    } else {
      const { data: row, error } = await supabase.from('watchlist').insert([{
        user_id: user.id,
        card_slug: cardSlug,
        card_name: card.card_name,
        set_name: card.set_name,
        card_url_slug: cardSlug,
        image_url: card.image_url || null,
        card_number: card.card_number_display || card.card_number || null,
        raw_at_add: card.raw_usd ?? null,
        psa10_at_add: card.psa10_usd ?? null,
      }]).select('id').single()
      if (!error && row) setWatchId(row.id)
    }
    setBusy(false)
  }

  const baseBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 13px', borderRadius: 18,
    fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
    border: '1px solid var(--border)',
    background: 'var(--card)', color: 'var(--text)',
    cursor: 'pointer', textDecoration: 'none',
    transition: 'all 0.15s',
  }

  const watchingBtn: React.CSSProperties = {
    ...baseBtn,
    background: 'rgba(34,197,94,0.1)',
    border: '1px solid #22c55e',
    color: '#16a34a',
  }

  if (!user) {
    return (
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <Link href="/dashboard/login" style={baseBtn}>
          <span>👁</span> Watch
        </Link>
        <Link href="/dashboard/login" style={baseBtn}>
          <span>🔔</span> Set alert
        </Link>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", alignSelf: 'center' }}>
          Free, no card required.
        </span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
      <button onClick={handleWatch} disabled={busy} style={watchId ? watchingBtn : baseBtn}>
        {watchId ? <><span>✓</span> Watching</> : <><span>👁</span> Watch</>}
      </button>
      <Link href={`/dashboard/alerts?new=${encodeURIComponent(cardSlug)}`} style={baseBtn}>
        <span>🔔</span> Set alert
      </Link>
    </div>
  )
}
