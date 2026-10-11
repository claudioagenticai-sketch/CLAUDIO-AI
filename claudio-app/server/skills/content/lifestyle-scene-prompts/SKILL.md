---
name: lifestyle-scene-prompts
description: Prompts and a method for candid lifestyle scenes that make an AI influencer's feed feel like one lived life — Claudio's sunset NYC bedroom, desk at night with the laptop and grey tabby cat, rooftop dusk, club wide shots, rain warehouse lot, Santorini, airplane window, city-night balcony, mirror selfies and photo-dump carousels — with recurring props, candid-realism cues, caption-safe composition for 9:16 and 4:5, Seedream batch sets, per-model variants and fixes for logos, crowds, hands and text. Use when making feed photos, carousels, photo dumps, story frames, collage tiles or scene plates for video first frames.
license: MIT
metadata:
  title: "Lifestyle scene prompts"
  category: create
  summary: "Candid scenes from his life — bedroom, desk and cat, rooftop, club, rain, travel — that read as real moments, not renders."
  level: intermediate
  tags: "lifestyle, scenes, photo dump, carousel, travel, candid, props, seedream, nano banana, ai influencer"
  uses: "@useclaudio/media, @useclaudio/cli"
  time: "25 min"
  version: "1.0.0"
  updated: "2026-10-08"
---

# Lifestyle scene prompts

Portraits prove who he is; lifestyle scenes prove he has a life. This skill gives you a scene library of Claudio's
recurring worlds with copy-ready prompts, the candid cues that stop scenes looking staged, the props that must stay
identical (the cat, the laptop sticker, the bracelet), and a batch method for photo-dump carousels.

## When to use this

- Feed photos and carousels (4:5), story frames (9:16), photo dumps.
- Tiles for a collage banner ([../banner-and-collage-design/SKILL.md](../banner-and-collage-design/SKILL.md)).
- First frames or scene plates for video ([../selfie-and-ugc-video-prompts/SKILL.md](../selfie-and-ugc-video-prompts/SKILL.md)).
- A content pillar needs a fresh set ([../content-pillars-and-series/SKILL.md](../content-pillars-and-series/SKILL.md)).

## What you need

- ID block, wardrobe and settings from [../claudio-character-bible/SKILL.md](../claudio-character-bible/SKILL.md);
  ref pack from [../character-consistency/SKILL.md](../character-consistency/SKILL.md).
- A prop pack (step 3): `refs/props/cat.jpg`, `refs/props/laptop.jpg`, `refs/props/bracelet.jpg`.
- Image keys you bring (`google`, `byteplus`, `openai`, `fal`).
- [references/scene-library.md](references/scene-library.md) — the full prompts for 16 scenes. Read it when you need a
  scene; the steps below show the method with four of them.

## Steps

### 1. Decide what the scene is for

| Destination | Aspect | Composition rule |
|---|---|---|
| IG/Threads feed, carousel | 4:5 | subject in the middle 1080×1350; carousels keep the same light across slides |
| Story / Reel cover / video first frame | 9:16 | face in the upper third; keep the bottom ~350 px and right ~120 px clear of key detail for app UI (checked 2026-10) |
| X / LinkedIn image | 16:9 | subject on a third, negative space on the other side |
| Collage tile | 1:1 or 4:5 | one clear idea per tile; readable at 300 px wide |

### 2. Write the scene as a moment, not a set

A lifestyle prompt has a *moment* (what just happened), a *place* with specific props, and *imperfection*. Template:

```text
[CLAUDIO ID v1 — verbatim]. Image 1 is his face reference[; image 2 is <prop>].
Moment: [what he is doing mid-action, where his attention is].
He wears [ONE WARDROBE STRING].
Place: [setting string + 2–3 lived-in details].
Camera: [who "took" it — friend with a phone / tripod / self-timer / mirror], [lens], [angle].
Light: [one light story]. Finish: [film stock or phone look], candid, unposed, natural skin texture.
[ASPECT] frame. Background people anonymous and out of focus; no readable logos or text.
```

Candid cues that work: "caught mid-laugh", "looking off-frame at someone", "slightly off-centre framing", "a little
motion blur in his hand", "lived-in clutter", "taken by a friend on a phone", "flash snapshot". Cues that make it staged:
"posing", "perfect", "magazine", "symmetrical", "studio".

### 3. Keep the props identical

Generate each recurring prop once, approve it, and pass it as a ref whenever it's in frame:

| Prop | Canonical description | Ref |
|---|---|---|
| The cat | grey tabby with a white muzzle and a white chest, green eyes, medium build | `refs/props/cat.jpg` |
| The laptop | silver-grey unbranded laptop, one rose-pink sticker in the centre of the lid | `refs/props/laptop.jpg` |
| The mug | matte black mug  | `refs/props/mug.jpg` |
| The bracelet | chunky silver curb-chain bracelet, worn on one wrist | `refs/props/bracelet.jpg` |
| The film camera | black-and-silver 35mm rangefinder-style camera, no visible brand | `refs/props/camera.jpg` |

```sh
claudio generate image "Product-style photo of a silver-grey unbranded laptop, lid closed, one rose-pink sticker in \
the centre of the lid, on a dark wood desk, soft window light, no logos, no text" \
  --model google/nano-banana-2.1 --aspect 1:1 --resolution 1K --max-usd 0.05
```

### 4. Four core scenes (full set of 16 in the reference file)

**Desk at night with the cat (pillar: platform / behind the scenes)** — 4:5

```text
[CLAUDIO ID v1] … Image 1 is his face; image 2 is the laptop; image 3 is the cat. Moment: late at night he leans back
in his chair laughing because the grey tabby has just stretched across the keyboard. He wears an oversized fuzzy black
knit jumper. Place: a desk with the silver laptop with one rose-pink sticker, a black mug,
two monitors behind with blurred candlestick charts (no readable numbers), a tangle of cables, sticky notes. Camera:
taken by a friend on a phone from across the room, 26mm, eye level. Light: cool screen glow on his face, a rose-pink desk
lamp rim behind him. Candid, slight noise, natural skin texture. 4:5. No readable text or logos.
```

**Santorini with headphones (pillar: travel)** — 4:5

```text
[CLAUDIO ID v1] … Image 1 is his face. Moment: he sits on a whitewashed wall at golden hour, cream over-ear headphones
on, eyes half-closed, smiling at a song. Travel look: white linen shirt open over a black top, sunglasses pushed up into
his hair. Place: blue-domed whitewash village and the caldera sea behind, bougainvillea at the frame edge. Camera:
friend's phone, 35mm equivalent, slightly below eye level. Light: low warm sun from the side, Kodak Portra 400. 4:5.
```

**Airplane window (pillar: travel)** — 4:5

```text
[CLAUDIO ID v1] … Image 1 is his face. Moment: he rests his temple against an airplane window, looking out at a sea of
sunset clouds, a faint reflection of his face in the glass. He wears the oversized black knit jumper. Place: the curved
window frame and grey plastic surround fill the left half; a corner of a seat-back tray. Camera: from the aisle seat,
35mm, shallow focus on the clouds-to-face edge. Light: warm sunset through the window, cabin in soft shadow. 4:5.
```

**Mirror selfie, getting ready (pillar: style)** — 9:16

```text
[CLAUDIO ID v1] … Image 1 is his face; image 2 his full-body proportions. Moment: mirror selfie before going out, phone
held at chest height covering the lower edge of his chin, a playful pout breaking into a smile. Signature look: olive t-shirt, the chunky silver chain bracelet, tartan trousers with a studded belt and hanging chains.
Place: a tall mirror leaning on a white bedroom wall, a few instant photos tucked into the frame, clothes on a chair.
Camera: the phone's main camera seen in the mirror, plain black phone case (no logo). Light: warm bedroom lamp plus
on-camera flash flare in the mirror. 9:16, his face in the upper third.
```

### 5. Batch a photo dump with Seedream (one light, one outfit, 4–6 frames)

A photo dump works when every slide shares light and outfit. Seedream's sequential batch is built for this (refs +
outputs ≤ 15 per batch; checked 2026-10). Prompt:

```text
A candid photo dump of one evening with the same man: [CLAUDIO ID v1]. Same outfit in every frame: black t-shirt,
the chunky silver chain bracelet. Same night in New York, warm practical light, CineStill 800T look, phone camera.
Frame 1: close-up of his clinking a glass of sparkling water at a candle-lit bar, winking.
Frame 2: his hand holding a slice of pizza on a street corner, his face blurred in the background laughing.
Frame 3: on a rooftop, back to the camera, looking at the skyline.
Frame 4: in a taxi back seat, city lights streaking through the window, head on the window.
Frame 5: his worn black slides on a white rug at home, no face.
Frame 6: the grey tabby asleep on his black jumper on the bed.
```

```ts
const job = await media.generate({
  kind: "image", model: "byteplus/seedream-4.5", aspect: "4:5", prompt: dumpPrompt,
  refs: ["refs/claudio/01-front-neutral.jpg", "refs/props/cat.jpg"],
  meta: { providerOptions: { sequential_image_generation: "auto", sequential_image_generation_options: { max_images: 6 } } },
});
```

Check `media.estimate(...)` first: 6 × $0.04 = $0.24 at list price. If the provider rejects the option, fall back to six
single Nano Banana calls with the same refs and the same light sentence.

### 6. Per-model notes for scenes

- **Nano Banana 2.1:** best default; label every ref by role ("image 3 is the cat"). Up to 4 character refs + objects
  within 14 total (checked 2026-10).
- **GPT Image 2.5:** use when a sign, menu or screen must read correctly; put the exact text in quotes.
- **FLUX.2 Pro:** use JSON with `subjects` for two-subject scenes (him + the cat) and HEX for brand-coloured light.
- **Midjourney V7:** good for travel mood plates without him (`--no people`), which you then composite or use as
  a style ref.

### 7. Fix the usual scene failures

| Problem | Fix |
|---|---|
| Crowd faces merge with his | "background people anonymous, softly out of focus, facing away"; fewer people |
| Real brand logos on laptop/phone/club gear | "unbranded", "plain black phone case", "no readable logos"; patch in edit |
| Garbled text on screens/signs | "blurred charts, no readable numbers"; or GPT Image 2.5 with quoted text |
| The cat changes breed | pass `refs/props/cat.jpg` and describe it every time |
| Wrong landmark details | keep landmarks generic ("blue-domed whitewash village") and never claim he was really there |
| Too staged | add a moment and an imperfection; remove "posing" |
| Hands holding things warp | simple grips (mug with both hands), avoid chopsticks/cards; fix with edits |

## Templates

- [templates/scene-builder.yaml](templates/scene-builder.yaml) — fill-in scene spec that renders to a prompt.
- [templates/photo-dump-plan.md](templates/photo-dump-plan.md) — 6-slide carousel planner with caption.
- [examples/sunday-photo-dump.md](examples/sunday-photo-dump.md) — a full carousel, prompts to publish-ready.
- [references/scene-library.md](references/scene-library.md) — 16 scenes ready to paste.

## Check before you finish

- [ ] Scene has a moment, a specific place and one imperfection; one light story.
- [ ] ID block verbatim; recurring props passed as refs and described identically.
- [ ] Composition fits the destination (UI-safe zones for 9:16).
- [ ] No readable third-party logos, no real-person likeness in the background, nothing explicit.
- [ ] Travel scenes are not claimed as real trips ("AI-generated" label on the post).
- [ ] Carousel slides share outfit and light; every slide scored ≥ 6/7 where his face is visible.

## Pitfalls

- **Landmark claims.** An AI image "at" a real place is fine as content; captions must not claim a real trip or event.
- **Copying another creator's photo dump.** Recreate *kinds* of moments, never a specific creator's shots.
- **Too many props.** Every prop is a chance for text and logos. Two props per scene.
- **Same angle every slide.** Mix close, detail, wide and no-face frames.
- **Alcohol.** Keep drinks incidental (a glass in hand), never the focus; some platforms age-gate alcohol content.

## Related skills

- [../photoreal-portrait-prompts/SKILL.md](../photoreal-portrait-prompts/SKILL.md) · [../image-prompting-fundamentals/SKILL.md](../image-prompting-fundamentals/SKILL.md)
- [../banner-and-collage-design/SKILL.md](../banner-and-collage-design/SKILL.md) · [../content-pillars-and-series/SKILL.md](../content-pillars-and-series/SKILL.md)
- [../batch-content-production/SKILL.md](../batch-content-production/SKILL.md) · [../captions-and-hooks/SKILL.md](../captions-and-hooks/SKILL.md)
- [../../grow/instagram-reels-playbook/SKILL.md](../../grow/instagram-reels-playbook/SKILL.md)
