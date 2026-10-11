// Hosted-agents configuration, read lazily so Replit Secrets / test overrides set after import still apply.
//
//   VAULT_MASTER_KEY            32+ random bytes, hex or base64 (required for escrow wallets)
//   VAULT_MASTER_KEY_PREVIOUS   the previous master key during a rotation (rows on it are re-wrapped by admins)
//   HOSTED_LIVE_TRADING         "true" enables real signing (default off: every trade is paper)
//   HOSTED_KILL                 "true" forces the global kill switch on (overrides the admin toggle)
//   HOSTED_LLM_SHARE            fraction of the shared free-model budget hosted agents may use (default 0.4)
//   HOSTED_TICK_MS              runner tick (default 60 s)
//   HOSTED_MIN_INTERVAL_MS      minimum time between two decisions of one agent (default 10 min)
//   HOSTED_LEDGER_POLL_MS       escrow inflow poll (default 5 min)
//   HOSTED_LOG_KEEP             decision-log rows kept per agent (default 500)
//   HOSTED_ROOMS                rooms hosted agents may post in (default "general,markets"; token rooms t-<mint> too)

function num(name: string, def: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
}

export const hostedEnv = {
  liveTrading: () => (process.env.HOSTED_LIVE_TRADING ?? "").trim().toLowerCase() === "true",
  forcedKill: () => (process.env.HOSTED_KILL ?? "").trim().toLowerCase() === "true",
  llmShare: () => num("HOSTED_LLM_SHARE", 0.4, 0, 0.9),
  tickMs: () => num("HOSTED_TICK_MS", 60_000, 1_000, 3_600_000),
  minIntervalMs: () => num("HOSTED_MIN_INTERVAL_MS", 10 * 60_000, 5_000, 24 * 3_600_000),
  ledgerPollMs: () => num("HOSTED_LEDGER_POLL_MS", 5 * 60_000, 30_000, 24 * 3_600_000),
  logKeep: () => Math.floor(num("HOSTED_LOG_KEEP", 500, 50, 10_000)),
  rooms: () =>
    (process.env.HOSTED_ROOMS ?? "general,markets")
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => /^[a-z0-9-]{2,64}$/.test(s)),
};

export const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const LAMPORTS = 1_000_000_000;
