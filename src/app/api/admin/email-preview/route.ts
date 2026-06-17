// src/app/api/admin/email-preview/route.ts
// Admin-only template preview. Returns rendered HTML for an approved
// template key.
//
//   * GET  /api/admin/email-preview?template=<key>          → HTML (with admin label strip)
//   * GET  /api/admin/email-preview?template=<key>&format=json  → JSON
//   * GET  /api/admin/email-preview?template=<key>&raw=1     → HTML without the label strip
//
// Block 3C — small admin label strip added above the rendered email
// (template + branch + viewport hint). The strip is server-rendered
// HTML, no JS, no editor. The rendered email body is unchanged.
//
// Never accepts raw HTML or arbitrary props. The template key must be
// in the allow-list (renderTemplate enforces). Admin auth uses
// requireAdmin (Block 1A).

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { isApprovedTemplateKey, renderTemplate, describeTemplate } from '@/emails/render'
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
  const raw      = url.searchParams.get('raw') === '1'

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
      branch:    activationBranch ?? null,
      subject:   rendered.subject,
      preheader: rendered.preheader,
      category:  rendered.category,
      html:      rendered.html,
      text:      rendered.text,
    })
  }

  const html = raw
    ? rendered.html
    : wrapWithAdminLabelStrip({
        template,
        branch: activationBranch ?? null,
        subject:   rendered.subject,
        preheader: rendered.preheader ?? '',
        category:  rendered.category,
        renderedHtml: rendered.html,
      })

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type':    'text/html; charset=utf-8',
      'Cache-Control':   'no-store',
      'X-Frame-Options': 'DENY',
    },
  })
}

// ─────────────────────────────────────────────────────────────────────
// Admin label strip (Block 3C §13)
// ─────────────────────────────────────────────────────────────────────
// Renders a small operator-only band above the email, then the email
// itself. The strip is plain HTML with inline styles, no JS, no
// editor controls. Width is capped to a mobile-preview hint so the
// admin can sanity-check the mobile breakpoint with a glance.

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function wrapWithAdminLabelStrip(input: {
  template:     string
  branch:       string | null
  subject:      string
  preheader:    string
  category:     string
  renderedHtml: string
}): string {
  const label =
    `<div style="font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;` +
    `background:#0f3060;color:#ffffff;padding:10px 14px;border-radius:0 0 10px 10px;` +
    `max-width:760px;margin:0 auto 14px;box-shadow:0 1px 2px rgba(0,0,0,0.08);">` +
    `<div style="font-size:10px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#ffcb05;margin-bottom:4px;">` +
    `Admin preview · do not forward` +
    `</div>` +
    `<div>Template: <code style="background:rgba(255,255,255,0.12);padding:1px 6px;border-radius:4px;">${escapeHtml(input.template)}</code>` +
    (input.branch ? ` · Branch: <code style="background:rgba(255,255,255,0.12);padding:1px 6px;border-radius:4px;">${escapeHtml(input.branch)}</code>` : '') +
    ` · Category: ${escapeHtml(input.category)}</div>` +
    `<div style="margin-top:4px;font-weight:500;color:#cfe1f7;">Subject: ${escapeHtml(input.subject)}</div>` +
    `<div style="margin-top:2px;font-weight:500;color:#cfe1f7;">Preheader: ${escapeHtml(input.preheader)}</div>` +
    `<div style="margin-top:4px;font-size:10px;color:#9dbcdf;">Viewport hint: rendered at the email's intended max-width (~600px). Resize your window to QA mobile.</div>` +
    `</div>`

  // Wrap the email in a centered container with a soft brand backdrop
  // so the admin sees roughly what an inbox preview will look like.
  const pageOpen =
    `<!doctype html><html><head><meta charset="utf-8"><title>Email preview</title>` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"></head>` +
    `<body style="margin:0;padding:0;background:#eaf3ff;">` +
    label +
    `<div style="max-width:640px;margin:0 auto;">`

  const pageClose = `</div></body></html>`
  return pageOpen + input.renderedHtml + pageClose
}
