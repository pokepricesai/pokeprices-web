// src/app/api/unsubscribe/route.ts
// Block 1B route, upgraded in Block 3A (correction pass) to keep the
// canonical email model (email_contacts / email_consents /
// email_suppressions) in sync with the legacy user_email_preferences
// toggles. Existing unsubscribe links already in inboxes continue to
// work — the token format and URL shape are unchanged.
//
// Semantics:
//   * GET or POST with ?token=<unsubscribe_token>
//   * If the token matches an existing user_email_preferences row:
//       1. Find / create the email_contact for the user.
//       2. Append revoke consents for marketing_newsletter +
//          weekly_report + watchlist_alert (the categories the legacy
//          flag combination used to cover).
//       3. Apply a per-category manual_unsubscribe suppression on
//          marketing_newsletter. This deliberately does NOT block
//          transactional / service email — the user opted out of
//          marketing, not of account-critical messages.
//       4. Update user_email_preferences for backward compatibility
//          (weekly_digest_enabled + alert_emails_enabled = false).
//   * If the token does not match: do nothing.
//   * Either way the response is the SAME generic page — we never
//     reveal whether the token (or any address) was valid.
//
// The route is intentionally idempotent: a duplicate click writes the
// same canonical state and the user sees the same success page. The
// unique index on email_suppressions makes the suppression INSERT a
// no-op the second time around; email_consents is append-only, so a
// second visit just adds another (redundant) revoke row — operators
// can read it as confirmation of the click.
//
// Auth emails sent through Supabase Auth SMTP are NOT affected by this
// route — they live outside the application send service. See
// docs/email-infrastructure.md.

import 'server-only'
import { NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { recordConsent } from '@/lib/email/preferences'
import { applySuppression } from '@/lib/email/suppressions'
import { EMAIL_CATEGORIES } from '@/lib/email/categories'
import { normalizeEmail } from '@/lib/email/normalize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request)  { return handle(req) }
export async function POST(req: Request) { return handle(req) }

async function handle(req: Request) {
  const url   = new URL(req.url)
  const token = url.searchParams.get('token')

  // Always return the same generic page when no token is provided.
  // We never branch the visible response on token validity.
  if (token && typeof token === 'string') {
    // Best-effort write. Logged but never crashes the response.
    try { await applyUnsubscribe(token) }
    catch (e) {
      console.error('[unsubscribe] write failed:',
        e instanceof Error ? e.name + ': ' + e.message : 'non-Error throw')
    }
  }

  return new NextResponse(
    html('If your address was subscribed, you have been unsubscribed from PokePrices marketing emails. Service-critical messages will still reach you. Repeat clicks are safe.'),
    { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } },
  )
}

async function applyUnsubscribe(token: string): Promise<void> {
  const supa = getSupabaseServiceClient()

  // 1. Resolve the legacy token → user_id. No row → no further work.
  const pref = await supa
    .from('user_email_preferences')
    .select('user_id')
    .eq('unsubscribe_token', token)
    .maybeSingle()
  if (pref.error || !pref.data) return
  const userId = pref.data.user_id as string

  // 2. Legacy update — preserve Block 1B contract.
  await supa
    .from('user_email_preferences')
    .update({
      alert_emails_enabled:   false,
      weekly_digest_enabled:  false,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)

  // 3. Canonical model writes. Look up an existing email_contact via
  //    user_id; if none, fall back to auth.users.email to upsert one.
  let contactId: string | null = null
  const existing = await supa
    .from('email_contacts')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (existing.data?.id) {
    contactId = existing.data.id as string
  } else {
    const auth = await supa.auth.admin.getUserById(userId)
    const email = normalizeEmail(auth?.data?.user?.email ?? '')
    if (email) {
      const ins = await supa
        .from('email_contacts')
        .insert({ email_normalized: email, user_id: userId, source: 'unsubscribe_link' })
        .select('id')
        .single()
      if (!ins.error && ins.data?.id) contactId = ins.data.id as string
    }
  }
  if (!contactId) return // legacy update already done; canonical write is best-effort

  // 4. Revoke consent rows for the three categories the legacy flag
  //    pair used to cover, plus marketing_newsletter (the canonical
  //    marketing channel).
  const revokeCategories = [
    EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
    EMAIL_CATEGORIES.WEEKLY_REPORT,
    EMAIL_CATEGORIES.WATCHLIST_ALERT,
  ]
  for (const cat of revokeCategories) {
    await recordConsent({
      contactId,
      category:      cat,
      state:         'revoked',
      source:        'unsubscribe_link',
      notesInternal: 'one-click unsubscribe via legacy token',
    })
  }

  // 5. Per-category marketing suppression. Idempotent thanks to the
  //    unique index. NOT global — the operator can still send
  //    transactional / service email about the user's account.
  await applySuppression({
    contactId,
    reason:   'manual_unsubscribe',
    category: EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
    source:   'unsubscribe_link',
  })
}

function html(message: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed — PokePrices</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<style>
body{margin:0;padding:0;background:#f5f7fa;font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;}
.card{max-width:480px;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:32px 28px;margin:24px;text-align:center;}
h1{font-size:22px;margin:0 0 12px;}
p{font-size:14px;color:#4b5563;line-height:1.6;margin:0 0 20px;}
a{color:#1a5fad;font-weight:700;text-decoration:none;}
</style></head><body>
<div class="card">
  <h1>PokePrices</h1>
  <p>${message}</p>
  <p><a href="https://www.pokeprices.io/dashboard/settings">Manage email preferences</a></p>
</div>
</body></html>`
}
