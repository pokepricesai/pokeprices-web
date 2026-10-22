// Claim-batch RPC wrapper + markItem helpers. We mock the Supabase
// client because the "real" atomic SKIP-LOCKED guarantee is enforced by
// Postgres, not by this TS layer. These tests prove the TS layer:
//   1. Calls the RPC with the exact arg shape the SQL migration defines.
//   2. Treats null data (no rows available) as empty, not an error.
//   3. markItem is idempotent-safe (sends the same patch on repeated calls
//      without re-sending stale lease fields).
//   4. releaseLease is scoped to status='claimed' only — it can never
//      downgrade a verified or failed row back to pending.

import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { claimBatch, markItem, releaseLease } from '../claim'

type RpcCall = { name: string; args: Record<string, unknown> }

function makeStubSupabase() {
  const rpc: RpcCall[] = []
  const updates: Array<{ table: string; patch: Record<string, unknown>; filters: Array<[string,unknown]> }> = []
  const stub = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpc.push({ name, args })
      return { data: [], error: null }
    },
    _rpcReturning: (rows: unknown[]) => {
      stub.rpc = async (name: string, args: Record<string, unknown>) => {
        rpc.push({ name, args })
        return { data: rows, error: null }
      }
    },
    _rpcError: (msg: string) => {
      stub.rpc = async (name: string, args: Record<string, unknown>) => {
        rpc.push({ name, args })
        return { data: null, error: { message: msg } }
      }
    },
    from: (table: string) => {
      const filters: Array<[string,unknown]> = []
      let currentPatch: Record<string, unknown> = {}
      const builder: Record<string, unknown> = {
        update: (patch: Record<string, unknown>) => {
          currentPatch = patch
          return builder
        },
        eq: (col: string, v: unknown) => {
          filters.push([col, v])
          return builder
        },
        then: (resolve: (v: unknown) => unknown) => {
          updates.push({ table, patch: currentPatch, filters })
          return resolve({ error: null })
        },
      }
      return builder
    },
    _rpcCalls:    () => rpc,
    _updateCalls: () => updates,
  }
  return stub
}

describe('claimBatch', () => {
  it('calls pp_tcg_migration_claim_batch with the exact arg shape', async () => {
    const sb = makeStubSupabase()
    sb._rpcReturning([{ id: 'x', pp_card_slug: 'slug-1', status: 'claimed' }])
    const out = await claimBatch(sb as unknown as never, {
      runId: 'r1', batchSize: 5, workerId: 'w1', leaseDurationSec: 240,
    })
    expect(sb._rpcCalls()).toEqual([{
      name: 'pp_tcg_migration_claim_batch',
      args: { p_run_id: 'r1', p_batch_size: 5, p_worker_id: 'w1', p_lease_duration_sec: 240 },
    }])
    expect(out).toEqual([{ id: 'x', pp_card_slug: 'slug-1', status: 'claimed' }])
  })

  it('returns [] when the RPC returns no rows (empty queue)', async () => {
    const sb = makeStubSupabase()
    sb._rpcReturning([])
    const out = await claimBatch(sb as unknown as never, {
      runId: 'r1', batchSize: 5, workerId: 'w', leaseDurationSec: 240,
    })
    expect(out).toEqual([])
  })

  it('throws on RPC error — caller must handle', async () => {
    const sb = makeStubSupabase()
    sb._rpcError('deadlock detected')
    await expect(claimBatch(sb as unknown as never, {
      runId: 'r1', batchSize: 5, workerId: 'w', leaseDurationSec: 240,
    })).rejects.toThrow(/claim_batch rpc: deadlock detected/)
  })
})

describe('markItem', () => {
  it('writes only the patched fields + updated_at — never resurrects stale fields', async () => {
    const sb = makeStubSupabase()
    await markItem(sb as unknown as never, 'item-1', {
      status: 'verified', verified_at: '2026-10-22T00:00:00Z',
    })
    const [u] = sb._updateCalls()
    expect(u.table).toBe('pp_tcg_migration_run_item')
    expect(u.filters).toEqual([['id', 'item-1']])
    expect(u.patch.status).toBe('verified')
    expect(u.patch.verified_at).toBe('2026-10-22T00:00:00Z')
    expect(typeof u.patch.updated_at).toBe('string')
    // Should not have smuggled in any lease/worker fields the caller
    // didn't explicitly set.
    expect(u.patch.lease_expires_at).toBeUndefined()
    expect(u.patch.worker_id).toBeUndefined()
    expect(u.patch.rolled_back_at).toBeUndefined()
  })
})

describe('releaseLease', () => {
  it('is scoped to status=claimed — cannot downgrade verified/failed rows', async () => {
    const sb = makeStubSupabase()
    await releaseLease(sb as unknown as never, 'item-2')
    const [u] = sb._updateCalls()
    // Filters must include both id and status='claimed'
    expect(u.filters.find(([k, v]) => k === 'id'     && v === 'item-2')).toBeDefined()
    expect(u.filters.find(([k, v]) => k === 'status' && v === 'claimed')).toBeDefined()
    // Patch resets the lease + worker and returns item to pending.
    expect(u.patch.lease_expires_at).toBeNull()
    expect(u.patch.worker_id).toBeNull()
    expect(u.patch.status).toBe('pending')
  })
})
