// Narrow policy test for the emergency-rollback invariants. Covers the
// shape of the confirmation phrase and that the actions module exports
// the expected server-action surface. Deeper DB-touching behaviour is
// out of scope for unit tests (requires a staging Supabase).

import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
// Prevent the server-action module from pulling in Next.js cookies.
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/adminAuth', () => ({
  requireAdminPage: async () => ({ user: { email: 'ok' } }),
}))
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ range: () => ({ data: [], error: null }) }) }) }) }),
      update: () => ({ eq: () => ({ in: () => ({ eq: () => ({ select: () => ({ data: [], error: null }) }) }), select: () => ({ data: [], error: null }) }) }),
    }),
  }),
}))

import { emergencyRollback } from '@/app/admin/pilot/migration/actions'

describe('emergencyRollback — confirmation gate', () => {
  it('rejects any confirmation phrase that is not exactly "rollback run"', async () => {
    const bad = ['', ' ', 'rollback', 'rollback-run', 'ROLLBACK RUN', 'rollback  run']
    for (const phrase of bad) {
      const r = await emergencyRollback('any-run-id', phrase)
      expect(r.affected).toBe(0)
      expect(r.error).toBe('confirmation phrase did not match')
    }
  })

  it('leading/trailing whitespace is tolerated', async () => {
    const r = await emergencyRollback('any-run-id', '  rollback run  ')
    // No "did not match" error — gate passed; subsequent DB stubs return 0 rows.
    expect(r.error).toBeUndefined()
  })
})
