import Link from 'next/link'
import NewsletterSignup from '@/components/NewsletterSignup'

const topSets = [
  'Base Set',
  'Fossil',
  'Team Rocket',
  'Hidden Fates',
  'Crown Zenith',
  'Evolving Skies',
  'Ascended Heroes',
  'Destined Rivals',
]

// Block 5A-W-40A — top-level nav restructured to Cards / Sets /
// Pokémon / Market / Tools / Insights / Ask AI. Community group +
// Games moved out of the top nav and into the footer's own column
// so they stay discoverable.
const exploreLinks = [
  { label: 'Cards',    href: '/browse'       },
  { label: 'Sets',     href: '/browse#sets'  },
  { label: 'Pokémon',  href: '/pokemon'      },
  { label: 'Insights', href: '/insights'     },
  { label: 'Tools',    href: '/tools'        },
  { label: 'Ask AI',   href: '/ai-assistant' },
]

const communityLinks = [
  { label: 'Content Creators',    href: '/creators'         },
  { label: 'Vendors & Dealers',   href: '/vendors'          },
  { label: 'Upcoming Card Shows', href: '/card-shows'       },
  { label: 'Submit a Listing',    href: '/creators/submit'  },
  { label: 'Games',               href: '/games'            },
]

const companyLinks = [
  { label: 'Features & Roadmap', href: '/roadmap' },
  { label: 'Contact',            href: '/contact' },
  { label: 'Privacy',            href: '/privacy' },
  { label: 'Terms',              href: '/terms'   },
]

export default function Footer() {
  return (
    <footer style={{
      background: 'linear-gradient(135deg, #1a5fad, #2874c8)',
      padding: '40px 24px 24px',
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Top row: brand + three columns */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 32,
          marginBottom: 32,
        }}>
          {/* Brand column */}
          <div>
            <img src="/logo.png" alt="PokePrices" style={{ height: 34, marginBottom: 12 }} />
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 1.55, margin: 0, maxWidth: 240 }}>
              The numbers behind every Pokémon card. Built by collectors, for collectors.
            </p>
          </div>

          <FooterColumn title="Explore"   links={exploreLinks}   />
          <FooterColumn title="Community" links={communityLinks} />
          <FooterColumn title="Company"   links={companyLinks}   />

          {/* Stay connected */}
          <div>
            <p style={{
              color: 'rgba(255,255,255,0.4)', fontSize: 11, marginBottom: 12,
              textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700,
            }}>Stay connected</p>
            <p style={{
              color: 'rgba(255,255,255,0.55)', fontSize: 12, margin: '0 0 10px', lineHeight: 1.5,
            }}>
              Monthly collector digest — market moves, grading tips and set previews.
            </p>
            <NewsletterSignup source="footer" dark />
            <a
              href="https://x.com/PokePricesIO"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: 'rgba(255,255,255,0.55)', textDecoration: 'none', fontSize: 12,
                fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
              @PokePricesIO
            </a>
          </div>
        </div>

        {/* Popular sets */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 20, marginBottom: 18 }}>
          <p style={{
            color: 'rgba(255,255,255,0.35)', fontSize: 11, marginBottom: 10,
            textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700,
          }}>Popular sets</p>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {topSets.map((set) => (
              <Link key={set} href={`/set/${encodeURIComponent(set)}`} style={{
                color: 'rgba(255,255,255,0.5)', textDecoration: 'none', fontSize: 12, fontWeight: 500,
              }}>{set}</Link>
            ))}
          </div>
        </div>

        {/* Bottom legal strip */}
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 16,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 16, flexWrap: 'wrap',
        }}>
          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, margin: 0, maxWidth: 600, lineHeight: 1.55 }}>
            Not affiliated with or endorsed by Nintendo, The Pokémon Company, or any grading service. Prices sourced from public marketplaces. Informational only.
          </p>
          <Link href="/terms" style={{
            color: 'rgba(255,255,255,0.3)', textDecoration: 'none', fontSize: 11, fontWeight: 500,
          }}>
            Terms of Service
          </Link>
        </div>
      </div>
    </footer>
  )
}

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p style={{
        color: 'rgba(255,255,255,0.4)', fontSize: 11, marginBottom: 12,
        textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700,
      }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {links.map((link) => (
          <Link key={link.label} href={link.href} style={{
            color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 500,
          }}>
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
