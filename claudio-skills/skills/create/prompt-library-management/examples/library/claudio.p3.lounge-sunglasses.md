---
id: claudio.p3.lounge-sunglasses
version: 1.1.0
status: approved
character: claudio
identity: CLAUDIO ID v1
pillar: P3
series: sunglasses-on-off
scene: vintage-lounge
look: signature
kind: video
model: fal/kling-2.6-pro
fallback_models: [runway/gen4.5, fal/hailuo-2.3]
first_frame_model: openai/gpt-image-2.5-flare
params: {aspect: "9:16", durationSec: 5, audio: false}
refs: [01-front-neutral, 06-sunglasses]
seed: none
cost_usd: 0.40
scores: {drift: 7, runs: 6, pass_rate: 0.83}
outputs:
  - {path: library/2026-10/example-lounge-1.mp4, sha256: c21f9a7b}
tags: [style, reveal, sunglasses, lamp, vintage, loop, portrait]
created: 2026-10-08
updated: 2026-10-14
retires: none
---
## First frame
[CLAUDIO ID v1] Claudio, a 35-year-old man (adult, mid-thirties) with a clean shaved head and light stubble; a full, thick,
groomed dark-brown beard of medium length with a slightly lighter moustache; light blue-grey eyes; strong straight dark-brown
brows; an angular face with defined cheekbones and light freckles; a calm closed-lip half-smile; natural skin texture with
visible pores; a broad, strong, gym-fit build; a chunky silver chain-link bracelet on one wrist. wearing an olive-green crew-neck cotton t-shirt, red-and-green tartan trousers, a chunky silver chain-link bracelet, plus dark rectangular sunglasses with dark lenses, worn on his face. Vertical 9:16 medium shot in a lamp-lit
vintage lounge: he leans back against a dark polished wood dresser with brass drop handles, one elbow resting on it, head
tilted slightly, a calm half-smile with a soft rose lip. Warm butter-yellow walls, three framed botanical cross-stitch prints
(red poppies, green leaves) behind him, a brass table lamp with a pleated cream shade on the left glowing tungsten-warm.
50mm lens, f/2.2, eye level, warm 3200K key from the lamp, soft shadow side, Kodak Portra 400 colour, fine grain. Image 1 is
his face reference, image 2 shows him in sunglasses. No text, no logos.

## Prompt
Slow, confident sunglasses reveal. [0-1s] he holds still with the sunglasses on, half-smile; [1-3s] he lifts his right hand
and slowly lowers the sunglasses down his nose with two fingers, revealing light blue-grey eyes looking straight into the lens;
[3-5s] the half-smile widens slightly, a tiny eyebrow raise. Locked-off camera with an almost imperceptible push-in. Lamp
light flickers very gently. His face, freckles, shaved head, beard, silver chain bracelet and bracelet stay exactly as in the first frame.

## Negative
teenager, boyish face, hair on top, receding hairline, ponytail, man bun, blonde, grey beard, patchy beard, goatee, moustache only, clean-shaven, brown eyes, plastic skin, airbrushed, extra fingers, warped hands, text, watermark, logo, aviator sunglasses, coloured lenses, extra fingers on the glasses hand

## Notes
- v1.1.0 (A/B 2026-10-14): 50mm beat 35mm — 35mm widened his jaw and read younger.
- Loop in edit: play forward, then reverse 3–5 s → 8 s seamless "on/off" loop.
- Hands on glasses are the failure point; check frames at 2 s and 3 s.
