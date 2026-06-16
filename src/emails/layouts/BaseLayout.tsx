// src/emails/layouts/BaseLayout.tsx
// Reusable base layout for every PokePrices email template.
//
// Design constraints:
//   * No external font dependencies — system stack only.
//   * Mobile-friendly (max-width 600 with fluid behaviour beneath).
//   * Useful without images (we ship a text wordmark, not a hosted PNG).
//   * High-contrast palette suited to dark + light client themes.
//   * Plain-text fallback rendered separately by render.ts.

import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Hr, Link,
} from '@react-email/components'
import type { ReactNode } from 'react'

export type BaseLayoutProps = {
  preview:                 string
  headline?:               string
  children:                ReactNode
  /**
   * Footer slot for the preferences / unsubscribe link. The send
   * service injects the correct URL per category — pass null when the
   * category should not carry one (transactional).
   */
  preferencesUrl?:         string | null
  /**
   * Affiliate disclosure slot. Most templates leave this null today;
   * future affiliate-bearing emails fill it in.
   */
  affiliateDisclosure?:    string | null
}

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

const body: React.CSSProperties = {
  margin:           0,
  padding:          0,
  backgroundColor:  '#f6f7fb',
  fontFamily:       FONT_STACK,
  color:            '#0f172a',
  lineHeight:       1.55,
}

const container: React.CSSProperties = {
  width:           '100%',
  maxWidth:        600,
  margin:          '0 auto',
  padding:         '24px 16px 32px',
}

const card: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius:    14,
  border:          '1px solid #e6e8ef',
  padding:         '28px 24px',
}

const wordmark: React.CSSProperties = {
  display:         'inline-block',
  fontWeight:      800,
  fontSize:        18,
  letterSpacing:   '-0.01em',
  color:           '#1a5fad',
  textDecoration:  'none',
}

const headlineStyle: React.CSSProperties = {
  fontSize:        22,
  lineHeight:      1.3,
  fontWeight:      700,
  margin:          '20px 0 12px',
  color:           '#0f172a',
}

const footer: React.CSSProperties = {
  marginTop:       18,
  fontSize:        12,
  color:           '#475569',
  lineHeight:      1.6,
  textAlign:       'center',
}

const footerLink: React.CSSProperties = {
  color: '#1a5fad',
  textDecoration: 'underline',
}

export default function BaseLayout(props: BaseLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{props.preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={{ paddingBottom: 8 }}>
            <Text style={{ margin: 0 }}>
              <Link href="https://www.pokeprices.io" style={wordmark}>PokePrices</Link>
            </Text>
            <Text style={{ margin: '2px 0 0', fontSize: 11, color: '#64748b' }}>
              Pokémon TCG price intelligence for collectors
            </Text>
          </Section>

          <Section style={card}>
            {props.headline ? <Heading style={headlineStyle}>{props.headline}</Heading> : null}
            {props.children}
          </Section>

          <Section style={footer}>
            <Text style={{ margin: 0 }}>
              You are receiving this from PokePrices.io.
            </Text>
            <Text style={{ margin: '4px 0 0' }}>
              <Link href="https://www.pokeprices.io" style={footerLink}>www.pokeprices.io</Link>
              {props.preferencesUrl ? (
                <>
                  {' · '}
                  <Link href={props.preferencesUrl} style={footerLink}>Email preferences</Link>
                </>
              ) : null}
            </Text>
            {props.affiliateDisclosure ? (
              <>
                <Hr style={{ margin: '14px 0', borderColor: '#e6e8ef' }} />
                <Text style={{ margin: 0, fontSize: 11, color: '#64748b' }}>
                  {props.affiliateDisclosure}
                </Text>
              </>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
