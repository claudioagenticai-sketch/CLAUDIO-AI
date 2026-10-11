---
id: claudio.p6.santorini
version: 1.0.0
status: approved
character: claudio
identity: CLAUDIO ID v1
pillar: P6
series: window-seat
scene: travel-santorini
look: travel
kind: image
model: byteplus/seedream-4.5
fallback_models: [google/nano-banana-2.1, fal/flux-2-pro]
params: {aspect: "4:5"}
refs: [01-front-neutral, 02-34-left, 11-golden-hour]
seed: none
cost_usd: 0.04
scores: {drift: 6, runs: 4, pass_rate: 0.75}
outputs:
  - {path: library/2026-10/example-santorini.jpg, sha256: 2e8f60b9}
tags: [travel, golden-hour, santorini, headphones, carousel]
created: 2026-10-08
updated: 2026-10-08
retires: none
---
## Prompt
[CLAUDIO ID v1] Claudio, a 35-year-old man (adult, mid-thirties) with a clean shaved head and light stubble; a full, thick,
groomed dark-brown beard of medium length with a slightly lighter moustache; light blue-grey eyes; strong straight dark-brown
brows; an angular face with defined cheekbones and light freckles; a calm closed-lip half-smile; natural skin texture with
visible pores; a broad, strong, gym-fit build; a chunky silver chain-link bracelet on one wrist. wearing a white linen shirt open over a black top, large cream over-ear headphones around his neck, sunglasses pushed up into his hair. Vertical 4:5 travel
photograph in Oia, Santorini at golden hour: he sits sideways on a whitewashed wall, knees up, looking over his shoulder at
the lens with a relaxed smile; behind him, white cubic houses cascade down the cliff to a deep blue caldera, a blue dome soft
in the distance, the sun low and warm on his face. Warm backlight rims his head and makes the light rims his beard. 50mm, f/2,
eye level, Kodak Portra 400 colour, fine grain, gentle haze. No other people in focus, no text.

## Negative
teenager, boyish face, hair on top, receding hairline, ponytail, man bun, blonde, grey beard, patchy beard, goatee, moustache only, clean-shaven, brown eyes, plastic skin, airbrushed, extra fingers, warped hands, text, watermark, logo, crowds of tourists in focus

## Notes
- Seedream: send the refs and generate the whole "window seat" set as one sequential batch so identity holds across tiles
  (refs + outputs ≤ 15 per batch, checked 2026-10).
- Place, not event: never caption it as a real trip on a real date with real people.
