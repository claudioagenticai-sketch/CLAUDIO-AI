// Chains the terminal supports. Solana is the only live chain; Robinhood Chain and BNB Chain are visible as "coming soon"
// (live state per chain comes from GET /api/platform/config — see shared/platform.ts and client/src/lib/platform.ts).

export type ChainId = "sol" | "hood" | "bsc" | "base" | "arc";
export type ChainKind = "svm" | "evm";

export interface ChainInfo {
  id: ChainId;
  name: string;
  short: string;
  kind: ChainKind;
  evmChainId?: number;
  nativeSymbol: string;
  nativeDecimals: number;
  /** Public RPC — rate-limited, dev only. Prod RPCs come from env. */
  publicRpc: string;
  publicWs?: string;
  /**
   * Extra keyless HTTP endpoints, tried in order after publicRpc. Each was live-tested (see docs/research/rpc.md) for
   * chainId, CORS, and an eth_getLogs range at least as large as the chain's poller asks for.
   */
  rpcFallbacks?: string[];
  explorer: string;
  explorerTx: (hash: string) => string;
  explorerAddress: (addr: string) => string;
  /** Typical block/slot time in ms, used for "sniper = first N blocks" windows. */
  blockTimeMs: number;
  /** Ordering model drives which execution options we show. */
  ordering: "jito-bundles" | "pbs-bundles" | "fcfs-sequencer" | "priority-gas";
  color: string;
  enabled: boolean;
}

/** Mainnet definitions. The app uses `CHAINS`, which is this or the testnet overlay below (CLAUDIO_NETWORK). */
export const MAINNET_CHAINS: Record<ChainId, ChainInfo> = {
  hood: {
    id: "hood",
    name: "Robinhood Chain",
    short: "HOOD",
    kind: "evm",
    evmChainId: 4663,
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    // The official RPC 429s under steady 1.5s polling; these three held 150s of it without a single 429.
    publicRpc: "https://rpc-robinhood.globalstake.io",
    rpcFallbacks: ["https://robinhood.api.pocket.network", "https://rpc.ordofi.network", "https://rpc.mainnet.chain.robinhood.com"],
    explorer: "https://robinhoodchain.blockscout.com",
    explorerTx: (h) => `https://robinhoodchain.blockscout.com/tx/${h}`,
    explorerAddress: (a) => `https://robinhoodchain.blockscout.com/address/${a}`,
    blockTimeMs: 250,
    ordering: "fcfs-sequencer",
    color: "#c6f432",
    enabled: true,
  },
  sol: {
    id: "sol",
    name: "Solana",
    short: "SOL",
    kind: "svm",
    nativeSymbol: "SOL",
    nativeDecimals: 9,
    publicRpc: "https://api.mainnet-beta.solana.com",
    rpcFallbacks: ["https://solana-rpc.publicnode.com", "https://solana.api.pocket.network"],
    explorer: "https://solscan.io",
    explorerTx: (h) => `https://solscan.io/tx/${h}`,
    explorerAddress: (a) => `https://solscan.io/account/${a}`,
    blockTimeMs: 400,
    ordering: "jito-bundles",
    color: "#9b6bff",
    enabled: true,
  },
  bsc: {
    id: "bsc",
    name: "BNB Chain",
    short: "BSC",
    kind: "evm",
    evmChainId: 56,
    nativeSymbol: "BNB",
    nativeDecimals: 18,
    // bsc-dataseed* reject eth_getLogs ("limit exceeded" even for one block), so they're not listed.
    publicRpc: "https://bsc-rpc.publicnode.com",
    rpcFallbacks: ["https://bsc.api.pocket.network", "https://rpc-bsc.48.club", "https://bsc.rpc.blxrbdn.com", "https://1rpc.io/bnb"],
    explorer: "https://bscscan.com",
    explorerTx: (h) => `https://bscscan.com/tx/${h}`,
    explorerAddress: (a) => `https://bscscan.com/address/${a}`,
    blockTimeMs: 750,
    ordering: "pbs-bundles",
    color: "#f3ba2f",
    enabled: true,
  },
  base: {
    id: "base",
    name: "Base",
    short: "BASE",
    kind: "evm",
    evmChainId: 8453,
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    publicRpc: "https://mainnet.base.org",
    rpcFallbacks: ["https://base-rpc.publicnode.com", "https://base.api.pocket.network", "https://base.rpc.blxrbdn.com"],
    explorer: "https://basescan.org",
    explorerTx: (h) => `https://basescan.org/tx/${h}`,
    explorerAddress: (a) => `https://basescan.org/address/${a}`,
    blockTimeMs: 2000,
    ordering: "priority-gas",
    color: "#3b82f6",
    enabled: false,
  },
  arc: {
    id: "arc",
    name: "Arc",
    short: "ARC",
    kind: "evm",
    evmChainId: 5042,
    nativeSymbol: "USDC",
    nativeDecimals: 18,
    publicRpc: "https://rpc.mainnet.arc.io",
    rpcFallbacks: ["https://rpc.blockdaemon.mainnet.arc.io", "https://rpc.quicknode.mainnet.arc.io", "https://arc-rpc.publicnode.com"],
    explorer: "",
    explorerTx: (h) => h,
    explorerAddress: (a) => a,
    blockTimeMs: 500,
    ordering: "priority-gas",
    color: "#60a5fa",
    enabled: false,
  },
};

export type Network = "mainnet" | "testnet";

export interface TestnetInfo {
  name: string;
  evmChainId?: number;
  nativeSymbol: string;
  publicRpc: string;
  rpcFallbacks?: string[];
  explorer: string;
  /** Where to get test funds for the funder wallet . */
  faucets: string[];
  /** Enough native to deploy every Claudio contract (~6M gas) with room to spare, at 2026-09 gas prices. */
  deployBudget: string;
}

/** Test networks for each chain. Every chain id and RPC was checked live with eth_chainId (2026-09-28). */
export const TESTNETS: Record<ChainId, TestnetInfo> = {
  hood: {
    name: "Robinhood Chain Testnet",
    evmChainId: 46630,
    nativeSymbol: "ETH",
    publicRpc: "https://rpc.testnet.chain.robinhood.com",
    rpcFallbacks: ["https://robinhood-sepolia-rpc.publicnode.com"],
    explorer: "https://explorer.testnet.chain.robinhood.com",
    faucets: ["https://faucet.testnet.chain.robinhood.com"],
    deployBudget: "0.002",
  },
  bsc: {
    name: "BNB Chain Testnet",
    evmChainId: 97,
    nativeSymbol: "tBNB",
    publicRpc: "https://bsc-testnet-rpc.publicnode.com",
    rpcFallbacks: ["https://data-seed-prebsc-1-s1.bnbchain.org:8545"],
    explorer: "https://testnet.bscscan.com",
    faucets: ["https://www.bnbchain.org/en/testnet-faucet"],
    deployBudget: "0.01",
  },
  base: {
    name: "Base Sepolia",
    evmChainId: 84532,
    nativeSymbol: "ETH",
    publicRpc: "https://sepolia.base.org",
    rpcFallbacks: ["https://base-sepolia-rpc.publicnode.com"],
    explorer: "https://sepolia.basescan.org",
    faucets: ["https://portal.cdp.coinbase.com/products/faucet", "https://docs.base.org/base-chain/tools/network-faucets"],
    deployBudget: "0.002",
  },
  arc: {
    name: "Arc Testnet",
    evmChainId: 5042002,
    nativeSymbol: "USDC",
    publicRpc: "https://rpc.testnet.arc.network",
    explorer: "https://testnet.arcscan.app",
    faucets: ["https://faucet.circle.com"],
    deployBudget: "1",
  },
  sol: {
    name: "Solana Devnet",
    nativeSymbol: "SOL",
    publicRpc: "https://api.devnet.solana.com",
    explorer: "https://solscan.io",
    faucets: ["https://faucet.solana.com"],
    deployBudget: "2",
  },
};

function readNetwork(): Network {
  // Server: CLAUDIO_NETWORK. Client: VITE_CLAUDIO_NETWORK (baked in at build time).
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const v =
    proc?.env?.CLAUDIO_NETWORK ??
    viteEnv?.VITE_CLAUDIO_NETWORK;
  return (v ?? "").trim().toLowerCase() === "testnet" ? "testnet" : "mainnet";
}

/** Which network this build talks to. Testnet swaps every chain's id, RPCs and explorer for its test network. */
export const NETWORK: Network = readNetwork();

function onTestnet(c: ChainInfo): ChainInfo {
  const t = TESTNETS[c.id];
  const ex = t.explorer;
  const cluster = c.kind === "svm" ? "?cluster=devnet" : "";
  return {
    ...c,
    name: t.name,
    evmChainId: t.evmChainId,
    nativeSymbol: t.nativeSymbol,
    publicRpc: t.publicRpc,
    publicWs: undefined,
    rpcFallbacks: t.rpcFallbacks,
    explorer: ex,
    explorerTx: (h) => `${ex}/tx/${h}${cluster}`,
    explorerAddress: (a) => `${ex}/${c.kind === "svm" ? "account" : "address"}/${a}${cluster}`,
  };
}

export const CHAINS: Record<ChainId, ChainInfo> =
  NETWORK === "testnet"
    ? (Object.fromEntries(Object.entries(MAINNET_CHAINS).map(([k, c]) => [k, onTestnet(c)])) as Record<ChainId, ChainInfo>)
    : MAINNET_CHAINS;

/** Display order everywhere (switchers, status bar, filters). Solana first — it's the default and the only live chain. */
export const CHAIN_ORDER: ChainId[] = ["sol", "hood", "bsc", "base", "arc"];
export const ENABLED_CHAINS = CHAIN_ORDER.filter((c) => CHAINS[c].enabled);
