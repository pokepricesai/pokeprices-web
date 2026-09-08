// src/lib/editorial/opportunityRadarCache.ts
//
// Daily cache in front of buildOpportunityRadar.
//
// Behaviour:
//   * Same calendar day → return the persisted radar_json unchanged.
//   * No row for today → compute + persist + return.
//   * force=true → recompute + upsert the row (updates computed_at).
//
// Table: opportunity_radar_cache (see migrations/2026-09-08-
// opportunity-radar-cache.sql). If the table is missing (migration
// not yet applied) or Supabase errors on read/write, fall back to
// computing on the fly — the Radar itself is deterministic, so
// callers get a valid result either way.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { buildOpportunityRadar, type OpportunityRadar } from './opportunityRadar'
import type { EditorialContext } from './context'

export type CachedRadarResult = {
  radar:       OpportunityRadar
  computedAt:  string        // ISO datetime of the cached row (or "just now" when uncached)
  calendarDay: string        // YYYY-MM-DD in UTC
  fromCache:   boolean
}

const TABLE = 'opportunity_radar_cache'

function calendarDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** Read today's cached radar if present, or compute + persist a
 *  fresh one. `force: true` always recomputes and updates the row. */
export async function loadOrComputeRadar(
  context: EditorialContext,
  opts: { force?: boolean } = {},
): Promise<CachedRadarResult> {
  const day = calendarDay()
  const supa = getSupabaseServiceClient()

  if (!opts.force) {
    try {
      const { data, error } = await supa
        .from(TABLE)
        .select('calendar_date, computed_at, radar_json')
        .eq('calendar_date', day)
        .maybeSingle()
      if (!error && data && data.radar_json) {
        return {
          radar:       data.radar_json as OpportunityRadar,
          computedAt:  data.computed_at as string,
          calendarDay: day,
          fromCache:   true,
        }
      }
    } catch (e) {
      // Table missing / transient — fall through to a compute.
      console.warn('[opportunityRadarCache] read failed, computing fresh:', e instanceof Error ? e.message : 'unknown')
    }
  }

  const radar = await buildOpportunityRadar(context)
  const computedAt = new Date().toISOString()
  try {
    await supa
      .from(TABLE)
      .upsert({ calendar_date: day, computed_at: computedAt, radar_json: radar }, { onConflict: 'calendar_date' })
  } catch (e) {
    // Non-fatal — a fresh radar is still returned to the caller.
    console.warn('[opportunityRadarCache] write failed:', e instanceof Error ? e.message : 'unknown')
  }
  return { radar, computedAt, calendarDay: day, fromCache: false }
}
