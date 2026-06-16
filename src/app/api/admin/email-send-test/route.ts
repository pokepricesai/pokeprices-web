// src/app/api/admin/email-send-test/route.ts
// Admin-only test send. Locked recipient (EMAIL_TEST_RECIPIENT) and
// locked template allow-list. The admin can choose WHICH template to
// send but never WHO it is sent to, the subject, or the body.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { isApprovedTemplateKey, renderTemplate, TEMPLATE_KEYS } from '@/emails/render'
import { sendEmail } from '@/lib/email/send'
import type { ActivationBranch } from '@/lib/email/onboardingActivation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  // Convenience listing for the admin UI; no auth-sensitive info.
  return NextResponse.json({ templates: TEMPLATE_KEYS })
}

export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status })
  }

  let body: { template?: string; branch?: string } = {}
  try { body = await req.json() } catch { /* empty body acceptable */ }

  const templateKey = body?.template
  if (!isApprovedTemplateKey(templateKey)) {
    return NextResponse.json({ success: false, error: 'unknown template' }, { status: 400 })
  }

  const bodyBranch = body?.branch
  const activationBranch: ActivationBranch | undefined =
    bodyBranch === 'A' || bodyBranch === 'B' || bodyBranch === 'C' || bodyBranch === 'D'
      ? bodyBranch
      : undefined

  const recipient = (process.env.EMAIL_TEST_RECIPIENT ?? '').trim()
  if (!recipient) {
    console.error('[admin/email-send-test] missing env vars: EMAIL_TEST_RECIPIENT')
    return NextResponse.json(
      { success: false, error: 'Email service not configured' },
      { status: 503 },
    )
  }

  let rendered
  try {
    rendered = await renderTemplate({
      key:              templateKey,
      preferencesUrl:   'https://www.pokeprices.io/dashboard/settings',
      displayName:      'Collector',
      activationBranch,
      // Admin send-tests prefix the subject with "[TEST] " so the
      // recipient cannot confuse the message with a real onboarding
      // send. Block 3B §10.
      testPrefix:       true,
    })
  } catch {
    return NextResponse.json({ success: false, error: 'render failed' }, { status: 500 })
  }

  const idempotencyKey = `admin-test:${templateKey}:${Date.now()}:${crypto.randomUUID()}`

  const result = await sendEmail({
    toEmail:        recipient,
    category:       rendered.category,
    templateKey,
    subject:        rendered.subject,
    html:           rendered.html,
    text:           rendered.text,
    idempotencyKey,
    adminBypass:    { reason: 'admin_email_send_test', recipientLocked: true },
  })

  if (result.outcome === 'sent') {
    return NextResponse.json({
      success:  true,
      emailId:  result.emailId ?? null,
      template: templateKey,
    })
  }
  if (result.outcome === 'configuration_error') {
    return NextResponse.json(
      { success: false, error: 'Email service not configured' },
      { status: 503 },
    )
  }
  if (result.outcome === 'duplicate') {
    return NextResponse.json(
      { success: false, error: 'Duplicate request' },
      { status: 409 },
    )
  }
  return NextResponse.json(
    { success: false, error: 'Send failed' },
    { status: 502 },
  )
}
