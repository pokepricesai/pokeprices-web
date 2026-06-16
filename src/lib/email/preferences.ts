// src/lib/email/preferences.ts
// Server-only resolver for "is this contact opted in to this category?".
//
// Resolution order:
//   1. The most-recent row in email_consents for (contact, category)
//      wins. state='granted' → opted in, state='revoked' → opted out.
//   2. When no consent row exists, transactional + service_product
//      default to OPTED IN (we must be able to send password resets and
//      account-critical messages without prior opt-in).
//   3. Watchlist alerts + weekly report bridge to the existing
//      user_email_preferences table (Block 1B) when the contact is
//      linked to a user_id. This keeps the existing dashboard toggles
//      authoritative until 3B/3C cuts over.
//   4. Everything else (marketing_newsletter, card_show_reminder,
//      onboarding) defaults to OPTED OUT — historical accounts did not
//      grant marketing consent under this model.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { type EmailCategory, EMAIL_CATEGORIES } from './categories'

export type PreferenceDecision = {
  optedIn: boolean
  source:  'explicit_consent' | 'transactional_default' | 'service_default' | 'bridge_user_email_preferences' | 'marketing_default'
}

export async function isOptedIn(input: {
  contactId: string
  userId?:   string | null
  category:  EmailCategory
}): Promise<PreferenceDecision> {
  const supa = getSupabaseServiceClient()

  // 1. Explicit consent — most-recent row wins.
  const consent = await supa
    .from('email_consents')
    .select('state, created_at')
    .eq('contact_id', input.contactId)
    .eq('category',   input.category)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!consent.error && consent.data) {
    return {
      optedIn: consent.data.state === 'granted',
      source:  'explicit_consent',
    }
  }

  // 2. Sensible category defaults.
  switch (input.category) {
    case EMAIL_CATEGORIES.TRANSACTIONAL:
      return { optedIn: true, source: 'transactional_default' }

    case EMAIL_CATEGORIES.SERVICE_PRODUCT:
      return { optedIn: true, source: 'service_default' }

    // 3. Bridge to Block 1B prefs while they remain authoritative.
    case EMAIL_CATEGORIES.WATCHLIST_ALERT: {
      if (!input.userId) return { optedIn: false, source: 'marketing_default' }
      const bridge = await supa
        .from('user_email_preferences')
        .select('alert_emails_enabled')
        .eq('user_id', input.userId)
        .maybeSingle()
      if (bridge.error || !bridge.data) {
        // No row yet → ensure_email_preferences will default it to TRUE
        // for the user the next time the dashboard runs. Treat the
        // absence as opted in to match that future state.
        return { optedIn: true, source: 'bridge_user_email_preferences' }
      }
      return {
        optedIn: bridge.data.alert_emails_enabled === true,
        source:  'bridge_user_email_preferences',
      }
    }
    case EMAIL_CATEGORIES.WEEKLY_REPORT: {
      if (!input.userId) return { optedIn: false, source: 'marketing_default' }
      const bridge = await supa
        .from('user_email_preferences')
        .select('weekly_digest_enabled')
        .eq('user_id', input.userId)
        .maybeSingle()
      if (bridge.error || !bridge.data) {
        return { optedIn: true, source: 'bridge_user_email_preferences' }
      }
      return {
        optedIn: bridge.data.weekly_digest_enabled === true,
        source:  'bridge_user_email_preferences',
      }
    }

    // 4. Everything else defaults to NOT opted in — no silent marketing.
    case EMAIL_CATEGORIES.MARKETING_NEWSLETTER:
    case EMAIL_CATEGORIES.CARD_SHOW_REMINDER:
    case EMAIL_CATEGORIES.ONBOARDING:
    default:
      return { optedIn: false, source: 'marketing_default' }
  }
}

/**
 * Records a consent event. Append-only — historical rows are never
 * overwritten.
 */
export async function recordConsent(input: {
  contactId:      string
  category:       EmailCategory
  state:          'granted' | 'revoked'
  source:         string
  consentVersion?: string
  notesInternal?: string | null
}): Promise<{ ok: boolean }> {
  const supa = getSupabaseServiceClient()
  const r = await supa
    .from('email_consents')
    .insert({
      contact_id:      input.contactId,
      category:        input.category,
      state:           input.state,
      source:          input.source,
      consent_version: input.consentVersion ?? 'v1',
      notes_internal:  input.notesInternal  ?? null,
    })
    .select('id')
    .single()
  if (r.error) {
    console.error('[email/preferences] consent insert failed:', r.error.code)
    return { ok: false }
  }
  return { ok: true }
}
