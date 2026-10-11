---
id: claudio.p2.dj-booth
version: 1.0.0
status: approved
character: claudio
identity: CLAUDIO ID v1
pillar: P2
series: after-midnight
scene: club-dj-booth
look: signature
kind: video
model: fal/kling-2.6-pro
fallback_models: [fal/kling-3-pro, fal/seedance-2.0]
first_frame_model: google/nano-banana-2.1
params: {aspect: "9:16", durationSec: 10, audio: false}
refs: [01-front-neutral, 06-sunglasses, 10-club-light]
seed: none
cost_usd: 0.75
scores: {drift: 7, runs: 5, pass_rate: 0.6}
outputs:
  - {path: library/2026-10/example-club-1.mp4, sha256: 77c0d4e2}
tags: [club, dancing, dj, night, crowd, motion, sunglasses, loop]
created: 2026-10-08
updated: 2026-10-08
retires: none
---
## First frame
[CLAUDIO ID v1] Claudio, a 28-year-old man (adult, late twenties) with a glossy jet-black jaw-length blunt bob and heavy straight bangs just above the brows; vivid copper-orange streak panels through the front bangs and one side; a small orange hair clip at the side of the bangs; small thin gold hoop earrings; light freckles across the nose and cheeks; warm brown eyes; straight dark brows; a knowing closed-lip half-smile; natural skin texture with visible pores; fine-line tattoos on his arms (small stars, a rose, a sun). wearing an olive-green fine-knit crop cami with a scalloped copper-orange edged neckline and small orange embroidered stars, a star pendant on layered silver chains, a red-and-green tartan pleated mini skirt with a studded black belt and hanging silver chains, a chunky silver chain bracelet, plus small black oval sunglasses. Full-length vertical 9:16 shot at a club DJ booth at 1am: he stands in front
of the booth, body turned three-quarters to camera, one hand at his hip, smiling with his chin slightly raised. Behind him a
generic male DJ in a dark t-shirt leans over the mixer, soft focus; CDJs and a mixer with glowing buttons but no readable
brand names; a crowd behind with raised hands and phone lights, anonymous and out of focus. Blue-violet haze, moving-head
beams from above, a rose-pink rim light on his hair and shoulders. 35mm lens, f/2, eye level, slight motion blur in the
crowd, high-ISO grain. Image 1 is his face reference, image 2 shows him in sunglasses.

## Prompt
He dances on the beat in front of the DJ booth: [0-3s] sways his hips and shoulders, smiling; [3-6s] raises his right arm
straight up with a loose wrist as a light beam sweeps across him; [6-10s] brings the arm down, laughs, turns his head toward
the DJ and back to camera. The DJ keeps mixing in soft focus; the crowd behind bounces with hands up. Locked-off camera with a
very slight sway, no cuts, no zoom. His face, sunglasses, bob, copper bangs and outfit stay exactly as in the first frame.

## Negative
teenager, childlike face, school uniform, long hair, ponytail, blonde, red hair all over, thin highlights, side-swept bangs, extra streaks, plastic skin, airbrushed, heavy makeup, extra fingers, warped hands, text, watermark, logo, readable brand logos, celebrity DJ, distorted hands, merged crowd faces

## Notes
- Audio off (`meta.audio: false`, $0.07/s): the track is added in edit from a licensed library (music-and-sound-for-shorts).
- For real choreography use Kling Motion Control with your own licensed dance reference video (checked 2026-10).
- The DJ and crowd must stay generic and anonymous — never a real DJ or a recognisable person.
