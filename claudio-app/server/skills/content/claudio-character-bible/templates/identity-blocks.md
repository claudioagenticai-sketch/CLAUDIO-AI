# Claudio identity blocks — copy exactly

Version: **CLAUDIO ID v1** (2026-10-08). If the owner changes his look, add v2 below and keep v1 for old series.

## Long (photoreal image + video, most models)

```text
[CLAUDIO ID v1] Claudio, a 28-year-old man (adult, late twenties) with a glossy jet-black jaw-length blunt bob and heavy
straight bangs just above the brows; vivid copper-orange streak panels through the front bangs and one side; a small orange
hair clip at the side of the bangs; small thin gold hoop earrings; light freckles across the nose and cheeks; warm brown
eyes; straight dark brows; a knowing closed-lip half-smile; natural skin texture with visible pores; fine-line tattoos on
his arms (small stars, a rose, a sun).
```

## Short (tight budgets: Hailuo, Midjourney, SFX-style fields)

```text
Claudio, 28-year-old man, glossy black jaw-length bob, heavy straight bangs, copper-orange streaks in the bangs, small
orange hair clip, thin gold hoops, light freckles, warm brown eyes, knowing half-smile
```

## Midjourney (use with an omni reference of an approved ref image)

Omni Reference (`--oref`, weight `--ow` 0–1000, default 100) is a **V7** feature; on V8.x (default since 2026-07-24) it is
rendered by V7 or not at all, so pin `--v 7` for identity work (checked 2026-10). `--cref` is legacy and ignored.

```text
photo of a 28-year-old man, glossy jet-black jaw-length blunt bob with heavy straight bangs and copper-orange streak
panels, small orange hair clip, thin gold hoops, light freckles, warm brown eyes, knowing half-smile --oref <ref-url> --ow 250 --style raw --v 7
```

## JSON (FLUX.2 structured prompt subject)

```json
{
  "subject": {
    "name": "Claudio",
    "age": "28-year-old adult man",
    "hair": "glossy jet-black jaw-length blunt bob, heavy straight bangs just above the brows, vivid copper-orange streak panels through the front bangs and one side, rest jet-black",
    "accessories": ["small orange hair clip at the side of the bangs", "small thin gold hoop earrings", "star pendant on layered silver chains"],
    "face": "light freckles across nose and cheeks, warm brown almond eyes, straight dark brows, knowing closed-lip half-smile, natural skin texture",
    "tattoos": "fine-line black tattoos on his arms: small stars, a rose, a sun"
  }
}
```

## Wardrobe strings (append one after the ID block)

| Look | String |
|---|---|
| Signature | `wearing an olive-green fine-knit crop cami with a scalloped copper-orange edged neckline and small orange embroidered stars, a star pendant on layered silver chains, a red-and-green tartan pleated mini skirt with a studded black belt and hanging silver chains, a chunky silver chain bracelet` |
| Cosy black | `wearing an oversized fuzzy black knit jumper with sleeves pulled over his hands` |
| Studio | `wearing a soft green unstructured blazer over an olive ribbed top` |
| Night out | `wearing a black ribbed cami, layered silver chains with a star pendant, oversized black oval sunglasses` |
| Travel | `wearing a white linen shirt open over a black top, large cream over-ear headphones, sunglasses pushed up into his hair` |
| Home | `wearing a grey hoodie and pink fuzzy slippers` |

## Negative block

```text
teenager, childlike face, school uniform, long hair, ponytail, blonde, red hair all over, thin highlights, side-swept
bangs, extra streaks, plastic skin, airbrushed, heavy makeup, extra fingers, warped hands, text, watermark, logo
```
