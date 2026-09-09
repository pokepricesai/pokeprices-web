// src/lib/editorial/serverProjects.ts
//
// Shared server-side helpers for creating and looking up editorial
// projects. Extracted so the Strategist chat route can perform real
// database writes when the admin says "create this / save this /
// plan this", without going through an HTTP round trip to
// /api/admin/editorial/projects (and so the two entry points can
// never drift on validation).
//
// Read-only lookups also live here for duplicate detection.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import {
  pickWritableProjectFields, validateProjectWrite,
  type EditorialProject, CLOSED_STATUSES,
} from './projects'

/** Insert a new editorial_projects row. Applies the same validation
 *  + column whitelist as the POST /api/admin/editorial/projects
 *  handler. Throws with a safe admin-facing message on failure. */
export async function insertEditorialProject(raw: Record<string, unknown>): Promise<EditorialProject> {
  const payload = pickWritableProjectFields(raw)
  if (!('title' in payload) || typeof payload.title !== 'string' || !payload.title.trim()) {
    throw new Error('title is required')
  }
  const validationError = validateProjectWrite(payload)
  if (validationError) throw new Error(validationError)

  const supa = getSupabaseServiceClient()
  const { data, error } = await supa
    .from('editorial_projects')
    .insert([{ ...payload, updated_at: new Date().toISOString() }])
    .select('*')
    .single()
  if (error) throw new Error(`insert failed: ${error.message}`)
  return data as EditorialProject
}

/** Normalise a title for duplicate detection: lowercase, strip
 *  punctuation, collapse whitespace. Same rules the Opportunity
 *  Radar panel uses for exact-title dedupe. Not exposed as a URL
 *  slug — this is only for internal duplicate matching. */
export function normaliseTitleForDedupe(title: string): string {
  return String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Return the most recent non-archived / non-published project whose
 *  normalised title matches the input. Used by the Strategist to
 *  make "create this" idempotent — repeating the command returns the
 *  existing project rather than silently duplicating it. */
export async function findActiveProjectByExactTitle(title: string): Promise<EditorialProject | null> {
  const needle = normaliseTitleForDedupe(title)
  if (!needle) return null
  const supa = getSupabaseServiceClient()
  const { data, error } = await supa
    .from('editorial_projects')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(`lookup failed: ${error.message}`)
  const rows = (data ?? []) as EditorialProject[]
  for (const row of rows) {
    if (CLOSED_STATUSES.includes(row.status as any)) continue
    if (normaliseTitleForDedupe(row.title) === needle) return row
  }
  return null
}
