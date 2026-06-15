'use client'

// src/lib/marketplaceClient.ts
// Block 2D — client-side marketplace state.
//
// One hook, one source of truth. Reads:
//   * profile preference (Supabase session → profiles.marketplace_preference)
//   * `pp_marketplace`   cookie  (manual choice, 365d)
//   * `pp_geo_country`   cookie  (geo result, 7d; populated on demand)
//
// Writes:
//   * pp_marketplace cookie on setMarketplace()
//   * profiles.marketplace_preference for authenticated users
//     (best-effort, never throws to the UI)
//   * pp_geo_country cookie after the /api/geo fetch
//
// Re-renders only when the resolved marketplace changes — components
// reading this hook will not re-render on auth state changes that do
// not affect the marketplace.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  resolveMarketplace,
  selectorOptions,
  type MarketplaceResolution,
  type ResolutionSource,
} from './marketplaceResolver'
import type { MarketplaceCode, MarketplaceDefinition } from './marketplaces'

const COOKIE_MANUAL = 'pp_marketplace'
const COOKIE_GEO    = 'pp_geo_country'
const COOKIE_MANUAL_MAX_AGE = 365 * 24 * 60 * 60
const COOKIE_GEO_MAX_AGE    = 7   * 24 * 60 * 60

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  try {
    const target = name + '='
    const parts = document.cookie.split(';')
    for (let raw of parts) {
      raw = raw.trim()
      if (raw.startsWith(target)) {
        const v = raw.slice(target.length)
        return decodeURIComponent(v) || null
      }
    }
  } catch { /* fine */ }
  return null
}

function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  if (typeof document === 'undefined') return
  try {
    const v = encodeURIComponent(value)
    const secure = (typeof window !== 'undefined' && window.location.protocol === 'https:') ? '; secure' : ''
    document.cookie = `${name}=${v}; path=/; max-age=${maxAgeSeconds}; samesite=lax${secure}`
  } catch { /* fine */ }
}

type State = {
  profilePreference: string | null
  geoCountry:        string | null
  manualCookie:      string | null
  ready:             boolean
}

export type UseMarketplaceResult = {
  marketplace:           MarketplaceCode | null
  source:                ResolutionSource
  setMarketplace:        (code: MarketplaceCode) => void
  /**
   * Marketplaces the user is allowed to pick from — only those that are
   * BOTH URL-engine implemented and have a campaign id. Anything else
   * stays hidden until both states are true.
   */
  selectableMarketplaces: MarketplaceDefinition[]
  isReady:               boolean
}

export function useMarketplace(): UseMarketplaceResult {
  const [state, setState] = useState<State>({
    profilePreference: null,
    geoCountry:        null,
    manualCookie:      null,
    ready:             false,
  })

  // ── Initial load (manual cookie + geo cookie + profile if signed-in) ──
  useEffect(() => {
    let live = true
    const manual = readCookie(COOKIE_MANUAL)
    const geo    = readCookie(COOKIE_GEO)

    async function loadProfile(): Promise<string | null> {
      try {
        const { data: sess } = await supabase.auth.getSession()
        const user = sess.session?.user
        if (!user) return null
        const { data } = await supabase
          .from('profiles')
          .select('marketplace_preference')
          .eq('user_id', user.id)
          .maybeSingle()
        return (data as any)?.marketplace_preference ?? null
      } catch { return null }
    }

    loadProfile().then(profilePreference => {
      if (!live) return
      setState({
        profilePreference,
        geoCountry:    geo,
        manualCookie:  manual,
        ready:         true,
      })
    })

    // Listen for auth state changes — if a user signs in or out the
    // profile preference may now apply / no longer apply.
    const sub = supabase.auth.onAuthStateChange(async (_e, session) => {
      if (!live) return
      if (!session) {
        setState(s => ({ ...s, profilePreference: null }))
        return
      }
      try {
        const { data } = await supabase
          .from('profiles')
          .select('marketplace_preference')
          .eq('user_id', session.user.id)
          .maybeSingle()
        if (!live) return
        setState(s => ({ ...s, profilePreference: (data as any)?.marketplace_preference ?? null }))
      } catch { /* fine */ }
    })

    return () => {
      live = false
      sub.data.subscription.unsubscribe()
    }
  }, [])

  // ── Lazy geo fetch ──
  // Only run when neither profile nor manual cookie give a usable answer
  // and we don't already have a geo cookie. One fetch per browser
  // session at most.
  useEffect(() => {
    if (!state.ready) return
    if (state.profilePreference) return
    if (state.manualCookie)      return
    if (state.geoCountry)        return

    let live = true
    fetch('/api/geo', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then((json: { country?: string | null } | null) => {
        if (!live) return
        const country = (json && typeof json.country === 'string') ? json.country : null
        if (country) {
          writeCookie(COOKIE_GEO, country, COOKIE_GEO_MAX_AGE)
          setState(s => ({ ...s, geoCountry: country }))
        }
      })
      .catch(() => { /* fine */ })

    return () => { live = false }
  }, [state.ready, state.profilePreference, state.manualCookie, state.geoCountry])

  // ── Resolved value ──
  const resolution: MarketplaceResolution = useMemo(() => resolveMarketplace({
    profilePreference: state.profilePreference,
    manualCookie:      state.manualCookie,
    geoCountry:        state.geoCountry,
  }), [state.profilePreference, state.manualCookie, state.geoCountry])

  // ── Manual setter ──
  // The cookie write is the source of truth — it represents the user's
  // explicit current choice and always takes precedence over the
  // server-stored profile preference in the resolver. The cookie is
  // NEVER cleared by this hook (not on profile save, not on auth state
  // change). Only an explicit re-selection by the user can change it.
  const setMarketplace = useCallback((code: MarketplaceCode) => {
    writeCookie(COOKIE_MANUAL, code, COOKIE_MANUAL_MAX_AGE)
    setState(s => ({ ...s, manualCookie: code }))
    // Best-effort profile update for signed-in users. The cookie wins
    // in the resolver either way, so a failure here is silent.
    void (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession()
        const user = sess.session?.user
        if (!user) return
        await supabase
          .from('profiles')
          .update({ marketplace_preference: code, updated_at: new Date().toISOString() })
          .eq('user_id', user.id)
      } catch { /* swallow */ }
    })()
  }, [])

  const options = useMemo<MarketplaceDefinition[]>(() => selectorOptions(), [])

  return {
    marketplace:           resolution.marketplace,
    source:                resolution.source,
    setMarketplace,
    selectableMarketplaces: options,
    isReady:               state.ready,
  }
}
