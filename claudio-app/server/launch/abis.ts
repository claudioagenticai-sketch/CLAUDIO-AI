// Minimal ABIs for the launch adapters. Every signature here was checked against live Robinhood Chain (4663)
// bytecode/source on 2026-09-27 — see the notes per block. Typed as the wide `Abi` on purpose: encode/decode
// calls stay runtime-checked by viem and we avoid brittle deep tuple inference.
import type { Abi } from "viem";

// ─── Pons V2 ────────────────────────────────────────────────────────
// LaunchAndBuy 0xe33E…2948 (Sourcify: contracts/src/v2/PonsV2LaunchAndBuy.sol).
// `cast sig` of the tuple signature below = 0xf85f8e41 and that selector is present in the deployed bytecode.
const SOCIALS = {
  type: "tuple",
  name: "socials",
  components: [
    { type: "string", name: "twitter" },
    { type: "string", name: "telegram" },
    { type: "string", name: "discord" },
    { type: "string", name: "website" },
    { type: "string", name: "farcaster" },
  ],
} as const;

export const PONS_LAUNCH_AND_BUY_ABI: Abi = [
  {
    type: "function",
    name: "launchAndBuy",
    stateMutability: "payable",
    inputs: [
      {
        type: "tuple",
        name: "params",
        components: [
          { type: "string", name: "name" },
          { type: "string", name: "symbol" },
          { type: "string", name: "logo" },
          { type: "string", name: "description" },
          SOCIALS,
          { type: "address", name: "creatorFeeRecipient" },
          { type: "uint16", name: "creatorTaxBps" },
          { type: "bool", name: "buybackEnabled" },
          { type: "bytes32", name: "expectedEconomics" },
          { type: "bytes32", name: "salt" },
        ],
      },
      { type: "uint256", name: "launchConfigId" },
      { type: "address", name: "pairToken" },
      { type: "uint256", name: "quoteIn" },
      { type: "uint256", name: "minTokensOut" },
      { type: "address", name: "recipient" },
      { type: "address[]", name: "snipeTaxExemptions" },
    ],
    outputs: [
      { type: "address", name: "token" },
      { type: "address", name: "curve" },
      { type: "uint256", name: "tokensOut" },
    ],
  },
  {
    // topic0 0xdcacba5e…
    type: "event",
    name: "Launched",
    inputs: [
      { type: "address", name: "token", indexed: true },
      { type: "address", name: "curve", indexed: true },
      { type: "address", name: "recipient", indexed: true },
      { type: "address", name: "launcher", indexed: false },
      { type: "uint256", name: "quoteSpent", indexed: false },
      { type: "uint256", name: "tokensReceived", indexed: false },
    ],
  },
];

// Factory 0x7eD5…C7e. Live reads 2026-09-27: launchFee = 5e14, previewLaunchEconomics(0,0) = 0xa9fc75d4…1ca7,
// getLaunchConfig(0) = (1e27, 100, 1.68e18, 4.2e18, 0, 200, true), maxCreatorTaxBps = 1000, launchEnabled = true.
export const PONS_FACTORY_ABI: Abi = [
  { type: "function", name: "launchFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "previewLaunchEconomics",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "launchConfigId" }, { type: "address", name: "pairToken" }],
    outputs: [{ type: "bytes32" }],
  },
  { type: "function", name: "canLaunch", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "maxCreatorTaxBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  {
    type: "function",
    name: "getLaunchConfig",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "id" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { type: "uint256", name: "supply" },
          { type: "uint256", name: "curveFeeBps" },
          { type: "uint256", name: "phantomQuote" },
          { type: "uint256", name: "graduationThreshold" },
          { type: "uint24", name: "poolFee" },
          { type: "int24", name: "tickSpacing" },
          { type: "bool", name: "enabled" },
        ],
      },
    ],
  },
  {
    // topic0 0x8d4aad49…
    type: "event",
    name: "TokenLaunched",
    inputs: [
      { type: "address", name: "token", indexed: true },
      { type: "address", name: "curve", indexed: true },
      { type: "address", name: "deployer", indexed: true },
      { type: "address", name: "pairToken", indexed: false },
      { type: "uint256", name: "launchConfigId", indexed: false },
      { type: "uint256", name: "graduationThreshold", indexed: false },
    ],
  },
];

// FeeEscrow 0xd3AF…Ac9e (pull ledger; per contracts/src/interfaces/ILaunchpads.sol).
export const PONS_ESCROW_ABI: Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "balanceOfToken",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

// ─── Claudio FeeSplitter ───────────────────────────────
export const SPLITTER_FACTORY_ABI: Abi = [
  {
    type: "function",
    name: "create",
    stateMutability: "nonpayable",
    inputs: [{ type: "address", name: "creator" }, { type: "bytes32", name: "salt" }],
    outputs: [{ type: "address", name: "splitter" }],
  },
  {
    type: "function",
    name: "predict",
    stateMutability: "view",
    inputs: [{ type: "address", name: "creator" }, { type: "bytes32", name: "salt" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "isDeployed",
    stateMutability: "view",
    inputs: [{ type: "address", name: "creator" }, { type: "bytes32", name: "salt" }],
    outputs: [{ type: "bool" }],
  },
  { type: "function", name: "platformTreasury", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "creatorBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
];

export const SPLITTER_ABI: Abi = [
  { type: "function", name: "sweepPonsCurve", stateMutability: "nonpayable", inputs: [{ type: "address", name: "curve" }], outputs: [] },
  {
    type: "function",
    name: "harvestPonsEscrow",
    stateMutability: "nonpayable",
    inputs: [{ type: "address", name: "escrow" }, { type: "address[]", name: "tokens" }],
    outputs: [],
  },
  { type: "function", name: "distributable", stateMutability: "view", inputs: [{ type: "address", name: "token" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "distribute",
    stateMutability: "nonpayable",
    inputs: [{ type: "address", name: "token" }],
    outputs: [{ type: "uint256", name: "creatorAmount" }, { type: "uint256", name: "platformAmount" }],
  },
  {
    type: "function",
    name: "claimBags",
    stateMutability: "nonpayable",
    inputs: [{ type: "address", name: "feeShare" }, { type: "bool", name: "unwrap" }],
    outputs: [],
  },
];

// ─── Flap (Robinhood) ───────────────────────────────────────────────
// Portal proxy 0x2660…Eb09 → impl 0xf920…bd99 (Sourcify exact match, src/Portal.sol + src/interfaces/IPortal.sol).
// newTokenV6((…NewTokenV6Params)) selector 0x8cb5772c: present in the impl bytecode and used by real HOOD launches
// (e.g. tx 0x8b5466a2…7397, decoded with this exact tuple).
const FLAP_NEW_TOKEN_V6_PARAMS = {
  type: "tuple",
  name: "params",
  components: [
    { type: "string", name: "name" },
    { type: "string", name: "symbol" },
    { type: "string", name: "meta" },
    { type: "uint8", name: "dexThresh" },
    { type: "bytes32", name: "salt" },
    { type: "uint8", name: "migratorType" },
    { type: "address", name: "quoteToken" },
    { type: "uint256", name: "quoteAmt" },
    { type: "address", name: "beneficiary" },
    { type: "bytes", name: "permitData" },
    { type: "bytes32", name: "extensionID" },
    { type: "bytes", name: "extensionData" },
    { type: "uint8", name: "dexId" },
    { type: "uint8", name: "lpFeeProfile" },
    { type: "uint16", name: "buyTaxRate" },
    { type: "uint16", name: "sellTaxRate" },
    { type: "uint64", name: "taxDuration" },
    { type: "uint64", name: "antiFarmerDuration" },
    { type: "uint16", name: "mktBps" },
    { type: "uint16", name: "deflationBps" },
    { type: "uint16", name: "dividendBps" },
    { type: "uint16", name: "lpBps" },
    { type: "uint256", name: "minimumShareBalance" },
    { type: "address", name: "dividendToken" },
    { type: "address", name: "commissionReceiver" },
    { type: "uint8", name: "tokenVersion" },
  ],
} as const;

export const FLAP_PORTAL_ABI: Abi = [
  {
    type: "function",
    name: "newTokenV6",
    stateMutability: "payable",
    inputs: [FLAP_NEW_TOKEN_V6_PARAMS],
    outputs: [{ type: "address", name: "token" }],
  },
  {
    type: "function",
    name: "getQuoteTokenConfiguration",
    stateMutability: "view",
    inputs: [{ type: "address", name: "quoteToken" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { type: "uint8", name: "enabled" },
          { type: "uint8", name: "defaultCurve" },
          { type: "uint8", name: "alternativeCurve" },
          { type: "uint8", name: "nativeToQuoteSwapType" },
          { type: "uint8", name: "dexId" },
        ],
      },
    ],
  },
  { type: "function", name: "getFeeRate", stateMutability: "view", inputs: [], outputs: [{ type: "uint256", name: "buyFeeRate" }, { type: "uint256", name: "sellFeeRate" }] },
  {
    type: "event",
    name: "TokenCreated",
    inputs: [
      { type: "uint256", name: "ts", indexed: false },
      { type: "address", name: "creator", indexed: false },
      { type: "uint256", name: "nonce", indexed: false },
      { type: "address", name: "token", indexed: false },
      { type: "string", name: "name", indexed: false },
      { type: "string", name: "symbol", indexed: false },
      { type: "string", name: "meta", indexed: false },
    ],
  },
];

/** Flap CurveModule (the Portal's internal immutable; seen as the curveByType target in real launch traces). */
export const FLAP_CURVE_MODULE_ABI: Abi = [
  {
    type: "function",
    name: "curveByType",
    stateMutability: "pure",
    inputs: [{ type: "uint8", name: "curveType" }],
    outputs: [{ type: "tuple", components: [{ type: "uint256", name: "r" }, { type: "uint256", name: "h" }, { type: "uint256", name: "k" }] }],
  },
];

/** FlapTaxTokenV3 (impl 0x7777…3333, Sourcify) + its TaxProcessor clone (ITaxProcessor in the same source). */
export const FLAP_TAX_ABI: Abi = [
  { type: "function", name: "taxProcessor", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "marketAddress", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "marketQuoteBalance", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalQuoteSentToMarketing", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

// ─── Bags (Robinhood) ───────────────────────────────────────────────
// BagsFactory proxy 0xe8Cc…Cb37 → impl 0x7dfa…ef1c (Sourcify exact match, src/BagsFactory.sol).
// create 0x2b24d20e / createAndBuy 0x861a5ece: both present in the impl bytecode; real HOOD createAndBuy calls
// (e.g. tx 0x1771aa0d…3106) decode with this ABI.
const BAGS_CREATE_INPUTS = [
  { type: "string", name: "name" },
  { type: "string", name: "symbol" },
  { type: "string", name: "metadataURI" },
  { type: "address", name: "partner" },
  { type: "address[]", name: "claimers" },
  { type: "uint16[]", name: "bps" },
] as const;

export const BAGS_FACTORY_ABI: Abi = [
  { type: "function", name: "create", stateMutability: "payable", inputs: BAGS_CREATE_INPUTS, outputs: [{ type: "address", name: "token" }, { type: "address", name: "curve" }] },
  { type: "function", name: "createAndBuy", stateMutability: "payable", inputs: BAGS_CREATE_INPUTS, outputs: [{ type: "address", name: "token" }, { type: "address", name: "curve" }] },
  { type: "function", name: "creationFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "graduationThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "feeShareForToken", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address" }] },
  {
    type: "event",
    name: "TokenCreated",
    inputs: [
      { type: "address", name: "token", indexed: true },
      { type: "address", name: "curve", indexed: true },
      { type: "address", name: "creator", indexed: true },
      { type: "address", name: "feeShare", indexed: false },
      { type: "address", name: "partner", indexed: false },
      { type: "bytes32", name: "poolId", indexed: false },
      { type: "string", name: "name", indexed: false },
      { type: "string", name: "symbol", indexed: false },
      { type: "string", name: "metadataURI", indexed: false },
    ],
  },
];

/** BagsFeeShare (beacon proxy per launch; src/BagsFeeShare.sol in the same Sourcify bundle). */
export const BAGS_FEE_SHARE_ABI: Abi = [
  { type: "function", name: "claimable", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getClaimers", stateMutability: "view", inputs: [], outputs: [{ type: "address[]", name: "addrs" }, { type: "uint16[]", name: "bps" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

// ─── Clanker v4 (Robinhood) ─────────────────────────────────────────
// Factory 0xD3f2…9A94: deployToken selector 0xdf40224a (matches three real HOOD deploys decoded with cast).
export const CLANKER_FACTORY_ABI: Abi = [
  {
    type: "function",
    name: "deployToken",
    stateMutability: "payable",
    inputs: [
      {
        type: "tuple",
        name: "deploymentConfig",
        components: [
          {
            type: "tuple",
            name: "tokenConfig",
            components: [
              { type: "address", name: "tokenAdmin" },
              { type: "string", name: "name" },
              { type: "string", name: "symbol" },
              { type: "bytes32", name: "salt" },
              { type: "string", name: "image" },
              { type: "string", name: "metadata" },
              { type: "string", name: "context" },
              { type: "uint256", name: "originatingChainId" },
            ],
          },
          {
            type: "tuple",
            name: "poolConfig",
            components: [
              { type: "address", name: "hook" },
              { type: "address", name: "pairedToken" },
              { type: "int24", name: "tickIfToken0IsClanker" },
              { type: "int24", name: "tickSpacing" },
              { type: "bytes", name: "poolData" },
            ],
          },
          {
            type: "tuple",
            name: "lockerConfig",
            components: [
              { type: "address", name: "locker" },
              { type: "address[]", name: "rewardAdmins" },
              { type: "address[]", name: "rewardRecipients" },
              { type: "uint16[]", name: "rewardBps" },
              { type: "int24[]", name: "tickLower" },
              { type: "int24[]", name: "tickUpper" },
              { type: "uint16[]", name: "positionBps" },
              { type: "bytes", name: "lockerData" },
            ],
          },
          {
            type: "tuple",
            name: "mevModuleConfig",
            components: [
              { type: "address", name: "mevModule" },
              { type: "bytes", name: "mevModuleData" },
            ],
          },
          {
            type: "tuple[]",
            name: "extensionConfigs",
            components: [
              { type: "address", name: "extension" },
              { type: "uint256", name: "msgValue" },
              { type: "uint16", name: "extensionBps" },
              { type: "bytes", name: "extensionData" },
            ],
          },
        ],
      },
    ],
    outputs: [{ type: "address", name: "tokenAddress" }],
  },
  {
    type: "event",
    name: "TokenCreated",
    inputs: [
      { type: "address", name: "msgSender", indexed: false },
      { type: "address", name: "tokenAddress", indexed: true },
      { type: "address", name: "tokenAdmin", indexed: true },
      { type: "string", name: "tokenImage", indexed: false },
      { type: "string", name: "tokenName", indexed: false },
      { type: "string", name: "tokenSymbol", indexed: false },
      { type: "string", name: "tokenMetadata", indexed: false },
      { type: "string", name: "tokenContext", indexed: false },
      { type: "int24", name: "startingTick", indexed: false },
      { type: "address", name: "poolHook", indexed: false },
      { type: "bytes32", name: "poolId", indexed: false },
      { type: "address", name: "pairedToken", indexed: false },
      { type: "address", name: "locker", indexed: false },
      { type: "address", name: "mevModule", indexed: false },
      { type: "uint256", name: "extensionsSupply", indexed: false },
      { type: "address[]", name: "extensions", indexed: false },
    ],
  },
];

// ClankerLpLockerFeeConversion v1.1 0xE491…4A09 (Sourcify) — collectRewards(address) selector 0x5763dbd0 in bytecode.
export const CLANKER_LOCKER_ABI: Abi = [
  { type: "function", name: "collectRewards", stateMutability: "nonpayable", inputs: [{ type: "address", name: "token" }], outputs: [] },
];

// ClankerFeeLocker 0x88db…d70c — claim 0x21c0b342 / availableFees 0x8296535a present in bytecode.
export const CLANKER_FEE_LOCKER_ABI: Abi = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ type: "address", name: "feeOwner" }, { type: "address", name: "token" }],
    outputs: [],
  },
  {
    type: "function",
    name: "availableFees",
    stateMutability: "view",
    inputs: [{ type: "address", name: "feeOwner" }, { type: "address", name: "token" }],
    outputs: [{ type: "uint256" }],
  },
];

// ─── Pools (Uniswap liquidity-launcher, Robinhood) ──────────────────
// LiquidityLauncher 0x0000FffF…19C0 (Sourcify exact match, src/LiquidityLauncher.sol). Dispatcher selectors
// multicall 0xac9650d8, createToken 0xdec14be1, distributeToken 0xb6982b48, distributeWithNative 0x0ef847b6 checked
// in deployed bytecode (2026-09-28).
export const POOLS_LAUNCHER_ABI: Abi = [
  { type: "function", name: "multicall", stateMutability: "payable", inputs: [{ type: "bytes[]", name: "data" }], outputs: [{ type: "bytes[]" }] },
  {
    type: "function",
    name: "createToken",
    stateMutability: "payable",
    inputs: [
      { type: "address", name: "factory" },
      { type: "string", name: "name" },
      { type: "string", name: "symbol" },
      { type: "uint8", name: "decimals" },
      { type: "uint128", name: "initialSupply" },
      { type: "address", name: "recipient" },
      { type: "bytes", name: "tokenData" },
    ],
    outputs: [{ type: "address", name: "tokenAddress" }],
  },
  {
    type: "function",
    name: "distributeToken",
    stateMutability: "payable",
    inputs: [
      { type: "address", name: "token" },
      {
        type: "tuple",
        name: "distribution",
        components: [
          { type: "address", name: "strategy" },
          { type: "uint128", name: "amount" },
          { type: "bytes", name: "configData" },
        ],
      },
      { type: "bytes32", name: "salt" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "distributeWithNative",
    stateMutability: "payable",
    inputs: [
      { type: "address", name: "strategy" },
      { type: "bytes", name: "configData" },
      { type: "bytes32", name: "salt" },
      { type: "uint256", name: "nativeAmount" },
    ],
    outputs: [],
  },
  { type: "event", name: "TokenCreated", inputs: [{ type: "address", name: "tokenAddress", indexed: true }] },
];

// Instant-launch strategy 0x23f8…27f1 (unverified; views read live): beneficiaryVault / feeSplitter / LP_FEE /
// TICK_SPACING / initialTick / MIN_LAUNCH_TICK / launcher.
export const POOLS_STRATEGY_ABI: Abi = [
  { type: "function", name: "beneficiaryVault", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "feeSplitter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "LP_FEE", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "TICK_SPACING", stateMutability: "view", inputs: [], outputs: [{ type: "int24" }] },
  { type: "function", name: "initialTick", stateMutability: "view", inputs: [], outputs: [{ type: "int24" }] },
  { type: "function", name: "MIN_LAUNCH_TICK", stateMutability: "view", inputs: [], outputs: [{ type: "int24" }] },
  { type: "function", name: "launcher", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

// "Fee Beneficiary" (FEEB) ERC-721 = BeneficiaryVault, plus the position-fee collector that feeds it.
// claim 0xefa9a9be (NotBeneficiary(uint256,address) for non-owners) and collectFees 0x1f2a2e46 (permissionless) were
// eth_call-tested on live positions.
export const POOLS_VAULT_ABI: Abi = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "amounts", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }, { type: "uint256" }] },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256", name: "tokenId" }, { type: "uint256", name: "minCurrency0Amount" }, { type: "uint256", name: "minCurrency1Amount" }],
    outputs: [],
  },
];
export const POOLS_COLLECTOR_ABI: Abi = [
  { type: "function", name: "collectFees", stateMutability: "nonpayable", inputs: [{ type: "uint256[]", name: "tokenIds" }], outputs: [] },
];

// ─── Dyor V3 (Robinhood) ────────────────────────────────────────────
// LaunchFactory proxy 0x80B4…2BF4 → impl 0xce47…38Fe (Sourcify exact match, contracts/LaunchFactory.sol).
// launch 0xdeb026ec present in the impl dispatcher.
export const DYOR_FACTORY_ABI: Abi = [
  {
    type: "function",
    name: "launch",
    stateMutability: "payable",
    inputs: [
      { type: "string", name: "name" },
      { type: "string", name: "symbol" },
      { type: "string", name: "metadataURI" },
      { type: "address", name: "feeRecipient" },
      { type: "uint256", name: "minTokensOut" },
    ],
    outputs: [{ type: "address", name: "token" }, { type: "address", name: "pool" }, { type: "uint256", name: "positionId" }],
  },
  { type: "function", name: "effectiveLaunchFee", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "locker", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "liquidityEth", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "event",
    name: "TokenLaunched",
    inputs: [
      { type: "address", name: "token", indexed: true },
      { type: "address", name: "deployer", indexed: true },
      { type: "address", name: "dexFactory", indexed: true },
      { type: "address", name: "pairToken", indexed: false },
      { type: "address", name: "pool", indexed: false },
      { type: "uint256", name: "positionId", indexed: false },
      { type: "uint256", name: "restrictionsEndBlock", indexed: false },
      { type: "uint256", name: "initialBuyAmount", indexed: false },
      { type: "string", name: "metadataURI", indexed: false },
      { type: "address", name: "feeRecipient", indexed: false },
    ],
  },
];

// LaunchLocker proxy 0xA8fB…5871 → impl 0xbc61…02fb (not on Sourcify; its 23 dispatcher selectors equal the verified
// LaunchLocker.sol ABI bundled with the factory — no fee-recipient setter). harvestToken is permissionless.
export const DYOR_LOCKER_ABI: Abi = [
  { type: "function", name: "harvestToken", stateMutability: "nonpayable", inputs: [{ type: "address", name: "token" }], outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "positionForToken", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "locks",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "bool" }],
  },
];

// Claudio FeeSplitter helpers used by the Pools / Dyor adapters.
export const SPLITTER_CLAIM_ABI: Abi = [
  { type: "function", name: "claimPoolsVault", stateMutability: "nonpayable", inputs: [{ type: "address", name: "vault" }, { type: "uint256", name: "tokenId" }], outputs: [] },
  { type: "function", name: "distribute", stateMutability: "nonpayable", inputs: [{ type: "address", name: "token" }], outputs: [{ type: "uint256" }, { type: "uint256" }] },
];

// ─── Known custom errors (for readable simulation failures) ─────────
function err(name: string, inputs: string[] = []): Abi[number] {
  return { type: "error", name, inputs: inputs.map((t, i) => ({ type: t, name: `a${i}` })) } as Abi[number];
}

export const KNOWN_ERRORS: Abi = [
  // Pons LaunchAndBuy / Factory / Curve (Sourcify sources)
  err("NotApprovedLauncher"),
  err("NativeValueMismatch", ["uint256", "uint256"]),
  err("RefundFailed"),
  err("ZeroAddress"),
  err("ZeroAmount"),
  err("NotWhitelisted"),
  err("LaunchFeeNotPaid"),
  err("InvalidLaunchConfigId"),
  err("InvalidTokenParams"),
  err("CreatorTaxTooHigh"),
  err("PairTokenNotApproved"),
  err("LaunchConfigDisabled"),
  err("LaunchEconomicsMismatch", ["bytes32", "bytes32"]),
  err("ExemptionListTooLong"),
  err("MetadataTooLong"),
  err("LaunchDeployerNotSet"),
  err("LaunchDependenciesNotWired"),
  err("SlippageExceeded", ["uint256", "uint256"]),
  err("CurveGraduated"),
  err("AlreadyGraduated"),
  err("NotFeeSweepOperator"),
  err("InternalSwapRequiresOperator"),
  err("InsufficientInputAmount"),
  err("InsufficientOutputAmount"),
  err("InsufficientLiquidity"),
  // Clanker v4
  err("Deprecated"),
  err("OnlyOriginatingChain"),
  err("HookNotEnabled"),
  err("LockerNotEnabled"),
  err("MevModuleNotEnabled"),
  err("ExtensionNotEnabled"),
  err("ExtensionMsgValueMismatch"),
  err("MaxExtensionBpsExceeded"),
  err("MaxExtensionsExceeded"),
  err("MismatchedRewardArrays"),
  err("InvalidRewardBps"),
  err("ZeroRewardAddress"),
  err("NoFeesToClaim"),
  err("Unauthorized"),
  // Flap Portal (IPortal.sol)
  err("FeatureDisabled"),
  err("VanityAddressRequirementNotMet", ["address"]),
  // Bags (IBagsFactory.sol / IBagsFeeShare.sol)
  err("BagsFactory_InsufficientCreationFee", ["uint256", "uint256"]),
  err("BagsFactory_InvalidClaimers"),
  err("BagsFactory_NoClaimers"),
  err("BagsFactory_NoBuyValue"),
  err("BagsFactory_BuyFailed", ["address", "uint256"]),
  err("BagsFeeShare_NothingToClaim"),
  // Claudio FeeSplitter
  err("AlreadyInitialized"),
  err("InvalidAddress"),
  err("InvalidBps"),
  err("NothingOwed"),
  err("InsufficientGas"),
  // Pools (liquidity-launcher, FEEB vault) / Dyor LaunchFactory
  err("AllowanceNotFullyConsumed"),
  err("RecipientCannotBeZeroAddress"),
  err("NotBeneficiary", ["uint256", "address"]),
  err("TokenAlreadyExists"),
  err("BadInput"),
  err("BadValue"),
];
