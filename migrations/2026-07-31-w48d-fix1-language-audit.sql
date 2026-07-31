-- Block 5A-W-48D-FIX1: audit note for the two language-flipped rows
-- discovered after the 116-set Japanese PriceCharting import on
-- 2026-07-31.
--
-- The English `cards.language='en'` baseline dropped from 41,477 to
-- 41,475 during the W48D bulk import because two pre-existing rows
-- had their language overwritten from 'en' to 'jp' when the seeder's
-- upsert (on_conflict=card_slug, merge-duplicates) matched an
-- incoming Japanese CSV row against an existing row that shared the
-- same PriceCharting product ID.
--
-- Investigation (W48D-FIX1 Part 1) proved via `daily_prices` history
-- and `provider_card_links.created_at` timestamps that BOTH pre-
-- existing rows were previously MISCLASSIFIED as English by an
-- automatic backfill script that ran on 2026-06-17 14:06:52 UTC.
-- Every naming signal on both cards is Japanese-only:
--
--   1. pc-8330138 — "Aura's Lucario #93/PCG-P"
--      * "PCG-P" = Pokemon Card Game Promo (Japan-only numbering scheme)
--      * "Aura's Lucario" is a Japanese Movie promo (Battrio series)
--      * 19 daily_prices rows exist from 2025-12-01 to 2026-03-06
--        (raw price $3.99 → $31.49 range) — genuine Japanese card
--        being scraped through a Japanese Promo URL while erroneously
--        labelled English in the `cards` row.
--      * provider_card_links entry: match_method='automatic',
--        confidence=0.7, language='en' (WRONG — corrected below).
--
--   2. pc-8076785 — "Raifort #117/SV-P"
--      * "SV-P" = Scarlet & Violet Promo (Japan-only numbering scheme)
--      * "Raifort" is the Japanese name of Elite Four member Rika
--        (localised as "Rika" in English releases).
--      * 0 daily_prices rows — never scraped successfully; the
--        provider_card_links row's notes_internal explicitly reads
--        "backfill: no pc_url available; provider_card_id derived
--        from cards.card_slug", i.e. this row was synthesised by the
--        backfill, not confirmed against a live scrape.
--      * provider_card_links entry: match_method='automatic',
--        confidence=0.9, language='en' (WRONG — corrected below).
--
-- Decision (W48D-FIX1 Part 2, Case A — misclassified Japanese
-- records): retain `cards.language='jp'` as the corrected identity
-- (W48D itself completed this correction). Additionally update
-- `provider_card_links.language` from 'en' to 'jp' so all provider
-- linkage stays consistent. Preserve both cards' price histories
-- under the unchanged `card_slug`. No English card has been lost; the
-- English baseline is legitimately 41,475 going forward.
--
-- The provider_card_links.language updates were applied via
-- PostgREST at W48D-FIX1 apply time (2026-07-31 EU afternoon). This
-- file exists as an audit note — running it is idempotent.

UPDATE public.provider_card_links
   SET language = 'jp',
       notes_internal = 'W48D-FIX1: corrected en->jp misclassification (originally set by automatic backfill 2026-06-17). See migrations/2026-07-31-w48d-fix1-language-audit.sql'
 WHERE card_slug IN ('8330138', '8076785')
   AND provider  = 'pricecharting'
   AND language != 'jp';

-- Verification query (run after the UPDATE — expect two rows with
-- language='jp' and the audit note in notes_internal):
--   SELECT card_slug, language, notes_internal
--     FROM public.provider_card_links
--    WHERE card_slug IN ('8330138','8076785');
