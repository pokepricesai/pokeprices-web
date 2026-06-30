// src/lib/seo-analysis/coverageAnalysis.ts
// Block 5A-W-33 — analyse the GSC Coverage chart export.
//
// The Coverage chart we have is daily counts of indexed vs not-indexed
// (plus impressions for context). It does NOT carry per-URL status
// (crawled-not-indexed / soft-404 / etc.) — for that we'd need the
// "Index coverage" detail export. The pure helper here works on what
// we have and the report calls out the missing detail.

export type CoveragePoint = {
  date:        string
  indexed:     number
  notIndexed:  number
  impressions: number
}

export type CoverageSummary = {
  firstDate:                 string | null
  lastDate:                  string | null
  firstIndexed:              number
  lastIndexed:               number
  firstNotIndexed:           number
  lastNotIndexed:            number
  /** indexed / (indexed + notIndexed). null if denominator is 0. */
  firstIndexedShare:         number | null
  lastIndexedShare:          number | null
  /** Days where notIndexed dropped sharply (>= 5,000 in one day). */
  largeNotIndexedDrops:      Array<{ date: string; from: number; to: number; delta: number }>
  /** Days where notIndexed jumped sharply (>= 5,000 in one day). */
  largeNotIndexedSpikes:     Array<{ date: string; from: number; to: number; delta: number }>
  /** Trend verdict: 'improving' | 'worsening' | 'flat'. */
  trend:                     'improving' | 'worsening' | 'flat'
  /** Trend reason — appended to the human-readable report. */
  trendReason:               string
}

const LARGE_DELTA = 5000

export function summariseCoverage(points: CoveragePoint[]): CoverageSummary {
  const sane = points
    .filter(p => Number.isFinite(p.indexed) && Number.isFinite(p.notIndexed))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))

  if (sane.length === 0) {
    return {
      firstDate: null, lastDate: null,
      firstIndexed: 0, lastIndexed: 0,
      firstNotIndexed: 0, lastNotIndexed: 0,
      firstIndexedShare: null, lastIndexedShare: null,
      largeNotIndexedDrops: [], largeNotIndexedSpikes: [],
      trend: 'flat', trendReason: 'no data',
    }
  }

  const first = sane[0]!
  const last  = sane[sane.length - 1]!
  const firstShare = share(first.indexed, first.notIndexed)
  const lastShare  = share(last.indexed,  last.notIndexed)

  const drops: CoverageSummary['largeNotIndexedDrops']   = []
  const spikes: CoverageSummary['largeNotIndexedSpikes'] = []
  for (let i = 1; i < sane.length; i++) {
    const prev = sane[i - 1]!
    const cur  = sane[i]!
    const delta = cur.notIndexed - prev.notIndexed
    if (delta <= -LARGE_DELTA) {
      drops.push({ date: cur.date, from: prev.notIndexed, to: cur.notIndexed, delta })
    } else if (delta >= LARGE_DELTA) {
      spikes.push({ date: cur.date, from: prev.notIndexed, to: cur.notIndexed, delta })
    }
  }

  let trend: CoverageSummary['trend'] = 'flat'
  let trendReason = ''
  if (firstShare !== null && lastShare !== null) {
    const diff = lastShare - firstShare
    if (diff >= 0.05) {
      trend = 'improving'
      trendReason = `indexed share rose from ${(firstShare * 100).toFixed(1)}% to ${(lastShare * 100).toFixed(1)}%`
    } else if (diff <= -0.05) {
      trend = 'worsening'
      trendReason = `indexed share fell from ${(firstShare * 100).toFixed(1)}% to ${(lastShare * 100).toFixed(1)}%`
    } else {
      trend = 'flat'
      trendReason = `indexed share roughly stable around ${(lastShare * 100).toFixed(1)}%`
    }
  }

  return {
    firstDate:             first.date,
    lastDate:              last.date,
    firstIndexed:          first.indexed,
    lastIndexed:           last.indexed,
    firstNotIndexed:       first.notIndexed,
    lastNotIndexed:        last.notIndexed,
    firstIndexedShare:     firstShare,
    lastIndexedShare:      lastShare,
    largeNotIndexedDrops:  drops,
    largeNotIndexedSpikes: spikes,
    trend,
    trendReason,
  }
}

function share(indexed: number, notIndexed: number): number | null {
  const denom = indexed + notIndexed
  if (denom <= 0) return null
  return indexed / denom
}
