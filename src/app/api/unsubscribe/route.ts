// src/app/api/unsubscribe/route.ts
// One-click unsubscribe via token. Disables both alert + weekly emails.
// Token is generated per-user in user_email_preferences.unsubscribe_token.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

export async function GET(req: Request) {
  return handle(req)
}

export async function POST(req: Request) {
  // List-Unsubscribe-Post one-click also fires a POST request.
  return handle(req)
}

async function handle(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  if (!token) {
    return new NextResponse(html('Missing token.'), { headers: { 'Content-Type': 'text/html' } })
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new NextResponse(html('Server misconfigured.'), { status: 500, headers: { 'Content-Type': 'text/html' } })
  }

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)

  const { data: prefs } = await supa
    .from('user_email_preferences')
    .select('user_id')
    .eq('unsubscribe_token', token)
    .maybeSingle()

  if (!prefs) {
    return new NextResponse(html('That unsubscribe link is invalid or expired.'), { headers: { 'Content-Type': 'text/html' } })
  }

  await supa
    .from('user_email_preferences')
    .update({
      alert_emails_enabled: false,
      weekly_digest_enabled: false,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', prefs.user_id)

  return new NextResponse(
    html('You have been unsubscribed from PokePrices alert and digest emails. You can re-enable them any time from your dashboard.'),
    { headers: { 'Content-Type': 'text/html' } }
  )
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
