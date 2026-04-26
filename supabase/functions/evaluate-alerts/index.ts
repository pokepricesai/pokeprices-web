// supabase/functions/evaluate-alerts/index.ts
// Trigger this AFTER each nightly price refresh.
// 1. Finds active alerts whose threshold is currently crossed
// 2. Marks them triggered_at = now()
// 3. Queues alert_digest emails (one per user) into pending_emails
//
// Auth: requires Authorization: Bearer <ALERTS_TRIGGER_SECRET>
// Run with:
//   curl -X POST -H "Authorization: Bearer $ALERTS_TRIGGER_SECRET" \
//        https://<ref>.supabase.co/functions/v1/evaluate-alerts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SHARED_SECRET = Deno.env.get('ALERTS_TRIGGER_SECRET') || ''

Deno.serve(async (req) => {
  // Auth check: must include service-role key OR the optional shared secret.
  const authHeader = req.headers.get('Authorization') || ''
  const callerOk =
    authHeader.includes(SERVICE_KEY) ||
    (SHARED_SECRET.length > 0 && authHeader.includes(SHARED_SECRET))
  if (!callerOk) return new Response('Forbidden', { status: 403 })

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)

  // Pull all active alerts with current price (uses a server-side join)
  const { data: alerts, error } = await supa
    .from('user_alerts')
    .select('id, user_id, card_slug, card_name, set_name, card_url_slug, image_url, grade, alert_type, threshold_cents, triggered_at')
    .eq('is_active', true)

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  const cardKeys = Array.from(new Set((alerts || []).map(a => `${a.card_name}|||${a.set_name}`)))
  const trends: Record<string, any> = {}
  if (cardKeys.length > 0) {
    // Bulk fetch trend rows for matched (card_name, set_name) pairs
    const cardNames = Array.from(new Set((alerts || []).map(a => a.card_name)))
    const { data: trendRows } = await supa
      .from('card_trends')
      .select('card_name, set_name, current_raw, current_psa9, current_psa10')
      .in('card_name', cardNames)
    for (const t of trendRows || []) {
      trends[`${t.card_name}|||${t.set_name}`] = t
    }
  }

  const triggeredIds: string[] = []
  const hitsByUser: Record<string, any[]> = {}

  for (const a of alerts || []) {
    const t = trends[`${a.card_name}|||${a.set_name}`]
    if (!t) continue
    const current = a.grade === 'raw' ? t.current_raw : a.grade === 'psa9' ? t.current_psa9 : t.current_psa10
    if (current == null) continue

    const crossed = a.alert_type === 'price_below'
      ? current <= a.threshold_cents
      : current >= a.threshold_cents

    if (!crossed) continue
    // Already triggered? Skip duplicates until alert is reset by user.
    if (a.triggered_at) continue

    triggeredIds.push(a.id)
    if (!hitsByUser[a.user_id]) hitsByUser[a.user_id] = []
    hitsByUser[a.user_id].push({
      card_name: a.card_name,
      set_name: a.set_name,
      card_url_slug: a.card_url_slug,
      card_slug: a.card_slug,
      grade: a.grade,
      alert_type: a.alert_type,
      threshold_cents: a.threshold_cents,
      current_cents: current,
      image_url: a.image_url,
    })
  }

  // Mark alerts as triggered
  if (triggeredIds.length > 0) {
    await supa
      .from('user_alerts')
      .update({ triggered_at: new Date().toISOString() })
      .in('id', triggeredIds)
  }

  // Queue emails for users who opted in. Cadence: 'instant' goes immediately;
  // 'daily' is also queued now and the cron sender will dispatch at the next run.
  // Both honour the alert_emails_enabled flag.
  let queued = 0
  for (const [userId, hits] of Object.entries(hitsByUser)) {
    const { data: prefs } = await supa
      .from('user_email_preferences')
      .select('alert_emails_enabled, alert_cadence')
      .eq('user_id', userId)
      .maybeSingle()

    if (!prefs?.alert_emails_enabled) continue

    await supa.from('pending_emails').insert([{
      user_id: userId,
      email_type: prefs.alert_cadence === 'instant' ? 'alert_instant' : 'alert_digest',
      payload_json: { hits },
    }])
    queued++
  }

  return new Response(JSON.stringify({
    ok: true,
    alerts_evaluated: alerts?.length || 0,
    alerts_triggered: triggeredIds.length,
    emails_queued: queued,
  }), { headers: { 'Content-Type': 'application/json' } })
})
