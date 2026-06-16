// src/app/api/admin/test-resend/route.ts
// Block 2C/2D temporary admin endpoint that proves the Vercel
// RESEND_API_KEY can deliver a single email through the Resend API.
//
// Block 3A — refactored to route through the central send service
// (src/lib/email/send.ts) and the central React Email DeliveryTest
// template. Public contract preserved:
//
//   * Recipient is read from a server-only env var
//     (EMAIL_TEST_RECIPIENT) and is NEVER taken from the request body
//     or query string. The route does not even parse a body.
//   * Caller must hold a valid Supabase session AND be in the
//     ADMIN_ALLOWED_EMAILS allow-list (Block 1A).
//   * The Resend key never leaves the server context; the central
//     client owns instantiation.
//
// Same JSON shape as Block 2D so the existing admin button keeps
// working without code changes.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { renderTemplate, DELIVERY_TEST_KEY } from '@/emails/render'
import { sendEmail } from '@/lib/email/send'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  // 1. Admin auth.
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status })
  }

  // 2. Server-only recipient lock.
  const recipient = (process.env.EMAIL_TEST_RECIPIENT ?? '').trim()
  if (!recipient) {
    console.error('[admin/test-resend] missing env vars: EMAIL_TEST_RECIPIENT')
    return NextResponse.json(
      { success: false, error: 'Email service not configured' },
      { status: 503 },
    )
  }

  // 3. Render the canonical DeliveryTest template via the central
  //    renderer. The template is allow-listed; subject/body/category
  //    are owned by the template, not the caller.
  let rendered
  try {
    rendered = await renderTemplate({ key: DELIVERY_TEST_KEY })
  } catch (e) {
    console.error('[admin/test-resend] render failed:', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ success: false, error: 'Send failed' }, { status: 502 })
  }

  // 4. Send through the central service with the explicit admin
  //    bypass (recipient is already locked above; preference + suppression
  //    checks are skipped because this is an operator smoke test).
  const idempotencyKey =
    `admin-test-resend:${new Date().toISOString().slice(0, 19)}:${crypto.randomUUID()}`

  const result = await sendEmail({
    toEmail:        recipient,
    category:       rendered.category,
    templateKey:    DELIVERY_TEST_KEY,
    subject:        rendered.subject,
    html:           rendered.html,
    text:           rendered.text,
    idempotencyKey,
    adminBypass:    { reason: 'admin_test_resend', recipientLocked: true },
  })

  if (result.outcome === 'sent') {
    return NextResponse.json({ success: true, emailId: result.emailId ?? null })
  }
  if (result.outcome === 'configuration_error') {
    return NextResponse.json(
      { success: false, error: 'Email service not configured' },
      { status: 503 },
    )
  }
  return NextResponse.json(
    { success: false, error: 'Send failed' },
    { status: 502 },
  )
}
