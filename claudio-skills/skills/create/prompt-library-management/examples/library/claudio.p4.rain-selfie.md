---
id: claudio.p4.rain-selfie
version: 1.1.0
status: approved
character: claudio
identity: CLAUDIO ID v1
pillar: P4
series: forecast-dared-me
scene: warehouse-rain
look: signature
kind: video
model: fal/kling-3-pro
fallback_models: [fal/kling-2.6-pro, google/omni-flash]
first_frame_model: google/nano-banana-2.1
params: {aspect: "9:16", durationSec: 10, audio: true}
refs: [01-front-neutral, 05-laugh, 09-phone-arm]
seed: none
cost_usd: 1.73
scores: {drift: 7, runs: 5, pass_rate: 0.8}
outputs:
  - {path: library/2026-10/example-rain-1.mp4, sha256: 9a41c2e0}
tags: [ugc, selfie, rain, running, motion, city, laugh]
created: 2026-10-08
updated: 2026-10-13
retires: none
---
## First frame
[CLAUDIO ID v1] Claudio, a 35-year-old man (adult, mid-thirties) with a clean shaved head and light stubble; a full, thick,
groomed dark-brown beard of medium length with a slightly lighter moustache; light blue-grey eyes; strong straight dark-brown
brows; an angular face with defined cheekbones and light freckles; a calm closed-lip half-smile; natural skin texture with
visible pores; a broad, strong, gym-fit build; a chunky silver chain-link bracelet on one wrist. In this shot he is laughing with his mouth wide open, delighted, hair damp at the ends. wearing an olive-green crew-neck cotton t-shirt, red-and-green tartan trousers, a chunky silver chain-link bracelet. Vertical 9:16
front-camera selfie at arm's length while he runs across an empty warehouse lot in light rain at dusk: his outstretched
forearm and the chunky chain bracelet enters from the bottom-left corner holding the phone (phone
not visible), wet black asphalt with puddle reflections, a row of grey roll-up loading-dock doors, yellow concrete bollards,
an overcast blue-grey sky. 24mm phone-lens look, slight wide-angle distortion at the edges, cool ambient light with a warm
skin tone, raindrops on the lens edge. No people, no readable signs, no logos.

## Prompt
Front-camera selfie while running, phone held at arm's length. [0-4s] he runs forward laughing, the camera bouncing gently
with his steps, rain streaks crossing the frame, splashes at his feet; [4-7s] he does a small spin, the background whips
past, he shrieks with laughter; [7-10s] he slows down, catches his breath and grins into the lens with a wink. His arm and
bracelet stay in the bottom-left of frame the whole time. Keep his face, shaved head, beard and outfit exactly as in the first
frame. Audio: steady rain, splashing footsteps, his breathless laughter. No music.

## Negative
teenager, boyish face, hair on top, receding hairline, ponytail, man bun, blonde, grey beard, patchy beard, goatee, moustache only, clean-shaven, brown eyes, plastic skin, airbrushed, extra fingers, warped hands, text, watermark, logo, umbrella, bystanders, melted hand, phone visible in his hand, sunny sky

## Notes
- v1.1.0: added "his arm and bracelet stay in the bottom-left" — v1.0 let the arm drift and fuse with the bracelet.
- Spin is the riskiest beat for face drift; score the frame at 5–6 s.
- Native audio is fine to keep (no music → no Content ID risk on Shorts).
