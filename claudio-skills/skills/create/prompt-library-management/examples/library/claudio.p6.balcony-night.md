---
id: claudio.p6.balcony-night
version: 1.0.0
status: draft
character: claudio
identity: CLAUDIO ID v1
pillar: P6
series: none
scene: balcony-night
look: night-out
kind: image
model: midjourney/v7
fallback_models: [google/nano-banana-2.1]
params: {aspect: "4:5", oref_weight: 250, style: raw}
refs: [01-front-neutral]
seed: 2210
cost_usd: none
scores: {drift: 6, runs: 2, pass_rate: 0.5}
outputs:
  - {path: library/2026-10/example-balcony-mj.png, sha256: 1a2b3c4d}
tags: [night, balcony, city-lights, wine, midjourney, manual]
created: 2026-10-08
updated: 2026-10-08
retires: none
---
## Prompt
[CLAUDIO ID v1] Claudio, a 35-year-old man (adult, mid-thirties) with a clean shaved head and light stubble; a full, thick,
groomed dark-brown beard of medium length with a slightly lighter moustache; light blue-grey eyes; strong straight dark-brown
brows; an angular face with defined cheekbones and light freckles; a calm closed-lip half-smile; natural skin texture with
visible pores; a broad, strong, gym-fit build; a chunky silver chain-link bracelet on one wrist.
Midjourney (manual, in the Midjourney app — not available through @useclaudio/media). Omni Reference is V7-only, so pin
`--v 7` (checked 2026-10):

```text
candid photo of a 35-year-old man with a clean shaved head, a full, thick dark-brown beard, strong dark brows in the beard, chunky silver chain bracelet, broad build, light freckles, light blue-grey eyes, wearing a black t-shirt and
the chunky silver chain bracelet, leaning on a glass balcony railing of a high-rise at night, a glass of white wine
in his hand, the city lights glittering below in warm bokeh, he looks back over his shoulder at the camera with a knowing
half-smile, 35mm film photo, Cinestill 800T halation, soft grain --ar 4:5 --oref <url of 01-front-neutral> --ow 250
--style raw --v 7 --seed 2210 --no teenager, childlike face, long hair, text, watermark
```

## Negative
handled inline with `--no` above

## Notes
- Draft: pass rate 0.5 — Midjourney sometimes grows hair on his head. Try `--ow 350` next (A/B logged).
- Midjourney seeds on V8 are only ~99 % reproducible; on V7 with --oref expect variation anyway.
- Upload the ref from the approved pack only; never a real person's photo.
