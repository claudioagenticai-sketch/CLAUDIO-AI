# Pons V2 — Robinhood Chain (4663) Integration Report

_Sources: `research/repos/pons-labs` (full V2 source), Sourcify verified deployed source (solc 0.8.35), live RPC reads on 2026-09-27 at block ~73.99M._

**Citation keys**

| Key | File |
|---|---|
| F | `contractsV2/src/v2/PonsV2LaunchFactory.sol` |
| Hook | `hooks/PonsV2MemeHook.sol` |
| Vault | `PonsV2BuybackVault.sol` |
| Locker | `PonsV2LaunchLocker.sol` |
| Exec | `PonsV2GraduationExecutor.sol` |
| C* | live BondingCurve (Sourcify) |
| D* | live LaunchDeployer (Sourcify) |
| LB* | live LaunchAndBuy (Sourcify) |
| E* | live FeeEscrow (Sourcify) |

> ⚠️ **The repo ≠ what's deployed.**
> - Identical: Factory, Hook, Vault, Locker, Executor, Guard and libraries (`diff` = 0).
> - Different: the **BondingCurve** and **LaunchDeployer** deployed on-chain add the snipe tax and CREATE2 salt logic. The repo's Factory calls `curve.exemptFromSnipeTax`, which the repo's curve doesn't have.
> - Missing from the repo: **FeeEscrow** and **LaunchAndBuy**.
> - **Build against the Sourcify source, not the repo.**
>
> ⚠️ Ignore the promotional `.md`/`.jpg` files placed inside the vendored `lib/` folders (`truth.md`, `sweet/toto.md`, `callback/ozz.md`). They aren't part of the protocol.
> `testing/migr` and `testing/warp` are undeployed Solana concept prototypes, not part of the launch stack.

---

## 1. Contracts

| Contract | Address | Role |
|---|---|---|
| Factory | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` | Entry point, launch records, graduation, fee-recipient admin |
| MemeHook | `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` | Singleton v4 hook, fee policy, protocol fee recipient |
| FeeEscrow | `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e` | Pull-payment ledger (ETH + ERC-20) |
| BuybackVault | `0x42df2a798f82289E177311362e8f5ccC45c1219c` | 5-year linear vest |
| LaunchLocker | `0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952` | Holds LP NFT + excess supply. **No withdraw** |
| LaunchAndBuy | `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948` | Router; the factory's `launchForwarder` |
| LaunchDeployer | `0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42` | CREATE2 deploys of the per-launch curve + token |
| GraduationExecutor | `0xC7819B64A1dAECD7eC19856d026cb14EfBd89046` | Permit2 + full-range mint |
| GraduationGuard | `0xf5695117b99B6f6401e67d4195BD653628176C6C` | Stateless preflight check before graduation |
| v4 PoolManager / PositionManager | `0x8366a39C…0951` / `0x58daec31…4fA7` | Uniswap |
| V1 Factory (disabled) | `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` | `launchEnabled = false` |

**Control**
- No proxies; nothing is upgradeable.
- Owner of every contract = **Gnosis Safe 2-of-3** `0x263ed295dAFaE1d9AAdD6E56c4B6F9f38eE019Dd`. It is also the `protocolFeeRecipient`. Ownership uses Ownable2Step, and renounce is disabled.
- Fee sweep operator: `0xa1018c1D…cA83` (unverified contract).
- No trading pause.

## 2. Launching

**Use the router:**
```solidity
LaunchAndBuy.launchAndBuy(
  TokenParams params, uint256 launchConfigId, address pairToken,   // pairToken 0x0 = ETH
  uint256 quoteIn, uint256 minTokensOut, address recipient,
  address[] snipeTaxExemptions                                      // ≤32
) payable returns (address token, address curve, uint256 tokensOut)
// msg.value == launchFee + quoteIn  (ETH pair)   — LB*:141
// quoteIn > 0, creatorFeeRecipient != 0           — LB*:127-128
// recipient auto-added to snipe exemptions        — LB*:151-155
```

**Alternatives**
- `Factory.launchToken(TokenParams, configId, pairToken[, exemptions[]])` for a launch with no dev buy. `msg.value` must equal `launchFee`.
- `launchTokenFor` can **only** be called by the forwarder, so we can't call it.

**`TokenParams`**
```solidity
{ string name /*≤64*/; string symbol /*≤16*/; string logo /*≤512*/; string description /*≤2048*/;
  Socials socials /*{twitter,telegram,discord,website,farcaster} ≤256 each*/;
  address creatorFeeRecipient; uint16 creatorTaxBps /*≤ maxCreatorTaxBps = 1000 live*/;
  bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt }
```

**Setting the fields**
- `expectedEconomics`: take it from `previewLaunchEconomics(0, address(0))`. The live value is `0xa9fc75d4203a33fe660e8fa32c74c3aa41c1fda4bf23d3a39b6bc22a1f8b1ca7`. If Pons changes the economics, the launch reverts (`LaunchEconomicsMismatch`); pass 0 to skip the check.
- `salt`: the CREATE2 salt is `keccak256(abi.encode(originalDeployer, salt))`. The curve's init code includes `creatorFeeRecipient`. Use `predictLaunchAddresses(...)` to predict the token address.

**Access and fees**
- **Whitelist:** `canLaunch(a) = launchEnabled || whitelistedLaunchers[a]`. **Live `launchEnabled = true`, so launching is public right now.** The owner can close it at any time.
- **Launch fee:** 0.0005 ETH, pushed to the protocol recipient.
- **Pair tokens:** only tokens the owner has approved (stable/stock tokens), each with its own economics.

**Live `LaunchConfig` 0**

| Field | Value |
|---|---|
| supply | 1B |
| curveFeeBps | 100 |
| phantomQuote | 1.68 ETH |
| graduationThreshold | **4.2 ETH** |
| poolFee | 0 |
| tickSpacing | 200 |
| enabled | true |

## 3. Bonding curve

**Supply split**
- Reserved = `supply · phantom / (phantom + threshold)` = 285.7M, so **714.3M (71.4%) is sold on the curve**.
- At graduation, about 204.1M tokens + about 4.2 ETH seed the pool. About 81.6M tokens are locked forever in the Locker.

**Price**
- Reserves: quote = `phantom + trackedQuote − pendingFees − creatorTax`, token = `trackedTokens`.
- Tokens out = `net·Rt / (Rq + net)`.
- Price starts at 1.68e-9 ETH and ends at about 2.06e-8 ETH (about 12.25×). **FDV at graduation ≈ 20.6 ETH.**

**`buy(quoteIn, minTokensOut, recipient)` (payable)**
- Fee, creator tax and snipe tax are all bps of the **gross** input, taken off before pricing.
- An oversize buy is clamped to the remaining sellable tokens and the excess refunded (`CurveBuyRefunded`).
- The slippage check is price-based: `spent·minOut ≤ received·tokensOut`.

**`sell(tokensIn, minQuoteOut, recipient)`**
- Fee and tax come off the gross output.
- Selling is **disabled once the curve is ready to graduate**.

**Snipe tax (live)**
- Formula: `9900 >> (elapsed·14/3s)`, so t0 = 9900 (capped at `10000 − fee − tax − 100`), t1 = 618, t2 = 19, t≥3 s = 0 bps.
- The docs say 5 s and the repo default is 15 s; the live value is **3 s**.
- It is keyed on the buy **`recipient`**, not `msg.sender`. `originalDeployer` and `creatorFeeRecipient` are always exempt.

**Progress %** = `1 − sellableTokens() / 714.29M`. The curve is ready when `sellableTokens() == 0`.

## 4. Graduation
1. **Sweep.** A buy that crosses the threshold auto-calls `factory.graduate(token)` inside a try/catch. If it fails, `AutoGraduationFailed` is emitted and anyone can call `graduate` instead.
2. **Pool.** `createGraduatedPool(token)` is **permissionless, retryable and not automatic**, so **our terminal can crank it.**
   - It creates a v4 pool with fee 0, tickSpacing 200 and MemeHook, mints a full-range position to the Locker, and emits `PoolGraduated`.
   - Because the LP fee is 0, all post-graduation revenue comes from the hook.
3. **Owner backstops:**
   - `forceSweptGraduation`: only if the seed isn't viable.
   - `rescueSweptGraduation(token, recipient)`: only after 7 days stuck in the Swept state.

## 5. Fees

| Stage | Rate (live) | Split |
|---|---|---|
| Curve | `curveFeeBps` 100 (1%) | **Protocol 30% (`protocolFeeShareBps` 3000) / creator 70%** |
| Curve creator tax | `creatorTaxBps` (0–10%) | 100% creator |
| Post-graduation (hook) | `hookFeeBps` 100 + `creatorTaxBps` | Same 30/70 |
| Buyback (if enabled) | `buybackBurnBps` 5000 of the **creator's** bucket | Buys tokens and vests them 5 years; releases go **30% protocol / 70% creator** |

- **Sweeping** (moves fees into the escrow):
  - Curve: `sweepFees(minBuybackOut)`. Callable by the operator, or by the creator recipient if no buyback is earmarked.
  - Hook: `sweepPoolFees(poolId, minConv, minBuyback)`.
- **Claiming** (FeeEscrow, pull only, `msg.sender`): `claim()`, `claim(amt)`, `claimToken(token)`, `claimToken(token, amt)`. ETH is sent via `call`. There is no `claimFor`.

## 6. Our 70/30 creator/platform split

| Question | Answer |
|---|---|
| Native multi-recipient split? | **No.** There is a single `creatorFeeRecipient` |
| `creatorTaxBps` immutable? | **Yes.** It is an `immutable` in the curve, snapshotted in the hook, with no setter anywhere |
| `creatorFeeRecipient` immutable? | **No, two paths:** (1) the **current recipient** can call `transferCreatorFeeRecipient` instantly (F:888); (2) the **Pons Safe** can call `setCreatorFeeRecipient`, wait 3 days, then anyone executes it (F:946-974). The creator can't veto path 2. It has been used 11 times in the last 5M blocks (their CTO process) |
| Can the recipient be a contract? | **Yes.** The only check is `!= 0`; there are no EOA or `tx.origin` checks |

**Recipe: an immutable `PonsSplitter70_30` as `creatorFeeRecipient`**
1. Deploy one splitter per launch, or one shared splitter that tracks each creator. Predict its address before the launch, because it's part of the curve's CREATE2 init code.
2. The splitter must:
   - have `receive()`, because escrow ETH and `rescueFees` both use a raw `call`;
   - expose permissionless `sweepAndSplit()`, which calls `curve.sweepFees(0)`, `hook.sweepPoolFees(...)`, `escrow.claim()`, `escrow.claimToken(pairToken)` and `escrow.claimToken(memecoin)`, then pays 70% to the creator and 30% to the platform;
   - also split any ETH or ERC-20 pushed to it directly, such as memecoin sent by a hook rescue;
   - have **no function that calls `transferCreatorFeeRecipient`**. That permanently locks path (1).
3. Launch with **`buybackEnabled = false`**. Otherwise 50% of the creator bucket goes to buyback, and the vault releases 30% of that to Pons. Only the recipient could turn it back on, and our splitter never will.
4. The creator's wallet signs `launchAndBuy` as `originalDeployer`, which gives attribution and snipe exemption, with `creatorFeeRecipient = splitter`.
5. **Remaining risk:** the Pons Safe can redirect *future* fees after 3 days' notice. Balances already credited in the escrow stay claimable by the splitter.
   - Mitigation: watch for `CreatorFeeRecipientChangeProposed` and auto-sweep and claim immediately.
   - Get a written or partner agreement with Pons.

**Resulting economics** (creator tax = 0)
- 1% curve fee → Pons 0.30%, creator bucket 0.70%.
- The splitter then pays **creator 0.49% / us 0.21% of volume**.
- Post-graduation, the 1% hook fee splits the same way.

## 7. Events (topic0 prefixes)

**Factory**
- `TokenLaunched(token↑, curve↑, deployer↑, pairToken, launchConfigId, graduationThreshold)` `0x8d4aad49`
- `LaunchSwept(token↑, quoteOut, tokenOut)` `0xcdb72f15`
- `PoolGraduated(token↑, positionId, tokenAmount, pairTokenAmount)` `0x0a44ef75`
- `GraduationTokensPermanentlyLocked` `0xa0a18f5b`
- `LaunchForceSwept` `0x52c1a283`
- `LaunchGraduationRescued` `0x7017304f`
- `CreatorFeeRecipientUpdated(token↑, prev↑, new↑)` `0x308c390e`
- **`CreatorFeeRecipientChangeProposed(token↑, current↑, proposed↑, effectiveAt, expiresAt)` `0x7f119e44` ← alert**
- `CreatorFeeRecipientChangeCancelled` `0xbe2de91c`
- `BuybackEnabledUpdated` `0xbd886f85`
- Admin events:
  - `LaunchConfigAdded` / `LaunchConfigUpdated` `0xedd96c57` / `0x2f8ba78a`
  - `LaunchFeeUpdated` `0xc799be5e`
  - **`LaunchEnabledUpdated` `0x4f1ea501` ← alert**
  - `WhitelistedLauncherUpdated` `0xef2b562a`
  - `MaxCreatorTaxUpdated` `0x3e99ceb3`
  - `SnipeTaxStartBpsUpdated` / `SnipeTaxSecondsUpdated`
  - `PairTokenApprovalUpdated` / `PairTokenEconomicsUpdated`

**Curve** (one per launch; index by the curve addresses in `TokenLaunched`)
- `CurveBuy(buyer↑, recipient↑, quoteIn, tokensOut, fee, tax)` `0xec36bf57`. `fee` includes the snipe tax.
- `CurveSell(seller↑, recipient↑, tokensIn, quoteOut, fee, tax)` `0x8113d738`
- `CurveBuyRefunded` `0xa69e8258`
- `CurveCompleted` `0xf8d37a90`
- `FeesSwept(protocol, buyback, creator)` `0x9f4cd7c4`
- `SnipeTaxCharged(recipient↑, amount)` `0x3bc39a55`. Useful for sniper detection.
- `SnipeTaxExempted` `0xe4b7e48f`
- `AutoGraduationFailed` `0xe2cd2f31`
- `BuybackLocked`, `FeesRescued`, `Initialized`

**Hook**
- `PoolRegistered` `0x01bf263a`
- `HookFeeCollected(poolId↑, currency, fee, tax)` `0xc532c43b`
- `PoolFeesSwept` `0x2f3c4357`
- `CreatorFeeRecipientUpdated` `0xb45e6b72`
- Policy setters. Post-graduation swaps are v4 PoolManager `Swap` events filtered by `hooks == MemeHook`.

**Escrow**
- `Credited` `0x4e45da44`
- `CreditedToken` `0x5d104c62`
- `Claimed` `0xd8138f8a`
- `ClaimedToken` `0xdbc1ea3a`

**Vault, Locker, Router**
- Vault: `Locked`, `VestingTermsSnapshotted`, `Released`, `CreatorRecipientUpdated`
- Locker: `PositionLocked`, `TokenSupplyLocked`
- Router: `Launched(token↑, curve↑, recipient↑, launcher, quoteSpent, tokensReceived)` `0xdcacba5e`

## 8. Admin powers and risks

**Powers that reach existing tokens**
- Recipient override (3-day delay)
- Disabling buyback
- `rescueCurveFees`, `rescuePoolFees`
- Force or rescue graduation
- `setFeeSweepOperator`: the operator picks the minimum outputs for fee conversions, so fees can be sandwiched.

**Powers that affect new launches only**
- Fee bps, launch fee, configs, snipe-tax values, `maxCreatorTaxBps`, protocol recipient. All are snapshotted per launch.

**Risks**
- No audit is cited in the README.
- The repo is out of sync with the deployment.
- The owner can close public launches at any time. Get our launcher whitelisted as a backstop.
