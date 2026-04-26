// supabase/functions/send-pending-emails/index.ts
// Drains the pending_emails queue. Run via cron every 5–15 minutes.
//
// Auth: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> (or any cron-trigger pattern)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail, alertDigestEmail, weeklyDigestEmail, type AlertHit, type WatchMover } from '../_shared/email.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SITE         = Deno.env.get('PUBLIC_SITE_URL') || 'https://www.pokeprices.io'
const BATCH        = 25  // limit per invocation

Deno.serve(async (req) => {
  // Service-role auth required
  const auth = req.headers.get('Authorization') || ''
  if (!auth.includes(SERVICE_KEY)) {
    return new Response('Forbidden', { status: 403 })
  }

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)

  const { data: queue, error } = await supa
    .from('pending_emails')
    .select('id, user_id, email_type, payload_json, attempts')
    .is('sent_at', null)
    .lte('scheduled_for', new Date().toISOString())
    .lt('attempts', 5)
    .order('scheduled_for', { ascending: true })
    .limit(BATCH)

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  const results: any[] = []

  for (const row of queue || []) {
    // Resolve recipient email + unsubscribe token
    const { data: userRow } = await supa.auth.admin.getUserById(row.user_id)
    const email = userRow?.user?.email
    if (!email) {
      await supa.from('pending_emails').update({ attempts: row.attempts + 1, last_error: 'no_email' }).eq('id', row.id)
      continue
    }

    const { data: prefs } = await supa
      .from('user_email_preferences')
      .select('unsubscribe_token, alert_emails_enabled, weekly_digest_enabled')
      .eq('user_id', row.user_id)
      .maybeSingle()

    const unsubscribeUrl = `${SITE}/api/unsubscribe?token=${prefs?.unsubscribe_token || ''}`

    let payload: { subject: string; html: string; text: string } | null = null

    if (row.email_type === 'alert_digest' || row.email_type === 'alert_instant') {
      if (!prefs?.alert_emails_enabled) {
        await supa.from('pending_emails').update({ sent_at: new Date().toISOString(), last_error: 'unsubscribed' }).eq('id', row.id)
        continue
      }
      const hits: AlertHit[] = row.payload_json?.hits || []
      if (hits.length === 0) continue
      payload = alertDigestEmail({ hits, unsubscribeUrl })
    }

    else if (row.email_type === 'weekly_digest') {
      if (!prefs?.weekly_digest_enabled) {
        await supa.from('pending_emails').update({ sent_at: new Date().toISOString(), last_error: 'unsubscribed' }).eq('id', row.id)
        continue
      }
      const p = row.payload_json || {}
      payload = weeklyDigestEmail({
        topRiser:      p.topRiser as WatchMover | null,
        topFaller:     p.topFaller as WatchMover | null,
        nearTarget:    (p.nearTarget as AlertHit[]) || [],
        totalWatching: p.totalWatching || 0,
        unsubscribeUrl,
      })
    }

    if (!payload) {
      await supa.from('pending_emails').update({ attempts: row.attempts + 1, last_error: 'unsupported_type' }).eq('id', row.id)
      continue
    }

    const send = await sendEmail({
      to: email,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      unsubscribeUrl,
    })

    if (send.ok) {
      await supa.from('pending_emails').update({ sent_at: new Date().toISOString() }).eq('id', row.id)
      if (row.email_type === 'weekly_digest') {
        await supa.from('user_email_preferences')
          .update({ last_digest_sent_at: new Date().toISOString() })
          .eq('user_id', row.user_id)
      }
      results.push({ id: row.id, ok: true, resend_id: send.id })
    } else {
      await supa.from('pending_emails').update({
        attempts: row.attempts + 1,
        last_error: send.error || 'unknown',
      }).eq('id', row.id)
      results.push({ id: row.id, ok: false, error: send.error })
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
