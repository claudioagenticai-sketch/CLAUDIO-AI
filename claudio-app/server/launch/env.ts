// Launch-module configuration. Read lazily so values loaded after import (dotenv, Replit secrets) still apply.
import { randomBytes } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { getAddress, isAddress, type Address } from "viem";
import type { ChainId } from "@shared/chains";
import { launchRpcUrls } from "../rpc";
import { deployedAddress, deployedTreasury } from "../deployments";
import { netEnv } from "../network";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function evmAddr(name: string): Address | undefined {
  const v = netEnv(name);
  // Lowercase first: accept non-checksummed input, then normalize to the checksum form.
  return v && isAddress(v.toLowerCase()) ? getAddress(v.toLowerCase()) : undefined;
}

export function isSolAddress(v: string): boolean {
  try {
    return new PublicKey(v).toBase58() === v;
  } catch {
    return false;
  }
}

export const launchEnv = {
  /** Receives the platform's 30% (Clanker reward slot; must match the FeeSplitterFactory treasury). */
  platformTreasuryEvm(chain?: ChainId): Address | undefined {
    return evmAddr("PLATFORM_TREASURY_EVM") ?? (chain ? deployedTreasury(chain) : undefined);
  },
  // The Solana platform recipient is NOT configurable: PLATFORM_FEE_WALLET_SOL (shared/platform.ts), guarded by
  // server/platform/treasury.ts (a differing PLATFORM_TREASURY_SOL refuses Solana launches).
  /** Deployed FeeSplitterFactory per EVM chain. */
  splitterFactory(chain: ChainId): Address | undefined {
    return deployedAddress(chain, "FeeSplitterFactory");
  },
  /** Deployed ShareSplitterFactory (splits the creator side between the launcher and social accounts). */
  shareFactory(chain: ChainId): Address | undefined {
    return deployedAddress(chain, "ShareSplitterFactory");
  },
  rpcUrl(chain: ChainId): string {
    return launchRpcUrls(chain)[0] ?? "";
  },
  /** Address Lookup Table holding pump.fun's static accounts (lets create+split+buy fit in ONE tx). */
  pumpLut(): string | undefined {
    const v = env("PUMP_LUT_ADDRESS");
    return v && isSolAddress(v) ? v : undefined;
  },
  /** TESTING ONLY: allow the [create | split | buy] layout (fee split not atomic with create). */
  pumpAllowSplitLayout(): boolean {
    return env("PUMP_ALLOW_SPLIT_LAYOUT") === "true";
  },
  pumpPriorityMicroLamports(): number {
    const n = Number(env("PUMP_PRIORITY_MICROLAMPORTS") ?? "200000");
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 200_000;
  },
  pinataJwt(): string | undefined {
    return env("PINATA_JWT");
  },
  pinataGateway(): string {
    return (env("PINATA_GATEWAY") ?? "ipfs.io").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  },
  publicBaseUrl(): string | undefined {
    return env("PUBLIC_BASE_URL")?.replace(/\/+$/, "");
  },
};

// NOTE: tsconfig has no `target` (TS default ES5): no bigint literals (`10n`), no bigint `**`, no Map/Set iteration.
export const B0 = BigInt(0);
export const B1 = BigInt(1);
export const BPS = BigInt(10_000);

export function pow10(decimals: number): bigint {
  let r = B1;
  const ten = BigInt(10);
  for (let i = 0; i < decimals; i++) r *= ten;
  return r;
}

/** Exact decimal string → integer base units (no float drift). 0.01, 18 → 10^16. */
export function toUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return B0;
  const s = amount.toFixed(Math.min(decimals, 12)); // 12 dp avoids binary-float noise
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * pow10(decimals) + BigInt(fracPadded || "0");
}

export function fromUnits(v: bigint, decimals: number): number {
  const neg = v < B0;
  const a = neg ? -v : v;
  const base = pow10(decimals);
  const whole = a / base;
  const frac = a % base;
  const n = Number(whole) + Number(frac) / Number(base);
  return neg ? -n : n;
}

export function randomHex32(): `0x${string}` {
  return `0x${randomBytes(32).toString("hex")}`;
}
