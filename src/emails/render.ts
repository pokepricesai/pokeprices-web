// src/emails/render.ts
// Server-only render harness. Returns { subject, html, text } for each
// approved template key. The admin preview + send-test routes pick a
// template by key — they never accept raw HTML or arbitrary props from
// the browser.

import 'server-only'
import { render } from '@react-email/render'
import { createElement } from 'react'

import DeliveryTest, {
  DELIVERY_TEST_KEY,     DELIVERY_TEST_SUBJECT, deliveryTestPlainText,
} from './templates/DeliveryTest'
import TransactionalTest, {
  TRANSACTIONAL_TEST_KEY, TRANSACTIONAL_TEST_SUBJECT, transactionalTestPlainText,
} from './templates/TransactionalTest'
import MarketingPreview, {
  MARKETING_PREVIEW_KEY, MARKETING_PREVIEW_SUBJECT, marketingPreviewPlainText,
} from './templates/MarketingPreview'

// Re-export the template key constants so route handlers can reference
// a single canonical source.
export { DELIVERY_TEST_KEY, TRANSACTIONAL_TEST_KEY, MARKETING_PREVIEW_KEY }
import type { EmailCategory } from '@/lib/email/categories'
import { EMAIL_CATEGORIES } from '@/lib/email/categories'

export type TemplateKey =
  | typeof DELIVERY_TEST_KEY
  | typeof TRANSACTIONAL_TEST_KEY
  | typeof MARKETING_PREVIEW_KEY

export const TEMPLATE_KEYS: ReadonlyArray<TemplateKey> = [
  DELIVERY_TEST_KEY,
  TRANSACTIONAL_TEST_KEY,
  MARKETING_PREVIEW_KEY,
]

export type RenderedEmail = {
  subject:  string
  html:     string
  text:     string
  category: EmailCategory
}

export function isApprovedTemplateKey(raw: unknown): raw is TemplateKey {
  return typeof raw === 'string' && (TEMPLATE_KEYS as ReadonlyArray<string>).includes(raw)
}

export async function renderTemplate(input: {
  key:            TemplateKey
  // The preview route may pass through harmless context; the send
  // service injects real values. Unknown props are ignored.
  preferencesUrl?: string | null
  displayName?:    string | null
  vercelEnv?:      string
  timestamp?:      string
}): Promise<RenderedEmail> {
  switch (input.key) {
    case DELIVERY_TEST_KEY: {
      const props = {
        timestamp:  input.timestamp ?? new Date().toISOString(),
        vercelEnv:  input.vercelEnv ?? readVercelEnv(),
      }
      const html = await render(createElement(DeliveryTest, props))
      return {
        subject: DELIVERY_TEST_SUBJECT,
        html,
        text:    deliveryTestPlainText(props),
        category: EMAIL_CATEGORIES.TRANSACTIONAL,
      }
    }
    case TRANSACTIONAL_TEST_KEY: {
      const props = { displayName: input.displayName ?? null }
      const html = await render(createElement(TransactionalTest, props))
      return {
        subject: TRANSACTIONAL_TEST_SUBJECT,
        html,
        text:    transactionalTestPlainText(props),
        category: EMAIL_CATEGORIES.SERVICE_PRODUCT,
      }
    }
    case MARKETING_PREVIEW_KEY: {
      const props = { preferencesUrl: input.preferencesUrl ?? null }
      const html = await render(createElement(MarketingPreview, props))
      return {
        subject: MARKETING_PREVIEW_SUBJECT,
        html,
        text:    marketingPreviewPlainText(props),
        category: EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
      }
    }
    default: {
      // Defensive — the type guard above narrows callers, but in case
      // a future key is added without a switch arm we fail closed.
      throw new Error('renderTemplate: unknown key')
    }
  }
}

function readVercelEnv(): string {
  const v = (process.env.VERCEL_ENV ?? '').trim()
  return v.length > 0 ? v : 'unknown'
}
