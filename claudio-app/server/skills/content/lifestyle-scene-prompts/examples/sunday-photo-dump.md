# Worked example: "slow sunday" photo dump (6 slides, Instagram)

Theme: a slow Sunday at home. Outfit: grey hoodie + worn black slides. Light: soft cool daylight through rain-streaked
windows, warming to golden hour on the last slide. Budget cap $0.40. Approver: the account owner.

## Plan

| Slide | Frame | Moment | Refs |
|---|---|---|---|
| 1 | close-up | on the windowsill, black mug in both hands, looking at the lens over the rim | 01, props/mug |
| 2 | detail | his strong hands turning a vinyl record (unbranded label) | — |
| 3 | wide | the whole room: unmade bed, photo wall, rain on the window, his small in the chair | 01 |
| 4 | candid | laughing on the bed as the cat bats at his hoodie strings | 01, 05, props/cat |
| 5 | no-face | worn black slides on a white rug next to a stack of film photos | — |
| 6 | closer | the grey tabby asleep on the black jumper, golden light arriving | props/cat |

## Batch prompt (Seedream 4.5)

```text
A candid photo dump of one slow Sunday at home with the same man: [CLAUDIO ID v1] Claudio, a 35-year-old man (adult, mid-thirties) with a clean shaved head and a full, thick dark-brown beard; a full, thick, dark-brown beard; a chunky silver chain bracelet;
broad build; light freckles across the nose and cheeks; light blue-grey eyes; straight dark brows; a knowing
closed-lip half-smile; natural skin texture with visible pores; strong forearms.
Same outfit in every frame: grey hoodie and worn black slides. Same New York apartment, soft cool daylight through
rain-streaked windows, Fujifilm Pro 400H look, phone camera, candid and unposed. The cat is always the same grey tabby with a white muzzle and a white chest. No readable logos or text.
Frame 1: close-up on the windowsill, holding a matte black mug  in both hands, looking at the lens over the rim.
Frame 2: detail of his hands lowering a needle onto a vinyl record with a plain cream label.
Frame 3: wide shot of the room — unmade white bed, wall of pinned instant photos, rain on the window — he is small in an armchair reading.
Frame 4: laughing on the bed while the grey tabby bats at his hoodie strings.
Frame 5: worn black slides on a white rug beside a loose stack of printed photos, no face.
Frame 6: the grey tabby asleep on an oversized black knit jumper on the bed, the first golden light across the duvet.
```

```ts
const req = {
  kind: "image", model: "byteplus/seedream-4.5", aspect: "4:5", prompt: sundayPrompt, brand: "claudio",
  refs: ["refs/claudio/01-front-neutral.jpg", "refs/claudio/05-laugh.jpg", "refs/props/cat.jpg", "refs/props/mug.jpg"],
  meta: { providerOptions: { sequential_image_generation: "auto", sequential_image_generation_options: { max_images: 6 } } },
} as const;
console.log(media.estimate(req));   // list price $0.04 per image → ~$0.24 for six
```

## Review

| Slide | Score | Action |
|---|---|---|
| 1 | 7/7 | keep |
| 2 | n/a | record label had fake text → Kontext edit "make the record label plain cream, no text" ($0.04) |
| 3 | 6/7 (clip hidden) | keep |
| 4 | 5/7 — cat turned ginger | regenerated with Nano Banana 2.1, refs 01, 05, props/cat ($0.05) |
| 5 | n/a | keep |
| 6 | n/a | keep |

Total ≈ $0.33, under the cap.

## Post

- Order: 1 → 4 → 2 → 3 → 5 → 6 (strongest face first, alternate face/no-face).
- Caption: `slow sunday. the cat scheduled nothing and neither did I` + `what's your sunday ritual?`
- Instagram AI label toggled on; alt text on each slide starts "AI-generated photo of Claudio…"; no #ad (nothing gifted).
- Exported 1080×1350 JPG q3; sidecars kept; logged as `dump-slow-sunday@v1`.
