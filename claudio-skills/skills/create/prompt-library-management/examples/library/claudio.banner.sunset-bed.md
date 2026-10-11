---
id: claudio.banner.sunset-bed
version: 1.0.0
status: approved
character: claudio
identity: CLAUDIO ID v1
pillar: P1
series: none
scene: sunset-bedroom-nyc
look: cosy-black
kind: image
model: google/nano-banana-pro
fallback_models: [openai/gpt-image-2.5-flare, google/nano-banana-2.1]
params: {aspect: "16:9", resolution: "4K", crop: "3:1 centre band"}
refs: [01-front-neutral, 08-seated-cosy, 11-golden-hour]
seed: none
cost_usd: 0.24
scores: {drift: 7, runs: 3, pass_rate: 1.0}
outputs:
  - {path: library/2026-10/example-sunset-banner.png, sha256: 51d0e7aa}
tags: [banner, 3x1, sunset, bedroom, skyline, golden-hour, header]
created: 2026-10-08
updated: 2026-10-08
retires: none
---
## Prompt
[CLAUDIO ID v1] Claudio, a 35-year-old man (adult, mid-thirties) with a clean shaved head and light stubble; a full, thick,
groomed dark-brown beard of medium length with a slightly lighter moustache; light blue-grey eyes; strong straight dark-brown
brows; an angular face with defined cheekbones and light freckles; a calm closed-lip half-smile; natural skin texture with
visible pores; a broad, strong, gym-fit build; a chunky silver chain-link bracelet on one wrist. wearing an chunky dark-brown knit jumper with the sleeves pushed up. Wide 16:9 photograph composed for a 3:1 crop (keep everything important in the middle horizontal band).
He lies on his stomach on an unmade white duvet, chin resting on his folded arms, face slightly right of centre, looking
straight into the lens with a knowing half-smile. Behind him on the right, a floor-to-ceiling window with the Manhattan
skyline at sunset, a slender art-deco spire, the low orange sun near the horizon and a soft lens flare; on the left, a white
wall covered in pinned instant photos and a trailing pothos plant, plus the corner of an open laptop on the bed. A film camera
and two glasses catch the light on the windowsill. Golden backlight rims his head and the light rims his beard; warm bounce
fill on his face. 35mm lens, f/2, low angle at bed height, shallow depth of field, Kodak Portra 400 look, fine grain.
Leave the left third calm and slightly darker for a wordmark. No text.

## Negative
teenager, boyish face, hair on top, receding hairline, ponytail, man bun, blonde, grey beard, patchy beard, goatee, moustache only, clean-shaven, brown eyes, plastic skin, airbrushed, extra fingers, warped hands, text, watermark, logo

## Notes
- Crop: `ffmpeg -i in.png -vf "crop=iw:iw/3:0:(ih-iw/3)/2,scale=1500:500" -q:v 3 x-header.jpg` (X header 1500×500).
- Add the "CLAUDIO" wordmark in a design tool with a licensed font; don't ask the model to letter it.
- YouTube banner 2560×1440 needs his face inside the 1546×423 safe area — regenerate at 16:9 rather than cropping this.
