// src/emails/designTokens.ts
// Block 3C — single source of truth for email design.
//
// Tokens are inline-safe (plain hex strings + numbers), independent
// of the website's CSS variables. Email clients do not load our
// stylesheet, so every email-rendered colour must be a literal here.

export const COLORS = {
  // Brand
  primary:        '#1a5fad', // deep variant used on the navbar gradient + email links
  primaryDeep:    '#0f3060',
  primaryLight:   '#3b82d6',
  accent:         '#ffcb05', // PokePrices gold
  accentDeep:     '#ffae00',
  accentSoft:     '#fff4c2', // resolved equivalent of rgba(255,203,5,0.20) on white
  // Surfaces
  pageBg:         '#eaf3ff', // brand-tinted page bg
  card:           '#ffffff',
  cardBorder:     '#bdd4ee',
  cardShadow:     '0 1px 2px rgba(15, 48, 96, 0.06)',
  // Type
  text:           '#1a3a5c',
  textMuted:      '#5a7a9a',
  textOnPrimary:  '#ffffff',
  textOnAccent:   '#1a3a5c',
  // Signals
  success:        '#27ae60',
  warning:        '#b8741f',
  // Misc
  divider:        '#d4e4f5',
  goldStripeFrom: '#ffcb05',
  goldStripeTo:   '#ffae00',
} as const

// Use the system font stack — Outfit + Figtree on the website are
// loaded from Google Fonts, which email clients block. The system
// stack is reliable and crisp on every major client.
export const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

export const SPACING = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
  xxl: 28,
  hero: 40,
} as const

export const RADIUS = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const

export const BUTTON = {
  primary: {
    paddingX: 22,
    paddingY: 13,
    fontSize: 15,
    fontWeight: 700,
    radius: RADIUS.md,
    minHeight: 44, // touch-friendly
  },
  secondary: {
    paddingX: 18,
    paddingY: 11,
    fontSize: 14,
    fontWeight: 700,
    radius: RADIUS.md,
    minHeight: 40,
  },
} as const

// Container width — within the conservative 600–640 range.
export const CONTAINER_MAX_WIDTH = 600

// Brand assets — absolute production URLs.
//
// `email-logo.png` (Block 3C correction pass) is a 319×121 PNG
// derived from public/logo.png — ~14 KB on disk, transparency
// preserved. Sized for a 2x retina rendering at 160×61 in the email
// header. Hosted under the PokePrices canonical origin; the source
// file lives at public/email-logo.png and is served by Vercel.
export const ASSETS = {
  origin:     'https://www.pokeprices.io',
  logoUrl:    'https://www.pokeprices.io/email-logo.png',
  logoWidth:  160,
  // The PokePrices wordmark is ~2.64:1 (1268/481). At width=160 the
  // proportional rendered height is 61. Forcing a smaller height would
  // distort the logo in Outlook desktop, which honours the HTML
  // height attribute over CSS height:auto.
  logoHeight: 61,
  logoAlt:    'PokePrices',
} as const
