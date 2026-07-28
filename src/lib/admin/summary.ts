// src/lib/admin/summary.ts
// Block 5A-W-47C — pure helpers for the /admin dashboard.
//
// Every function here is fetch-free — the client component calls
// Supabase via its own supabase client and passes raw counts into
// the pure helpers below. That keeps the summary logic testable
// without a network stub, and prevents this module from becoming a
// second data-access layer.

// ── Supabase count-range parser ──────────────────────────────

/** Supabase returns `Content-Range: 0-9/123` when Prefer:count=exact
 *  is set. Extract the total count. Returns null when the header is
 *  missing / malformed so callers can render "Unavailable" instead
 *  of a fake zero. */
export function parseCountRange(header: string | null | undefined): number | null {
  if (typeof header !== 'string' || !header) return null
  // Formats we see: "0-9/123", "*/0", "0-0/456"
  const m = header.match(/\/(\*|\d+)$/)
  if (!m) return null
  const total = m[1]
  if (total === '*') return null
  const n = parseInt(total, 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// ── Metric value type ────────────────────────────────────────

/** A dashboard metric value is either a real number OR the sentinel
 *  UNAVAILABLE (fetch failed / query malformed). Callers render the
 *  number as-is when it's a number, and render "Unavailable" for
 *  UNAVAILABLE. A zero count is DIFFERENT from "unavailable" — we
 *  never conflate the two. */
export type MetricValue = number | 'unavailable'
export const UNAVAILABLE: 'unavailable' = 'unavailable'

/** Format a metric value for display. Numbers get toLocaleString();
 *  unavailable becomes the "Unavailable" label. */
export function formatMetric(value: MetricValue): string {
  if (value === UNAVAILABLE) return 'Unavailable'
  return value.toLocaleString('en-GB')
}

// ── "Needs attention" derivation ─────────────────────────────

export type AttentionItem = {
  key:    string
  label:  string
  count:  number
  reason: string
  /** Destination when the item represents a real admin action. Null
   *  when the item is INFORMATIONAL only — e.g. pending creator or
   *  vendor submissions when no moderation UI exists. Callers must
   *  NOT send Luke to a public directory as if it were a review tool. */
  href:   string | null
  /** True when the item is purely informational (there is no admin
   *  action available for it yet). The renderer shows this as a
   *  non-clickable row with a "No admin review tool is currently
   *  available" note. */
  informational?: boolean
}

export type AttentionInput = {
  draftArticles:     MetricValue
  pendingCreators:   MetricValue
  pendingVendors:    MetricValue
  latestPriceDate:   string | null   // ISO YYYY-MM-DD
  today:             string          // ISO YYYY-MM-DD used for age calc; injected for testability
}

/** Pure derivation of the "Needs attention" list from the raw summary
 *  numbers. Only positive real signals count — an UNAVAILABLE metric
 *  is silently omitted rather than raised as a false alarm.
 *
 *  Callers get back an ordered list. Empty list ⇒ render the calm
 *  "No urgent admin actions detected." empty state. */
export function deriveAttention(input: AttentionInput): AttentionItem[] {
  const out: AttentionItem[] = []
  if (typeof input.draftArticles === 'number' && input.draftArticles > 0) {
    out.push({
      key:   'draft-articles',
      label: 'Draft articles awaiting publish',
      count: input.draftArticles,
      reason:`${input.draftArticles} draft${input.draftArticles === 1 ? '' : 's'} saved in Insights.`,
      href:  '/admin/insights',
    })
  }
  if (typeof input.pendingCreators === 'number' && input.pendingCreators > 0) {
    // FIX1 — informational only. No creator moderation UI exists yet;
    // sending Luke to /creators (the PUBLIC directory) as if it were
    // a review tool would be misleading. Show the count so it stays
    // visible, but mark it informational until a real moderation
    // surface is built.
    out.push({
      key:   'pending-creators',
      label: 'Creator submissions awaiting a moderation tool',
      count: input.pendingCreators,
      reason:`${input.pendingCreators} creator profile${input.pendingCreators === 1 ? '' : 's'} submitted with status = pending. No admin review tool is currently available.`,
      href:  null,
      informational: true,
    })
  }
  if (typeof input.pendingVendors === 'number' && input.pendingVendors > 0) {
    // FIX1 — informational only, same reasoning as pending creators.
    out.push({
      key:   'pending-vendors',
      label: 'Vendor submissions awaiting a moderation tool',
      count: input.pendingVendors,
      reason:`${input.pendingVendors} vendor submission${input.pendingVendors === 1 ? '' : 's'} with active = false. No admin review tool is currently available.`,
      href:  null,
      informational: true,
    })
  }
  const staleDays = priceStalenessDays(input.latestPriceDate, input.today)
  if (staleDays !== null && staleDays > 2) {
    out.push({
      key:   'stale-prices',
      label: 'Price data appears stale',
      count: staleDays,
      reason:`Latest daily_prices row is ${staleDays} day${staleDays === 1 ? '' : 's'} old (as of ${input.today}).`,
      href:  '/admin',
    })
  }
  return out
}

/** Days between two YYYY-MM-DD dates. Null when either input is
 *  malformed. Negative values (latest > today) coerce to 0. */
export function priceStalenessDays(latest: string | null | undefined, today: string): number | null {
  if (typeof latest !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(latest)) return null
  if (typeof today  !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today))  return null
  const l = Date.parse(latest + 'T00:00:00Z')
  const t = Date.parse(today  + 'T00:00:00Z')
  if (!Number.isFinite(l) || !Number.isFinite(t)) return null
  const days = Math.floor((t - l) / (24 * 3600 * 1000))
  return Math.max(0, days)
}

// ── Recent activity feed ─────────────────────────────────────

export type ActivityRow = {
  key:       string
  when:      string          // ISO timestamp — used only for sort
  timeAgo:   string          // human display
  source:    'insight' | 'creator' | 'vendor'
  title:     string          // display label
  detail:    string | null
  /** Link target. Null when no genuinely useful destination exists
   *  for the row — the renderer shows the row as plain text. This
   *  avoids sending Luke to a public directory landing page as if
   *  it were an admin surface. */
  href:      string | null
}

export type ActivityInputs = {
  insights: Array<{ id?: string | number; headline?: string; slug?: string; status?: string; created_at?: string }>
  creators: Array<{ id?: string | number; name?: string; slug?: string; status?: string; created_at?: string }>
  vendors:  Array<{ id?: string | number; name?: string; slug?: string; active?: boolean; created_at?: string }>
}

/** Merge three source arrays into a single newest-first activity feed.
 *  Each source contributes up to its own array length; the merged
 *  output is capped at `cap` (default 8). Malformed rows (missing
 *  created_at) are dropped, not rendered with a fake timestamp. */
export function mergeActivity(inputs: ActivityInputs, now: Date, cap = 8): ActivityRow[] {
  const rows: ActivityRow[] = []
  for (const i of inputs.insights || []) {
    if (!i.created_at) continue
    rows.push({
      key: `insight-${i.id ?? i.slug ?? i.headline ?? i.created_at}`,
      when: i.created_at,
      timeAgo: humanTimeAgo(i.created_at, now),
      source: 'insight',
      title:  (i.headline || '(untitled article)') + (i.status ? ` · ${i.status}` : ''),
      detail: i.slug ? `/insights/${i.slug}` : null,
      href:   '/admin/insights',
    })
  }
  for (const c of inputs.creators || []) {
    if (!c.created_at) continue
    rows.push({
      key: `creator-${c.id ?? c.slug ?? c.name ?? c.created_at}`,
      when: c.created_at,
      timeAgo: humanTimeAgo(c.created_at, now),
      source: 'creator',
      title:  (c.name || '(unnamed creator)') + (c.status ? ` · ${c.status}` : ''),
      detail: c.slug ? `/creators/${c.slug}` : null,
      // FIX1 — link to the individual profile when a slug exists (a
      // genuinely useful destination). Otherwise no link — a public
      // /creators listing is not an admin action.
      href:   c.slug ? `/creators/${c.slug}` : null,
    })
  }
  for (const v of inputs.vendors || []) {
    if (!v.created_at) continue
    rows.push({
      key: `vendor-${v.id ?? v.slug ?? v.name ?? v.created_at}`,
      when: v.created_at,
      timeAgo: humanTimeAgo(v.created_at, now),
      source: 'vendor',
      title:  (v.name || '(unnamed vendor)') + (v.active === false ? ' · inactive' : ''),
      detail: v.slug ? `/vendors/${v.slug}` : null,
      // FIX1 — same reasoning as creators.
      href:   v.slug ? `/vendors/${v.slug}` : null,
    })
  }
  rows.sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0))
  return rows.slice(0, cap)
}

/** Compact relative-time helper. "5 min ago" / "3 h ago" / "2 d ago"
 *  / "1 mo ago" / "1 y ago". Uses en-GB spelling. */
export function humanTimeAgo(iso: string, now: Date): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, now.getTime() - t)
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)     return 'just now'
  if (mins < 60)    return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24)   return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 30)    return `${days} d ago`
  const months = Math.floor(days / 30)
  if (months < 12)  return `${months} mo ago`
  return `${Math.floor(months / 12)} y ago`
}
