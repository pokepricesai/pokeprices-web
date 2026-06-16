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
import OnboardingWelcome, {
  ONBOARDING_WELCOME_KEY, ONBOARDING_WELCOME_SUBJECT, onboardingWelcomePlainText,
} from './templates/OnboardingWelcome'
import OnboardingActivation, {
  ONBOARDING_ACTIVATION_KEY, subjectFor as onboardingActivationSubject,
  onboardingActivationPlainText,
} from './templates/OnboardingActivation'
import OnboardingDiscovery, {
  ONBOARDING_DISCOVERY_KEY, ONBOARDING_DISCOVERY_SUBJECT, onboardingDiscoveryPlainText,
} from './templates/OnboardingDiscovery'

// Re-export the template key constants so route handlers can reference
// a single canonical source.
export {
  DELIVERY_TEST_KEY,
  TRANSACTIONAL_TEST_KEY,
  MARKETING_PREVIEW_KEY,
  ONBOARDING_WELCOME_KEY,
  ONBOARDING_ACTIVATION_KEY,
  ONBOARDING_DISCOVERY_KEY,
}
import type { EmailCategory } from '@/lib/email/categories'
import { EMAIL_CATEGORIES } from '@/lib/email/categories'
import type { ActivationBranch } from '@/lib/email/onboardingActivation'

export type TemplateKey =
  | typeof DELIVERY_TEST_KEY
  | typeof TRANSACTIONAL_TEST_KEY
  | typeof MARKETING_PREVIEW_KEY
  | typeof ONBOARDING_WELCOME_KEY
  | typeof ONBOARDING_ACTIVATION_KEY
  | typeof ONBOARDING_DISCOVERY_KEY

export const TEMPLATE_KEYS: ReadonlyArray<TemplateKey> = [
  DELIVERY_TEST_KEY,
  TRANSACTIONAL_TEST_KEY,
  MARKETING_PREVIEW_KEY,
  ONBOARDING_WELCOME_KEY,
  ONBOARDING_ACTIVATION_KEY,
  ONBOARDING_DISCOVERY_KEY,
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
  key:               TemplateKey
  // The preview route may pass through harmless context; the send
  // service injects real values. Unknown props are ignored.
  preferencesUrl?:   string | null
  displayName?:      string | null
  vercelEnv?:        string
  timestamp?:        string
  /** Required by the onboarding_activation template; ignored otherwise. */
  activationBranch?: ActivationBranch
  /** When true, the admin send-test route prefixes "[TEST] " on the subject. */
  testPrefix?:       boolean
}): Promise<RenderedEmail> {
  switch (input.key) {
    case DELIVERY_TEST_KEY: {
      const props = {
        timestamp:  input.timestamp ?? new Date().toISOString(),
        vercelEnv:  input.vercelEnv ?? readVercelEnv(),
      }
      const html = await render(createElement(DeliveryTest, props))
      return ok(input, DELIVERY_TEST_SUBJECT, html, deliveryTestPlainText(props), EMAIL_CATEGORIES.TRANSACTIONAL)
    }
    case TRANSACTIONAL_TEST_KEY: {
      const props = { displayName: input.displayName ?? null }
      const html = await render(createElement(TransactionalTest, props))
      return ok(input, TRANSACTIONAL_TEST_SUBJECT, html, transactionalTestPlainText(props), EMAIL_CATEGORIES.SERVICE_PRODUCT)
    }
    case MARKETING_PREVIEW_KEY: {
      const props = { preferencesUrl: input.preferencesUrl ?? null }
      const html = await render(createElement(MarketingPreview, props))
      return ok(input, MARKETING_PREVIEW_SUBJECT, html, marketingPreviewPlainText(props), EMAIL_CATEGORIES.MARKETING_NEWSLETTER)
    }
    case ONBOARDING_WELCOME_KEY: {
      const props = {}
      const html = await render(createElement(OnboardingWelcome, props))
      return ok(input, ONBOARDING_WELCOME_SUBJECT, html, onboardingWelcomePlainText(props), EMAIL_CATEGORIES.ONBOARDING)
    }
    case ONBOARDING_ACTIVATION_KEY: {
      const branch: ActivationBranch = input.activationBranch ?? 'A'
      const props = { branch }
      const html = await render(createElement(OnboardingActivation, props))
      return ok(input, onboardingActivationSubject(branch), html, onboardingActivationPlainText(props), EMAIL_CATEGORIES.ONBOARDING)
    }
    case ONBOARDING_DISCOVERY_KEY: {
      const props = {}
      const html = await render(createElement(OnboardingDiscovery, props))
      return ok(input, ONBOARDING_DISCOVERY_SUBJECT, html, onboardingDiscoveryPlainText(props), EMAIL_CATEGORIES.ONBOARDING)
    }
    default: {
      // Defensive — the type guard above narrows callers, but in case
      // a future key is added without a switch arm we fail closed.
      throw new Error('renderTemplate: unknown key')
    }
  }
}

function ok(
  input:    { testPrefix?: boolean },
  subject:  string,
  html:     string,
  text:     string,
  category: EmailCategory,
): RenderedEmail {
  return {
    subject:  input.testPrefix ? `[TEST] ${subject}` : subject,
    html,
    text,
    category,
  }
}

function readVercelEnv(): string {
  const v = (process.env.VERCEL_ENV ?? '').trim()
  return v.length > 0 ? v : 'unknown'
}
