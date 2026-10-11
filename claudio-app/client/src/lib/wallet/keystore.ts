// Non-custodial keystore.
//
//  IndexedDB "claudio.vault.v1"    → { v, kdf{PBKDF2,SHA-256,600k,salt}, iv, ct }   AES-GCM-256 encrypted
//                                 plaintext: { accounts: [{ id, kind, label, createdAt, secret }] }
//  IndexedDB "claudio.accounts.v1" → public list (ids, labels, addresses, active ids, backup flags) — no secrets
//
// Security rules enforced here:
//  - Decrypted secrets live ONLY in the module-scoped `secrets` Map below. It is never exported,
//    never logged, and cleared on lock. The AES key is a non-extractable CryptoKey, dropped on lock.
//  - Nothing in this module performs network I/O. Signing helpers hand a signer to a callback
//    and zero what they can afterwards.
//  - Addresses shown while unlocked are re-derived from the decrypted keys (the public list is only a cache).

import { del, get, set } from "idb-keyval";
import { privateKeyToAccount } from "viem/accounts";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import type { ChainKind } from "@shared/chains";
import type { WalletAccount } from "./index";
import { randomId, wipe } from "./codec";
import {
  MIN_PASSCODE,
  KDF_ITERATIONS,
  decryptJson,
  deriveVaultKey,
  encryptJson,
  hasWebCrypto,
  isVaultFile,
  newKdf,
  type VaultKdf,
} from "./crypto";
import { addressOf, generateSecret, normAddr, parseImport } from "./keys";
import { connectEvm, connectSol, disconnectSol, evmProvider, evmProviderName, solProvider, solProviderName, type Eip1193Provider, type SolanaInjected } from "./injected";
import { selectedWallet, startDiscovery, useDiscovery } from "./discovery";
import { isMobileDevice } from "./popular";
import { disconnectWalletConnect } from "./walletconnect";
import { AUTOLOCK_KEY, useWallet, useWalletPrompt, type LockReason, type WalletStore } from "./state";

// Storage keys predate the rebrand and stay as-is: the vault ciphertext is bound to them (see crypto.ts AAD).
const VAULT_KEY = "claudio.vault.v1";
const PUBLIC_KEY = "claudio.accounts.v1";
const INJECTED_KEY = "claudio.wallet.injected";
const THROTTLE_KEY = "claudio.wallet.throttle";

interface VaultAccount {
  id: string;
  kind: ChainKind;
  label: string;
  createdAt: number;
  secret: string;
}
interface VaultPayload {
  accounts: VaultAccount[];
}
interface PublicFile {
  v: 1;
  accounts: { id: string; kind: ChainKind; label: string; createdAt: number; address: string }[];
  active: Partial<Record<ChainKind, string>>;
  backedUp: Record<string, boolean>;
}

// ─── Module-private secret state ────────────────────────────────────

const secrets = new Map<string, string>();
let session: { key: CryptoKey; kdf: VaultKdf; ct: string } | null = null;

let local: WalletAccount[] = [];
const injected: Partial<Record<ChainKind, WalletAccount>> = {};
let active: Partial<Record<ChainKind, string>> = {};
let backedUp: Record<string, boolean> = {};

function publish(extra: Partial<WalletStore> = {}): void {
  const inj = (["svm", "evm"] as ChainKind[]).map((k) => injected[k]).filter((a): a is WalletAccount => !!a);
  useWallet.setState({ accounts: [...local, ...inj], active: { ...active }, backedUp: { ...backedUp }, ...extra });
}

function fixActive(): void {
  for (const kind of ["evm", "svm"] as ChainKind[]) {
    const id = active[kind];
    const exists = id && (local.some((a) => a.id === id && a.kind === kind) || injected[kind]?.id === id);
    if (!exists) {
      const first = local.find((a) => a.kind === kind) ?? injected[kind];
      if (first) active[kind] = first.id;
      else delete active[kind];
    }
  }
}

// Serialise vault writes so concurrent actions can't clobber each other.
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => undefined);
  return run;
}

async function savePublic(): Promise<void> {
  const file: PublicFile = {
    v: 1,
    accounts: local.map((a) => ({ id: a.id, kind: a.kind, label: a.label, createdAt: a.createdAt, address: a.address })),
    active,
    backedUp,
  };
  await set(PUBLIC_KEY, file);
}

async function persistVault(opts: { fresh?: boolean } = {}): Promise<void> {
  await enqueue(async () => {
    if (!session) throw new Error("Wallet is locked");
    if (!opts.fresh) {
      const cur: unknown = await get(VAULT_KEY);
      if (!isVaultFile(cur) || cur.ct !== session.ct) {
        lock("changed");
        throw new Error("Your wallet changed in another tab — unlock again");
      }
    }
    const payload: VaultPayload = {
      accounts: local
        .filter((a) => secrets.has(a.id))
        .map((a) => ({ id: a.id, kind: a.kind, label: a.label, createdAt: a.createdAt, secret: secrets.get(a.id) as string })),
    };
    const file = await encryptJson(session.key, session.kdf, payload);
    await set(VAULT_KEY, file);
    session.ct = file.ct;
  });
  broadcast({ t: "changed" });
}

// ─── Cross-tab sync ─────────────────────────────────────────────────

type BcMsg = { t: "lock" } | { t: "changed" };
const bc: BroadcastChannel | null =
  typeof window !== "undefined" && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("claudio.wallet") : null;

function broadcast(m: BcMsg): void {
  try {
    bc?.postMessage(m);
  } catch {
    /* ignore */
  }
}

if (bc) {
  bc.onmessage = (ev: MessageEvent) => {
    const m = ev.data as BcMsg | undefined;
    if (!m) return;
    // Another tab changed the vault: our decrypted copy is stale, so lock rather than risk overwriting it.
    if (useWallet.getState().unlocked) lock("other-tab", false);
    if (m.t === "changed") void hydrate();
  };
}

// ─── Hydrate ────────────────────────────────────────────────────────

export async function hydrate(): Promise<void> {
  try {
    const [file, pub] = await Promise.all([get(VAULT_KEY) as Promise<unknown>, get(PUBLIC_KEY) as Promise<unknown>]);
    const initialized = isVaultFile(file);
    const p = pub as Partial<PublicFile> | undefined;
    if (initialized && p && Array.isArray(p.accounts)) {
      if (!useWallet.getState().unlocked) {
        local = p.accounts.map((a) => ({ ...a, source: "local" as const }));
      }
      active = { ...(p.active ?? {}) };
      backedUp = { ...(p.backedUp ?? {}) };
    } else if (!initialized) {
      local = [];
      backedUp = {};
    }
    fixActive();
    publish({ hydrated: true, initialized, storageError: undefined });
  } catch (e) {
    publish({ hydrated: true, initialized: false, storageError: e instanceof Error ? e.message : "Storage unavailable" });
  }
}

// ─── Throttling of passcode attempts (UI-level brute-force deterrent) ─

interface Throttle {
  fails: number;
  until: number;
}
function readThrottle(): Throttle {
  try {
    const t = JSON.parse(localStorage.getItem(THROTTLE_KEY) ?? "null") as Throttle | null;
    return t && typeof t.fails === "number" ? t : { fails: 0, until: 0 };
  } catch {
    return { fails: 0, until: 0 };
  }
}
function writeThrottle(t: Throttle): void {
  try {
    localStorage.setItem(THROTTLE_KEY, JSON.stringify(t));
  } catch {
    /* ignore */
  }
}
/** ms until another passcode attempt is allowed. */
export function unlockCooldown(): number {
  return Math.max(0, readThrottle().until - Date.now());
}
function checkThrottle(): void {
  const ms = unlockCooldown();
  if (ms > 0) throw new Error(`Too many attempts — try again in ${Math.ceil(ms / 1000)}s`);
}
function recordFailure(): void {
  const t = readThrottle();
  const fails = t.fails + 1;
  const until = fails >= 5 ? Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (fails - 5)) : 0;
  writeThrottle({ fails, until });
}
function clearFailures(): void {
  writeThrottle({ fails: 0, until: 0 });
}

async function readVaultFile() {
  const file: unknown = await get(VAULT_KEY);
  if (!isVaultFile(file)) throw new Error("No wallet on this device yet");
  return file;
}

/** Derives the key and decrypts; counts failures. */
async function openVault(passcode: string) {
  checkThrottle();
  const file = await readVaultFile();
  const key = await deriveVaultKey(passcode, file.kdf);
  try {
    const payload = await decryptJson<VaultPayload>(key, file);
    clearFailures();
    return { file, key, payload };
  } catch {
    recordFailure();
    throw new Error("Wrong passcode");
  }
}

function assertUnlocked(): void {
  if (!session || !useWallet.getState().unlocked) throw new Error("Unlock your wallet first");
}

function cleanLabel(label: string | undefined, fallback: string): string {
  const s = (label ?? "").replace(/\s+/g, " ").trim().slice(0, 32);
  return s || fallback;
}

function nextLabel(kind: ChainKind): string {
  const n = local.filter((a) => a.kind === kind).length + 1;
  return `${kind === "evm" ? "EVM" : "Solana"} ${n}`;
}

// ─── Public keystore API ────────────────────────────────────────────

export async function createVault(passcode: string): Promise<WalletAccount[]> {
  if (!hasWebCrypto()) throw new Error("Secure crypto unavailable — open Claudio over HTTPS");
  if (passcode.length < MIN_PASSCODE) throw new Error(`Passcode must be at least ${MIN_PASSCODE} characters`);
  const existing: unknown = await get(VAULT_KEY);
  if (isVaultFile(existing)) throw new Error("A wallet already exists on this device");

  const kdf = newKdf();
  const key = await deriveVaultKey(passcode, kdf);
  secrets.clear();
  const now = Date.now();
  local = [];
  backedUp = {};
  for (const kind of ["svm", "evm"] as ChainKind[]) {
    const g = generateSecret(kind);
    const id = randomId();
    secrets.set(id, g.secret);
    local.push({ id, kind, address: g.address, label: kind === "evm" ? "Main EVM" : "Main Solana", source: "local", createdAt: now });
    active[kind] = id;
  }
  session = { key, kdf, ct: "" };
  try {
    await persistVault({ fresh: true });
    await savePublic();
  } catch (e) {
    lock("reset", false);
    local = [];
    fixActive();
    publish();
    throw e;
  }
  clearFailures();
  publish({ initialized: true, unlocked: true, unlockedAt: Date.now(), lockedReason: undefined });
  markActivity();
  return [...local];
}

export async function unlock(passcode: string): Promise<void> {
  const { file, key, payload } = await openVault(passcode);
  const labels = new Map(local.map((a) => [a.id, a.label]));
  secrets.clear();
  const rebuilt: WalletAccount[] = [];
  let labelsChanged = false;
  for (const a of payload.accounts) {
    let address: string;
    try {
      address = addressOf(a.kind, a.secret);
    } catch {
      continue; // corrupt entry — skip rather than fail the whole unlock
    }
    secrets.set(a.id, a.secret);
    const label = labels.get(a.id) ?? a.label;
    if (label !== a.label) labelsChanged = true;
    rebuilt.push({ id: a.id, kind: a.kind, address, label, source: "local", createdAt: a.createdAt });
  }
  local = rebuilt;
  session = { key, kdf: file.kdf, ct: file.ct };
  fixActive();
  await savePublic().catch(() => undefined);
  publish({ unlocked: true, unlockedAt: Date.now(), lockedReason: undefined, initialized: true });
  markActivity();

  if (file.kdf.iterations < KDF_ITERATIONS) {
    // Transparently upgrade older/weaker KDF parameters.
    const kdf = newKdf();
    const upgraded = await deriveVaultKey(passcode, kdf);
    if (session) session = { key: upgraded, kdf, ct: session.ct };
    await persistVault().catch(() => undefined);
  } else if (labelsChanged) {
    await persistVault().catch(() => undefined);
  }
}

/** Drops every decrypted secret and the AES key from memory. */
export function lock(reason: LockReason = "manual", notify = true): void {
  secrets.clear();
  session = null;
  const wasUnlocked = useWallet.getState().unlocked;
  useWallet.setState({ unlocked: false, lockedReason: reason, lockedAt: Date.now(), unlockedAt: undefined });
  if (notify && wasUnlocked && reason === "manual") broadcast({ t: "lock" });
}

export async function changePasscode(current: string, next: string): Promise<void> {
  if (next.length < MIN_PASSCODE) throw new Error(`New passcode must be at least ${MIN_PASSCODE} characters`);
  if (next === current) throw new Error("New passcode must be different");
  assertUnlocked();
  await openVault(current); // re-auth
  const kdf = newKdf();
  const key = await deriveVaultKey(next, kdf);
  if (!session) throw new Error("Wallet is locked");
  session = { key, kdf, ct: session.ct };
  await persistVault();
}

export async function generateAccount(kind: ChainKind, label?: string): Promise<WalletAccount> {
  assertUnlocked();
  const g = generateSecret(kind);
  const acct: WalletAccount = { id: randomId(), kind, address: g.address, label: cleanLabel(label, nextLabel(kind)), source: "local", createdAt: Date.now() };
  return addLocal(acct, g.secret, false);
}

export async function importAccount(kind: ChainKind, secret: string, label?: string): Promise<WalletAccount> {
  assertUnlocked();
  const parsed = parseImport(kind, secret);
  if (local.some((a) => a.kind === kind && normAddr(a.address) === normAddr(parsed.address))) {
    throw new Error("This key is already in your wallet");
  }
  const acct: WalletAccount = {
    id: randomId(),
    kind,
    address: parsed.address,
    label: cleanLabel(label, `Imported ${kind === "evm" ? "EVM" : "SOL"}`),
    source: "local",
    createdAt: Date.now(),
  };
  // The user already holds this key elsewhere, so it counts as backed up.
  return addLocal(acct, parsed.secret, true);
}

async function addLocal(acct: WalletAccount, secret: string, isBackedUp: boolean): Promise<WalletAccount> {
  secrets.set(acct.id, secret);
  local = [...local, acct];
  if (isBackedUp) backedUp[acct.id] = true;
  if (!active[acct.kind]) active[acct.kind] = acct.id;
  try {
    await persistVault();
  } catch (e) {
    secrets.delete(acct.id);
    local = local.filter((a) => a.id !== acct.id);
    delete backedUp[acct.id];
    fixActive();
    publish();
    throw e;
  }
  await savePublic();
  publish();
  markActivity();
  return acct;
}

/** Re-authenticates with the passcode and returns the secret. Caller must not persist or log it. */
export async function exportSecret(id: string, passcode: string): Promise<string> {
  const { payload } = await openVault(passcode);
  const hit = payload.accounts.find((a) => a.id === id);
  if (!hit) throw new Error("Account not found in vault");
  const secret = hit.secret;
  for (const a of payload.accounts) a.secret = "";
  return secret;
}

export async function removeAccount(id: string): Promise<void> {
  const inj = (["evm", "svm"] as ChainKind[]).find((k) => injected[k]?.id === id);
  if (inj) {
    await disconnectInjected(inj);
    return;
  }
  assertUnlocked();
  const prev = local;
  const prevSecret = secrets.get(id);
  local = local.filter((a) => a.id !== id);
  secrets.delete(id);
  try {
    await persistVault();
  } catch (e) {
    local = prev;
    if (prevSecret) secrets.set(id, prevSecret);
    throw e;
  }
  delete backedUp[id];
  fixActive();
  await savePublic();
  publish();
}

export async function renameAccount(id: string, label: string): Promise<void> {
  const kind = (["evm", "svm"] as ChainKind[]).find((k) => injected[k]?.id === id);
  if (kind) {
    const a = injected[kind];
    if (a) injected[kind] = { ...a, label: cleanLabel(label, a.label) };
    publish();
    return;
  }
  local = local.map((a) => (a.id === id ? { ...a, label: cleanLabel(label, a.label) } : a));
  publish();
  await savePublic();
  // Labels inside the encrypted payload are refreshed now if unlocked, otherwise on next unlock.
  if (session) await persistVault().catch(() => undefined);
}

export async function setActive(kind: ChainKind, id: string): Promise<void> {
  const ok = local.some((a) => a.id === id && a.kind === kind) || injected[kind]?.id === id;
  if (!ok) throw new Error("Unknown account");
  active[kind] = id;
  publish();
  await savePublic().catch(() => undefined);
}

export async function markBackedUp(id: string): Promise<void> {
  backedUp[id] = true;
  publish();
  await savePublic().catch(() => undefined);
}

/** Irreversibly deletes the vault from this device. Funds are lost unless keys were backed up. */
export async function resetWallet(): Promise<void> {
  lock("reset", false);
  await enqueue(async () => {
    await del(VAULT_KEY);
    await del(PUBLIC_KEY);
  });
  local = [];
  active = {};
  backedUp = {};
  fixActive();
  clearFailures();
  publish({ initialized: false });
  broadcast({ t: "changed" });
}

// ─── Injected wallets ───────────────────────────────────────────────

function readInjectedFlags(): Partial<Record<ChainKind, boolean>> {
  try {
    return (JSON.parse(localStorage.getItem(INJECTED_KEY) ?? "{}") as Partial<Record<ChainKind, boolean>>) ?? {};
  } catch {
    return {};
  }
}
function writeInjectedFlag(kind: ChainKind, on: boolean): void {
  try {
    const f = readInjectedFlags();
    // false = the user disconnected on purpose, so the in-app silent reconnect leaves it alone.
    f[kind] = on;
    localStorage.setItem(INJECTED_KEY, JSON.stringify(f));
  } catch {
    /* ignore */
  }
}

function setInjected(kind: ChainKind, address: string | undefined): void {
  if (!address) {
    delete injected[kind];
  } else {
    const prev = injected[kind];
    injected[kind] = {
      id: `inj:${kind}`,
      kind,
      address,
      label: prev?.label ?? (kind === "evm" ? evmProviderName() : solProviderName()),
      source: "injected",
      createdAt: prev?.createdAt ?? Date.now(),
    };
  }
  fixActive();
  publish();
}

let evmListener: ((...args: unknown[]) => void) | null = null;
let evmChainListener: ((...args: unknown[]) => void) | null = null;
let solListener: ((...args: unknown[]) => void) | null = null;
let evmWatched: Eip1193Provider | undefined;
let solWatched: SolanaInjected | undefined;

function watchInjected(kind: ChainKind): void {
  // The user can switch between installed wallets: move the listeners to whichever provider is picked now.
  if (kind === "evm") {
    const p = evmProvider();
    if (p === evmWatched) return;
    if (evmWatched && evmListener) {
      evmWatched.removeListener?.("accountsChanged", evmListener);
      if (evmChainListener) evmWatched.removeListener?.("chainChanged", evmChainListener);
    }
    evmWatched = p;
    if (!p?.on) return;
    evmListener = (...args: unknown[]) => {
      const list = Array.isArray(args[0]) ? (args[0] as unknown[]) : [];
      const next = typeof list[0] === "string" ? (list[0] as string) : undefined;
      setInjected("evm", next);
      if (!next) writeInjectedFlag("evm", false);
    };
    evmChainListener = (...args: unknown[]) => {
      const id = typeof args[0] === "string" ? parseInt(args[0], 16) : Number(args[0]);
      useDiscovery.setState({ evmChainId: Number.isFinite(id) ? id : undefined });
    };
    p.on("accountsChanged", evmListener);
    p.on("chainChanged", evmChainListener);
    void p
      .request({ method: "eth_chainId" })
      .then((id) => useDiscovery.setState({ evmChainId: typeof id === "string" ? parseInt(id, 16) : undefined }))
      .catch(() => undefined);
  }
  if (kind === "svm") {
    const p = solProvider();
    if (p === solWatched) return;
    if (solWatched && solListener) solWatched.removeListener?.("accountChanged", solListener);
    solWatched = p;
    if (!p?.on) return;
    solListener = (...args: unknown[]) => {
      const pk = args[0] as { toBase58?: () => string } | null | undefined;
      if (pk && typeof pk.toBase58 === "function") setInjected("svm", pk.toBase58());
      else void connectSol(true).then((a) => setInjected("svm", a)).catch(() => setInjected("svm", undefined));
    };
    p.on("accountChanged", solListener);
  }
}

export async function connectInjected(kind: ChainKind): Promise<WalletAccount> {
  const address = kind === "evm" ? await connectEvm(false) : await connectSol(false);
  if (!address) throw new Error("Wallet returned no account");
  setInjected(kind, address);
  writeInjectedFlag(kind, true);
  watchInjected(kind);
  const acct = injected[kind] as WalletAccount;
  await setActive(kind, acct.id);
  return acct;
}

export async function disconnectInjected(kind: ChainKind): Promise<void> {
  writeInjectedFlag(kind, false);
  if (kind === "svm") await disconnectSol();
  if (kind === "evm" && useDiscovery.getState().selected.evm === "walletconnect") await disconnectWalletConnect();
  setInjected(kind, undefined);
  await savePublic().catch(() => undefined);
}

async function restoreInjected(): Promise<void> {
  const flags = readInjectedFlags();
  for (const kind of ["evm", "svm"] as ChainKind[]) {
    if (!flags[kind]) continue;
    try {
      const addr = kind === "evm" ? await connectEvm(true) : await connectSol(true);
      if (addr) {
        setInjected(kind, addr);
        watchInjected(kind);
      }
    } catch {
      /* not trusted anymore / not installed — leave disconnected */
    }
  }
}

/**
 * Inside a wallet's own browser on a phone (Phantom, Solflare, Backpack, MetaMask…), connect without a prompt when that
 * wallet already trusts this site, so opening Claudio there shows the wallet as connected. Never after a disconnect.
 */
async function reconnectInApp(): Promise<void> {
  const flags = readInjectedFlags();
  for (const kind of ["svm", "evm"] as ChainKind[]) {
    if (kind in flags || injected[kind]) continue;
    if ((kind === "evm" ? selectedWallet("evm") : selectedWallet("svm"))?.id === "walletconnect") continue;
    if (!(kind === "evm" ? evmProvider() : solProvider())) continue;
    try {
      const addr = kind === "evm" ? await connectEvm(true) : await connectSol(true);
      if (addr) {
        setInjected(kind, addr);
        writeInjectedFlag(kind, true);
        watchInjected(kind);
      }
    } catch {
      /* not trusted yet: the wallet buttons connect with a prompt */
    }
  }
}

// ─── Signers (internal to lib/wallet — used by send.ts only) ────────

export type LocalEvmAccount = ReturnType<typeof privateKeyToAccount>;

/** Runs `fn` with a viem local account for `id`. Requires unlocked. */
export async function withEvmSigner<T>(id: string, fn: (acct: LocalEvmAccount) => Promise<T>): Promise<T> {
  const secret = secrets.get(id);
  if (!secret) throw new Error("Wallet is locked");
  markActivity();
  return fn(privateKeyToAccount(secret as `0x${string}`));
}

/** Runs `fn` with a Solana Keypair for `id`; the key bytes are zeroed afterwards. */
export async function withSolSigner<T>(id: string, fn: (kp: Keypair) => Promise<T>): Promise<T> {
  const secret = secrets.get(id);
  if (!secret) throw new Error("Wallet is locked");
  markActivity();
  const bytes = bs58.decode(secret);
  try {
    return await fn(Keypair.fromSecretKey(bytes));
  } finally {
    wipe(bytes); // Keypair.fromSecretKey keeps a reference to `bytes`, so this zeroes its key too
  }
}

// ─── Auto-lock ──────────────────────────────────────────────────────

let lastActivity = Date.now();
let hiddenAt: number | null = null;

export function markActivity(): void {
  lastActivity = Date.now();
}

/** ms until auto-lock (for countdown UI). */
export function msUntilAutoLock(): number {
  const ms = useWallet.getState().autoLockMin * 60_000;
  return Math.max(0, lastActivity + ms - Date.now());
}

export function setAutoLockMinutes(min: number): void {
  const n = Math.round(Math.min(240, Math.max(1, min)));
  try {
    localStorage.setItem(AUTOLOCK_KEY, String(n));
  } catch {
    /* ignore */
  }
  useWallet.setState({ autoLockMin: n });
  markActivity();
}

function installAutoLock(): void {
  const opts: AddEventListenerOptions = { passive: true, capture: true };
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart", "mousemove", "scroll"]) {
    window.addEventListener(ev, markActivity, opts);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    const s = useWallet.getState();
    if (hiddenAt !== null && s.unlocked && Date.now() - hiddenAt > s.autoLockMin * 60_000) lock("hidden");
    hiddenAt = null;
  });
  window.setInterval(() => {
    const s = useWallet.getState();
    if (!s.unlocked) return;
    const limit = s.autoLockMin * 60_000;
    const now = Date.now();
    if (hiddenAt !== null && now - hiddenAt > limit) lock("hidden");
    else if (now - lastActivity > limit) lock("idle");
  }, 5_000);
}

// ─── requireUnlocked / prompt ───────────────────────────────────────

interface Waiter {
  resolve: () => void;
  reject: (e: Error) => void;
}
const waiters: Waiter[] = [];

/** Opens the unlock/setup sheet (without awaiting). */
export function openWalletPrompt(reason?: string): void {
  useWalletPrompt.setState({ open: true, reason });
}

/**
 * Resolves when signing is possible: immediately if unlocked (or every active account is an injected
 * wallet); otherwise opens the unlock/setup sheet and resolves on unlock, rejects if the user cancels.
 */
export function requireUnlocked(reason?: string): Promise<void> {
  const s = useWallet.getState();
  if (s.unlocked) {
    markActivity();
    return Promise.resolve();
  }
  const ids = (["evm", "svm"] as ChainKind[]).map((k) => s.active[k]).filter((x): x is string => !!x);
  if (s.hydrated && ids.length > 0 && ids.every((id) => id.startsWith("inj:"))) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    waiters.push({ resolve, reject });
    openWalletPrompt(reason);
  });
}

/**
 * Closes the prompt. Pending callers resolve when `success` is true (unlock, create, or an injected
 * wallet was connected) or the keystore is unlocked; otherwise they reject as cancelled.
 */
export function closeWalletPrompt(success?: boolean): void {
  const ok = success === true || useWallet.getState().unlocked;
  const list = waiters.splice(0);
  useWalletPrompt.setState({ open: false, reason: undefined });
  for (const w of list) {
    if (ok) w.resolve();
    else w.reject(new Error("Wallet unlock cancelled"));
  }
}

// ─── Boot ───────────────────────────────────────────────────────────

if (typeof window !== "undefined") {
  installAutoLock();
  startDiscovery(); // find wallets from the first paint, not only once a wallet button is on screen
  void hydrate()
    .then(() => restoreInjected())
    .then(() => {
      // In-app browsers can inject after load; discovery rescans for ~4 s, so try again once it has looked.
      if (isMobileDevice()) for (const ms of [600, 2000, 4500]) setTimeout(() => void reconnectInApp(), ms);
    });
  // Drop secrets when the page is being discarded/frozen into bfcache.
  window.addEventListener("pagehide", () => {
    if (useWallet.getState().unlocked) lock("hidden", false);
  });
}
