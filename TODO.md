# TODO

What's left to finish Claudio, most important first.

## Before going live (required)

1. **Token**: in `claudio-app/shared/platform.ts`, `CLAUDIO_TOKEN.mint` still points at the $CLAUDIA mint, which the site now shows as $CLAUDIO.
   Replace it with the $CLAUDIO mint once the coin exists.
2. **Creator**: `claudio-app/shared/site.ts` (`CREATOR`) credits @anabology. Keep it or change it to the new creator's handle.
3. **Domain**: links point to `useclaudio.xyz` and `claudio.gallery`, which are placeholders. Set the real domain.

## To match Claudia fully

4. **Video loops**: the four home-page loops (room, club, lounge, rain) are still images.
   The `.mp4` files belong in `claudio-app/client/public/claudio/media/` as `<name>.mp4` (9:16) and `<name>-sq.mp4` (1:1).
   The posters are already in place, and `claudio-character-bible/references/owner-reference-set.md` describes each loop's framing and beats.

## Hosting

5. The site runs locally only. To publish it you need a Node host with Postgres and the keys listed in `claudio-app/.env.example`.

## Done

- The `claudio-character-bible` skill and every other skill describe Claudio's look (54 skills pass `node scripts/validate.mjs`).
  The skills are synced into the site with `node scripts/sync-site.mjs ../claudio-app`.
- The default `claudio` brand kit in `@useclaudio/media` uses Claudio's identity.
- X account: **[@ClaudioAgentAi](https://x.com/ClaudioAgentAi)**, set in `claudio-app/shared/brand.ts` (`BRAND.twitter`), `shared/site.ts`,
  `shared/agents.ts` and the skills. The X header is `images/x-header-claudio.jpg` (1500×500).
- No TikTok account: Claudio's TikTok profile links are removed from the site. TikTok stays available as a platform agents can connect.
- GitHub: [claudioagenticai-sketch/CLAUDIO-AI](https://github.com/claudioagenticai-sketch/CLAUDIO-AI); every repo link points there.
- Platform fee wallet: `PLATFORM_FEE_WALLET_SOL` = `4Eh38JobinLouigdGceUeMLGJR3B4T9s557xJHdW8n9P` (receives the platform's 30% of creator fees
  on every coin launched through Claudio). Also in `.env.example` (`PLATFORM_TREASURY_SOL`), `docs/FEES.md`, the README and the skills.
- `claudio-local` installs, builds and starts. Its `.npmrc` sets `install-links=true` so the local `packages/` install with their dependencies.

## Images

- `images/claudio-13-source/`: the 13 source photos of Claudio.
- `images/cover-claudio.jpg`, `images/face-claudio.jpg`: the cover and the face crop.
- `images/x-header-claudio.jpg`: the X profile header.
- Everything under `claudio-app/client/public/claudio/` is generated from these photos.
