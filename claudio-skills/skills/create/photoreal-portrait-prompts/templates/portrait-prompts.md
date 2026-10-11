# Portrait prompt pack (12)

Every prompt starts with the full `[CLAUDIO ID v1]` block (shown as `[ID]` here — paste it verbatim) followed by
"adult facial proportions, defined cheekbones." Refs: always `01-front-neutral.jpg`; add the one listed.

| # | Name | Aspect / res | Model | Extra ref |
|---|---|---|---|---|
| 1 | Cobalt studio headshot | 2:3 2K | nano-banana-2.1 | — |
| 2 | Avatar, butterfly light | 1:1 1K | nano-banana-2.1 | — |
| 3 | Lounge sunglasses lowered | 9:16 2K | nano-banana-2.1 | 06 |
| 4 | Club laugh, rose rim | 4:5 2K | nano-banana-2.1 | 05, 10 |
| 5 | Rain selfie still | 9:16 2K | nano-banana-2.1 | 05, 09 |
| 6 | Day-room talking still | 4:5 2K | nano-banana-2.1 | 05 |
| 7 | Golden-hour bed close-up | 4:5 2K | nano-banana-2.1 | 11 |
| 8 | B&W editorial | 4:5 2K | flux-2-pro | 02 |
| 9 | Flash snapshot at a party | 4:5 1K | nano-banana-2.1 | 05 |
| 10 | Glasses + trading screens | 4:5 2K | nano-banana-2.1 | 02 |
| 11 | Profile silhouette at a window | 2:3 2K | flux-2-pro | 04 |
| 12 | Press portrait, near-black | 2:3 2K | gpt-image-2.5-flare (1024x1536) | — |

## 1. Cobalt studio headshot
```text
[ID] adult facial proportions, defined cheekbones. Image 1 is his face reference. He wears a sage-green unstructured blazer over a navy-black crew-neck t-shirt. Head-and-shoulders studio portrait, square to camera, chin slightly down, eyes into the
lens, knowing closed-lip half-smile. Seamless saturated cobalt-blue paper backdrop. Large soft key just above eye level
and slightly left, white bounce below, faint hair light from behind. 85mm at f/4. Natural skin texture, freckles, soft
rose lip. Clean editorial colour. Vertical 2:3.
```

## 2. Avatar, butterfly light
```text
[ID] adult facial proportions, defined cheekbones. Image 1 is his face. He wears an oversized fuzzy black knit jumper.
Tight head-and-shoulders, face centred with space around the hair so a circle crop keeps the head and the whole beard.
Beauty dish directly above the lens, small butterfly shadow under the nose, white bounce below. Warm grey seamless
backdrop. 85mm f/2.8, eyes tack sharp, a soft catchlight in each eye. Square 1:1.
```

## 3. Lounge sunglasses lowered
```text
[ID] Image 1 is his face; image 2 shows him in his sunglasses. Signature look: olive-green crew-neck cotton t-shirt, chunky silver chain-link bracelet,
red-and-green tartan trousers with a dark belt. He leans back on a dark wood dresser, lifting
dark rectangular sunglasses down his nose with one hand, looking over them into the lens. Butter-yellow wall, framed
botanical cross-stitch prints, brass lamp with a pleated cream shade at frame left. Medium shot, eye level, 50mm f/1.8.
Tungsten lamp key from the left, Kodak Gold 200. Vertical 9:16, face in the upper third.
```

## 4. Club laugh, rose rim
```text
[ID] Image 1 is his face; image 2 his laugh; image 3 the club light. Signature look plus dark rectangular sunglasses.
Mid-laugh, chin up, one hand at his collarbone, in front of a DJ booth. Behind, out of focus: a DJ and a crowd with raised
hands, anonymous and unrecognisable; blue-violet haze and moving-head beams. Slightly low angle, 35mm f/1.8. Rose-pink rim
light #ff6fa5 on his hair and shoulder, CineStill 800T halation. No readable logos on the equipment. 4:5.
```

## 5. Rain selfie still
```text
[ID] Image 1 is his face; image 2 his laugh; image 3 the selfie arm pose. Signature look plus a chunky silver chain
bracelet. Front-camera selfie at arm's length, his arm reaching toward the lens at the bottom of the frame, laughing
open-mouthed, rain on his face and beard. Empty warehouse lot behind: wet asphalt, puddle reflections, grey roll-up
loading-dock doors, yellow bollards, overcast blue-grey sky. iPhone front camera, 24mm equivalent, soft overcast light,
rain streaks. Vertical 9:16, face in the upper third.
```

## 6. Day-room talking still
```text
[ID] Image 1 is his face; image 2 his laugh. Olive t-shirt with orange stars, the chunky silver chain bracelet.
Medium close-up, mid-sentence to the camera, eyebrows raised, playful grin. Plain white walls, ceiling smoke detector,
open doorway behind, soft overcast window light from camera left. Phone on a tripod at eye level, 26mm equivalent,
everything in focus, slight sensor noise. 4:5.
```

## 7. Golden-hour bed close-up
```text
[ID] Image 1 is his face; image 2 the light. Oversized fuzzy black knit jumper, sleeves over his hands. Lying on his front
on a white duvet, chin on folded arms, eyes to the lens, knowing half-smile. Floor-to-ceiling window behind with the
Manhattan skyline and a low orange sun. Mattress height, 35mm f/2, focus on his eyes. Golden backlight, warm rim light on his head
hair, window bounce on his face, Kodak Portra 400. 4:5.
```

## 8. B&W editorial (FLUX.2 JSON)
```json
{"subject":"Claudio from image 1: 35-year-old adult man, clean shaved head, a full, thick dark-brown beard, light freckles, broad build","wardrobe":"black ribbed turtleneck","action":"three-quarter turn, looking past the lens, calm","lighting":"Rembrandt lighting, key high at 45 degrees left, black flag on the right","background":"plain dark grey wall","camera":"Leica M11 Monochrom, 75mm f/2","style":"black-and-white, Kodak Tri-X 400 grain, deep blacks, natural skin texture"}
```
Note: in B&W the beard read as lighter grey bands — keep them visible.

## 9. Flash snapshot at a party
```text
[ID] Image 1 is his face; image 2 his laugh. Night-out look: black t-shirt, the chunky silver chain bracelet. Laughing at
someone just out of frame, holding a glass of sparkling water. Direct on-camera flash, hard shadow on a white wall behind
him, slightly blown highlights, a string of fairy lights blurred at the edge. Contax T2 snapshot feel, 38mm. 4:5.
```

## 10. Glasses + trading screens
```text
[ID] Image 1 is his face; image 2 his three-quarter angle. He wears thin black rectangular reading glasses and the black
knit jumper, chin resting on one hand, a thoughtful half-smile. Behind his two monitors with blurred green and red
candlestick charts (no readable numbers or tickers). Screen glow from the side, warm desk lamp behind. 50mm f/2, focus on
his eyes through the lenses. 4:5.
```

## 11. Profile silhouette at a window
```text
[ID] Image 1 is his profile. He stands in clean profile at a tall window at blue hour, city lights below, his shaved head's
line and his beard catching the last light. Exposure for the sky so his face is a soft near-silhouette
with a thin warm edge. 85mm f/2.8. 2:3.
```

## 12. Press portrait, near-black (GPT Image 2.5, no refs needed if 01 is attached)
```text
Create a photoreal press portrait. Subject: [ID], matching the man in image 1. Wardrobe: soft green unstructured blazer
over a black top. Pose: seated on a low stool, forearms on knees, looking into the lens, knowing half-smile. Background:
near-black backdrop with a faint gradient. Light: large soft key from camera left, thin rose rim #ff6fa5 from behind
right. Camera: 85mm, f/2.8. Constraints: no text, no logos, adult man in his mid-thirties, natural skin texture.
```

CLI line (swap model/aspect per table):

```sh
claudio generate image "$(cat portraits/03-lounge.txt)" --model google/nano-banana-2.1 --aspect 9:16 --resolution 2K \
  --ref refs/claudio/01-front-neutral.jpg,refs/claudio/06-sunglasses.jpg --brand claudio --max-usd 0.10
```

Avatar crop: `ffmpeg -i in.png -vf "crop=<side>:<side>:<x>:<y>,scale=800:800" -q:v 3 avatar-800.jpg` — set x/y so him
face sits in the middle; preview with `ffplay` or open the file before exporting the smaller sizes.
