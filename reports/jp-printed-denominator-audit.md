# Japanese printed-denominator audit

_Generated: 2026-08-04T20:32:12.598Z_

## Method

- Scope: every `set_metadata` row with `language = 'jp'`.
- Reference: **10** hand-verified per-set printed denominators in `scripts/scanner/data/jp-printed-denominators.reference.json`.
- Source: [Bulbapedia — List of Japanese Pokemon TCG expansions](https://bulbapedia.bulbagarden.net/wiki/List_of_Japanese_Pok%C3%A9mon_Trading_Card_Game_expansions).
- **No denominator is inferred from arithmetic over imported cards.** A stored denominator is only classified against a sourced reference value.
- Model: reuses the English scheme — `cards.set_printed_total` IS the printed denominator; `set_metadata.total_cards` remains the catalogue count. Confirmed by probing English Scarlet & Violet 151 (`total_cards=411, set_printed_total=165`).

## Totals

| Classification | Sets | Card rows in mismatched sets |
|----------------|-----:|----------------------------:|
| CONFIRMED_MATCH | 8 | 0 |
| CONFIRMED_MISMATCH | 2 | 616 |
| AMBIGUOUS_MAPPING | 0 | 0 |
| REFERENCE_NOT_AVAILABLE | 117 | 0 |

## Confirmed mismatches (proposed corrections)

| set_name | stored | reference | rows | sample current | sample proposed |
|----------|-------:|----------:|-----:|----------------|-----------------|
| Japanese Battle Partners | /130 | /100 | 133 | 132/130 | 132/100 |
| Japanese Terastal Festival | /128 | /187 | 483 | 237/128 | 237/187 |

## Confirmed matches

| set_name | stored + reference | source |
|----------|-------------------:|--------|
| Japanese Ruler of the Black Flame | /108 | bulbapedia_luke_2026-08-04 |
| Japanese Scarlet & Violet 151 | /165 | bulbapedia_luke_2026-08-04 |
| Japanese Shiny Treasure ex | /190 | bulbapedia_luke_2026-08-04 |
| Japanese VMAX Climax | /184 | bulbapedia_luke_2026-08-04 |
| Japanese Shiny Star V | /190 | bulbapedia_luke_2026-08-04 |
| Japanese Tag All Stars | /173 | bulbapedia_luke_2026-08-04 |
| Japanese GX Ultra Shiny | /150 | bulbapedia_luke_2026-08-04 |
| Japanese Best of XY | /171 | bulbapedia_luke_2026-08-04 |

## Ambiguous mappings

_None._

## Reference not available

117 JP sets have no authoritative per-set entry yet. They are NOT classified as suspicious. Add entries to `scripts/scanner/data/jp-printed-denominators.reference.json` to bring them under audit.

## Schema decision

The existing English implementation ALREADY separates catalogue count from printed denominator via two distinct columns:

```
set_metadata.total_cards   — catalogue / row count (e.g. 411 for English SV 151)
cards.set_printed_total    — printed denominator  (e.g. 165 for English SV 151)
cards.card_number_display  — composed as card_number || "/" || set_printed_total
```

No new `set_metadata.printed_denominator` column is required. Correcting Japanese sets means writing the true printed base into `cards.set_printed_total` and regenerating `cards.card_number_display` for the affected rows. `set_metadata.total_cards` remains as-is (catalogue count).