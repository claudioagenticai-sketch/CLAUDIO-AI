---
id: claudio.p5.desk-cat
version: 1.0.0
status: approved
character: claudio
identity: CLAUDIO ID v1
pillar: P5
series: agent-diaries
scene: desk-night
look: cosy-black
kind: image
model: google/nano-banana-2.1
fallback_models: [byteplus/seedream-4.5]
params: {aspect: "4:5", resolution: "2K"}
refs: [01-front-neutral, 08-seated-cosy, cat-01]
seed: none
cost_usd: 0.05
scores: {drift: 7, runs: 3, pass_rate: 1.0}
outputs:
  - {path: library/2026-10/example-desk-cat.png, sha256: 6c7d01ef}
tags: [desk, cat, laptop, night, platform, cosy, feed]
created: 2026-10-08
updated: 2026-10-08
retires: none
---
## Prompt
[CLAUDIO ID v1] Claudio, a 35-year-old man (adult, mid-thirties) with a clean shaved head and light stubble; a full, thick,
groomed dark-brown beard of medium length with a slightly lighter moustache; light blue-grey eyes; strong straight dark-brown
brows; an angular face with defined cheekbones and light freckles; a calm closed-lip half-smile; natural skin texture with
visible pores; a broad, strong, gym-fit build; a chunky silver chain-link bracelet on one wrist. wearing an chunky dark-brown knit jumper with the sleeves pushed up. Vertical 4:5 photograph at his desk late at night. He sits cross-legged on his chair, knees up, typing on a
silver laptop with a single rose-pink sticker on the lid, glancing up at the lens with an amused half-smile. A grey tabby cat with a white muzzle and green-gold eyes is stretched across the desk next to the keyboard, one paw on the trackpad.
Two monitors behind his glow with soft out-of-focus dashboards and candlestick charts (no readable numbers); a black mug ; a small desk lamp with a warm bulb. Rose and violet monitor glow on one side of his face, warm lamp
light on the other. 35mm, f/2, slightly above eye level, Fujifilm Pro 400H colour, fine grain. No text, no logos.

## Negative
teenager, boyish face, hair on top, receding hairline, ponytail, man bun, blonde, grey beard, patchy beard, goatee, moustache only, clean-shaven, brown eyes, plastic skin, airbrushed, extra fingers, warped hands, text, watermark, logo, readable screen text, extra cat legs

## Notes
- The cat's markings must match ref cat-01 (tabby stripes, white paws, green-gold eyes).
- Pairs with a 5 s Kling or Hailuo animation: cat's tail flicks, he types, monitor glow pulses.
