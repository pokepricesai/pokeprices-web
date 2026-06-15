// src/app/api/admin/test-resend/route.ts
// Temporary, server-only admin endpoint that proves the Vercel
// RESEND_API_KEY can deliver a single email through the Resend API.
//
// Hard rules
//   * Recipient is read from a server-only env var (EMAIL_TEST_RECIPIENT)
//     and is NEVER taken from the request body or query string. The
//     route does not even parse a body — bytes from the browser are
//     dropped on the floor.
//   * Caller must hold a valid Supabase session AND be in the
//     ADMIN_ALLOWED_EMAILS allow-list (Block 1A).
//   * The Resend key never leaves the server context. It is read once
//     per request, used in-process, and never echoed back to the
//     caller, logged, or attached to any error message.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { Resend } from 'resend'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FROM_ADDRESS = 'PokePrices <hello@pokeprices.io>'
const SUBJECT      = 'PokePrices Vercel email test'

function logMissing(names: string[]): void {
  if (names.length === 0) return
  console.error('[admin/test-resend] missing env vars:', names.join(', '))
}

export async function POST(req: Request) {
  // 1. Admin auth.
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status })
  }

  // 2. Server-only configuration.
  const apiKey    = (process.env.RESEND_API_KEY     ?? '').trim()
  const recipient = (process.env.EMAIL_TEST_RECIPIENT ?? '').trim()
  const missing: string[] = []
  if (!apiKey)    missing.push('RESEND_API_KEY')
  if (!recipient) missing.push('EMAIL_TEST_RECIPIENT')
  if (missing.length > 0) {
    logMissing(missing)
    return NextResponse.json(
      { success: false, error: 'Email service not configured' },
      { status: 503 },
    )
  }

  // 3. Compose the body. Timestamp is ISO 8601 UTC for clarity in logs.
  //    Vercel sets VERCEL_ENV to "production" / "preview" / "development"
  //    on every build; we report it when present.
  const timestamp = new Date().toISOString()
  const vercelEnv = (process.env.VERCEL_ENV ?? '').trim() || 'unknown'

  const text = [
    'This email was sent directly by the PokePrices Vercel application',
    'through the Resend API.',
    '',
    `Timestamp: ${timestamp}`,
    `Vercel environment: ${vercelEnv}`,
    '',
    'If you received this, the Resend API key on Vercel is wired up',
    'correctly. No further action is required.',
  ].join('\n')

  const html =
    `<p>This email was sent directly by the PokePrices Vercel application ` +
    `through the Resend API.</p>` +
    `<p><strong>Timestamp:</strong> ${timestamp}<br/>` +
    `<strong>Vercel environment:</strong> ${vercelEnv}</p>` +
    `<p>If you received this, the Resend API key on Vercel is wired up ` +
    `correctly. No further action is required.</p>`

  // 4. Send. Resend's SDK returns { data, error } — we forward neither
  //    verbatim. Only a generic message ever crosses the wire to the
  //    browser; the server-side log carries the Resend error code +
  //    safe message for triage.
  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
      from:    FROM_ADDRESS,
      to:      recipient,
      subject: SUBJECT,
      text,
      html,
    })

    if (error) {
      console.error(
        '[admin/test-resend] resend error:',
        // Resend errors carry { name, message }; both are operator-safe.
        // We deliberately do NOT log any request body or the api key.
        (error as { name?: string }).name ?? 'unknown',
        (error as { message?: string }).message ?? '',
      )
      return NextResponse.json(
        { success: false, error: 'Send failed' },
        { status: 502 },
      )
    }

    const emailId = (data && typeof (data as { id?: string }).id === 'string')
      ? (data as { id: string }).id
      : null

    return NextResponse.json({ success: true, emailId })
  } catch (e) {
    // Network/SDK fault — never echo the raw exception to the browser.
    console.error(
      '[admin/test-resend] unexpected error:',
      e instanceof Error ? e.name + ': ' + e.message : 'non-Error throw',
    )
    return NextResponse.json(
      { success: false, error: 'Send failed' },
      { status: 502 },
    )
  }
}
