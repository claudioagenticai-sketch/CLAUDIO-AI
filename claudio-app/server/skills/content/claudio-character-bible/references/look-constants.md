# Claudio look constants and drift tolerances

Read this when reviewing a generation or writing a detailed prompt. Each feature has: the canonical description, the
words that reliably produce it, what drift looks like, and whether a drifted output is a **reject**, **fix in edit**, or
**accept**.

Derived from the owner's reference set (the blue studio portrait, the golden-hour close-up and the stills behind the
`room`, `club`, `lounge` and `rain` scenes).

## Face

| Feature | Canonical | Prompt words | Drift looks like | Verdict |
|---|---|---|---|---|
| Age | 35, reads 32–38 | "35-year-old man (adult, mid-thirties)" | boyish face, smooth skin, or deep wrinkles and grey | **reject** anything under ~28 or over ~45 |
| Face shape | angular, defined cheekbones, strong jaw under the beard | "angular face, defined cheekbones" | round soft face, very long face | reject if round + young |
| Eyes | light blue-grey, slightly deep-set | "light blue-grey eyes" | brown, dark green, bright blue | **reject** (identity break) |
| Brows | strong, straight, dark brown, medium-thick | "strong straight dark-brown brows" | thin, arched, bleached | fix in edit if mild |
| Freckles | light dusting over nose and cheekbones | "light freckles across the nose and cheeks" | none (ok in low light), heavy full-face freckles | accept none at night; reject heavy |
| Smile | calm closed-lip half-smile; in UGC a wide open laugh with visible teeth | "calm closed-lip half-smile" / "laughing openly" | smirk, scowl, forced grin in portraits | accept laugh in UGC only |
| Skin | natural texture, visible pores, light warm tone, sun-kissed | "natural skin texture with visible pores" | plastic, airbrushed, waxy, oily shine | **reject** for photoreal |

## Head and beard (the most recognisable part)

| Feature | Canonical | Prompt words | Drift | Verdict |
|---|---|---|---|---|
| Head | clean shaved head, light even stubble, no hairline visible | "clean shaved head with light stubble, no hair on top" | buzz cut with visible hair, receding hairline, full hair | **reject** visible hair |
| Beard length | medium, 3–5 cm, full at the cheeks and chin | "full, thick beard of medium length" | stubble only, chest-length, goatee | **reject** goatee or clean-shaven |
| Beard colour | dark brown, a touch lighter and warmer in the moustache | "dark-brown beard, slightly lighter moustache" | black, ginger, grey streaks | reject grey; fix tone in edit |
| Beard shape | groomed, natural edge on the cheeks, fuller at the chin | "groomed" | patchy, sculpted razor lines | fix mild patchiness; reject sculpted lines |

## Accessories

| Feature | Canonical | Drift | Verdict |
|---|---|---|---|
| Bracelet | one chunky silver chain-link (curb) bracelet on one wrist | gold, thin chain, several bracelets | fix in edit (it's a signature) |
| Sunglasses | dark rectangular or soft square frames, dark lenses | aviators, coloured lenses | fix or regenerate |
| Glasses (desk look) | thin metal round frames | thick black frames | fix or regenerate |
| Headphones (travel look) | dark over-ear headphones resting around the neck | earbuds, headphones on the head | accept on the head; fix colour |
| Earrings, necklaces | none | earrings, chains around the neck | fix in edit |

Mirror selfies and front-camera clips flip left and right. Do not reject a generation because the bracelet is on the
"other" wrist — reject only when there is more than one or a gold one.

## Wardrobe specifics

- **Olive t-shirt:** plain crew-neck, soft washed cotton, slightly fitted at the shoulders and arms, no print, no logo.
- **Tartan trousers:** red-dominant tartan with green and black lines, relaxed straight leg, a dark belt.
- **Knit jumper:** chunky ribbed knit in dark brown or black, sleeves pushed up or pulled over the hands.
- **Sage blazer:** soft sage-green, notched lapel, unstructured, linen-cotton texture, over a navy-black crew-neck.

## Camera habits that read as "his feed"

- UGC: front-camera phone look, 24–26 mm equivalent, eye level or slightly above, natural mixed light, slight handheld
  shake, auto-exposure breathing, 9:16.
- Portraits: 50–85 mm, f/1.8–2.8, eye-level, shallow depth of field, warm key from a window or lamp.
- Banners: 35 mm, low and close, his face in the right third, head resting on folded arms, eyes to lens.

## Drift scoring (for agents doing QA)

Score each of the five anchors 0/1 (shaved head, beard, blue-grey eyes, silver chain, face/age/build). Add 1 for
wardrobe-on-look and 1 for no artifacts (hands, text, extra limbs).

- 7/7 publish · 6/7 publish if the miss is the chain · 5/7 fix in edit · ≤ 4 regenerate.
- **Any age doubt = regenerate**, whatever the score.
