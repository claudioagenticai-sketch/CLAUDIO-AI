// Injected (browser-extension) wallets: EIP-1193 for EVM, Phantom-style provider for Solana.
// We type the globals locally instead of augmenting `Window`, to avoid clashing with other declarations.

import { CHAINS, type ChainId } from "@shared/chains";
import { evmRpcUrls } from "./rpc";
import { selectedWallet, startDiscovery } from "./discovery";

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isCoinbaseWallet?: boolean;
  isPhantom?: boolean;
}

interface SolPublicKeyLike {
  toBase58(): string;
}

export interface SolanaInjected {
  publicKey?: SolPublicKeyLike | null;
  isConnected?: boolean;
  isPhantom?: boolean;
  isBackpack?: boolean;
  isSolflare?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: SolPublicKeyLike }>;
  disconnect(): Promise<void>;
  signTransaction<T>(tx: T): Promise<T>;
  /** Sign-in messages (Phantom/Backpack/Solflare legacy API returns { signature }; some return the bytes). */
  signMessage?(message: Uint8Array, display?: "utf8" | "hex"): Promise<{ signature: Uint8Array } | Uint8Array>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

interface InjectedWindow {
  ethereum?: Eip1193Provider;
  phantom?: { solana?: SolanaInjected; ethereum?: Eip1193Provider };
  solana?: SolanaInjected;
}

function w(): InjectedWindow | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as InjectedWindow);
}

/** The EVM wallet the user picked (EIP-6963), else the legacy `window.ethereum`. */
export function evmProvider(): Eip1193Provider | undefined {
  startDiscovery();
  return selectedWallet("evm")?.provider ?? w()?.ethereum;
}

/** The Solana wallet the user picked (Wallet Standard), else the legacy Phantom-style global. */
export function solProvider(): SolanaInjected | undefined {
  startDiscovery();
  const x = w();
  return selectedWallet("svm")?.provider ?? x?.phantom?.solana ?? x?.solana;
}

export function evmProviderName(): string {
  const picked = selectedWallet("evm");
  if (picked) return picked.name;
  const p = evmProvider();
  if (!p) return "Browser wallet";
  if (p.isRabby) return "Rabby";
  if (p.isPhantom) return "Phantom";
  if (p.isCoinbaseWallet) return "Coinbase Wallet";
  if (p.isMetaMask) return "MetaMask";
  return "Browser wallet";
}

export function solProviderName(): string {
  const picked = selectedWallet("svm");
  if (picked) return picked.name;
  const p = solProvider();
  if (!p) return "Solana wallet";
  if (p.isPhantom) return "Phantom";
  if (p.isBackpack) return "Backpack";
  if (p.isSolflare) return "Solflare";
  return "Solana wallet";
}

interface RpcErrorLike {
  code?: number;
  message?: string;
  data?: { originalError?: { code?: number } };
}

function errCode(e: unknown): number | undefined {
  const x = e as RpcErrorLike;
  return x?.data?.originalError?.code ?? x?.code;
}

export function isUserRejection(e: unknown): boolean {
  const code = errCode(e);
  if (code === 4001) return true;
  const msg = e instanceof Error ? e.message : String((e as RpcErrorLike)?.message ?? "");
  return /user rejected|user denied|rejected the request|cancell?ed/i.test(msg);
}

export async function connectEvm(silent = false): Promise<string | undefined> {
  const p = evmProvider();
  if (!p) throw new Error("No EVM browser wallet found. Install MetaMask, Rabby or similar.");
  const res = await p.request({ method: silent ? "eth_accounts" : "eth_requestAccounts" });
  const list = Array.isArray(res) ? (res as unknown[]).filter((a): a is string => typeof a === "string") : [];
  return list[0];
}

export async function connectSol(silent = false): Promise<string | undefined> {
  const p = solProvider();
  if (!p) throw new Error("No Solana browser wallet found. Install Phantom or similar.");
  const res = await p.connect(silent ? { onlyIfTrusted: true } : undefined);
  return res.publicKey.toBase58();
}

export async function disconnectSol(): Promise<void> {
  try {
    await solProvider()?.disconnect();
  } catch {
    /* ignore */
  }
}

/** Makes the injected EVM wallet use `chain`, adding it (e.g. Robinhood Chain 4663) if unknown. */
export async function ensureEvmChain(chain: ChainId): Promise<void> {
  const p = evmProvider();
  if (!p) throw new Error("No EVM browser wallet found");
  const c = CHAINS[chain];
  if (c.evmChainId === undefined) throw new Error(`${c.name} is not an EVM chain`);
  const hexId = `0x${c.evmChainId.toString(16)}`;
  const current = await p.request({ method: "eth_chainId" });
  if (typeof current === "string" && parseInt(current, 16) === c.evmChainId) return;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (e) {
    const code = errCode(e);
    const msg = e instanceof Error ? e.message : "";
    // 4902 = unknown chain. Some wallets report -32603 with "Unrecognized chain".
    if (code === 4902 || /unrecognized|unknown chain|not been added/i.test(msg)) {
      await p.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hexId,
            chainName: c.name,
            nativeCurrency: { name: c.nativeSymbol, symbol: c.nativeSymbol, decimals: c.nativeDecimals },
            rpcUrls: evmRpcUrls(chain).slice(0, 3),
            blockExplorerUrls: c.explorer ? [c.explorer] : undefined,
          },
        ],
      });
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    } else {
      throw e;
    }
  }
}
