'use client'
// Star toggle for card shows. Logged-in users can star events; the
// /dashboard/card-shows planner reads from the same card_show_stars
// table. Anon users get redirected to login when they click.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function StarButton({
  showId,
  size = 'sm',
  initialStarred,
}: {
  showId: string
  size?: 'sm' | 'lg'
  /** Optional pre-fetched state to avoid a flash on row mount. */
  initialStarred?: boolean
}) {
  const router = useRouter()
  const [starred, setStarred] = useState(!!initialStarred)
  const [busy, setBusy] = useState(false)
  const [knownAuthState, setKnownAuthState] = useState<boolean | null>(null)

  useEffect(() => {
    // If we got a hint from the parent, don't second-guess it.
    if (initialStarred !== undefined) return
    let live = true
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!live) return
      setKnownAuthState(!!session)
      if (!session) return
      const { data } = await supabase
        .from('card_show_stars')
        .select('show_id')
        .eq('user_id', session.user.id)
        .eq('show_id', showId)
        .maybeSingle()
      if (live) setStarred(!!data)
    })
    return () => { live = false }
  }, [showId, initialStarred])

  async function toggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      // Send to login with a return path so they come back here.
      router.push('/dashboard/login?next=' + encodeURIComponent(window.location.pathname))
      setBusy(false)
      return
    }
    if (starred) {
      await supabase
        .from('card_show_stars')
        .delete()
        .eq('user_id', session.user.id)
        .eq('show_id', showId)
      setStarred(false)
    } else {
      await supabase
        .from('card_show_stars')
        .upsert([{ user_id: session.user.id, show_id: showId }], { onConflict: 'user_id,show_id' })
      setStarred(true)
    }
    setBusy(false)
  }

  const big = size === 'lg'
  const dim = big ? 36 : 28
  const fontSize = big ? 18 : 14

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={starred}
      aria-label={starred ? 'Unstar event' : 'Star event'}
      title={starred ? 'Unstar event' : 'Star this event for your dashboard'}
      style={{
        width: dim, height: dim,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 999,
        border: '1px solid ' + (starred ? '#f59e0b' : 'var(--border)'),
        background: starred ? 'rgba(245,158,11,0.14)' : 'var(--card)',
        color: starred ? '#b45309' : 'var(--text-muted)',
        cursor: busy ? 'wait' : 'pointer',
        fontSize,
        flexShrink: 0,
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
        opacity: busy ? 0.6 : 1,
      }}
    >
      {starred ? '★' : '☆'}
    </button>
  )
}
