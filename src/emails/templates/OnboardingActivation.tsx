// src/emails/templates/OnboardingActivation.tsx
// Block 3C — branded activation email. Four distinct variants, each
// with its own SmallBadge eyebrow + headline + supporting copy. The
// variants share the visual structure but read as intentionally
// written, not as a mail-merge.
//
// Privacy: we never read or render card names, prices, holding values
// or purchase notes — only the branch letter is exposed to the
// template.

import { Section, Text } from '@react-email/components'
import BaseLayout from '../layouts/BaseLayout'
import PrimaryButton from '../components/PrimaryButton'
import SmallBadge from '../components/SmallBadge'
import InfoBox from '../components/InfoBox'
import { COLORS, FONT_STACK, SPACING } from '../designTokens'
import { emailLink, unsubscribePreferencesLink } from '@/lib/email/onboardingLinks'
import type { ActivationBranch } from '@/lib/email/onboardingActivation'

export const ONBOARDING_ACTIVATION_KEY = 'onboarding_activation'

type Copy = {
  subject:    string
  preheader:  string
  badge:      string
  headline:   string
  body:       ReadonlyArray<string>
  ctaLabel:   string
  ctaUrl:     string
  /** Optional accent box rendered above the CTA, used for variant D's tip. */
  infoBox?:   { text: string; tone: 'primary' | 'accent' }
}

const COPY: Record<ActivationBranch, Copy> = {
  A: {
    subject:   'Save your first card on PokePrices',
    preheader: 'The fastest way to make PokePrices useful is to add one card.',
    badge:     'Start your collection',
    headline:  'Start with one card',
    body: [
      'You signed up a couple of days ago — welcome back. The fastest way to make PokePrices feel useful is to add a single card. Either drop a card you own into your portfolio, or watchlist a card you are weighing up.',
      'You will start seeing weekly price moves, grading premium, and (if it is a chase card) where it sits against your target.',
    ],
    ctaLabel: 'Find a card',
    ctaUrl:   emailLink('browse'),
  },
  B: {
    subject:   'Turn your watchlist into a portfolio',
    preheader: 'Your watchlist is a great signal — add the cards you actually own.',
    badge:     'Build your portfolio',
    headline:  'Add the cards you own',
    body: [
      'Your watchlist is a great signal of what you care about. Adding the cards you actually own gives you a real landed-cost view next to live market price.',
      'You can keep raw, PSA 9 and PSA 10 holdings separate. Grade premium gets calculated automatically.',
    ],
    ctaLabel: 'Add owned cards',
    ctaUrl:   emailLink('portfolio'),
  },
  C: {
    subject:   'Track the cards you are considering',
    preheader: 'Watchlist the cards you are weighing up and track the move.',
    badge:     'Track your next purchase',
    headline:  'Watchlist what you are weighing up',
    body: [
      'Your portfolio is set up — nice work. A watchlist is the other half of the picture. Drop in the cards you are considering and PokePrices tracks the move so you can time the buy.',
      'Watchlist cards do not affect your portfolio totals; they just keep you on top of prices you care about.',
    ],
    ctaLabel: 'Build your watchlist',
    ctaUrl:   emailLink('watchlist'),
  },
  D: {
    subject:   'You are set up — try the deeper tools',
    preheader: "You're set up. Time to try the deeper tools.",
    badge:     'Explore more tools',
    headline:  'You are set up. Try the next layer.',
    body: [
      'Portfolio and watchlist both look healthy. A few corners of PokePrices that experienced collectors lean on:',
    ],
    infoBox: {
      tone: 'primary',
      text: 'Ask the AI assistant a collector question. Run a grading-cost comparison before sending a card in. Check the card-show calendar for the next event near you.',
    },
    ctaLabel: 'Open the AI assistant',
    ctaUrl:   emailLink('ai_assistant'),
  },
}

export function subjectFor(branch: ActivationBranch): string {
  return COPY[branch].subject
}

export function preheaderFor(branch: ActivationBranch): string {
  return COPY[branch].preheader
}

export type OnboardingActivationProps = {
  branch:  ActivationBranch
  replyTo?: string | null
}

export default function OnboardingActivation({ branch, replyTo }: OnboardingActivationProps) {
  const c = COPY[branch]
  return (
    <BaseLayout
      preview={c.preheader}
      eyebrow="Onboarding · 2 of 3"
      preferencesUrl={unsubscribePreferencesLink()}
      replyTo={replyTo ?? null}
    >
      <Section style={{ marginBottom: SPACING.md }}>
        <SmallBadge variant="gold">{c.badge}</SmallBadge>
      </Section>

      <Text style={headlineStyle}>{c.headline}</Text>

      {c.body.map((p, i) => (
        <Text key={i} style={paragraphStyle}>{p}</Text>
      ))}

      {c.infoBox ? <InfoBox tone={c.infoBox.tone}>{c.infoBox.text}</InfoBox> : null}

      <Section style={{ marginTop: SPACING.lg }}>
        <PrimaryButton href={c.ctaUrl}>{c.ctaLabel}</PrimaryButton>
      </Section>

      <Text style={footnote}>
        We send three getting-started tips in your first week, then stop.
      </Text>
    </BaseLayout>
  )
}

const headlineStyle: React.CSSProperties = {
  margin:        `0 0 ${SPACING.md}px`,
  fontFamily:    FONT_STACK,
  fontSize:      22,
  lineHeight:    1.25,
  fontWeight:    800,
  color:         COLORS.text,
  letterSpacing: '-0.01em',
}
const paragraphStyle: React.CSSProperties = {
  margin:     `0 0 ${SPACING.md}px`,
  fontFamily: FONT_STACK,
  fontSize:   15,
  color:      COLORS.text,
  lineHeight: 1.6,
}
const footnote: React.CSSProperties = {
  margin:     `${SPACING.xl}px 0 0`,
  fontFamily: FONT_STACK,
  fontSize:   12,
  color:      COLORS.textMuted,
  lineHeight: 1.6,
}

export function onboardingActivationPlainText({ branch }: OnboardingActivationProps): string {
  const c = COPY[branch]
  return [
    c.badge.toUpperCase(),
    c.headline,
    '',
    ...c.body,
    ...(c.infoBox ? ['', c.infoBox.text] : []),
    '',
    `${c.ctaLabel}: ${c.ctaUrl}`,
    '',
    'We send three getting-started tips in your first week, then stop.',
    `Manage preferences: ${unsubscribePreferencesLink()}`,
  ].join('\n')
}
