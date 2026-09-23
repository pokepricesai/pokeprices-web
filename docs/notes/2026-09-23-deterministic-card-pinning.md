# Follow-up: deterministic card pinning

**Owner:** Luke
**Filed:** 2026-09-23 (during v164/v165 → v166 reduction pass)
**Status:** open, low-medium priority
**Related commits:** `a1f3b54` (v163), the v166 reduction (current HEAD)

## Background

The 2026-09-22 smart-endpoint audit ran a follow-up "accuracy pass" (v164) that added three narrowly-scoped improvements:

1. **v164-B Grounded PSA population** — mandatory `get_grading_pop` before any numeric pop claim. Solid, kept in v166.
2. **v164-C Variant identity** — `variant_labels`, `printed_denominator`, `is_secret_rare`, `raw_price_rank_in_result` fields on enriched cards + prompt guidance. Solid, kept in v166.
3. **v164-A LLM-answer-driven auto-pin scorer** — attempted to detect which of 2-6 search_cards candidates the model picked by scoring URL / card_number_display / variant_labels / set_name / plain-name mentions in the answer text. **Removed in v166**.

The scorer was reliable ~50-70% of runs on the production smoke. Root cause: Haiku's answer wording varies enough between runs that the top-vs-runner score margin sometimes closes below any safe threshold. No amount of prompt engineering or negation-stripping consistently produced a stable pin.

**User impact of removing the scorer:** minimal. Follow-up turns rely on conversation history alone. In practice the model does not drift to a different card between turns provided the T1 answer clearly identifies the printing. Multi-turn PSA 10 follow-ups pass 15/15 on the v166 smoke.

## The gap that remains

When `dbSearchCards` returns 2-6 candidates:

* T1 answer is factually correct (model picks a printing from the enriched result and quotes real prices).
* `matched_pc_product_id` stays null — no structured pin.
* T2 sees the same free-text search path if the client omits `card_context`. If the client also passes the T1 assistant message in `history`, the model usually stays on the same printing.

**When this becomes a real problem:** a user opens a new tab / clears state / uses the API without threading history back in. Turn 2 has no pin AND no conversation memory → model can silent-pick a different printing than T1.

## The right fix (not attempted here)

The reliable signal is a **structural** one, not a textual one. Options in rough preference order:

### Option A — Explicit `resolve_card` tool

Add a new tool the model MUST call at most once per turn when it answers about a specific printing. Schema:

```jsonc
{
  "name": "resolve_card",
  "description": "Declare which specific card this answer is about. Call once after picking from a search_cards result and before writing the answer.",
  "input_schema": {
    "type": "object",
    "properties": {
      "card_slug": { "type": "string" }
    },
    "required": ["card_slug"]
  }
}
```

Handler validates `card_slug` is in the current turn's candidate pool, records it as the pin, returns `{ ok: true }`. The tool call is invisible to the user; the model's `answer` remains the visible response. Cost: one extra API round-trip per multi-candidate turn.

Advantages: 100% deterministic. Model can't drift because the pin is a direct declaration, not a heuristic guess. Same mechanism works across every card domain (Charizard, Umbreon, alt art, etc.) without special-casing.

### Option B — Pin from tool arguments

If the model reliably calls a second tool (e.g. `get_price_history_summary`) with a specific `card_slug` from the candidate pool, that argument is itself a strong pin signal. Add handler-side logic: when the second tool's `card_slug` matches a candidate from the current turn's `search_cards` result, record it as the pin.

Advantages: no schema change to search_cards. Disadvantages: only fires when the model happens to chain a second tool call; single-tool answers still leave no pin.

### Option C — Streamed markdown-link parser + validation

Parse `[Name](url)` links in the answer post-hoc, extract the `card_url_slug`, validate against the candidate pool. Fire the pin only when exactly one link's slug is in the pool AND the model included the link (the pre-existing "use card_name verbatim" rule already asks for this).

Advantages: no schema change. Disadvantages: Haiku includes the markdown link inconsistently (30-40% skip rate observed). Same fundamental unreliability as the v164-A scorer.

## Recommendation

**Option A when we next revisit card pinning.** It's a single tool addition plus a small handler change. ~50 lines of code. Eliminates the entire class of "which candidate did the model pick" heuristics. The tool call round-trip adds ~200-400ms to multi-candidate turns; acceptable for reliability.

## What v166 ships instead

* Structural pin only: exact-single-candidate path (unchanged from v163) + client-supplied `card_context` path (unchanged).
* Everything else from the audit: dynamic latest-set, price-history summary RPC, unit normalisation, PSA pop grounding, variant identity fields, clarification/hallucination guardrails, evidence hierarchy.

Smoke pass rate: **15/15 green** on the revised criteria (do not require best-effort pin; require grounded follow-ups; require correct ambiguity behaviour; require correct card-switch behaviour; require PSA pop + variant checks to remain green).
