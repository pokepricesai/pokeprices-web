// src/lib/analytics.ts
// PokePrices v2 Block 2B — central analytics helper.
//
// This is the ONLY module that talks to gtag/dataLayer in src/**.
// Feature code calls trackEvent(name, params); the runtime sanitiser
// strips forbidden parameter names, length-caps values and attaches
// auth_state + user_plan + page_type. The helper is safe to call from
// any client context: it is a no-op when window or gtag are missing
// and never throws.
//
// PII rules enforced at runtime:
//   * Forbidden parameter names are dropped silently. A console.warn
//     is emitted in development so they surface during QA.
//   * String values longer than MAX_STRING_LEN are truncated.
//   * The helper never reads emails, user IDs, tokens, prompts,
//     portfolio values, purchase prices or notes from anywhere.

import type { PageType } from './pageType'
import { classifyPageType } from './pageType'
import { attributionDimensions } from './attribution'

// ── Public types ────────────────────────────────────────────────────────────

export type AuthState = 'anonymous' | 'authenticated'
export type Plan      = 'anonymous' | 'free' | 'pro'

export type AuthMethod    = 'email_password' | 'magic_link' | 'google' | 'recovery' | 'other'
export type ReturnContext = 'dashboard' | 'watchlist' | 'card_show' | 'portfolio' | 'direct'

export type AffiliateIntent =
  | 'raw' | 'psa8' | 'psa9' | 'psa10' | 'graded'
  | 'sold_search' | 'japanese'
  | 'set_search' | 'pokemon_search'
  | 'sealed' | 'exact_listing'
  | 'other'

export type Marketplace = 'UK' | 'US' | 'EU' | 'AU' | 'CA' | 'JP' | 'other'

export type HoldingType  = 'raw' | 'graded' | 'sealed' | 'unknown'
export type GradingCompany = 'PSA' | 'BGS' | 'CGC' | 'SGC' | 'TAG' | 'ACE' | 'other'

// Typed parameter shapes per event. Optional everywhere; defaults are
// chosen at the call site. auth_state, user_plan and page_type are
// attached automatically and need not be passed.
export type EventMap = {
  // Auth
  signup_started:            { auth_method?: AuthMethod; return_context?: ReturnContext; source_component?: string }
  signup_completed:          { auth_method?: AuthMethod; return_context?: ReturnContext }
  login_completed:           { auth_method?: AuthMethod; return_context?: ReturnContext }
  logout_completed:          { source_component?: string }
  auth_callback_failed:      { auth_method?: AuthMethod; failure_stage?: string }
  password_reset_requested:  { source_component?: string }
  password_reset_completed:  { source_component?: string }

  // Watchlist
  watchlist_add_attempt:     { card_slug?: string; set_slug?: string; source_component?: string }
  watchlist_add_success:     { card_slug?: string; set_slug?: string; source_component?: string }
  watchlist_remove:          { card_slug?: string; set_slug?: string; source_component?: string }
  watchlist_replay_after_auth: { card_slug?: string; set_slug?: string }

  // Portfolio
  portfolio_add_attempt:     { card_slug?: string; holding_type?: HoldingType; grading_company?: GradingCompany; grade?: string; source_component?: string }
  portfolio_add_success:     { card_slug?: string; holding_type?: HoldingType; grading_company?: GradingCompany; grade?: string; source_component?: string }
  portfolio_item_updated:    { card_slug?: string; holding_type?: HoldingType; source_component?: string }
  portfolio_item_removed:    { card_slug?: string; holding_type?: HoldingType; source_component?: string }

  // Card shows
  card_show_favourite_attempt: { show_id?: string; country_code?: string; source_component?: string }
  card_show_favourite_success: { show_id?: string; country_code?: string; source_component?: string }
  card_show_unfavourite:       { show_id?: string; country_code?: string; source_component?: string }
  card_show_replay_after_auth: { show_id?: string; country_code?: string }

  // AI assistant
  ai_question_submitted:     { query_type?: string; source_component?: string }
  ai_response_received:      { query_type?: string; response_status?: string; card_found?: 'yes' | 'no' }
  ai_card_clicked:           { card_slug?: string; query_type?: string; source_component?: string }
  ai_ebay_clicked:           { card_slug?: string; marketplace?: Marketplace; intent?: AffiliateIntent; source_component?: string }
  ai_error:                  { failure_stage?: string; response_status?: string }

  // Affiliate — grading_company widened to string so the central engine
  // (which normalises any company name to upper-case) can spread its
  // analytics object directly into these events without a narrow cast.
  affiliate_link_view:       { card_slug?: string; set_slug?: string; placement?: string; marketplace?: Marketplace | string; intent?: AffiliateIntent; grading_company?: string; grade?: string; language?: string; custom_tracking_id?: string; source_component?: string }
  affiliate_click:           { card_slug?: string; set_slug?: string; placement?: string; marketplace?: Marketplace | string; intent?: AffiliateIntent; grading_company?: string; grade?: string; language?: string; custom_tracking_id?: string; source_component?: string }

  // Account / dashboard
  dashboard_view:            { feature_name?: string; source_component?: string }
  profile_saved:             { source_component?: string }
  settings_saved:            { feature_name?: string; source_component?: string }
  account_feature_view:      { feature_name?: string; source_component?: string }

  // Vendor
  vendor_submission_started:    { country_code?: string; vendor_type?: string }
  vendor_submission_completed:  { country_code?: string; vendor_type?: string; has_logo?: 'yes' | 'no' }
  vendor_logo_upload_success:   { vendor_type?: string }
  vendor_logo_upload_failed:    { vendor_type?: string; failure_stage?: string }

  // Onboarding (Block 3B)
  onboarding_enrolled:          { auth_method?: AuthMethod; source_component?: string }
  onboarding_email_sent:        { template_key?: string; step?: string; outcome?: string; activation_branch?: string }
  onboarding_email_skipped:     { template_key?: string; step?: string; reason?: string }
  onboarding_completed:         { last_step?: string }
  onboarding_cancelled:         { reason?: string; source_component?: string }
}

export type EventName = keyof EventMap

// ── Forbidden keys (PII guard) ──────────────────────────────────────────────
// Dropped before any event reaches gtag, regardless of the typed shape.
const FORBIDDEN_KEYS = new Set<string>([
  'email', 'email_address', 'emailaddress',
  'user_id', 'userid', 'uid',
  'display_name', 'name',
  'password', 'pw', 'secret',
  'token', 'access_token', 'refresh_token', 'session', 'jwt',
  'prompt', 'question', 'query_text', 'query', 'message', 'response_text',
  'notes', 'note',
  'purchase_price', 'price_paid', 'price',
  'portfolio_value', 'collection_value', 'total_value',
  'address', 'phone',
])

const MAX_STRING_LEN = 100
const MAX_PARAMS_PER_EVENT = 25

// ── Internal cache ──────────────────────────────────────────────────────────
let _authState: AuthState = 'anonymous'
let _plan:      Plan      = 'anonymous'
let _inited     = false

function inDevelopment(): boolean {
  // Truthy when run under `next dev` or Vitest. Never relied upon for
  // anything except debug logging.
  return typeof process !== 'undefined' && process.env.NODE_ENV !== 'production'
}

function debugFlag(): boolean {
  if (inDevelopment()) return true
  try {
    return typeof window !== 'undefined'
      && window.localStorage?.getItem('pp_analytics_debug') === '1'
  } catch { return false }
}

function suppressGa(): boolean {
  // Used by manual QA to avoid polluting production GA4 from a logged-in
  // tab. Off by default.
  try {
    return typeof window !== 'undefined'
      && window.localStorage?.getItem('pp_analytics_local_only') === '1'
  } catch { return false }
}

// ── Sanitiser ───────────────────────────────────────────────────────────────

type AnyParams = Record<string, unknown>

function isPlainObject(x: unknown): x is AnyParams {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}

function sanitiseValue(v: unknown): string | number | boolean | undefined {
  if (v == null) return undefined
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (!trimmed) return undefined
    return trimmed.length > MAX_STRING_LEN ? trimmed.slice(0, MAX_STRING_LEN) : trimmed
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'boolean') return v
  // Drop arrays, objects, functions and other shapes.
  return undefined
}

function sanitiseParams(eventName: string, raw: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  if (!isPlainObject(raw)) return out
  let kept = 0
  for (const [keyRaw, valRaw] of Object.entries(raw)) {
    if (kept >= MAX_PARAMS_PER_EVENT) break
    const key = keyRaw.toLowerCase()
    if (FORBIDDEN_KEYS.has(key)) {
      if (debugFlag()) {
        // Surface the offending name only — never the value.
        // eslint-disable-next-line no-console
        console.warn(`[analytics] dropped forbidden param "${key}" from event ${eventName}`)
      }
      continue
    }
    const v = sanitiseValue(valRaw)
    if (v === undefined) continue
    out[key] = v
    kept++
  }
  return out
}

// ── Auto-attached dimensions ────────────────────────────────────────────────

function currentPageType(): PageType {
  try {
    return classifyPageType(typeof window !== 'undefined' ? window.location.pathname : null)
  } catch { return 'other' }
}

function withDefaults(name: EventName, params: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  // Only fill values that the caller didn't supply.
  if (!('page_type' in params))  params['page_type']  = currentPageType()
  if (!('auth_state' in params)) params['auth_state'] = _authState
  if (!('user_plan'  in params)) params['user_plan']  = _plan
  return params
}

// ── Public API ──────────────────────────────────────────────────────────────

declare global {
  interface Window {
    gtag?:      (...args: any[]) => void
    dataLayer?: any[]
  }
}

/**
 * Fire a typed analytics event. Safe in any client context.
 *
 *   trackEvent('watchlist_add_success', { card_slug: 'pikachu-58', source_component: 'card_quick_actions' })
 */
export function trackEvent<K extends EventName>(name: K, params?: EventMap[K]): void {
  try {
    if (typeof window === 'undefined') return
    const clean = sanitiseParams(name, params)
    const final = withDefaults(name, clean)

    if (debugFlag()) {
      // eslint-disable-next-line no-console
      console.debug(`[analytics] ${name}`, final)
    }

    if (suppressGa()) return
    if (typeof window.gtag === 'function') {
      window.gtag('event', name, final)
    }
  } catch {
    // Analytics must never break user interaction. Swallow.
  }
}

/**
 * Variant that also attaches first-touch + last-touch attribution under
 * ft_* / lt_* keys. Use only for genuinely commercial events (signup
 * completion, affiliate click) — attribution adds up to 12 extra GA4
 * parameters per event.
 */
export function trackEventWithAttribution<K extends EventName>(name: K, params?: EventMap[K]): void {
  const merged: Record<string, unknown> = { ...(params as AnyParams) }
  try {
    const attr = attributionDimensions()
    Object.assign(merged, attr)
  } catch { /* attribution failure must not block the event */ }
  trackEvent(name, merged as EventMap[K])
}

// ── Auth context update (read by every event) ───────────────────────────────

export function setAuthContext(state: AuthState, plan: Plan = state === 'authenticated' ? 'free' : 'anonymous'): void {
  _authState = state
  _plan      = plan
}

export function getAuthContextSnapshot(): { auth_state: AuthState; user_plan: Plan } {
  return { auth_state: _authState, user_plan: _plan }
}

export function markInited(): void { _inited = true }
export function isInited():   boolean { return _inited }

// ── Re-exports for callers that want the classifier directly ───────────────
export { classifyPageType } from './pageType'
export type { PageType } from './pageType'
