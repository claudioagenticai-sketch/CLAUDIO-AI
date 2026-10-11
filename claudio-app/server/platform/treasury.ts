// The Solana platform-fee recipient. Always the compiled-in PLATFORM_FEE_WALLET_SOL (shared/platform.ts): a change
// shows up in git history, while a hosting secret can be edited silently. If PLATFORM_TREASURY_SOL (or its _TESTNET
// twin) is set to anything else, Solana launches are refused with a clear error and an audit event — the env value is
// never used.
import { PLATFORM_FEE_WALLET_SOL } from "@shared/platform";
import { audit } from "../auth/audit";
import { LaunchError } from "../launch/types";

const NAMES = ["PLATFORM_TREASURY_SOL", "PLATFORM_TREASURY_SOL_TESTNET"];

/** `NAME=value` of the first treasury env var that differs from PLATFORM_FEE_WALLET_SOL, or null. */
export function treasuryEnvConflict(): string | null {
  for (const n of NAMES) {
    const v = process.env[n]?.trim();
    if (v && v !== PLATFORM_FEE_WALLET_SOL) return `${n}=${v}`;
  }
  return null;
}

let lastAudit = 0;

/** PLATFORM_FEE_WALLET_SOL, or throws 503 treasury_mismatch (and audits, at most every 10 min) on an env conflict. */
export function platformRecipientSol(actor?: string | null): string {
  const conflict = treasuryEnvConflict();
  if (conflict) {
    if (Date.now() - lastAudit > 10 * 60_000) {
      lastAudit = Date.now();
      audit({
        actor: actor ?? null,
        action: "platform.treasury_env_conflict",
        severity: "high",
        detail: { env: conflict, expected: PLATFORM_FEE_WALLET_SOL },
      });
    }
    throw new LaunchError(
      503,
      "treasury_mismatch",
      `Solana launches are paused: ${conflict.split("=")[0]} is set to a different address than Claudio's platform fee wallet ` +
        `(${PLATFORM_FEE_WALLET_SOL}). The fee wallet is fixed in code — remove that secret and restart.`,
    );
  }
  return PLATFORM_FEE_WALLET_SOL;
}
