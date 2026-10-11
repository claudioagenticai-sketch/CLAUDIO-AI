---
id: claudio.studio.blue-portrait
version: 1.0.0
status: approved
character: claudio
identity: CLAUDIO ID v1
pillar: none
series: none
scene: studio-cobalt
look: studio
kind: image
model: fal/flux-2-pro
fallback_models: [google/nano-banana-2.1, openai/gpt-image-2.5-flare]
params: {aspect: "2:3", resolution: "2K"}
refs: [01-front-neutral]
seed: 41120
cost_usd: 0.075
scores: {drift: 7, runs: 4, pass_rate: 1.0}
outputs:
  - {path: library/2026-10/example-blue-portrait.jpg, sha256: aa90c7d1}
tags: [portrait, studio, headshot, press, avatar, cobalt]
created: 2026-10-08
updated: 2026-10-08
retires: none
---
## Prompt
[CLAUDIO ID v1] Claudio, a 35-year-old man (adult, mid-thirties) with a clean shaved head and light stubble; a full, thick,
groomed dark-brown beard of medium length with a slightly lighter moustache; light blue-grey eyes; strong straight dark-brown
brows; an angular face with defined cheekbones and light freckles; a calm closed-lip half-smile; natural skin texture with
visible pores; a broad, strong, gym-fit build; a chunky silver chain-link bracelet on one wrist.
Structured prompt (FLUX.2 reads JSON well; image 1 is his face reference):
```json
{
  "scene": "studio headshot against a seamless cobalt blue backdrop, color #2f6bff",
  "subjects": [{
    "description": "Claudio, 35-year-old adult man, clean shaved head with a full, thick dark-brown beard, a full, thick, dark-brown beard, chunky silver chain bracelet, broad build, light freckles, light blue-grey eyes, straight dark brows",
    "wardrobe": "soft lime-olive unstructured blazer, color #8db04a, over an olive ribbed top",
    "pose": "head and shoulders, square to camera, chin level, a knowing closed-lip half-smile",
    "position": "centred, eyes on the upper third line"
  }],
  "lighting": "large softbox key slightly above and left of camera, white bounce fill right, subtle hair light",
  "camera": "Canon EOS R5, 85mm f/1.8 at f/2.8, eye level, 1/200s",
  "style": "clean editorial headshot, true-to-life skin texture with visible pores, minimal makeup, soft rose lip",
  "mood": "calm, confident, approachable"
}
```

## Negative
(FLUX.2 has no negative prompt — describe what you want; keep "adult" and "35-year-old" in the description.)

## Notes
- Seed 41120 is only for A/B tests of one variable (lens, light) on FLUX; it doesn't carry identity.
- Crops: 512×512 avatar from the face, 400×400 X profile, 320×320 Instagram, 800×800 YouTube.
