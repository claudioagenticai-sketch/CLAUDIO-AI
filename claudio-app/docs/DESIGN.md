# Claudio design system

**Claudio — Where humans and agents launch and trade.** Claudio is an AI influencer who hosts the platform, so the look
borrows from his portrait: deep navy night, a **cobalt** backdrop, **copper** in his hair, and paper-white type with an
editorial serif for display. Calm and precise where people trade (the board, the order ticket), warmer where Claudio talks
(heroes, empty states, docs).


> **Theme update (Claudio rose):** surfaces are plum-black (`--bg #120b10`, panels `#1b1118 → #2b1b26`), the brand colour is rose
> pink `--brand #ff6fa5` (fills `#d63a76` with white text), the warm accent is peach-copper `--brand-2/--copper #ff9a6b`, text is
> blush cream `#f8ece8`, info is lilac `#c3a6ff`. Buy stays green `#3ddc97`; sell is a true red `#ff5a52` so it never reads as
> the pink brand. Token names are unchanged.

## Voice

Warm, confident, a little playful. Simple everyday words. Claudio can speak in the first person in heroes and empty states
("Even I can't find this one."), never in warnings, fees or security copy — those stay plain and exact. No archery,
no "direction" puns. Never promise returns; say "not financial advice" where takes appear.

## Colour

- **Navy surfaces**, stepped for elevation (no heavy shadows).
- **Cobalt** is the brand: primary actions, the active nav item, focus rings, "launched on Claudio". Keep it rare so it keeps
  its meaning.
- **Copper** is the warm second accent: the spark motif, small highlights, the platform side of the fee split, one italic
  word in a display headline. Use sparingly.
- **Buy = jade, sell = raspberry.** They never use cobalt or copper.
- Warn = yellow, info = sky, gold = watchlist / ATH.

### Tokens (CSS variables in `client/src/index.css`, Tailwind names in brackets)

| Role | Variable | Value | Tailwind |
|---|---|---|---|
| Page background | `--bg` | `#0b1120` | `bg-bg` |
| Raised chrome (rail, status bar) | `--bg-elev` | `#0e1526` | `bg-bg-elev` |
| Cards | `--panel`, `--panel-2`, `--panel-3` | `#11192d`, `#152036`, `#1b2740` | `bg-panel`, `-2`, `-3` |
| Hairlines | `--line`, `--line-2` | `#222e47`, `#314061` | `border-line`, `border-line-2` |
| Text | `--text`, `--text-2`, `--text-3` | `#f3efe7`, `#b9c1d1`, `#8b96ae` | `text-text`, `-2`, `-3` |
| Brand (cobalt) | `--brand` | `#5288f2` | `text-brand`, `ring-brand` … |
| Brand fill (buttons) | `--brand-fill` → `--brand-fill-2` | `#3d71e3` → `#2e5bd0` | `.brand-gradient`, `bg-brand-fill` |
| Text on brand fill | `--brand-ink` | `#ffffff` | `text-brand-ink` |
| Brand wash / glow | `--brand-bg`, `--brand-glow` | 14% / 45% cobalt | `bg-brand-bg` |
| Copper | `--copper` (= `--brand-2`) | `#e0703c` | `text-copper`, `bg-copper`, `.chip-copper` |
| Buy / sell | `--buy`, `--sell` (+ `-bg`, `-ink`) | `#3ddc97`, `#f4506f` | `buy`, `sell` |
| Warn / info / gold | `--warn`, `--info`, `--gold` (+ `-bg`) | `#f5c84c`, `#6cc7ec`, `#ffd166` | `warn`, `info`, `gold` |
| Translucent bars | `--chrome` | navy 88% | `bg-chrome` |

Opacity modifiers work on every token (`bg-brand/20`, `ring-line/50`) via `color-mix`.

### Contrast (WCAG AA)

- `text` ≥ 12:1, `text-2` ≥ 7:1, `text-3` ≥ 4.5:1 on every surface up to `panel-3`.
- `brand` and `copper` text ≥ 4.5:1 on `bg`/`panel` (use them for icons, links and short labels).
- White on the brand fill gradient ≥ 4.5:1. Flat `bg-brand` is for dots, bars and icons — for text on cobalt, use
  `.brand-gradient` or `bg-brand-fill`.

## Type

- **DM Sans** (400–800) for UI. Page titles `font-extrabold tracking-tight`, section titles `font-bold`.
- **DM Mono** for numbers, prices, addresses — always through `.num` (tabular figures).
- **Instrument Serif** for display and the wordmark — `.font-display` (heroes, docs titles, 404, the CLAUDIO wordmark).
  One italic copper word per headline at most.
- Section labels: `.eyebrow` (10.5px, bold, uppercase, wide tracking, `text-3`).
- Fonts load from Google Fonts in `client/index.html`; nothing else is loaded.

## Brand marks (`components/kit/brand.tsx`)

- `ClaudioMark` — Claudio's face is the logo. `variant="tile"` (default): a tight face crop (`face-128.webp`) in a soft
  square — rail, top bar, docs, favicons. `variant="avatar"`: his head-and-shoulders portrait in a circle, for places
  where he "speaks". There is no letter monogram.
- `Wordmark` — CLAUDIO in Instrument Serif with open tracking; `tagline` adds the line underneath.
- `ClaudioSpark` — a small four-point spark with satellite dots (copper). Use sparingly — at most one per screen.

### Assets (`client/public/claudio/`)

| File | Use |
|---|---|
| `face-128.webp` | tight face crop — the logo |
| `/favicon.ico` (16/32/48), `favicon-32.png`, `favicon-64.png` | favicons (same face crop, soft square) |
| `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` | face icons |
| `icon-maskable-512.png` | face inside the 80% safe zone (manifest `maskable`) |
| `avatar-256.webp`, `avatar-96.webp` | Claudio's avatar |
| `portrait-full.webp` | 2:3 portrait (teaser) |
| `og.jpg` | 1200×630 Open Graph / Twitter card |

## Shape

- Radius: cards `rounded-xl`/`rounded-2xl` (`--radius` = 12px), controls `rounded-xl` (36px tall on desktop, 40–44px on
  phones), chips `rounded-[6px]`.
- Token images are squircles (`rounded-[30%]`); Claudio's avatar is a circle.
- Borders are 1px `line`; elevation comes from `panel` steps. Popovers and dialogs get `shadow-2xl shadow-black/50`.

## Components

- `components/kit` — data primitives (`TokenAvatar`, `Price`, `Age`, `Progress`, `Empty`, `ResponsiveSheet`, chain/launchpad
  marks) and the brand marks above.
- `features/wallet/ui` — page primitives: `Page`, `PageHeader`, `Card`, `ActionButton` (tones `brand`, `soft`, `ghost`,
  `danger`), `Segmented`, `Toggle`, `SwitchLite`.
- `features/docs/ui` — docs primitives (`Callout`, `AddressCard`, `Table` that stacks on phones, `Steps`, `Grid`).
- Utility classes: `.panel`, `.panel-accent` (cobalt left edge), `.chip` + `chip-buy|sell|warn|info|brand|copper`, `.btn-buy`,
  `.btn-sell`, `.brand-gradient`, `.brand-text` (cobalt → copper, short display words only), `.bg-grid`, `.eyebrow`,
  `.font-display`, `.num`.
- Chains that aren't open yet (Robinhood Chain, BNB Chain) are shown greyed with a small **Soon** badge and are never
  selectable (`useChainState`, `lib/openChains.ts`).

## Layout

- **Desktop**: a 76px navigation rail (C mark, Launch call-to-action, Home, Trenches, Portfolio, Agents, Tracker, Creator,
  Claim; bottom: Wallets, Settings, and Admin for admin wallets only), a 56px top bar (section title, chain switcher,
  search, quick-buy, preset, wallet), content, and a 28px status bar (live feed health for open chains, "soon" for the rest).
- **Mobile** (<768px): compact top bar (mark, chain switcher, search, wallet), content, and a floating dock:
  **Home · Trenches · Launch (raised) · Portfolio · More**. The More sheet holds Agents, Tracker, Creator, Claim fees,
  Wallets, Settings, Docs (+ Admin for admin wallets). Bottom sheets instead of dialogs.
- Long addresses on phones break into two even halves instead of leaving a stray character on its own line.

## Motion

Short and functional: 150–250ms, spring for selection indicators (`layoutId`), price flashes on change. The teaser has
slow ambient drift. Everything respects `prefers-reduced-motion` (`MotionConfig reducedMotion="user"` in the shell, and
`@media (prefers-reduced-motion)` in CSS).
