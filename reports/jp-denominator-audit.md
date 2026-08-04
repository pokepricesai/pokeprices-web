# Japanese denominator audit

_Generated: 2026-08-04T19:37:15.657Z_

## Method

- Scope: every `set_metadata` row with `language = 'jp'`.
- Reference: **10** hand-verified per-set printed denominators in `scripts/scanner/data/jp-printed-denominators.reference.json`.
- Default reference source: [Bulbapedia — List of Japanese Pokemon TCG expansions](https://bulbapedia.bulbagarden.net/wiki/List_of_Japanese_Pok%C3%A9mon_Trading_Card_Game_expansions).
- **No denominator is inferred from arithmetic over imported cards.** A stored denominator is only classified as MATCH or MISMATCH against a sourced reference value.

## Totals

| Classification | Count |
|----------------|------:|
| CONFIRMED_MATCH | 8 |
| CONFIRMED_MISMATCH | 2 |
| AMBIGUOUS_MAPPING | 0 |
| REFERENCE_NOT_AVAILABLE | 117 |

## Confirmed mismatches

| set_name | stored | reference | max numerator | secrets | source | notes |
|----------|-------:|----------:|--------------:|--------:|--------|-------|
| Japanese Battle Partners | 130 | 100 | 132 | 2 | bulbapedia_luke_2026-08-04 | Stored /130 but authoritative printed base is /100. |
| Japanese Terastal Festival | 128 | 187 | 237 | 109 | bulbapedia_luke_2026-08-04 | Stored /128 but authoritative printed base is /187. |

## Confirmed matches

| set_name | stored + reference | source |
|----------|-------------------:|--------|
| Japanese Ruler of the Black Flame | 108 | bulbapedia_luke_2026-08-04 |
| Japanese Scarlet & Violet 151 | 165 | bulbapedia_luke_2026-08-04 |
| Japanese Shiny Treasure ex | 190 | bulbapedia_luke_2026-08-04 |
| Japanese VMAX Climax | 184 | bulbapedia_luke_2026-08-04 |
| Japanese Shiny Star V | 190 | bulbapedia_luke_2026-08-04 |
| Japanese Tag All Stars | 173 | bulbapedia_luke_2026-08-04 |
| Japanese GX Ultra Shiny | 150 | bulbapedia_luke_2026-08-04 |
| Japanese Best of XY | 171 | bulbapedia_luke_2026-08-04 |

## Ambiguous mappings

| set_name | stored (raw) | notes |
|----------|--------------|-------|

## Reference not available

117 sets do not yet have an authoritative denominator entry. These are NOT classified as suspicious — they simply haven't been verified against a source. Add per-set entries to `scripts/scanner/data/jp-printed-denominators.reference.json` to classify them.

<details><summary>List of REFERENCE_NOT_AVAILABLE sets (release year, stored denom, max numerator)</summary>

| set_name | release_year | stored | max num |
|----------|-------------:|-------:|--------:|
| Japanese White Flare | 2025 | 174 | 174 |
| Japanese Abyss Eye | 2025 | 118 | 118 |
| Japanese Black Bolt | 2025 | 174 | 174 |
| Japanese Glory of Team Rocket | 2025 | 132 | 132 |
| Japanese Offense and Defense of the Furthest Ends | 2025 | 68 | 68 |
| Japanese Nihil Zero | 2025 | 117 | 117 |
| Japanese Inferno X | 2025 | 116 | 116 |
| Japanese Mysterious Mountains | 2025 | 91 | 91 |
| Japanese Undone Seal | 2025 | 83 | 83 |
| Japanese Wild Force | 2024 | 100 | 100 |
| Japanese Crimson Haze | 2024 | 71 | 96 |
| Japanese Cyber Judge | 2024 | 71 | 100 |
| Japanese Heat Wave Arena | 2024 | 92 | 92 |
| Japanese Mask of Change | 2024 | 66 | 133 |
| Japanese Mega Brave | 2024 | 92 | 92 |
| Japanese Mega Dream ex | 2024 | 250 | 250 |
| Japanese Mega Symphonia | 2024 | 92 | 92 |
| Japanese Night Wanderer | 2024 | 66 | 94 |
| Japanese Start Deck 100 Battle Collection | 2024 |  | 766 |
| Japanese Stellar Miracle | 2024 | 100 | 135 |
| Japanese Super Electric Breaker | 2024 | 71 | 138 |
| Japanese Violet Ex | 2023 | 108 | 108 |
| Japanese ex Starter Decks | 2023 | 139 | 139 |
| Japanese Ancient Roar | 2023 | 66 | 95 |
| Japanese Clay Burst | 2023 | 71 | 99 |
| Japanese Future Flash | 2023 | 66 | 95 |
| Japanese Paradise Dragona | 2023 | 63 | 94 |
| Japanese Raging Surf | 2023 | 62 | 92 |
| Japanese Scarlet Ex | 2023 | 108 | 108 |
| Japanese Snow Hazard | 2023 | 71 | 99 |
| Japanese Triplet Beat | 2023 | 73 | 103 |
| Japanese VSTAR Universe | 2022 | 262 | 262 |
| Japanese Battle Region | 2022 | 70 | 93 |
| Japanese Dark Phantasma | 2022 | 71 | 99 |
| Japanese Go | 2022 | 71 | 93 |
| Japanese Lost Abyss | 2022 | 100 | 127 |
| Japanese Paradigm Trigger | 2022 | 100 | 125 |
| Japanese Incandescent Arcana | 2022 | 68 | 94 |
| Japanese Space-Time | 2022 |  | 453 |
| Japanese Star Birth | 2022 | 100 | 127 |
| Japanese Start Deck 100 | 2022 |  | 422 |
| Japanese 25th Anniversary Collection | 2021 | 28 | 30 |
| Japanese 25th Anniversary Promo | 2021 | 25 | 25 |
| Japanese Blue Sky Stream | 2021 | 67 | 90 |
| Japanese Eevee Heroes | 2021 | 69 | 101 |
| Japanese Fusion Arts | 2021 | 100 | 129 |
| Japanese Amazing Volt Tackle | 2020 | 100 | 121 |
| Japanese Alter Genesis | 2019 | 95 | 117 |
| Japanese Double Blaze | 2019 | 95 | 116 |
| Japanese Dream League | 2019 | 49 | 75 |
| Japanese Miracle Twins | 2019 | 94 | 115 |
| Japanese Remix Bout | 2019 | 70 | 80 |
| Japanese Super-Burst Impact | 2018 | 94 | 111 |
| Japanese Tag Bolt | 2018 | 95 | 118 |
| Japanese Awakening Psychic King | 2017 | 51 | 88 |
| Japanese GX Battle Boost | 2017 | 125 | 125 |
| Japanese Shining Legends | 2017 | 72 | 82 |
| Japanese 20th Anniversary | 2016 | 87 | 103 |
| Japanese Bandit Ring | 2015 | 84 | 97 |
| Japanese Emerald Break | 2015 | 78 | 91 |
| Japanese Gaia Volcano | 2015 | 70 | 80 |
| Japanese Wild Blaze | 2014 | 90 | 90 |
| Japanese EX Battle Boost | 2014 | 99 | 99 |
| Japanese Phantom Gate | 2014 | 88 | 97 |
| Japanese PokeKyun Collection | 2014 | 32 | 32 |
| Japanese Rising Fist | 2014 | 88 | 105 |
| Japanese Megalo Cannon | 2013 | 86 | 86 |
| Japanese Plasma Gale | 2013 | 79 | 79 |
| Japanese Cold Flare | 2012 | 65 | 65 |
| Japanese Challenge from the Darkness | 2011 | 208 | 208 |
| Japanese Clash of the Blue Sky | 2010 | 82 | 82 |
| Japanese Crossing the Ruins | 2010 | 248 | 248 |
| Japanese Darkness, and to Light | 2010 | 251 | 251 |
| Japanese Advent of Arceus | 2009 | 90 | 90 |
| Japanese Beat of the Frontier | 2009 | 100 | 100 |
| Japanese Intense Fight in the Destroyed Sky | 2009 | 92 | 92 |
| Japanese Bonds to the End of Time | 2008 | 90 | 90 |
| Japanese Temple of Anger | 2008 |  | 446 |
| Japanese World Champions Pack | 2007 | 108 | 108 |
| Japanese Secret of the Lakes | 2007 | 298 | 298 |
| Japanese Shining Darkness | 2007 |  | 488 |
| Japanese Holon Phantom | 2006 | 104 | 104 |
| Japanese Holon Research | 2005 | 86 | 86 |
| Japanese Flight of Legends | 2004 | 82 | 82 |
| Japanese Rocket Gang Strikes Back | 2004 | 85 | 85 |
| Japanese Magma VS Aqua Two Ambitions | 2003 | 80 | 80 |
| Japanese Ninja Spinner | 2003 | 120 | 120 |
| Japanese Miracle Crystal | 2003 | 75 | 75 |
| Japanese Golden Sky, Silvery Ocean | 2003 | 106 | 106 |
| Japanese Wind from the Sea | 2002 | 90 | 90 |
| Japanese 2002 McDonald's | 2002 | 18 | 18 |
| Japanese Rulers of the Heavens | 2002 | 54 | 54 |
| Japanese The Town on No Map | 2002 | 92 | 92 |
| Japanese Web | 2001 | 48 | 48 |
| Japanese Expedition Expansion Pack | 2001 | 128 | 128 |
| Japanese VS | 2001 | 142 | 142 |
| Japanese Awakening Legends | 2000 | 251 | 251 |
| Japanese CD Promo | 2000 | 151 | 151 |
| Japanese Leaders' Stadium | 2000 | 148 | 148 |
| Japanese Old Maid | 2000 |  |  |
| Japanese Neo Premium File | 2000 | 251 | 251 |
| Japanese Meiji Promo | 2000 | 142 | 142 |
| Japanese Promo | 2000 |  | 659614 |
| Japanese Red Flash | 2000 | 65 | 65 |
| Japanese Reviving Legends | 2000 | 81 | 81 |
| Japanese Split Earth | 2000 | 91 | 91 |
| Japanese 1999 Merlin | 1999 | 240 | 240 |
| Japanese Gold, Silver, New World | 1999 | 249 | 249 |
| Japanese Vending | 1998 |  | 1201 |
| Japanese 1998 Carddass | 1998 | 275 | 275 |
| Japanese 1997 Carddass | 1997 | 151 | 151 |
| Japanese Mystery of the Fossils | 1997 | 151 | 151 |
| Japanese Jungle | 1997 | 143 | 143 |
| Japanese Rocket Gang | 1997 | 149 | 149 |
| Japanese Topsun | 1997 | 248 | 248 |
| Japanese 1996 Carddass | 1996 | 156 | 156 |
| Japanese Expansion Pack | 1996 | 150 | 150 |

</details>

## Interpretation

The scanner-side 51B fix (see `migrations/2026-08-04-scan-card-match-denominator-tolerance.sql`) makes the RPC tolerant of a mismatch between the scanned and stored denominator by returning candidates with a `denominator_conflict` flag rather than dropping them.

A `denominator_conflict` flag ONLY means the two values differ. It does NOT prove the stored value is wrong — the OCR may have misread the denominator, or the reference may not cover this printing. Use the classifications above to decide whether the STORED value should be corrected.

**Data correction for the CONFIRMED_MISMATCH sets is NOT part of this block.** A separate review-first block should:

1. Cross-check each mismatch against at least a second authoritative source per set.
2. Identify the import-pipeline logic that produced the wrong value.
3. Prepare a dry-run correction migration.
4. Return that migration for review before applying.