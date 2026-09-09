// src/lib/editorial/__tests__/simpleBuckets.test.ts
//
// Simplified HQ lifecycle mapping. The reset collapses the eight-
// status project vocabulary into four buckets:
//
//   possible  → status: 'idea'
//   idea      → status: 'planned'
//   pipeline  → any active-in-progress status
//   published → 'published'
//
// These tests lock down the mapping so future edits can't drop a
// status into two buckets or lose one silently.

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import { bucketOfProject, statusForBucket, groupProjectsByBucket } from '../simpleBuckets'
import type { EditorialProject } from '../projects'

function p(overrides: Partial<EditorialProject>): EditorialProject {
  return {
    id: 1, title: 'x', angle: null, article_type: 'evergreen_guide',
    status: 'idea', priority: 3, target_publish_at: null, notes: null,
    insights_id: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

describe('bucketOfProject', () => {
  it('routes "idea" status to the Possible Ideas bucket', () => {
    expect(bucketOfProject(p({ status: 'idea' }))).toBe('possible')
  })
  it('routes "planned" status to the Ideas bucket', () => {
    expect(bucketOfProject(p({ status: 'planned' }))).toBe('idea')
  })
  it('collapses the old active-work statuses into Pipeline', () => {
    for (const s of ['researching', 'drafting', 'review', 'ready']) {
      expect(bucketOfProject(p({ status: s }))).toBe('pipeline')
    }
  })
  it('routes "published" to Published (Content Library)', () => {
    expect(bucketOfProject(p({ status: 'published' }))).toBe('published')
  })
  it('routes "archived" to Archived (hidden by default in the simplified UI)', () => {
    expect(bucketOfProject(p({ status: 'archived' }))).toBe('archived')
  })
  it('routes an unknown status to Possible so it stays visible', () => {
    expect(bucketOfProject(p({ status: 'weird' } as any))).toBe('possible')
  })
})

describe('statusForBucket', () => {
  it('possible → idea', () => { expect(statusForBucket('possible')).toBe('idea') })
  it('idea → planned', () => { expect(statusForBucket('idea')).toBe('planned') })
  it('pipeline → drafting (canonical entry point)', () => { expect(statusForBucket('pipeline')).toBe('drafting') })
  it('published → published', () => { expect(statusForBucket('published')).toBe('published') })
})

describe('groupProjectsByBucket', () => {
  it('assigns each project to exactly one bucket', () => {
    const projects = [
      p({ id: 1, status: 'idea' }),
      p({ id: 2, status: 'planned' }),
      p({ id: 3, status: 'drafting' }),
      p({ id: 4, status: 'ready' }),
      p({ id: 5, status: 'published' }),
      p({ id: 6, status: 'archived' }),
    ]
    const g = groupProjectsByBucket(projects)
    expect(g.possible.map(x => x.id)).toEqual([1])
    expect(g.idea.map(x => x.id)).toEqual([2])
    expect(g.pipeline.map(x => x.id)).toEqual([3, 4])
    expect(g.published.map(x => x.id)).toEqual([5])
    expect(g.archived.map(x => x.id)).toEqual([6])
    // Sum equals input length — nothing lost, nothing duplicated.
    const total = Object.values(g).reduce((n, arr) => n + arr.length, 0)
    expect(total).toBe(projects.length)
  })
})
