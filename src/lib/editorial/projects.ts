// src/lib/editorial/projects.ts
//
// EIC Block 2 — shared types + input validation + pure helpers for
// the editorial_projects table. Isolated from route handlers so the
// same rules apply on POST and PATCH — AND imported by the client
// dashboard so labels/enums/week bucketing don't drift. Pure code
// only; no secrets, no server-only imports.

// ── App-level enums ──────────────────────────────────────────────
//
// Kept out of Postgres deliberately so future EIC blocks can extend
// the vocabulary (e.g. add a 'scheduled' status when we build the
// scheduler) without a schema migration.

export const EDITORIAL_STATUSES = [
  'idea',
  'planned',
  'researching',
  'drafting',
  'review',
  'ready',
  'published',
  'archived',
] as const
export type EditorialStatus = typeof EDITORIAL_STATUSES[number]

export const EDITORIAL_ARTICLE_TYPES = [
  'monthly_market_report',
  'new_set',
  'upcoming_set',
  'data_study',
  'evergreen',
  'market_analysis',
] as const
export type EditorialArticleType = typeof EDITORIAL_ARTICLE_TYPES[number]

/** Human-readable labels for use in the admin UI. */
export const STATUS_LABELS: Record<EditorialStatus, string> = {
  idea:        'Idea',
  planned:     'Planned',
  researching: 'Researching',
  drafting:    'Drafting',
  review:      'Review',
  ready:       'Ready',
  published:   'Published',
  archived:    'Archived',
}

export const ARTICLE_TYPE_LABELS: Record<EditorialArticleType, string> = {
  monthly_market_report: 'Monthly market report',
  new_set:               'New-set report',
  upcoming_set:          'Upcoming-set guide',
  data_study:            'Data study',
  evergreen:             'Evergreen guide',
  market_analysis:       'Market analysis',
}

/** Buckets for the "backlog vs planned vs done" split in the UI. */
export const BACKLOG_STATUSES: readonly EditorialStatus[] = ['idea']
export const ACTIVE_STATUSES:  readonly EditorialStatus[] = ['planned', 'researching', 'drafting', 'review', 'ready']
export const CLOSED_STATUSES:  readonly EditorialStatus[] = ['published', 'archived']

// ── Row shape (must mirror the migration; single source of truth
//    lives in migrations/2026-09-06-eic-b2-editorial-projects.sql) ─

export type EditorialProject = {
  id:                 number
  title:              string
  angle:              string | null
  article_type:       string       // free text at DB layer; typed above
  status:             string
  priority:           number       // 1..5, 1 = highest
  target_publish_at:  string | null // ISO date 'YYYY-MM-DD'
  notes:              string | null
  insights_id:        string | null // UUID
  created_at:         string
  updated_at:         string
}

// ── Input validation ─────────────────────────────────────────────

const WRITABLE = new Set<string>([
  'title', 'angle', 'article_type', 'status', 'priority',
  'target_publish_at', 'notes', 'insights_id',
])

/** Whitelist writable columns so a compromised or buggy client can't
 *  touch id / created_at / updated_at. updated_at is server-set on
 *  every write. */
export function pickWritableProjectFields<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) if (WRITABLE.has(k)) out[k] = v
  return out as Partial<T>
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE     = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Full validation of a project write payload. Returns null when
 *  acceptable, otherwise a short human-readable error message. */
export function validateProjectWrite(payload: Record<string, unknown>): string | null {
  if ('title' in payload) {
    if (typeof payload.title !== 'string' || !payload.title.trim()) return 'title must be a non-empty string'
    if (payload.title.length > 300) return 'title too long (max 300 chars)'
  }
  if ('angle' in payload && payload.angle != null) {
    if (typeof payload.angle !== 'string') return 'angle must be a string'
    if (payload.angle.length > 1000) return 'angle too long (max 1000 chars)'
  }
  if ('notes' in payload && payload.notes != null) {
    if (typeof payload.notes !== 'string') return 'notes must be a string'
    if (payload.notes.length > 5000) return 'notes too long (max 5000 chars)'
  }
  if ('article_type' in payload) {
    if (typeof payload.article_type !== 'string' || !(EDITORIAL_ARTICLE_TYPES as readonly string[]).includes(payload.article_type)) {
      return `article_type must be one of: ${EDITORIAL_ARTICLE_TYPES.join(', ')}`
    }
  }
  if ('status' in payload) {
    if (typeof payload.status !== 'string' || !(EDITORIAL_STATUSES as readonly string[]).includes(payload.status)) {
      return `status must be one of: ${EDITORIAL_STATUSES.join(', ')}`
    }
  }
  if ('priority' in payload) {
    const n = payload.priority
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 5) {
      return 'priority must be an integer 1..5 (1 = highest)'
    }
  }
  if ('target_publish_at' in payload && payload.target_publish_at != null) {
    const s = payload.target_publish_at
    if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) return 'target_publish_at must be an ISO date (YYYY-MM-DD) or null'
    // Sanity: reject nonsense years to catch typos.
    const y = Number(s.slice(0, 4))
    if (y < 2020 || y > 2100) return 'target_publish_at year out of range'
  }
  if ('insights_id' in payload && payload.insights_id != null) {
    if (typeof payload.insights_id !== 'string' || !UUID_RE.test(payload.insights_id)) return 'insights_id must be a UUID or null'
  }
  return null
}

// ── This-week bucketing ──────────────────────────────────────────
//
// The block's editorial goal is "two exceptional articles per week".
// We treat the week as Monday–Sunday in UTC (the whole app renders
// dates in en-GB; UTC is close enough for an internal tool). Any
// project with target_publish_at in that window and status not
// 'published' or 'archived' fills a slot. Anything already published
// this week fills a slot too.

export function currentWeekWindowUtc(now = new Date()): { start: Date; end: Date; startIso: string; endIso: string } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  // getUTCDay: Sun=0, Mon=1, ..., Sat=6. Shift so Mon=0.
  const monDelta = (d.getUTCDay() + 6) % 7
  const start = new Date(d)
  start.setUTCDate(d.getUTCDate() - monDelta)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 6)
  return {
    start,
    end,
    startIso: isoDate(start),
    endIso:   isoDate(end),
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function isThisWeek(dateIso: string | null | undefined, now = new Date()): boolean {
  if (!dateIso || !ISO_DATE_RE.test(dateIso)) return false
  const { startIso, endIso } = currentWeekWindowUtc(now)
  return dateIso >= startIso && dateIso <= endIso
}

// ── Health summary metric shape ──────────────────────────────────

export type EditorialHealthSummary = {
  publishedArticles:      number
  ideasInBacklog:         number
  plannedThisWeek:        number
  articlesPublishedThisMonth: number
  upcomingReleasesInWindow:   number
}
