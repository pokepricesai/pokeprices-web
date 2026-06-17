// src/emails/layouts/BaseLayout.tsx
// Block 3C redesign — branded shell.
//
// Structure (top → bottom):
//   1. <Head> with light-only colour-scheme + viewport hint.
//   2. <Preview> caller-supplied preheader text (visible in inbox).
//   3. Page background (brand-tinted soft blue).
//   4. Container (max 600px, centred).
//   5. EmailHeader  — gold gradient stripe + logo + wordmark + tagline + optional eyebrow.
//   6. Content card — white surface with brand border + subtle shadow.
//   7. EmailFooter  — identity + preferences + reply-to + affiliate.
//
// Compatibility:
//   * No external fonts; system stack only.
//   * No CSS variables, no stylesheets, no JS, no SVG, no base64 images.
//   * Inline styles + React Email primitives (table-based markup under
//     the hood) for Outlook and Apple Mail.
//   * `color-scheme: light` + `supported-color-schemes: light` opt out
//     of Apple Mail's auto-dark colour inversion.

import {
  Body, Container, Head, Heading, Html, Preview, Section,
} from '@react-email/components'
import type { ReactNode } from 'react'
import EmailHeader from '../components/EmailHeader'
import EmailFooter from '../components/EmailFooter'
import { COLORS, CONTAINER_MAX_WIDTH, FONT_STACK, RADIUS, SPACING } from '../designTokens'

export type BaseLayoutProps = {
  /** Preheader — short summary shown in inbox preview after subject. */
  preview:                 string
  /** Optional eyebrow label above the wordmark (e.g. "Onboarding"). */
  eyebrow?:                string | null
  /** Optional H1 inside the content card. */
  headline?:               string
  children:                ReactNode
  /** Footer preferences link slot. null for transactional. */
  preferencesUrl?:         string | null
  /** Footer reply-to email slot. */
  replyTo?:                string | null
  /** Affiliate disclosure slot. */
  affiliateDisclosure?:    string | null
}

const body: React.CSSProperties = {
  margin:          0,
  padding:         0,
  backgroundColor: COLORS.pageBg,
  fontFamily:      FONT_STACK,
  color:           COLORS.text,
  lineHeight:      1.55,
}

const container: React.CSSProperties = {
  width:           '100%',
  maxWidth:        CONTAINER_MAX_WIDTH,
  margin:          '0 auto',
  padding:         `${SPACING.lg}px ${SPACING.md}px ${SPACING.hero}px`,
}

const card: React.CSSProperties = {
  backgroundColor: COLORS.card,
  borderRadius:    RADIUS.lg,
  border:          `1px solid ${COLORS.cardBorder}`,
  boxShadow:       COLORS.cardShadow,
  padding:         `${SPACING.xxl}px ${SPACING.xl}px`,
}

const headlineStyle: React.CSSProperties = {
  margin:        `0 0 ${SPACING.md}px`,
  fontFamily:    FONT_STACK,
  fontSize:      24,
  lineHeight:    1.25,
  fontWeight:    800,
  color:         COLORS.text,
  letterSpacing: '-0.01em',
}

export default function BaseLayout(props: BaseLayoutProps) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Preview>{props.preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <EmailHeader eyebrow={props.eyebrow ?? null} />

          <Section style={card}>
            {props.headline ? <Heading as="h1" style={headlineStyle}>{props.headline}</Heading> : null}
            {props.children}
          </Section>

          <EmailFooter
            preferencesUrl={props.preferencesUrl ?? null}
            replyTo={props.replyTo ?? null}
            affiliateDisclosure={props.affiliateDisclosure ?? null}
          />
        </Container>
      </Body>
    </Html>
  )
}
