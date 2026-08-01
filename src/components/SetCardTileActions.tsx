'use client'
// Block 5A-W-50B — compact Watch + Portfolio actions rendered inside
// every card tile on /set/[slug].
//
// Reuses:
//   * performWatchlistAdd shape from CardQuickActions (same conflict
//     rule on user_id + card_slug + set_name — English and Japanese
//     printings stay distinct).
//   * CardPortfolioAddModal (already exported from CardQuickActions).
//   * setIntendedAction + /dashboard/login?returnTo for the intent
//     replay on Watch (Portfolio uses the auth prompt only — matches
//     current site behaviour).
//   * canAddWatchlistItem / canAddPortfolioItem entitlement gates.
//
// Design constraints:
//   * Two equal-width buttons at the bottom of each card tile.
//   * Buttons stop propagation so the parent <Link> does not fire on
//     button click. The rest of the tile still navigates.
//   * No hover requirement — buttons always visible (touch-friendly).
//   * Bulk membership state (see setPageMembership.ts) is passed in
//     as props; no per-tile fetch happens here.
//   * Anonymous users make no DB write until auth completes; instead
//     the caller opens AuthPromptModal (state hoisted to SetPageClient).

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { setIntendedAction } from '@/lib/intendedAction'
import { trackEvent } from '@/lib/analytics'
import {
  canAddWatchlistItem,
  canAddPortfolioItem,
} from '@/lib/account/entitlements'
import {
  loadWatchlistCount,
  loadPortfolioItemCount,
} from '@/lib/account/usage'
import type { UserPlan } from '@/lib/account/entitlements'
import { performWatchlistAdd } from '@/lib/watchlistOps'

export type TileCard = {
  card_slug:      string
  card_name:      string
  card_number:    string | null
  set_name:       string
  raw_usd:        number | null
  psa10_usd:      number | null
  image_url:      string | null
  card_url_slug:  string | null
  is_sealed:      boolean
}

export type SetCardTileActionsProps = {
  card:             TileCard
  bareSlug:         string
  user:             { id: string } | null
  plan:             UserPlan | null
  isWatched:        boolean
  isInPortfolio:    boolean
  onWatchedChanged: (bareSlug: string, watched: boolean) => void
  onOpenAuthPrompt: (context: 'watchlist' | 'portfolio') => void
  onOpenPortfolio:  (card: TileCard, bareSlug: string) => void
}

export default function SetCardTileActions({
  card,
  bareSlug,
  user,
  plan,
  isWatched,
  isInPortfolio,
  onWatchedChanged,
  onOpenAuthPrompt,
  onOpenPortfolio,
}: SetCardTileActionsProps) {
  const [busy, setBusy]   = useState<'watch' | 'portfolio' | null>(null)
  const [err,  setErr]    = useState<string | null>(null)

  // Guard so a click on either button does NOT trigger the surrounding
  // <Link> navigation to the card page.
  function swallow(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
  }

  async function handleWatch(e: React.MouseEvent) {
    swallow(e)
    if (!user) {
      // Store the intent so the SET PAGE replay can add the card after
      // return-from-login. origin_set_name scopes the replay so we
      // never fire on an unrelated set later.
      setIntendedAction({
        type: 'watchlist_add',
        payload: {
          card_slug:        bareSlug,
          card_name:        card.card_name,
          set_name:         card.set_name,
          image_url:        card.image_url || null,
          card_number:      card.card_number || null,
          raw_usd:          card.raw_usd   ?? null,
          psa10_usd:        card.psa10_usd ?? null,
          origin_set_name:  card.set_name,
        },
      })
      trackEvent('watchlist_add_attempt', {
        card_slug:        bareSlug,
        set_slug:         card.set_name,
        source_component: 'set_tile_anon',
      })
      onOpenAuthPrompt('watchlist')
      return
    }

    setBusy('watch')
    setErr(null)
    try {
      if (isWatched) {
        // Remove — find the id, delete.
        const { data: existing } = await supabase
          .from('watchlist')
          .select('id')
          .eq('user_id', user.id)
          .eq('card_slug', bareSlug)
          .eq('set_name', card.set_name)
          .maybeSingle()
        if (existing?.id) {
          await supabase.from('watchlist').delete().eq('id', existing.id)
          trackEvent('watchlist_remove', {
            card_slug:        bareSlug,
            set_slug:         card.set_name,
            source_component: 'set_tile',
          })
          onWatchedChanged(bareSlug, false)
        }
      } else {
        // Gate first
        const count = await loadWatchlistCount(supabase, user.id)
        const gate  = canAddWatchlistItem(plan, count)
        if (!gate.allowed) {
          setErr(gate.reason ?? 'Watchlist limit reached.')
          setBusy(null)
          return
        }
        trackEvent('watchlist_add_attempt', {
          card_slug:        bareSlug,
          set_slug:         card.set_name,
          source_component: 'set_tile',
        })
        const id = await performWatchlistAdd(supabase, user.id, {
          card_slug:   bareSlug,
          card_name:   card.card_name,
          set_name:    card.set_name,
          image_url:   card.image_url,
          card_number: card.card_number,
          raw_usd:     card.raw_usd,
          psa10_usd:   card.psa10_usd,
        })
        if (id) {
          trackEvent('watchlist_add_success', {
            card_slug:        bareSlug,
            set_slug:         card.set_name,
            source_component: 'set_tile',
          })
          onWatchedChanged(bareSlug, true)
        } else {
          setErr('Could not save. Please try again.')
        }
      }
    } finally {
      setBusy(null)
    }
  }

  async function handlePortfolio(e: React.MouseEvent) {
    swallow(e)
    if (!user) {
      // Block 5A-W-50B-FIX1 — store a portfolio_open intent so the
      // SET PAGE opens the modal for this card automatically after
      // return-from-login. origin_set_name scopes the replay to the
      // current set.
      setIntendedAction({
        type: 'portfolio_open',
        payload: {
          card_slug:        bareSlug,
          card_name:        card.card_name,
          set_name:         card.set_name,
          image_url:        card.image_url || null,
          card_number:      card.card_number || null,
          raw_usd:          card.raw_usd   ?? null,
          psa10_usd:        card.psa10_usd ?? null,
          origin_set_name:  card.set_name,
        },
      })
      trackEvent('portfolio_add_attempt', {
        card_slug:        bareSlug,
        source_component: 'set_tile_anon',
      })
      onOpenAuthPrompt('portfolio')
      return
    }
    // Gate BEFORE opening the modal so the user sees the upgrade copy
    // at the click site instead of bouncing into a modal that would
    // refuse the save.
    setBusy('portfolio')
    setErr(null)
    try {
      const count = await loadPortfolioItemCount(supabase, user.id)
      const gate  = canAddPortfolioItem(plan, count)
      if (!gate.allowed) {
        setErr(gate.reason ?? 'Portfolio limit reached.')
        return
      }
      trackEvent('portfolio_add_attempt', {
        card_slug:        bareSlug,
        source_component: 'set_tile',
      })
      onOpenPortfolio(card, bareSlug)
    } finally {
      setBusy(null)
    }
  }

  const watchLabel = isWatched
    ? `Remove ${card.card_name} from watchlist`
    : `Add ${card.card_name} to watchlist`
  const pfLabel = isInPortfolio
    ? `Add another ${card.card_name} holding`
    : `Add ${card.card_name} to portfolio`

  // Inline eye + briefcase icons — matches existing quick-actions
  // (no emoji, currentColor-tinted). Bell-like ring for active watch.
  const eyeIcon = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
  const briefcaseIcon = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 6,
        width: '100%',
        marginTop: 8,
      }}
    >
      <button
        onClick={handleWatch}
        onPointerDown={swallow}
        disabled={busy !== null}
        aria-pressed={isWatched}
        aria-label={watchLabel}
        style={isWatched ? watchingStyle : neutralStyle}
        title={isWatched ? 'Watching · click to remove' : 'Add to watchlist'}
      >
        {eyeIcon}
        <span>{isWatched ? 'Watching' : 'Watch'}</span>
      </button>
      <button
        onClick={handlePortfolio}
        onPointerDown={swallow}
        disabled={busy !== null}
        aria-label={pfLabel}
        style={isInPortfolio ? inPortfolioStyle : neutralStyle}
        title={isInPortfolio ? 'In portfolio · click to add another holding' : 'Add to portfolio'}
      >
        {briefcaseIcon}
        <span>{isInPortfolio ? 'Owned' : 'Portfolio'}</span>
      </button>
      {err && (
        <div role="status" style={{
          gridColumn: '1 / span 2',
          fontSize: 10.5,
          color: '#b45309',
          background: 'rgba(245,158,11,0.10)',
          border: '1px solid rgba(245,158,11,0.30)',
          borderRadius: 6,
          padding: '5px 8px',
          marginTop: 2,
          lineHeight: 1.3,
        }}>
          {err}
        </div>
      )}
    </div>
  )
}

const baseButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
  padding: '6px 8px',
  borderRadius: 8,
  fontSize: 11.5,
  fontWeight: 700,
  fontFamily: "'Figtree', sans-serif",
  border: '1px solid var(--border)',
  cursor: 'pointer',
  minHeight: 32,          // touch-friendly
  lineHeight: 1,
}

const neutralStyle: React.CSSProperties = {
  ...baseButton,
  background: 'var(--bg-light)',
  color: 'var(--text)',
}

const watchingStyle: React.CSSProperties = {
  ...baseButton,
  background: 'rgba(34,197,94,0.12)',
  border: '1px solid #22c55e',
  color: '#16a34a',
}

const inPortfolioStyle: React.CSSProperties = {
  ...baseButton,
  background: 'rgba(59,130,246,0.10)',
  border: '1px solid #3b82f6',
  color: '#2563eb',
}
