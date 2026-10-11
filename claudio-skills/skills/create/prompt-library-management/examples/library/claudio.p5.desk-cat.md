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
[CLAUDIO ID v1] Claudio, a 28-year-old man (adult, late twenties) with a glossy jet-black jaw-length blunt bob and heavy straight bangs just above the brows; vivid copper-orange streak panels through the front bangs and one side; a small orange hair clip at the side of the bangs; small thin gold hoop earrings; light freckles across the nose and cheeks; warm brown eyes; straight dark brows; a knowing closed-lip half-smile; natural skin texture with visible pores; fine-line tattoos on his arms (small stars, a rose, a sun). wearing an oversized fuzzy black knit jumper with sleeves pulled over his hands. Vertical 4:5 photograph at his desk late at night. He sits cross-legged on his chair, knees up, typing on a
silver laptop with a single pink butterfly sticker on the lid, glancing up at the lens with an amused half-smile. A grey
tabby cat with white paws and green-gold eyes is stretched across the desk next to the keyboard, one paw on the trackpad.
Two monitors behind his glow with soft out-of-focus dashboards and candlestick charts (no readable numbers); a black mug with
a pink butterfly print; a small desk lamp with a warm bulb. Rose and violet monitor glow on one side of his face, warm lamp
light on the other. 35mm, f/2, slightly above eye level, Fujifilm Pro 400H colour, fine grain. No text, no logos.

## Negative
teenager, childlike face, school uniform, long hair, ponytail, blonde, red hair all over, thin highlights, side-swept bangs, extra streaks, plastic skin, airbrushed, heavy makeup, extra fingers, warped hands, text, watermark, logo, readable screen text, extra cat legs

## Notes
- The cat's markings must match ref cat-01 (tabby stripes, white paws, green-gold eyes).
- Pairs with a 5 s Kling or Hailuo animation: cat's tail flicks, he types, monitor glow pulses.
