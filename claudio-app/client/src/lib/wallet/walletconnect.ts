// WalletConnect v2 (mobile wallets via QR / deep link), EVM + Solana in ONE session.
// Wrapped to look exactly like a browser-extension wallet (EIP-1193 for EVM, SolanaInjected for Solana) so send.ts,
// ensureEvmChain and the account listeners work unchanged. The SDK (~140 KB gz) loads only when someone picks it.
//
// Requires VITE_WALLETCONNECT_PROJECT_ID (free, dashboard.walletconnect.com; allowlist your domains there).
import { create } from "zustand";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { CHAINS, ENABLED_CHAINS } from "@shared/chains";
import { BRAND } from "@shared/brand";
import type { Eip1193Provider, SolanaInjected } from "./injected";
import { evmRpcUrls } from "./rpc";

const PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined;
export const WC_ENABLED = !!PROJECT_ID;

const SOL_CHAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const EVM_CHAIN_IDS = ENABLED_CHAINS.filter((c) => CHAINS[c].kind === "evm").map((c) => CHAINS[c].evmChainId!) as number[];

/** QR modal state (rendered by WalletConnectModal). */
export const useWcModal = create<{ uri?: string; open: boolean; error?: string }>(() => ({ open: false }));

type UP = import("@walletconnect/universal-provider").default;
let providerP: Promise<UP> | null = null;
let evmChain = EVM_CHAIN_IDS[0] ?? 4663;
const evmListeners = new Map<string, Set<(...a: unknown[]) => void>>();
const solListeners = new Set<(...a: unknown[]) => void>();

function emitEvm(event: string, ...args: unknown[]) {
  evmListeners.get(event)?.forEach((l) => l(...args));
}

async function provider(): Promise<UP> {
  if (!PROJECT_ID) throw new Error("WalletConnect isn't configured (VITE_WALLETCONNECT_PROJECT_ID)");
  if (!providerP) {
    providerP = (async () => {
      const { UniversalProvider } = await import("@walletconnect/universal-provider");
      const p = await UniversalProvider.init({
        projectId: PROJECT_ID,
        metadata: {
          name: BRAND.full,
          description: BRAND.tagline,
          url: window.location.origin,
          icons: [`${window.location.origin}/claudio/icon-192.png`],
        },
      });
      p.on("display_uri", (uri: string) => useWcModal.setState({ uri, open: true, error: undefined }));
      p.on("session_delete", () => {
        emitEvm("accountsChanged", []);
        solListeners.forEach((l) => l(null));
      });
      p.on("session_event", (e: { params?: { event?: { name?: string; data?: unknown } } }) => {
        const ev = e.params?.event;
        if (ev?.name === "accountsChanged") emitEvm("accountsChanged", evmAccounts(p));
      });
      return p;
    })();
    providerP.catch(() => (providerP = null));
  }
  return providerP;
}

function evmAccounts(p: UP): string[] {
  const accts = p.session?.namespaces?.eip155?.accounts ?? [];
  return Array.from(new Set(accts.map((a: string) => a.split(":")[2]).filter(Boolean)));
}

function solAccount(p: UP): string | undefined {
  return p.session?.namespaces?.solana?.accounts?.[0]?.split(":")[2];
}

function approvedEvmChains(p: UP): number[] {
  const chains = p.session?.namespaces?.eip155?.chains ?? p.session?.namespaces?.eip155?.accounts?.map((a: string) => a.split(":").slice(0, 2).join(":")) ?? [];
  return Array.from(new Set(chains.map((c: string) => Number(c.split(":")[1])).filter(Number.isFinite)));
}

async function ensureSession(): Promise<UP> {
  const p = await provider();
  if (p.session) return p;
  const rpcMap: Record<string, string> = {};
  for (const c of ENABLED_CHAINS) if (CHAINS[c].kind === "evm") rpcMap[String(CHAINS[c].evmChainId)] = evmRpcUrls(c)[0];
  try {
    await p.connect({
      optionalNamespaces: {
        eip155: {
          chains: EVM_CHAIN_IDS.map((id) => `eip155:${id}`),
          methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4", "wallet_switchEthereumChain", "wallet_addEthereumChain"],
          events: ["chainChanged", "accountsChanged"],
          rpcMap,
        },
        solana: {
          chains: [SOL_CHAIN],
          methods: ["solana_signTransaction", "solana_signMessage"],
          events: [],
        },
      },
    });
  } catch (e) {
    useWcModal.setState({ error: e instanceof Error ? e.message : "Connection failed" });
    throw e;
  } finally {
    useWcModal.setState({ open: false, uri: undefined });
  }
  const approved = approvedEvmChains(p);
  if (approved.length && !approved.includes(evmChain)) evmChain = approved[0];
  return p;
}

/** Closes the QR modal and abandons a pending pairing. */
export function cancelWalletConnect() {
  useWcModal.setState({ open: false, uri: undefined });
}

export async function disconnectWalletConnect(): Promise<void> {
  const p = providerP ? await providerP.catch(() => null) : null;
  if (p?.session) await p.disconnect().catch(() => undefined);
}

// ─── EVM: EIP-1193 facade ───────────────────────────────────────────────────────────────────────

export const wcEvmProvider: Eip1193Provider = {
  async request({ method, params }) {
    const list = Array.isArray(params) ? params : [];
    switch (method) {
      case "eth_requestAccounts":
        return evmAccounts(await ensureSession());
      case "eth_accounts": {
        const p = await provider();
        return p.session ? evmAccounts(p) : [];
      }
      case "eth_chainId":
        return `0x${evmChain.toString(16)}`;
      case "wallet_switchEthereumChain": {
        const p = await ensureSession();
        const id = parseInt(String((list[0] as { chainId?: string })?.chainId ?? "0x0"), 16);
        if (!approvedEvmChains(p).includes(id)) {
          // Not in the session: let the wallet decide (it may add it). Mirrors EIP-1193 4902 semantics.
          await p.request({ method, params: list }, `eip155:${evmChain}`);
        }
        evmChain = id;
        p.setDefaultChain(`eip155:${id}`);
        emitEvm("chainChanged", `0x${id.toString(16)}`);
        return null;
      }
      default: {
        const p = await ensureSession();
        return p.request({ method, params: list }, `eip155:${evmChain}`);
      }
    }
  },
  on(event, listener) {
    if (!evmListeners.has(event)) evmListeners.set(event, new Set());
    evmListeners.get(event)!.add(listener);
  },
  removeListener(event, listener) {
    evmListeners.get(event)?.delete(listener);
  },
};

// ─── Solana facade ──────────────────────────────────────────────────────────────────────────────

interface SerializableTx {
  serialize(opts?: { requireAllSignatures?: boolean; verifySignatures?: boolean }): Uint8Array;
  addSignature(pk: PublicKey, sig: Uint8Array): void;
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let solPk: string | undefined;

export const wcSolProvider: SolanaInjected = {
  get publicKey() {
    return solPk ? { toBase58: () => solPk! } : null;
  },
  get isConnected() {
    return !!solPk;
  },
  async connect(opts) {
    const p = opts?.onlyIfTrusted ? await provider() : await ensureSession();
    solPk = p.session ? solAccount(p) : undefined;
    if (!solPk) throw new Error("The connected wallet didn't share a Solana account");
    return { publicKey: { toBase58: () => solPk! } };
  },
  async disconnect() {
    solPk = undefined;
    await disconnectWalletConnect();
  },
  async signTransaction<T>(tx: T): Promise<T> {
    const p = await ensureSession();
    const pubkey = solAccount(p);
    if (!pubkey) throw new Error("No Solana account in this WalletConnect session");
    const raw = (tx as unknown as SerializableTx).serialize({ requireAllSignatures: false, verifySignatures: false });
    const res = (await p.request({ method: "solana_signTransaction", params: { transaction: b64(raw), pubkey } }, SOL_CHAIN)) as {
      signature?: string;
      transaction?: string;
    };
    if (res.transaction) {
      const ctor = (tx as unknown as { constructor: { deserialize(b: Uint8Array): T } }).constructor;
      return ctor.deserialize(unb64(res.transaction));
    }
    if (!res.signature) throw new Error("Wallet returned no signature");
    (tx as unknown as SerializableTx).addSignature(new PublicKey(pubkey), bs58.decode(res.signature));
    return tx;
  },
  on(event, listener) {
    if (event === "accountChanged") solListeners.add(listener);
  },
  removeListener(_event, listener) {
    solListeners.delete(listener);
  },
};

/** Test hook: exposes the pairing URI so an automated wallet can pair (only when ?wc-test is in the URL). */
if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("wc-test")) {
  useWcModal.subscribe((s) => {
    (window as unknown as { __wcUri?: string }).__wcUri = s.uri;
  });
}
