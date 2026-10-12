# TODO

What's left to finish Claudio, most important first.

## Before going live (required)

1. **Platform fee wallet**: in `claudio-app/shared/platform.ts`, `PLATFORM_FEE_WALLET_SOL` is still Claudia's wallet.
   The platform's 30% of every launch's creator fees would go there. Replace it with Claudio's own Solana address.
2. **Token**: in the same file, `CLAUDIO_TOKEN.mint` still points at the $CLAUDIA mint, which the site now shows as $CLAUDIO.
   Replace it with the $CLAUDIO mint once the coin exists.
3. **Creator**: `claudio-app/shared/site.ts` (`CREATOR`) credits @anabology. Keep it or change it to the new creator's handle.
4. **Domain and socials**: links point to `useclaudio.xyz`, `@useclaudioxyz`, and `claudio.gallery`, which are placeholders.
   Set the real domain and accounts.

## To match Claudia fully

5. **Video loops**: the four home-page loops (room, club, lounge, rain) are still images.
   The `.mp4` files belong in `claudio-app/client/public/claudio/media/` as `<name>.mp4` (9:16) and `<name>-sq.mp4` (1:1).
   The posters are already in place, and `claudio-character-bible/references/owner-reference-set.md` describes each loop's framing and beats.

## Hosting

6. The site runs locally only. To publish it you need a Node host with Postgres and the keys listed in `claudio-app/.env.example`.

## Done

- The `claudio-character-bible` skill and every other skill describe Claudio's look (54 skills pass `node scripts/validate.mjs`).
  The skills are synced into the site with `node scripts/sync-site.mjs ../claudio-app`.
- The default `claudio` brand kit in `@useclaudio/media` uses Claudio's identity.
- `claudio-local` installs, builds and starts. Its `.npmrc` sets `install-links=true` so the local `packages/` install with their dependencies.

## Images

- `images/claudio-13-source/`: the 13 source photos of Claudio.
- `images/cover-claudio.jpg`, `images/face-claudio.jpg`: the cover and the face crop.
- Everything under `claudio-app/client/public/claudio/` is generated from these photos.
