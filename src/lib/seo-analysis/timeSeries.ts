// src/lib/seo-analysis/timeSeries.ts
// Block 5A-W-33 — small numeric helpers for the chart-level GSC /
// Bing / coverage exports. The exports we have for W33 are time
// series only (no per-query / per-page rows), so trend analysis is
// the strongest signal we can derive.

export type DailyPoint = {
  date:        string  // ISO 8601 yyyy-mm-dd
  value:       number
}

export type TrendSummary = {
  firstDate:           string | null
  lastDate:            string | null
  totalDays:           number
  total:               number
  mean:                number
  /** First-week vs last-week mean. Positive = growing, negative = shrinking. */
  weekOverWeekDelta:   number | null
  /** Same delta as a percentage of the first-week mean. null if first-week mean is 0. */
  weekOverWeekPct:     number | null
  /** Simple 7-day rolling average aligned with each point's date. */
  rolling7:            DailyPoint[]
}

export function summarise(points: DailyPoint[]): TrendSummary {
  const sane = points.filter(p => Number.isFinite(p.value))
  sane.sort((a, b) => a.date.localeCompare(b.date))
  if (sane.length === 0) {
    return {
      firstDate: null, lastDate: null, totalDays: 0, total: 0, mean: 0,
      weekOverWeekDelta: null, weekOverWeekPct: null, rolling7: [],
    }
  }
  const total = sane.reduce((acc, p) => acc + p.value, 0)
  const mean  = total / sane.length

  // First 7 days vs last 7 days (or all available if fewer).
  const firstWindow = sane.slice(0, Math.min(7, sane.length))
  const lastWindow  = sane.slice(Math.max(0, sane.length - 7))
  const firstMean = firstWindow.reduce((a, p) => a + p.value, 0) / firstWindow.length
  const lastMean  = lastWindow.reduce((a, p) => a + p.value, 0) / lastWindow.length
  const wowDelta  = sane.length >= 2 ? (lastMean - firstMean) : null
  const wowPct    = wowDelta !== null && firstMean > 0
    ? (wowDelta / firstMean) * 100
    : null

  // 7-day trailing rolling average.
  const rolling7: DailyPoint[] = []
  for (let i = 0; i < sane.length; i++) {
    const startIdx = Math.max(0, i - 6)
    const slice    = sane.slice(startIdx, i + 1)
    const avg      = slice.reduce((a, p) => a + p.value, 0) / slice.length
    rolling7.push({ date: sane[i]!.date, value: avg })
  }

  return {
    firstDate:         sane[0]!.date,
    lastDate:          sane[sane.length - 1]!.date,
    totalDays:         sane.length,
    total,
    mean,
    weekOverWeekDelta: wowDelta,
    weekOverWeekPct:   wowPct,
    rolling7,
  }
}
