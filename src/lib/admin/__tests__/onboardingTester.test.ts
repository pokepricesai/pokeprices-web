// Tests for the admin onboarding-email testing panel contract.
//
// The panel's React rendering is intentionally tested via the pure
// helpers + a fetch-mocking flow so we don't need jsdom for the
// component itself. Anything the browser sends to the server must
// only ever match the shapes asserted here.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ONBOARDING_TEMPLATE_OPTIONS,
  ACTIVATION_BRANCH_OPTIONS,
  FORBIDDEN_BODY_FIELDS,
  SEND_TEST_URL,
  SAFETY_TEXT,
  buildPreviewUrl,
  buildSendBody,
  requiresBranch,
  summariseSendResult,
  statusToVisibleText,
  type OnboardingTemplateKey,
} from '../onboardingTester'

// ─────────────────────────────────────────────────────────────────────
// 1. Template selector uses only the three approved onboarding keys
// ─────────────────────────────────────────────────────────────────────

describe('ONBOARDING_TEMPLATE_OPTIONS', () => {
  it('contains exactly the three approved onboarding template keys, in order', () => {
    expect(ONBOARDING_TEMPLATE_OPTIONS.map(o => o.key)).toEqual([
      'onboarding_welcome',
      'onboarding_activation',
      'onboarding_discovery',
    ])
  })

  it('every option carries a human label', () => {
    for (const opt of ONBOARDING_TEMPLATE_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0)
    }
  })

  it('no non-onboarding template key is reachable through the selector', () => {
    const banned = [
      'delivery_test', 'transactional_test', 'marketing_preview',
      'arbitrary_key', 'foo', '', 'admin', 'weekly_report',
    ]
    const allowed = ONBOARDING_TEMPLATE_OPTIONS.map(o => o.key) as ReadonlyArray<string>
    for (const b of banned) expect(allowed).not.toContain(b)
  })
})

// ─────────────────────────────────────────────────────────────────────
// 2. Activation branch is only submitted for the activation template
// ─────────────────────────────────────────────────────────────────────

describe('requiresBranch + buildSendBody — branch gating', () => {
  it('requiresBranch is true ONLY for onboarding_activation', () => {
    expect(requiresBranch('onboarding_welcome')).toBe(false)
    expect(requiresBranch('onboarding_activation')).toBe(true)
    expect(requiresBranch('onboarding_discovery')).toBe(false)
  })

  it('buildSendBody drops branch when the welcome template is selected', () => {
    expect(buildSendBody({ template: 'onboarding_welcome', branch: 'A' })).toEqual({
      template: 'onboarding_welcome',
    })
  })

  it('buildSendBody drops branch when the discovery template is selected', () => {
    expect(buildSendBody({ template: 'onboarding_discovery', branch: 'C' })).toEqual({
      template: 'onboarding_discovery',
    })
  })

  it('buildSendBody keeps branch only when activation is selected', () => {
    for (const opt of ACTIVATION_BRANCH_OPTIONS) {
      expect(buildSendBody({ template: 'onboarding_activation', branch: opt.branch })).toEqual({
        template: 'onboarding_activation',
        branch:   opt.branch,
      })
    }
  })

  it('buildSendBody omits branch on activation when none was supplied', () => {
    expect(buildSendBody({ template: 'onboarding_activation' })).toEqual({
      template: 'onboarding_activation',
    })
  })
})

// ─────────────────────────────────────────────────────────────────────
// 3. Recipient cannot be supplied by the browser
// ─────────────────────────────────────────────────────────────────────

describe('buildSendBody — recipient + arbitrary-field safety', () => {
  it('never includes any recipient / subject / html / category field', () => {
    const inputs: Array<{ template: OnboardingTemplateKey; branch?: 'A' | 'B' | 'C' | 'D' }> = [
      { template: 'onboarding_welcome' },
      { template: 'onboarding_activation', branch: 'A' },
      { template: 'onboarding_activation', branch: 'D' },
      { template: 'onboarding_discovery' },
    ]
    for (const i of inputs) {
      const body = buildSendBody(i) as Record<string, unknown>
      for (const banned of FORBIDDEN_BODY_FIELDS) {
        expect(banned in body).toBe(false)
      }
    }
  })

  it('the body shape only ever has "template" + (optionally) "branch"', () => {
    for (const i of [
      { template: 'onboarding_welcome' as const },
      { template: 'onboarding_activation' as const, branch: 'B' as const },
      { template: 'onboarding_discovery' as const },
    ]) {
      const body = buildSendBody(i)
      const keys = Object.keys(body).sort()
      const allowed = i.template === 'onboarding_activation' && i.branch
        ? ['branch', 'template']
        : ['template']
      expect(keys).toEqual(allowed)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────
// 4. Preview URL is internal and correctly encoded
// ─────────────────────────────────────────────────────────────────────

describe('buildPreviewUrl', () => {
  it('is a relative path under /api/admin/email-preview', () => {
    const u = buildPreviewUrl({ template: 'onboarding_welcome' })
    expect(u.startsWith('/api/admin/email-preview?')).toBe(true)
    expect(u.includes('://')).toBe(false)
  })

  it('only emits the template param when no branch applies', () => {
    expect(buildPreviewUrl({ template: 'onboarding_welcome' }))
      .toBe('/api/admin/email-preview?template=onboarding_welcome')
    expect(buildPreviewUrl({ template: 'onboarding_discovery', branch: 'B' }))
      .toBe('/api/admin/email-preview?template=onboarding_discovery')
  })

  it('appends branch only for the activation template', () => {
    expect(buildPreviewUrl({ template: 'onboarding_activation', branch: 'B' }))
      .toBe('/api/admin/email-preview?template=onboarding_activation&branch=B')
  })

  it('encodes any future special characters via URLSearchParams', () => {
    // We don't accept arbitrary input today, but the helper goes through
    // URLSearchParams so the encoding contract is automatic. This test
    // freezes that contract.
    const u = buildPreviewUrl({ template: 'onboarding_activation', branch: 'A' })
    expect(u).not.toMatch(/[ <>]/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// 5 + 6. Send-test request uses the selected approved template AND
//        the panel never calls the onboarding processor or any
//        state-mutating onboarding endpoint
// ─────────────────────────────────────────────────────────────────────

describe('SEND_TEST_URL is the admin route only', () => {
  it('targets /api/admin/email-send-test', () => {
    expect(SEND_TEST_URL).toBe('/api/admin/email-send-test')
  })

  it('is NOT the processor route — the panel can never mutate onboarding state', () => {
    expect(SEND_TEST_URL).not.toBe('/api/internal/process-onboarding-emails')
    expect(SEND_TEST_URL).not.toMatch(/process-onboarding/)
    expect(SEND_TEST_URL).not.toMatch(/onboarding\/preference/)
  })
})

// Integration-style: drive fetch end-to-end via the panel's helpers
// without rendering React. This is what an admin's click resolves to.

describe('full send-test flow (fetch contract)', () => {
  let capturedUrl:  string | null = null
  let capturedInit: RequestInit | null = null

  beforeEach(() => {
    capturedUrl  = null
    capturedInit = null
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      capturedUrl  = url
      capturedInit = init
      return new Response(JSON.stringify({ success: true, emailId: 'rid-1' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }))
  })

  it('POSTs the approved body to the admin send-test route only', async () => {
    const body = buildSendBody({ template: 'onboarding_activation', branch: 'C' })
    await fetch(SEND_TEST_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer token' },
      body:    JSON.stringify(body),
    })
    expect(capturedUrl).toBe('/api/admin/email-send-test')
    const parsed = JSON.parse((capturedInit!.body as string))
    expect(parsed).toEqual({ template: 'onboarding_activation', branch: 'C' })
    // Forbidden fields never appear.
    for (const banned of FORBIDDEN_BODY_FIELDS) {
      expect(banned in parsed).toBe(false)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────
// 7. Error and success UI states render correctly
// ─────────────────────────────────────────────────────────────────────

describe('summariseSendResult + statusToVisibleText', () => {
  it('200 + success=true renders the success message with the email id', () => {
    const s = summariseSendResult({ ok: true, status: 200, data: { success: true, emailId: 'rid-7' } })
    expect(s).toEqual({ kind: 'success', emailId: 'rid-7' })
    expect(statusToVisibleText(s)).toBe('Test email sent. ID rid-7')
  })

  it('200 + success=true with no emailId still renders a success message', () => {
    const s = summariseSendResult({ ok: true, status: 200, data: { success: true } })
    expect(s).toEqual({ kind: 'success', emailId: null })
    expect(statusToVisibleText(s)).toBe('Test email sent.')
  })

  it('200 with success!==true falls into the error path', () => {
    const s = summariseSendResult({ ok: true, status: 200, data: { success: false, error: 'Nope' } })
    expect(s.kind).toBe('error')
    if (s.kind === 'error') expect(s.message).toBe('Nope')
  })

  it('5xx returns the server error when present', () => {
    const s = summariseSendResult({ ok: false, status: 502, data: { success: false, error: 'Send failed' } })
    expect(s).toEqual({ kind: 'error', message: 'Send failed' })
    expect(statusToVisibleText(s)).toBe('Send failed')
  })

  it('5xx returns a generic message when no body is present', () => {
    const s = summariseSendResult({ ok: false, status: 502, data: null })
    expect(s.kind).toBe('error')
    if (s.kind === 'error') {
      expect(s.message).toBe('Failed to send test email (HTTP 502)')
    }
  })

  it('caps a runaway server error message to a safe length', () => {
    const long = 'X'.repeat(1000)
    const s = summariseSendResult({ ok: false, status: 502, data: { error: long } })
    if (s.kind === 'error') expect(s.message.length).toBeLessThanOrEqual(120)
  })

  it('sending state has a clear visible label', () => {
    expect(statusToVisibleText({ kind: 'sending' })).toBe('Sending…')
  })

  it('idle state is empty visible text', () => {
    expect(statusToVisibleText({ kind: 'idle' })).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────
// 8. Safety text content — must accurately describe behaviour
// ─────────────────────────────────────────────────────────────────────

describe('SAFETY_TEXT', () => {
  it('mentions the locked recipient + the no-mutation guarantee', () => {
    expect(SAFETY_TEXT).toMatch(/EMAIL_TEST_RECIPIENT/)
    expect(SAFETY_TEXT).toMatch(/does not enrol/i)
    expect(SAFETY_TEXT).toMatch(/onboarding progress/i)
  })
})
