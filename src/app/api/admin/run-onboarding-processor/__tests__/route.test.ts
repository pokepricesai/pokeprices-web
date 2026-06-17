// Block 3D — admin manual-run route.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

let mockAdmin: () => Promise<{ ok: boolean; userId: string; email: string; status: number; error: string }>
vi.mock('@/lib/adminAuth', () => ({
  requireAdmin: (_req: Request) => mockAdmin(),
}))

const runMock = vi.fn()
vi.mock('@/lib/email/onboardingProcessor', () => ({
  runProcessor: (input: unknown) => runMock(input),
}))

import { POST } from '../route'

beforeEach(() => {
  mockAdmin = async () => ({ ok: true, userId: 'u', email: 'a@x', status: 200, error: '' })
  runMock.mockReset()
  runMock.mockResolvedValue({
    status: 'success', runId: 'r-1',
    processed: 1, sent: 1, skipped: 0, retried: 0, cancelled: 0, failed: 0, disabled: false,
  })
})

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/admin/run-onboarding-processor', {
    method: 'POST',
    headers,
  })
}

describe('POST /api/admin/run-onboarding-processor', () => {
  it('rejects non-admins (401 path)', async () => {
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 401, error: 'Missing bearer token' })
    const r = await POST(req())
    expect(r.status).toBe(401)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('rejects authenticated non-admins (403 path)', async () => {
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 403, error: 'Not authorised' })
    const r = await POST(req())
    expect(r.status).toBe(403)
    expect(runMock).not.toHaveBeenCalled()
  })

  it("calls runProcessor with source='manual' on admin success", async () => {
    const r = await POST(req())
    expect(r.status).toBe(200)
    expect(runMock).toHaveBeenCalledWith({ source: 'manual' })
  })

  it('returns only safe counts (no email, user id or secret echoed)', async () => {
    runMock.mockResolvedValueOnce({
      status: 'success', runId: 'r-2',
      processed: 1, sent: 1, skipped: 0, retried: 0, cancelled: 0, failed: 0, disabled: false,
    })
    const res = await POST(req())
    const j = await res.json()
    const blob = JSON.stringify(j)
    expect(blob).not.toMatch(/@/)
    expect(blob).not.toMatch(/Bearer/i)
    expect(j.sent).toBe(1)
  })
})
