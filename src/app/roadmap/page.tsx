// src/app/roadmap/page.tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import FAQ, { type FAQItem } from '@/components/FAQ'
import BreadcrumbSchema from '@/components/BreadcrumbSchema'

export const metadata: Metadata = {
  title: 'Features & Roadmap — PokePrices',
  description: 'A complete tour of what PokePrices.io does today — live Pokémon TCG card prices, PSA grading insights, portfolio tracking, the collector AI assistant — plus the roadmap of what is coming next. Free, no login, no data collection.',
  alternates: { canonical: 'https://www.pokeprices.io/roadmap' },
  openGraph: {
    title: 'PokePrices — Features & Roadmap',
    description: 'Every feature on PokePrices today, plus the public roadmap of what is coming next for Pokémon TCG collectors.',
    url: 'https://www.pokeprices.io/roadmap',
    siteName: 'PokePrices',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PokePrices — Features & Roadmap',
    description: 'Every feature on PokePrices today, plus the public roadmap of what is coming next.',
  },
}

// ── Content ───────────────────────────────────────────────────────────────────

type FeatureBlock = {
  title: string
  blurb: string
  links: { label: string; href: string; description?: string }[]
}

const featureBlocks: FeatureBlock[] = [
  {
    title: 'Live Pokémon card prices and history',
    blurb: 'Every card page shows the current raw (ungraded) value plus PSA 9 and PSA 10 prices, a 30 and 90 day trend, all-time high, drawdown from peak and a sparkline of recent activity. Prices are sourced from real sold listings, never asking prices — so what you see is what cards actually changed hands for.',
    links: [
      { label: 'Browse all sets',           href: '/browse',          description: 'Every Pokémon TCG set we track, filterable by era.' },
      { label: 'Risers & fallers',          href: '/visualisations/risers-fallers', description: 'Biggest 30-day movers across the market.' },
      { label: 'Set price index',           href: '/visualisations/set-price-index', description: 'Set-level price index over time.' },
    ],
  },
  {
    title: 'PSA, CGC and BGS grading insight',
    blurb: 'Each card carries the PSA population (how many copies have been graded) and the gem rate (the percentage that came back as a PSA 10). Combine that with the raw-to-PSA-10 multiple and the Grading Calculator and you can answer the real question — is this card worth the £25, the wait and the risk?',
    links: [
      { label: 'Grading Calculator',        href: '/dashboard/grading', description: 'Landed cost vs. graded uplift, break-even at a glance.' },
      { label: 'Tools hub',                 href: '/tools',             description: 'All open calculators and trackers.' },
    ],
  },
  {
    title: 'Set pages with the data you actually need',
    blurb: 'Open any set and you get the printing total, release date, master-set value, biggest cards, biggest movers and a hidden-gems shortlist. Sets are tagged by era — Base, Gym, Neo, EX, Diamond & Pearl, Platinum, HGSS, Black & White, XY, Sun & Moon, Sword & Shield, Scarlet & Violet and the new Mega Evolution era — so the chronology is honest, not marketing-led.',
    links: [
      { label: 'Browse sets by era',        href: '/browse',          description: 'Filter sets by era and sort by release, value or size.' },
      { label: 'Chaos Rising',              href: '/set/Chaos%20Rising', description: 'Latest released set, Mega Evolution era.' },
      { label: 'Base Set',                  href: '/set/Base%20Set',  description: 'The original 1999 set, still the most iconic.' },
    ],
  },
  {
    title: 'Pokémon species pages',
    blurb: 'Every Pokémon has its own page tying together Pokédex info, all of that species’ cards across every set, and current prices. Useful for collectors building a one-of-each Charizard run, or anyone just curious which Mewtwo printing is the most expensive right now.',
    links: [
      { label: 'All Pokémon species',       href: '/pokemon',          description: 'Index of every Pokémon with cards in our database.' },
      { label: 'Charizard',                 href: '/pokemon/charizard', description: 'Every Charizard card, every printing, current prices.' },
      { label: 'Pikachu',                   href: '/pokemon/pikachu',   description: 'Every Pikachu card across the franchise.' },
    ],
  },
  {
    title: 'Tools collectors actually use',
    blurb: 'No-login calculators for the things you actually need answers to — what would it cost to grade this, is this trade fair, how is my collection moving. Every tool runs on the same sold-listing data the rest of the site shows.',
    links: [
      { label: 'Grading Calculator',        href: '/dashboard/grading', description: 'PSA, CGC and BGS landed cost vs. graded uplift.' },
      { label: 'Trade Evaluator',           href: '/dealer',            description: 'Compare two card stacks for a fair trade.' },
      { label: 'Quick Price Checker',       href: '/dashboard/quick-price', description: 'Scan or upload a stack, get pricing fast.' },
      { label: 'Portfolio tracker',         href: '/dashboard/portfolio', description: 'Log what you own, track landed value.' },
      { label: 'Watchlist & Alerts',        href: '/dashboard/watchlist-alerts', description: 'Cards you do not own yet but want to follow, plus the alerts that fire on them.' },
      { label: 'Set Completion tracker',    href: '/dashboard/sets',   description: 'Tick off owned cards, see missing-by-value.' },
      { label: 'Card Show Planner',         href: '/dashboard/card-shows', description: 'UK, US and CA shows mapped and filtered.' },
    ],
  },
  {
    title: 'The collector AI assistant',
    blurb: 'A focused chat assistant tuned for Pokémon TCG questions — set context, grading trade-offs, what a card is currently worth, whether a printing is rare. It is grounded in our live database, not the model’s training data, so prices stay current. AI is a feature here, not the brand.',
    links: [
      { label: 'Open the AI assistant',     href: '/ai-assistant',     description: 'Ask anything about Pokémon TCG prices, sets, grading.' },
    ],
  },
  {
    title: 'Studio for content creators',
    blurb: 'One-click branded graphics from any card, set or price snapshot — PNG exports sized for X, Instagram, YouTube thumbnails and Discord. Built so creators can share what they’re seeing without having to mock anything up themselves.',
    links: [
      { label: 'Open Studio',               href: '/studio',           description: 'Generate share-ready PNGs from any card.' },
    ],
  },
  {
    title: 'Visualisations and discovery',
    blurb: 'When you want the macro view instead of a single card, the visualisation pages plot the whole market. Daily risers and fallers, a heatmap of which sets are gaining momentum, and a long-running set-level price index.',
    links: [
      { label: 'Visualisations hub',        href: '/visualisations',                 description: 'All market-wide charts in one place.' },
      { label: 'Risers & fallers',          href: '/visualisations/risers-fallers',  description: 'Volume-verified daily movers.' },
      { label: 'Set heatmap',               href: '/visualisations/heatmap',         description: 'Which sets are gaining or cooling.' },
      { label: 'Set price index',           href: '/visualisations/set-price-index', description: 'Long-running set-level index.' },
    ],
  },
  {
    title: 'Games for collectors',
    blurb: 'Short daily games built around real card data — guess the price, higher-or-lower between two cards, and a daily-pick puzzle. They’re designed to teach you the market without you having to study it.',
    links: [
      { label: 'Games hub',                 href: '/games',               description: 'All daily games in one place.' },
      { label: 'Daily Pick',                href: '/games/daily-pick',    description: 'One card a day — would you buy it now?' },
      { label: 'Guess the Price',           href: '/games/guess-price',   description: 'Estimate the sold price of a real card.' },
      { label: 'Higher or Lower',           href: '/games/higher-lower',  description: 'Which of these two is worth more right now?' },
    ],
  },
  {
    title: 'Community and IRL',
    blurb: 'Pokémon collecting is a people thing, not just a data thing. We list creators, trusted vendors and physical card shows so collectors can find each other in real life and online without having to wade through Reddit threads or Discord servers.',
    links: [
      { label: 'Creator directory',         href: '/creators',          description: 'Pokémon YouTubers, streamers and writers.' },
      { label: 'Vendor directory',          href: '/vendors',           description: 'Trusted Pokémon TCG vendors and shops.' },
      { label: 'Card Shows',                href: '/card-shows',        description: 'UK, US and Canadian Pokémon card shows.' },
      { label: 'UK card shows',             href: '/card-shows/uk',     description: 'Pokémon card events in the United Kingdom.' },
      { label: 'US card shows',             href: '/card-shows/us',     description: 'Pokémon card events in the United States.' },
    ],
  },
  {
    title: 'Insights, guides and market commentary',
    blurb: 'Long-form articles on grading economics, set previews, sealed-vs-singles arguments and the kind of analysis you would otherwise have to piece together from twenty different Reddit posts. New pieces go up regularly.',
    links: [
      { label: 'All insights',              href: '/insights',          description: 'Articles, guides and market commentary.' },
    ],
  },
]

// ── Roadmap ──────────────────────────────────────────────────────────────────

type RoadmapItem = { title: string; blurb: string }

const roadmapNow: RoadmapItem[] = [
  { title: 'IndexNow integration',          blurb: 'Notify Bing and other engines the second a card page, set page or insight is added or updated, so new content gets indexed in hours instead of weeks.' },
  { title: 'Era filter on the sets page',   blurb: 'Shipped — /browse now has a chronological era filter that includes the new Mega Evolution era.' },
  { title: 'Mega Evolution era',            blurb: 'Phantasmal Flames, Perfect Order, Ascended Heroes and Chaos Rising are grouped under the new Mega Evolution era, with Pitch Black confirmed for Jul 17, 2026.' },
]

const roadmapSoon: RoadmapItem[] = [
  { title: 'Set-level price index from PriceCharting', blurb: 'Pull the set-level trend lines that PriceCharting calculates so you can see how an entire set is moving in one chart, not just card by card.' },
  { title: 'Release calendar table',                   blurb: 'A real table of upcoming Pokémon TCG sets with confirmed release dates, preorder links, UK and US retailer stock, and recommended retail prices.' },
  { title: 'Pull rates',                               blurb: 'Public pull-rate data from confirmed openings — odds of hitting each rarity tier per set, with sample sizes and last-updated stamps.' },
  { title: 'Rip or Keep',                              blurb: 'For sealed product, a quick calculator showing whether the expected pull value beats the current sealed price.' },
  { title: 'Curated investing knowledge',              blurb: 'A vetted knowledge document injected into the AI assistant so it can reason about long-term collecting strategy, not just current prices.' },
  { title: 'Faster image loading',                     blurb: 'Lazy-loaded card images, smaller bundles and tighter caching so the site feels instant on mobile.' },
]

const roadmapLater: RoadmapItem[] = [
  { title: 'Card shop directory',          blurb: 'A searchable directory of physical Pokémon TCG shops, filterable by country, city and stock type. Useful for collectors, useful for shops.' },
  { title: 'Sealed product tracking',      blurb: 'Box, booster bundle, ETB and elite trainer box price tracking — same sold-listing methodology as singles.' },
  { title: 'Japanese set coverage',        blurb: 'Pricing for popular Japanese sets and Promo cards, with cross-references to their English counterparts.' },
  { title: 'Public API for businesses',    blurb: 'A documented price API for vendors, card shops and tools. Free tier for hobbyists, paid tier for commercial use — this is how the project keeps the consumer side free.' },
  { title: 'Native mobile app',            blurb: 'Only if the web version genuinely cannot do what collectors need on the move. The bar is high — most apps in this space are worse than a good mobile website.' },
]

// ── FAQ — long, SEO-targeted ─────────────────────────────────────────────────

const faqItems: FAQItem[] = [
  {
    question: 'What is PokePrices?',
    answer: 'PokePrices is a free Pokémon TCG price intelligence site. It shows live raw and PSA-graded card values, grading economics, set-level momentum and a small set of collector tools — all without a login, a paywall or any data collection. It is built and maintained by a single collector.',
  },
  {
    question: 'Is PokePrices really free?',
    answer: 'Yes. The core site has no paywall and never will. Saving a portfolio, watchlist or set-completion progress requires a free login because we have to store it somewhere, but the data, prices, charts, AI assistant and all open tools are completely free for everyone. We do not sell user data and we do not run advertising.',
  },
  {
    question: 'Do I need to sign up?',
    answer: 'No. Everything on /browse, every card page, every set page, /insights, /visualisations, the AI assistant, the grading calculator, Studio and the games work without a login. You only need an account if you want PokePrices to remember things for you across devices — a portfolio, a watchlist or a set-completion checklist.',
  },
  {
    question: 'Where do the prices come from?',
    answer: 'Card prices are sourced from real sold listings on major marketplaces. We do not use asking prices, which can be wildly above what cards actually transact for. The sold-listing approach is why our prices sometimes look lower than other price guides — they reflect what changed hands, not what people are hoping to get.',
  },
  {
    question: 'How often are prices updated?',
    answer: 'Card prices are recalculated nightly from the most recent sold-listing data. PSA population numbers are refreshed roughly every two weeks. Set-level aggregates and momentum charts rebuild from the underlying card prices on the same nightly cycle.',
  },
  {
    question: 'How accurate are the prices?',
    answer: 'For widely traded cards, the prices are very close to reality — they are computed from the same public marketplace data anyone could verify. For rarer cards with few recent sales, accuracy depends on sample size. Every card page is transparent about the data source and how recent the last sale was, so you can judge the confidence yourself.',
  },
  {
    question: 'Do you cover both raw cards and graded cards?',
    answer: 'Yes. Every card page shows raw (ungraded) prices alongside PSA 9 and PSA 10 prices where data is available. Some pages also include CGC and BGS where there is enough volume. Graded data combines sold-listing prices with PSA population to give a fuller picture of how scarce a high-grade copy actually is.',
  },
  {
    question: 'What is the gem rate?',
    answer: 'Gem rate is the percentage of submitted copies that came back as a PSA 10. A card with a 35% gem rate is much easier to grade well than one with a 4% gem rate. Combined with the raw-to-PSA-10 price multiple, gem rate is the single best signal for whether a card is worth grading.',
  },
  {
    question: 'How does the Grading Calculator work?',
    answer: 'You pick a card and a grader (PSA, CGC or BGS), and the calculator combines the current raw price, the relevant graded price, the grading fee for your service tier, return shipping and any landed costs. It returns a break-even price, an expected ROI based on the card’s gem rate, and the dollar (or pound) profit per grade outcome.',
  },
  {
    question: 'Why are some sets in the Mega Evolution era?',
    answer: 'The new Mega Evolution era covers the Pokémon TCG re-brand starting around Phantasmal Flames. Phantasmal Flames, Perfect Order, Ascended Heroes and Chaos Rising sit in the Mega Evolution era, with Mega Evolution — Pitch Black confirmed as the next major release on July 17, 2026. Earlier Scarlet & Violet era sets like Journey Together and Destined Rivals stay under Scarlet & Violet.',
  },
  {
    question: 'Do you support Magic: The Gathering?',
    answer: 'A sister site, MagicPrices, runs on the same Supabase infrastructure with Scryfall data — 104,000+ English cards and 1,000+ sets. The two projects share data plumbing but each focuses on its own community.',
  },
  {
    question: 'Are prices shown in GBP or USD?',
    answer: 'Card prices are displayed in USD by default because that is the unit most sold-listing data is denominated in. Tools that involve landed cost (the Grading Calculator, the Trade Evaluator) handle GBP for UK collectors so you see what something will actually cost you including VAT, shipping and fees.',
  },
  {
    question: 'Do you have a mobile app?',
    answer: 'Not currently. The site is fully responsive and behaves like an app on mobile. A native app is on the longer-term roadmap, but only if there is a clear thing it could do that the mobile site cannot.',
  },
  {
    question: 'Is there a public API?',
    answer: 'Not yet for consumers. A documented price API for vendors and card shops is on the roadmap and will be how the consumer site stays free — commercial users pay, hobbyists do not.',
  },
  {
    question: 'How does the AI assistant work?',
    answer: 'The assistant is a Claude-based chat tool tuned for Pokémon TCG questions. It is given live data from our database at request time — current prices, set info, PSA population — so its answers reflect the actual market today rather than the model’s training cutoff. AI is a feature here, not the marketing identity.',
  },
  {
    question: 'Can I submit a card show?',
    answer: 'Yes. Anyone can submit a Pokémon TCG card show from the Card Shows page. Submissions are reviewed before publishing to keep the directory accurate.',
  },
  {
    question: 'Can I list myself as a creator?',
    answer: 'Yes. The Creator directory accepts submissions from Pokémon TCG YouTubers, streamers, writers and educators. Submissions are reviewed before approval to keep the directory genuine.',
  },
  {
    question: 'How do you handle reverse holos, variants and promo printings?',
    answer: 'Variants are tracked as separate cards with their own prices, gem rates and population data. A reverse holo Charizard from a given set is a different entry from the regular holo Charizard from that same set, because the market treats them as different cards. Promo printings get the same treatment.',
  },
  {
    question: 'Do you track sealed product like booster boxes and ETBs?',
    answer: 'Not yet. Sealed product tracking is on the longer-term roadmap. The methodology will mirror singles — sold listings only, with the same transparency on data sources.',
  },
  {
    question: 'What makes PokePrices different from other Pokémon price sites?',
    answer: 'Three things — the data is sold-listing only (not asking prices), the site has no login, paywall or data collection, and the tooling is built by a collector rather than by an investor-led startup. The product principles are public on this page, and you can hold us to them.',
  },
  {
    question: 'Who built PokePrices?',
    answer: 'A single developer, Luke. Solo project, no investors, no growth team. If you have a feature idea, a bug report, or you spot a price that looks wrong, the contact form is read by a human (the same human).',
  },
  {
    question: 'How can I support the project?',
    answer: 'Use it, share it with collectors you know, and submit corrections when something looks off. The newsletter is the easiest way to follow updates — once a month, no spam, no paywall. Long-term, the public API for commercial users will be how the project funds itself.',
  },
  {
    question: 'When is the next major Pokémon TCG set?',
    answer: 'Mega Evolution — Pitch Black, the first major set of the new Mega Evolution era, is scheduled for July 17, 2026. The most recent release was Chaos Rising on May 22, 2026.',
  },
  {
    question: 'Where can I get notified of new features?',
    answer: 'The monthly collector digest covers new features, major market moves, grading tips and upcoming sets. You can subscribe from the homepage or the footer of any page. No login required, unsubscribe any time.',
  },
]

// ── Styling helpers ──────────────────────────────────────────────────────────

const SectionHeading = ({ children, id }: { children: React.ReactNode; id?: string }) => (
  <h2 id={id} style={{
    fontSize: 24, fontWeight: 800, color: 'var(--text)',
    fontFamily: "'Outfit', sans-serif", margin: '40px 0 14px',
    letterSpacing: '-0.3px',
  }}>{children}</h2>
)

const Lead = ({ children }: { children: React.ReactNode }) => (
  <p style={{
    fontSize: 15, color: 'var(--text-muted)', lineHeight: 1.7,
    margin: '0 0 18px', fontFamily: "'Figtree', sans-serif",
  }}>{children}</p>
)

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RoadmapPage() {
  return (
    <main style={{ maxWidth: 920, margin: '0 auto', padding: '36px 24px 60px', fontFamily: "'Figtree', sans-serif" }}>
      <BreadcrumbSchema items={[{ name: 'Features & Roadmap' }]} />

      {/* ── Hero ── */}
      <section style={{ marginBottom: 28 }}>
        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 11, fontWeight: 800, color: 'var(--primary)', background: 'rgba(26,95,173,0.10)', padding: '4px 12px', borderRadius: 14, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 14 }}>
          Free · No login · No data collection
        </div>
        <h1 style={{
          fontFamily: "'Outfit', sans-serif", fontSize: 40, margin: '0 0 12px',
          color: 'var(--text)', letterSpacing: '-0.5px', lineHeight: 1.1,
        }}>
          PokePrices features and roadmap
        </h1>
        <p style={{
          fontSize: 16, color: 'var(--text-muted)', lineHeight: 1.65,
          margin: 0, maxWidth: 720,
        }}>
          A full tour of what PokePrices does today — live <Link href="/browse" style={{ color: 'var(--primary)' }}>Pokémon TCG card prices</Link>, PSA grading economics,
          a <Link href="/dashboard/portfolio" style={{ color: 'var(--primary)' }}>portfolio tracker</Link>, the <Link href="/ai-assistant" style={{ color: 'var(--primary)' }}>collector AI assistant</Link>,
          <Link href="/studio" style={{ color: 'var(--primary)' }}> Studio for creators</Link> and a small set of <Link href="/tools" style={{ color: 'var(--primary)' }}>tools</Link> built by a single collector — plus the public
          roadmap of what is coming next. The product principles are simple: no login for the data, no paywall, no email capture, no data collection. Ever.
        </p>
      </section>

      {/* Quick links / TOC */}
      <nav aria-label="Page sections" style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
        padding: '14px 18px', margin: '0 0 32px',
      }}>
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 8px' }}>On this page</p>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {[
            ['#features',   'Features today'],
            ['#data',       'How the data works'],
            ['#principles', 'Principles'],
            ['#roadmap',    'Roadmap'],
            ['#faq',        'FAQ'],
          ].map(([href, label]) => (
            <a key={href} href={href} style={{ fontSize: 13, color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>
              {label}
            </a>
          ))}
        </div>
      </nav>

      {/* ── Features today ── */}
      <SectionHeading id="features">What PokePrices does today</SectionHeading>
      <Lead>
        Every section below links to the actual feature. If something interests you, click straight through —
        you do not need an account, an email or a credit card to use any of it.
      </Lead>

      {featureBlocks.map(block => (
        <section key={block.title} style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
          padding: '18px 22px', marginBottom: 14,
        }}>
          <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', margin: '0 0 8px', fontFamily: "'Figtree', sans-serif" }}>
            {block.title}
          </h3>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.65, margin: '0 0 12px' }}>
            {block.blurb}
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {block.links.map(link => (
              <li key={link.href} style={{ fontSize: 13, lineHeight: 1.55 }}>
                <Link href={link.href} style={{ color: 'var(--primary)', fontWeight: 700, textDecoration: 'none' }}>
                  {link.label} →
                </Link>
                {link.description && (
                  <span style={{ color: 'var(--text-muted)' }}>{' — '}{link.description}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* ── How the data works ── */}
      <SectionHeading id="data">How the data works</SectionHeading>
      <Lead>
        Transparency on data sources is one of the core product principles, so this section is deliberately specific.
      </Lead>

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 22px', marginBottom: 28 }}>
        <ul style={{ paddingLeft: 18, margin: 0, fontSize: 14, color: 'var(--text)', lineHeight: 1.8 }}>
          <li><strong>Raw card prices</strong> are computed from real sold listings on major Pokémon TCG marketplaces. Asking prices are never used.</li>
          <li><strong>Graded card prices</strong> (PSA 9, PSA 10, CGC, BGS where available) come from the same sold-listing methodology, filtered by grading service and grade.</li>
          <li><strong>PSA population data</strong> is sourced directly from PSA and refreshed roughly every two weeks via a manual save-and-parse workflow.</li>
          <li><strong>Set metadata</strong> (release date, printing total, era) is curated against multiple primary sources and cross-checked against Pokémon TCG release calendars.</li>
          <li><strong>Update cadence</strong> for card prices is nightly. Every card page tells you when the data was last refreshed.</li>
          <li><strong>Sample size matters.</strong> Cards with few recent sales have wider uncertainty. We surface volume so you can judge a price’s confidence yourself.</li>
        </ul>
      </div>

      {/* ── Principles ── */}
      <SectionHeading id="principles">Principles</SectionHeading>
      <Lead>
        These are non-negotiable. If a feature would compromise one of them, we do not build the feature.
      </Lead>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 28 }}>
        {[
          { title: 'No paywall',          body: 'The core site is free forever. Every price, every chart, every tool that does not require saved state is open.' },
          { title: 'No data collection',  body: 'No tracking pixels beyond standard analytics. No email harvesting. No login walls in front of data.' },
          { title: 'Sold listings only',  body: 'Prices reflect what changed hands, not what sellers are asking. This is sometimes the difference between buying smart and getting fleeced.' },
          { title: 'Honest landed cost',  body: 'When a calculator says “you would profit X”, VAT, shipping, grading fees and platform cuts are already factored in — we protect collectors, not flippers.' },
          { title: 'Collectors first',    body: 'Decisions are made for collectors, not investors. If a feature would help flipping at the expense of the community, it does not ship.' },
          { title: 'AI is a feature',     body: 'The collector AI assistant is one tool among many, not the brand. We will never lead with "AI" as marketing because it does not describe what we actually do.' },
        ].map(p => (
          <div key={p.title} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px' }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', margin: '0 0 6px' }}>{p.title}</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>{p.body}</p>
          </div>
        ))}
      </div>

      {/* ── Roadmap ── */}
      <SectionHeading id="roadmap">Roadmap</SectionHeading>
      <Lead>
        Honest, in order of how close it is to shipping. Things move around — this is a one-person project — but
        this is the priority stack as of today.
      </Lead>

      <RoadmapColumn label="Now / in progress" tone="now"   items={roadmapNow} />
      <RoadmapColumn label="Coming soon"       tone="soon"  items={roadmapSoon} />
      <RoadmapColumn label="Longer term"       tone="later" items={roadmapLater} />

      {/* ── FAQ ── */}
      <div id="faq" />
      <FAQ
        items={faqItems}
        title="Frequently asked questions"
        intro="The questions collectors actually ask — about prices, data, grading, the roadmap and the principles. Each answer is also emitted as FAQPage structured data so search engines can pick it up directly."
      />

      {/* ── Closing CTA ── */}
      <section style={{
        background: 'linear-gradient(135deg, rgba(26,95,173,0.06), rgba(59,130,246,0.04))',
        border: '1px solid rgba(26,95,173,0.2)', borderRadius: 16,
        padding: '24px 26px', marginTop: 28, textAlign: 'center',
      }}>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 8px', color: 'var(--text)' }}>
          Have an idea, a bug or a price that looks wrong?
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.6 }}>
          The contact form is read by a human. The same human who built the site.
        </p>
        <Link href="/contact" style={{
          display: 'inline-block', background: 'var(--primary)', color: '#fff',
          padding: '10px 20px', borderRadius: 10, fontWeight: 800, fontSize: 14,
          textDecoration: 'none',
        }}>
          Contact PokePrices →
        </Link>
      </section>
    </main>
  )
}

// ── Roadmap column ───────────────────────────────────────────────────────────

function RoadmapColumn({
  label, tone, items,
}: {
  label: string
  tone: 'now' | 'soon' | 'later'
  items: RoadmapItem[]
}) {
  const tones = {
    now:   { color: '#22c55e', bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.30)'  },
    soon:  { color: '#1a5fad', bg: 'rgba(26,95,173,0.10)',  border: 'rgba(26,95,173,0.30)'  },
    later: { color: '#a78bfa', bg: 'rgba(167,139,250,0.10)', border: 'rgba(167,139,250,0.30)' },
  }[tone]

  return (
    <section style={{ marginBottom: 18 }}>
      <span style={{
        display: 'inline-block', fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
        textTransform: 'uppercase', color: tones.color, background: tones.bg,
        border: `1px solid ${tones.border}`, padding: '3px 10px', borderRadius: 14, marginBottom: 10,
      }}>{label}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
        {items.map(item => (
          <div key={item.title} style={{
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
            padding: '14px 16px',
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px', fontFamily: "'Figtree', sans-serif" }}>
              {item.title}
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
              {item.blurb}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
