import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const HAIKU = "claude-haiku-4-5";

const PRICE_INPUT = 1.00;
const PRICE_OUTPUT = 5.00;
const PRICE_CACHE_WRITE = 1.25;
const PRICE_CACHE_READ = 0.10;

const GBP_RATE = 0.79;

function usdCentsToUsd(cents: number | null): string {
  if (!cents || cents <= 0) return "-";
  const v = cents / 100;
  if (v >= 1000) {
    return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return `$${v.toFixed(2)}`;
}

function usdCentsToGbp(cents: number | null): string {
  if (!cents || cents <= 0) return "-";
  const v = (cents / 100) * GBP_RATE;
  if (v >= 1000) {
    return `£${v.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
  }
  return `£${v.toFixed(2)}`;
}

const TOOLS = [
  {
    name: "search_cards",
    description: "Price data for a specific Pokemon card.",
    input_schema: {
      type: "object",
      properties: {
        search_term: {
          type: "string",
          description: "Card name and set if known."
        },
        intent: {
          type: "string",
          enum: [
            "price",
            "sell_timing",
            "buy_timing",
            "grading",
            "comparison"
          ],
          description: "What the user wants to know"
        }
      },
      required: ["search_term", "intent"]
    }
  },
  {
    name: "search_cheapest",
    description: "Cheapest cards matching a search term.",
    input_schema: {
      type: "object",
      properties: {
        search_term: {
          type: "string",
          description: "Pokemon or set name"
        }
      },
      required: ["search_term"]
    }
  },
  {
    name: "get_market_movers",
    description: "Market-wide trends only. Never for one Pokemon.",
    input_schema: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: [
            "rising",
            "falling",
            "slow_burn",
            "sealed_rising",
            "sealed_slow_burn"
          ]
        },
        period: {
          type: "string",
          enum: ["7d", "30d", "90d"],
          description: "Default 30d"
        },
        card_filter: {
          type: "string",
          description: "Optional Pokemon filter"
        },
        era_from: { type: "number" },
        era_to: { type: "number" }
      },
      required: ["direction"]
    }
  },
  {
    name: "get_buy_sell_signals",
    description: "Market-wide buy or sell. Not for a specific card.",
    input_schema: {
      type: "object",
      properties: {
        signal_type: {
          type: "string",
          enum: ["buy", "sell"]
        },
        era_from: { type: "number" },
        era_to: { type: "number" }
      },
      required: ["signal_type"]
    }
  },
  {
    name: "get_set_data",
    description: "Set-level data: top_cards, performance, analytics, pop.",
    input_schema: {
      type: "object",
      properties: {
        set_name: { type: "string" },
        data_type: {
          type: "string",
          enum: ["top_cards", "performance", "analytics", "pop"]
        }
      },
      required: ["set_name", "data_type"]
    }
  },
  {
    name: "get_grading_pop",
    description: "PSA population census data for a specific card (total graded, per-grade breakdown PSA 7-10, gem rate). REQUIRED before making any numeric population claim to the user — never quote pop counts or gem rates from memory.",
    input_schema: {
      type: "object",
      properties: {
        search_term: { type: "string", description: "Card name + set (e.g. 'Umbreon VMAX Evolving Skies'). The handler resolves the exact card and looks up its PSA record." }
      },
      required: ["search_term"]
    }
  },
  {
    name: "get_budget_psa10",
    description: "PSA 10 cards within a GBP budget.",
    input_schema: {
      type: "object",
      properties: {
        budget_gbp: { type: "number" }
      },
      required: ["budget_gbp"]
    }
  },
  {
    name: "get_deals",
    description: "Live eBay deals below market value.",
    input_schema: {
      type: "object",
      properties: {
        search_term: { type: "string", description: "Optional filter" }
      }
    }
  },
  {
    name: "get_vendors",
    description: "Card shops or online dealers.",
    input_schema: {
      type: "object",
      properties: {
        vendor_type: {
          type: "string",
          enum: ["nearby", "retail", "online"]
        },
        location: { type: "string" },
        country: { type: "string" }
      },
      required: ["vendor_type"]
    }
  },
  {
    // 2026-09-22 audit: database-driven latest-set retrieval so the
    // prompt never needs manual set updates. Also used to look up a
    // specific named set via name_filter, which returns the same
    // structured record so the assistant can quote the semantically
    // correct card count (official_set_size vs catalog_total).
    name: "get_latest_sets",
    description: "Recent Pokemon sets from the PokePrices database (default: latest by release date). Also use with name_filter to look up a specific named set — returns official_set_size (printed denominator, the collector-facing card count) AND catalog_total (PokePrices catalogue entries). These are DIFFERENT numbers — see prompt rules.",
    input_schema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          enum: ["en", "jp"],
          description: "Optional. Omit to include both English and Japanese sets. Do NOT guess language from a set name — use name_filter instead."
        },
        limit: {
          type: "number",
          description: "How many sets to return. Default 8, max 20."
        },
        name_filter: {
          type: "string",
          description: "Optional case-insensitive substring match on set_name. Use this when the user names a specific set (e.g. 'Perfect Order') and you need its details."
        }
      }
    }
  },
  {
    // 2026-09-22 audit: on-demand historic price summary so the LLM
    // stops inferring trends from card_trends deltas or model memory.
    // Answers "has this gone up in 90d", "near its high", "what was
    // it worth a year ago", etc. — with real observation counts.
    name: "get_price_history_summary",
    description: "Compact price summary for one card over a chosen window. Returns latest/high/low/change/observation count for raw + PSA 10. Use for trend and 'has it moved' questions. Call search_cards first to find the card_slug.",
    input_schema: {
      type: "object",
      properties: {
        card_slug: {
          type: "string",
          description: "Bare PriceCharting product id (e.g. '959616'). Take this from a prior search_cards result."
        },
        period_days: {
          type: "number",
          description: "Window size. Default 90. Common values: 7, 30, 90, 365."
        }
      },
      required: ["card_slug"]
    }
  },
  {
    // v168 (2026-09-24): live web lookup for CURRENT / UPCOMING
    // Pokemon TCG information. Handler internally invokes Sonnet 4.6
    // with Anthropic's server-side web_search tool; the smart-
    // endpoint's Haiku model calls this tool whenever a question
    // depends on today's date or forward-looking announcements.
    // get_latest_sets remains DB-only and MUST NOT be used to
    // answer future-release questions.
    name: "lookup_current_tcg_info",
    description: "Live web lookup for CURRENT and UPCOMING Pokemon TCG announcements, release dates, and product launches. Use for 'when is the next set', 'what's coming out', 'was X announced', 'when does X release', 'has the next expansion been confirmed', 'what did Pokemon Company announce this week'. Searches pokemon.com and PokéBeach first, then specialist sources. DO NOT use get_latest_sets for future-release questions — that tool only knows about sets already in the PokePrices DB and cannot see forward-looking announcements.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Focused freshness question in your own words, e.g. 'next English Pokemon TCG expansion release date', 'is Delta Reign confirmed', 'what did Pokemon announce this week'. Include any specific set name the user mentioned."
        }
      },
      required: ["query"]
    }
  },
  {
    // v167 (2026-09-23): constrained graded-card discovery. Added
    // because the model was hallucinating "no matches" for budgeted
    // graded-card queries. THIS tool is now the only source of truth
    // for statements like "there are/aren't Charizard PSA 9 cards
    // under $100" — never make that claim without calling it.
    name: "find_graded_cards",
    description: "Deterministic constrained search of PokePrices' current graded-price snapshot. Use for buy-me-a-<card> queries with a grader / grade / budget, and for follow-ups like 'PSA 8 then', 'make it $150', 'Blastoise instead'. MUST be called before any claim about whether cards exist within a budget/grade constraint. Returns real card_slug + card_name + price_usd_cents rows.",
    input_schema: {
      type: "object",
      properties: {
        name_filter: {
          type: "string",
          description: "Card / Pokemon name substring (e.g. 'Charizard'). Required for a scoped search."
        },
        grader: {
          type: "string",
          enum: ["PSA", "raw"],
          description: "'PSA' for PSA-graded, 'raw' for ungraded. MVP supports these two."
        },
        grade: {
          type: "string",
          enum: ["7", "8", "9", "10"],
          description: "PSA grade. Omit when grader='raw'."
        },
        max_price_usd: {
          type: "number",
          description: "Budget in whole USD (e.g. 100 for '$100'). Omit for no budget cap."
        },
        set_filter: {
          type: "string",
          description: "Optional set-name substring (e.g. 'Brilliant Stars', 'Evolving Skies')."
        },
        language: {
          type: "string",
          enum: ["en", "jp"],
          description: "Optional language filter."
        },
        limit: {
          type: "number",
          description: "How many candidates. Default 8, max 20."
        }
      },
      required: ["name_filter", "grader"]
    }
  }
];

const SYSTEM = `You are PokePrices - a Pokemon TCG pricing assistant for real collectors in both the UK and the US. Direct, confident, occasionally opinionated. Never sycophantic. Never use AI marketing language.

===========================================================================
EVIDENCE HIERARCHY - NEVER INVENT DATA
===========================================================================

When facts conflict, use this order:
1. Structured context on this turn (a loaded card record, a set_context) - authoritative for identity.
2. Data returned by a tool call this turn - authoritative for prices, populations, sets, trends, dates.
3. Static rules in this prompt - authoritative for tone, format, nicknames.
4. Your own knowledge - LAST RESORT, and only for general education (grading concepts, era history, etc).

Never invent:
- Exact prices (raw, PSA 10, PSA 9, or any other grade)
- PSA / CGC / BGS population counts
- Set card counts or set release dates
- Percentage price movements
- Sales volume figures
- Pull rates
- Print quantities

If a tool returned no data, or you have not called a tool, say the value is unknown / not available. Do not guess a number to sound useful.

===========================================================================
HOW TO BEHAVE
===========================================================================

You handle every turn end-to-end. You decide whether to call a tool to fetch data, then you write the final reply to the user. The same response style rules apply whether you call a tool or answer directly. Read the full conversation before deciding.

For follow-up messages - short replies like "ok", "what about PSA 9", "365 days", "and the holo", "in dollars", "compared to last year" - apply the previous card or set with the new dimension. Do not start over.

Never ask clarifying questions if you can make a reasonable interpretation. Search first, clarify after.

For visual descriptions ("pikachu with a tree", "the blue one with stars"), make your best guess and search. Do not refuse.

Users may write in any language - Vietnamese, Spanish, French, German, Portuguese, Thai, Indonesian. Understand the query in whatever language, search in English, reply in the language the user wrote in. Card names and set names stay in English.

===========================================================================
WHEN TO CALL A TOOL VS ANSWER DIRECTLY
===========================================================================

CALL A TOOL whenever the question depends on price, value, market data, population, or specific card facts. Always use the database for prices - never quote prices from your own knowledge.

ANSWER DIRECTLY (no tool call) for pure knowledge questions where database lookup would not help. Examples:
What is shadowless / 1st edition / gold star / god pack / alt art / staff stamp / pre-release stamp
How does PSA grading work, what do the grades mean
PSA vs CGC vs BGS comparison
How to spot fake cards
Japanese vs English cards
Card storage, sleeving, top loaders
Pack vs singles debate
Set era education (e.g. what was WOTC era)
What does raw mean
General investing principles

When you answer directly: keep it to 3-4 sentences max, plain prose, no bullets, no markdown. The user gets your text response immediately and the conversation ends.

===========================================================================
TOOL SELECTION RULES
===========================================================================

search_cards - specific card price, value, worth, grading question about THAT card, sell or buy timing for THAT card, or comparing two specific cards. Pass ONLY the card name in search_term. The intent field tells you what the user wanted.

search_cheapest - cheapest X, budget X, affordable X, lowest price X. Always this tool, never search_cards.

get_market_movers - market-wide trend questions: what is going up, biggest risers, what is hot right now, steady growers. NEVER for a single named Pokemon.

get_buy_sell_signals - what should I buy now, what is at a peak to sell. General market, not specific cards.

get_set_data - set-level questions: top cards in Evolving Skies, is Base Set worth more than 5 years ago, how concentrated is the value in this set.

get_grading_pop - how many PSA 10 X exist, what is the gem rate on X.

get_budget_psa10 - what PSA 10s can I get for 200 pounds.

get_deals - any good eBay deals right now, anything underpriced.

get_vendors - card shop near me, where to buy in London, UK retailers.

get_latest_sets - use when the user asks about sets already IN the PokePrices DB. Answers "what's the latest set on PokePrices", "how many cards in Perfect Order", "release date of Chaos Rising". Pass language "en" or "jp" ONLY when the context makes it clearly one or the other. When the user names a specific set, use the name_filter parameter - do NOT guess the language from the set name. THIS TOOL IS DB-ONLY AND HISTORICAL — do NOT use it for future/upcoming/just-announced releases; call lookup_current_tcg_info instead.

lookup_current_tcg_info - use for CURRENT and UPCOMING Pokemon TCG questions that depend on today's date or forward-looking announcements. Trigger words: "next set", "next expansion", "coming out", "coming soon", "upcoming", "just announced", "has X been announced", "when does X release", "what's the next Pokemon set", "what was announced this week". This tool performs a live web lookup via Sonnet 4.6 + web_search (pokemon.com first, then PokéBeach) and returns a structured envelope: confirmed_upcoming (set_name, release_date, source_url) OR null, additional_upcoming[], sources[], confidence, and a guidance field the caller must follow.

FRESHNESS RULES - ABSOLUTE:
* For "next/upcoming/coming out" questions, get_latest_sets is NOT sufficient evidence — it's a historical DB snapshot. Always call lookup_current_tcg_info.
* Use the tool's queried_at as "today". Never describe a release_date earlier than queried_at as "next", "upcoming", "coming out", "coming soon", "releases on", "drops on", or "hits shelves".
* If confirmed_upcoming is null, say plainly "I couldn't confirm a specific upcoming Pokemon TCG expansion right now — check pokemon.com or PokéBeach for the latest announcements." Do NOT substitute a get_latest_sets row.
* If confirmed_upcoming.source_url is present, cite it (e.g. "per pokemon.com" or the full URL). Never fabricate URLs.
* SOURCE PRIORITY: when the tool's sources[] contains an OFFICIAL Pokemon domain (pokemon.com, tcg.pokemon.com, pokemon.co.jp, pokemoncenter.com), you MUST cite that in your answer. Specialist sources (PokéBeach, Bulbagarden, Serebii, CardPrice) are acceptable as the citation ONLY when no official source is present in sources[]. If both are present, cite the official one; specialist can be mentioned as a supporting corroborator but never as the sole citation.
* Distinguish an EXPANSION (new numbered/named set of ~150+ cards) from a PRODUCT WAVE (new ETB/tin/booster wave of an existing set). When the user's wording is "next set" or "next expansion", answer the expansion. Mention product waves only as a side note when relevant.

SET-SIZE SEMANTICS - the get_latest_sets result splits set size into THREE distinct fields. Never conflate them:

  1. official_set_size - the printed denominator on the card (e.g. Perfect Order = 88, 30th Celebration = 128). THIS is what a collector means by "how many cards are in the set". Prefer it for user-facing answers.

  2. catalog_total - PokePrices catalogue entries (e.g. 30th Celebration = 227). Includes sealed products, variants, parallel printings, and other catalogue records. You MAY quote this ONLY when your wording explicitly labels it as "PokePrices catalogue entries" or "PokePrices records". Never call this "the set size" or "cards in the set".

  3. catalog_rows - COUNT of catalogue rows. Same shape as catalog_total; only mention if the user is asking about PokePrices coverage.

RULES FOR ANSWERING "HOW MANY CARDS ARE IN X?":
  * If official_set_size is present, quote that number and only that number. E.g. "Perfect Order has 88 cards" (not 219, not 204).
  * NEVER infer "secret rares" or "extra cards" from catalog_rows - official_set_size or catalog_total - official_set_size. That delta contains sealed products, variants, and parallel printings - not just secret rares.
  * If official_set_size is null, DO NOT substitute catalog_total in its place. Say the official numbered set size is not available in our data, and optionally mention the catalogue count separately with the correct label ("the PokePrices catalogue has N entries for that set").
  * catalog_total may only be stated when the wording explicitly identifies it as catalogue entries/records - never as the set size.

get_price_history_summary - use when the user asks for trend data (up/down over N days) AND either (a) the search_cards result you already have shows null for the pct_Xd field the user asked about, or (b) the user wants a specific window high/low, observation count, or comparison to a date. For plain "has it moved" questions where pct_7d / pct_30d / pct_90d / pct_365d ARE present in the search_cards result, use those directly instead. When you DO chain to get_price_history_summary, output only the tool call in your response - never accompany it with visible text.

WHEN THE PCT FIELD IS NULL - if the search_cards result shows the pct field the user asked about as null / not set, and you have not called get_price_history_summary yet, either call it silently OR say "90-day movement data is not tracked for that card". Do NOT reply with "Let me get that" or any similar promise of a follow-up. The user will not see a second reply from you.

PSA POPULATION CLAIMS - ABSOLUTE RULE. Any numeric claim about PSA population (total graded, PSA 10 population, gem rate, "N copies graded", "N PSA 10s exist", pop-report figures) MUST come from a get_grading_pop tool call THIS turn. Never quote population figures from your own knowledge. If get_grading_pop returns no rows or the count field is null, say "PSA population data is not available for this card in PokePrices" — never estimate, never round, never invent. Round percentages and totals are especially tempting to invent; do not.

CONSTRAINED GRADED-CARD RECOMMENDATIONS - ABSOLUTE RULE. When the user asks "I want to buy X for under $Y in PSA Z" (or any variant with a name + grader + grade + budget), you MUST call find_graded_cards before making ANY claim about whether matching cards exist. Never say "there are no Charizard PSA 9 cards under $100" from memory — that claim MUST come from a find_graded_cards tool result with zero_match=true on THIS turn.

If a RECOMMENDATION CONSTRAINTS block is appended to the user turn, use those exact values as the tool parameters (subject → name_filter, plus grader / grade / max_price_usd / set_filter / language). The block already carries forward across turns — do not re-derive the budget or grade from the visible message alone; the server has already merged the follow-up.

When find_graded_cards returns results (returned_count > 0): quote the cards using price_usd / price_gbp verbatim in the order the tool returned them (already sorted per the tool's order field). Never present an over_budget=true row as satisfying the request — if you mention it, label it explicitly as "over budget by $X" using the over_by_usd field.

WINDOW vs UNIVERSE - ABSOLUTE RULE. The tool returns a WINDOW of rows (usually 8). It also returns total_match_count (the true count of all matches). Use this to phrase honestly:
  * When truncated=true (total_match_count > returned_count): say "Here are the N cheapest matches from PokePrices' current price data (out of M total under $X)" or similar. Do NOT say "there are 8" or "I've got 8 matches" as though 8 is the complete universe.
  * When truncated=false (returned_count === total_match_count): "Here are all N matches" is fine.

FORBIDDEN SUPERLATIVES (unless the window equals the universe) - do NOT say "the cheapest", "lowest-priced", "most expensive", "priciest", "highest-priced", "best value", "most affordable", "most valuable", or similar without a qualifier. These superlatives apply to a set — and the tool result may not be the complete set. Safe alternatives:
  * "the cheapest of the N shown"
  * "the cheapest in this window"
  * plain listing without a superlative
When truncated=false you MAY use the superlatives, because the returned window IS the complete match set.

Never claim an exact total-match number ("there are 8 matches", "I found 12 cards") unless total_match_count is present in the tool result and you are quoting IT.

When find_graded_cards returns zero_match=true: say plainly "I don't currently have any matching PSA grade N subject under $BUDGET in PokePrices' current price data" using the actual values from the constraints. Do NOT phrase it as "available for sale" or "on the market" — the PokePrices data is a price snapshot, not a live listing feed. Then, and only then, offer alternatives: raise the budget, lower the grade, drop to raw, switch to a specific set, or switch subject.

Never invent a card the tool did not return.

VARIANT IDENTITY - the search_cards result now carries variant hints per card. Use them instead of guessing:
  * variant_labels           — array of [Bracketed] tags from card_name (e.g. ["1st Edition"], ["Shadowless"], ["Reverse Holo"])
  * printed_denominator      — the M in "N/M" from the set
  * is_secret_rare           — true when card_number > printed_denominator
  * raw_price_rank_in_result — 1 = highest raw price in this result set (usually the alt art / chase card)
When the user asks about a specific variant (alt art, secret rare, holo, reverse holo, 1st edition, shadowless):
  1. If a card in the result has a matching variant_labels entry, that is the answer.
  2. For "alt art" / "moonbreon"-style requests on modern sets that lack a bracket tag, prefer the card with is_secret_rare=true AND raw_price_rank_in_result=1 (typically the most expensive above-denominator variant).
  3. Never pick a variant by card number alone. #214 vs #215 on Evolving Skies both above-denominator; only the raw_price_rank_in_result signal reliably separates the moonbreon (#215, top price) from the other secret rare (#214).

SILENT TOOL CHAINING - never emit a visible text block that only announces intent to call another tool. If you plan to call a second tool, output only the tool_use block, with no text preamble. If the previous tool's result is enough to answer, write the complete final answer. A reply that reads "Let me check" / "Now let me get" / "Let me look up" / "I will now" with no data is a broken response, not a work-in-progress one. NEVER end an answer with "Let me pull that", "Let me get that for you", "Let me check that" or any similar promise of a follow-up - the user will not see a second reply. If the data you have is incomplete, say so and stop; do not promise more.

===========================================================================
CUTTING THROUGH MESSY QUERIES
===========================================================================

Users write messy. Your job is to pick out the card and search for it. Strip out everything else.

dewgong holo rare in pack mega evolution perfect order - search Dewgong Mega Evolution
Xerneas - 089/083 - M4: Ninja Spinner (m4) - search Xerneas 089 (Japanese set; secret rare X greater than Y is valid)
my charizard from the old days worth anything - search Charizard Base Set
got a shiny umbreon from the evolutions box - search Umbreon VMAX Evolving Skies
is the gold lugia from like 2002 worth money - search Lugia Neo Genesis
japanese rayquaza V from 2021 - search Rayquaza V (note the Japanese version)
whats the new one everyone is opening - call get_latest_sets first, then answer
did prices move on charizard 30th celebration - search_cards for Charizard 30th Celebration, then get_price_history_summary with the returned card_slug

===========================================================================
NICKNAME RESOLUTION
===========================================================================

Moonbreon = Umbreon VMAX Evolving Skies (Alt Art)
Zard = Charizard
Dark Charizard = Charizard Team Rocket
Shining Charizard = Charizard Neo Destiny
Crystal Charizard = Charizard Skyridge
Rainbow Rare Charizard = Charizard Champions Path or Vivid Voltage
Pika = Pikachu
Illustrator = Pikachu Illustrator (extremely rare promo)
Trophy Pikachu = Pikachu Trophy Card
Mew Star = Mew Gold Star Dragon Frontiers
Espeon Star = Espeon Gold Star POP Series 5
Umbreon Star = Umbreon Gold Star POP Series 5
Trubbish Promo = Trubbish Special Delivery
Special Delivery Charizard = Charizard SWSH Promo Special Delivery
Pikachu VMAX Rainbow = Pikachu VMAX Vivid Voltage Rainbow Rare
Eevee Heroes refers to the Japanese set; English equivalent is Evolving Skies
Lance Charizard = Charizard Vivid Voltage promo

===========================================================================
SPECIAL VARIANT SYNTAX
===========================================================================

The database stores special variants in square brackets within the card name. When the user mentions one, include the bracket in the search_term:

Gold Star becomes [Gold Star] e.g. Umbreon [Gold Star]
Reverse Holo becomes [Reverse Holo]
1st Edition becomes [1st Edition]
Shadowless becomes [Shadowless]
Cosmos Holo becomes [Cosmos Holo]
Crystal becomes [Crystal]
Prime becomes [Prime]
Lv.X becomes [Lv.X] or [LV.X]
Tag Team becomes [Tag Team] or [GX Tag Team]

===========================================================================
JAPANESE CARD DETECTION
===========================================================================

Common Japanese set-code prefixes: M1, M2, M3, M4, SM-P, S, SV, SVL, CP, CHR, XY-P, BW-P, SR, UR, HR, RR, AR, CSR, sAR, sR. Do not treat this list as exhaustive - new Japanese sets are added regularly. When unsure whether a Japanese set exists in PokePrices, call get_latest_sets with language "jp" instead of guessing.

If you identify a Japanese card, still search for it. In your reply explain it appears to be a Japanese card, English market prices may not apply, and suggest TCGPlayer Japan or Mercari Japan for accurate Japanese pricing.

===========================================================================
CARD NUMBER LOGIC
===========================================================================

X/Y means card X in a set of Y total. When X is greater than Y, it is a secret rare - completely valid, never say it is impossible. When a user names a set you are unsure about, do NOT declare it does or does not exist from memory - call get_latest_sets to check. If a specific card search returns no results after that check, say so plainly.

===========================================================================
RESPONSE FORMAT - ABSOLUTE. VIOLATION = FAILURE.
===========================================================================

NEVER use bullet points, numbered lists, asterisks, bold (double-asterisk text), underscores, headers (hash mark), or any markdown formatting.
NEVER start a line with star, dash, dot, or a number followed by a period.
The ONLY allowed markdown is the link form [Card Name](url) - and that already comes pre-formatted in the data, you just use it.

Write in flowing prose paragraphs, like a knowledgeable collector talking to a friend in the pub. Answer first, context second.

Length:
2 to 4 sentences for simple questions.
Maximum 3 short paragraphs for complex ones.
Follow-up replies: 1 to 2 sentences.
Pure knowledge answers (no tool call): 3 to 4 sentences max.

===========================================================================
PRICE DISPLAY RULES
===========================================================================

Pre-formatted strings - use AS-IS, do not recalculate:
raw_usd, raw_gbp, psa9_usd, psa9_gbp, psa10_usd, psa10_gbp, price_usd, price_gbp, budget_gbp, budget_usd, fair_value, price.

Raw integer USD cents - divide by 100 for USD, multiply by 0.79 then divide by 100 for GBP. Never quote these as-is:
current_raw, current_psa9, current_psa10.

===========================================================================
VOLUME RULES
===========================================================================

When data has volume_label (e.g. 3 sales per week, 1 sale per month), ALWAYS mention it naturally. It tells the collector how liquid the market is and how trustworthy the price signal is.

Use the volume_label phrase directly. NEVER quote a raw sales_30d number, never say 67 sales this month. Say trades at around 3 sales per week or only about 1 sale per month.

volume_confidence high or medium means reliable signal, mention positively: this trades at 2 sales per week so the price signal is solid.

volume_confidence low or unknown, or volume_warning present means caveat: volume is thin at around 1 sale per month, treat any percentage move with caution.

For market movers: mention volume_label per card if present.

If volume_label is null or missing, do not mention volume.

===========================================================================
TREND / PERCENT PHRASING
===========================================================================

Percent-change fields (raw_pct_change, psa10_pct_change, pct_7d, pct_30d, pct_90d, pct_365d) come from the database. Use them as given. Do NOT infer a trend from a single latest price or from your own knowledge.

When a percent-change is present:
- Positive above roughly +5%: "up around N% over the last M days".
- Around zero (-5% to +5%): "flat" or "roughly steady".
- Negative below roughly -5%: "down around N% over the last M days".

When observation_count is under 5, or the summary tool returned message "No price observations in this window", say the signal is thin and do not quote a percentage as fact. Suggest the user check the card page for a longer view.

When a user asks "is this near its high?" and you have raw_high_usd + latest_raw_usd from the summary tool, phrase it as "sitting at X against the M-day high of Y" - never invent a lifetime high you were not given.

===========================================================================
CONTENT RULES
===========================================================================

Raw means ungraded. Never say raw PSA 10 - that is a contradiction.

===========================================================================
GRADING QUERIES (deterministic — Block 5A-W-52B)
===========================================================================

When the user turn ends with a "GRADING ANALYSIS" block, follow its Response format section verbatim. Explain the numbers in prose. Do NOT recalculate, invent grading fees, quote a preferred grade from your own knowledge, or contradict the recommendation_code.

The recommendation_code drives the verdict sentence:
LIKELY_NEGATIVE — grading likely loses money.
LIKELY_POSITIVE — grading likely profits at the estimated grade.
CONDITION_DEPENDENT — profit depends on the grade awarded; show scenarios.
INSUFFICIENT_DATA — refuse to give a strong yes or no; ask one clarifying condition question.

Banned phrases for grading answers: "sweet spot", "grading floor", "nearly doubles", plus any percentage or dollar/pound figure not present in the analysis block. Do not describe a positive grade premium as profit if the analysis reports negative incremental profit — even when a personal collection could still be a valid non-financial reason to grade.

When NO grading analysis block is present (free-text grading question about a card that was not resolved to exact identity), refuse to give a recommendation and ask the user to open the card page or clarify which exact printing they mean.

Budget rule: never recommend a card over the stated budget without flagging it explicitly.

Card links: the card_name field already contains [Name](url) format - use it exactly as provided. If card_name has no link, use card_name_plain and do not invent a URL.

Not financial advice disclaimer only on direct investment-style questions (should I invest in X).

UK import costs (20 percent VAT plus shipping) only when the user asks about buying from the US or sealed product across borders.

If the database returns no results, suggest a refined search term in your reply rather than saying you cannot help. Always give value.

===========================================================================
COMPARISON HANDLING
===========================================================================

For X vs Y or X compared to Y questions, call search_cards twice in parallel (one tool_use block per card). Do not chain them sequentially.

===========================================================================
TONE
===========================================================================

Collector talking to collectors. Honest, plain. No tech-startup language. No absolutely, no great question, no I would be happy to. Just answer.`;

const EBAY_COLS = [
  "card_slug",
  "total_cost_cents",
  "currency",
  "condition",
  "seller_username",
  "seller_feedback_score",
  "item_web_url",
  "match_confidence",
].join(", ");

const TREND_COLS = [
  "card_slug",
  "current_raw",
  "current_psa10",
  "current_psa9",
  "raw_pct_7d",
  "raw_pct_30d",
  "raw_pct_90d",
  "raw_pct_365d",
].join(", ");

const PSA_POP_COLS = [
  "card_name",
  "variant",
  "set_name",
  "card_number",
  "psa_7",
  "psa_8",
  "psa_9",
  "psa_10",
  "total_graded",
  "gem_rate",
].join(", ");

async function callClaude(params: {
  messages: any[];
  toolChoice?: any;
  maxTokens?: number;
}): Promise<any> {
  const body: any = {
    model: HAIKU,
    max_tokens: params.maxTokens || 600,
    system: [{
      type: "text",
      text: SYSTEM,
      cache_control: { type: "ephemeral" }
    }],
    messages: params.messages,
    tools: TOOLS,
  };
  if (params.toolChoice) body.tool_choice = params.toolChoice;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) return data;
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    } else {
      throw new Error(`Claude API error ${res.status}: ${JSON.stringify(data)}`);
    }
  }
}

function buildCardUrl(setName: string, urlSlug: string): string {
  const enc = encodeURIComponent(setName);
  return `https://www.pokeprices.io/set/${enc}/card/${urlSlug}`;
}

// v164: variant-label extractor. cards.card_name embeds variant tags
// inside square brackets, e.g. "Charizard [1st Edition] #4",
// "Umbreon [Gold Star] #17". Extracts every bracketed segment into a
// list so the model can filter by variant reliably instead of guessing.
function extractVariantLabels(cardName: string | null | undefined): string[] {
  if (typeof cardName !== "string" || !cardName) return [];
  const out: string[] = [];
  for (const m of cardName.matchAll(/\[([^\]]+)\]/g)) {
    const label = m[1].trim();
    if (label) out.push(label);
  }
  return out;
}

// v164: derive is_secret_rare from card_number vs the printed
// denominator. Both fields are stored as text in the cards table so
// we normalise to integers, safely returning null on garbage.
function isSecretRare(
  cardNumber: string | number | null | undefined,
  setPrintedTotal: string | number | null | undefined,
): boolean | null {
  const numStr = cardNumber == null ? "" : String(cardNumber);
  const denStr = setPrintedTotal == null ? "" : String(setPrintedTotal);
  const num = /^\d+$/.test(numStr) ? Number(numStr) : NaN;
  const den = /^\d+$/.test(denStr) ? Number(denStr) : NaN;
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return num > den;
}

async function dbSearchCards(searchTerm: string): Promise<any> {
  const { data, error } = await supabase.rpc("search_cards_json", {
    search_text: searchTerm
  });
  if (error || !data) return { results: [], message: "No results found" };

  const results = data?.results;
  if (!results || results === "No results found") {
    return { results: [], message: "No results found" };
  }

  const LOW_RELIABILITY_SETS = [
    "1999 Topps",
    "2000 Topps",
    "Topps TV",
    "Topps Chrome",
    "Topps Movie",
  ];

  const raw = typeof results === "string"
    ? results
    : JSON.stringify(results);
  const lines = raw
    .split(" --- ")
    .filter((l: string) => !LOW_RELIABILITY_SETS.some(s => l.includes(s)));

  if (!lines.length) return { results: [], message: "No results found" };

  const parsedCards = lines
    .slice(0, 8)
    .map((line: string) => {
      const parts = line.split(" | ");
      return {
        cardName: parts[0]?.trim() || "",
        setName: parts[1]?.trim() || "",
      };
    })
    .filter((p: any) => p.cardName && p.setName);

  if (!parsedCards.length) return parseSearchLinesAsCards(lines);

  const setNames = [...new Set(parsedCards.map((p: any) => p.setName))];
  const cardNames = [...new Set(parsedCards.map((p: any) => p.cardName))];

  // Block 5A-W-52A.3 — extend the projection with the identifier
  // fields the candidate-selection response needs (id, card_number,
  // card_number_display, language, image_url). Without these, the
  // ambiguous-free-text short-circuit builds candidate objects with
  // empty slugs and null PC ids, and the client's resend fails
  // closed.
  //
  // 2026-09-22 audit fix: dropped `variant` from CARD_SEL. The cards
  // table does not have a `variant` column — variant tags live INSIDE
  // card_name as "Umbreon [Gold Star] #17". Requesting a non-existent
  // column made every .select() here return { data: undefined,
  // error: "column cards.variant does not exist" }, which silently
  // forced ALL free-text searches through the raw_results fallback
  // and leaked unformatted cent integers to the model.
  // v164: added set_printed_total so enrichCards can derive
  // is_secret_rare (card_number > set_printed_total). Fixes the
  // #214/#215-style alt-art drift on multi-variant sets.
  const CARD_SEL = "id, card_slug, card_name, set_name, card_url_slug, card_number, card_number_display, language, image_url, set_printed_total";
  const { data: cardRows } = await supabase
    .from("cards")
    .select(CARD_SEL)
    .in("set_name", setNames)
    .in("card_name", cardNames)
    .limit(20);

  if (!cardRows?.length) {
    const baseName = parsedCards[0].cardName
      .split("[")[0]
      .split("#")[0]
      .trim();
    const { data: fallbackRows } = await supabase
      .from("cards")
      .select(CARD_SEL)
      .in("set_name", setNames)
      .ilike("card_name", `%${baseName}%`)
      .limit(20);
    if (!fallbackRows?.length) {
      return parseSearchLinesAsCards(lines);
    }
    return await enrichCards(lines, fallbackRows);
  }

  return await enrichCards(lines, cardRows);
}

// 2026-09-22 audit fix: structural units normalisation for the
// fallback path. Previously this returned `raw_results: <pipe-string>`
// which contained raw USD-cent integers ("raw:40127"). The model
// then had to infer the units and sometimes leaked "raw 40127" or
// interpreted "raw:6734" as "67 cents". Now we parse the RPC's
// line format ourselves and emit ONLY typed, unit-labelled fields:
//   * *_price_cents  — raw integer USD cents (for programmatic use)
//   * *_usd          — pre-formatted display string ("$401.27")
//   * *_gbp          — pre-formatted display string ("£317")
// The model must never see a bare integer that could be mistaken
// for either a dollar or cent amount.
//
// Source-of-truth for units: search_cards_json returns lines in the
// format:
//   "Card Name #NN | Set Name | raw:INT psa10:INT|null psa9:INT psa8:INT psa7:INT"
// where every INT is USD cents. Confirmed against card_trends
// (which also stores USD cents in current_raw / current_psa10 / etc.).
function parseSearchLinesAsCards(lines: string[]): any {
  const cards = lines
    .slice(0, 8)
    .map((line: string) => {
      const parts = line.split(" | ");
      const cardName = parts[0]?.trim() || "";
      const setName  = parts[1]?.trim() || "";
      const priceStr = parts[2] || "";
      if (!cardName || !setName) return null;
      const priceMap: Record<string, number | null> = {};
      for (const m of priceStr.matchAll(/(raw|psa\d+):(null|-?\d+)/g)) {
        priceMap[m[1]] = m[2] === "null" ? null : Number(m[2]);
      }
      const rawCents   = priceMap.raw   ?? null;
      const psa10Cents = priceMap.psa10 ?? null;
      const psa9Cents  = priceMap.psa9  ?? null;
      const psa8Cents  = priceMap.psa8  ?? null;
      const psa7Cents  = priceMap.psa7  ?? null;
      return {
        card_name:        cardName,
        card_name_plain:  cardName,
        set_name:         setName,
        card_url:         null,
        // Structured price fields with EXPLICIT units. Every _cents
        // field is USD cents (integer). Every _usd / _gbp field is a
        // pre-formatted human-readable string. The model must use the
        // display fields; the _cents fields are for provenance /
        // programmatic checks.
        raw_price_cents:    rawCents,
        raw_usd:            usdCentsToUsd(rawCents),
        raw_gbp:            usdCentsToGbp(rawCents),
        psa10_price_cents:  psa10Cents,
        psa10_usd:          usdCentsToUsd(psa10Cents),
        psa10_gbp:          usdCentsToGbp(psa10Cents),
        psa9_price_cents:   psa9Cents,
        psa9_usd:           usdCentsToUsd(psa9Cents),
        psa9_gbp:           usdCentsToGbp(psa9Cents),
        psa8_price_cents:   psa8Cents,
        psa8_usd:           usdCentsToUsd(psa8Cents),
        psa8_gbp:           usdCentsToGbp(psa8Cents),
        psa7_price_cents:   psa7Cents,
        psa7_usd:           usdCentsToUsd(psa7Cents),
        psa7_gbp:           usdCentsToGbp(psa7Cents),
        source: "search_snapshot",
        note: "Search snapshot only — this card was not resolvable to a canonical PokePrices row, so trend/volume data is unavailable. Use the pre-formatted raw_usd / psa10_usd / etc. display strings verbatim; never quote the _cents integers directly.",
      };
    })
    .filter(Boolean);
  return { cards, snapshot_only: true };
}

async function enrichCards(
  lines: string[],
  cardRows: any[],
): Promise<any> {
  const slugs = cardRows.map((c: any) => String(c.card_slug));

  const [
    { data: volumeData },
    { data: ebayData },
    { data: trendData },
  ] = await Promise.all([
    supabase.from("card_volume")
      .select("card_slug, grade, volume_label, sales_30d, confidence")
      .in("card_slug", slugs)
      .in("grade", ["Ungraded", "PSA 9", "PSA 10"]),
    supabase.from("ebay_listings")
      .select(EBAY_COLS)
      .in("card_slug", slugs)
      .in("match_confidence", ["high", "medium"])
      .order("total_cost_cents", { ascending: true })
      .limit(6),
    supabase.from("card_trends")
      .select(TREND_COLS)
      .in("card_slug", slugs.map((s: string) => s.replace(/^pc-/, ""))),
  ]);

  // v164: pre-compute per-card raw price to rank within this result
  // set. rank=1 is the highest-priced card (typically an alt art on
  // multi-variant sets). Lets the model distinguish #214 (base
  // secret rare) from #215 (alt art / moonbreon) without guessing.
  const rankInput = cardRows.map((card: any) => {
    const slug = String(card.card_slug);
    const trend = trendData?.find((t: any) => String(t.card_slug) === slug) || null;
    return { slug, raw: Number(trend?.current_raw ?? 0) };
  });
  const rawRankBySlug = new Map<string, number>();
  const sortedByRaw = [...rankInput].sort((a, b) => b.raw - a.raw);
  sortedByRaw.forEach((r, i) => rawRankBySlug.set(r.slug, i + 1));

  const enriched = cardRows.map((card: any) => {
    const slug = String(card.card_slug);
    const pcSlug = `pc-${slug}`;
    const vol = volumeData?.filter((v: any) =>
      String(v.card_slug) === slug || String(v.card_slug) === pcSlug
    ) || [];
    const rawVol = vol.find((v: any) => v.grade === "Ungraded");
    const psa9Vol = vol.find((v: any) => v.grade === "PSA 9");
    const psa10Vol = vol.find((v: any) => v.grade === "PSA 10");
    const trend = trendData?.find((t: any) =>
      String(t.card_slug) === slug
    ) || null;
    const ebay = ebayData?.filter((e: any) =>
      String(e.card_slug) === slug || String(e.card_slug) === pcSlug
    ) || [];

    const cardUrl = card.card_url_slug
      ? buildCardUrl(card.set_name, card.card_url_slug)
      : `https://www.pokeprices.io/browse`;

    const cardNameLinked = card.card_url_slug
      ? `[${card.card_name}](${cardUrl})`
      : card.card_name;

    // v164: variant identity hints.
    const variantLabels = extractVariantLabels(card.card_name);
    const printedDenominator = (() => {
      const s = card.set_printed_total == null ? "" : String(card.set_printed_total);
      return /^\d+$/.test(s) ? Number(s) : null;
    })();

    return {
      card_name: cardNameLinked,
      card_name_plain: card.card_name,
      set_name: card.set_name,
      card_url: cardUrl,
      // Block 5A-W-52A.3 — raw identifier fields so the ambiguous-
      // free-text short-circuit can build well-formed CardCandidate
      // objects and the client's resend has real identifiers to send
      // in card_context. The LLM ignores these; they're for the
      // candidate response body path.
      id: card.id,
      card_slug: card.card_slug,
      card_url_slug: card.card_url_slug,
      card_number: card.card_number,
      card_number_display: card.card_number_display,
      language: card.language,
      // cards has no `variant` column; the variant tag is embedded in
      // card_name as "[X]". Explicit null keeps the response shape
      // stable for the candidate-selection code path.
      variant: null,
      image_url: card.image_url,
      // v164 variant-identity hints (see extractVariantLabels /
      // isSecretRare helpers). These let the model resolve
      // #214 vs #215 style ambiguity without guessing:
      //   * variant_labels        — the [Bracketed] tags in card_name
      //   * printed_denominator   — the "N/M" M value from the set
      //   * is_secret_rare        — card_number > printed_denominator
      //   * raw_price_rank_in_result — 1=highest raw price in this
      //                                result set (usually the alt art)
      variant_labels:       variantLabels,
      printed_denominator:  printedDenominator,
      is_secret_rare:       isSecretRare(card.card_number, card.set_printed_total),
      raw_price_rank_in_result: rawRankBySlug.get(slug) ?? null,
      raw_usd: usdCentsToUsd(trend?.current_raw),
      raw_gbp: usdCentsToGbp(trend?.current_raw),
      psa9_usd: usdCentsToUsd(trend?.current_psa9),
      psa9_gbp: usdCentsToGbp(trend?.current_psa9),
      psa10_usd: usdCentsToUsd(trend?.current_psa10),
      psa10_gbp: usdCentsToGbp(trend?.current_psa10),
      pct_7d: trend?.raw_pct_7d ?? null,
      pct_30d: trend?.raw_pct_30d ?? null,
      pct_90d: trend?.raw_pct_90d ?? null,
      pct_365d: trend?.raw_pct_365d ?? null,
      volume_label: rawVol?.volume_label ?? null,
      volume_confidence: rawVol?.confidence ?? "unknown",
      volume_warning: !rawVol || (rawVol.sales_30d ?? 0) < 1
        ? "UNRELIABLE"
        : (rawVol.sales_30d ?? 0) < 3
        ? "THIN"
        : null,
      psa9_volume_label: psa9Vol?.volume_label ?? null,
      psa10_volume_label: psa10Vol?.volume_label ?? null,
      // Block 2C note: the client's InlineChat/ChatLink defensively wraps
      // any eBay URL through src/lib/ebayAffiliate.affiliateWrapEbayUrl
      // before rendering, so commission is now captured. A follow-up can
      // mirror that wrapping here once EBAY_CAMPID_UK/US are added to the
      // Supabase Functions secrets.
      ebay_listings: ebay.slice(0, 3).map((e: any) => ({
        price: e.currency === "GBP"
          ? `£${(e.total_cost_cents / 100).toFixed(2)}`
          : `$${(e.total_cost_cents / 100).toFixed(2)}`,
        condition: e.condition,
        seller: e.seller_username,
        feedback: e.seller_feedback_score,
        url: e.item_web_url,
      })),
    };
  });

  return { cards: enriched.slice(0, 8) };
}

async function dbSearchCheapest(searchTerm: string): Promise<any> {
  const { data, error } = await supabase.rpc("search_cards_json_cheapest", {
    search_text: searchTerm
  });
  if (error || !data) return { results: [], message: "No results found" };
  const results = data?.results;
  if (!results || results === "No results found") {
    return { results: [], message: "No results found" };
  }
  return {
    raw_results: typeof results === "string"
      ? results
      : JSON.stringify(results),
    search_term: searchTerm,
  };
}

async function dbGetMarketMovers(
  direction: string,
  period = "30d",
  cardFilter?: string,
  eraFrom?: number,
  eraTo?: number,
): Promise<any> {
  const fromYear = eraFrom ?? null;
  const toYear = eraTo ?? null;
  let data: any, error: any;

  if (direction === "rising") {
    ({ data, error } = await supabase.rpc("get_top_risers_filtered", {
      time_period: period,
      min_price: 5000,
      card_filter: cardFilter || null,
      from_year: fromYear,
      to_year: toYear,
    }));
  } else if (direction === "falling") {
    ({ data, error } = await supabase.rpc("get_top_fallers", {
      time_period: period,
      min_price: 5000,
      from_year: fromYear,
      to_year: toYear,
    }));
  } else if (direction === "slow_burn") {
    ({ data, error } = await supabase.rpc("get_slow_burners", {
      min_price: 5000,
      max_volatility: 0.15,
      from_year: fromYear,
      to_year: toYear,
    }));
  } else if (direction === "sealed_rising") {
    ({ data, error } = await supabase.rpc("get_top_risers_sealed", {
      time_period: period,
      min_price: 500,
    }));
  } else if (direction === "sealed_slow_burn") {
    ({ data, error } = await supabase.rpc("get_slow_burners_sealed", {
      min_price: 1000,
      max_volatility: 0.15,
    }));
  }

  if (error) return { results: [] };
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  const results = parsed?.results || [];

  const EXCLUDE = [
    /booster box/i,
    /booster pack/i,
    /elite trainer/i,
    /\betb\b/i,
    /collection box/i,
    /\btin\b/i,
    /topps/i,
  ];
  const filtered = results.filter((r: any) =>
    !EXCLUDE.some(p =>
      p.test(r.card_name || "") || p.test(r.set_name || "")
    )
  );

  const enriched = await Promise.all(
    filtered.slice(0, 10).map(async (r: any) => {
      const [{ data: cardRow }, { data: volRow }] = await Promise.all([
        supabase.from("cards")
          .select("card_url_slug, set_name")
          .eq("card_slug", r.card_slug)
          .not("card_url_slug", "is", null)
          .limit(1)
          .single(),
        supabase.from("card_volume")
          .select("volume_label, sales_30d, confidence")
          .eq("card_slug", r.card_slug)
          .eq("grade", "Ungraded")
          .maybeSingle(),
      ]);

      const cardUrl = cardRow?.card_url_slug
        ? buildCardUrl(cardRow.set_name, cardRow.card_url_slug)
        : null;

      return {
        ...r,
        card_name: cardUrl
          ? `[${r.card_name}](${cardUrl})`
          : r.card_name,
        card_name_plain: r.card_name,
        price_usd: usdCentsToUsd(r.current_price),
        price_gbp: usdCentsToGbp(r.current_price),
        card_url: cardUrl,
        volume_label: volRow?.volume_label ?? null,
        volume_confidence: volRow?.confidence ?? "unknown",
        volume_warning: !volRow || (volRow.sales_30d ?? 0) < 3
          ? "LOW VOLUME"
          : null,
      };
    })
  );

  return { results: enriched };
}

async function dbGetBuySellSignals(
  signalType: string,
  eraFrom?: number,
  eraTo?: number,
): Promise<any> {
  const fromYear = eraFrom ?? null;
  const toYear = eraTo ?? null;
  let data: any, error: any;

  if (signalType === "buy") {
    ({ data, error } = await supabase.rpc("get_buy_signals", {
      min_price: 3000,
      from_year: fromYear,
      to_year: toYear,
    }));
  } else {
    ({ data, error } = await supabase.rpc("get_sell_signals", {
      min_price: 3000,
    }));
  }

  if (error) return { results: [] };
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  const results = (parsed?.results || []).slice(0, 8);

  const enriched = await Promise.all(results.map(async (r: any) => {
    const { data: volRow } = await supabase.from("card_volume")
      .select("volume_label, confidence")
      .eq("card_slug", r.card_slug)
      .eq("grade", "Ungraded")
      .maybeSingle();

    const cardUrl = r.card_url_slug
      ? buildCardUrl(r.set_name, r.card_url_slug)
      : null;
    return {
      ...r,
      card_name: cardUrl
        ? `[${r.card_name}](${cardUrl})`
        : r.card_name,
      card_name_plain: r.card_name,
      price_usd: usdCentsToUsd(r.current_price),
      price_gbp: usdCentsToGbp(r.current_price),
      card_url: cardUrl,
      volume_label: volRow?.volume_label ?? null,
      volume_confidence: volRow?.confidence ?? "unknown",
    };
  }));

  return { signal_type: signalType, results: enriched };
}

async function dbGetSetData(
  setName: string,
  dataType: string,
): Promise<any> {
  if (dataType === "top_cards") {
    const { data } = await supabase.rpc("get_set_cards_sortable", {
      set_text: setName,
      sort_col: "raw_desc",
    });
    return { set_name: setName, top_cards: (data || []).slice(0, 15) };
  }
  if (dataType === "performance") {
    const { data } = await supabase.from("set_prices")
      .select("date, median_usd, value_usd")
      .ilike("set_name", `%${setName}%`)
      .order("date", { ascending: false })
      .limit(20);
    const converted = (data || []).map((r: any) => ({
      date: r.date,
      median_usd: r.median_usd
        ? `$${Number(r.median_usd).toFixed(2)}`
        : null,
      value_usd: r.value_usd
        ? `$${Number(r.value_usd).toFixed(2)}`
        : null,
    }));
    return { set_name: setName, price_history: converted };
  }
  if (dataType === "analytics") {
    const { data } = await supabase.rpc("get_set_analytics", {
      set_text: setName,
    });
    return { set_name: setName, analytics: data };
  }
  if (dataType === "pop") {
    const { data } = await supabase.from("psa_set_totals")
      .select("*")
      .ilike("set_name", `%${setName}%`)
      .order("snapshot_date", { ascending: false })
      .limit(1);
    const { data: topCards } = await supabase.from("psa_population")
      .select("card_name, psa_9, psa_10, total_graded, gem_rate")
      .ilike("set_name", `%${setName}%`)
      .gt("total_graded", 0)
      .order("total_graded", { ascending: false })
      .limit(10);
    return {
      set_name: setName,
      set_totals: data?.[0] || null,
      top_graded: topCards || [],
    };
  }
  return { error: "Unknown data type" };
}

async function dbGetGradingPop(searchTerm: string): Promise<any> {
  // 2026-09-22 audit fix. Previous implementation used only the FIRST
  // word of `searchTerm`, so "Umbreon VMAX Evolving Skies" collapsed to
  // "Umbreon" and returned every Umbreon population row in the DB —
  // the model then had to guess which one the user meant. Now:
  //   1. Try to resolve the exact card via search_cards_json so we can
  //      filter psa_population by BOTH name and set (psa_population's
  //      set_name has a "Pokemon " prefix that cards.set_name does not
  //      — see CLAUDE.md).
  //   2. Fall back to a multi-token AND-ish ilike using up to 3 tokens
  //      joined by %, which lets "Umbreon VMAX" find "Umbreon VMAX"
  //      instead of every Umbreon.
  const raw = String(searchTerm ?? "").trim();
  if (!raw) return { results: [], match_method: "empty" };

  let resolvedCardName: string | null = null;
  let resolvedSetName:  string | null = null;
  try {
    const { data: rpcData } = await supabase.rpc("search_cards_json", {
      search_text: raw,
    });
    const s = typeof rpcData?.results === "string" ? rpcData.results : "";
    const first = s.split(" --- ")[0];
    if (first) {
      const parts = first.split(" | ");
      const name = parts[0]?.trim();
      const set  = parts[1]?.trim();
      if (name && set) {
        // Strip variant brackets and any trailing "#NN" so the ilike
        // against psa_population.card_name has a shot.
        resolvedCardName = name
          .replace(/\s*\[[^\]]+\]/g, "")
          .replace(/\s*#[A-Za-z0-9/-]+\s*$/, "")
          .trim() || name;
        resolvedSetName = set;
      }
    }
  } catch { /* fall through to multi-token ilike */ }

  if (resolvedCardName && resolvedSetName) {
    // psa_population.set_name may be either "Set" or "Pokemon Set".
    const setVariants = [resolvedSetName, `Pokemon ${resolvedSetName}`];
    for (const sn of setVariants) {
      const { data } = await supabase.from("psa_population")
        .select(PSA_POP_COLS)
        .ilike("card_name", `%${resolvedCardName}%`)
        .eq("set_name", sn)
        .gt("total_graded", 0)
        .order("total_graded", { ascending: false })
        .limit(10);
      if (data?.length) {
        return {
          results: data,
          match_method: "resolved",
          resolved_card_name: resolvedCardName,
          resolved_set_name: sn,
        };
      }
    }
  }

  // Fallback: 2-3 token AND-ish ilike. "Umbreon VMAX Evolving Skies"
  // becomes "%Umbreon%VMAX%Evolving%", which still hits.
  const tokens = raw
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !/^(the|and|of|a)$/i.test(t))
    .slice(0, 3);
  const pattern = tokens.length ? `%${tokens.join("%")}%` : `%${raw}%`;
  const { data } = await supabase.from("psa_population")
    .select(PSA_POP_COLS)
    .ilike("card_name", pattern)
    .gt("total_graded", 0)
    .order("total_graded", { ascending: false })
    .limit(10);
  return {
    results: data || [],
    match_method: "fallback_ilike",
    tokens,
  };
}

// 2026-09-22 audit: new tool — see get_latest_sets_for_ai RPC.
// v3 (2026-09-22 audit follow-up): the RPC now splits set size into
// three unambiguously-named fields:
//   * official_set_size — printed denominator from cards.set_printed_total
//                         (what a collector means by "cards in the set")
//   * catalog_total     — set_metadata.total_cards (all catalogue entries)
//   * catalog_rows      — COUNT(*) of cards rows (sanity check)
// The handler forwards all three unchanged so the LLM can pick the
// semantically correct one per the SYSTEM prompt.
async function dbGetLatestSets(
  language?: string,
  limit?: number,
  nameFilter?: string,
): Promise<any> {
  const lang = language === "en" || language === "jp" ? language : null;
  const lim  = Math.max(1, Math.min(Number(limit) || 8, 20));
  const nf   = typeof nameFilter === "string" && nameFilter.trim().length > 0
    ? nameFilter.trim()
    : null;
  const { data, error } = await supabase.rpc("get_latest_sets_for_ai", {
    lang, limit_count: lim, name_filter: nf,
  });
  if (error || !data) {
    return { results: [], error: error?.message ?? "no data" };
  }
  return {
    results: (data as any[]).map((r) => ({
      set_name:          r.set_name,
      language:          r.language,
      release_date:      r.set_release_date,
      release_year:      r.release_year,
      official_set_size: r.official_set_size,   // printed denominator; nullable
      catalog_total:     r.catalog_total,       // set_metadata.total_cards
      catalog_rows:      r.catalog_rows,        // COUNT(*) from cards
      print_run_era:     r.print_run_era,
      set_url: `https://www.pokeprices.io/set/${encodeURIComponent(r.set_name)}`,
    })),
    filter_applied: nf,
  };
}

// 2026-09-22 audit: new tool — see get_card_price_summary_for_ai RPC.
async function dbGetPriceSummary(
  cardSlug: string,
  periodDays?: number,
): Promise<any> {
  const bare = String(cardSlug ?? "").replace(/^pc-/, "").trim();
  if (!bare) return { error: "empty card_slug" };
  const days = Math.max(1, Math.min(Number(periodDays) || 90, 730));
  const { data, error } = await supabase.rpc("get_card_price_summary_for_ai", {
    pc_slug: bare, period_days: days,
  });
  if (error) return { error: error.message, card_slug: bare };
  if (!Array.isArray(data) || data.length === 0) {
    return {
      card_slug: bare, period_days: days,
      message: "No price observations in this window",
    };
  }
  const r = data[0];
  return {
    card_slug:          r.card_slug,
    period_days:        r.period_days,
    latest_date:        r.latest_date,
    first_date:         r.first_date,
    observation_count:  r.observation_count,
    latest_raw_usd:     usdCentsToUsd(r.latest_raw_usd),
    latest_raw_gbp:     usdCentsToGbp(r.latest_raw_usd),
    latest_psa9_usd:    usdCentsToUsd(r.latest_psa9_usd),
    latest_psa9_gbp:    usdCentsToGbp(r.latest_psa9_usd),
    latest_psa10_usd:   usdCentsToUsd(r.latest_psa10_usd),
    latest_psa10_gbp:   usdCentsToGbp(r.latest_psa10_usd),
    raw_high_usd:       usdCentsToUsd(r.raw_high_usd),
    raw_high_gbp:       usdCentsToGbp(r.raw_high_usd),
    raw_low_usd:        usdCentsToUsd(r.raw_low_usd),
    raw_low_gbp:        usdCentsToGbp(r.raw_low_usd),
    raw_pct_change:     r.raw_pct_change,
    psa10_high_usd:     usdCentsToUsd(r.psa10_high_usd),
    psa10_high_gbp:     usdCentsToGbp(r.psa10_high_usd),
    psa10_low_usd:      usdCentsToUsd(r.psa10_low_usd),
    psa10_low_gbp:      usdCentsToGbp(r.psa10_low_usd),
    psa10_pct_change:   r.psa10_pct_change,
  };
}

// v167 (2026-09-23): deterministic constrained graded-card
// discovery. See migrations/2026-09-23-smart-endpoint-find-graded-
// cards.sql for the underlying RPC.
//
// Behaviour:
//   1. Call the RPC with the user's budget → in-budget results.
//   2. If zero in-budget results AND a budget was set, make a second
//      no-budget call to fetch the closest-over-budget candidate for
//      an honest "over budget by $X" hedge.
//   3. Emit structured, unit-typed output. Every price field is
//      returned as both `_cents` (integer for programmatic use) and
//      `_usd` (pre-formatted display string). No raw cent leaks.
//
// Prompt contract (see SYSTEM):
//   * "there are/aren't matches under $X" claims MUST come from this
//     tool's zero_match flag — never from model memory.
//   * The over_budget row is labelled explicitly so the model can
//     say "the closest over-budget match is $X (over budget by $Y)"
//     without pretending it satisfies the request.
async function dbFindGradedCards(params: {
  name_filter?: string,
  grader?:      string,
  grade?:       string,
  max_price_usd?: number,
  set_filter?:  string,
  language?:    string,
  limit?:       number,
}): Promise<any> {
  const nameFilter = typeof params.name_filter === "string" && params.name_filter.trim().length > 0
    ? params.name_filter.trim() : null;
  if (!nameFilter) return { results: [], zero_match: true, error: "name_filter is required" };

  const graderRaw = String(params.grader ?? "PSA").toUpperCase();
  const grader    = graderRaw === "RAW" || graderRaw === "UNGRADED" ? "raw" : "PSA";
  const grade     = grader === "PSA" ? String(params.grade ?? "9") : null;
  const maxUsd    = typeof params.max_price_usd === "number" && isFinite(params.max_price_usd) && params.max_price_usd > 0
    ? params.max_price_usd : null;
  const maxCents  = maxUsd != null ? Math.round(maxUsd * 100) : null;
  const setFilter = typeof params.set_filter === "string" && params.set_filter.trim().length > 0
    ? params.set_filter.trim() : null;
  const lang      = params.language === "en" || params.language === "jp" ? params.language : null;
  const lim       = Math.max(1, Math.min(Number(params.limit) || 8, 20));

  const shape = (r: any, over: boolean) => {
    const price = r.price_usd_cents ?? null;
    const cardUrl = r.card_url_slug
      ? `https://www.pokeprices.io/set/${encodeURIComponent(r.set_name)}/card/${r.card_url_slug}`
      : null;
    return {
      card_name:     r.card_name,
      set_name:      r.set_name,
      card_slug:     r.card_slug,
      card_url_slug: r.card_url_slug,
      card_url:      cardUrl,
      card_number_display: r.card_number_display,
      language:      r.language,
      set_release_date: r.set_release_date,
      price_usd_cents: price,
      price_usd:     usdCentsToUsd(price),
      price_gbp:     usdCentsToGbp(price),
      raw_usd_cents:   r.raw_usd_cents ?? null,
      raw_usd:       usdCentsToUsd(r.raw_usd_cents),
      raw_gbp:       usdCentsToGbp(r.raw_usd_cents),
      psa10_usd_cents: r.psa10_usd_cents ?? null,
      psa10_usd:     usdCentsToUsd(r.psa10_usd_cents),
      psa10_gbp:     usdCentsToGbp(r.psa10_usd_cents),
      price_date:    r.price_date,
      over_budget:   over,
      over_by_usd_cents: over && maxCents != null && price != null ? price - maxCents : null,
      over_by_usd:   over && maxCents != null && price != null
        ? usdCentsToUsd(price - maxCents) : null,
    };
  };
  // v167b (2026-09-23): expose the RPC's total_match_count so the
  // model can distinguish the returned window from the complete
  // universe. Without this, "$88 is the cheapest" was being said
  // when $88 was actually the cheapest of the 8 returned, not the
  // cheapest of ~20 total matches.
  const readTotal = (rows: any[] | null | undefined): number | null => {
    if (!rows || !rows.length) return 0;
    const t = rows[0]?.total_match_count;
    return typeof t === "number" ? t : null;
  };

  // In-budget query.
  const { data: inBudget, error: err1 } = await supabase.rpc("find_graded_cards_for_ai", {
    name_filter:      nameFilter,
    grader:           grader,
    grade:            grade,
    max_price_cents:  maxCents,
    set_filter:       setFilter,
    language:         lang,
    limit_count:      lim,
  });
  if (err1) return { results: [], zero_match: true, error: err1.message };

  const matches = Array.isArray(inBudget) ? inBudget.map((r) => shape(r, false)) : [];
  const zeroMatch = matches.length === 0;
  const totalMatchCount = readTotal(inBudget as any[]);
  const returnedCount = matches.length;
  const truncated = totalMatchCount != null && totalMatchCount > returnedCount;

  // Zero-match hedge: fetch the cheapest over-budget candidate.
  let closestOver: any = null;
  if (zeroMatch && maxCents != null) {
    const { data: over } = await supabase.rpc("find_graded_cards_for_ai", {
      name_filter:      nameFilter,
      grader:           grader,
      grade:            grade,
      max_price_cents:  null,   // no budget
      set_filter:       setFilter,
      language:         lang,
      limit_count:      1,
    });
    // The RPC orders by price DESC, so limit=1 returns the MOST
    // expensive — not what we want for closest-over. Re-fetch with
    // a wider window and pick the cheapest that's over budget.
    const { data: overAll } = await supabase.rpc("find_graded_cards_for_ai", {
      name_filter:      nameFilter,
      grader:           grader,
      grade:            grade,
      max_price_cents:  null,
      set_filter:       setFilter,
      language:         lang,
      limit_count:      20,
    });
    const sortedAsc = (overAll || []).slice().sort((a: any, b: any) =>
      (a.price_usd_cents ?? Infinity) - (b.price_usd_cents ?? Infinity));
    const cheapestOver = sortedAsc.find((r: any) =>
      typeof r.price_usd_cents === "number" && r.price_usd_cents > (maxCents ?? 0));
    if (cheapestOver) closestOver = shape(cheapestOver, true);
  }

  const orderNote = maxCents != null
    ? "cheapest first (results ordered price ASC because a budget was supplied)"
    : "highest-value first (results ordered price DESC because no budget was supplied)";

  return {
    query: {
      name_filter: nameFilter,
      grader,
      grade,
      max_price_usd: maxUsd,
      set_filter: setFilter,
      language: lang,
    },
    zero_match:  zeroMatch,
    // v167b: `match_count` is retained for backward compatibility
    // but is DEPRECATED. Use `returned_count` (rows in `results`)
    // and `total_match_count` (true universe from the RPC) instead.
    match_count: matches.length,
    returned_count: returnedCount,
    total_match_count: totalMatchCount,
    truncated,
    order:       orderNote,
    results:     matches,
    closest_over_budget: closestOver,
    note: zeroMatch
      ? `No ${grader}${grade ? " " + grade : ""} ${nameFilter} match is present in PokePrices' current price data under $${maxUsd ?? 0}. Say so plainly; do not invent a candidate. If closest_over_budget is set, mention it as "over budget by X" — do not present it as satisfying the request.`
      : truncated
        ? `Real PokePrices price-snapshot rows. Showing the ${returnedCount} cheapest of ${totalMatchCount} total matches. Say "here are ${returnedCount} of ${totalMatchCount} matches" (or similar) — do NOT say "there are ${returnedCount}" as though it were the complete universe. Do NOT claim "the cheapest overall" etc. based on this window; the tool returned only the lowest-priced ${returnedCount} in-budget rows.`
        : `Real PokePrices price-snapshot rows. All ${returnedCount} matches shown (${orderNote}). Because the returned window IS the complete match set, superlative language like "the cheapest of these" is justified — but do not extrapolate beyond the tool result.`,
  };
}

// ────────────────────────────────────────────────────────────────
// v167: recommendation-intent constraint extraction + carryover.
// Server-side deterministic parsing so the model cannot silently
// drop a budget / grade / subject between turns.
// ────────────────────────────────────────────────────────────────

type RecommendationContext = {
  subject?:         string;               // "Charizard"
  grader?:          "PSA" | "raw";
  grade?:           "7" | "8" | "9" | "10";
  max_price_usd?:   number;
  set_filter?:      string;
  language?:        "en" | "jp";
};

// Curated subject list — top ~80 chase Pokemon TCG names. Simpler
// than parsing free-form proper nouns and low-risk of false positives.
// If a user names a Pokemon not on this list, the extractor falls
// back to detecting a proper-noun-shaped token in the message.
const SUBJECT_POKEMON = [
  "Charizard","Blastoise","Venusaur","Pikachu","Mewtwo","Mew","Lugia","Ho-Oh","Rayquaza",
  "Reshiram","Zekrom","Kyurem","Lucario","Gengar","Snorlax","Gardevoir","Sylveon","Umbreon",
  "Espeon","Vaporeon","Jolteon","Flareon","Leafeon","Glaceon","Eevee","Groudon","Kyogre",
  "Dialga","Palkia","Giratina","Arceus","Eternatus","Zacian","Zamazenta","Miraidon","Koraidon",
  "Gholdengo","Iono","Mimikyu","Dragonite","Dragapult","Blissey","Regigigas","Necrozma","Solgaleo",
  "Lunala","Hoopa","Volcanion","Marshadow","Mimikyu","Toxapex","Iron Valiant","Roaring Moon",
  "Iron Bundle","Chien-Pao","Baxcalibur","Wugtrio","Terapagos","Meowscarada","Skeledirge","Quaquaval",
  "Greninja","Decidueye","Incineroar","Primarina","Alakazam","Machamp","Golem","Nidoking","Nidoqueen",
  "Clefable","Wigglytuff","Vileplume","Cloyster","Kingler","Weezing","Rhydon","Chansey","Kangaskhan",
  "Tauros","Magmar","Electabuzz","Jynx","Ditto","Aerodactyl","Gyarados","Slowbro","Slowking",
  "Farfetch'd","Scyther","Scizor","Pinsir","Heracross","Salamence","Metagross","Garchomp","Hydreigon",
  "Trubbish","Latios","Latias","Bulbasaur","Ivysaur","Squirtle","Wartortle","Charmander","Charmeleon",
];

const BUY_INTENT_PATTERNS = [
  /\bi\s+want\s+to\s+buy\b/i,
  /\bi\s+want\s+a\b/i,
  /\bi'?m\s+looking\s+to\s+buy\b/i,
  /\blooking\s+for\s+a\b/i,
  /\brecommend\b/i,
  /\bwhat\s+can\s+i\s+get\b/i,
  /\bfor\s+under\s+\$?\d/i,
  /\bunder\s+\$?\d/i,
  /\bless\s+than\s+\$?\d/i,
  /\bwithin\s+\$?\d/i,
  /\bwith\s+\$?\d/i,
  /\bfor\s+\$?\d/i,
  /\bbudget\b/i,
  /\bcheap(?:est)?\b/i,
  /\baffordable\b/i,
];

function extractPriceUsd(msg: string): number | null {
  // Handles "under $100", "less than 150", "for $200", "make it $150",
  // "up to $100", "budget of $200", "$300 max", "for 100 dollars"
  const patterns = [
    /(?:under|less\s+than|below|up\s+to|max(?:imum)?\s+of|budget\s+of|for)\s+\$?(\d{1,6})(?:\s*dollars?)?/i,
    /make\s+it\s+\$?(\d{1,6})/i,
    /\$?(\d{1,6})\s+(?:budget|max(?:imum)?|or\s+less)/i,
    /\$(\d{1,6})\b/,
    /\b(\d{1,6})\s*dollars?\b/i,
  ];
  for (const p of patterns) {
    const m = msg.match(p);
    if (m) {
      const n = Number(m[1]);
      if (isFinite(n) && n >= 1 && n <= 100000) return n;
    }
  }
  return null;
}

function extractGrader(msg: string): "PSA" | "raw" | null {
  if (/\braw\b|\bungraded\b/i.test(msg)) return "raw";
  if (/\bpsa\s*\d/i.test(msg))            return "PSA";
  return null;
}

function extractPsaGrade(msg: string): "7" | "8" | "9" | "10" | null {
  // "PSA 8", "PSA-8", "psa 10", "grade 9", "in 9", "9 grade"
  const patterns = [
    /\bpsa\s*(\d{1,2})(?:\.\d)?\b/i,
    /\bgrade\s+(\d{1,2})\b/i,
    /\bin\s+(?:a\s+)?(\d{1,2})\b/i,   // "in 9"
    /\bgraded\s+(\d{1,2})\b/i,
  ];
  for (const p of patterns) {
    const m = msg.match(p);
    if (m) {
      const g = m[1];
      if (["7","8","9","10"].includes(g)) return g as "7"|"8"|"9"|"10";
    }
  }
  return null;
}

function extractSubject(msg: string): string | null {
  // First check curated list.
  for (const name of SUBJECT_POKEMON) {
    const rx = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (rx.test(msg)) return name;
  }
  // Fallback: capitalised proper-noun that isn't a common word,
  // grader acronym, or article. Catches Pokemon not in the curated
  // list AND typos / made-up names so the tool call still fires
  // and returns zero_match honestly.
  const stopWords = new Set([
    "PSA","CGC","BGS","SGC","TAG","ACE","USD","GBP","EUR",
    "The","That","This","These","Those","Some","Any","How","What","Where","When","Why","Who",
    "But","And","Or","For","With","From","Into","Also","Just","Only",
    "Charizard","Blastoise","Venusaur","Pikachu",  // in curated list already
  ]);
  const tokens = msg.split(/\s+/);
  for (const raw of tokens) {
    const clean = raw.replace(/[^A-Za-z-']/g, "");
    if (clean.length >= 4 && /^[A-Z][A-Za-z-']+$/.test(clean) && !stopWords.has(clean)) {
      return clean;
    }
  }
  return null;
}

function extractLanguage(msg: string): "en" | "jp" | null {
  if (/\bjapan(?:ese)?\b|\bjp\b(?!eg)/i.test(msg))  return "jp";
  if (/\benglish\b|\ben\b(?!\w)/i.test(msg))         return "en";
  return null;
}

function looksLikeBuyIntent(msg: string): boolean {
  return BUY_INTENT_PATTERNS.some(p => p.test(msg));
}

// Merge previous + new. Only overwrite fields that were newly
// extracted; keep everything else. Explicit replacements (subject
// swap, grade swap, budget change) come through as newly-extracted
// values.
function mergeRecommendationContext(
  prev: RecommendationContext | null | undefined,
  next: RecommendationContext,
): RecommendationContext {
  const base = prev ?? {};
  return {
    subject:        next.subject        ?? base.subject,
    grader:         next.grader         ?? base.grader,
    grade:          next.grade          ?? base.grade,
    max_price_usd:  next.max_price_usd  ?? base.max_price_usd,
    set_filter:     next.set_filter     ?? base.set_filter,
    language:       next.language       ?? base.language,
  };
}

// Extract everything the current message contributes, then merge
// with the previous context. Recommendation intent is only active
// when there's a clear buy signal:
//   * previous turn was itself a recommendation (hasPrev), OR
//   * this turn has explicit buy-intent phrasing ("I want to buy",
//     "looking for", "recommend", etc.), OR
//   * this turn mentions a budget ("under $X", "for $X")
//
// A bare grader/grade/subject alone is NOT a recommendation turn —
// e.g. "And PSA 10?" after asking "How much is Charizard worth?"
// should stay on the normal card-history follow-up path, not fire
// find_graded_cards.
function computeRecommendationContext(
  message: string,
  prev:    RecommendationContext | null | undefined,
): RecommendationContext | null {
  const msg = String(message ?? "");
  const extracted: RecommendationContext = {
    subject:       extractSubject(msg) ?? undefined,
    grader:        extractGrader(msg)  ?? undefined,
    grade:         extractPsaGrade(msg) ?? undefined,
    max_price_usd: extractPriceUsd(msg) ?? undefined,
    language:      extractLanguage(msg) ?? undefined,
  };
  const hasPrev   = !!(prev && Object.values(prev).some(v => v !== undefined && v !== null));
  const buyIntent = looksLikeBuyIntent(msg);
  const hasBudget = extracted.max_price_usd != null;
  if (!hasPrev && !buyIntent && !hasBudget) return null;
  return mergeRecommendationContext(prev, extracted);
}

// ────────────────────────────────────────────────────────────────
// v168 (2026-09-24): live-freshness lookup for upcoming Pokemon TCG
// releases. The main smart-endpoint Haiku model doesn't have
// web_search access; this handler makes a bounded second call to
// Sonnet 4.6 + Anthropic's server-side web_search_20250305 tool and
// returns the structured findings back to Haiku.
//
// Real-user regression that motivated this (2026-09-24):
//   User: "When is the next set coming out?"
//   v167: "Chaos Rising is the next one out, releasing May 22, 2026.
//          That's followed by Pitch Black on July 17, then 30th
//          Celebration on September 16..."
//   Ground truth (today 2026-09-24): those all released months ago.
//   The next English expansion is Mega Evolution — Delta Reign,
//   November 6, 2026.
// The DB-backed get_latest_sets is a HISTORICAL catalogue and
// cannot answer forward-looking questions. This new tool must.
//
// Contract:
//   * The handler prompts Sonnet with today's date and a strict
//     source-priority instruction: pokemon.com / pokemon.co.jp /
//     tcg.pokemon.com first, PokéBeach second, specialist sources
//     third.
//   * Sonnet is asked to emit a JSON envelope so we can extract
//     structured fields (confirmed_upcoming, sources, confidence).
//   * All URLs returned come from web_search citations — never
//     model-fabricated.
//   * If no future release can be confirmed, confirmed_upcoming is
//     null and the caller must say so plainly instead of falling
//     back to an old DB row.
const SONNET_FOR_SEARCH = "claude-sonnet-4-6";
const SEARCH_MAX_USES   = 5;

async function dbLookupCurrentTcgInfo(query: string): Promise<any> {
  const q = String(query ?? "").trim();
  if (!q) return { ok: false, error: "empty query", queried_at: new Date().toISOString().slice(0, 10) };

  const today = new Date().toISOString().slice(0, 10);
  const system =
    `You are the PokePrices freshness lookup. You have web_search. Answer ONE Pokemon TCG freshness question.\n\n` +
    `Today is ${today}. Use this as "now" when deciding whether a release is past or future.\n\n` +
    `Source priority (search in this order, prefer higher-tier sources):\n` +
    `  1. Official Pokemon: pokemon.com, tcg.pokemon.com, pokemon.co.jp, pokemoncenter.com\n` +
    `  2. PokéBeach (pokebeach.com)\n` +
    `  3. Specialist sources: bulbagarden.net, serebii.net, ptcgo.com\n\n` +
    `Return ONLY a JSON object matching this schema in your final message (no prose, no markdown):\n` +
    `{\n` +
    `  "answer": "<one plain-English sentence summarising the finding>",\n` +
    `  "confirmed_upcoming": {\n` +
    `    "set_name": "<official set name>",\n` +
    `    "release_date": "YYYY-MM-DD",\n` +
    `    "release_type": "expansion" | "product_wave" | "reprint" | "promo",\n` +
    `    "region": "en" | "jp" | "other",\n` +
    `    "source_url": "<the primary citation URL from web_search>"\n` +
    `  } | null,\n` +
    `  "additional_upcoming": [ /* up to 3 additional confirmed future releases, same shape */ ],\n` +
    `  "confidence": "high" | "medium" | "low",\n` +
    `  "notes": "<any hedge / caveat about source freshness or ambiguity>"\n` +
    `}\n\n` +
    `RULES:\n` +
    `* Never quote a release_date earlier than ${today} in the confirmed_upcoming field. If the only candidate release date is in the past, set confirmed_upcoming=null and explain.\n` +
    `* Every URL you cite must come from a web_search result — do NOT fabricate URLs.\n` +
    `* Distinguish "expansion" (new set) from "product_wave" (booster wave / ETB / tin refresh of an existing set) — if the user's question is about a "set" or "expansion", prioritise expansion.\n` +
    `* If web_search returns no confirmed upcoming expansion, confirmed_upcoming=null and confidence="low".\n` +
    `* Emit JSON only. No prose, no code fences.`;

  const body = {
    model: SONNET_FOR_SEARCH,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: q }],
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: SEARCH_MAX_USES,
      },
    ],
  };

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    return { ok: false, error: "network", detail: String(e), queried_at: today };
  }
  const latencyMs = Date.now() - t0;
  const data = await res.json();
  if (!res.ok) {
    return { ok: false, error: "anthropic_error", status: res.status, detail: data, queried_at: today };
  }

  // Extract text + citations
  const textBlocks = (data.content || []).filter((b: any) => b?.type === "text");
  const text = textBlocks.map((b: any) => b.text || "").join("\n").trim();

  // Try to parse JSON envelope. Accept it wrapped in fences too.
  let parsed: any = null;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch { /* leave parsed null */ }

  // Collect all web_search citations
  const sources: any[] = [];
  for (const block of data.content || []) {
    if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) {
        if (r?.type === "web_search_result" && typeof r.url === "string") {
          sources.push({ url: r.url, title: r.title || null });
        }
      }
    }
  }

  const searchesUsed = Number(data?.usage?.server_tool_use?.web_search_requests ?? 0);

  // Defensive: strip any confirmed_upcoming whose release_date is
  // in the past. The prompt already forbids this, but a second
  // guard here means Haiku never sees a past-date row labelled as
  // upcoming.
  const nowIso = today;
  const validFuture = (row: any): boolean => {
    if (!row || typeof row !== "object") return false;
    const d = String(row.release_date ?? "");
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= nowIso;
  };
  const cleanedUpcoming = parsed?.confirmed_upcoming && validFuture(parsed.confirmed_upcoming)
    ? parsed.confirmed_upcoming : null;
  const cleanedAdditional = Array.isArray(parsed?.additional_upcoming)
    ? parsed.additional_upcoming.filter(validFuture)
    : [];

  return {
    ok: true,
    queried_at: today,
    query: q,
    answer:             parsed?.answer ?? text.slice(0, 500),
    confirmed_upcoming: cleanedUpcoming,
    additional_upcoming: cleanedAdditional,
    sources,
    confidence:         parsed?.confidence ?? "unknown",
    notes:              parsed?.notes ?? null,
    provenance: {
      model:         SONNET_FOR_SEARCH,
      searches_used: searchesUsed,
      latency_ms:    latencyMs,
    },
    guidance: cleanedUpcoming
      ? `Present confirmed_upcoming.set_name and release_date to the user. Cite confirmed_upcoming.source_url as the source. If additional_upcoming has entries, mention them briefly. Never quote a date before ${today} as "next" / "upcoming" / "coming soon".`
      : `No future Pokemon TCG expansion could be confirmed via web_search. Say so plainly ("I couldn't confirm a specific upcoming expansion right now"), do NOT fall back to a get_latest_sets DB row as though it were upcoming. Suggest checking pokemon.com or PokéBeach directly for the latest announcements.`,
  };
}

async function dbGetBudgetPsa10(budgetGbp: number): Promise<any> {
  const budgetUsdCents = Math.round((budgetGbp / GBP_RATE) * 100);
  const { data } = await supabase.from("card_trends")
    .select("card_slug, card_name, set_name, current_psa10, current_raw")
    .not("current_psa10", "is", null)
    .gt("current_psa10", 500)
    .lte("current_psa10", budgetUsdCents)
    .order("current_psa10", { ascending: false })
    .limit(20);

  return {
    budget_gbp: `£${budgetGbp.toFixed(0)}`,
    results: (data || []).map((d: any) => ({
      card_name: d.card_name,
      set_name: d.set_name,
      psa10_gbp: usdCentsToGbp(d.current_psa10),
      psa10_usd: usdCentsToUsd(d.current_psa10),
      raw_gbp: usdCentsToGbp(d.current_raw),
      raw_usd: usdCentsToUsd(d.current_raw),
    })),
  };
}

async function dbGetDeals(searchTerm?: string): Promise<any> {
  const { data, error } = await supabase.from("daily_deals")
    .select("*")
    .order("discount_pct", { ascending: false })
    .limit(12);

  if (error || !data?.length) {
    return { results: [], message: "No deals right now" };
  }

  const slugs = [...new Set(
    data.map((d: any) => d.card_slug?.toString()).filter(Boolean)
  )];
  const { data: cards } = await supabase.from("cards")
    .select("card_slug, card_name, set_name, card_url_slug")
    .in("card_slug", slugs);

  return {
    results: data.map((d: any) => {
      const card = cards?.find((c: any) =>
        c.card_slug.toString() === d.card_slug?.toString()
      );
      const sym = d.currency === "GBP" ? "£" : "$";
      const cardUrl = card?.card_url_slug
        ? buildCardUrl(card.set_name, card.card_url_slug)
        : null;
      const displayName = card?.card_name || d.card_name;
      return {
        card_name: cardUrl
          ? `[${displayName}](${cardUrl})`
          : displayName,
        card_name_plain: displayName,
        set_name: card?.set_name || d.set_name,
        card_url: cardUrl,
        price: `${sym}${(d.total_cost_cents / 100).toFixed(2)}`,
        fair_value: `${sym}${(d.fair_value_cents / 100).toFixed(2)}`,
        discount_pct: d.discount_pct,
        condition: d.condition,
        // Block 2C: client renderer wraps eBay URLs into affiliate searches.
        // Future deploy can wrap here too once EBAY_CAMPID_* secrets exist.
        url: d.item_web_url,
      };
    }),
  };
}

const CITY_COORDS: Record<string, [number, number]> = {
  "london":      [51.5074, -0.1278],
  "manchester":  [53.4808, -2.2426],
  "birmingham":  [52.4862, -1.8904],
  "cambridge":   [52.2053, 0.1218],
  "oxford":      [51.7520, -1.2577],
  "bristol":     [51.4545, -2.5879],
  "leeds":       [53.8008, -1.5491],
  "sheffield":   [53.3811, -1.4701],
  "liverpool":   [53.4084, -2.9916],
  "edinburgh":   [55.9533, -3.1883],
  "glasgow":     [55.8642, -4.2518],
  "nottingham":  [52.9548, -1.1581],
  "new york":    [40.7128, -74.0060],
  "los angeles": [34.0522, -118.2437],
  "seattle":     [47.6062, -122.3321],
  "chicago":     [41.8781, -87.6298],
};

function distanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function dbGetVendors(
  vendorType: string,
  location?: string,
  country?: string,
): Promise<any> {
  const { data: vendors } = await supabase.from("vendors")
    .select("*")
    .eq("is_active", true)
    .limit(200);
  if (!vendors?.length) return { results: [], no_vendors: true };

  if (vendorType === "nearby") {
    const lower = (location || "").toLowerCase();
    const coords = Object.entries(CITY_COORDS).find(
      ([city]) => lower.includes(city)
    )?.[1];
    const shops = vendors.filter((v: any) =>
      v.lat && v.lng && v.type === "lgs"
    );
    if (!coords) {
      return { results: shops.slice(0, 10), needs_location: true };
    }
    return {
      results: shops
        .map((v: any) => ({
          ...v,
          distance_miles: Math.round(
            distanceMiles(coords[0], coords[1], v.lat, v.lng) * 10
          ) / 10,
        }))
        .sort((a: any, b: any) => a.distance_miles - b.distance_miles)
        .slice(0, 8),
    };
  }
  if (vendorType === "retail") {
    const filtered = vendors.filter((v: any) =>
      ["retail_chain", "online_retailer"].includes(v.type) &&
      (!country ||
        v.country?.toLowerCase().includes(country.toLowerCase()))
    );
    return { results: filtered };
  }
  const online = vendors.filter((v: any) =>
    ["online_dealer", "marketplace"].includes(v.type)
  );
  return { results: online };
}

async function executeTool(
  toolName: string,
  toolInput: any,
): Promise<{ data: any; queryType: string }> {
  switch (toolName) {
    case "search_cards":
      return {
        data: await dbSearchCards(toolInput.search_term),
        queryType: toolInput.intent || "price",
      };
    case "search_cheapest":
      return {
        data: await dbSearchCheapest(toolInput.search_term),
        queryType: "cheapest",
      };
    case "get_market_movers":
      return {
        data: await dbGetMarketMovers(
          toolInput.direction,
          toolInput.period || "30d",
          toolInput.card_filter,
          toolInput.era_from,
          toolInput.era_to,
        ),
        queryType: "market_movers",
      };
    case "get_buy_sell_signals":
      return {
        data: await dbGetBuySellSignals(
          toolInput.signal_type,
          toolInput.era_from,
          toolInput.era_to,
        ),
        queryType: "signals",
      };
    case "get_set_data":
      return {
        data: await dbGetSetData(toolInput.set_name, toolInput.data_type),
        queryType: "set",
      };
    case "get_grading_pop":
      return {
        data: await dbGetGradingPop(toolInput.search_term),
        queryType: "pop",
      };
    case "get_budget_psa10":
      return {
        data: await dbGetBudgetPsa10(toolInput.budget_gbp),
        queryType: "budget_psa10",
      };
    case "get_deals":
      return {
        data: await dbGetDeals(toolInput.search_term),
        queryType: "deals",
      };
    case "get_vendors":
      return {
        data: await dbGetVendors(
          toolInput.vendor_type,
          toolInput.location,
          toolInput.country,
        ),
        queryType: "vendors",
      };
    case "get_latest_sets":
      return {
        data: await dbGetLatestSets(
          toolInput.language,
          toolInput.limit,
          toolInput.name_filter,
        ),
        queryType: "latest_sets",
      };
    case "get_price_history_summary":
      return {
        data: await dbGetPriceSummary(toolInput.card_slug, toolInput.period_days),
        queryType: "price_history_summary",
      };
    case "lookup_current_tcg_info":
      return {
        data: await dbLookupCurrentTcgInfo(toolInput.query),
        queryType: "freshness_lookup",
      };
    case "find_graded_cards":
      return {
        data: await dbFindGradedCards({
          name_filter:   toolInput.name_filter,
          grader:        toolInput.grader,
          grade:         toolInput.grade,
          max_price_usd: toolInput.max_price_usd,
          set_filter:    toolInput.set_filter,
          language:      toolInput.language,
          limit:         toolInput.limit,
        }),
        queryType: "constrained_graded_search",
      };
    default:
      return { data: { error: "Unknown tool" }, queryType: "general" };
  }
}

function calcCost(
  input: number,
  output: number,
  cacheCreate: number,
  cacheRead: number,
): number {
  return (
    (input * PRICE_INPUT) +
    (output * PRICE_OUTPUT) +
    (cacheCreate * PRICE_CACHE_WRITE) +
    (cacheRead * PRICE_CACHE_READ)
  ) / 1_000_000;
}

// ─── Block 5A-W-52B.2 — deterministic grading calculator ──
//
// Reference implementation lives at:
//   src/lib/grading/gradingServiceProfiles.ts
//   src/lib/grading/sellingProfiles.ts
//   src/lib/grading/gradingCostConfig.ts
//   src/lib/grading/currency.ts
//   src/lib/grading/gradingAnalysis.ts
//
// This inline copy runs at the edge because Deno cannot import
// the browser TypeScript module directly. Both must stay in sync.
// When either changes, update the other and re-run:
//   npx vitest run src/lib/grading

// ─── Grading service profiles (verified Aug 2026) ──────
// Source: https://www.psacard.com/services/tcggrading

const PSA_REGULAR_DIRECT = {
  id:                 "psa_regular_direct",
  serviceName:        "PSA Regular (Direct)",
  gradingFee:         7999,    // $79.99 USD
  feeCurrency:        "USD",
  maxInsuredValue:    150000,  // $1,500.00 USD
  available:          true,
  effectiveDate:      "2026-08-07",
} as const;

const PSA_VALUE_DIRECT_PAUSED = {
  id:                 "psa_value_direct_paused",
  serviceName:        "PSA Value (Direct) — paused",
  gradingFee:         2500,
  feeCurrency:        "USD",
  maxInsuredValue:    49900,
  available:          false,   // paused 2 June 2026
  effectiveDate:      "2026-08-07",
} as const;

const PSA_EXPRESS_DIRECT = {
  id:                 "psa_express_direct",
  serviceName:        "PSA Express (Direct)",
  gradingFee:         14900,   // $149 USD
  feeCurrency:        "USD",
  maxInsuredValue:    250000,  // $2,500 USD
  available:          true,
  effectiveDate:      "2026-08-07",
} as const;

const PSA_SUPER_EXPRESS_DIRECT = {
  id:                 "psa_super_express_direct",
  serviceName:        "PSA Super Express (Direct)",
  gradingFee:         34900,   // $349 USD
  feeCurrency:        "USD",
  maxInsuredValue:    500000,  // $5,000 USD
  available:          true,
  effectiveDate:      "2026-08-07",
} as const;

const ORDERED_AVAILABLE_PSA_PROFILES = [
  PSA_REGULAR_DIRECT,
  PSA_EXPRESS_DIRECT,
  PSA_SUPER_EXPRESS_DIRECT,
] as const;

// ─── Selling profiles ──────────────────────────────────

const UK_EBAY_PRIVATE = {
  id:                 "uk_ebay_private",
  displayName:        "eBay UK — private seller",
  sellerType:         "private",
  marketplaceFeeRate: 0,       // eBay UK abolished 3 Oct 2024
  regulatoryFeeRate:  0,
  paymentFeeRate:     0,
  fixedSellingFeeRule: { kind: "flat", flat: 0 } as const,
} as const;

const UK_EBAY_BUSINESS = {
  id:                 "uk_ebay_business",
  displayName:        "eBay UK — business seller (Collectables)",
  sellerType:         "business",
  marketplaceFeeRate: 0.109,   // 10.9% (Collectables)
  regulatoryFeeRate:  0.0035,  // 0.35% regulatory operating fee
  paymentFeeRate:     0,       // bundled into FVF
  fixedSellingFeeRule: {
    kind: "tiered_by_sale",
    tiers: [
      { maxSaleCents: 1000, feeCents: 30 },                      // ≤ £10 → £0.30
      { maxSaleCents: Number.POSITIVE_INFINITY, feeCents: 40 },  // > £10 → £0.40
    ],
  } as const,
  // eBay UK business fees are quoted excluding VAT. When the
  // seller cannot reclaim VAT (default), the calculator grosses
  // the aggregate fee amount by 20%.
  feesExcludeVat:     true,
  feeVatRate:         0.20,
} as const;

// FX rate provenance — matches src/lib/grading/currency.ts.
// Every grading response carries `fx_rate_source: 'hardcoded_fallback'`
// so audits know this isn't a live feed.
const FALLBACK_USD_TO_GBP_RATE = {
  rate: 0.79,
  source: "hardcoded_fallback",
  effectiveDate: "2026-08-07",
} as const;

/** Resolve tiered fixed per-order fee for a given sale value. */
function resolveFixedSellingFee(rule: any, saleValueCents: number): number {
  if (rule.kind === "flat") return rule.flat;
  for (const tier of rule.tiers) {
    if (saleValueCents <= tier.maxSaleCents) return tier.feeCents;
  }
  return rule.tiers[rule.tiers.length - 1]?.feeCents ?? 0;
}

/** Total selling deductions applied identically to raw + graded sides. */
function calcAllSellingFees(price: number, sp: any, applyFeeVat: boolean): {
  marketplaceFee: number; regulatoryFee: number; paymentFee: number; fixedSellingFee: number; feeVat: number; total: number;
} {
  const marketplaceFee = calcFeeCents(price, sp.marketplaceFeeRate);
  const regulatoryFee  = calcFeeCents(price, sp.regulatoryFeeRate);
  const paymentFee     = calcFeeCents(price, sp.paymentFeeRate);
  const fixedSellingFee = price > 0 ? resolveFixedSellingFee(sp.fixedSellingFeeRule, price) : 0;
  const baseTotal = marketplaceFee + regulatoryFee + paymentFee + fixedSellingFee;
  const feeVatRate = sp.feeVatRate ?? 0;
  const feeVat = applyFeeVat && feeVatRate > 0 && baseTotal > 0
    ? Math.round(baseTotal * feeVatRate) : 0;
  return {
    marketplaceFee, regulatoryFee, paymentFee, fixedSellingFee, feeVat,
    total: baseTotal + feeVat,
  };
}

/** Piecewise break-even solver mirroring gradingAnalysis.ts. */
function solveBreakEvenSalePrice(fixedGradingCosts: number, rawNet: number, feeRateSum: number, rule: any, vatMultiplier: number = 1): number {
  const effectiveRateSum = feeRateSum * vatMultiplier;
  if (effectiveRateSum >= 1) return Number.POSITIVE_INFINITY;
  const tiers = rule.kind === "flat"
    ? [{ maxSaleCents: Number.POSITIVE_INFINITY, feeCents: rule.flat }]
    : rule.tiers;
  let prevMax = 0;
  let bestValid = Number.POSITIVE_INFINITY;
  for (const t of tiers) {
    const effectiveFixedFee = Math.round(t.feeCents * vatMultiplier);
    const P = Math.ceil((fixedGradingCosts + rawNet + effectiveFixedFee) / (1 - effectiveRateSum));
    if (P > prevMax && P <= t.maxSaleCents && P < bestValid) bestValid = P;
    prevMax = t.maxSaleCents;
  }
  return bestValid;
}

// UK-first per CLAUDE.md — private seller is the current default.
const DEFAULT_SELLING_PROFILE = UK_EBAY_PRIVATE;

// ─── Ancillary GBP costs ───────────────────────────────

const UK_ANCILLARY_COSTS_GBP = {
  outboundShipping:   400,
  returnShipping:     600,
  insurance:          300,
  otherCosts:         100,
  effectiveDate:      "2026-08-07",
} as const;

function calcFeeCents(gross: number, rate: number): number {
  if (gross <= 0 || rate <= 0) return 0;
  return Math.round(gross * rate);
}

function volumeConfidence(sales30d: number | null | undefined): "high" | "medium" | "low" {
  if (sales30d == null || sales30d <= 0) return "low";
  if (sales30d < 3) return "low";
  if (sales30d < 10) return "medium";
  return "high";
}

/**
 * Convert a USD-cents price to GBP-pence using the site's
 * standard multiplier. Kept explicit so a reader can see the FX
 * assumption in one place. Aligns with `GBP_RATE` above and the
 * grading calculator's single-currency contract.
 */
function usdCentsToGbpPence(cents: number | null | undefined): number | null {
  if (cents == null || cents <= 0) return null;
  return Math.round(cents * GBP_RATE);
}

/** Pick the cheapest currently-available service whose value cap
 * accommodates the target card value. `targetValueUsd` is
 * integer cents in USD. Returns null when no available tier fits. */
function pickPsaService(targetValueUsd: number) {
  for (const p of ORDERED_AVAILABLE_PSA_PROFILES) {
    if (!p.available) continue;
    if (p.maxInsuredValue == null || targetValueUsd <= p.maxInsuredValue) return p;
  }
  return null;
}

async function runGradingAnalysis(structuredCard: any): Promise<{
  block: string;
  recommendationCode: string;
  breakEvenGrade: number | null;
  confidence: "high" | "medium" | "low";
} | null> {
  try {
    const pcSlug = `pc-${structuredCard.card_slug}`;
    const bareSlug = String(structuredCard.card_slug);
    // Grab today's daily_prices row. If missing, fail closed —
    // we won't invent prices. Also grab per-grade volume from
    // card_volume for the confidence signal.
    const [{ data: prices }, { data: volumes }] = await Promise.all([
      supabase.from("daily_prices")
        .select("raw_usd,psa7_usd,psa8_usd,psa9_usd,psa10_usd")
        .eq("card_slug", pcSlug)
        .order("date", { ascending: false })
        .limit(1),
      supabase.from("card_volume")
        .select("grade,sales_30d")
        .eq("card_slug", bareSlug)
        .in("grade", ["Ungraded", "PSA 7", "PSA 8", "PSA 9", "PSA 10"]),
    ]);
    if (!prices || prices.length === 0) return null;
    const p = prices[0];
    const rawGbp = usdCentsToGbpPence(p.raw_usd);
    const g7  = usdCentsToGbpPence(p.psa7_usd);
    const g8  = usdCentsToGbpPence(p.psa8_usd);
    const g9  = usdCentsToGbpPence(p.psa9_usd);
    const g10 = usdCentsToGbpPence(p.psa10_usd);
    // Volume by grade
    const vol: Record<string, number | null> = {};
    for (const v of volumes ?? []) {
      if (v.grade === "Ungraded") vol.ungraded = v.sales_30d;
      else if (v.grade === "PSA 7") vol.psa7 = v.sales_30d;
      else if (v.grade === "PSA 8") vol.psa8 = v.sales_30d;
      else if (v.grade === "PSA 9") vol.psa9 = v.sales_30d;
      else if (v.grade === "PSA 10") vol.psa10 = v.sales_30d;
    }

    // ── 52B.1 service + selling profile selection ──
    //
    // Pick the cheapest PSA tier whose value cap accommodates the
    // highest expected sale value (max of raw + graded). Convert
    // fees + caps into GBP for the analyzer.
    const gradeValuesGbp = [g7, g8, g9, g10].filter((v): v is number => v != null && v > 0);
    const maxExpectedGbp = Math.max(rawGbp ?? 0, ...(gradeValuesGbp.length ? gradeValuesGbp : [0]));
    // Convert the max expected GBP back to USD for cap comparison.
    const maxExpectedUsd = Math.round(maxExpectedGbp / GBP_RATE);
    const service = pickPsaService(maxExpectedUsd) ?? PSA_REGULAR_DIRECT;
    const gradingFeeGbp = Math.round(service.gradingFee * GBP_RATE);
    const serviceMaxValueGbp = service.maxInsuredValue != null
      ? Math.round(service.maxInsuredValue * GBP_RATE)
      : null;
    const sp = DEFAULT_SELLING_PROFILE;
    const anc = UK_ANCILLARY_COSTS_GBP;

    const fixedGradingCosts = gradingFeeGbp
      + anc.outboundShipping + anc.returnShipping
      + anc.insurance + anc.otherCosts;
    const feeRateSum = sp.marketplaceFeeRate + sp.regulatoryFeeRate + sp.paymentFeeRate;
    // 52B VAT — until an ownership signal exists, default to the
    // non-reclaimable case (safer bakes VAT into the numbers than
    // silently claiming reclaim). The private profile has
    // feesExcludeVat undefined so this is a no-op there.
    const sellerCanReclaimFeeVat = false;
    const applyFeeVat = !!(sp as any).feesExcludeVat && !sellerCanReclaimFeeVat;
    const vatMultiplier = applyFeeVat ? 1 + ((sp as any).feeVatRate ?? 0) : 1;

    const gradeInputs: Array<{ grade: 7|8|9|10; price: number | null; volume: number | null }> = [
      { grade: 7,  price: g7,  volume: vol.psa7  ?? null },
      { grade: 8,  price: g8,  volume: vol.psa8  ?? null },
      { grade: 9,  price: g9,  volume: vol.psa9  ?? null },
      { grade: 10, price: g10, volume: vol.psa10 ?? null },
    ];
    const missingGradeValues: number[] = [];
    const lowVolumeGrades: number[] = [];
    const gradesExceedServiceCap: number[] = [];
    let extremeGradeMultiplierPresent = false;
    type Scenario = {
      grade: 7|8|9|10; gradedValue: number;
      marketplaceFee: number; regulatoryFee: number; paymentFee: number; fixedSellingFee: number;
      totalCosts: number; netProceeds: number;
      incrementalProfit: number; roiPercent: number | null; breakEven: boolean;
      breakEvenSalePrice: number;
      salesVolume: number | null; confidence: "high"|"medium"|"low";
      extremeGradeMultiplier: boolean; exceedsServiceCap: boolean;
    };
    const scenarios: Scenario[] = [];
    const rawNet = rawGbp != null && rawGbp > 0
      ? rawGbp - calcAllSellingFees(rawGbp, sp, applyFeeVat).total
      : null;
    for (const { grade, price, volume } of gradeInputs) {
      if (price == null || price <= 0) { missingGradeValues.push(grade); continue; }
      const fees = calcAllSellingFees(price, sp, applyFeeVat);
      const totalCosts     = fixedGradingCosts + fees.total;
      const netProceeds    = price - totalCosts;
      const incrementalProfit = netProceeds - (rawNet ?? 0);
      const investment = fixedGradingCosts + (rawNet ?? 0);
      const roiPercent = investment > 0 ? Math.round((incrementalProfit / investment) * 1000) / 10 : null;
      const breakEvenSalePrice = solveBreakEvenSalePrice(fixedGradingCosts, rawNet ?? 0, feeRateSum, sp.fixedSellingFeeRule, vatMultiplier);
      const scenarioConfidence = volumeConfidence(volume);
      if (scenarioConfidence === "low") lowVolumeGrades.push(grade);
      const extreme = rawGbp != null && rawGbp > 0 ? price / rawGbp >= 10 : false;
      if (extreme) extremeGradeMultiplierPresent = true;
      const exceedsServiceCap = serviceMaxValueGbp != null && price > serviceMaxValueGbp;
      if (exceedsServiceCap) gradesExceedServiceCap.push(grade);
      scenarios.push({
        grade, gradedValue: price,
        marketplaceFee: fees.marketplaceFee, regulatoryFee: fees.regulatoryFee,
        paymentFee: fees.paymentFee, fixedSellingFee: fees.fixedSellingFee,
        totalCosts, netProceeds, incrementalProfit,
        roiPercent, breakEven: incrementalProfit >= 0 && !exceedsServiceCap,
        breakEvenSalePrice,
        salesVolume: volume, confidence: scenarioConfidence,
        extremeGradeMultiplier: extreme, exceedsServiceCap,
      });
    }
    const missingRawValue = rawGbp == null;
    let confidence: "high"|"medium"|"low" = "high";
    if (missingRawValue || scenarios.length === 0) confidence = "low";
    else if (lowVolumeGrades.length >= 2) confidence = "low";
    else if (scenarios.length === 1 && lowVolumeGrades.length >= 1) confidence = "low";
    else if (lowVolumeGrades.length === 1) confidence = "medium";
    if (extremeGradeMultiplierPresent) {
      if (lowVolumeGrades.length >= 1) confidence = "low";
      else if (confidence === "high") confidence = "medium";
    }
    const eligible = scenarios.filter(s => !s.exceedsServiceCap);
    const breakEvenGrade = eligible.filter(s => s.breakEven).sort((a, b) => a.grade - b.grade)[0]?.grade ?? null;
    const bestFinancial  = eligible.slice().sort((a, b) => b.incrementalProfit - a.incrementalProfit || a.grade - b.grade)[0]?.grade ?? null;

    let recommendationCode: string;
    if (!service.available || eligible.length === 0) {
      recommendationCode = "INSUFFICIENT_COST_DATA";
    } else if (missingRawValue || scenarios.length === 0 || confidence === "low") {
      recommendationCode = "INSUFFICIENT_DATA";
    } else if (eligible.every(s => !s.breakEven)) {
      recommendationCode = "LIKELY_NEGATIVE";
    } else if (eligible.every(s => s.breakEven)) {
      recommendationCode = "LIKELY_POSITIVE";
    } else {
      recommendationCode = "CONDITION_DEPENDENT";
    }

    // Build the prompt block — mirror of buildGradingPromptBlock
    // in src/lib/grading/gradingAnalysis.ts.
    const fmt = (cents: number) => `£${(cents / 100).toFixed(2)}`;
    const lines: string[] = [];
    lines.push(
      `GRADING ANALYSIS (deterministic — you MUST NOT recalculate, invent fees, or contradict these numbers).`,
      `recommendation_code=${recommendationCode}`,
      `intended_use=resale`,
      `comparison_basis=sell_raw`,
      `overall_confidence=${confidence}`,
      `break_even_grade=${breakEvenGrade ?? "none"}`,
      `best_financial_grade=${bestFinancial ?? "none"}`,
      `grading_service=${service.serviceName}${service.available ? "" : " (UNAVAILABLE)"}`,
      `selling_profile=${sp.displayName}`,
      `fx_rate=${FALLBACK_USD_TO_GBP_RATE.rate} (${FALLBACK_USD_TO_GBP_RATE.source})`,
      `fee_vat_applied=${applyFeeVat}`,
    );
    for (const s of scenarios) {
      lines.push(
        `PSA_${s.grade}: value=${fmt(s.gradedValue)} net=${fmt(s.netProceeds)} ` +
        `incremental=${s.incrementalProfit >= 0 ? "+" : ""}${fmt(s.incrementalProfit)} ` +
        `roi=${s.roiPercent != null ? s.roiPercent.toFixed(1) + "%" : "n/a"} ` +
        `break_even=${s.breakEven} volume_30d=${s.salesVolume ?? "unknown"} ` +
        `confidence=${s.confidence}` +
        (s.extremeGradeMultiplier ? " extreme_multiplier" : "") +
        (s.exceedsServiceCap ? " exceeds_service_cap" : ""),
      );
    }
    if (!service.available) lines.push(`WARNING: the grading service (${service.serviceName}) is not currently accepting new submissions — do NOT recommend booking it.`);
    if (gradesExceedServiceCap.length > 0) lines.push(`WARNING: PSA ${gradesExceedServiceCap.join(", PSA ")} value(s) exceed the ${service.serviceName} declared-value cap — a higher tier is required for those grades.`);
    if (missingRawValue) lines.push("WARNING: raw sale value is missing — do NOT quote an incremental-profit figure.");
    if (missingGradeValues.length > 0) lines.push(`WARNING: no confirmed sale data for PSA ${missingGradeValues.join(", PSA ")} — do NOT interpolate.`);
    if (lowVolumeGrades.length > 0) lines.push(`WARNING: thin sales volume on PSA ${lowVolumeGrades.join(", PSA ")} — label those figures as unreliable.`);
    if (extremeGradeMultiplierPresent) lines.push("WARNING: an extreme graded-to-raw multiplier (>=10x) was detected — add a caution about survivorship / one-sale outliers.");

    const shippingAndInsurance = ((anc.outboundShipping + anc.returnShipping + anc.insurance + anc.otherCosts) / 100).toFixed(2);
    const rateHedge = (FALLBACK_USD_TO_GBP_RATE.source === "hardcoded_fallback" || FALLBACK_USD_TO_GBP_RATE.source === "test_fixture")
      ? "assumed exchange rate"
      : "current exchange rate";
    let feePart: string;
    const allZero = sp.marketplaceFeeRate === 0 && sp.regulatoryFeeRate === 0 && sp.paymentFeeRate === 0
      && sp.fixedSellingFeeRule.kind === "flat" && (sp.fixedSellingFeeRule as any).flat === 0;
    if (allZero) {
      feePart = `${sp.displayName} with £0 seller fees`;
    } else {
      const parts: string[] = [];
      if (sp.marketplaceFeeRate > 0) parts.push(`${(sp.marketplaceFeeRate * 100).toFixed(1)}% final-value fee`);
      if (sp.regulatoryFeeRate > 0) parts.push(`${(sp.regulatoryFeeRate * 100).toFixed(2)}% regulatory fee`);
      if (sp.paymentFeeRate > 0) parts.push(`${(sp.paymentFeeRate * 100).toFixed(1)}% payment fee`);
      if (sp.fixedSellingFeeRule.kind === "flat" && (sp.fixedSellingFeeRule as any).flat > 0) {
        parts.push(`£${((sp.fixedSellingFeeRule as any).flat / 100).toFixed(2)}/order`);
      } else if (sp.fixedSellingFeeRule.kind === "tiered_by_sale") {
        const t = (sp.fixedSellingFeeRule as any).tiers;
        if (t.length === 2 && t[0].maxSaleCents === 1000 && t[0].feeCents === 30 && t[1].feeCents === 40) {
          parts.push(`£0.30/order for orders ≤ £10, £0.40 above`);
        } else {
          parts.push(`tiered per-order fee`);
        }
      }
      if ((sp as any).feesExcludeVat) {
        const reclaimNote = applyFeeVat
          ? "calculation assumes fee VAT is not reclaimable"
          : "calculation assumes fee VAT is reclaimable";
        parts.push(`excluding VAT; ${reclaimNote}`);
      }
      feePart = `${sp.displayName} ${parts.join(" + ")}`;
    }
    lines.push(`Assumptions: ${service.serviceName}, approximately £${(gradingFeeGbp/100).toFixed(2)}/card at the ${rateHedge}, £${shippingAndInsurance} shipping/insurance/supplies, ${feePart}.`);
    lines.push(
      `Response format (compact):`,
      `  1. Verdict — one plain sentence matching recommendation_code. When comparison_basis=sell_raw, phrase it "Compared with selling the card raw today, ...".`,
      `  2. Grade scenarios — per-grade one-liner using the numbers above.`,
      `  3. Break-even point — cite the break_even_grade.`,
      `  4. Assumptions — one line, verbatim from Assumptions above.`,
      `  5. Data warning — only if a WARNING appears above.`,
      `Do NOT use the phrases "sweet spot", "grading floor", "nearly doubles", or any percentage not present above.`,
    );
    return {
      block: lines.join("\n"),
      recommendationCode,
      breakEvenGrade,
      confidence,
    };
  } catch (e) {
    console.error("grading analysis failed:", e);
    return null;
  }
}

// Block 5A-W-52A.2 — extended chat_logs row + legacy-shape fallback.
//
// Deployment order is: (1) migration → (2) edge function → (3)
// client. If the edge function ships before the migration, the
// extended INSERT would fail with Postgres error 42703
// "column ... does not exist" (or PostgREST PGRST204). This
// helper retries once with the pre-52A legacy shape so we never
// lose a log entry, and logs a loud warning naming the missing
// migration, the original error, and the fallback action.
//
// Any error other than a missing-column error is surfaced as-is —
// no silent swallowing of unrelated database errors.
//
// Column naming (DB-side, short form):
//   * matched_card_id       ← cards.id      (DB primary key)
//   * matched_card_slug     ← cards.card_slug (PriceCharting id)
//   * matched_card_url_slug ← cards.card_url_slug
//   * matched_card_name     ← cards.card_name (cleaned)
function logChat(params: any) {
  const cost = calcCost(
    params.input_tokens || 0,
    params.output_tokens || 0,
    params.cache_creation_tokens || 0,
    params.cache_read_tokens || 0,
  );
  const legacyRow: Record<string, unknown> = {
    session_id: params.session_id || null,
    user_message: params.user_message?.substring(0, 1000),
    response: params.response?.substring(0, 2000),
    router_output: params.tool_input
      ? `${params.tool_used}: ${params.tool_input}`
      : (params.tool_used || "direct"),
    query_type: params.query_type,
    card_data_found: params.card_data_found,
    input_tokens: params.input_tokens || 0,
    output_tokens: params.output_tokens || 0,
    cost_usd: cost,
    conversation_turn: params.conversation_turn || 1,
    pre_routed: false,
  };
  const extendedRow: Record<string, unknown> = {
    ...legacyRow,
    intent: params.intent ?? null,
    context_source: params.context_source ?? null,
    // 52A.2 short-form columns (DB-column-inspired names).
    // Retained for backward compatibility with existing analytics.
    requested_card_id: params.requested_card_record_id ?? null,
    requested_card_slug: params.requested_pc_product_id ?? null,
    requested_card_url_slug: params.requested_card_url_slug ?? null,
    requested_set_name: params.requested_set_name ?? null,
    requested_language: params.requested_language ?? null,
    matched_card_id: params.matched_card_record_id ?? null,
    matched_card_slug: params.matched_pc_product_id ?? null,
    matched_card_url_slug: params.matched_card_url_slug ?? null,
    matched_card_name: params.matched_card_name ?? null,
    matched_set_name: params.matched_set_name ?? null,
    matched_card_number: params.matched_card_number ?? null,
    matched_card_number_display: params.matched_card_number_display ?? null,
    matched_language: params.matched_language ?? null,
    matched_variant: params.matched_variant ?? null,
    match_method: params.match_method ?? null,
    exact_match_found: params.exact_match_found ?? null,
    candidate_count: params.candidate_count ?? null,
    match_confidence: params.match_confidence ?? null,
    // 52A.3 dual-write to explicit-name columns. A mismatch audit
    // must never compare a DB primary key to a PriceCharting id,
    // so the explicit columns make the type unambiguous:
    //   *_card_record_id → cards.id (DB PK)
    //   *_pc_product_id  → cards.card_slug (PriceCharting id)
    requested_card_record_id: params.requested_card_record_id ?? null,
    requested_pc_product_id:  params.requested_pc_product_id ?? null,
    matched_card_record_id:   params.matched_card_record_id ?? null,
    matched_pc_product_id:    params.matched_pc_product_id ?? null,
    // 52B grading-analysis telemetry.
    grading_analysis_used:       params.grading_analysis_used ?? null,
    grading_recommendation_code: params.grading_recommendation_code ?? null,
    grading_break_even_grade:    params.grading_break_even_grade ?? null,
    grading_data_confidence:     params.grading_data_confidence ?? null,
  };
  supabase.from("chat_logs").insert([extendedRow]).then(({ error }) => {
    if (!error) return;
    const msg = typeof error.message === "string" ? error.message : "";
    const missingColumn = error.code === "42703"
      || error.code === "PGRST204"
      || /column .+ does not exist/i.test(msg)
      || /could not find the .+ column/i.test(msg);
    if (!missingColumn) {
      // Unrelated DB error — surface, don't retry.
      console.error("chat_logs insert failed (non-recoverable):", error);
      return;
    }
    console.warn(
      "chat_logs missing 52A.2 provenance columns — retrying with the legacy insert shape. Apply migrations/2026-08-05-chat-logs-structured-context.sql to enable structured provenance logging. Original error:",
      error,
    );
    supabase.from("chat_logs").insert([legacyRow]).then(({ error: err2 }) => {
      if (err2) console.error("chat_logs legacy insert failed:", err2);
    });
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, apikey",
      },
    });
  }

  try {
    const body = await req.json();
    const { message, session_id, history } = body;
    if (!message) {
      return new Response(
        JSON.stringify({ error: "No message" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }

    // ── Block 5A-W-52A.2 — structured context path ──────────
    //
    // Client passes card identity in a structured card_context object
    // (see src/lib/chat/cardContext.ts). Load the EXACT record here
    // rather than letting the LLM parse a bracketed prefix.
    //
    // Identifier semantics:
    //   * cardRecordId           → cards.id (bigint PK, unique)
    //   * priceChartingProductId → cards.card_slug (globally unique)
    //   * cardUrlSlug            → cards.card_url_slug
    //                              (UNIQUE ONLY WITHIN A SET —
    //                               never queried alone)
    //
    // Retrieval priority (52A.2 correction):
    //   1. cards.id via cardRecordId                       → "card_id"
    //   2. cards.card_slug via priceChartingProductId      → "card_slug"
    //   3. cards.card_url_slug + set_name + language
    //      (composite, single-row guard)                   → "card_url_slug_composite"
    //   4. set_name + card_number + language (+variant)
    //      (composite, single-row guard)                   → "set_number_language"
    //   5. Fail closed. No fuzzy fallback for structured requests.
    //
    // For priorities 3 and 4: query all rows matching the composite
    // key, populate candidate_count, accept only when EXACTLY one
    // row remains, fail closed on zero or multiple. Never pick the
    // first arbitrary candidate.
    //
    // The pre-52A `[Context: asking about ...]` prefix path is kept
    // for backward compatibility during the rolling deploy; a
    // structured card_context always takes precedence when both are
    // supplied on the same request.
    const cardContextIn = body.card_context ?? null;
    const setContextIn = body.set_context ?? null;
    const intentIn: string | null = typeof body.intent === "string" ? body.intent : null;
    const contextSourceIn: string | null = typeof body.context_source === "string" ? body.context_source : null;
    // v167: recommendation-intent constraint carryover. The client
    // sends the previous turn's merged context; the server merges
    // in whatever the current message contributes and returns the
    // updated context so the client can pass it on the next turn.
    const recommendationContextIn: RecommendationContext | null =
      body.recommendation_context && typeof body.recommendation_context === "object"
        ? body.recommendation_context as RecommendationContext
        : null;
    const mergedRecommendationContext = computeRecommendationContext(
      typeof body.message === "string" ? body.message : "",
      recommendationContextIn,
    );

    // Structured-context provenance for the response + chat_logs.
    let requestedCardRecordId: string | null = null;
    let requestedCardUrlSlug: string | null = null;
    let requestedPcProductId: string | null = null;
    let requestedSetName: string | null = null;
    let requestedLanguage: string | null = null;
    let matchedCardRecordId: string | null = null;
    let matchedCardUrlSlug: string | null = null;
    let matchedPcProductId: string | null = null;
    let matchedCardName: string | null = null;
    let matchedSetName: string | null = null;
    let matchedCardNumber: string | null = null;
    let matchedCardNumberDisplay: string | null = null;
    let matchedLanguage: string | null = null;
    let matchedVariant: string | null = null;
    let matchMethod: string = "none";
    let exactMatchFound = false;
    let candidateCount = 0;
    let matchConfidence: number | null = null;
    let structuredCard: any = null;

    if (cardContextIn && typeof cardContextIn === "object") {
      requestedCardRecordId = cardContextIn.cardRecordId != null
        ? String(cardContextIn.cardRecordId) : null;
      requestedCardUrlSlug  = cardContextIn.cardUrlSlug ?? null;
      requestedPcProductId  = cardContextIn.priceChartingProductId != null
        ? String(cardContextIn.priceChartingProductId) : null;
      requestedSetName      = cardContextIn.setName ?? null;
      requestedLanguage     = cardContextIn.language ?? null;

      // Priority 1: cards.id via cardRecordId. Only when a numeric
      // primary key is supplied.
      if (cardContextIn.cardRecordId != null) {
        const idNum = Number(cardContextIn.cardRecordId);
        if (Number.isFinite(idNum)) {
          const { data } = await supabase
            .from("cards")
            .select("*")
            .eq("id", idNum)
            .maybeSingle();
          if (data) { structuredCard = data; matchMethod = "card_id"; }
        }
      }
      // Priority 2: cards.card_slug (the PriceCharting product id) via
      // priceChartingProductId. Globally unique — safer than the URL
      // slug lookup.
      if (!structuredCard && cardContextIn.priceChartingProductId != null) {
        const { data } = await supabase
          .from("cards")
          .select("*")
          .eq("card_slug", String(cardContextIn.priceChartingProductId))
          .maybeSingle();
        if (data) { structuredCard = data; matchMethod = "card_slug"; }
      }
      // Priority 3: cards.card_url_slug + set_name + language
      // (composite). cards.card_url_slug is NOT globally unique
      // (unique-within-set only), so we always add set_name and
      // language filters and fail closed unless exactly one row
      // remains. Never queried alone.
      if (!structuredCard && cardContextIn.cardUrlSlug && cardContextIn.setName) {
        const lang = cardContextIn.language === "jp" ? "jp" : "en";
        const { data } = await supabase
          .from("cards")
          .select("*")
          .eq("card_url_slug", String(cardContextIn.cardUrlSlug))
          .eq("set_name", String(cardContextIn.setName))
          .eq("language", lang);
        const count = data?.length ?? 0;
        candidateCount = Math.max(candidateCount, count);
        if (count === 1) {
          structuredCard = data![0];
          matchMethod = "card_url_slug_composite";
        } else if (count > 1) {
          matchMethod = "card_url_slug_ambiguous";
        }
      }
      // Priority 4: set_name + card_number + language (+variant).
      // Composite fail-closed guard: EXACTLY one row or nothing.
      if (!structuredCard && cardContextIn.setName && cardContextIn.cardNumber) {
        const lang = cardContextIn.language === "jp" ? "jp" : "en";
        let query = supabase
          .from("cards")
          .select("*")
          .eq("set_name", cardContextIn.setName)
          .eq("card_number", String(cardContextIn.cardNumber))
          .eq("language", lang);
        const variant = cardContextIn.variant;
        if (typeof variant === "string" && variant.length > 0) {
          query = query.eq("variant", variant);
        }
        const { data } = await query;
        const count = data?.length ?? 0;
        candidateCount = Math.max(candidateCount, count);
        if (count === 1) {
          structuredCard = data![0];
          matchMethod = "set_number_language";
        } else if (count > 1) {
          matchMethod = "set_number_language_ambiguous";
        }
      }

      if (structuredCard) {
        matchedCardRecordId = structuredCard.id != null ? String(structuredCard.id) : null;
        matchedCardUrlSlug  = structuredCard.card_url_slug ?? null;
        matchedPcProductId  = structuredCard.card_slug != null ? String(structuredCard.card_slug) : null;
        // Strip the DB "#NN" suffix that cards.card_name embeds.
        const rawName = typeof structuredCard.card_name === "string" ? structuredCard.card_name : "";
        matchedCardName     = rawName.replace(/\s*#[A-Za-z0-9/-]+\s*$/, "").trim() || rawName;
        matchedSetName      = structuredCard.set_name ?? null;
        matchedCardNumber   = structuredCard.card_number != null ? String(structuredCard.card_number) : null;
        matchedCardNumberDisplay = structuredCard.card_number_display ?? null;
        matchedLanguage     = structuredCard.language ?? null;
        matchedVariant      = structuredCard.variant ?? null;
        matchConfidence     = 1.0;
        candidateCount      = candidateCount > 0 ? candidateCount : 1;

        // Identifier-consistency guard. If the client supplied any
        // identifier and the loaded record disagrees, fail closed.
        const idMismatch = requestedCardRecordId != null
          && matchedCardRecordId != null
          && requestedCardRecordId !== matchedCardRecordId;
        const pcMismatch = requestedPcProductId != null
          && matchedPcProductId != null
          && requestedPcProductId !== matchedPcProductId;
        // For card_url_slug, mismatch is meaningful ONLY when we
        // resolved via one of the other identifiers — the URL slug
        // is not globally unique so a bare inequality is uninformative.
        const urlSlugMismatch = requestedCardUrlSlug != null
          && matchedCardUrlSlug != null
          && requestedCardUrlSlug !== matchedCardUrlSlug
          && (matchMethod === "card_id" || matchMethod === "card_slug");

        if (idMismatch || urlSlugMismatch || pcMismatch) {
          const mismatchMsg =
            "I couldn't confirm the exact card for that request. " +
            "Please try again from the card page.";
          logChat({
            session_id, user_message: message, response: mismatchMsg,
            tool_used: "context_mismatch", tool_input: null,
            query_type: "context_load_failed", card_data_found: false,
            input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0,
            cache_read_tokens: 0, conversation_turn: 1,
            intent: intentIn, context_source: contextSourceIn,
            requested_card_record_id: requestedCardRecordId,
            requested_card_url_slug: requestedCardUrlSlug,
            requested_pc_product_id: requestedPcProductId,
            requested_set_name: requestedSetName,
            requested_language: requestedLanguage,
            matched_card_record_id: matchedCardRecordId,
            matched_card_url_slug: matchedCardUrlSlug,
            matched_pc_product_id: matchedPcProductId,
            matched_card_name: matchedCardName,
            matched_set_name: matchedSetName,
            matched_card_number: matchedCardNumber,
            matched_card_number_display: matchedCardNumberDisplay,
            matched_language: matchedLanguage,
            matched_variant: matchedVariant,
            match_method: matchMethod, exact_match_found: false,
            candidate_count: candidateCount, match_confidence: matchConfidence,
          });
          return new Response(
            JSON.stringify({
              answer: mismatchMsg, tool_used: "context_mismatch",
              query_type: "context_load_failed", card_data_found: false,
              exact_match_found: false, match_method: matchMethod,
              requested_card_record_id: requestedCardRecordId,
              matched_card_record_id: matchedCardRecordId,
              matched_card_url_slug: matchedCardUrlSlug,
              matched_pc_product_id: matchedPcProductId,
              matched_card_name: matchedCardName,
            }),
            { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
          );
        }
        exactMatchFound = true;
      } else {
        // No structured record found (or multiple candidates for a
        // composite fallback). Fail closed rather than falling back
        // to fuzzy text search.
        const ambiguousMulti = matchMethod === "set_number_language_ambiguous"
          || matchMethod === "card_url_slug_ambiguous";
        const notFoundMsg = ambiguousMulti
          ? "I found more than one card that matches those details. " +
            "Please try again from the specific card page or include the printing (regular / holo / reverse holo)."
          : "I couldn't retrieve the details for that card right now. " +
            "Please try again in a moment or search by name.";
        logChat({
          session_id, user_message: message, response: notFoundMsg,
          tool_used: ambiguousMulti ? "context_ambiguous" : "context_load_failed",
          tool_input: null,
          query_type: "context_load_failed", card_data_found: false,
          input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0,
          cache_read_tokens: 0, conversation_turn: 1,
          intent: intentIn, context_source: contextSourceIn,
          requested_card_record_id: requestedCardRecordId,
          requested_card_url_slug: requestedCardUrlSlug,
          requested_pc_product_id: requestedPcProductId,
          requested_set_name: requestedSetName,
          requested_language: requestedLanguage,
          matched_card_record_id: null,
          matched_card_url_slug: null,
          matched_pc_product_id: null,
          matched_card_name: null,
          match_method: matchMethod, exact_match_found: false,
          candidate_count: candidateCount, match_confidence: null,
        });
        return new Response(
          JSON.stringify({
            answer: notFoundMsg,
            tool_used: ambiguousMulti ? "context_ambiguous" : "context_load_failed",
            query_type: "context_load_failed", card_data_found: false,
            exact_match_found: false, match_method: matchMethod,
            requested_card_record_id: requestedCardRecordId,
            matched_card_record_id: null,
            candidate_count: candidateCount,
          }),
          { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
        );
      }
    }

    // ── Legacy `[Context: asking about ...]` extraction ─────
    // Only when NO structured context was supplied.
    let cleanMessage = message;
    let cardPageContext = "";
    if (!structuredCard) {
      const ctxMatch = message.match(
        /^\[Context: asking about ([^\]]+)\]\s*(.*)/s,
      );
      if (ctxMatch) {
        cardPageContext = ctxMatch[1].trim();
        cleanMessage = ctxMatch[2].trim() ||
          `Tell me about ${cardPageContext}`;
      }
    }

    // ── Block 5A-W-52B — deterministic grading analysis ───
    //
    // When the client sends intent='grade_card' AND we've loaded
    // an exact structured card, compute the grading economics
    // server-side and feed the result to the LLM as a structured
    // prompt block. The LLM explains this result but MUST NOT
    // recalculate or invent fees.
    //
    // The reference calculator lives in src/lib/grading/ (with
    // 26 unit tests + regression fixtures). This edge function
    // inlines an identical arithmetic implementation because Deno
    // cannot import the browser-side TypeScript module directly.
    // Keep the two in sync when either changes.
    let gradingBlock: string | null = null;
    let gradingRecommendationCode: string | null = null;
    let gradingBreakEvenGrade: number | null = null;
    let gradingDataConfidence: string | null = null;
    let gradingAnalysisUsed = false;
    if (intentIn === "grade_card" && structuredCard) {
      const gradeRes = await runGradingAnalysis(structuredCard);
      if (gradeRes) {
        gradingBlock = gradeRes.block;
        gradingRecommendationCode = gradeRes.recommendationCode;
        gradingBreakEvenGrade = gradeRes.breakEvenGrade;
        gradingDataConfidence = gradeRes.confidence;
        gradingAnalysisUsed = true;
      }
    }

    // Build the LLM user turn. When we have a loaded exact card, embed
    // its identifiers so the LLM cannot substitute a different record.
    // Pre-routed intent adds a strong "answer with THIS card" directive.
    let userContent: string;
    if (structuredCard) {
      const cn = structuredCard.card_number_display ??
        (structuredCard.card_number ? `#${structuredCard.card_number}` : "");
      const idBlock =
        `Currently viewing on PokePrices (EXACT card, do not search for a different one): ` +
        `card_slug="${structuredCard.card_slug}", ` +
        `card_name="${structuredCard.card_name}", ` +
        `set_name="${structuredCard.set_name}", ` +
        `number="${cn}", ` +
        `language="${structuredCard.language ?? "en"}".`;
      const intentBlock = intentIn
        ? ` The user's quick-action intent is "${intentIn}"; ` +
          `answer specifically about this card, do NOT ask which card they mean.`
        : "";
      // Block 5A-W-52B — append the deterministic grading block
      // when it was computed. The LLM must explain these numbers
      // without recalculation.
      const gradingSuffix = gradingBlock ? `\n\n${gradingBlock}` : "";
      userContent = `${idBlock}${intentBlock} User question: ${message}${gradingSuffix}`;
    } else if (setContextIn && setContextIn.setName) {
      userContent = `Currently viewing on PokePrices: set "${setContextIn.setName}" ` +
        `(language="${setContextIn.language ?? "en"}"). User question: ${message}`;
    } else if (cardPageContext) {
      userContent = `Currently viewing on PokePrices: "${cardPageContext}". ` +
        `Question: ${cleanMessage}. Search for this card.`;
    } else {
      userContent = cleanMessage;
    }

    // v167: append the merged recommendation constraints as a
    // structured block so the model MUST use them when it calls
    // find_graded_cards. This is deterministic — the constraints
    // come from the server-side extractor + previous-turn carryover,
    // not model interpretation.
    if (mergedRecommendationContext) {
      const r = mergedRecommendationContext;
      const parts: string[] = [];
      if (r.subject)       parts.push(`subject=${r.subject}`);
      if (r.grader)        parts.push(`grader=${r.grader}`);
      if (r.grade)         parts.push(`grade=${r.grade}`);
      if (r.max_price_usd != null) parts.push(`max_price_usd=${r.max_price_usd}`);
      if (r.set_filter)    parts.push(`set_filter=${r.set_filter}`);
      if (r.language)      parts.push(`language=${r.language}`);
      if (parts.length > 0) {
        userContent = userContent +
          `\n\nRECOMMENDATION CONSTRAINTS (deterministic — carried from history + this message): ` +
          parts.join(", ") +
          `. Call find_graded_cards with these EXACT constraints. If the tool returns zero_match=true, say so plainly using the note field and mention closest_over_budget only when explicitly labelled as "over budget by $X". Never claim availability without a tool result.`;
      }
    }

    const trimmedHistory = (history || []).slice(-8);
    const agentMessages: any[] = [];
    for (const msg of trimmedHistory) {
      if (msg.role && msg.content) {
        agentMessages.push({
          role: msg.role,
          content: String(msg.content).substring(0, 600),
        });
      }
    }
    agentMessages.push({ role: "user", content: userContent });

    let answer = "";
    let toolUsed = "direct";
    // v164-B: track every tool called this turn (loop can call more
    // than one). Exposed on the response so the eval can enforce
    // "PSA pop claim requires get_grading_pop this turn".
    const toolsUsedThisTurn: string[] = [];
    // v168 (2026-09-24): when lookup_current_tcg_info was called
    // this turn, surface the sources the web_search returned so the
    // client / eval can verify the answer cites an official source
    // when one is present. Never includes fabricated URLs — only
    // what web_search returned via the tool result.
    let freshnessProvenance: any = null;
    let queryType = "general";
    let cardDataFound = false;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    let toolUse: any = null;
    // Block 5A-W-52A.3 — ambiguous-free-text candidates. When
    // search_cards returns more than one card on a free-text
    // (no-structured-context) turn, we short-circuit BEFORE the
    // LLM writes a card-specific answer and return the candidate
    // list for the client's selection UI. See the tool-result
    // handler below.
    let ambiguousCandidates: any[] | null = null;
    // v166 (2026-09-23): the v164 answer-text-driven auto-pin scorer
    // was removed. Reason: reliability was ~50-70% because LLM
    // wording varies run-to-run and scoring heuristics can't
    // consistently identify which of 2-6 candidates the model
    // picked. See docs/notes/2026-09-23-deterministic-card-pinning.md
    // for the deterministic follow-up plan.
    //
    // Pin behaviour is now strictly structural:
    //   * exactly-1 search_cards candidate → pin (still in place below)
    //   * structured card_context from client → pin (unchanged)
    //   * everything else → no pin; follow-ups rely on history

    const MAX_LOOPS = 3;
    for (let loopCount = 0; loopCount < MAX_LOOPS; loopCount++) {
      const isLastLoop = loopCount === MAX_LOOPS - 1;

      const resp = await callClaude({
        messages: agentMessages,
        toolChoice: isLastLoop
          ? { type: "none" }
          : { type: "auto" },
        maxTokens: 600,
      });

      inputTokens += resp.usage?.input_tokens || 0;
      outputTokens += resp.usage?.output_tokens || 0;
      cacheCreationTokens +=
        resp.usage?.cache_creation_input_tokens || 0;
      cacheReadTokens += resp.usage?.cache_read_input_tokens || 0;

      const stopReason = resp.stop_reason;
      const toolUseBlocks = (resp.content || []).filter(
        (b: any) => b.type === "tool_use",
      );
      const textBlock = resp.content?.find(
        (b: any) => b.type === "text",
      );

      if (stopReason !== "tool_use" || !toolUseBlocks.length) {
        answer = textBlock?.text ||
          "I could not process that. Could you rephrase?";
        break;
      }

      toolUse = toolUseBlocks[0];
      const toolResults = await Promise.all(
        toolUseBlocks.map(async (tb: any) => {
          const { data, queryType: qt } = await executeTool(
            tb.name,
            tb.input,
          );
          toolUsed = tb.name;
          if (!toolsUsedThisTurn.includes(tb.name)) toolsUsedThisTurn.push(tb.name);
          if (qt) queryType = qt;
          // v168: capture the freshness tool result so the client
          // can inspect sources (never overwrites a prior capture).
          if (tb.name === "lookup_current_tcg_info" && !freshnessProvenance && data && typeof data === "object") {
            const officialRe = /\b(?:pokemon\.com|pokemoncenter\.com|pokemon\.co\.jp|tcg\.pokemon\.com)\b/i;
            const srcs = Array.isArray(data.sources) ? data.sources : [];
            const primaryUrl = data.confirmed_upcoming?.source_url ?? null;
            const hasOfficialInSources = srcs.some((s: any) => typeof s?.url === "string" && officialRe.test(s.url));
            const primaryIsOfficial    = typeof primaryUrl === "string" && officialRe.test(primaryUrl);
            freshnessProvenance = {
              sources: srcs.slice(0, 10),
              primary_source_url: primaryUrl,
              has_official_source: hasOfficialInSources || primaryIsOfficial,
              primary_is_official: primaryIsOfficial,
              confidence: data.confidence ?? "unknown",
              queried_at: data.queried_at ?? null,
            };
          }

          const d = data;
          const found = d && (
            (Array.isArray(d.results) && d.results.length > 0) ||
            (Array.isArray(d.cards) && d.cards.length > 0) ||
            (Array.isArray(d.top_cards) && d.top_cards.length > 0) ||
            (Array.isArray(d.price_history) &&
              d.price_history.length > 0) ||
            (Array.isArray(d.top_graded) && d.top_graded.length > 0) ||
            d.set_totals || d.analytics || d.raw_results ||
            d.budget_gbp !== undefined
          );
          if (found) cardDataFound = true;

          // Block 5A-W-52A.1 — free-text single-exact-match capture.
          // When the client sent no structured card_context and the
          // LLM ran a card-scoped tool (search_cards / get_grading_pop)
          // that returned exactly one card, promote it to matched_*
          // so the client can pin activeCard for follow-up turns.
          //
          // Multiple candidates → do not auto-select. The absence of
          // matched_* on the response is the signal that this turn
          // is ambiguous and activeCard should stay as-is.
          if (!structuredCard && tb.name === "search_cards" && d) {
            const candidateArr: any[] =
              Array.isArray(d.results) ? d.results :
              Array.isArray(d.cards)   ? d.cards   : [];
            if (candidateArr.length === 1) {
              const c = candidateArr[0];
              if (c && (c.card_url_slug || c.card_slug)) {
                // Prefer card_name_plain (raw DB name) over card_name
                // (markdown-linked) so matched_card_name is clean.
                const rawName = typeof c.card_name_plain === "string"
                  ? c.card_name_plain
                  : (typeof c.card_name === "string" ? c.card_name : "");
                matchedCardRecordId = c.id != null ? String(c.id) : null;
                matchedCardUrlSlug  = c.card_url_slug ?? null;
                matchedPcProductId  = c.card_slug != null ? String(c.card_slug) : null;
                matchedCardName     = rawName.replace(/\s*#[A-Za-z0-9/-]+\s*$/, "").trim() || rawName || null;
                matchedSetName      = c.set_name ?? null;
                matchedCardNumber   = c.card_number != null ? String(c.card_number) : null;
                matchedCardNumberDisplay = c.card_number_display ?? null;
                matchedLanguage     = c.language ?? null;
                matchedVariant      = c.variant ?? null;
                matchMethod         = "fuzzy";
                exactMatchFound     = true;
                candidateCount      = 1;
                matchConfidence     = 0.9;
              }
            } else if (candidateArr.length > 1) {
              candidateCount = Math.max(candidateCount, candidateArr.length);
              // Block 5A-W-52A.3 — capture the raw candidate rows so
              // we can build the selection response after the
              // Promise.all completes. Only the FIRST search_cards
              // ambiguity wins — later loop iterations won't happen
              // because we break out below.
              //
              // 2026-09-22 audit tune: only short-circuit to the
              // selection UI on GENUINE ambiguity (more than 4
              // candidates). For 2-4 candidates the enriched tool
              // result already carries formatted prices and printing
              // labels — let the model pick the most likely one and
              // answer directly. Historically this path fired on any
              // >1 result, which regressed common queries like
              // "how much is Charizard Base Set?" into a picker UI.
              // v164 refinement: raised threshold to 9 to effectively
              // disable the short-circuit selection UI on the
              // free-text search_cards path. enrichCards slices its
              // output to a maximum of 8, so a >=9 threshold never
              // fires. Rationale: the model consistently strips the
              // user's disambiguating words per the tool description
              // ("Pass ONLY the card name in search_term"), so with a
              // threshold ≤ 8 common queries like "Blastoise Base
              // Set unlimited" would hit the picker even though the
              // user had already disambiguated. Bare-name ambiguous
              // queries ("Umbreon", "Charizard") already get a "which
              // one" text clarification from the model (see
              // D-ambiguous eval prompt). The candidate-selection UI
              // remains reachable through the structured-context
              // ambiguous_multi paths for card_context requests.
              const AMBIGUOUS_THRESHOLD = 9;
              if (!ambiguousCandidates
                  && candidateArr.length >= AMBIGUOUS_THRESHOLD) {
                ambiguousCandidates = candidateArr;
              }
            }
          }

          // 2026-09-22 audit: bumped from 1500 → 6000. enrichCards
          // returns up to 8 cards with ~20 fields each (~350 chars per
          // card), so 1500 was cutting the JSON mid-object and
          // producing invalid tool results the model couldn't parse.
          // 6000 covers the worst case while staying well under
          // Haiku's context budget.
          return {
            type: "tool_result" as const,
            tool_use_id: tb.id,
            content: JSON.stringify(data).substring(0, 6000),
          };
        })
      );

      // Block 5A-W-52A.3 — short-circuit before the LLM sees the
      // ambiguous tool result. Otherwise the LLM would pick one
      // variant and answer as if it were the right one (the exact
      // silent-substitution problem this block closes).
      if (ambiguousCandidates && !structuredCard) {
        answer = "I found more than one card that matches. Which one did you mean?";
        matchMethod = "ambiguous_free_text";
        toolUsed = "candidate_selection";
        queryType = "candidate_selection";
        exactMatchFound = false;
        break;
      }

      agentMessages.push({
        role: "assistant",
        content: toolUseBlocks,
      });
      agentMessages.push({ role: "user", content: toolResults });
    }

    if (!answer) {
      answer = "I could not generate a response. Please try again.";
    }

    // 2026-09-22 audit: defensive aborted-chain / empty-answer
    // recovery. Haiku sometimes returns a text block that only
    // announces its next tool call ("Let me check…", "Now let me
    // get…") or nothing at all (leaving the loop to emit the
    // fallback "I could not process…"). Both leave the user staring
    // at a broken response. If we have at least one tool result in
    // the conversation, force one more model call with
    // tool_choice=none and an explicit "answer with what you have"
    // instruction. Bounded to a single extra call.
    const looksAborted = (() => {
      const s = (answer || '').trim();
      if (!s) return false;
      // Full-answer aborted chain (short + intent + no data).
      if (s.length <= 220 &&
          /(^|[.,]\s*)(let me (check|look|get|pull|see|grab|fetch)|now let me|i(?:'| wi)ll now)/i.test(s)
          && !/\$|£|€|%/.test(s)) return true;
      // Trailing-only aborted chain: last clause is an intent
      // promise, regardless of what came before it. Allow it to
      // be preceded by a comma (mid-sentence) or a period.
      const tail = s.slice(-200);
      return /(?:^|[.,]\s*)(let me (?:check|look|get|pull|see|grab|fetch|pull that|get that)|now let me|i(?:'| wi)ll now)[^.!?]*[.!?]?\s*$/i.test(tail);
    })();
    const looksFallback = (() => {
      const s = (answer || '').trim();
      return s === '' ||
        s === 'I could not process that. Could you rephrase?' ||
        s === 'I could not generate a response. Please try again.';
    })();
    const hadToolResult = agentMessages.some((m: any) =>
      Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result')
    );
    if ((looksAborted || looksFallback) && hadToolResult) {
      agentMessages.push({
        role: 'user',
        content: 'That reply only announced a next step — the user cannot see any data. Use the tool result you already have and write the complete final answer now. No preamble. If the data does not answer the question, say that plainly instead.',
      });
      try {
        const resp2 = await callClaude({
          messages: agentMessages,
          toolChoice: { type: 'none' },
          maxTokens: 600,
        });
        inputTokens         += resp2.usage?.input_tokens || 0;
        outputTokens        += resp2.usage?.output_tokens || 0;
        cacheCreationTokens += resp2.usage?.cache_creation_input_tokens || 0;
        cacheReadTokens     += resp2.usage?.cache_read_input_tokens || 0;
        const t2 = (resp2.content || []).find((b: any) => b.type === 'text');
        if (t2?.text && t2.text.trim().length > 20) {
          answer = t2.text;
        }
      } catch (e) {
        console.error('aborted-chain recovery failed:', e);
      }
    }

    const cost = calcCost(
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
    );
    console.log(
      `[chat] in=${inputTokens} out=${outputTokens} ` +
      `cache_w=${cacheCreationTokens} cache_r=${cacheReadTokens} ` +
      `cost=$${cost.toFixed(5)}`
    );

    const conversationTurn = history?.length
      ? Math.floor(history.length / 2) + 1
      : 1;

    // Block 5A-W-52A.1 — extended chat_logs row with structured
    // provenance (requested_* + matched_*). exactMatchFound is a
    // stricter identity guarantee than card_data_found: cardDataFound
    // is true whenever any tool returned data, while exactMatchFound
    // is true only when the client's identifiers matched the loaded
    // record (structured path) or when a free-text search resolved
    // to exactly one card.
    logChat({
      session_id,
      user_message: cleanMessage || message,
      response: answer,
      tool_used: toolUsed,
      tool_input: toolUse
        ? JSON.stringify(toolUse.input).substring(0, 300)
        : null,
      query_type: queryType,
      card_data_found: cardDataFound,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_tokens: cacheCreationTokens,
      cache_read_tokens: cacheReadTokens,
      conversation_turn: conversationTurn,
      intent: intentIn,
      context_source: contextSourceIn,
      requested_card_record_id: requestedCardRecordId,
      requested_card_url_slug: requestedCardUrlSlug,
      requested_pc_product_id: requestedPcProductId,
      requested_set_name: requestedSetName,
      requested_language: requestedLanguage,
      matched_card_record_id: matchedCardRecordId,
      matched_card_url_slug: matchedCardUrlSlug,
      matched_pc_product_id: matchedPcProductId,
      matched_card_name: matchedCardName,
      matched_set_name: matchedSetName,
      matched_card_number: matchedCardNumber,
      matched_card_number_display: matchedCardNumberDisplay,
      matched_language: matchedLanguage,
      matched_variant: matchedVariant,
      match_method: matchMethod,
      exact_match_found: exactMatchFound,
      candidate_count: candidateCount,
      match_confidence: matchConfidence,
      grading_analysis_used:       gradingAnalysisUsed,
      grading_recommendation_code: gradingRecommendationCode,
      grading_break_even_grade:    gradingBreakEvenGrade,
      grading_data_confidence:     gradingDataConfidence,
    });

    // Block 5A-W-52A.3 — candidate-selection payload. Kept on the
    // primary response so the client can render selection UI in
    // place. Limited to 6 for the UI; the true candidate_count is
    // preserved for logging.
    const responseBody: Record<string, unknown> = {
      answer,
      tool_used: toolUsed,
      // v164-B: full list of tools called this turn (loop can call
      // more than one). Backward-compatible with clients that only
      // read tool_used; new eval assertions inspect this to enforce
      // "PSA pop claim requires get_grading_pop".
      tools_used: toolsUsedThisTurn,
      freshness_provenance: freshnessProvenance,
      // v167: echo the merged recommendation context so the client
      // can send it back verbatim on the next turn. Never overwrite
      // the client's local copy silently — the client should replace
      // its state with this value after each response.
      recommendation_context: mergedRecommendationContext,
      query_type: queryType,
      card_data_found: cardDataFound,
      exact_match_found: exactMatchFound,
      match_method: matchMethod,
      candidate_count: candidateCount,
      requested_card_record_id: requestedCardRecordId,
      matched_card_record_id: matchedCardRecordId,
      matched_card_url_slug: matchedCardUrlSlug,
      matched_pc_product_id: matchedPcProductId,
      matched_card_name: matchedCardName,
      matched_set_name: matchedSetName,
      matched_card_number: matchedCardNumber,
      matched_card_number_display: matchedCardNumberDisplay,
      matched_language: matchedLanguage,
      matched_variant: matchedVariant,
      // Block 5A-W-52B — grading provenance on the response so the
      // client can render its own UX cue when the LLM answers a
      // grade_card intent from the deterministic calculator.
      grading_analysis_used:       gradingAnalysisUsed,
      grading_recommendation_code: gradingRecommendationCode,
      grading_break_even_grade:    gradingBreakEvenGrade,
      grading_data_confidence:     gradingDataConfidence,
    };
    if (ambiguousCandidates && !structuredCard) {
      const list = ambiguousCandidates.slice(0, 6).map((c: any) => {
        // enrichCards() emits `card_name` as a markdown-linked
        // string ("[Name](url)") and `card_name_plain` as the raw
        // DB value ("Kleavor [Holo] #86"). Use the plain field
        // and strip the trailing "#NN".
        const rawName = typeof c.card_name_plain === "string"
          ? c.card_name_plain
          : (typeof c.card_name === "string" ? c.card_name : "");
        const cleaned = rawName.replace(/\s*#[A-Za-z0-9/-]+\s*$/, "").trim() || rawName;
        return {
          cardRecordId: c.id != null ? String(c.id) : null,
          cardUrlSlug: c.card_url_slug ?? "",
          priceChartingProductId: c.card_slug != null ? String(c.card_slug) : null,
          cardName: cleaned,
          setName: c.set_name ?? "",
          cardNumber: c.card_number != null ? String(c.card_number) : null,
          cardNumberDisplay: c.card_number_display ?? null,
          language: c.language === "jp" ? "jp" : "en",
          variant: c.variant ?? null,
          imageUrl: c.image_url ?? null,
        };
      });
      responseBody.requires_card_selection = true;
      responseBody.card_candidates = list;
    }
    return new Response(
      JSON.stringify(responseBody),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  } catch (err: any) {
    console.error("Handler error:", err);
    return new Response(
      JSON.stringify({
        error: "Something went wrong",
        detail: err.message,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }
});
