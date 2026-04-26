// Shared email helpers — Resend-backed transactional senders.
// Required env vars:
//   RESEND_API_KEY       — from resend.com
//   EMAIL_FROM           — e.g. "PokePrices <noreply@pokeprices.io>"
//   PUBLIC_SITE_URL      — e.g. "https://www.pokeprices.io"

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export interface SendEmailArgs {
  to: string
  subject: string
  html: string
  text: string
  unsubscribeUrl?: string
}

export async function sendEmail(args: SendEmailArgs): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from   = Deno.env.get('EMAIL_FROM') || 'PokePrices <noreply@pokeprices.io>'
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not set' }

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  const body: any = {
    from,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
  }

  if (args.unsubscribeUrl) {
    body.headers = {
      'List-Unsubscribe': `<${args.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    }
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { ok: false, error: json?.message || `Resend ${res.status}` }
  }
  return { ok: true, id: json?.id }
}

// ── Templates ────────────────────────────────────────────────────────────────

const SITE = Deno.env.get('PUBLIC_SITE_URL') || 'https://www.pokeprices.io'

export interface AlertHit {
  card_name: string
  set_name: string
  card_url_slug: string | null
  card_slug: string
  grade: string
  alert_type: 'price_below' | 'price_above'
  threshold_cents: number
  current_cents: number | null
  image_url: string | null
}

export interface WatchMover {
  card_name: string
  set_name: string
  card_url_slug: string | null
  card_slug: string
  current_raw: number | null
  pct_30d: number | null
}

const fmtUsd = (cents: number | null | undefined) => {
  if (cents == null) return '—'
  const v = cents / 100
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  return `$${v.toFixed(2)}`
}

const cardUrl = (setName: string, slug: string) =>
  `${SITE}/set/${encodeURIComponent(setName)}/card/${slug}`

const GRADE_LABEL: Record<string, string> = { raw: 'Raw', psa9: 'PSA 9', psa10: 'PSA 10' }

function emailShell(title: string, bodyHtml: string, unsubscribeUrl: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1a1a;">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="padding:24px 12px;background:#f5f7fa;">
  <tr><td align="center">
    <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
      <tr><td style="padding:20px 24px;background:linear-gradient(135deg,#1a5fad,#3b82d6);">
        <a href="${SITE}" style="font-size:20px;font-weight:800;color:#ffffff;text-decoration:none;letter-spacing:-0.3px;">PokePrices</a>
      </td></tr>
      <tr><td style="padding:24px;">
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:18px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280;">
        You are receiving this email because you opted in to PokePrices alerts.
        <a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a> ·
        <a href="${SITE}/dashboard/settings" style="color:#6b7280;text-decoration:underline;">Email preferences</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

export function alertDigestEmail(opts: {
  hits: AlertHit[]
  unsubscribeUrl: string
}): { subject: string; html: string; text: string } {
  const { hits, unsubscribeUrl } = opts
  const subject = hits.length === 1
    ? `🔔 ${hits[0].card_name} hit your target`
    : `🔔 ${hits.length} of your alerts triggered`

  const rowsHtml = hits.map(h => `
    <tr><td style="padding:14px 0;border-bottom:1px solid #e5e7eb;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding-right:14px;width:54px;vertical-align:top;">
            ${h.image_url ? `<img src="${h.image_url}" alt="" width="54" style="display:block;border-radius:4px;">` : ''}
          </td>
          <td style="vertical-align:top;">
            <a href="${cardUrl(h.set_name, h.card_url_slug || h.card_slug)}" style="font-size:15px;font-weight:700;color:#1a1a1a;text-decoration:none;">${h.card_name}</a>
            <div style="font-size:12px;color:#6b7280;margin-top:2px;">${h.set_name}</div>
            <div style="font-size:13px;margin-top:8px;">
              <strong>${GRADE_LABEL[h.grade] || h.grade}</strong>
              ${h.alert_type === 'price_below' ? 'dropped to' : 'rose to'}
              <strong style="color:${h.alert_type === 'price_below' ? '#dc2626' : '#16a34a'};">${fmtUsd(h.current_cents)}</strong>
              <span style="color:#6b7280;">(target ${fmtUsd(h.threshold_cents)})</span>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  `).join('')

  const body = `
    <h1 style="font-size:22px;margin:0 0 6px;color:#1a1a1a;">${subject}</h1>
    <p style="font-size:14px;color:#6b7280;margin:0 0 20px;line-height:1.6;">
      Cards from your alert list have crossed the price you set.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}</table>
    <div style="margin-top:24px;">
      <a href="${SITE}/dashboard/alerts" style="display:inline-block;padding:11px 22px;background:#1a5fad;color:#ffffff;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">View alerts</a>
    </div>
  `

  const text = hits.map(h =>
    `${h.card_name} (${h.set_name}) — ${GRADE_LABEL[h.grade] || h.grade} ${h.alert_type === 'price_below' ? 'dropped to' : 'rose to'} ${fmtUsd(h.current_cents)} (target ${fmtUsd(h.threshold_cents)})\n${cardUrl(h.set_name, h.card_url_slug || h.card_slug)}`
  ).join('\n\n')
    + `\n\nView alerts: ${SITE}/dashboard/alerts\nUnsubscribe: ${unsubscribeUrl}`

  return { subject, html: emailShell(subject, body, unsubscribeUrl), text }
}

export function weeklyDigestEmail(opts: {
  topRiser: WatchMover | null
  topFaller: WatchMover | null
  nearTarget: AlertHit[]
  totalWatching: number
  unsubscribeUrl: string
}): { subject: string; html: string; text: string } {
  const { topRiser, topFaller, nearTarget, totalWatching, unsubscribeUrl } = opts
  const subject = 'Your watchlist this week'

  const moverRow = (label: string, m: WatchMover | null, color: string) => m ? `
    <tr><td style="padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;">
      <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:1px;text-transform:uppercase;">${label}</div>
      <a href="${cardUrl(m.set_name, m.card_url_slug || m.card_slug)}" style="font-size:15px;font-weight:700;color:#1a1a1a;text-decoration:none;display:block;margin-top:4px;">${m.card_name}</a>
      <div style="font-size:12px;color:#6b7280;margin-top:2px;">${m.set_name}</div>
      <div style="font-size:18px;font-weight:800;color:${color};margin-top:6px;">${m.pct_30d != null ? (m.pct_30d > 0 ? '+' : '') + m.pct_30d.toFixed(1) + '%' : '—'}</div>
      <div style="font-size:11px;color:#6b7280;">30-day · raw ${fmtUsd(m.current_raw)}</div>
    </td></tr>
  ` : ''

  const nearTargetHtml = nearTarget.length ? `
    <h2 style="font-size:15px;margin:24px 0 8px;color:#1a1a1a;">Near a target price</h2>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      ${nearTarget.map(n => `
        <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-size:13px;">
          <a href="${cardUrl(n.set_name, n.card_url_slug || n.card_slug)}" style="color:#1a1a1a;text-decoration:none;font-weight:700;">${n.card_name}</a>
          <span style="color:#6b7280;"> · ${GRADE_LABEL[n.grade]} ${fmtUsd(n.current_cents)} (target ${fmtUsd(n.threshold_cents)})</span>
        </td></tr>
      `).join('')}
    </table>
  ` : ''

  const body = `
    <h1 style="font-size:22px;margin:0 0 6px;color:#1a1a1a;">Your watchlist this week</h1>
    <p style="font-size:14px;color:#6b7280;margin:0 0 22px;">Tracking ${totalWatching} ${totalWatching === 1 ? 'card' : 'cards'}.</p>

    <table width="100%" cellpadding="6" cellspacing="0" border="0">
      <tr>
        <td width="50%" valign="top">${moverRow('Biggest riser', topRiser, '#16a34a')}</td>
        <td width="50%" valign="top">${moverRow('Biggest drop', topFaller, '#dc2626')}</td>
      </tr>
    </table>

    ${nearTargetHtml}

    <div style="margin-top:24px;">
      <a href="${SITE}/dashboard/watchlist" style="display:inline-block;padding:11px 22px;background:#1a5fad;color:#ffffff;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">Open watchlist</a>
    </div>
  `

  const text = `Your watchlist this week — ${totalWatching} cards.\n\n${
    topRiser ? `Biggest riser: ${topRiser.card_name} (${topRiser.pct_30d?.toFixed(1)}%)\n` : ''
  }${
    topFaller ? `Biggest drop: ${topFaller.card_name} (${topFaller.pct_30d?.toFixed(1)}%)\n` : ''
  }${nearTarget.length ? '\nNear target:\n' + nearTarget.map(n => `- ${n.card_name} ${GRADE_LABEL[n.grade]} ${fmtUsd(n.current_cents)} (target ${fmtUsd(n.threshold_cents)})`).join('\n') : ''}\n\n${SITE}/dashboard/watchlist\nUnsubscribe: ${unsubscribeUrl}`

  return { subject, html: emailShell(subject, body, unsubscribeUrl), text }
}
