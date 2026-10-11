# Worked example: one shot, five models

Brief: "A 4:5 feed photo of Claudio on the rooftop at dusk, wind in his beard, for a Friday-night caption." Refs:
`refs/claudio/01-front-neutral.jpg` (face), `refs/claudio/11-golden-hour.jpg` (light).

Prices are the package's list/estimate figures (checked 2026-10). Each run used `--max-usd` and a dry run first.

## 1. Nano Banana 2.1 (photoreal default)

```sh
claudio generate image "[CLAUDIO ID v1] Claudio, a 35-year-old man (adult, mid-thirties) with a clean shaved head and light stubble; a full, thick,
groomed dark-brown beard of medium length with a slightly lighter moustache; light blue-grey eyes; strong straight dark-brown
brows; an angular face with defined cheekbones and light freckles; a calm closed-lip half-smile; natural skin texture with
visible pores; a broad, strong, gym-fit build; a chunky silver chain-link bracelet on one wrist. Image 1 is his face reference; image 2 \
shows the light I want. He wears a black t-shirt with the chunky silver chain bracelet, and leans on a \
rooftop railing with one forearm, turning his head back toward the lens, a light breeze in his beard. \
Behind him the Manhattan skyline at blue hour, windows starting to glow, the last copper band of sunset on the horizon. \
Medium close-up at eye level on a 50mm lens at f/2, focus on his eyes, skyline softly out of focus. Warm rim light on \
his hair from the sunset, cool ambient fill from the sky, the look of CineStill 800T with gentle halation. Vertical \
4:5 frame, his face in the upper third." \
  --model google/nano-banana-2.1 --ref refs/claudio/01-front-neutral.jpg,refs/claudio/11-golden-hour.jpg \
  --aspect 4:5 --resolution 2K --max-usd 0.10
```

Result: 7/7 on the drift check. Cost $0.0504. Kept.

## 2. GPT Image 2.5 Flare (when a sign must read correctly)

Variant brief: a neon sign behind his reading "OPEN LATE".

```text
Create a photoreal image.
Subject: [CLAUDIO ID v1] (as above), matching the man in image 1.
Wardrobe: black t-shirt, the chunky silver chain bracelet.
Action and expression: leaning on a rooftop railing, looking back over his shoulder, knowing half-smile.
Setting: New York rooftop at blue hour, skyline behind, a small rose-pink neon sign on the brick wall behind him.
Text in image: exactly "OPEN LATE" on the neon sign, thin tube lettering, spelled O-P-E-N L-A-T-E. No other text.
Camera: medium close-up, eye level, 50mm, f/2.
Light: warm sunset rim on his hair, cool sky fill, rose neon glow #ff6fa5 on his shoulder, CineStill 800T look.
Constraints: no logos, no extra people, adult man in his mid-thirties, natural skin texture.
```

`--model openai/gpt-image-2.5-flare --resolution 1088x1360 --ref refs/claudio/01-front-neutral.jpg --max-usd 0.10`
(1088×1360 = 4:5, both edges multiples of 16.) Sign read correctly on the first run. 6/7 (clip hidden). Kept.

## 3. FLUX.2 Pro (exact palette for a campaign)

```json
{
  "scene": "rooftop at blue hour in New York",
  "subjects": [{
    "description": "Claudio from image 1: 35-year-old adult man, clean shaved head, a full, thick dark-brown beard, a full, thick, dark-brown beard, chunky silver chain bracelet, broad build, light freckles, light blue-grey eyes",
    "wardrobe": "black t-shirt, the chunky silver chain bracelet",
    "position": "right third, leaning on a railing",
    "action": "looking back over his shoulder at the lens, breeze in his beard",
    "expression": "knowing half-smile"
  }],
  "background": "Manhattan skyline, windows glowing, copper band of sunset on the horizon",
  "lighting": "copper rim light #ff9a6b on his hair, cool sky fill, rose accent glow #ff6fa5 from below frame",
  "color_palette": ["#0a0b0d shadows", "#2b3a67 sky", "#ff9a6b rim", "#ff6fa5 accent"],
  "camera": "Sony A7 IV, 50mm f/2, eye level, focus on his eyes",
  "style": "photoreal, CineStill 800T, gentle halation and grain, natural skin texture"
}
```

`--model fal/flux-2-pro --aspect 4:5 --ref refs/claudio/01-front-neutral.jpg --max-usd 0.06` — about $0.045 at ~2 MP.
Palette exact; beard slightly side-swept → fixed with a Kontext edit ("make the beard full, thick and groomed, just
above the brows; change nothing else", $0.04).

## 4. Seedream 4.5 (four frames of the same night)

```text
A consistent photo series of the same man: [CLAUDIO ID v1] (as above). Same outfit in every frame: black t-shirt,
the chunky silver chain bracelet. Same location and light: New York rooftop at blue hour, skyline behind, warm
sunset rim light, CineStill 800T look, 50mm.
Frame 1: leaning on the railing, looking back at the lens.
Frame 2: laughing, head tipped down, hand in his hair.
Frame 3: seated on a low ledge, legs crossed, holding a can of sparkling water.
Frame 4: close-up, eyes to lens, wind in his beard.
```

`--model byteplus/seedream-4.5 --aspect 4:5 --ref refs/claudio/01-front-neutral.jpg --max-usd 0.20` with
`sequential_image_generation` passed through `meta.providerOptions` in code. $0.16 for four. 3 of 4 scored ≥ 6/7.

## 5. Midjourney V7 (mood exploration, manual)

```text
medium close-up photo of a 35-year-old man leaning on a rooftop railing looking back at camera, clean shaved head, a full, thick dark-brown beard, strong dark brows, chunky silver chain bracelet, broad build,
freckles, black t-shirt, the chunky silver chain bracelet, Manhattan skyline at blue hour, copper sunset rim light, 50mm,
CineStill 800T --ar 4:5 --style raw --stylize 100 --oref https://<your-host>/refs/claudio/01-front-neutral.jpg --ow 200
--no text, logo, teen --v 7
```

Good mood, weaker identity (5/7: eye colour drifted to hazel). Used only as a light reference for later Nano Banana runs.

## What this shows

- Nano Banana with two labelled refs was the best identity-per-dollar.
- GPT Image 2.5 is the pick whenever text must read.
- FLUX.2 JSON nails a palette but needed one edit.
- Seedream batches are efficient when you want a set.
- Midjourney is for exploring looks, not for his face.
