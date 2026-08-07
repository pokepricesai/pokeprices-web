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
    description: "PSA population data for a card.",
    input_schema: {
      type: "object",
      properties: {
        search_term: { type: "string" }
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
  }
];

const SYSTEM = `You are PokePrices - a Pokemon TCG pricing assistant for real UK collectors. Direct, confident, occasionally opinionated. Never sycophantic. Never use AI marketing language.

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

===========================================================================
CUTTING THROUGH MESSY QUERIES
===========================================================================

Users write messy. Your job is to pick out the card and search for it. Strip out everything else.

dewgong holo rare in pack mega evolution prefect order - search Dewgong Mega Evolution
Xerneas - 089/083 - M4: Ninja Spinner (m4) - search Xerneas 089 (Japanese set; secret rare X greater than Y is valid)
my charizard from the old days worth anything - search Charizard Base Set
got a shiny umbreon from the evolutions box - search Umbreon VMAX Evolving Skies
is the gold lugia from like 2002 worth money - search Lugia Neo Genesis
japanese rayquaza V from 2021 - search Rayquaza V (note the Japanese version)

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

Japanese set codes: M1, M2, M3, M4, SM-P, S, SV, SVL, CP, CHR, XY-P, BW-P, SR, UR, HR, RR, AR, CSR, sAR, sR. Also Eevee Heroes, VSTAR Universe, Shiny Treasure ex, Pokemon Card 151 (Japanese version), Crimson Haze.

If you identify a Japanese card, still search for it. In your reply explain it appears to be a Japanese card, English market prices may not apply, and suggest TCGPlayer Japan or Mercari Japan for accurate Japanese pricing.

===========================================================================
CARD NUMBER LOGIC
===========================================================================

X/Y means card X in a set of Y total. When X is greater than Y, it is a secret rare - completely valid, never say it is impossible. New sets like Ascended Heroes (Jan 2026) and Perfect Order (Mar 2026) may not be in the database yet - if no results, say so plainly.

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

  if (!parsedCards.length) return { raw_results: lines.join(" --- ") };

  const setNames = [...new Set(parsedCards.map((p: any) => p.setName))];
  const cardNames = [...new Set(parsedCards.map((p: any) => p.cardName))];

  // Block 5A-W-52A.3 — extend the projection with the identifier
  // fields the candidate-selection response needs (id, card_number,
  // card_number_display, language, variant, image_url). Without
  // these, the ambiguous-free-text short-circuit builds candidate
  // objects with empty slugs and null PC ids, and the client's
  // resend fails closed.
  const CARD_SEL = "id, card_slug, card_name, set_name, card_url_slug, card_number, card_number_display, language, variant, image_url";
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
      return { raw_results: lines.join(" --- ") };
    }
    return await enrichCards(lines, fallbackRows);
  }

  return await enrichCards(lines, cardRows);
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
      variant: card.variant,
      image_url: card.image_url,
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
  const keyword = searchTerm.split(" ")[0];
  const { data } = await supabase.from("psa_population")
    .select(PSA_POP_COLS)
    .ilike("card_name", `%${keyword}%`)
    .gt("total_graded", 0)
    .order("total_graded", { ascending: false })
    .limit(10);
  return { results: data || [] };
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
          if (qt) queryType = qt;

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
              if (!ambiguousCandidates) ambiguousCandidates = candidateArr;
            }
          }

          return {
            type: "tool_result" as const,
            tool_use_id: tb.id,
            content: JSON.stringify(data).substring(0, 1500),
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
