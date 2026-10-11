// Discovers EVERY installed browser wallet, not just whichever extension won the race for `window.ethereum`:
//  • EVM:    EIP-6963 (`eip6963:announceProvider`) — MetaMask, Rabby, Coinbase, OKX, Phantom, Backpack, Brave…
//  • Solana: Wallet Standard (`@wallet-standard/app`) — Phantom, Backpack, Solflare, OKX…
// The user picks one per chain kind; injected.ts then routes every request through the picked wallet.
import { create } from "zustand";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount as StdAccount } from "@wallet-standard/base";
import type { ChainKind } from "@shared/chains";
import type { Eip1193Provider, SolanaInjected } from "./injected";
import { WC_ENABLED, wcEvmProvider, wcSolProvider } from "./walletconnect";

/** WalletConnect's official blue mark (inline so it works offline). */
const WC_ICON =
  "data:image/svg+xml;base64," +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#3396FF"/><path fill="#fff" d="M9.6 12.3c3.5-3.4 9.3-3.4 12.8 0l.4.4a.4.4 0 0 1 0 .6l-1.4 1.4a.2.2 0 0 1-.3 0l-.6-.6c-2.5-2.4-6.5-2.4-9 0l-.6.6a.2.2 0 0 1-.3 0l-1.4-1.4a.4.4 0 0 1 0-.6l.4-.4Zm15.8 2.9 1.3 1.2a.4.4 0 0 1 0 .6l-5.7 5.6a.5.5 0 0 1-.6 0l-4-3.9a.1.1 0 0 0-.2 0l-4 3.9a.5.5 0 0 1-.6 0l-5.8-5.6a.4.4 0 0 1 0-.6l1.3-1.2a.5.5 0 0 1 .6 0l4 3.9a.1.1 0 0 0 .2 0l4-3.9a.5.5 0 0 1 .6 0l4 3.9a.1.1 0 0 0 .2 0l4-3.9a.5.5 0 0 1 .6 0Z"/></svg>',
  );

export interface EvmWalletInfo {
  kind: "evm";
  /** Stable id: EIP-6963 rdns (e.g. "io.metamask"), or "injected" for the legacy window.ethereum fallback. */
  id: string;
  name: string;
  icon?: string;
  provider: Eip1193Provider;
}

export interface SolWalletInfo {
  kind: "svm";
  id: string; // wallet name
  name: string;
  icon?: string;
  provider: SolanaInjected;
}

export type DiscoveredWallet = EvmWalletInfo | SolWalletInfo;

interface DiscoveryState {
  evm: EvmWalletInfo[];
  svm: SolWalletInfo[];
  /** Chain the connected EVM browser wallet is on right now (from eth_chainId / chainChanged). */
  evmChainId?: number;
  selected: Partial<Record<ChainKind, string>>;
  select: (kind: ChainKind, id: string) => void;
}

const SEL_KEY = "claudio.wallet.injected.selected.v1";

function readSelected(): Partial<Record<ChainKind, string>> {
  try {
    return JSON.parse(localStorage.getItem(SEL_KEY) ?? "{}") as Partial<Record<ChainKind, string>>;
  } catch {
    return {};
  }
}

export const useDiscovery = create<DiscoveryState>((set) => ({
  evm: [],
  svm: [],
  selected: typeof window === "undefined" ? {} : readSelected(),
  select: (kind, id) =>
    set((s) => {
      const selected = { ...s.selected, [kind]: id };
      try {
        localStorage.setItem(SEL_KEY, JSON.stringify(selected));
      } catch {
        /* storage unavailable */
      }
      return { selected };
    }),
}));

// ─── EVM: EIP-6963 ──────────────────────────────────────────────────────────────────────────────

interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

function addEvm(w: EvmWalletInfo) {
  // A late EIP-6963 announcement replaces the legacy window.ethereum entry for the same provider.
  useDiscovery.setState((s) => (s.evm.some((x) => x.id === w.id) ? s : { evm: [...s.evm.filter((x) => !(x.id === "injected" && x.provider === w.provider)), w] }));
}

// ─── Solana: Wallet Standard → the SolanaInjected shape send.ts already speaks ──────────────────

const SOLANA_MAINNET = "solana:mainnet";

interface Serializable {
  serialize(opts?: { requireAllSignatures?: boolean; verifySignatures?: boolean }): Uint8Array;
}
interface Deserializer<T> {
  deserialize(bytes: Uint8Array): T;
}

function standardToInjected(wallet: Wallet): SolanaInjected {
  let account: StdAccount | undefined = wallet.accounts.find((a) => a.chains.some((c) => c.startsWith("solana:")));
  const pk = () => (account ? { toBase58: () => account!.address } : null);
  const connectFeature = wallet.features["standard:connect"] as { connect(i?: { silent?: boolean }): Promise<{ accounts: readonly StdAccount[] }> } | undefined;
  const disconnectFeature = wallet.features["standard:disconnect"] as { disconnect(): Promise<void> } | undefined;
  const signFeature = wallet.features["solana:signTransaction"] as
    | { signTransaction(...i: { account: StdAccount; transaction: Uint8Array; chain?: string }[]): Promise<{ signedTransaction: Uint8Array }[]> }
    | undefined;
  const signMessageFeature = wallet.features["solana:signMessage"] as
    | { signMessage(...i: { account: StdAccount; message: Uint8Array }[]): Promise<{ signature: Uint8Array }[]> }
    | undefined;
  const eventsFeature = wallet.features["standard:events"] as { on(e: "change", l: (p: { accounts?: readonly StdAccount[] }) => void): () => void } | undefined;
  const listeners = new Map<(...a: unknown[]) => void, () => void>();

  return {
    get publicKey() {
      return pk();
    },
    get isConnected() {
      return !!account;
    },
    async connect(opts) {
      if (!connectFeature) throw new Error(`${wallet.name} can't connect`);
      const res = await connectFeature.connect({ silent: !!opts?.onlyIfTrusted });
      account = res.accounts.find((a) => a.chains.some((c) => c.startsWith("solana:"))) ?? res.accounts[0];
      if (!account) throw new Error(`${wallet.name} returned no Solana account`);
      return { publicKey: pk()! };
    },
    async disconnect() {
      await disconnectFeature?.disconnect();
      account = undefined;
    },
    async signTransaction<T>(tx: T): Promise<T> {
      if (!signFeature || !account) throw new Error(`${wallet.name} isn't connected`);
      const bytes = (tx as unknown as Serializable).serialize({ requireAllSignatures: false, verifySignatures: false });
      const [out] = await signFeature.signTransaction({ account, transaction: bytes, chain: SOLANA_MAINNET });
      const ctor = (tx as unknown as { constructor: Deserializer<T> }).constructor;
      return ctor.deserialize(out.signedTransaction);
    },
    ...(signMessageFeature
      ? {
          async signMessage(message: Uint8Array) {
            if (!account) throw new Error(`${wallet.name} isn't connected`);
            const [out] = await signMessageFeature.signMessage({ account, message });
            return { signature: out.signature };
          },
        }
      : {}),
    on(event, listener) {
      if (event !== "accountChanged" || !eventsFeature) return;
      const off = eventsFeature.on("change", ({ accounts }) => {
        if (!accounts) return;
        account = accounts.find((a) => a.chains.some((c) => c.startsWith("solana:")));
        listener(pk());
      });
      listeners.set(listener, off);
    },
    removeListener(_event, listener) {
      listeners.get(listener)?.();
      listeners.delete(listener);
    },
  };
}

function isSolanaWallet(w: Wallet): boolean {
  return w.chains.some((c) => c.startsWith("solana:")) && "standard:connect" in w.features && "solana:signTransaction" in w.features;
}

function addSol(w: Wallet) {
  if (!isSolanaWallet(w)) return;
  useDiscovery.setState((s) =>
    s.svm.some((x) => x.id === w.name) ? s : { svm: [...s.svm, { kind: "svm", id: w.name, name: w.name, icon: w.icon, provider: standardToInjected(w) }] },
  );
}

// ─── Boot ───────────────────────────────────────────────────────────────────────────────────────

let started = false;

/** Starts listening for wallets. Safe to call more than once. */
export function startDiscovery(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  window.addEventListener("eip6963:announceProvider", (ev: Event) => {
    const d = (ev as CustomEvent<Eip6963Detail>).detail;
    if (!d?.info?.rdns || !d.provider) return;
    addEvm({ kind: "evm", id: d.info.rdns, name: d.info.name, icon: d.info.icon, provider: d.provider });
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  try {
    const { get, on } = getWallets();
    get().forEach(addSol);
    on("register", (...ws: Wallet[]) => ws.forEach(addSol));
  } catch {
    /* Wallet Standard unavailable */
  }

  // WalletConnect (mobile wallets) sits in the same list, for both EVM and Solana.
  if (WC_ENABLED) {
    addEvm({ kind: "evm", id: "walletconnect", name: "WalletConnect", icon: WC_ICON, provider: wcEvmProvider });
    useDiscovery.setState((s) => ({ svm: [...s.svm, { kind: "svm", id: "walletconnect", name: "WalletConnect", icon: WC_ICON, provider: wcSolProvider }] }));
  }

  // Legacy wallets that don't announce, and mobile in-app browsers that inject late (after load): look at the globals
  // and ask EIP-6963 wallets to announce again a few times, then on load and on MetaMask's ethereum#initialized.
  const rescan = () => {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    scanGlobals();
  };
  for (const ms of [400, 1500, 4000]) setTimeout(rescan, ms);
  window.addEventListener("load", rescan, { once: true });
  window.addEventListener("ethereum#initialized", rescan, { once: true });
}

interface LegacyWindow {
  ethereum?: Eip1193Provider;
  phantom?: { solana?: SolanaInjected };
  solflare?: SolanaInjected;
  backpack?: { solana?: SolanaInjected };
  solana?: SolanaInjected;
}

function scanGlobals(): void {
  const g = window as unknown as LegacyWindow;
  const s = useDiscovery.getState();
  if (!s.evm.some((w) => w.id !== "walletconnect") && g.ethereum) {
    addEvm({ kind: "evm", id: "injected", name: legacyEvmName(g.ethereum), provider: g.ethereum });
  }
  const legacySol = g.phantom?.solana ?? g.solflare ?? g.backpack?.solana ?? g.solana;
  if (!s.svm.some((w) => w.id !== "walletconnect") && legacySol) {
    const name = legacySol.isPhantom ? "Phantom" : legacySol.isSolflare ? "Solflare" : legacySol.isBackpack ? "Backpack" : "Solana wallet";
    useDiscovery.setState((st) => (st.svm.some((w) => w.id === "injected") ? st : { svm: [{ kind: "svm", id: "injected", name, provider: legacySol }, ...st.svm] }));
  }
}

function legacyEvmName(p: Eip1193Provider): string {
  if (p.isRabby) return "Rabby";
  if (p.isPhantom) return "Phantom";
  if (p.isCoinbaseWallet) return "Coinbase Wallet";
  if (p.isMetaMask) return "MetaMask";
  return "Browser wallet";
}

/** The wallet the user picked for `kind`, else the first one found. */
export function selectedWallet(kind: "evm"): EvmWalletInfo | undefined;
export function selectedWallet(kind: "svm"): SolWalletInfo | undefined;
export function selectedWallet(kind: ChainKind): DiscoveredWallet | undefined {
  const s = useDiscovery.getState();
  const list: DiscoveredWallet[] = kind === "evm" ? s.evm : s.svm;
  // Without a pick, a wallet in this browser beats WalletConnect (which opens a QR/deep-link flow).
  return list.find((w) => w.id === s.selected[kind]) ?? list.find((w) => w.id !== "walletconnect") ?? list[0];
}
