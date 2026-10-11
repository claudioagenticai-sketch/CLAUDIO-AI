---
id: claudio.p1.room-vlog
version: 2.0.0
status: approved
character: claudio
identity: CLAUDIO ID v1
pillar: P1
series: talk-to-me
scene: him-room-day
look: signature
kind: video
model: google/omni-flash
fallback_models: [fal/kling-2.6-pro, fal/seedance-2.0]
first_frame_model: google/nano-banana-2.1
params: {aspect: "9:16", durationSec: 10, resolution: "720p"}
refs: [01-front-neutral, 05-laugh]
seed: none
cost_usd: 1.05
scores: {drift: 7, runs: 4, pass_rate: 0.75}
outputs:
  - {path: library/2026-10/example-room-1.mp4, sha256: 3b9e51a0}
tags: [ugc, talking-to-camera, bedroom, selfie, front-camera, laugh]
created: 2026-10-08
updated: 2026-10-08
retires: none
---
## First frame
[CLAUDIO ID v1] Claudio, a 35-year-old man (adult, mid-thirties) with a clean shaved head and light stubble; a full, thick,
groomed dark-brown beard of medium length with a slightly lighter moustache; light blue-grey eyes; strong straight dark-brown
brows; an angular face with defined cheekbones and light freckles; a calm closed-lip half-smile; natural skin texture with
visible pores; a broad, strong, gym-fit build; a chunky silver chain-link bracelet on one wrist. In this shot he is mid-laugh with his tongue just touching his teeth, eyes bright. wearing an olive-green crew-neck cotton t-shirt, red-and-green tartan trousers, a chunky silver chain-link bracelet.
Vertical 9:16 front-camera phone frame in his bedroom by day: plain white walls, a round ceiling smoke detector, a recessed
ceiling light, an open white doorway behind him on the left, a grey blanket on a chair at the edge of frame. Soft overcast
window light from camera left, gentle fill from the white walls. He leans slightly toward the lens, framed from mid-torso
up, head in the upper third, eye level, 24mm phone-lens look with mild wide-angle, natural mixed light, a touch of phone
sharpening and grain. Image 1 is his face reference, image 2 shows his laugh. No text, no logos.

## Prompt
Handheld front-facing phone selfie vlog, 9:16. The man from the first frame talks to the camera in his bedroom, relaxed and
amused. [0-3s] he leans in and starts a story, small head tilt, eyebrows up; [3-6s] he glances toward the open doorway and
back to the lens, a little shrug; [6-10s] he laughs openly, shoulders shaking, then settles into a knowing half-smile. Slight
handheld micro-shake, auto-exposure breathing, no cuts. Keep all character details exactly as in the first frame: jaw-length
black shaved head, a full, thick dark-brown beard, strong dark brows, silver chain bracelet, broad build. Natural
room tone only, no music.

## Negative
teenager, boyish face, hair on top, receding hairline, ponytail, man bun, blonde, grey beard, patchy beard, goatee, moustache only, clean-shaven, brown eyes, plastic skin, airbrushed, extra fingers, warped hands, text, watermark, logo

## Notes
- 2.0.0 (2026-10-08): migrated from the Veo 3.1 Fast variant (retiring 2026-10-22) to Omni Flash — see ../migrating-off-veo.md.
- Omni chooses the length (3–10 s per generation, checked 2026-10); say "10 seconds" in the prompt if it runs short.
- Ends on the half-smile so two takes can be cut together for a 20 s "talk to me" episode.
- Voice: record the line separately (elevenlabs/v3) and lip-sync with fal/lipsync-2; Omni's native speech is not his voice.
