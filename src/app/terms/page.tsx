// app/terms/page.tsx
import Link from 'next/link'
import BreadcrumbSchema from '@/components/BreadcrumbSchema'

export const metadata = {
  title: 'Terms of Service — PokePrices',
  description: 'Terms of Service for PokePrices.io',
}

export default function TermsPage() {
  const updated = 'March 2026'

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div style={{ marginBottom: 36 }}>
      <h2 style={{
        fontSize: 17, fontWeight: 800, color: 'var(--text)',
        fontFamily: "'Figtree', sans-serif", margin: '0 0 12px',
        paddingBottom: 8, borderBottom: '1px solid var(--border)',
      }}>{title}</h2>
      <div style={{
        fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.75,
        fontFamily: "'Figtree', sans-serif",
      }}>
        {children}
      </div>
    </div>
  )

  const P = ({ children }: { children: React.ReactNode }) => (
    <p style={{ margin: '0 0 12px' }}>{children}</p>
  )

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px 80px' }}>
      <BreadcrumbSchema items={[{ name: 'Terms of Service' }]} />

      {/* Header */}
      <div style={{ marginBottom: 40 }}>
        <Link href="/" style={{
          fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none',
          fontFamily: "'Figtree', sans-serif", display: 'block', marginBottom: 24,
        }}>
          ← Back to PokePrices
        </Link>
        <h1 style={{
          fontSize: 32, fontWeight: 900, margin: '0 0 8px',
          fontFamily: "'Outfit', sans-serif", color: 'var(--text)',
        }}>
          Terms of Service
        </h1>
        <p style={{
          fontSize: 13, color: 'var(--text-muted)', margin: 0,
          fontFamily: "'Figtree', sans-serif",
        }}>
          Last updated: {updated}
        </p>
      </div>

      {/* Intro */}
      <div style={{
        background: 'rgba(26,95,173,0.05)', border: '1px solid rgba(26,95,173,0.15)',
        borderRadius: 12, padding: '16px 20px', marginBottom: 36,
        fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.7,
        fontFamily: "'Figtree', sans-serif",
      }}>
        By using PokePrices.io you agree to these terms. If you do not agree, please do not use the site. These terms apply to all visitors and users of the platform.
      </div>

      <Section title="1. What PokePrices Is">
        <P>PokePrices.io is a free price intelligence and research tool for the Pokémon Trading Card Game. We aggregate publicly available market data to help collectors understand card values, trends, and grading premiums.</P>
        <P>We are not a marketplace. We do not facilitate transactions. We do not buy or sell cards.</P>
      </Section>

      <Section title="2. Data Sources and Accuracy">
        <P>Price data displayed on PokePrices is sourced from publicly available completed sales listings and historical market data. Some pricing data is sourced via the official eBay Partner Network API under eBay's developer programme terms.</P>
        <P>All prices are provided for informational purposes only. We do not guarantee the accuracy, completeness, or timeliness of any price displayed on the platform. Market conditions change rapidly and past prices are not indicative of future values.</P>
        <P>PokePrices should not be relied upon as the sole basis for any buying, selling, or investment decision. Always conduct your own research before transacting.</P>
      </Section>

      <Section title="3. No Financial or Investment Advice">
        <P>Nothing on PokePrices constitutes financial, investment, or professional advice of any kind. Price trend data, grading analysis, and market commentary are informational only.</P>
        <P>Collecting and trading Pokémon cards carries financial risk. Card values can fall as well as rise. PokePrices accepts no liability for any losses incurred as a result of decisions made using information from this platform.</P>
      </Section>

      <Section title="4. Affiliate Links">
        <P>PokePrices may display links to third-party marketplaces including eBay. Some of these links are affiliate links — if you make a purchase through one of these links, we may receive a small commission at no additional cost to you.</P>
        <P>Affiliate links are how we keep the platform free. We do not promote specific listings, sellers, or products in exchange for payment. Our data and editorial content are independent of any affiliate relationship.</P>
      </Section>

      <Section title="5. Intellectual Property">
        <P>Pokémon and all related names, characters, and imagery are trademarks of Nintendo, Game Freak, and The Pokémon Company. PokePrices is an independent fan-built tool and is not affiliated with, endorsed by, or connected to Nintendo, Game Freak, or The Pokémon Company in any way.</P>
        <P>Card images displayed on PokePrices are used for identification and reference purposes only under fair use principles. If you are a rights holder and have a concern, please contact us.</P>
        <P>The PokePrices platform, codebase, data pipeline, and original written content are the property of PokePrices. You may not scrape, reproduce, or redistribute our derived data or platform content without permission.</P>
      </Section>

      <Section title="6. Privacy and Data Collection">
        <P>PokePrices does not require registration or login. We do not collect personal information, email addresses, or payment details from visitors.</P>
        <P>We use anonymous analytics to understand how the platform is used (e.g. which pages are visited). This data is not linked to any individual and is used solely to improve the product. We do not sell or share any data with third parties for marketing purposes.</P>
      </Section>

      <Section title="7. AI-Powered Features">
        <P>PokePrices includes an AI chat assistant powered by third-party AI services. The assistant is designed to help with Pokémon TCG research questions. It may occasionally produce inaccurate or incomplete responses — always verify important information independently.</P>
        <P>Do not submit sensitive personal information through the chat interface.</P>
      </Section>

      <Section title="8. Acceptable Use">
        <P>You agree not to use PokePrices in any way that is unlawful, harmful, or disruptive. You may not attempt to scrape, crawl, or systematically extract data from the platform using automated tools. You may not attempt to reverse-engineer, overload, or interfere with the platform's infrastructure.</P>
        <P>Personal, non-commercial use of price data displayed on the platform (e.g. noting a card's value for your own reference) is permitted.</P>
      </Section>

      <Section title="9. Disclaimer of Warranties">
        <P>PokePrices is provided "as is" without warranties of any kind, express or implied. We do not warrant that the platform will be error-free, uninterrupted, or that data will always be current or accurate.</P>
        <P>We reserve the right to modify, suspend, or discontinue any part of the platform at any time without notice.</P>
      </Section>

      <Section title="10. Limitation of Liability">
        <P>To the fullest extent permitted by law, PokePrices and its operators shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the platform or reliance on any information displayed on it.</P>
      </Section>

      <Section title="11. Changes to These Terms">
        <P>We may update these terms from time to time. Continued use of PokePrices after changes are posted constitutes acceptance of the revised terms. The date at the top of this page reflects the most recent update.</P>
      </Section>

      <Section title="12. Contact">
        <P>If you have questions about these terms, or a concern about content on the platform, you can reach us via the feedback link on the site.</P>
      </Section>

      {/* Footer nav */}
      <div style={{
        borderTop: '1px solid var(--border)', paddingTop: 24, marginTop: 8,
        display: 'flex', gap: 20, flexWrap: 'wrap',
      }}>
        {[
          { href: '/', label: 'Home' },
          { href: '/browse', label: 'Browse Sets' },
          { href: '/insights', label: 'Insights' },
        ].map(l => (
          <Link key={l.href} href={l.href} style={{
            fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none',
            fontFamily: "'Figtree', sans-serif",
          }}>
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
