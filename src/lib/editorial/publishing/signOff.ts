// src/lib/editorial/publishing/signOff.ts
//
// Simplified-HQ scheduling helpers. Pure functions + a small set of
// server-side mutations used by the publish route. Kept out of
// actions.ts so the actions dispatcher stays a thin switch.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { hashStudioBody } from '@/lib/editorial/writer/hash'
import type { StudioDocument } from '@/lib/studio/types'
import type { EditorialProject } from '../projects'
import { generateSlug } from './slug'

// ─────────────────────────────────────────────────────────────────
// Material-content fingerprint
// ─────────────────────────────────────────────────────────────────
//
// The sign-off attests to a specific version of the article. If any
// user-visible CMS field (headline / intro / body / SEO title /
// SEO description / slug) changes afterwards, the sign-off is stale
// and must be cleared. `signOffKeyForStudio` produces a stable hash
// of those six fields so a saveStudio patch can compare "material
// content" between before + after.
//
// The slug is part of the URL identity. A slug change (even without
// any body change) is a material editorial decision that requires
// re-review. When the caller does not provide a slug, we derive one
// from the headline via generateSlug — so a headline change also
// naturally changes the derived slug. Explicit slug overrides can
// be passed in via `opts.slug` when the caller knows the effective
// slug already.

export type SignOffKeyOptions = {
  /** The article's effective slug at this moment. Falls back to
   *  `generateSlug(studio.headline)` when unspecified. */
  slug?: string
}

export function signOffKeyForStudio(studio: StudioDocument, opts: SignOffKeyOptions = {}): string {
  const effectiveSlug = opts.slug ?? generateSlug(studio.headline ?? '')
  const parts = [
    (studio.headline ?? '').trim(),
    (studio.intro ?? '').trim(),
    (studio.seo?.title ?? '').trim(),
    (studio.seo?.description ?? '').trim(),
    hashStudioBody(studio.bodyDoc),
    `slug:${effectiveSlug}`,
  ].join('||')
  return parts
}

// ─────────────────────────────────────────────────────────────────
// Server-side mutations
// ─────────────────────────────────────────────────────────────────

export async function signOffProject(projectId: number, adminEmail: string): Promise<EditorialProject> {
  const supa = getSupabaseServiceClient()
  const { data, error } = await supa.from('editorial_projects')
    .update({
      signed_off_at: new Date().toISOString(),
      signed_off_by: adminEmail || null,
      updated_at:    new Date().toISOString(),
    })
    .eq('id', projectId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as EditorialProject
}

export async function clearProjectSignOff(projectId: number): Promise<EditorialProject> {
  const supa = getSupabaseServiceClient()
  const { data, error } = await supa.from('editorial_projects')
    .update({
      signed_off_at: null,
      signed_off_by: null,
      updated_at:    new Date().toISOString(),
    })
    .eq('id', projectId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as EditorialProject
}

export async function scheduleProject(projectId: number, whenIso: string): Promise<EditorialProject> {
  if (!whenIso || Number.isNaN(Date.parse(whenIso))) throw new Error('scheduled_publish_at must be an ISO datetime')
  const supa = getSupabaseServiceClient()
  const { data, error } = await supa.from('editorial_projects')
    .update({
      scheduled_publish_at: new Date(whenIso).toISOString(),
      updated_at:           new Date().toISOString(),
    })
    .eq('id', projectId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as EditorialProject
}

export async function unscheduleProject(projectId: number): Promise<EditorialProject> {
  const supa = getSupabaseServiceClient()
  const { data, error } = await supa.from('editorial_projects')
    .update({
      scheduled_publish_at: null,
      updated_at:           new Date().toISOString(),
    })
    .eq('id', projectId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as EditorialProject
}

// ─────────────────────────────────────────────────────────────────
// Auto-clear on material edit — invoked from the studio PATCH route
// ─────────────────────────────────────────────────────────────────
//
// Compares the previous + next Studio bodies. When the material
// content (headline / intro / body / seo title/desc) has changed AND
// the project was signed off, wipe the sign-off flag so the cron
// won't publish a version the admin has not re-approved. The
// scheduled_publish_at timestamp is deliberately preserved — the
// admin's intent to publish at that time survives an edit; only the
// sign-off has to be renewed.

export type MaterialChangeOptions = {
  prevSlug?: string
  nextSlug?: string
}

export function materialContentChanged(prev: StudioDocument | null, next: StudioDocument, opts: MaterialChangeOptions = {}): boolean {
  if (!prev) return true
  return signOffKeyForStudio(prev, { slug: opts.prevSlug }) !== signOffKeyForStudio(next, { slug: opts.nextSlug })
}

/** Clear sign-off if the material content changed AND the project is
 *  currently signed off. Idempotent no-op otherwise. Preserves
 *  scheduled_publish_at — the admin's publish intent survives an
 *  edit; only the sign-off has to be renewed. */
export async function clearSignOffIfMaterialChanged(projectId: number, prev: StudioDocument | null, next: StudioDocument, opts: MaterialChangeOptions = {}): Promise<{ cleared: boolean }> {
  if (!materialContentChanged(prev, next, opts)) return { cleared: false }
  const supa = getSupabaseServiceClient()
  const { data } = await supa.from('editorial_projects').select('signed_off_at').eq('id', projectId).maybeSingle()
  const signedOffAt = (data as any)?.signed_off_at as string | null | undefined
  if (!signedOffAt) return { cleared: false }
  await clearProjectSignOff(projectId)
  return { cleared: true }
}
