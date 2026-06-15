'use client'
// Star toggle for card shows. Logged-in users can star events; the
// /dashboard/card-shows planner reads from the same card_show_stars
// table. Anon users get redirected to login when they click.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { setIntendedAction, consumeIntendedAction } from '@/lib/intendedAction'
import { trackEvent } from '@/lib/analytics'

function inferCountryFromShowId(showId: string | undefined | null): string | undefined {
  if (!showId) return undefined
  const head = showId.split('-')[0]
  if (head === 'uk' || head === 'us' || head === 'ca') return head.toUpperCase()
  return undefined
}

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

  // ── Replay a pending star intent after login (Block 2A) ──────────────────
  // Triggered on mount when the user is now signed in AND a card_show_star
  // intent in sessionStorage matches THIS show.
  useEffect(() => {
    let live = true
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!live || !session) return
      const intent = consumeIntendedAction()
      if (!intent || intent.type !== 'card_show_star') return
      if (intent.payload.show_id !== showId) return
      trackEvent('card_show_replay_after_auth', {
        show_id:      showId,
        country_code: inferCountryFromShowId(showId),
      })
      const { error } = await supabase
        .from('card_show_stars')
        .insert([{ user_id: session.user.id, show_id: showId }])
      if (!error || error.code === '23505') {
        if (live) {
          setStarred(true)
          trackEvent('card_show_favourite_success', {
            show_id:          showId,
            country_code:     inferCountryFromShowId(showId),
            source_component: 'replay_after_auth',
          })
        }
      }
    })
    return () => { live = false }
  }, [showId])

  async function toggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    const country = inferCountryFromShowId(showId)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      trackEvent('card_show_favourite_attempt', {
        show_id:          showId,
        country_code:     country,
        source_component: 'star_button_anon',
      })
      // Store the intent + return to this exact page after login.
      setIntendedAction({ type: 'card_show_star', payload: { show_id: showId } })
      const returnTo = window.location.pathname + window.location.search
      router.push('/dashboard/login?returnTo=' + encodeURIComponent(returnTo))
      setBusy(false)
      return
    }
    trackEvent('card_show_favourite_attempt', {
      show_id:          showId,
      country_code:     country,
      source_component: 'star_button',
    })
    // Optimistic UI: flip first, revert if the DB write fails. We surface
    // failures via alert() so the user (and we) immediately see what
    // Supabase rejected — silent failure left the planner empty before.
    const previous = starred
    setStarred(!previous)

    if (previous) {
      const { error } = await supabase
        .from('card_show_stars')
        .delete()
        .eq('user_id', session.user.id)
        .eq('show_id', showId)
      if (error) {
        console.error('[StarButton] delete failed:', error)
        setStarred(previous)
        alert(`Could not unstar event: ${error.message}`)
      } else {
        trackEvent('card_show_unfavourite', {
          show_id:          showId,
          country_code:     country,
          source_component: 'star_button',
        })
      }
    } else {
      // Plain INSERT (not upsert) — the migration's RLS policies only cover
      // INSERT/SELECT/DELETE. The local `starred` flag guards duplicates;
      // if a stale duplicate sneaks through we ignore Postgres 23505.
      const { error } = await supabase
        .from('card_show_stars')
        .insert([{ user_id: session.user.id, show_id: showId }])
      if (!error || error.code === '23505') {
        trackEvent('card_show_favourite_success', {
          show_id:          showId,
          country_code:     country,
          source_component: 'star_button',
        })
      }
      if (error && error.code !== '23505') {
        console.error('[StarButton] insert failed:', error)
        setStarred(previous)
        alert(`Could not star event: ${error.message}`)
      }
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
