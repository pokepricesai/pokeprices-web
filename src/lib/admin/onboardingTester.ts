// src/lib/admin/onboardingTester.ts
// Pure helpers for the admin onboarding-email testing panel rendered
// in /admin/content-studio. Lives outside the React component so the
// contract (allow-list, URL shape, request body shape) can be unit-
// tested without spinning up jsdom.
//
// Block 3B operator-UX addition.

export const ONBOARDING_TEMPLATE_OPTIONS = [
  { key: 'onboarding_welcome',    label: 'Welcome email' },
  { key: 'onboarding_activation', label: 'Activation email' },
  { key: 'onboarding_discovery',  label: 'Discovery email' },
] as const

export type OnboardingTemplateKey = (typeof ONBOARDING_TEMPLATE_OPTIONS)[number]['key']

export const ACTIVATION_BRANCH_OPTIONS = [
  { branch: 'A' as const, label: 'A — No portfolio and no watchlist' },
  { branch: 'B' as const, label: 'B — Watchlist exists, portfolio empty' },
  { branch: 'C' as const, label: 'C — Portfolio exists, watchlist empty' },
  { branch: 'D' as const, label: 'D — Portfolio and watchlist both exist' },
] as const

export type ActivationBranch = (typeof ACTIVATION_BRANCH_OPTIONS)[number]['branch']

/**
 * Only the activation email carries a branch. Welcome and discovery
 * templates ignore it server-side, but we also drop it client-side so
 * the audit trail is unambiguous.
 */
export function requiresBranch(template: OnboardingTemplateKey): boolean {
  return template === 'onboarding_activation'
}

/**
 * Builds the admin preview URL. Internal, no query strings beyond
 * template + (optional) branch. The preview route enforces admin auth;
 * this helper does not include any auth state.
 */
export function buildPreviewUrl(input: {
  template: OnboardingTemplateKey
  branch?:  ActivationBranch
}): string {
  const params = new URLSearchParams()
  params.set('template', input.template)
  if (requiresBranch(input.template) && input.branch) {
    params.set('branch', input.branch)
  }
  return `/api/admin/email-preview?${params.toString()}`
}

/**
 * Builds the POST body for /api/admin/email-send-test. The browser
 * MUST NOT be able to supply a recipient, subject, html or any other
 * field — only the template key + (optional) branch. The server route
 * keeps the recipient locked to EMAIL_TEST_RECIPIENT and prefixes
 * "[TEST] " on the subject.
 */
export type SendTestBody = {
  template: OnboardingTemplateKey
  branch?:  ActivationBranch
}

export function buildSendBody(input: {
  template: OnboardingTemplateKey
  branch?:  ActivationBranch
}): SendTestBody {
  const body: SendTestBody = { template: input.template }
  if (requiresBranch(input.template) && input.branch) {
    body.branch = input.branch
  }
  return body
}

/**
 * The URL the panel POSTs to. Exposed for tests so we can prove the
 * panel never touches the processor route or any state-mutating
 * endpoint.
 */
export const SEND_TEST_URL = '/api/admin/email-send-test'

/**
 * Forbidden field names a future maintainer must never add to the
 * request body. Tests assert these are absent from every body the
 * panel emits.
 */
export const FORBIDDEN_BODY_FIELDS: ReadonlyArray<string> = [
  'to', 'recipient', 'recipients', 'email', 'address',
  'subject', 'html', 'text',
  'bcc', 'cc', 'reply_to', 'replyTo',
  'category', 'campaign',
] as const

// ─────────────────────────────────────────────────────────────────────
// Status summarisation — pure, lets tests drive UI states without DOM
// ─────────────────────────────────────────────────────────────────────

export type SendStatus =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'success'; emailId: string | null }
  | { kind: 'error';   message: string }

export type SendResponseShape = {
  success?: unknown
  emailId?: unknown
  error?:   unknown
}

/**
 * Maps a fetch result into a UI status. Used by the React component
 * and by the unit tests. Never echoes back a secret value — the
 * server is already responsible for not leaking the API key in
 * `error`, but we additionally cap the message at a safe length and
 * fall back to generic copy when the server returned no body.
 */
export function summariseSendResult(input: {
  ok:     boolean
  status: number
  data:   SendResponseShape | null
}): SendStatus {
  if (input.ok && input.data?.success === true) {
    const id = typeof input.data.emailId === 'string' ? input.data.emailId : null
    return { kind: 'success', emailId: id }
  }
  // Failure paths.
  const fromBody = typeof input.data?.error === 'string' ? input.data.error : ''
  const msg = fromBody.trim().length > 0
    ? fromBody.trim().slice(0, 120)
    : `Failed to send test email (HTTP ${input.status})`
  return { kind: 'error', message: msg }
}

export function statusToVisibleText(status: SendStatus): string {
  switch (status.kind) {
    case 'idle':    return ''
    case 'sending': return 'Sending…'
    case 'success': return status.emailId
      ? `Test email sent. ID ${status.emailId}`
      : 'Test email sent.'
    case 'error':   return status.message
  }
}

export const SAFETY_TEXT =
  'Test emails are sent only to the server-configured EMAIL_TEST_RECIPIENT. ' +
  'Testing does not enrol users or change onboarding progress.'
