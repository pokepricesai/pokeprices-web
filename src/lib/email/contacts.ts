// src/lib/email/contacts.ts
// Server-only helpers for the canonical email_contacts table.
//
// All writes go through the service-role client. Direct anonymous
// insert is intentionally not exposed: a future newsletter signup
// route in Block 3B will call upsertContact() server-side.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { normalizeEmail } from './normalize'

export type Contact = {
  id:               string
  email_normalized: string
  user_id:          string | null
  email_verified:   boolean
}

export type ContactSource =
  | 'auth_signup'
  | 'newsletter_form'
  | 'admin_import'
  | 'webhook_backfill'
  | 'send_service'

/**
 * Upserts a contact keyed by normalised email. If a row already exists,
 * `user_id` is patched only when it was previously NULL — historical
 * link-ups are preserved.
 *
 * Returns null when:
 *   * the email cannot be normalised, or
 *   * the underlying Supabase call errored (operator logs the cause;
 *     callers translate this into the right HTTP response).
 */
export async function upsertContact(input: {
  email:   string
  userId?: string | null
  source:  ContactSource
}): Promise<Contact | null> {
  const email = normalizeEmail(input.email)
  if (!email) return null

  const supa = getSupabaseServiceClient()

  // Try to read first — keeps the historical user_id when it is already
  // set, and avoids touching updated_at when nothing changed.
  const existing = await supa
    .from('email_contacts')
    .select('id, email_normalized, user_id, email_verified')
    .eq('email_normalized', email)
    .maybeSingle()

  if (existing.error) {
    console.error('[email/contacts] read failed:', existing.error.code, existing.error.message)
    return null
  }

  if (existing.data) {
    // Backfill user_id if we now know it.
    if (!existing.data.user_id && input.userId) {
      const patch = await supa
        .from('email_contacts')
        .update({ user_id: input.userId, updated_at: new Date().toISOString() })
        .eq('id', existing.data.id)
        .select('id, email_normalized, user_id, email_verified')
        .single()
      if (patch.error) {
        console.error('[email/contacts] user_id backfill failed:', patch.error.code)
        return existing.data as Contact
      }
      return patch.data as Contact
    }
    return existing.data as Contact
  }

  const insert = await supa
    .from('email_contacts')
    .insert({
      email_normalized: email,
      user_id:          input.userId ?? null,
      source:           input.source,
    })
    .select('id, email_normalized, user_id, email_verified')
    .single()

  if (insert.error) {
    console.error('[email/contacts] insert failed:', insert.error.code, insert.error.message)
    return null
  }
  return insert.data as Contact
}

export async function findContactByEmail(email: string): Promise<Contact | null> {
  const normalized = normalizeEmail(email)
  if (!normalized) return null
  const supa = getSupabaseServiceClient()
  const r = await supa
    .from('email_contacts')
    .select('id, email_normalized, user_id, email_verified')
    .eq('email_normalized', normalized)
    .maybeSingle()
  if (r.error) {
    console.error('[email/contacts] findByEmail failed:', r.error.code)
    return null
  }
  return (r.data as Contact | null) ?? null
}

export async function findContactByResendEmailId(resendEmailId: string): Promise<Contact | null> {
  const supa = getSupabaseServiceClient()
  // Resolve via the delivery log row, which carries both resend_email_id
  // and contact_id.
  const r = await supa
    .from('email_delivery_log')
    .select('contact_id')
    .eq('resend_email_id', resendEmailId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (r.error || !r.data?.contact_id) return null
  const c = await supa
    .from('email_contacts')
    .select('id, email_normalized, user_id, email_verified')
    .eq('id', r.data.contact_id)
    .maybeSingle()
  if (c.error) return null
  return (c.data as Contact | null) ?? null
}
