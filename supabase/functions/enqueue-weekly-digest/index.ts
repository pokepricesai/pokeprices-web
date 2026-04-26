// supabase/functions/enqueue-weekly-digest/index.ts
// Schedules a weekly digest email for every opted-in user with a non-empty watchlist.
// Trigger via cron once per week (e.g. Sunday morning UK time).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') || ''
  if (!auth.includes(SERVICE_KEY)) return new Response('Forbidden', { status: 403 })

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)

  // All users who opted in to weekly digest
  const { data: optedIn } = await supa
    .from('user_email_preferences')
    .select('user_id')
    .eq('weekly_digest_enabled', true)

  let queued = 0

  for (const row of optedIn || []) {
    const userId = row.user_id

    // Pull this user's watchlist with prices via RPC (security definer respects user_id arg)
    const { data: watch } = await supa.rpc('get_watchlist_with_prices', { p_user_id: userId })
    const watchlist = (watch || []) as any[]
    if (watchlist.length === 0) continue

    // Top riser / faller by 30d
    const withPct = watchlist.filter(w => w.pct_30d != null)
    const topRiser  = withPct.length ? [...withPct].sort((a, b) => (b.pct_30d || 0) - (a.pct_30d || 0))[0] : null
    const topFaller = withPct.length ? [...withPct].sort((a, b) => (a.pct_30d || 0) - (b.pct_30d || 0))[0] : null

    // Active alerts — find ones with current price within 10% of threshold (not yet triggered)
    const { data: alerts } = await supa.rpc('get_alerts_with_prices', { p_user_id: userId })
    const nearTarget = (alerts || [])
      .filter((a: any) => a.is_active && a.triggered_at == null && a.distance_pct != null && Math.abs(a.distance_pct) <= 10)
      .slice(0, 5)
      .map((a: any) => ({
        card_name: a.card_name,
        set_name: a.set_name,
        card_url_slug: a.card_url_slug,
        card_slug: a.card_slug,
        grade: a.grade,
        alert_type: a.alert_type,
        threshold_cents: a.threshold_cents,
        current_cents: a.current_cents,
        image_url: a.image_url,
      }))

    const payload = {
      topRiser:  topRiser  ? toMover(topRiser)  : null,
      topFaller: topFaller ? toMover(topFaller) : null,
      nearTarget,
      totalWatching: watchlist.length,
    }

    await supa.from('pending_emails').insert([{
      user_id: userId,
      email_type: 'weekly_digest',
      payload_json: payload,
    }])
    queued++
  }

  return new Response(JSON.stringify({ ok: true, queued }), { headers: { 'Content-Type': 'application/json' } })
})

function toMover(w: any) {
  return {
    card_name: w.card_name,
    set_name: w.set_name,
    card_url_slug: w.card_url_slug,
    card_slug: w.card_slug,
    current_raw: w.current_raw,
    pct_30d: w.pct_30d,
  }
}
