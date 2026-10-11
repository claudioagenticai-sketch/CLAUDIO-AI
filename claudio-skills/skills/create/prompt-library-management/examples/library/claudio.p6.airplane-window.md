---
id: claudio.p6.airplane-window
version: 1.0.0
status: approved
character: claudio
identity: CLAUDIO ID v1
pillar: P6
series: window-seat
scene: travel-airplane
look: travel
kind: image
model: fal/flux-2-pro
fallback_models: [google/nano-banana-2.1]
params: {aspect: "4:5", resolution: "2K"}
refs: [01-front-neutral, 02-34-left]
seed: 7781
cost_usd: 0.075
scores: {drift: 7, runs: 3, pass_rate: 0.67}
outputs:
  - {path: library/2026-10/example-airplane.jpg, sha256: b4c5d6e7}
tags: [travel, airplane, window, sunset, clouds, quiet, carousel]
created: 2026-10-08
updated: 2026-10-08
retires: none
---
## Prompt
[CLAUDIO ID v1] Claudio, a 35-year-old man (adult, mid-thirties) with a clean shaved head and light stubble; a full, thick,
groomed dark-brown beard of medium length with a slightly lighter moustache; light blue-grey eyes; strong straight dark-brown
brows; an angular face with defined cheekbones and light freckles; a calm closed-lip half-smile; natural skin texture with
visible pores; a broad, strong, gym-fit build; a chunky silver chain-link bracelet on one wrist. wearing a white linen shirt open over a black top, large cream over-ear headphones on. Vertical 4:5 photograph in an airplane window seat at sunset: he leans
his temple against the cabin wall, three-quarter profile toward the oval window, eyes soft, a quiet half-smile. Through the
window a sea of pink and orange clouds and a thin gold horizon; warm window light falls across his freckles and the dark brows in his beard; the cabin is dim and cool blue-grey. Image 1 is his face reference. Fujifilm X-T5, 35mm f/1.4 at f/2,
shallow depth of field, Kodachrome-warm colour, fine grain. No logos on the seat or headrest, no text.

## Negative
(FLUX.2: no negative prompt. Positive wording above already says "no logos", "no text".)

## Notes
- FLUX.2 weights early words more: keep the identity block first, setting second, camera last (checked 2026-10).
- Profile-leaning shots drift most at the nose and bang depth; include pack shot 02 (¾ left) as a ref.
