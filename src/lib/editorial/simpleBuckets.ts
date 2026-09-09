// src/lib/editorial/simpleBuckets.ts
//
// Canonical lifecycle helper for the simplified Editorial HQ.
//
// The full editorial_projects.status vocabulary (idea / planned /
// researching / drafting / review / ready / published / archived)
// predates the "possible → idea → pipeline → published" reset.
// Rather than migrate the enum, this module maps the two vocabularies
// so every list place uses the same rule and items cannot appear in
// more than one bucket.
//
//   UI bucket    | Persisted status(es)
//   -------------|--------------------------------------------------
//   possible     | 'idea'                (admin said Yes, not yet developed)
//   idea         | 'planned'             (developed brief, ready to work)
//   pipeline     | 'drafting','researching','review','ready'
//                | (any active-in-progress status)
//   published    | 'published'           (Content Library)
//   archived     | 'archived'            (hidden from normal UI)
//
// "researching / review / ready" collapse into pipeline because in
// the simplified workflow those old sub-stages are no longer
// distinct — an article is either being worked on or it is not.

import type { EditorialProject } from './projects'

export type SimpleBucket = 'possible' | 'idea' | 'pipeline' | 'published' | 'archived'

/** The status persisted when a project first moves INTO a given
 *  bucket via the simplified UI. Order in `pipeline` matters —
 *  `drafting` is the canonical entry point when moving there fresh. */
const BUCKET_ENTRY_STATUS: Record<Exclude<SimpleBucket, 'archived'>, string> = {
  possible:  'idea',
  idea:      'planned',
  pipeline:  'drafting',
  published: 'published',
}

/** Statuses that map INTO a bucket for display purposes. Multiple
 *  legacy statuses fold into `pipeline` so nothing goes missing when
 *  the simplified UI takes over. */
const BUCKET_MEMBERS: Record<SimpleBucket, readonly string[]> = {
  possible:  ['idea'],
  idea:      ['planned'],
  pipeline:  ['researching', 'drafting', 'review', 'ready'],
  published: ['published'],
  archived:  ['archived'],
}

export function bucketOfProject(project: Pick<EditorialProject, 'status'>): SimpleBucket {
  const s = String(project.status ?? '').toLowerCase()
  for (const bucket of ['possible', 'idea', 'pipeline', 'published', 'archived'] as SimpleBucket[]) {
    if (BUCKET_MEMBERS[bucket].includes(s)) return bucket
  }
  // Unknown status: safe default is `possible` so it shows up in the
  // UI rather than disappearing.
  return 'possible'
}

/** The status to write when transitioning a project INTO a bucket.
 *  Used by the "Move to Ideas / Pipeline" buttons. */
export function statusForBucket(bucket: Exclude<SimpleBucket, 'archived'>): string {
  return BUCKET_ENTRY_STATUS[bucket]
}

/** Group a list of projects by bucket. Returns arrays in the same
 *  order as the input (no re-sorting). */
export function groupProjectsByBucket<P extends Pick<EditorialProject, 'status'>>(projects: readonly P[]): Record<SimpleBucket, P[]> {
  const out: Record<SimpleBucket, P[]> = { possible: [], idea: [], pipeline: [], published: [], archived: [] }
  for (const p of projects) out[bucketOfProject(p)].push(p)
  return out
}
