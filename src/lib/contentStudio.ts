// Content Studio shared types + constants.
// Used by the admin page, the generation edge function and the PNG render route.

export type TemplateType =
  | 'card_battle'
  | 'market_mover'
  | 'grading_gap'
  | 'pokemon_battle'
  | 'budget_builder'
  | 'collector_pulse'
  | 'then_vs_now'
  | 'guess_the_pokemon'

export type PostStatus = 'draft' | 'approved' | 'rejected' | 'used'

export interface SocialContentPost {
  id: string
  template_type: TemplateType
  title: string | null
  hook: string | null
  data_payload: any
  twitter_copy: string | null
  instagram_caption: string | null
  image_url: string | null
  status: PostStatus
  generated_options: any
  created_at: string
  updated_at: string
}

// Visual / background style applied to the rendered PNG. Same enum used
// across every template.
export type VisualStyle = 'light' | 'dark' | 'blue' | 'yellow'

export const VISUAL_STYLES: { value: VisualStyle; label: string }[] = [
  { value: 'light',  label: 'Light' },
  { value: 'dark',   label: 'Dark' },
  { value: 'blue',   label: 'PokePrices Blue' },
  { value: 'yellow', label: 'PokePrices Yellow' },
]

// Price tier — applies wherever we filter cards by raw price band.
export type PriceTier =
  | 'under_50' | '50_200' | '200_1000' | '1000_5000' | '5000_plus' | 'any'

export const PRICE_TIERS: { value: PriceTier; label: string; min: number; max: number | null }[] = [
  { value: 'under_50',  label: 'Under $50',          min: 0,       max: 5000   },
  { value: '50_200',    label: '$50 – $200',         min: 5000,    max: 20000  },
  { value: '200_1000',  label: '$200 – $1,000',      min: 20000,   max: 100000 },
  { value: '1000_5000', label: '$1,000 – $5,000',    min: 100000,  max: 500000 },
  { value: '5000_plus', label: '$5,000+',            min: 500000,  max: null   },
  { value: 'any',       label: 'Any price',          min: 0,       max: null   },
]

// Time window for Market Mover.
export type TimeWindow = '7d' | '30d' | '90d' | '1y'
export const TIME_WINDOWS: { value: TimeWindow; label: string; trendKey: string }[] = [
  { value: '7d',  label: '7 days',   trendKey: 'raw_pct_7d'   },
  { value: '30d', label: '30 days',  trendKey: 'raw_pct_30d'  },
  { value: '90d', label: '90 days',  trendKey: 'raw_pct_90d'  },
  { value: '1y',  label: '1 year',   trendKey: 'raw_pct_365d' },
]

// Default weekly-pack quotas (from spec). Phase A only builds the first two.
export const WEEKLY_PACK_QUOTA: Record<TemplateType, number> = {
  card_battle:        5,
  market_mover:       4,
  grading_gap:        3,
  pokemon_battle:     3,
  budget_builder:     2,
  collector_pulse:    2,
  then_vs_now:        1,
  guess_the_pokemon:  1,
}

export const TEMPLATE_LABELS: Record<TemplateType, string> = {
  card_battle:       'Card Battle',
  market_mover:      'Market Mover',
  grading_gap:       'Grading Gap',
  pokemon_battle:    'Pokémon Battle',
  budget_builder:    'Budget Builder',
  collector_pulse:   'Collector Pulse',
  then_vs_now:       'Then vs Now',
  guess_the_pokemon: 'Guess the Pokémon',
}

export const TEMPLATES_IMPLEMENTED: TemplateType[] = ['card_battle', 'market_mover']

// Background palette by visual style — used by both preview + Satori.
export const STYLE_PALETTE: Record<VisualStyle, {
  bg: string; text: string; muted: string; accent: string; border: string
}> = {
  light:  { bg: '#ffffff', text: '#0f172a', muted: '#64748b', accent: '#1a5fad', border: '#e2e8f0' },
  dark:   { bg: '#0f172a', text: '#f8fafc', muted: '#94a3b8', accent: '#ffcb05', border: '#1e293b' },
  blue:   { bg: '#1a5fad', text: '#ffffff', muted: 'rgba(255,255,255,0.7)', accent: '#ffcb05', border: 'rgba(255,255,255,0.18)' },
  yellow: { bg: '#ffcb05', text: '#0f172a', muted: 'rgba(15,23,42,0.65)',   accent: '#1a5fad', border: 'rgba(15,23,42,0.12)' },
}

// Generation options — shape varies by template_type.
export interface CardBattleOptions {
  visual_style: VisualStyle
  price_tier: PriceTier
}

export interface MarketMoverOptions {
  visual_style: VisualStyle
  price_tier: PriceTier
  time_window: TimeWindow
  direction: 'up' | 'down'
}

export type GenerateOptions = CardBattleOptions | MarketMoverOptions | Record<string, any>

export function defaultOptionsFor(template: TemplateType): GenerateOptions {
  switch (template) {
    case 'card_battle':
      return { visual_style: 'light', price_tier: '50_200' } as CardBattleOptions
    case 'market_mover':
      return { visual_style: 'light', price_tier: 'any', time_window: '30d', direction: 'up' } as MarketMoverOptions
    default:
      return { visual_style: 'light' }
  }
}
