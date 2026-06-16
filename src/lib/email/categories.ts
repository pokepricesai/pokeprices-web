// src/lib/email/categories.ts
// Block 3A — single source of truth for the email category taxonomy.
//
// Categories must stay in sync with the CHECK constraint defined in
// migrations/2026-06-15-email-infrastructure.sql (email_consents.category).

export const EMAIL_CATEGORIES = {
  TRANSACTIONAL:        'transactional',
  SERVICE_PRODUCT:      'service_product',
  MARKETING_NEWSLETTER: 'marketing_newsletter',
  WATCHLIST_ALERT:      'watchlist_alert',
  CARD_SHOW_REMINDER:   'card_show_reminder',
  WEEKLY_REPORT:        'weekly_report',
  ONBOARDING:           'onboarding',
} as const

export type EmailCategory = (typeof EMAIL_CATEGORIES)[keyof typeof EMAIL_CATEGORIES]

export const ALL_EMAIL_CATEGORIES: ReadonlyArray<EmailCategory> = Object.values(EMAIL_CATEGORIES)

/**
 * Transactional / auth email is the category used for account-critical
 * messages such as password resets, sign-in links and security
 * notices. Typically those are routed through Supabase Auth's own
 * SMTP rather than this service (see docs/email-infrastructure.md);
 * this category is reserved here for application-side service notices
 * that have transactional semantics.
 *
 * Important: transactional is NOT a free pass through every kind of
 * suppression. The four terminal reasons — hard_bounce, complaint,
 * invalid_address, admin_suppression — block every category including
 * transactional. See src/lib/email/suppressions.ts for the precedence.
 */
export function isTransactional(category: EmailCategory): boolean {
  return category === EMAIL_CATEGORIES.TRANSACTIONAL
}

/**
 * Marketing category. Used for the legal `List-Unsubscribe` header
 * decision: marketing/newsletter MUST carry one-click unsubscribe;
 * auth/transactional MUST NOT.
 */
export function isMarketing(category: EmailCategory): boolean {
  return category === EMAIL_CATEGORIES.MARKETING_NEWSLETTER
}

export function isValidEmailCategory(raw: unknown): raw is EmailCategory {
  return typeof raw === 'string'
    && (ALL_EMAIL_CATEGORIES as ReadonlyArray<string>).includes(raw)
}
