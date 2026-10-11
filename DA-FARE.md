# Claudio: stato del clone

Clone di Claudia (di @anabology, licenza MIT) rinominato in **Claudio** al maschile.
Originali intatti in `_riferimento/`.

| Cartella | Da cosa viene |
|---|---|
| `claudio-app/` | github.com/claudia-onchain/claudia-app (sito, terminale, launchpad, server) |
| `claudio-local/` | github.com/claudia-onchain/Claudia-Local (app desktop locale) |
| `claudio-skills/` | github.com/claudia-onchain/Claudia-Skills (libreria di skill) |
| `packages/` | pacchetti npm `@useclaudia/*` 0.3.0, ora `@useclaudio/*` in locale |

## Fatto

- Claudia → Claudio ovunque (testi, codice, nomi di file e cartelle), she/her → he/him nei paragrafi su Claudio.
- 64 immagini del volto di Claudia sostituite da placeholder "CLAUDIO", con le stesse dimensioni e gli stessi nomi.
- `claudio-local` usa i pacchetti in `packages/` invece di quelli npm di Claudia.
- Licenze MIT con il copyright originale mantenuto, come richiede la licenza.
- `claudio-app`: `npm install` e `npm run check` passano.

## Prima di andare online (importante)

1. **Wallet delle fee**: `claudio-app/shared/platform.ts` → `PLATFORM_FEE_WALLET_SOL` è ancora il wallet di Claudia.
   Il 30% delle fee di ogni lancio andrebbe a lui. Metti il tuo indirizzo Solana.
2. **Coin**: nello stesso file `CLAUDIO_TOKEN.mint` è ancora il mint del coin $CLAUDIA, che ora appare come $CLAUDIO.
   Va cambiato con il mint del tuo coin.
3. **Creatore**: `claudio-app/shared/site.ts` (blocco `handle: "anabology"`) dice che Claudio l'ha creato @anabology. Metti il tuo handle e la tua storia.
4. **Dominio e social**: i link puntano a `useclaudio.xyz`, `@useclaudioxyz`, `claudio.gallery` e `claudio-onchain` su GitHub, che sono segnaposto.

## Ancora da fare

- **Immagini**: fatte. Le 13 foto generate con Gemini (in `immagini/claudio-13/`) sono nel sito in tutti i formati: ritratto, riquadri, locandine, banner, collage, card social, avatar e icone.
- **Video**: i 4 video animati di Claudia sono stati tolti dal clone, quindi il sito mostra le locandine ferme di Claudio.
  Per riaverli animati servono 4 clip di Claudio, una per scena (casa, club, lounge, pioggia), in verticale 9:16 e anche in quadrato.
- **Look**: aggiornato in `claudio-app/shared/site.ts` e nella pagina `/claudio`. La skill `claudio-character-bible` descrive ancora il look di Claudia.
- **claudio-local**: da installare a mano:
  ```
  cd claudio-local
  npm install
  npm run build
  npm start
  ```
- **claudio-app** in locale: `cd claudio-app`, poi `npm run dev` (http://localhost:5000; vedi `.env.example`).
