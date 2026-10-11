# Launchpad Research — Trading Terminal Rebuild

_Compiled 2026-09-27 from docs, official repos, Bitquery/DefiLlama indexer docs. Tags: **[C]** confirmed from primary source, **[L]** likely/secondary, **[U]** unknown. **Every address and number must be verified on-chain before shipping** — several launchpads read live config (fees, thresholds) and some docs disagree with live data._

Reference competitor: **GMGN.ai** ("Trenches" page, `?chain=sol|bsc|robinhood`). Also Axiom and pump.fun's Terminal (formerly Padre) cover Robinhood Chain. BullX stopped trading 2026-06-01.

---

## 1. Where each platform actually lives

The competitor's 14-button panel lists platforms from **all** its chains. They're filtered by the chain you pick.

| Platform | Chain(s) | Model | Graduates to | Tax support | Integration path |
|---|---|---|---|---|---|
| **Pump** (pump.fun) | Solana | Bonding curve | PumpSwap (LP burned) | No (Token-2022 mint, no transfer fee) | `@pump-fun/pump-sdk` `create_v2`, or PumpPortal `trade-local` |
| **Bonk** (bonk.fun) | Solana | Raydium LaunchLab curve | Raydium CPMM | **Yes**, Token-2022 TransferFee | `@raydium-io/raydium-sdk-v2` + Bonk platformId, or PumpPortal `pool:"bonk"` |
| **Bags** (bags.fm) | Solana **+ Robinhood** | Meteora DBC curve (SOL) / x·y=k (HOOD) | DAMM v2 (SOL) / Uniswap v4 (HOOD) | No | REST API + `@bagsfm/bags-sdk` (SOL); `BagsFactory.createAndBuy` (HOOD) |
| **Heaven** (heaven.xyz) | Solana | Instant (own AMM, 35 virtual SOL) | None ("virtual" at $100k) | Pro pools only (reflection fee, undocumented) | `POST tx.api.heaven.xyz/tx/create-standard-liquidity-pool` |
| **Stonkfun** (stonkfun.xyz) | Solana | Raydium LaunchLab curve | Raydium CPMM | Yes, Token-2022 1–3% | Public API `/launches/prepare`, or LaunchLab SDK |
| **Four** (four.meme) | BSC | Bonding curve (18 BNB live) | PancakeSwap | **Yes** (1/3/5/10%, buy/sell split) | API login → server-signed `createArg` → `TokenManager2.createToken` |
| **Flap** (flap.sh) | BSC **+ Robinhood** + Base, X Layer, Monad… | Bonding curve (x+h)(y+r)=K | Pancake V2/V3 (BSC), Uniswap V2 (HOOD) | **Yes** (Tax V3, asymmetric, up to 10%) | Fully on-chain: upload meta → mine CREATE2 salt → `Portal.newTokenV6/V7` |
| **Genius** (genius.fun) | BSC | Bonding curve (15 BNB) | Locked v4-style pool with hook | Creator fee split | On-chain `launchAndBuy` (**same design as Pons V2**) |
| **Pons V2** (ponsfamily.com) | Robinhood | Bonding curve (4.2 ETH) | Uniswap v4 + MemeHook, LP locked forever | Yes, `creatorTaxBps` (≤10%) | Router `launchAndBuy(TokenParams,…)`. Public now (`launchEnabled=true`), but the owner can gate it. See `pons-v2.md` |
| **Pools** (pools.trade, by Uniswap Labs) | Robinhood | Instant: single-sided v4 LP (Instant) or 4h CCA auction (Crowd) | None (progress = FDV/$50k) | No (0.05% creator fee) | Uniswap `liquidity-launcher` (InstantLaunchStrategy) |
| **Clanker** | Base, Robinhood, Arbitrum, BSC, … | Instant: single-sided v4 LP | None | Fee split (creator 5/6 on HOOD); sniper-auction decay | `clanker-sdk/v4` → `deployToken(DeploymentConfig)` |
| **Trench** (trench.today) | Robinhood | Bonding curve (virtual reserves) | "a Uniswap pool" [L] | Extra-fee fields in events | Factory proxy `0x77dc…3f9d`, create signature [U] |
| **Dyor** (dyor.fun V3 / DYORSWAP) | Robinhood, Arc, Stable, X Layer, HyperEVM, GIWA | Instant: Uniswap V3 1%, LP vaulted | None (milestone at 4.5 WETH) | No | REST `POST /api/{chain}/v1/launch/prepare` |
| **Argus** (argus.world) | **Arc** (Circle L1, USDC gas) | Instant: single-sided v4 | None | **Yes** (fixed 1–10% buy/sell) | `Portal v7.createLaunch`. ⚠️ Open "reverts" bug report |

**By chain:**
- **Robinhood (HOOD):** Pons V2, Pools, Flap, Bags, Clanker, Trench, Dyor
- **Solana:** Pump, Bonk, Bags, Heaven, Stonkfun
- **BSC:** Four, Flap, Genius
- **Arc:** Argus, Dyor
- **Base:** Clanker, Flap

**Two launch models:**
1. **Bonding curve → migrate:** Pump, Bonk, Bags, Stonkfun, Four, Flap, Genius, Pons V2, Trench. These produce real "New → Almost bonded → Migrated" columns.
2. **Instant pool (no migration):** Clanker, Pools, Dyor, Argus, Heaven. Their "bonding %" is a synthetic mcap milestone (Pools: FDV/$50k, Dyor: 4.5 ETH, Heaven: $100k).

---

## 2. Robinhood Chain

- **Chain:** Arbitrum Orbit/Nitro L2 with blob DA. ETH gas. Chain ID **4663** (testnet 46630). Mainnet since **2026-07-01**. [C]
- **RPC:** public `https://rpc.mainnet.chain.robinhood.com` (rate-limited, not for prod). Alchemy `robinhood-mainnet.g.alchemy.com`. Also QuickNode, Chainstack, dRPC, GetBlock. [C]
- **Explorer:** robinhoodchain.blockscout.com
- **Blocks and ordering:** about 100–250ms blocks. **FCFS sequencer, no public mempool, priority tips do nothing.** Execution edge = latency to the sequencer. [C]
- **Sequencer feed:** `wss://feed.mainnet.chain.robinhood.com` streams ordered txs before RPC nodes have them. This is the fastest "New" signal. Decoder: github.com/chainstacklabs/robinhood-chain-sequencer-feed [C]
- **Indexers:** Goldsky, Envio HyperSync (`robinhood.hypersync.xyz`), Bitquery (has Pons, Pools, Flap, Trench APIs). [C]
- **Uniswap:**
  - v3 Factory `0x1f7d7550b1b028f7571e69a784071f0205fd2efa`
  - UniversalRouter `0x8876789976decbfcbbbe364623c63652db8c0904`
  - v4 PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951`
  - v4 StateView `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b`
  - v4 Quoter `0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94`
  - v2 addresses: [U]
- **Tokens:** WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`, USDG `0x5fc5360d0400a0fd4f2af552add042d716f1d168`. Permit2 and Multicall3 are at their canonical addresses.
- **Market:**
  - Memecoins ≈ 79% of DEX volume (late July).
  - Pons is the dominant launchpad: ~25k launches per day and ~$6M in fees per day in early September, ahead of pump.fun on DefiLlama for that day.
  - Noxa (the CASHCAT launchpad) shut down in July.
  - Stock-paired memes (tokenized NVDA/AAPL/HOOD as quote) are a trend across Pons, Flap, Four, Genius and Stonkfun.

---

## 3. Per-platform details

### Pump.fun — Solana
- **Programs:** pump `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`, PumpSwap `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`. [C]
- **Create:**
  - `create_v2` (live since 2025-11-11) makes a Token-2022 mint with 6 decimals and metadata-pointer.
  - Args: `name` ≤32, `symbol` ≤13, `uri` ≤200, `creator`, `is_mayhem_mode`, `creator_fee_bps`, `is_holder_reward`.
  - Legacy `create` still works.
  - USDC-quoted coins exist since 2026-05-21 and need the `buy_v2`/`sell_v2` instructions. [C]
- **Metadata:** ⚠️ `pump.fun/api/ipfs` **is no longer supported**. Our prototype still calls it (`server/routes.ts:125`). Upload to Pinata or our own IPFS instead. [C]
- **Dev buy:** atomic with the create (SDK `create_v2_and_buy`, or PumpPortal `amount`). Creation fee is 0. Vanity "pump" suffix = grind the mint keypair. [C]
- **Curve:**
  - Virtual token reserves 1.073B, virtual SOL 30, real token reserves 793.1M.
  - Completes when `real_token_reserves == 0` (about 85 SOL raised). [C/L]
  - Migrates to PumpSwap with LP burned; 0.015 SOL graduation fee.
- **Fees:** curve 1.25% (creator 0.30%). PumpSwap fees are tiered by mcap. [C]
- **PumpSwap pricing:** must add `virtual_quote_reserves` (non-zero since 2026-07-21). [C]
- **Index:**
  - `CreateEvent` (both create variants)
  - `TradeEvent`
  - `CompleteEvent` + `CompletePumpAmmMigrationEvent`
  - Progress % = `1 − real_token_reserves / 793.1M`
- **Gotcha:** don't cache `bonding_curve.creator`; always read it from chain.

### Bonk.fun — Solana (Raydium LaunchLab)
- **Programs:** LaunchLab `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj`, CPMM `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C`. Bonk platform config `FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1` [L].
- **Create:**
  - `raydium.launchpad.createLaunchpad({... platformId: <bonk>, buyAmount})`.
  - `InitializeWithToken2022` supports **TransferFeeConfig**, the only native Solana tax option.
  - Quote: SOL or USD1.
  - Issue #108: `buyAmount` must be greater than 0.
- **Curve:** 793.1M sold on the curve, about 85 SOL [L]. Migrates via `migrate_to_cpswap`. LP handling changed in the Aug–Sep 2026 program upgrades (breaking).
- **Index:**
  - `initialize_v2` / `initialize_with_token_2022` with Bonk's platform config in the accounts
  - `buy_exact_in/out`, `sell_exact_in/out`
  - `migrate_to_cpswap`

### Bags — Solana + Robinhood
- **Solana:**
  - Flow: `POST create-token-info` (Bags uploads to IPFS **and generates the mint**) → `POST fee-share/config` (up to 100 claimers) → `POST create-launch-transaction {initialBuyLamports}` → submit, e.g. through Jito.
  - Needs an API key.
  - **Partner key = integrator revenue share.**
  - Fee modes per launch (`bagsConfigType`): 2%/2% default, 85 SOL graduation, migrates to Meteora DAMM v2.
  - Index both DBC init variants, SPL **and** Token-2022, or you miss about a third of launches.
- **Robinhood:**
  - `BagsFactory 0xe8Cc4431adF8b5A847C113EF0c6af9043219Cb37`
  - `createAndBuy(name, symbol, metadataURI, partner, claimers[], bps[])`
  - Creation fee: `creationFee()` (0.02 ETH default).
  - 830M tokens sold on the curve, then Uniswap v4 with locked LP.
  - ⚠️ Post-migration swaps need Bags' **modified UniversalRouter**; stock Uniswap calldata reverts.

### Heaven — Solana
- **Program:** `HEAVENoP2qxoeuF8Dj2oT1GHEnu49U5mJYkdeC8BAX2o`. Own AMM, no curve, Token-2022.
- **Create:** a single REST call returns an unsigned tx covering mint + pool + initial buy. Bring your own IPFS URI.
- **Fees:**
  - Protocol 1% under $100k mcap.
  - Creator 1% ("creator coins", which go through review) or 0.1% ("community coins").

### Stonkfun — Solana
- Raydium LaunchLab with any quote asset (xStocks etc.), migrates to CPMM.
- Optional Token-2022 transfer tax of 1–3%.
- Public no-key API at `stonkfun.xyz/api/public/v1` (`/launches/prepare`).
- ⚠️ Name confusion with StonkBrokers and Stonk Exchange, which are on Robinhood Chain.

### Four.meme — BSC
- **Contracts:** TokenManager2 `0x5c952063c7fc8610FFDB798152D69F0B9550762b`, Helper3 `0xF251F83e40a78868FcfA3FA4599Dad6494E46034`. [C]
- **Create:**
  1. Nonce, then sign `You are sign in Meme {nonce}`, then login to get the `meme-web-access` token.
  2. Upload the image.
  3. `POST /v1/private/token/create` returns `{createArg, signature}`.
  4. Call `createToken(args, sig)` with `msg.value = launchFee + preSale(+fee)`.
  - **So Four always needs their server.**
- **Curve:**
  - 1B supply, 80% sold on the curve.
  - Graduation: **docs say 24 BNB, live config says 18 BNB**. Read `/v1/public/config`.
  - 1% trade fee. Many quote tokens (BNB, USDT, USD1, bStocks).
- **Tax tokens:** types 5, 8 and 9. Buckets burn / dividend / LP / recipient. Tax persists on the Pancake V2 pair.
- **Anti-snipe:** `feePlan`. There is also an "X Mode" that requires a signed buy.
- **Newer engine: OpenFour** (registry `0x912CEf0C3aE9Ab6eB3Ec87cab69371cFb317Ab94`). It has different events, so **index both classic and OpenFour**.
- **Events:** `TokenCreate`, `TokenPurchase`, `TokenSale`, `TradeStop`, `LiquidityAdded`.
- **Gotchas:** amounts must be GWEI-aligned. API tax is in %, on-chain tax is in bps.

### Flap — BSC, Robinhood, Base, …
- **Portals:**
  - BSC `0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0`
  - **HOOD `0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09`**
  - Base `0x0000BC1c4fD15Dd79029AF8F5d77D68ae4490000` [C]
- **Create (no server signature needed):**
  1. Upload meta to `funcs.flap.sh/api/upload`. It must be pinned via Flap.
  2. Mine a CREATE2 salt for a vanity suffix: `7777` = tax, `8888` = standard.
  3. Call `newTokenV6` (tax) or `newTokenV7` (non-tax, BSC). Dev buy goes in `quoteAmt`.
- **Curve:** `(x+h)(y+r)=K`, graduation at 80% of supply sold (~16 BNB). Robinhood: ETH quote only, Uniswap V2, about 5 ETH [L].
- **Tax V3:**
  - Asymmetric buy/sell tax in bps, ≤10%.
  - Buckets: mkt / deflation / dividend / LP.
  - `taxDuration` sets how long tax persists after migration.
- **`commissionReceiver`: the integrator earns a share of tax.** Revenue for us.
- **Events:** `TokenCreated`, `TokenBought`, `TokenSold`, `FlapTokenProgressChanged` (progress in 1e18), `LaunchedToDEX`, `FlapTokenAsymmetricTaxSet`.
- **Gotchas (third-party):** `FeatureDisabled` on V2_PERMIT via V6 on BSC; only the `FOUR_FIFTHS` threshold is accepted; public RPC gas estimates get clamped.

### Pons V2 — Robinhood
- **Contracts:**
  - Factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`
  - Router `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948`
  - MemeHook `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` [C]
- **Launch:**
  - `launchAndBuy(TokenParams, launchConfigId, pairToken, quoteIn, minOut, recipient, exemptions[])`.
  - `TokenParams` includes socials, `creatorTaxBps`, `buybackEnabled`, `expectedEconomics` (from `previewLaunchEconomics`) and `salt`.
  - Launch gate: `canLaunch(addr) = launchEnabled || whitelisted`. **Live `launchEnabled = true` (public).** Unaudited. Full details in `pons-v2.md`.
- **Economics:**
  - 1B supply; 5/7 sold on the curve; graduates at 4.2 ETH (per-config, read `getLaunchConfig`).
  - Full-range v4 pool with LP locked forever.
  - Snipe tax 99% decaying to 0 over **3s** (live value). Launch fee 0.0005 ETH. 1% curve fee.
- **Events:** `TokenLaunched`, `CurveBuy`, `CurveSell`, `CurveCompleted`, `PoolGraduated`, `SnipeTaxCharged`.
- **V1** (Uniswap v3 direct) still exists; factory `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB`.
- Open-source contracts: github.com/ponsdotdev/pons-labs

### Genius.fun — BSC
- **Same contract family as Pons V2**: Factory / LaunchAndBuy / MemeHook / FeeEscrow / Locker, with an identical `TokenLaunched` event. One adapter class, different config.
- **Contracts:** Factory `0x37eE8AeE29C5efd3C1A7edA6dF3F510779928a37`, LaunchAndBuy `0xd8b71b46498A36A4607EAb5C735BeE1DAb7F263d`.
- **Economics:**
  - Graduates at 15 BNB. Launch fee 0.002 BNB. 2% fees. Vanity suffix `6666`.
  - Pairs: BNB, USDT, USDC, stock tokens.

### Pools.trade — Robinhood (Uniswap Labs)
- **Instant Launch:** single-sided concentrated liquidity in a plain v4 pool (0.25% fee, no hook), created in the mint tx. No migration.
- **Crowd Launch:** a 4-hour CCA auction.
- **Contracts:** Entry `0x0000ffffbe8efe702c8703ae3477ff5de3d319c0`, token factory `0x000000e200088d55c39a11f609e5f667729ad49b`.
- **Launching:** via Uniswap's `liquidity-launcher` (InstantLaunchStrategy + UniversalRouterStrategy for launch-and-buy). No official API.
- **Events:** `TokenCreated`, `TokenLaunched(bytes32,…)` topic `0x3b3d2baf…`.

### Clanker — Base, Robinhood, …
- `clanker-sdk/v4`, called as `new Clanker({wallet, publicClient}).deploy({...})`.
- **Config:** fees preset, `rewards.recipients` (bps sum to 10000), `vault`, `devBuy`, `sniperFees`.
- **Model:** instant single-sided v4 LP. 100B supply. LP locked.
- **Robinhood Factory:** `0xD3f2cC1731b7Fd17f28798835C2E02f0a1839A94`.
- **Event:** `TokenCreated(msgSender, tokenAddress, tokenAdmin, image, name, symbol, metadata, context, startingTick, poolHook, poolId, pairedToken, locker, mevModule, …)`.

### Trench (trench.today) — Robinhood
- **Contract:** factory/curve proxy `0x77dc6f6361b7b99456fc3761ce5b7dda80d83f9d`.
- **Events:**
  - `TokenCreate(creator, curve, token, quote, name, symbol, ts, tokenURI)`
  - `TokenPurchase` / `TokenSale` (with `extraFee`, `extraFeeReceiver`)
  - `Sync(... virtualQuote, virtualToken)`, where price = vQ/vT
- **Unknown:** create function, threshold, fees. [U] Needs ABI from the explorer.

### Dyor V3 — Robinhood, Arc, …
- **Factory:** `0x80b42aed46d73f47119dc444bea28a9e68f32bf4` (HOOD/Arc/Stable).
- **Model:** full supply as a single-sided Uniswap V3 1% position, vaulted.
- **REST API:** `images` → `metadata` → `launch/prepare {initialBuyEth}`. OpenAPI spec at `/api/arc/openapi`.

### Argus — Arc
- **Contract:** Portal v7 `0xB021Be536808f551b31789422Fd28a6c9c6e97Da` `createLaunch`.
- **Model:** USDC gas and quote. Single-sided v4 with per-launch Hook/Locker/Splitter. Fixed buy/sell tax 1–10%. 3s snipe decay.
- ⚠️ GitHub issue #3 reports that create and taxed swaps revert.

---

## 4. Terminal data & execution

### Card metrics: how competitors compute them
| Metric | How it's computed |
|---|---|
| **Snipers** | Buyers in the first N blocks/slots after open (Axiom: first block) |
| **Bundlers** | Three or more wallets buying in the same block/slot/Jito bundle |
| **Insiders** | Holders who got tokens by transfer from the dev, or wallets funded by the dev |
| **Dev %** | Creator's current balance ÷ supply |
| **Top10 %** | Exclude curve, pool and locker accounts |
| **Fresh wallets** | New wallet or low tx count, funded shortly before buying (heuristic) |
| **DS paid** | DexScreener `/orders/v1/{chain}/{token}` with type `tokenProfile` and status `approved` |
| **Dev history** | Our own index of `creator → launches / migrations` |

### Data sources
| Chain | Options |
|---|---|
| **Solana** | PumpPortal WS (free new/migration feeds; trades are paid; 1 connection max). Helius Business $499 (LaserStream). Shyft gRPC $199–649 unmetered. |
| **EVM** | Own `eth_subscribe` logs on dedicated nodes. Robinhood sequencer feed. Envio HyperSync / Goldsky for backfill. |
| **Aggregators** | **Mobula Pulse V2** has `new` / `bonding` / `bonded` views with sniper, bundler, insider, fresh, top10, DS-paid and deployer-migration fields. Nearly our whole card as a service, but launchpad coverage of Flap, Bags and Pons needs checking. **Codex** ($350+/mo) lacks Flap, Bags, LetsBonk and Pons. **Bitquery** covers Pons, Pools, Flap, Trench, Four, Bags and Heaven. |

### Execution
| Chain | Approach |
|---|---|
| **Solana** | Helius Sender or Nozomi (0.001 SOL minimum tip). Jito bundles for atomic launch + dev buy + bundle-buys. |
| **BSC** | PBS. Use the 48Club Puissant Builder `eth_sendBundle`, or bloXroute private txs. |
| **Robinhood** | FCFS with no mempool. Colocate near the sequencer; tips are useless. |

**Keys:**
- Turnkey: $0.05–0.10 per signature. Axiom uses it.
- Privy: per MAU.
- GMGN is custodial unless you connect an extension wallet.
- Self-hosted enclave keys are cheapest at scale.

---

## 5. Open questions
- Pons V2: public launch is on right now. Get whitelisted as a backstop in case they close it.
- Trench (trench.today): create ABI. Dyor: `TokenLaunched` signature. Pools: exact launch calldata.
- Mobula pricing and launchpad coverage.
- Four.meme LP burn/lock policy. Flap creation fee. Bags' Robinhood graduation threshold.
