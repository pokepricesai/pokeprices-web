// src/lib/chat/chatRequest.ts
//
// Block 5A-W-52A.1 — the JSON shape the chat client POSTs to the
// smart-endpoint edge function. Kept in a shared module so the client
// component, the edge function, and their tests can all pin the same
// contract.
//
// Backward compatibility: pre-52A clients send only { message,
// session_id, history }. The edge function still accepts that shape;
// the 52A fields are all optional. The edge function's new
// structured-context path activates ONLY when card_context (or
// set_context) is present.

import type { CardContext, SetContext, QuickActionIntent } from './cardContext'

export type ContextSource =
  /** Card page (the CardPageClient InlineChat mount). */
  | 'card_page'
  /** Set page (SetPageClient InlineChat mount). */
  | 'set_page'
  /** Scanner result flowing into /ai-assistant. */
  | 'scanner'
  /** Follow-up message that re-uses the previous card via chat state. */
  | 'conversation'
  /** Free-text message with no known card. */
  | 'text'
  /**
   * The user typed a message that names a DIFFERENT card while an
   * activeCard was set. The client omits card_context on this turn
   * so the server resolves the newly named card fresh.
   */
  | 'card_switch'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequestBody {
  /** Visible message text the user sees. Kept CLEAN — no brackets. */
  message: string
  /** Per-tab id for chat_logs grouping. */
  session_id: string
  /** Recent history for the LLM. Not persistence — just context. */
  history: ChatMessage[]
  /**
   * Structured card identity. When present, the edge function loads
   * the exact record and skips LLM identifier extraction. Passed on
   * EVERY message from a card-context chat so follow-ups don't lose
   * identity. Explicitly null when the client detected an in-message
   * card switch and wants the server to resolve fresh.
   */
  card_context?: CardContext | null
  /** Structured set identity for set-page mounts. */
  set_context?: SetContext | null
  /**
   * Machine-readable intent for a pre-routed quick action. When
   * present, the edge function bypasses its LLM tool-selection and
   * runs the corresponding retrieval directly against card_context.
   * Free-text messages send null and go through the normal router.
   */
  intent?: QuickActionIntent | null
  /** Where this message originated — recorded for chat_logs. */
  context_source: ContextSource
}

/**
 * Server-returned provenance fields. The client uses these on a
 * free-text turn to reconstruct an activeCard so follow-ups on the
 * general AI page pin to the resolved card.
 */
export interface ChatResponseProvenance {
  answer: string
  tool_used?: string
  query_type?: string
  card_data_found?: boolean
  exact_match_found?: boolean
  match_method?: string
  candidate_count?: number
  requested_card_record_id?: string | number | null
  matched_card_record_id?: string | number | null
  matched_card_url_slug?: string | null
  matched_pc_product_id?: string | null
  matched_card_name?: string | null
  matched_set_name?: string | null
  matched_card_number?: string | null
  matched_card_number_display?: string | null
  matched_language?: 'en' | 'jp' | null
  matched_variant?: string | null
}
