# Claudio identity blocks — copy exactly

Version: **CLAUDIO ID v1** (2026-10-12). If the owner changes his look, add v2 below and keep v1 for old series.

## Long (photoreal image + video, most models)

```text
[CLAUDIO ID v1] Claudio, a 35-year-old man (adult, mid-thirties) with a clean shaved head and light stubble; a full, thick,
groomed dark-brown beard of medium length with a slightly lighter moustache; light blue-grey eyes; strong straight dark-brown
brows; an angular face with defined cheekbones and light freckles; a calm closed-lip half-smile; natural skin texture with
visible pores; a broad, strong, gym-fit build; a chunky silver chain-link bracelet on one wrist.
```

## Short (tight budgets: Hailuo, Midjourney, SFX-style fields)

```text
Claudio, 35-year-old man, clean shaved head, full thick dark-brown beard, light blue-grey eyes, strong dark brows,
light freckles, broad build, chunky silver chain bracelet, calm half-smile
```

## Midjourney (use with an omni reference of an approved ref image)

Omni Reference (`--oref`, weight `--ow` 0–1000, default 100) is a **V7** feature; on V8.x (default since 2026-07-24) it is
rendered by V7 or not at all, so pin `--v 7` for identity work (checked 2026-10). `--cref` is legacy and ignored.

```text
photo of a 35-year-old man, clean shaved head, full thick groomed dark-brown beard, light blue-grey eyes, strong dark
brows, light freckles, broad build, chunky silver chain bracelet, calm half-smile --oref <ref-url> --ow 250 --style raw --v 7
```

## JSON (FLUX.2 structured prompt subject)

```json
{
  "subject": {
    "name": "Claudio",
    "age": "35-year-old adult man",
    "head": "clean shaved head with light stubble, no hair on top",
    "beard": "full, thick, groomed dark-brown beard of medium length, slightly lighter moustache",
    "accessories": ["chunky silver chain-link bracelet on one wrist"],
    "face": "light blue-grey eyes, strong straight dark-brown brows, angular face with defined cheekbones, light freckles, calm closed-lip half-smile, natural skin texture",
    "build": "broad, strong, gym-fit"
  }
}
```

## Wardrobe strings (append one after the ID block)

| Look | String |
|---|---|
| Signature | `wearing an olive-green crew-neck cotton t-shirt, red-and-green tartan trousers, a chunky silver chain-link bracelet` |
| Cosy black | `wearing a chunky dark-brown ribbed knit jumper with the sleeves pushed up` |
| Studio | `wearing a sage-green unstructured blazer over a navy-black crew-neck t-shirt` |
| Night out | `wearing an olive t-shirt, dark rectangular sunglasses, a chunky silver chain-link bracelet` |
| Desk | `wearing a black long-sleeve t-shirt and thin metal round glasses` |
| Travel | `wearing an off-white linen overshirt open over a black t-shirt, dark over-ear headphones around his neck` |
| Home | `wearing a navy hoodie` |

## Negative block

```text
teenager, boyish face, hair on top, receding hairline, ponytail, man bun, blonde, grey beard, patchy beard, goatee,
moustache only, clean-shaven, brown eyes, plastic skin, airbrushed, extra fingers, warped hands, text, watermark, logo
```
