// src/app/api/admin/email-preview/route.ts
// Admin-only template preview. Returns rendered HTML for an approved
// template key.
//
//   * GET  /api/admin/email-preview?template=<key>          → HTML
//   * GET  /api/admin/email-preview?template=<key>&format=json  → JSON
//
// Never accepts raw HTML or arbitrary props. The template key must be
// in the allow-list (renderTemplate enforces). Admin auth uses
// requireAdmin (Block 1A).

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { isApprovedTemplateKey, renderTemplate } from '@/emails/render'
import type { ActivationBranch } from '@/lib/email/onboardingActivation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  const url      = new URL(req.url)
  const template = url.searchParams.get('template')
  const format   = url.searchParams.get('format')
  const branch   = url.searchParams.get('branch')

  if (!isApprovedTemplateKey(template)) {
    return NextResponse.json({ error: 'unknown template' }, { status: 400 })
  }

  const activationBranch: ActivationBranch | undefined =
    branch === 'A' || branch === 'B' || branch === 'C' || branch === 'D'
      ? branch
      : undefined

  let rendered
  try {
    rendered = await renderTemplate({
      key:              template,
      preferencesUrl:   'https://www.pokeprices.io/dashboard/settings',
      displayName:      'Collector',
      activationBranch,
    })
  } catch (e) {
    console.error('[admin/email-preview] render failed:', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: 'render failed' }, { status: 500 })
  }

  if (format === 'json') {
    return NextResponse.json({
      template,
      subject:  rendered.subject,
      category: rendered.category,
      html:     rendered.html,
      text:     rendered.text,
    })
  }

  return new NextResponse(rendered.html, {
    status: 200,
    headers: {
      'Content-Type':   'text/html; charset=utf-8',
      'Cache-Control':  'no-store',
      // Anti-clickjack: previews are admin-only; explicitly deny embed.
      'X-Frame-Options': 'DENY',
    },
  })
}
