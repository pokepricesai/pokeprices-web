// src/lib/chat/cardContext.ts
//
// Block 5A-W-52A.1 — structured context types for the chat pipeline.
// Before 52A, the chat client sent card identity as free-form text
// (e.g. "Kleavor #86 from Astral Radiance") wrapped in a
// `[Context: asking about ...]` prefix. The LLM had to re-parse that
// text to look up the card, which produced wrong-card substitutions
// documented in the 1,000-chat review (Fossil #50 answered as
// Kabutops #24, etc.).
//
// This module defines the unambiguous identifiers the client passes
// in a structured `card_context` JSON field so the edge function can
// load the EXACT record without any parsing.
//
// Naming discipline (52A.1 correction):
//   * `cardRecordId` maps to `cards.id` — the actual DB primary key.
//   * `cardUrlSlug`  maps to `cards.card_url_slug` — URL-safe slug.
//   * `priceChartingProductId` maps to `cards.card_slug` — the
//     PriceCharting product id stored as a numeric string.
//
// Never mix these. `cards.card_slug` is NOT the DB primary key —
// it's the PriceCharting product id. Querying `.eq('card_slug', X)`
// with a DB `id` value would silently miss the row.

export type Language = 'en' | 'jp'

export interface CardContext {
  /**
   * `cards.id` — DB primary key (bigint). Present only when the
   * caller can supply it. The card-detail RPC does not currently
   * project `id`, so mount sites that build CardContext from that
   * RPC leave this null.
   */
  cardRecordId: number | string | null
  /**
   * `cards.card_url_slug` — URL-safe display slug (e.g.
   * "kleavor-holo-86"). Unique *within a set only*, so retrieval
   * NEVER queries this column alone: the edge function always
   * pairs it with setName + language and accepts only exactly one
   * matching row.
   */
  cardUrlSlug: string
  /**
   * `cards.card_slug` — PriceCharting product identifier as a
   * numeric string (e.g. "3489584"). Globally unique across the
   * catalogue. Safer than URL slug lookup — the edge function's
   * priority-2 identifier. Populate whenever the mount site has
   * it (card page and scanner both do); null only when the caller
   * genuinely does not have the PC id.
   */
  priceChartingProductId: string | null
  /**
   * Cleaned card name (no trailing "#NN"). Used to detect explicit
   * card-name switches in the client and to render human-readable
   * provenance in logs. Empty string when the caller has no name
   * (e.g. a set-context stub).
   */
  cardName: string
  /**
   * Exact set_name from the `cards` table — never a display-only
   * variant.
   */
  setName: string
  /** Raw numerator, e.g. "58" or "58a" for lettered variants. */
  cardNumber: string | null
  /** Composed `N/M` string as stored in the DB. */
  cardNumberDisplay: string | null
  language: Language
  /**
   * Optional variant marker the user has told the chat about
   * ("reverse holo", "1st Edition", etc.). Not a DB field — carried
   * so follow-up questions can flow to the right printing.
   */
  variant?: string | null
}

export interface SetContext {
  setName: string
  language: Language
}

/**
 * Machine-readable intents for pre-routed quick actions. The chat
 * client passes one of these when the user taps a suggestion button;
 * the edge function skips its LLM tool-selector and calls the
 * corresponding retrieval directly.
 *
 * Adding a new intent: add the enum value here AND wire the
 * pre-routing branch in supabase/functions/smart-endpoint/index.ts.
 * Do NOT alias user-typed phrases to intents — free-text messages
 * continue through the LLM classifier.
 */
export type QuickActionIntent =
  | 'card_price'
  | 'grade_card'
  | 'price_trend'
  | 'best_value_grade'
  | 'all_time_high'
  | 'set_value'
  | 'set_top_cards'

export interface QuickPrompt {
  label: string
  intent: QuickActionIntent
}

export const CARD_QUICK_PROMPTS: QuickPrompt[] = [
  { label: 'Should I grade this card?',   intent: 'grade_card' },
  { label: 'How has the price trended?',  intent: 'price_trend' },
  { label: 'What grade is best value?',   intent: 'best_value_grade' },
  { label: 'How far from all-time high?', intent: 'all_time_high' },
]

export const SET_QUICK_PROMPTS: QuickPrompt[] = [
  { label: 'What is this set worth?',        intent: 'set_value' },
  { label: `What's the top card in this set?`, intent: 'set_top_cards' },
]

/**
 * Strip the trailing " #NN" that the DB embeds in `card_name`
 * (e.g. "Kleavor #86" → "Kleavor"). Used to build a clean visible
 * label without depending on the LLM to parse identifiers.
 */
export function cleanCardName(cardName: string | null | undefined): string {
  if (!cardName) return ''
  return cardName.replace(/\s*#[A-Za-z0-9/-]+\s*$/, '').trim()
}

/**
 * Compose a clean, human-readable card label for the chat header
 * ("Kleavor 86/189") from the same DB fields the CardContext carries.
 */
export function displayCardLabel(ctx: CardContext, cardName: string): string {
  const name = cleanCardName(cardName)
  const number = ctx.cardNumberDisplay ?? (ctx.cardNumber ? `#${ctx.cardNumber}` : '')
  return number ? `${name} ${number}` : name
}

/**
 * Compose the visible user message for a card-page quick action. The
 * structured card_context is the source of truth for identity — this
 * string is only what the user sees in the chat bubble. Kept clean:
 * no `[Context: ...]` prefix, no orphan brackets.
 */
export function displayQuickActionText(intent: QuickActionIntent, ctx: CardContext, cardName: string): string {
  const label = displayCardLabel(ctx, cardName)
  switch (intent) {
    case 'grade_card':        return `Should I grade ${label} from ${ctx.setName}?`
    case 'price_trend':       return `How has ${label} from ${ctx.setName} trended in price?`
    case 'best_value_grade':  return `What grade is the best value for ${label} from ${ctx.setName}?`
    case 'all_time_high':     return `How far is ${label} from ${ctx.setName} from its all-time high?`
    case 'card_price':        return `What is ${label} from ${ctx.setName} worth?`
    case 'set_value':         return `What is ${ctx.setName} worth?`
    case 'set_top_cards':     return `What are the top cards in ${ctx.setName}?`
    default:                  return label
  }
}
