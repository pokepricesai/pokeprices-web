// src/lib/alerts/emailDigest.ts
// Block 5A-W-4 — pure email-digest builder for the alert evaluator.
// Renders subject / preview text / HTML / plain text from a set of
// alert events. Used only by the admin preview route today; a future
// digest-send block will reuse the same builder.
//
// NOTHING in this file talks to a database, to Resend, or to the
// browser. The builder is a deterministic pure function so a small
// snapshot of unit tests can pin both the structure and the absence
// of PII in the output.

import type { AlertRule } from './preferences'

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export type DigestSeverity = 'low' | 'normal' | 'high'

export type DigestEvent = {
  /** Display name for the card (e.g. "Lt. Surge's Raichu"). */
  cardName: string
  /** Display set name (e.g. "Gym Challenge"). */
  setName:  string
  /** Optional resolved card-page URL; when missing the item still
   *  renders, just without a link. */
  cardUrl?: string
  rule:     AlertRule
  severity: DigestSeverity
  /** Free-form payload — same shape the evaluator inserts. The
   *  builder only reads known keys; unknown ones are ignored. */
  payload:  Record<string, unknown>
}

export type DigestOutput = {
  subject:     string
  previewText: string
  html:        string
  text:        string
}

export type BuildDigestOptions = {
  /** When true, the subject is prefixed `[SAMPLE]` and the HTML/text
   *  bodies carry a banner so an admin previewing the email cannot
   *  mistake fake data for real activity. */
  sample?: boolean
}

// ─────────────────────────────────────────────────────────────────────
// Rule-aware copy
// ─────────────────────────────────────────────────────────────────────

const RULE_TITLE: Record<AlertRule, string> = {
  price_move:      'Price moved',
  raw_change:      'Raw price changed',
  psa10_change:    'PSA 10 price changed',
  spread_change:   'Raw → PSA 10 spread shifted',
  recent_sales:    'Fresh sales landed',
  market_activity: 'Unusual market activity',
}

function fmtCents(cents: unknown): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return '—'
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(pct: unknown): string {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return '—'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

function reasonText(ev: DigestEvent): string {
  const p = ev.payload
  switch (ev.rule) {
    case 'raw_change':
    case 'psa10_change':
    case 'price_move': {
      const field = ev.rule === 'price_move' ? (p.price_field === 'psa10_usd' ? 'PSA 10' : 'Raw') : ev.rule === 'psa10_change' ? 'PSA 10' : 'Raw'
      return `${field} ${fmtCents(p.old)} → ${fmtCents(p.new)} (${fmtPct(p.pct)})`
    }
    case 'spread_change':
      return `Spread ${typeof p.old_spread === 'number' ? p.old_spread.toFixed(1) + '×' : '—'} → ${typeof p.new_spread === 'number' ? p.new_spread.toFixed(1) + '×' : '—'} (${fmtPct(p.pct)})`
    case 'recent_sales':
      return `${p.recent_active_count ?? '—'} new verified sales in the last ${p.window_days ?? '—'} days`
    case 'market_activity':
      return `${p.active_count ?? '—'} verified sales in the last ${p.window_days ?? '—'} days`
  }
}

// Mild HTML escape — defensive for any field flowing into HTML.
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─────────────────────────────────────────────────────────────────────
// Grouping
// ─────────────────────────────────────────────────────────────────────

const SEVERITY_ORDER: DigestSeverity[] = ['high', 'normal', 'low']
const SEVERITY_LABEL: Record<DigestSeverity, string> = {
  high:   'Big moves',
  normal: 'Notable changes',
  low:    'For your awareness',
}

function groupBySeverity(events: DigestEvent[]): Array<{ severity: DigestSeverity; events: DigestEvent[] }> {
  const groups = new Map<DigestSeverity, DigestEvent[]>()
  for (const e of events) {
    let bucket = groups.get(e.severity)
    if (!bucket) { bucket = []; groups.set(e.severity, bucket) }
    bucket.push(e)
  }
  return SEVERITY_ORDER
    .filter(s => groups.has(s))
    .map(severity => ({ severity, events: groups.get(severity)! }))
}

// ─────────────────────────────────────────────────────────────────────
// Sample data generator
// ─────────────────────────────────────────────────────────────────────

/** Hand-crafted events covering every rule + both severities. Used by
 *  the admin preview when no real undelivered events exist. URLs point
 *  to known card pages so the admin can click through. */
export function buildSampleEvents(): DigestEvent[] {
  return [
    {
      cardName: "Lt. Surge's Raichu [1st Edition]", setName: 'Gym Challenge',
      cardUrl:  'https://www.pokeprices.io/set/Gym%20Challenge/card/lt-surges-raichu-1st-edition-11',
      rule:     'raw_change', severity: 'high',
      payload:  { old: 12500, new: 16875, pct: 35.0, source: 'watchlist' },
    },
    {
      cardName: "Haunter [Incomplete Holo Error]", setName: 'Fossil',
      cardUrl:  'https://www.pokeprices.io/set/Fossil/card/haunter-incomplete-holo-error-6',
      rule:     'psa10_change', severity: 'normal',
      payload:  { old: 35250, new: 39500, pct: 12.1, source: 'watchlist' },
    },
    {
      cardName: "Larry's Starly [Energy]", setName: 'Ascended Heroes',
      cardUrl:  'https://www.pokeprices.io/set/Ascended%20Heroes/card/larrys-starly-energy-168',
      rule:     'recent_sales', severity: 'normal',
      payload:  { recent_active_count: 4, window_days: 7, source: 'watchlist' },
    },
    {
      cardName: 'Raikou — Phantasmal Flames — Mega Evolutions Blister', setName: 'Promo',
      cardUrl:  'https://www.pokeprices.io/set/Promo/card/raikou---phantasmal-flames---mega-evolutions-blister',
      rule:     'spread_change', severity: 'normal',
      payload:  { old_spread: 5.2, new_spread: 7.8, pct: 50.0, raw: 1500, psa10: 11700, source: 'watchlist' },
    },
    {
      cardName: 'Energy Coins [Poke Ball]', setName: 'Black Bolt',
      cardUrl:  'https://www.pokeprices.io/set/Black%20Bolt/card/energy-coins-poke-ball-81',
      rule:     'market_activity', severity: 'normal',
      payload:  { active_count: 8, window_days: 14, source: 'portfolio' },
    },
  ]
}

// ─────────────────────────────────────────────────────────────────────
// Subject + preview text
// ─────────────────────────────────────────────────────────────────────

function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural
}

function buildSubject(events: DigestEvent[], sample: boolean): string {
  const prefix = sample ? '[SAMPLE] ' : ''
  if (events.length === 0) return `${prefix}Your PokePrices alert digest`
  const distinctCards = new Set(events.map(e => `${e.cardName}|${e.setName}`)).size
  return `${prefix}Your PokePrices alert digest — ${distinctCards} ${pluralize(distinctCards, 'card moved', 'cards moved')}`
}

function buildPreviewText(events: DigestEvent[], sample: boolean): string {
  if (events.length === 0) return sample ? 'Sample preview — no real events.' : 'No new alerts since your last digest.'
  // First high-severity, else first event.
  const head = events.find(e => e.severity === 'high') ?? events[0]
  const tail = events.length > 1 ? ` and ${events.length - 1} more` : ''
  return `${head.cardName} — ${reasonText(head)}${tail}.`
}

// ─────────────────────────────────────────────────────────────────────
// Body renderers
// ─────────────────────────────────────────────────────────────────────

// Brand palette. Hex literals (not CSS variables) because most email
// clients strip / ignore CSS custom properties. Kept tight: one navy
// for the wordmark, one primary blue for accents + links, a single
// soft border colour, two muted greys.
const BRAND = {
  navy:        '#0d2747',
  primary:     '#1a5fad',
  primarySoft: '#eaf1f9',
  text:        '#1a1a1a',
  muted:       '#5f6b7a',
  mutedSoft:   '#8a93a0',
  border:      '#e6e9ee',
  cardBg:      '#fbfbfd',
} as const

const TAGLINE = 'Track your Pokémon card market moves'
const MANAGE_URL = 'https://www.pokeprices.io/dashboard/settings'

function renderHtml(events: DigestEvent[], sample: boolean): string {
  const groups = groupBySeverity(events)

  // ── Header — wordmark + tagline, thin primary underline ──
  const header = `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;">
      <tr>
        <td style="padding:0 0 12px;border-bottom:2px solid ${BRAND.primary};">
          <div style="font-family:'Outfit',sans-serif;font-size:22px;font-weight:800;color:${BRAND.navy};letter-spacing:-0.2px;">PokePrices</div>
          <div style="font-family:'Figtree',sans-serif;font-size:12px;color:${BRAND.muted};margin-top:2px;">${esc(TAGLINE)}</div>
        </td>
      </tr>
    </table>`

  const intro = `
    <p style="font-family:'Figtree',sans-serif;font-size:13px;color:${BRAND.muted};margin:0 0 16px;line-height:1.5;">
      A short summary of meaningful changes on cards you watch.
    </p>`

  const sampleBanner = sample ? `
    <div style="background:#fff7e0;border:1px solid #f3d36b;color:#704a00;padding:10px 12px;border-radius:8px;margin:0 0 20px;font-size:13px;font-family:'Figtree',sans-serif;">
      <strong>Sample data</strong> — this email was generated from hand-crafted events for design review. It would NOT be sent to a recipient.
    </div>` : ''

  const sections = groups.map(g => `
    <h2 style="font-family:'Outfit',sans-serif;font-size:14px;font-weight:800;color:${BRAND.navy};margin:24px 0 10px;text-transform:uppercase;letter-spacing:0.8px;">${esc(SEVERITY_LABEL[g.severity])}</h2>
    <table role="presentation" style="width:100%;border-collapse:collapse;">
      <tbody>
        ${g.events.map(ev => `
        <tr>
          <td style="padding:14px 16px;background:${BRAND.cardBg};border:1px solid ${BRAND.border};border-radius:10px;">
            <div style="font-family:'Outfit',sans-serif;font-size:15px;font-weight:700;color:${BRAND.text};line-height:1.3;">${esc(ev.cardName)}</div>
            <div style="font-family:'Figtree',sans-serif;font-size:12px;color:${BRAND.muted};margin-top:3px;">${esc(ev.setName)}</div>
            <div style="font-family:'Figtree',sans-serif;font-size:13px;color:${BRAND.text};margin-top:10px;line-height:1.5;">
              <span style="display:inline-block;padding:3px 8px;border-radius:999px;background:${BRAND.primarySoft};color:${BRAND.primary};font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.7px;margin-right:8px;vertical-align:middle;">${esc(RULE_TITLE[ev.rule])}</span>
              ${esc(reasonText(ev))}
            </div>
            ${ev.cardUrl ? `
            <div style="margin-top:12px;">
              <a href="${esc(ev.cardUrl)}" style="display:inline-block;padding:8px 14px;border-radius:8px;background:${BRAND.primary};color:#ffffff;font-family:'Figtree',sans-serif;font-size:12px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">View card →</a>
            </div>` : ''}
          </td>
        </tr>
        <tr><td style="height:10px;line-height:10px;">&nbsp;</td></tr>
        `).join('')}
      </tbody>
    </table>
  `).join('')

  // ── Footer — wordmark + reason + manage link. No unsubscribe link
  // because the per-user opt-out flow is the in-app settings page.
  const footer = `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:32px 0 0;border-top:1px solid ${BRAND.border};">
      <tr>
        <td style="padding:18px 0 0;">
          <div style="font-family:'Outfit',sans-serif;font-size:14px;font-weight:800;color:${BRAND.navy};letter-spacing:-0.1px;">PokePrices</div>
          <p style="font-family:'Figtree',sans-serif;font-size:11px;color:${BRAND.mutedSoft};line-height:1.6;margin:6px 0 0;">
            You are receiving this because you enabled card alerts.<br>
            <a href="${MANAGE_URL}" style="color:${BRAND.primary};text-decoration:none;font-weight:700;">Manage alerts</a>
            · We never share your address. We never sell your data.
          </p>
        </td>
      </tr>
    </table>`

  const body = events.length === 0
    ? `<p style="font-family:'Figtree',sans-serif;font-size:13px;color:${BRAND.muted};">No new alerts since your last digest.</p>`
    : sections

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your PokePrices alert digest</title>
</head>
<body style="margin:0;padding:24px;background:#ffffff;font-family:'Figtree',sans-serif;color:${BRAND.text};">
  <div style="max-width:560px;margin:0 auto;">
    ${header}
    ${intro}
    ${sampleBanner}
    ${body}
    ${footer}
  </div>
</body>
</html>`
}

function renderText(events: DigestEvent[], sample: boolean): string {
  const lines: string[] = []
  lines.push('PokePrices')
  lines.push(TAGLINE)
  lines.push('='.repeat(Math.max(TAGLINE.length, 'PokePrices'.length)))
  lines.push('')
  lines.push('A short summary of meaningful changes on cards you watch.')
  lines.push('')
  if (sample) {
    lines.push('[SAMPLE DATA — preview only; would NOT be sent.]')
    lines.push('')
  }
  if (events.length === 0) {
    lines.push('No new alerts since your last digest.')
  } else {
    for (const g of groupBySeverity(events)) {
      lines.push(SEVERITY_LABEL[g.severity].toUpperCase())
      lines.push('-'.repeat(SEVERITY_LABEL[g.severity].length))
      for (const ev of g.events) {
        lines.push(`* ${ev.cardName} (${ev.setName})`)
        lines.push(`    ${RULE_TITLE[ev.rule]}: ${reasonText(ev)}`)
        if (ev.cardUrl) lines.push(`    ${ev.cardUrl}`)
      }
      lines.push('')
    }
  }
  lines.push('---')
  lines.push('PokePrices')
  lines.push('You are receiving this because you enabled card alerts.')
  lines.push(`Manage alerts at ${MANAGE_URL}`)
  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────

export function buildEmailDigest(events: DigestEvent[], opts: BuildDigestOptions = {}): DigestOutput {
  const sample = opts.sample === true
  return {
    subject:     buildSubject(events, sample),
    previewText: buildPreviewText(events, sample),
    html:        renderHtml(events, sample),
    text:        renderText(events, sample),
  }
}
