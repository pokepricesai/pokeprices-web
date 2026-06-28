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
  /** Bare-numeric `cards.card_slug`. Used by groupEventsByCard to
   *  collapse multiple events on the same card. When absent, the
   *  grouper falls back to a `cardName|setName` composite key. */
  cardSlug?: string
  /** Optional resolved card-page URL; when missing the item still
   *  renders, just without a link. */
  cardUrl?: string
  rule:     AlertRule
  severity: DigestSeverity
  /** Free-form payload — same shape the evaluator inserts. The
   *  builder only reads known keys; unknown ones are ignored. */
  payload:  Record<string, unknown>
  /** Internal plumbing — the `alert_events.id` value. Plumbed through
   *  groupEventsByCard so the delivery orchestrator can mark only the
   *  events that actually fit in the digest (after the card cap). The
   *  renderer never reads this. */
  id?:      string
  /** Block 5A-W-20 — ISO timestamp of `alert_events.detected_at`.
   *  Used by `dedupeEventsPerCardRule` as the tie-breaker when two
   *  events for the same (card, rule) have equal magnitudes. The
   *  renderer doesn't display this; it's plumbed through the same
   *  call shape as `id`. */
  detectedAt?: string
}

/** A card-grouped block — one entry per (user, card) with all of that
 *  card's reasons collected under a single heading in the email. */
export type DigestCardBlock = {
  /** Group key — `cardSlug` when present, else `cardName|setName`. */
  key:       string
  cardSlug?: string
  cardName:  string
  setName:   string
  cardUrl?:  string
  /** Max severity across this card's events. */
  severity:  DigestSeverity
  /** Events on this card, ordered by intra-card priority (price
   *  changes first, spread next, activity last). */
  events:    DigestEvent[]
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
  /** When true, the subject is prefixed `[TEST]` so a test-send from
   *  the admin button cannot be confused with a production digest
   *  even at a glance in the inbox. Stacks with `sample` — the
   *  resulting prefix is `[TEST] [SAMPLE] …` when both are set. */
  test?: boolean
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

/** Block 5A-W-20 — singular/plural for inline counts inside reason
 *  copy. Earlier blocks shipped "1 new verified sales" because every
 *  count rendered through a fixed plural string. */
function countNoun(n: unknown, singular: string, plural: string): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return `— ${plural}`
  return `${n} ${n === 1 ? singular : plural}`
}

/** Block 5A-W-20 — appendix that explains WHICH threshold the event
 *  crossed. Only renders when the evaluator stamped the payload (i.e.
 *  the event was generated against the per-card override, or any
 *  post-5A-W-19 evaluator run for a global threshold). Older events
 *  without the metadata render as before — no "(above your N%
 *  threshold)" tail. */
function thresholdSuffix(payload: Record<string, unknown>): string {
  const src   = payload.threshold_source
  const thr   = payload.threshold_pct
  if (src !== 'global' && src !== 'override') return ''
  if (typeof thr !== 'number' || !Number.isFinite(thr)) return ''
  // "above your 20% alert threshold" works for either direction —
  // |pct| has already passed the gate, and we don't bother labelling
  // rise vs drop here because the price line already shows the sign.
  return ` — above your ${thr}% alert threshold`
}

function reasonText(ev: DigestEvent): string {
  const p = ev.payload
  switch (ev.rule) {
    case 'raw_change':
    case 'psa10_change':
    case 'price_move': {
      const field = ev.rule === 'price_move' ? (p.price_field === 'psa10_usd' ? 'PSA 10' : 'Raw') : ev.rule === 'psa10_change' ? 'PSA 10' : 'Raw'
      return `${field} ${fmtCents(p.old)} → ${fmtCents(p.new)} (${fmtPct(p.pct)})${thresholdSuffix(p)}`
    }
    case 'spread_change': {
      const old = typeof p.old_spread === 'number' ? p.old_spread.toFixed(1) + '×' : '—'
      const neu = typeof p.new_spread === 'number' ? p.new_spread.toFixed(1) + '×' : '—'
      return `Spread ${old} → ${neu} (${fmtPct(p.pct)})${thresholdSuffix(p)}`
    }
    case 'recent_sales': {
      const sales = countNoun(p.recent_active_count, 'new verified sale', 'new verified sales')
      const days  = countNoun(p.window_days, 'day', 'days')
      return `${sales} in the last ${days}`
    }
    case 'market_activity': {
      const sales = countNoun(p.active_count, 'verified sale', 'verified sales')
      const days  = countNoun(p.window_days, 'day', 'days')
      return `${sales} in the last ${days}`
    }
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
const SEVERITY_WEIGHT: Record<DigestSeverity, number> = { high: 3, normal: 2, low: 1 }

// Per-rule weight used inside a card (most important reason first)
// AND as part of the card priority score for sorting cards in the
// digest. Brief 5A-W-11 ordering: price changes > spread > activity.
const RULE_WEIGHT: Record<AlertRule, number> = {
  raw_change:      300,
  psa10_change:    290,
  price_move:      280,
  spread_change:   200,
  recent_sales:    100,
  market_activity:  90,
}

/** Group raw events into per-card blocks. Multiple events on the same
 *  (user, card) collapse into one block. Events within a block are
 *  ordered by intra-card priority so the most important reason renders
 *  first under the card heading. Exported for tests. */
export function groupEventsByCard(events: DigestEvent[]): DigestCardBlock[] {
  const byKey = new Map<string, DigestCardBlock>()
  for (const e of events) {
    const key = e.cardSlug ? `slug:${e.cardSlug}` : `name:${e.cardName}|${e.setName}`
    let block = byKey.get(key)
    if (!block) {
      block = {
        key,
        cardSlug: e.cardSlug,
        cardName: e.cardName,
        setName:  e.setName,
        cardUrl:  e.cardUrl,
        severity: e.severity,
        events:   [],
      }
      byKey.set(key, block)
    } else {
      // Preserve the first non-empty URL we see (more likely populated).
      if (!block.cardUrl && e.cardUrl) block.cardUrl = e.cardUrl
      // Lift severity to the max of any event on the card.
      if (SEVERITY_WEIGHT[e.severity] > SEVERITY_WEIGHT[block.severity]) {
        block.severity = e.severity
      }
    }
    block.events.push(e)
  }
  // Stable ordering inside each card: rule priority DESC; ties broken
  // by event severity DESC.
  for (const block of Array.from(byKey.values())) {
    block.events.sort((a, b) => {
      const dr = (RULE_WEIGHT[b.rule] ?? 0) - (RULE_WEIGHT[a.rule] ?? 0)
      if (dr !== 0) return dr
      return SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]
    })
  }
  return Array.from(byKey.values())
}

function payloadMagnitude(payload: Record<string, unknown>): number {
  const pct = Number(payload.pct ?? 0)
  const cnt = Number(payload.recent_active_count ?? payload.active_count ?? 0)
  return Math.max(Number.isFinite(pct) ? Math.abs(pct) : 0, Number.isFinite(cnt) ? cnt : 0)
}

// ─────────────────────────────────────────────────────────────────────
// Block 5A-W-20 — per-(card, rule) dedupe
// ─────────────────────────────────────────────────────────────────────

/** Same key the renderer groups by. Mirrors the logic in
 *  `groupEventsByCard` so dedupe and grouping always agree on what
 *  "the same card" means. */
function cardKey(ev: DigestEvent): string {
  return ev.cardSlug ? `slug:${ev.cardSlug}` : `name:${ev.cardName}|${ev.setName}`
}

/** Rule-aware score for dedupe winner selection.
 *    * recent_sales / market_activity → count (higher wins)
 *    * price rules                    → |pct|  (bigger move wins)
 *  Returned as a non-negative number; ties are broken by detectedAt
 *  (latest wins). */
function eventDedupeScore(ev: DigestEvent): number {
  const p = ev.payload
  switch (ev.rule) {
    case 'recent_sales': {
      const n = Number(p.recent_active_count ?? 0)
      return Number.isFinite(n) ? n : 0
    }
    case 'market_activity': {
      const n = Number(p.active_count ?? 0)
      return Number.isFinite(n) ? n : 0
    }
    case 'raw_change':
    case 'psa10_change':
    case 'price_move':
    case 'spread_change': {
      const pct = Number(p.pct ?? 0)
      return Number.isFinite(pct) ? Math.abs(pct) : 0
    }
  }
}

function detectedAtMs(ev: DigestEvent): number {
  if (!ev.detectedAt) return 0
  const t = Date.parse(ev.detectedAt)
  return Number.isFinite(t) ? t : 0
}

/** Block 5A-W-20 — collapse duplicate-by-(card, rule) events to one
 *  winner per pair. Returns the winners (kept) plus a map of
 *  winnerId → [supersededIds] so the delivery orchestrator can mark
 *  the rolled-up losers delivered alongside their winner.
 *
 *  Winner selection (brief 5A-W-20 §2):
 *    1. eventDedupeScore (higher wins).
 *       — sales/activity = count; price rules = |pct|.
 *    2. Tie-break: latest detectedAt wins.
 *    3. Final tie-break: array order wins (stable).
 *
 *  Pure — exported for unit tests. Events without an `id` cannot
 *  be cited as a superseded entry (delivery only marks ID-bearing
 *  rows) so they are silently dropped from the map; the winner
 *  ranking is unaffected. */
export function dedupeEventsPerCardRule(
  events: DigestEvent[],
): { keptEvents: DigestEvent[]; supersededByWinnerId: Map<string, string[]> } {
  // Track best-so-far per (cardKey, rule) plus every loser that's
  // ever lost to that winner. Re-keying on the winner's id at the
  // end keeps the public shape easy to plumb into delivery.
  type Bucket = {
    winner:        DigestEvent
    superseded:    string[]    // ids of losers — winner may not have an id yet
  }
  const buckets = new Map<string, Bucket>()
  for (const ev of events) {
    const k = `${cardKey(ev)}|${ev.rule}`
    const existing = buckets.get(k)
    if (!existing) {
      buckets.set(k, { winner: ev, superseded: [] })
      continue
    }
    // Compare new vs incumbent. Whichever loses gets its id (if any)
    // pushed onto the bucket's superseded list — same card/rule, and
    // the user has effectively been notified by the winner.
    const newScore = eventDedupeScore(ev)
    const oldScore = eventDedupeScore(existing.winner)
    let newerWins: boolean
    if (newScore !== oldScore) {
      newerWins = newScore > oldScore
    } else {
      newerWins = detectedAtMs(ev) > detectedAtMs(existing.winner)
    }
    if (newerWins) {
      if (existing.winner.id) existing.superseded.push(existing.winner.id)
      buckets.set(k, { winner: ev, superseded: existing.superseded })
    } else {
      if (ev.id) existing.superseded.push(ev.id)
    }
  }
  const keptEvents:           DigestEvent[]              = []
  const supersededByWinnerId: Map<string, string[]>      = new Map()
  for (const b of Array.from(buckets.values())) {
    keptEvents.push(b.winner)
    if (b.winner.id && b.superseded.length > 0) {
      supersededByWinnerId.set(b.winner.id, b.superseded)
    }
  }
  return { keptEvents, supersededByWinnerId }
}

/** Composite priority used to order CARDS in the digest. Higher = first.
 *  Composed so the brief's tie-break order falls out: severity first,
 *  then the rule category, then the largest payload magnitude. */
export function cardPriorityScore(block: DigestCardBlock): number {
  const sev = SEVERITY_WEIGHT[block.severity] * 1_000_000
  let bestRule = 0
  let bestMag  = 0
  for (const e of block.events) {
    const w = RULE_WEIGHT[e.rule] ?? 0
    if (w > bestRule) bestRule = w
    const mag = payloadMagnitude(e.payload)
    if (mag > bestMag) bestMag = mag
  }
  // bestRule is at most 300; scale to dominate magnitude.
  return sev + bestRule * 1000 + Math.round(bestMag)
}

/** Sort blocks by cardPriorityScore DESC. Pure; safe to call on the
 *  result of groupEventsByCard. */
export function sortCardBlocksByPriority(blocks: DigestCardBlock[]): DigestCardBlock[] {
  return [...blocks].sort((a, b) => cardPriorityScore(b) - cardPriorityScore(a))
}

function groupBlocksBySeverity(blocks: DigestCardBlock[]): Array<{ severity: DigestSeverity; blocks: DigestCardBlock[] }> {
  const groups = new Map<DigestSeverity, DigestCardBlock[]>()
  for (const b of blocks) {
    let bucket = groups.get(b.severity)
    if (!bucket) { bucket = []; groups.set(b.severity, bucket) }
    bucket.push(b)
  }
  return SEVERITY_ORDER
    .filter(s => groups.has(s))
    .map(severity => ({ severity, blocks: groups.get(severity)! }))
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

function buildSubject(events: DigestEvent[], sample: boolean, test: boolean): string {
  const tags: string[] = []
  if (test)   tags.push('[TEST]')
  if (sample) tags.push('[SAMPLE]')
  const prefix = tags.length > 0 ? tags.join(' ') + ' ' : ''
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
// Block 5A-W-18 — alert management moved to the unified Watchlist &
// Alerts page. /dashboard/settings still hosts the same controls but
// the canonical destination from email is now the combined surface
// (which also shows recent alerts so the user can see what triggered
// the email).
const MANAGE_URL = 'https://www.pokeprices.io/dashboard/watchlist-alerts'

function renderHtml(events: DigestEvent[], sample: boolean): string {
  const blocks = sortCardBlocksByPriority(groupEventsByCard(events))
  const groups = groupBlocksBySeverity(blocks)

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

  const renderReason = (ev: DigestEvent): string => `
    <li style="font-family:'Figtree',sans-serif;font-size:13px;color:${BRAND.text};margin:0 0 6px;line-height:1.5;">
      <span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${BRAND.primarySoft};color:${BRAND.primary};font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.7px;margin-right:8px;vertical-align:middle;">${esc(RULE_TITLE[ev.rule])}</span>
      ${esc(reasonText(ev))}
    </li>`

  const sections = groups.map(g => `
    <h2 style="font-family:'Outfit',sans-serif;font-size:14px;font-weight:800;color:${BRAND.navy};margin:24px 0 10px;text-transform:uppercase;letter-spacing:0.8px;">${esc(SEVERITY_LABEL[g.severity])}</h2>
    <table role="presentation" style="width:100%;border-collapse:collapse;">
      <tbody>
        ${g.blocks.map(block => `
        <tr>
          <td style="padding:14px 16px;background:${BRAND.cardBg};border:1px solid ${BRAND.border};border-radius:10px;">
            <div style="font-family:'Outfit',sans-serif;font-size:15px;font-weight:700;color:${BRAND.text};line-height:1.3;">${esc(block.cardName)}</div>
            <div style="font-family:'Figtree',sans-serif;font-size:12px;color:${BRAND.muted};margin-top:3px;">${esc(block.setName)}</div>
            <ul style="margin:10px 0 0;padding:0 0 0 16px;">
              ${block.events.map(renderReason).join('')}
            </ul>
            ${block.cardUrl ? `
            <div style="margin-top:12px;">
              <a href="${esc(block.cardUrl)}" style="display:inline-block;padding:8px 14px;border-radius:8px;background:${BRAND.primary};color:#ffffff;font-family:'Figtree',sans-serif;font-size:12px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">View card →</a>
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
            You are receiving this because alerts are enabled for your Watchlist &amp; Alerts.<br>
            <a href="${MANAGE_URL}" style="color:${BRAND.primary};text-decoration:none;font-weight:700;">Manage Watchlist &amp; Alerts</a>
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
    const blocks = sortCardBlocksByPriority(groupEventsByCard(events))
    for (const g of groupBlocksBySeverity(blocks)) {
      lines.push(SEVERITY_LABEL[g.severity].toUpperCase())
      lines.push('-'.repeat(SEVERITY_LABEL[g.severity].length))
      for (const block of g.blocks) {
        lines.push(`* ${block.cardName} (${block.setName})`)
        for (const ev of block.events) {
          lines.push(`    - ${RULE_TITLE[ev.rule]}: ${reasonText(ev)}`)
        }
        if (block.cardUrl) lines.push(`    ${block.cardUrl}`)
      }
      lines.push('')
    }
  }
  lines.push('---')
  lines.push('PokePrices')
  lines.push('You are receiving this because alerts are enabled for your Watchlist & Alerts.')
  lines.push(`Manage Watchlist & Alerts at ${MANAGE_URL}`)
  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────

export function buildEmailDigest(events: DigestEvent[], opts: BuildDigestOptions = {}): DigestOutput {
  const sample = opts.sample === true
  const test   = opts.test   === true
  return {
    subject:     buildSubject(events, sample, test),
    previewText: buildPreviewText(events, sample),
    html:        renderHtml(events, sample),
    text:        renderText(events, sample),
  }
}
