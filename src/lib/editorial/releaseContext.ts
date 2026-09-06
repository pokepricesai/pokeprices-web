// src/lib/editorial/releaseContext.ts
//
// EIC Block 3 — consolidated release intelligence for Editorial HQ
// and for the AI-ready context object. Replaces the narrower
// Block-2 releaseWatch.ts (which only merged sources shallowly).
//
// Responsibilities:
//   * Recent releases from cards.set_release_date (real, indexed,
//     PokePrices-linkable).
//   * Upcoming + curated releases from release_calendar (the only
//     source that knows about future dates).
//   * De-duplicate across sources when the same set appears in both,
//     using a normalised name + release-date match.
//   * Attach coverage signals from public.insights and public.editorial_projects.
//   * Attach applicable editorial-timing opportunities.
//   * Return a compact JSON-serialisable shape safe for both the
//     Editorial HQ UI and a future AI call.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { bodyJsonToPlainText, normaliseSetName, tokeniseForSearch } from './plainText'
import { fetchAllPages } from './pageFetch'

// ── Constants ────────────────────────────────────────────────────

const WINDOW_DAYS_BACK    = 45   // "recently released" window per Block 3 spec
const WINDOW_DAYS_FORWARD = 120  // "upcoming" window per Block 3 spec
const UPCOMING_THIN_THRESHOLD = 3
const MAX_ITEMS = 60

// ── Types ────────────────────────────────────────────────────────

export type ReleaseKind = 'recent' | 'upcoming'

export type ReleaseTimingOpportunity = {
  key:         'preview' | 'reveal' | 'launch' | 'reaction' | 'performance'
  label:       string
  applicable:  boolean
  reason:      string
}

export type ReleaseCoverage = {
  publishedInsights: ReadonlyArray<{ slug: string; headline: string; publishedAt: string | null }>
  plannedProjects:   ReadonlyArray<{ id: number; title: string; status: string; targetPublishAt: string | null }>
  status:            'covered' | 'planned' | 'none'
}

export type ReleaseItem = {
  kind:                ReleaseKind
  setName:             string             // canonical display name (prefers release_calendar)
  altSetNames:         readonly string[]  // any distinct names seen for the same set
  setCode:             string | null
  releaseDate:         string             // YYYY-MM-DD
  jpReleaseDate:       string | null
  region:              string | null
  confirmed:           boolean | null     // null when derived from cards only
  cardCount:           number | null      // populated when a card catalogue join exists
  daysDelta:           number             // negative = past, positive = future, 0 = today
  releaseCalendarId:   number | null      // to enable editing in the admin UI
  pokePricesSetUrl:    string | null      // canonical /set/{encoded} URL when the set exists
  sources:             ReadonlyArray<'cards' | 'release_calendar'>
  coverage:            ReleaseCoverage
  timingOpportunities: readonly ReleaseTimingOpportunity[]
  notes:               string | null
}

export type ReleaseContext = {
  today:                  string
  windowDaysBack:         number
  windowDaysForward:      number
  recent:                 readonly ReleaseItem[]
  upcoming:               readonly ReleaseItem[]
  upcomingCoverageIsThin: boolean
  gapNote:                string | null
}

// ── Timing opportunities ─────────────────────────────────────────
//
// Editorial windows expressed as ranges of daysUntilRelease. Negative
// numbers = post-release.
//
//   preview       ~6-8 weeks BEFORE  → 60..30 days before, but we
//                                      keep the door open from 90..30.
//   reveal        ~2-3 weeks BEFORE  → 21..7 days before.
//   launch        release week       → 7..-3 days.
//   reaction      ~7-14 days AFTER   → -7..-14 days.
//   performance   ~30 days AFTER     → -21..-45 days.
//
// The helper returns every opportunity that IS applicable AND every
// opportunity whose window is close (so the UI can also render
// "coming up next" cues if it wants).

// Windows are inclusive and contiguous — no dead zones between adjacent
// stages. Overlaps are intentional at the boundaries so both applicable
// stages surface (e.g. day-7 = both launch and reaction).
const OPPORTUNITY_WINDOWS: Record<ReleaseTimingOpportunity['key'], { minDaysUntil: number; maxDaysUntil: number; label: string; reason: string }> = {
  preview:     { minDaysUntil:  30, maxDaysUntil:  90, label: 'Upcoming-set / everything-we-know',       reason: '~6–8 weeks before release: reader appetite for what the set contains.' },
  reveal:      { minDaysUntil:   7, maxDaysUntil:  30, label: 'Chase-card + confirmed reveals',           reason: '~2–3 weeks before release: reveals + chase cards drive search.' },
  launch:      { minDaysUntil:  -7, maxDaysUntil:   7, label: 'Full-set guide + launch pricing',          reason: 'Release week: full set / prices / most valuable cards coverage.' },
  reaction:    { minDaysUntil: -21, maxDaysUntil:  -7, label: 'Early winners and losers',                 reason: '~1–3 weeks after release: initial market reaction.' },
  performance: { minDaysUntil: -60, maxDaysUntil: -21, label: 'Did the chase cards hold their value?',    reason: '~30–60 days after release: proper price-performance retrospective.' },
}

export function timingOpportunitiesFor(daysDelta: number): ReleaseTimingOpportunity[] {
  // daysDelta is (release_date - today). daysUntilRelease = daysDelta.
  const out: ReleaseTimingOpportunity[] = []
  for (const [key, w] of Object.entries(OPPORTUNITY_WINDOWS)) {
    const inWindow = daysDelta >= w.minDaysUntil && daysDelta <= w.maxDaysUntil
    out.push({
      key:        key as ReleaseTimingOpportunity['key'],
      label:      w.label,
      applicable: inWindow,
      reason:     w.reason,
    })
  }
  return out
}

// ── Coverage matching ────────────────────────────────────────────

/** Deterministic "does this article/project appear to be about this set"
 *  check. Uses:
 *    * exact set_name inclusion in headline / intro / notes
 *    * normalised set_name inclusion (strips "Mega Evolution -" and
 *      "Japanese " prefixes so RC names match cards names)
 *    * body plain-text mention (bounded — first 4KB per article).
 *  Set-name substrings shorter than 4 chars are rejected (would match
 *  by accident far too often).
 */
function mentionsSet(hay: string, setName: string, normalisedSetName: string): boolean {
  if (!hay) return false
  if (setName.length >= 4) {
    const rx = new RegExp(`\\b${escapeRegex(setName)}\\b`, 'i')
    if (rx.test(hay)) return true
  }
  if (normalisedSetName.length >= 4 && normalisedSetName !== setName.toLowerCase()) {
    const rx2 = new RegExp(`\\b${escapeRegex(normalisedSetName)}\\b`, 'i')
    if (rx2.test(hay)) return true
  }
  return false
}
function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// ── Row shapes we consume from the DB ────────────────────────────

type InsightLite = {
  id: string; slug: string; headline: string; intro: string | null;
  published_at: string | null; body_json: unknown;
  set_refs: string[] | null;
}

type ProjectLite = {
  id: number; title: string; angle: string | null; notes: string | null;
  status: string; target_publish_at: string | null;
}

type RcLite = {
  id: number; set_name: string; set_code: string | null; release_date: string | null;
  region: string | null; jp_release_date: string | null; confirmed: boolean | null;
  notes: string | null;
}

// ── Public: build the release context ────────────────────────────

export async function fetchReleaseContext(now = new Date()): Promise<ReleaseContext> {
  const supa = getSupabaseServiceClient()
  const todayIso   = isoDate(now)
  const backCut    = isoDate(shiftDays(now, -WINDOW_DAYS_BACK))
  const forwardCut = isoDate(shiftDays(now,  WINDOW_DAYS_FORWARD))

  // Four parallel fetches. The `cards` prefetch is paged defensively
  // because PostgREST silently caps responses at db-max-rows (1000 on
  // Supabase-managed defaults). A window today returns 0 cards, but
  // the catalogue grows and we must not silently truncate. The other
  // three fetches are already well below the cap.
  const [cardsPaged, rcRes, insightsRes, projectsRes] = await Promise.all([
    fetchAllPages<{ set_name: string; set_release_date: string }>(
      () => supa.from('cards')
        .select('set_name, set_release_date')
        .gte('set_release_date', backCut)
        .lte('set_release_date', forwardCut),
      { hardMaxRows: 20_000 },
    ),
    supa.from('release_calendar')
      .select('id, set_name, set_code, release_date, region, jp_release_date, confirmed, notes')
      .gte('release_date', backCut)
      .lte('release_date', forwardCut)
      .order('release_date', { ascending: true })
      .limit(200),
    supa.from('insights')
      .select('id, slug, headline, intro, published_at, body_json, set_refs')
      .eq('status', 'published')
      .limit(500),
    supa.from('editorial_projects')
      .select('id, title, angle, notes, status, target_publish_at')
      .neq('status', 'archived')
      .limit(500),
  ])
  if (rcRes.error)       throw new Error(`releaseContext: release_calendar ${rcRes.error.message}`)
  if (insightsRes.error) throw new Error(`releaseContext: insights ${insightsRes.error.message}`)
  if (projectsRes.error) throw new Error(`releaseContext: editorial_projects ${projectsRes.error.message}`)

  const cardRows = cardsPaged.rows
  const rcRows   = (rcRes.data ?? []) as RcLite[]
  const insights = (insightsRes.data ?? []) as InsightLite[]
  const projects = (projectsRes.data ?? []) as ProjectLite[]

  // Pre-compute plain text for each insight ONCE and cap to 4KB so
  // coverage matching stays cheap.
  const insightPlain = new Map<string, string>()
  for (const i of insights) insightPlain.set(i.id, bodyJsonToPlainText(i.body_json, { maxChars: 4000 }))

  // Aggregate cards → { normalisedName + date → cardCount, canonical name }
  type CardsAgg = { name: string; releaseDate: string; count: number }
  const cardsByKey = new Map<string, CardsAgg>()
  for (const r of cardRows) {
    const name = String(r.set_name || '').trim()
    const date = String(r.set_release_date || '').slice(0, 10)
    if (!name || !date) continue
    const key = `${normaliseSetName(name)}|${date}`
    const existing = cardsByKey.get(key)
    if (existing) existing.count += 1
    else cardsByKey.set(key, { name, releaseDate: date, count: 1 })
  }

  // Build merged items: start from release_calendar (rich metadata),
  // then merge in the cards signal where dates match, then add any
  // cards-only sets that RC didn't cover.
  type MergedInput = {
    canonicalName: string
    altNames:      Set<string>
    date:          string
    setCode:       string | null
    jpDate:        string | null
    region:        string | null
    confirmed:     boolean | null
    cardCount:     number | null
    rcId:          number | null
    sources:       Set<'cards' | 'release_calendar'>
    notes:         string | null
  }
  const merged = new Map<string, MergedInput>()

  for (const r of rcRows) {
    const name = String(r.set_name || '').trim()
    const date = String(r.release_date || '').slice(0, 10)
    if (!name || !date) continue
    const key = `${normaliseSetName(name)}|${date}`
    merged.set(key, {
      canonicalName: name,
      altNames:      new Set<string>([name]),
      date,
      setCode:       r.set_code,
      jpDate:        r.jp_release_date ?? null,
      region:        r.region ?? null,
      confirmed:     r.confirmed,
      cardCount:     null,
      rcId:          r.id,
      sources:       new Set<'cards' | 'release_calendar'>(['release_calendar']),
      notes:         r.notes ?? null,
    })
  }
  cardsByKey.forEach((agg, key) => {
    const existing = merged.get(key)
    if (existing) {
      existing.altNames.add(agg.name)
      existing.cardCount = agg.count
      existing.sources.add('cards')
    } else {
      merged.set(key, {
        canonicalName: agg.name,
        altNames:      new Set<string>([agg.name]),
        date:          agg.releaseDate,
        setCode:       null,
        jpDate:        null,
        region:        null,
        confirmed:     null,
        cardCount:     agg.count,
        rcId:          null,
        sources:       new Set<'cards' | 'release_calendar'>(['cards']),
        notes:         null,
      })
    }
  })

  // Materialise items with coverage + timing.
  const items: ReleaseItem[] = []
  merged.forEach(m => {
    const daysDelta = dayDiff(m.date, todayIso)
    const kind: ReleaseKind = daysDelta > 0 ? 'upcoming' : 'recent'
    const norm = normaliseSetName(m.canonicalName)

    // Coverage: check every published insight and non-archived project.
    const matchedInsights: Array<{ slug: string; headline: string; publishedAt: string | null }> = []
    for (const i of insights) {
      const setRefsMatch = Array.isArray(i.set_refs)
        && i.set_refs.some(s => normaliseSetName(String(s || '')) === norm)
      if (setRefsMatch
        || mentionsSet(i.headline || '', m.canonicalName, norm)
        || mentionsSet(i.intro    || '', m.canonicalName, norm)
        || mentionsSet(insightPlain.get(i.id) || '', m.canonicalName, norm)
      ) {
        matchedInsights.push({ slug: i.slug, headline: i.headline, publishedAt: i.published_at })
      }
    }

    const matchedProjects: Array<{ id: number; title: string; status: string; targetPublishAt: string | null }> = []
    for (const p of projects) {
      if (mentionsSet(p.title || '', m.canonicalName, norm)
        || mentionsSet(p.angle || '', m.canonicalName, norm)
        || mentionsSet(p.notes || '', m.canonicalName, norm)
      ) {
        matchedProjects.push({ id: p.id, title: p.title, status: p.status, targetPublishAt: p.target_publish_at })
      }
    }

    const coverage: ReleaseCoverage = {
      publishedInsights: matchedInsights,
      plannedProjects:   matchedProjects,
      status: matchedInsights.length > 0 ? 'covered'
            : matchedProjects.length > 0 ? 'planned'
            : 'none',
    }

    items.push({
      kind,
      setName:           m.canonicalName,
      altSetNames:       Array.from(m.altNames).filter(n => n !== m.canonicalName),
      setCode:           m.setCode,
      releaseDate:       m.date,
      jpReleaseDate:     m.jpDate,
      region:            m.region,
      confirmed:         m.confirmed,
      cardCount:         m.cardCount,
      daysDelta,
      releaseCalendarId: m.rcId,
      pokePricesSetUrl:  m.cardCount && m.cardCount > 0 ? `/set/${encodeURIComponent(m.canonicalName)}` : null,
      sources:           Array.from(m.sources),
      coverage,
      timingOpportunities: timingOpportunitiesFor(daysDelta),
      notes:             m.notes,
    })
  })

  // Filter into the block-2/3-mandated windows (kept as-is for
  // strictness — Part 1 verified today's 45d-back window is genuine).
  const recent   = items
    .filter(x => x.kind === 'recent' && x.daysDelta >= -WINDOW_DAYS_BACK && x.daysDelta <= 0)
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
    .slice(0, MAX_ITEMS)
  const upcoming = items
    .filter(x => x.kind === 'upcoming' && x.daysDelta > 0 && x.daysDelta <= WINDOW_DAYS_FORWARD)
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))
    .slice(0, MAX_ITEMS)

  const upcomingCoverageIsThin = upcoming.length < UPCOMING_THIN_THRESHOLD
  const gapNote = upcomingCoverageIsThin
    ? `Upcoming coverage in release_calendar is thin (${upcoming.length} entr${upcoming.length === 1 ? 'y' : 'ies'} in the next ${WINDOW_DAYS_FORWARD} days). Add rows manually via the "Curate release" panel below.`
    : null

  return {
    today:                  todayIso,
    windowDaysBack:         WINDOW_DAYS_BACK,
    windowDaysForward:      WINDOW_DAYS_FORWARD,
    recent,
    upcoming,
    upcomingCoverageIsThin,
    gapNote,
  }
}

// ── Date utilities (UTC, no dependency) ──────────────────────────

function isoDate(d: Date): string { return d.toISOString().slice(0, 10) }
function shiftDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + days)
  return out
}
function dayDiff(dateIso: string, refIso: string): number {
  const [d1, r1] = [dateIso, refIso].map(s => Date.UTC(
    Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)),
  ))
  return Math.round((d1 - r1) / (24 * 60 * 60 * 1000))
}

// ── Exposed for reuse ────────────────────────────────────────────

export const RELEASE_WINDOW = {
  daysBack:    WINDOW_DAYS_BACK,
  daysForward: WINDOW_DAYS_FORWARD,
}
