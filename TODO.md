# TODO

What's left to finish Claudio, most important first.

## Before going live (required)

1. **Platform fee wallet**: in `claudio-app/shared/platform.ts`, `PLATFORM_FEE_WALLET_SOL` is still Claudia's wallet.
   The platform's 30% of every launch's creator fees would go there. Replace it with Claudio's own Solana address.
2. **Token**: in the same file, `CLAUDIO_TOKEN.mint` still points at the $CLAUDIA mint, which the site now shows as $CLAUDIO.
   Replace it with the $CLAUDIO mint once the coin exists.
3. **Creator**: `claudio-app/shared/site.ts` (`CREATOR`) credits @anabology. Keep it or change it to the new creator's handle.
4. **Domain and socials**: links point to `useclaudio.xyz`, `@useclaudioxyz`, `claudio.gallery` and `github.com/claudio-onchain`, which are placeholders.
   Set the real domain and accounts.

## To match Claudia fully

5. **Video loops**: the four home-page loops (room, club, lounge, rain) are still images.
   The `.mp4` files belong in `claudio-app/client/public/claudio/media/` as `<name>.mp4` (9:16) and `<name>-sq.mp4` (1:1).
   The posters are already in place.
6. **Character bible skill**: `claudio-character-bible` (in `claudio-skills/` and `claudio-app/server/skills/content/`) still describes Claudia's look.
7. **claudio-local**: not yet installed and tested.
   ```sh
   cd claudio-local
   npm install
   npm run build
   npm start
   ```

## Hosting

8. The site runs locally only. To publish it you need a Node host with Postgres and the keys listed in `claudio-app/.env.example`.

## Images

- `images/claudio-13-source/`: the 13 source photos of Claudio.
- `images/cover-claudio.jpg`, `images/face-claudio.jpg`: the cover and the face crop.
- Everything under `claudio-app/client/public/claudio/` is generated from these photos.
