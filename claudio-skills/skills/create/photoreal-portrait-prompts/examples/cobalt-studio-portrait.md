# Worked example: the cobalt studio portrait, from brief to avatar

Goal: a new press/about-page portrait in the style of the owner's `portrait-blue` (cobalt seamless, green blazer), plus
avatar exports. Budget cap $0.50. Model: Nano Banana 2.1 ($0.0504 per 2K image, checked 2026-10).

## Round 0 — dry run

```sh
claudio generate image "$(cat portraits/01-cobalt.txt)" --model google/nano-banana-2.1 \
  --ref refs/claudio/01-front-neutral.jpg --aspect 2:3 --resolution 2K --dry-run
```

The dry run showed the request body: the ID block first, one inline image, `aspectRatio: "2:3"`, `imageSize: "2K"`,
the key shown as `***`. Estimate $0.0504 · list price.

## Round 1 — three variations at 1K (cheap exploration)

```sh
claudio generate image "$(cat portraits/01-cobalt.txt)" --model google/nano-banana-2.1 \
  --ref refs/claudio/01-front-neutral.jpg --aspect 2:3 --resolution 1K --n 3 --max-usd 0.12
```

| Variation | Score | Notes |
|---|---|---|
| A | 5/7 | lovely light, but beard patchy and he reads ~21 |
| B | 6/7 | right age, bracelet missing |
| C | 4/7 | grey in the beard, blazer lime |

Cost $0.10. Diagnosis for A: the 1K variant leaned young. Change for round 2: add "short lighting: the side of his face
turned away from the lens is lit" (slims and adds definition) and "chin slightly down, adult facial proportions".

## Round 2 — B as an extra ref, at 2K

```sh
claudio generate image "$(cat portraits/01-cobalt-v2.txt)" --model google/nano-banana-2.1 \
  --ref refs/claudio/01-front-neutral.jpg,out/round1/B.png --aspect 2:3 --resolution 2K --max-usd 0.06
```

Result: 6/7 — everything right except the clip. Cost $0.05.

## Round 3 — fix, don't reroll

```sh
claudio generate image "Edit image 1. Preserve exactly: his face, freckles, eye colour, expression, hair shape, a full, thick dark-brown beard, the beard, earrings, green blazer, pose, cobalt backdrop and lighting. Change \
only: add one chunky silver chain bracelet, at the edge of the beard. Do not change anything else." \
  --model openai/gpt-image-2.5-sunburst --ref out/round2/portrait.png --resolution 1024x1536 --max-usd 0.05
```

Result: 7/7. Cost ≈ $0.013 (estimate). Total session: ≈ $0.16.

## Exports

```sh
# press: keep the full 2:3, JPG q3
ffmpeg -i out/round3/portrait.png -q:v 3 press/claudio-portrait-2x3.jpg
# avatar: square face crop (x/y chosen by eye so the face is centred), then sizes
ffmpeg -i out/round3/portrait.png -vf "crop=760:760:132:170,scale=800:800" -q:v 3 avatar/avatar-800.jpg
ffmpeg -i avatar/avatar-800.jpg -vf scale=400:400 -q:v 3 avatar/avatar-400.jpg
ffmpeg -i avatar/avatar-800.jpg -vf scale=320:320 -q:v 3 avatar/avatar-320.jpg
```

Circle check: the whole beard and both eyes stay inside the round mask at 320 px.

## Publish notes

- Sidecar `portrait.png.json` kept (provenance: model, prompt, SynthID for the Google step, C2PA for the OpenAI edit).
- About page alt text: "AI-generated portrait of Claudio, a man with a shaved head and a beard and dark brows, on a cobalt
  backdrop." Bio line on every profile: "AI-generated character".
- Logged to the prompt library as `portrait-cobalt@v2` with score 7/7 and the clip fix noted.
