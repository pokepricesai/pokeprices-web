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

If PSA 10 is more than 3x PSA 9, mention that PSA 9 is usually better value.

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

  const { data: cardRows } = await supabase
    .from("cards")
    .select("card_slug, card_name, set_name, card_url_slug")
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
      .select("card_slug, card_name, set_name, card_url_slug")
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

function logChat(params: any) {
  supabase.from("chat_logs").insert([{
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
    cost_usd: calcCost(
      params.input_tokens || 0,
      params.output_tokens || 0,
      params.cache_creation_tokens || 0,
      params.cache_read_tokens || 0,
    ),
    conversation_turn: params.conversation_turn || 1,
    pre_routed: false,
  }]).then(({ error }) => {
    if (error) console.error("Log failed:", error);
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
    const { message, session_id, history } = await req.json();
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

    let cleanMessage = message;
    let cardPageContext = "";
    const ctxMatch = message.match(
      /^\[Context: asking about ([^\]]+)\]\s*(.*)/s,
    );
    if (ctxMatch) {
      cardPageContext = ctxMatch[1].trim();
      cleanMessage = ctxMatch[2].trim() ||
        `Tell me about ${cardPageContext}`;
    }

    const userContent = cardPageContext
      ? `Currently viewing on PokePrices: "${cardPageContext}". ` +
        `Question: ${cleanMessage}. Search for this card.`
      : cleanMessage;

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

          return {
            type: "tool_result" as const,
            tool_use_id: tb.id,
            content: JSON.stringify(data).substring(0, 1500),
          };
        })
      );

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
    });

    return new Response(
      JSON.stringify({
        answer,
        tool_used: toolUsed,
        query_type: queryType,
        card_data_found: cardDataFound,
      }),
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
