# pump.fun — Instructions, Events, Fees & 70/30 Fee Split

_Source: `research/repos/pump-public-docs` (HEAD 8109141, 2026-09-14), pump_tech_updates Telegram #33–#44, live mainnet reads 2026-09-27. File refs are relative to that repo. **[ADMIN]** = only pump.fun authorities can call it._

**Programs**

| Program | ID |
|---|---|
| pump (bonding curve) | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` |
| pump_amm (PumpSwap) | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` |
| pump_fees | `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` |

---

## ✅ 70/30 split verdict: native, locked after the first write

- pump_fees `sharing_config` can have its shares set **exactly once**. After that `admin_revoked = true`, so the creator can never change it:
  - errors `SharingConfigAdminRevoked` 6009 and `FeeSharesAlreadyUpdated` 6024
  - `docs/instructions/CREATOR_FEE_SHARING.md:8,44`
  - Telegram #39 (2026-03-24): "locked and cannot be changed"
- **Caveat:** it is not immutable against pump.fun. Their admin `admin_cto` / `admin_cto_sharing_config` (community takeover) can reset it.
  - **Mayhem-mode coins cannot be CTO'd** (`CtoNotAllowedForMayhemCoin` 6088).
  - Watch `AdminCtoEvent` and `ResetFeeSharingConfigEvent` for alerts.
- Don't combine with holder-reward coins: their creator is the holder-rewards PDA, which can't be changed.

### Launch transaction (one atomic tx — simulate on devnet first)

| # | Instruction | Signer | Notes |
|---|---|---|---|
| 1 | `create_v2(name, symbol, uri, creator=X, is_mayhem_mode, …)` | payer + mint keypair | Token-2022 mint, 6 decimals |
| 2 | `create_fee_sharing_config` (pump_fees) | X | PDA `["sharing-config", mint]`. Rewrites `bonding_curve.creator` to the sharing_config PDA |
| 3 | `update_fee_shares_v2([{X, 7000}, {PLATFORM, 3000}])` | X | 1–10 holders, each > 0, **sum exactly 10000**. One-shot lock |
| 4 | `buy_v2` / `buy_exact_quote_in_v2` (dev buy) | X | `creator_vault` must be derived from the **sharing_config PDA**, not X. The SDK's `createV2AndBuyV2Instructions` gets this wrong for our flow |

**Enforcement:**
- Our backend builds the tx and partially signs with the mint keypair. The user signs the finished message, so they can't drop steps 2–3.
- If the buy comes before step 3, the dev-buy creator fee goes 100% to X.
- The platform shareholder must be a funded, non-executable wallet (errors 6052 and 6070).

### Claiming split fees (all permissionless, so we can crank them)
- `transfer_creator_fees_to_pump_v2` (AMM) moves post-migration creator fees into the pump creator vault.
- `distribute_creator_fees_v2(initialize_ata)` pays every shareholder pro-rata:
  - remaining accounts = shareholders **in on-chain order**, plus ATAs for non-SOL quotes;
  - `get_minimum_distributable_fee` is a read-only pre-check.
- The legacy `collect_creator_fee*` fails once a sharing config exists (`CreatorMigratedToSharingConfig`).

---

## Instruction catalog

### Create
| Instruction | Status | Args / notes |
|---|---|---|
| `create_v2` | **use** | `name`≤32, `symbol`≤13, `uri`≤200, `creator` (not a signer, not default), `is_mayhem_mode`, `is_cashback_enabled` (must be false), `creator_fee_bps` (ignored for SOL/USDC), `is_holder_reward`. Token-2022 mint. USDC pairs add remaining accounts `quote_mint`, `associated_quote_bonding_curve`, `quote_token_program`. `COIN_CREATION.md:6-47` |
| `create` | legacy | SPL + Metaplex |

### Buy
| Instruction | Program | Status | Args |
|---|---|---|---|
| `buy_v2` | pump | **use** | `amount`, `max_sol_cost`. 27 accounts; pass wSOL as `quote_mint` for SOL coins. `BUY.md:8-47` |
| `buy_exact_quote_in_v2` | pump | **use** | `spendable_quote_in`, `min_tokens_out` |
| `buy`, `buy_exact_sol_in` | pump | legacy, SOL only | `track_volume`. Need remaining accounts `bonding_curve_v2` `["bonding-curve-v2", mint]` + buyback recipient (18 accounts). `BREAKING_FEE_RECIPIENT.md:25-32` |
| `buy` | amm | use | `base_amount_out`, `max_quote_amount_in`, `track_volume` |
| `buy_exact_quote_in` | amm | use | `spendable_quote_in`, `min_base_amount_out`, `track_volume` |

- AMM remaining accounts: `pool_v2` `["pool-v2", base_mint]`, buyback fee recipient, its quote ATA (`BREAKING_FEE_RECIPIENT.md:34-45`).
- USDC-quoted coins trade **only** via the v2 instructions.

**Key buy accounts:**
- `fee_recipient` (one of 8), `buyback_fee_recipient` (one of 8 buyback recipients)
- `creator_vault` `["creator-vault", bonding_curve.creator]`
- `sharing_config`
- `user_volume_accumulator` `["user_volume_accumulator", user]`
- `fee_config` (pump_fees `["fee_config", pump_program_id]`)

### Sell
| Instruction | Program | Notes |
|---|---|---|
| `sell_v2(amount, min_sol_output)` | pump | **use**. 26 accounts. `SELL.md` |
| `sell` | pump | legacy. Same remaining accounts as legacy buy; cashback coins need `user_volume_accumulator` first |
| `sell(base_amount_in, min_quote_amount_out)` | amm | use |

### Migrate / LP
- `migrate` (legacy, wSOL) and `migrate_v2` (quote-aware): permissionless and idempotent. They create the canonical pool: index 0, creator = `["pool-authority", mint]` (`PUMP_PROGRAM_README.md:196-199`). LP is burned. 0.015 SOL fee.
- AMM: `create_pool`, `deposit`, `withdraw`.

### Creator fees
| Instruction | When | Notes |
|---|---|---|
| `collect_creator_fee_v2` (pump) | no sharing config | Permissionless; pays the creator wallet or ATA |
| `collect_coin_creator_fee` (amm) | no sharing config | Permissionless; destination ATA must exist |
| `transfer_creator_fees_to_pump_v2` (amm) | sharing config | AMM vault → pump vault |
| `distribute_creator_fees_v2` (pump) | sharing config | Pro-rata payout |
| v1 variants | legacy | SOL only |

### Fee sharing (pump_fees)
- `create_fee_sharing_config`
- `update_fee_shares_v2(Vec<{address, share_bps:u16}>)`, one-shot (v1 is wSOL only)
- `revoke_fee_sharing_authority` and `transfer_fee_sharing_authority` are **dead** (no accounts in the IDL, `idl/pump_fees.json:2065`)
- `create_social_fee_pda(user_id, platform)` is callable by us. Claiming needs `social_claim_authority` **[ADMIN]**. GitHub organizations are unsupported and funds can be lost.

### Other user-callable
- Volume incentives: `init_user_volume_accumulator`, `sync_user_volume_accumulator`, `close_user_volume_accumulator`, `claim_token_incentives` (both programs)
- Cashback: `claim_cashback` / `claim_cashback_v2` (deprecated for new coins)
- Misc: `extend_account`, `set_metaplex_creator`, `set_coin_creator` (amm), `get_fees`, `get_fees_with_quote_mint`, `create_donation_fee_pda`, `crank_donation_fee_pda`, `initialize_buyback`
- Undocumented: `init_boost` and `boost_buy_and_burn` (amm)

### Admin-only (cannot call)
- **pump:**
  - `initialize`, `set_params`, `update_global_authority`, `set_creator`
  - **`admin_cto`**
  - quote-mint and quote-control management, `set_virtual_quote_reserves`
  - `toggle_create_v2`, `toggle_cashback_enabled`, `toggle_mayhem_mode`
  - buyback, creator-fee and holder-reward config
  - `set_reserved_fee_recipients`
  - `distribute_fee_to_holders`
- **amm:**
  - `create_config`, `update_fee_config`, `update_admin`, `disable`
  - **`admin_cto_pool`**
  - boost and toggle instructions, buyback/creator-fee config
- **pump_fees:**
  - fee config and tiers, stable tiers, exotic flat fees
  - authorities, claim rate limits, disable flags
  - buyback sweeps
  - **`admin_cto_sharing_config`** (reached only via CPI from `admin_cto`)

---

## Events to index

| Event | Use | Key fields |
|---|---|---|
| `CreateEvent` | New column | name, symbol, uri, mint, bonding_curve, user, creator, reserves, token_program, is_mayhem_mode, quote_mint, creator_fee_bps, is_holder_reward |
| `TradeEvent` | Trades (curve) | mint, sol_amount, token_amount, is_buy, user, reserves (incl. virtual/real quote), fee / creator_fee / buyback_fee / cashback / holder_rewards, **shareholders**, mayhem_mode, ix_name |
| `CompleteEvent` | Curve done | mint, bonding_curve, quote_mint |
| `CompletePumpAmmMigrationEvent` | Migrated column | mint, pool, mint_amount, sol_amount, pool_migration_fee |
| AMM `BuyEvent` / `SellEvent` | Trades (post-migration) | amounts, reserves, lp / protocol / coin_creator fees, **virtual_quote_reserves (i128)** |
| `CreatePoolEvent` | Pool creation | coin_creator, creator_fee_bps, can_edit_creator_fee |
| `CollectCreatorFeeEvent`, `CollectCoinCreatorFeeEvent`, `DistributeCreatorFeesEvent` | Fee claims | — |
| `CreateFeeSharingConfigEvent`, `UpdateFeeSharesEvent` | Split set | — |
| **`AdminCtoEvent`, `AdminCtoPoolEvent`, `ResetFeeSharingConfigEvent`** | ⚠️ Alert: our split was reset | — |
| `SetCreatorEvent`, `MigrateBondingCurveCreatorEvent`, `MigratePoolCoinCreatorEvent` | Creator changes | — |

---

## Fees (live FeeConfig, 2026-09-27)

- **Bonding curve:** 1.25% flat = protocol 0.95% + creator 0.30%. Creator fees accrue in pump PDA `["creator-vault", creator]`.
- **PumpSwap canonical pools**, tiered by market cap:

| Market cap (SOL) | LP / protocol / creator (bps) | Total |
|---|---|---|
| < 420 | 2 / 93 / 30 | 1.25% |
| 420 | 20 / 5 / 95 | 1.20% |
| 1,470 | 20 / 5 / 90 | 1.15% |
| Each later tier | creator drops ~5 bps | — |
| ≥ 98,240 | 20 / 5 / 5 | 0.30% |

- **Other pools:** USDC pools use USD tiers ($59k → $20M). Non-canonical pools are 25 / 5 / 0.
- **AMM creator vault:** `["creator_vault", pool.coin_creator]` (quote ATA).
- **Fee recipients:** 24 in total (8 normal, 8 mayhem-reserved, 8 buyback), listed in `docs/FEE_RECIPIENTS.md`.

**Our cut per trade:**
- On the curve our 30% share = 30% × 0.30% = **0.09% of volume**.
- Just after migration (420 SOL tier) it's 30% × 0.95% = **0.285%**.

---

## Gotchas
- **Never cache the creator.** The vault PDA changes when a sharing config is created and on CTO (Telegram #33).
- **PumpSwap pricing:** quote reserves = vault + `Pool.virtual_quote_reserves`. Non-zero since 2026-07-21, even though the repo README still says 0.
- **Field renames:** curve fields `*_sol_reserves` are now `*_quote_reserves`. `quote_mint` is default for SOL coins, but pass wSOL as the account.
- **Account formats:** old accounts are shorter, so zero-pad when decoding (`CPI_README.md:69-74`). `create_v2` mints are Token-2022; legacy mints are SPL.
- **Compute and slippage:** a plain trade needs about 100k CU, but `create_v2` needs 100–111k and **150–176k in Mayhem mode** (measured 2026-09-28; a 150k limit fails Mayhem launches). Fee-sharing setup is ~175k, the dev buy (ATA + `buy_exact_quote_in_v2`) ~115k. Fees are tiered by market cap, so read the live FeeConfig for slippage math.
- **Distribution minimum:** `distribute_creator_fees_v2` is a no-op ("Insufficient fees for distribution") until the creator vault holds ~3.86M lamports; shareholders don't need to exist beforehand.
- **Metadata:** `pump.fun/api/ipfs` is dead. Upload to Pinata or our own IPFS.
