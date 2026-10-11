// Launchpad registry — single source of truth for UI chips, indexers and launch adapters.
// Every address/number here comes from research/*.md and MUST be re-verified on-chain before mainnet use.
// Fields marked `live: true` in `readLive` are read from chain at runtime rather than trusted from here.

import type { ChainId } from "./chains";

export type LaunchpadId =
  | "pump" | "bonk" | "bags" | "heaven" | "stonkfun"      // Solana
  | "four" | "flap" | "genius"                            // BSC
  | "pons" | "pools" | "clanker" | "trench" | "dyor"      // Robinhood (+ bags, flap, clanker)
  | "argus";                                              // Arc

/** Bonding curve → migrate, vs full supply straight into a pool. */
export type LaunchModel = "curve" | "instant";

/**
 * How our 70/30 creator/platform rule is enforced.
 *  native-locked   — launchpad splits natively; creator can't change it
 *  native-mutable  — native split, but platform admin can override
 *  splitter        — single recipient; we point it at our immutable FeeSplitter
 *  splitter-weak   — splitter works vs creator, platform admin can reassign recipient
 *  none            — can't enforce (custodial / no creator fee)
 */
export type SplitSupport = "native-locked" | "native-mutable" | "splitter" | "splitter-weak" | "none";

export type AdapterStatus = "live" | "beta" | "planned" | "blocked";

export interface LaunchpadDeployment {
  chain: ChainId;
  /** Contract/program addresses keyed by role. */
  contracts: Record<string, string>;
  /** Native quote graduation threshold (human units of chain native), if curve. */
  graduationQuote?: number;
  /** Synthetic milestone for instant pools (USD FDV or native), shown as "bonding %". */
  milestone?: { unit: "usd-fdv" | "native-liquidity" | "usd-mcap"; value: number };
  totalSupply: number;
  /** Share of supply sold on the curve (0–1). */
  curveSupplyShare?: number;
  migratesTo?: string;
  vanitySuffix?: string;
  launchFeeNative?: number;
  /** Trade fee in bps on the curve / post-migration. */
  curveFeeBps?: number;
  poolFeeBps?: number;
  /** Creator's share of the fee, bps of volume (before our 70/30). */
  creatorFeeBpsOfVolume?: number;
  /**
   * Creator fee after graduation when it differs from the curve (pump.fun → PumpSwap canonical pools are tiered by
   * market cap). `creatorBps` is bps of volume from `mcapSol` upward (until the next tier).
   */
  postGradCreatorFee?: { note: string; tiers: { mcapSol: number; creatorBps: number }[] };
  /** Anti-snipe: tax start bps and decay window seconds. */
  snipeTax?: { startBps: number; windowSec: number };
  quoteTokens: string[];
}

export interface LaunchpadInfo {
  id: LaunchpadId;
  name: string;
  site: string;
  model: LaunchModel;
  deployments: LaunchpadDeployment[];
  /** Tax (transfer tax) tokens supported. */
  tax: { supported: boolean; maxBps?: number; asymmetric?: boolean; note?: string };
  split: SplitSupport;
  splitNote: string;
  adapter: AdapterStatus;
  /** Integration path summary for devs. */
  integration: string;
  /** Risks/gotchas surfaced in the launch UI. */
  warnings: string[];
  /** Brand color for chips/badges. */
  color: string;
  /** Emoji fallback icon (real SVGs live in client/src/assets/launchpads). */
  glyph: string;
}

export const LAUNCHPADS: Record<LaunchpadId, LaunchpadInfo> = {
  pump: {
    id: "pump", name: "Pump", site: "https://pump.fun", model: "curve", color: "#53d38a", glyph: "💊",
    deployments: [{
      chain: "sol",
      contracts: {
        program: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
        amm: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
        fees: "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
        global: "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf",
      },
      graduationQuote: 85, totalSupply: 1e9, curveSupplyShare: 0.7931, migratesTo: "PumpSwap (LP burned)",
      vanitySuffix: "pump", launchFeeNative: 0, curveFeeBps: 125, poolFeeBps: 125, creatorFeeBpsOfVolume: 30,
      // research/pumpfun.md "Fees" (live FeeConfig 2026-09-27): PumpSwap canonical SOL pools, LP/protocol/creator by mcap.
      postGradCreatorFee: {
        note: "PumpSwap canonical pool creator fee, tiered by market cap (≈5 bps lower per tier after 1,470 SOL).",
        tiers: [
          { mcapSol: 0, creatorBps: 30 },
          { mcapSol: 420, creatorBps: 95 },
          { mcapSol: 1_470, creatorBps: 90 },
          { mcapSol: 98_240, creatorBps: 5 },
        ],
      },
      quoteTokens: ["SOL", "USDC"],
    }],
    tax: { supported: false },
    split: "native-locked",
    splitNote: "create_v2 + create_fee_sharing_config + update_fee_shares_v2 [7000/3000] + dev buy in one transaction; shares locked once (admin revoked). pump.fun's CTO process can reset it (not Mayhem coins). Payouts via the permissionless distribute_creator_fees_v2.",
    adapter: "beta",
    integration: "Manual ixs (create_v2 + pump_fees) or @pump-fun/pump-sdk. Metadata → own IPFS (pump.fun/api/ipfs is dead).",
    warnings: ["pump.fun admin 'CTO' can reset the fee split (except Mayhem coins)."],
  },
  bonk: {
    id: "bonk", name: "Bonk", site: "https://bonk.fun", model: "curve", color: "#f7931a", glyph: "🐕",
    deployments: [{
      chain: "sol",
      contracts: {
        program: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
        cpmm: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
        platformConfig: "FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1",
      },
      graduationQuote: 85, totalSupply: 1e9, curveSupplyShare: 0.7931, migratesTo: "Raydium CPMM",
      // research/launchpads.md: Bonk "Classic" launches pay 0% creator fee since Jan 2026.
      vanitySuffix: "bonk", curveFeeBps: 100, creatorFeeBpsOfVolume: 0, quoteTokens: ["SOL", "USD1"],
    }],
    tax: { supported: true, maxBps: 1000, note: "Token-2022 TransferFee via InitializeWithToken2022" },
    split: "splitter",
    splitNote: "Creator is fixed at launch → set creator = our splitter PDA. Better: our own LaunchLab PlatformConfig (creator 0.35% / platform 0.15%).",
    adapter: "planned",
    integration: "@raydium-io/raydium-sdk-v2 launchpad.createLaunchpad with bonk platformId (buyAmount must be > 0).",
    warnings: ["Bonk 'Classic' launches pay 0% creator fee since Jan 2026."],
  },
  bags: {
    id: "bags", name: "Bags", site: "https://bags.fm", model: "curve", color: "#22c55e", glyph: "💰",
    deployments: [
      {
        chain: "sol",
        contracts: {
          dbc: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
          dammV2: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
          feeShareV2: "FEE2tBhCKAt7shrod19QttSVREUYPiyMzoku1mL1gqVK",
        },
        graduationQuote: 85, totalSupply: 1e9, migratesTo: "Meteora DAMM v2", vanitySuffix: "BAGS",
        curveFeeBps: 200, poolFeeBps: 200, creatorFeeBpsOfVolume: 100, quoteTokens: ["SOL"],
      },
      {
        chain: "hood",
        contracts: {
          factory: "0xe8Cc4431adF8b5A847C113EF0c6af9043219Cb37",
          lens: "0xC82Db941dAf90B754aecb5F7D14c683dc608d595",
          hook: "0x2380aBf72C17aABAb76480244759AC7E2932EEcC",
          vault: "0x4861446aa7fFd9e67a83cBbAcb1A4B70540B83Aa",
        },
        totalSupply: 1e9, curveSupplyShare: 0.83, migratesTo: "Uniswap v4 (locked)", launchFeeNative: 0, graduationQuote: 5,
        curveFeeBps: 200, poolFeeBps: 200, creatorFeeBpsOfVolume: 100, quoteTokens: ["ETH"],
      },
    ],
    tax: { supported: false },
    split: "native-mutable",
    splitNote: "Native claimers[]/bps (≤100) on both chains; the creator can't change them, but Bags' admin can (Solana: program admin; Robinhood: owner EOA via setClaimers / beacon upgrades). Robinhood: claimers = [Claudio FeeSplitter] 100% (70/30 on claim), partner = Claudio treasury (25% of Bags' half). Solana: not integrated yet.",
    adapter: "beta",
    integration: "SOL: REST public-api-v2.bags.fm (API key) + @bagsfm/bags-sdk. HOOD (beta, server/launch/adapters/bags.ts): BagsFactory.create/createAndBuy(name,symbol,uri,partner,claimers[],bps[]) — no API key, creationFee 0.",
    warnings: ["HOOD post-migration swaps require Bags' modified UniversalRouter.", "Bags admin can rewrite claimers."],
  },
  heaven: {
    id: "heaven", name: "Heaven", site: "https://heaven.xyz", model: "instant", color: "#e5e7eb", glyph: "☁️",
    deployments: [{
      chain: "sol",
      contracts: { program: "HEAVENoP2qxoeuF8Dj2oT1GHEnu49U5mJYkdeC8BAX2o" },
      milestone: { unit: "usd-mcap", value: 100_000 }, totalSupply: 1e9, quoteTokens: ["SOL"],
      curveFeeBps: 100, creatorFeeBpsOfVolume: 100,
    }],
    tax: { supported: false, note: "Pro pools have reflection/slot fees (undocumented)" },
    split: "splitter-weak",
    splitNote: "Single fee receiver; set to our splitter PDA. Heaven admin can override & reclassify creator fees.",
    adapter: "planned",
    integration: "POST tx.api.heaven.xyz/tx/create-standard-liquidity-pool → unsigned tx (mint+pool+buy).",
    warnings: ["Creator fee subject to Heaven review (1% / 0.1% / blocked)."],
  },
  stonkfun: {
    id: "stonkfun", name: "Stonkfun", site: "https://stonkfun.xyz", model: "curve", color: "#14b8a6", glyph: "📈",
    deployments: [{
      chain: "sol",
      contracts: { program: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj" },
      totalSupply: 1e9, migratesTo: "Raydium CPMM", quoteTokens: ["SOL", "xStocks"],
    }],
    tax: { supported: true, maxBps: 300, note: "Token-2022 1–3% reward tax" },
    split: "none",
    splitNote: "Creator share forwarded off-chain by Stonkfun (custodial). Can't enforce 70/30.",
    adapter: "blocked",
    integration: "Public API stonkfun.xyz/api/public/v1/launches/prepare.",
    warnings: ["Custodial fee forwarding — not compatible with our locked split."],
  },
  four: {
    id: "four", name: "Four", site: "https://four.meme", model: "curve", color: "#58d68d", glyph: "🍀",
    deployments: [{
      chain: "bsc",
      contracts: {
        tokenManager2: "0x5c952063c7fc8610FFDB798152D69F0B9550762b",
        tokenManagerV1: "0xEC4549caDcE5DA21Df6E6422d448034B5233bFbC",
        helper3: "0xF251F83e40a78868FcfA3FA4599Dad6494E46034",
        openFourRegistry: "0x912CEf0C3aE9Ab6eB3Ec87cab69371cFb317Ab94",
      },
      graduationQuote: 18, totalSupply: 1e9, curveSupplyShare: 0.8, migratesTo: "PancakeSwap",
      // Non-tax tokens have no creator fee (research/launchpads.md); tax tokens pay the tax instead.
      curveFeeBps: 100, creatorFeeBpsOfVolume: 0, quoteTokens: ["BNB", "USDT", "USD1", "bStocks"],
    }],
    tax: { supported: true, maxBps: 1000, asymmetric: true, note: "Types 5/8/9; burn/dividend/LP/recipient buckets; persists on Pancake V2" },
    split: "splitter",
    splitNote: "Tax tokens only: recipientAddress (immutable) = our splitter. Non-tax tokens have no creator fee. Contract delivery untested.",
    adapter: "planned",
    integration: "API login (signed nonce) → upload → /v1/private/token/create → TokenManager2.createToken(args, sig). Server signature required.",
    warnings: ["Graduation: docs 24 BNB vs live config 18 BNB — read /v1/public/config.", "Requires Four.meme backend signature."],
  },
  flap: {
    id: "flap", name: "Flap", site: "https://flap.sh", model: "curve", color: "#8b5cf6", glyph: "🦋",
    deployments: [
      {
        chain: "bsc",
        contracts: {
          portal: "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0",
          vaultPortal: "0x90497450f2a706f1951b5bdda52B4E5d16f34C06",
          splitVaultFactory: "0xfab75Dc774cB9B38b91749B8833360B46a52345F",
          taxV3Impl: "0x024f18294970B5c76c0691b87f138A0317156422",
        },
        graduationQuote: 16, totalSupply: 1e9, curveSupplyShare: 0.8, migratesTo: "PancakeSwap V2/V3",
        vanitySuffix: "7777", curveFeeBps: 100, quoteTokens: ["BNB", "USD1", "lisUSD", "USDT"],
      },
      {
        chain: "hood",
        contracts: {
          portal: "0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09",
          vaultPortal: "0xe9F7AB7DE8FB8756acbB6a1cd13316a43308197B",
          taxV3Impl: "0x7777C8743C88B3aff3cf262135beF2c8b2e83333",
          standardImpl: "0x88882688a067FE97E11C2185b996286e53132222",
        },
        graduationQuote: 5, totalSupply: 1e9, curveSupplyShare: 0.8, migratesTo: "Uniswap V2",
        vanitySuffix: "7777", curveFeeBps: 100, quoteTokens: ["ETH"],
      },
    ],
    tax: { supported: true, maxBps: 1000, asymmetric: true, note: "Tax V3: buy/sell bps, mkt/burn/dividend/LP buckets, taxDuration" },
    split: "native-mutable",
    splitNote: "Tax V3 beneficiary (marketAddress, 100% of the market bucket) = Claudio FeeSplitter. Flap admin roles (setTokenBeneficiary / updateTaxTokenAddresses) can rewire; the creator can't. commissionReceiver ≤6% for integrators (unused).",
    adapter: "beta",
    integration: "Pin Flap-format meta JSON (bare CID) → mine CREATE2 salt (7777) → Portal.newTokenV6(TOKEN_TAXED_V3). No server signature. HOOD beta: server/launch/adapters/flap.ts.",
    warnings: ["Robinhood Chain: tax tokens only — non-tax launches revert (FeatureDisabled).", "SplitVault factory confirmed on BSC only."],
  },
  genius: {
    id: "genius", name: "Genius", site: "https://genius.fun", model: "curve", color: "#c084fc", glyph: "🧠",
    deployments: [{
      chain: "bsc",
      contracts: {
        factory: "0x37eE8AeE29C5efd3C1A7edA6dF3F510779928a37",
        launchAndBuy: "0xd8b71b46498A36A4607EAb5C735BeE1DAb7F263d",
        memeHook: "0x8E6f8eBbD62B60085B703C40B460daE802eDC51b",
        feeEscrow: "0xc2F95799285109d076275A1ee298849A6fbd611a",
        locker: "0x9109522FF8125394EDB44B8Eeb87AD946D893194",
      },
      graduationQuote: 15, totalSupply: 1e9, migratesTo: "v4-style pool (locked)", vanitySuffix: "6666",
      launchFeeNative: 0.002, curveFeeBps: 200, poolFeeBps: 200, creatorFeeBpsOfVolume: 25,
      quoteTokens: ["BNB", "USDT", "USDC", "bStocks"],
    }],
    tax: { supported: true, maxBps: 1000 },
    split: "splitter-weak",
    splitNote: "Pons V2 fork: creatorFeeRecipient = our splitter. Recipient transferable + owner Safe override (3-day).",
    adapter: "planned",
    integration: "Same adapter as Pons V2 (LaunchAndBuy.launchAndBuy) with Genius addresses + toFoundation flag.",
    warnings: ["Owner can redirect creator fees after 3-day notice."],
  },
  pons: {
    id: "pons", name: "Pons V2", site: "https://ponsfamily.com", model: "curve", color: "#60a5fa", glyph: "🅿️",
    deployments: [{
      chain: "hood",
      contracts: {
        factory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
        launchAndBuy: "0xe33E9E479dF8802cb0866d5d05258bEc4cF62948",
        memeHook: "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044",
        feeEscrow: "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e",
        buybackVault: "0x42df2a798f82289E177311362e8f5ccC45c1219c",
        locker: "0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952",
        launchDeployer: "0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42",
        graduationExecutor: "0xC7819B64A1dAECD7eC19856d026cb14EfBd89046",
      },
      graduationQuote: 4.2, totalSupply: 1e9, curveSupplyShare: 0.7143, migratesTo: "Uniswap v4 + MemeHook (LP locked forever)",
      launchFeeNative: 0.0005, curveFeeBps: 100, poolFeeBps: 100, creatorFeeBpsOfVolume: 70,
      snipeTax: { startBps: 9900, windowSec: 3 }, quoteTokens: ["ETH", "USDG", "stock tokens"],
    }],
    tax: { supported: true, maxBps: 1000, note: "creatorTaxBps immutable after launch" },
    split: "splitter-weak",
    splitNote: "creatorFeeRecipient = our FeeSplitter (never transfers). Pons already takes 30% protocol / 70% creator. Pons Safe can override recipient after 3 days.",
    adapter: "beta",
    integration: "LaunchAndBuy.launchAndBuy(TokenParams, 0, 0x0, quoteIn, minOut, recipient, exemptions[]); msg.value = launchFee + quoteIn. expectedEconomics from previewLaunchEconomics.",
    warnings: ["Owner can close public launch (launchEnabled).", "Pons Safe can redirect creator fees after 3-day notice.", "Unaudited; repo ≠ deployed (use Sourcify source)."],
  },
  pools: {
    id: "pools", name: "Pools", site: "https://pools.xyz", model: "instant", color: "#ff37c7", glyph: "🦄",
    deployments: [{
      chain: "hood",
      contracts: {
        entry: "0x0000ffffbe8efe702c8703ae3477ff5de3d319c0",
        tokenFactory: "0x000000e200088d55c39a11f609e5f667729ad49b",
        ccaFactory: "0x000000001f26a0044baa66024e7b6599c61963f8",
        // Verified 2026-09-28 (server/launch/adapters/pools.ts): the strategy most recent pools.xyz launches use.
        strategy: "0x23f8209572b4a1c2ad88a42749e830791fb027f1",
        beneficiaryVault: "0xd35e9ca72f64c7f93be30fad67524323396b36d7",
        feeCollector: "0xeff166aaf189323c58dc27ed1206eb2c37faacdf",
        urStrategy: "0x1242c9439d589cae85e121b1f79f2af51e91dcee",
        universalRouter: "0x8876789976decbfcbbbe364623c63652db8c0904",
      },
      milestone: { unit: "usd-fdv", value: 50_000 }, totalSupply: 1e9, poolFeeBps: 25, creatorFeeBpsOfVolume: 5,
      quoteTokens: ["ETH"],
    }],
    tax: { supported: false },
    split: "splitter",
    splitNote: "feeBeneficiary (FEEB NFT) → our splitter which can never transfer it. Zero-admin: fully locked.",
    adapter: "beta",
    integration: "LiquidityLauncher.multicall([createToken, distributeToken(strategy, 1e27, abi.encode(splitter)), distributeWithNative(URStrategy, v4 swap) for the dev buy]).",
    warnings: ["Creator fee is only ~0.05% of volume."],
  },
  clanker: {
    id: "clanker", name: "Clanker", site: "https://clanker.world", model: "instant", color: "#7c3aed", glyph: "🤖",
    deployments: [
      {
        chain: "hood",
        contracts: {
          factory: "0xD3f2cC1731b7Fd17f28798835C2E02f0a1839A94",
          lpLocker: "0x290F735F63824BB5836cDe24a35F5103A5B5Bc99",
          hookStaticFeeV2: "0x48B8F6AD3A1b4aA477314c9a23035b8F84dDe8cc",
        },
        // research/launchpads.md: creator gets 5/6 of the 1% pool fee on HOOD.
        totalSupply: 100e9, poolFeeBps: 100, creatorFeeBpsOfVolume: 83, quoteTokens: ["ETH"],
        snipeTax: { startBps: 6667, windowSec: 15 },
      },
      {
        chain: "base",
        contracts: {
          factory: "0xE85A59c628F7d27878ACeB4bf3b35733630083a9",
          feeLocker: "0xF3622742b1E446D92e45E22923Ef11C2fcD55D68",
        },
        totalSupply: 100e9, poolFeeBps: 100, quoteTokens: ["ETH"],
      },
    ],
    tax: { supported: false },
    split: "native-locked",
    splitNote: "rewards.recipients (≤7) — bps immutable; each slot's admin controls only its own slot. We admin our 30% slot.",
    adapter: "beta",
    integration: "clanker-sdk/v4: new Clanker({wallet, publicClient}).deploy({rewards.recipients:[creator 7000, platform 3000], devBuy, …}).",
    warnings: [],
  },
  trench: {
    id: "trench", name: "Trench", site: "https://trench.today", model: "curve", color: "#ef4444", glyph: "🪖",
    deployments: [{
      chain: "hood",
      contracts: { manager: "0x77dc6f6361b7b99456fc3761ce5b7dda80d83f9d" },
      totalSupply: 1e9, migratesTo: "Uniswap", curveFeeBps: 100, quoteTokens: ["ETH"],
    }],
    tax: { supported: false },
    split: "native-mutable",
    splitNote: "Tax manager 0x7a17…c420 routes buy/sell tax to 1–10 recipients (RevenueRouter.getRoute). createCurveWithSplit and the '1 edit' rule could not be found or verified on-chain (sources unverified).",
    adapter: "planned",
    integration: "Not integrable yet (checked 2026-09-28): creates need a server-mined CREATE2 salt (\"TaxFactory: bad token suffix\") from Trench's SIWE-authenticated /api/token/create.",
    warnings: ["Single-EOA owner can upgrade all proxies.", "Launch requires Trench's authenticated backend (vanity salt)."],
  },
  dyor: {
    id: "dyor", name: "Dyor", site: "https://dyorv3.org", model: "instant", color: "#10b981", glyph: "🔍",
    deployments: [{
      chain: "hood",
      contracts: { factory: "0x80b42aed46d73f47119dc444bea28a9e68f32bf4", locker: "0xa8fb5ffb66e8a3a91ef1e18de91432d46aab5871" },
      // The creator gets 20% of the (quote-side) 1% LP fees.
      milestone: { unit: "native-liquidity", value: 4.5 }, totalSupply: 1e9, poolFeeBps: 100, creatorFeeBpsOfVolume: 20, quoteTokens: ["ETH"],
      launchFeeNative: 0.0005,
    }],
    tax: { supported: false },
    split: "splitter-weak",
    splitNote: "feeRecipient = our splitter (no setter in LaunchLocker). Creator gets only 20% of quote-side LP fees. Owner EOA can upgrade factory/locker.",
    adapter: "beta",
    integration: "LaunchFactory.launch(name, symbol, metadataURI, feeRecipient = splitter, 0) with value = launch fee; no dev buy (it would go to the fee recipient).",
    warnings: ["Creator receives only 20% of LP fees.", "No dev buy: Dyor sends the launch buy to the fee recipient."],
  },
  argus: {
    id: "argus", name: "Argus", site: "https://argus.world", model: "instant", color: "#a78bfa", glyph: "👁️",
    deployments: [{
      chain: "arc",
      contracts: { portal: "0xB021Be536808f551b31789422Fd28a6c9c6e97Da", poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951" },
      totalSupply: 1e9, poolFeeBps: 100, quoteTokens: ["USDC"], snipeTax: { startBps: 9900, windowSec: 3 },
    }],
    tax: { supported: true, maxBps: 1000, asymmetric: true, note: "Fixed at launch" },
    split: "splitter",
    splitNote: "creator = msg.sender → launch via our contract, which splits 70/30. Immutable clones.",
    adapter: "planned",
    integration: "ArgusV4Portal7.launch(...) called from our launcher contract.",
    warnings: ["Open GitHub issue reports reverting launches (repo code)."],
  },
};

export const LAUNCHPAD_ORDER: LaunchpadId[] = [
  "pons", "pools", "flap", "bags", "clanker", "trench", "dyor",
  "pump", "bonk", "heaven", "stonkfun",
  "four", "genius",
  "argus",
];

export function launchpadsForChain(chain: ChainId): LaunchpadInfo[] {
  return LAUNCHPAD_ORDER.map((id) => LAUNCHPADS[id]).filter((lp) => lp.deployments.some((d) => d.chain === chain));
}

export function deploymentOf(id: LaunchpadId, chain: ChainId): LaunchpadDeployment | undefined {
  return LAUNCHPADS[id].deployments.find((d) => d.chain === chain);
}

/** Our business rule. Enforced by adapters and displayed in the launch UI. */
export const FEE_SPLIT = { creatorBps: 7000, platformBps: 3000 } as const;

export const SPLIT_LABEL: Record<SplitSupport, { label: string; tone: "good" | "ok" | "warn" | "bad" }> = {
  "native-locked": { label: "Locked split", tone: "good" },
  "splitter": { label: "Locked via splitter", tone: "good" },
  "native-mutable": { label: "Split (admin can override)", tone: "ok" },
  "splitter-weak": { label: "Splitter (admin can override)", tone: "warn" },
  "none": { label: "Split not enforceable", tone: "bad" },
};
