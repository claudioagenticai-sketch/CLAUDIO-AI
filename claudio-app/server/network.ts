// Mainnet vs testnet configuration (CLAUDIO_NETWORK=testnet). On testnet every chain-specific setting is read from
// `<NAME>_TESTNET`, so a mainnet RPC, contract address or treasury can never leak into a testnet run (or back).
import { NETWORK } from "@shared/chains";

export { NETWORK };
export const IS_TESTNET = NETWORK === "testnet";

function read(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** Chain-specific setting (RPC URLs, contract addresses, treasuries): on testnet ONLY `<name>_TESTNET`. */
export function netEnv(name: string): string | undefined {
  return read(IS_TESTNET ? `${name}_TESTNET` : name);
}

/** Env var name `netEnv(name)` reads, for messages ("set FEE_SPLITTER_FACTORY_HOOD_TESTNET"). */
export function netEnvName(name: string): string {
  return IS_TESTNET ? `${name}_TESTNET` : name;
}

/** Server keys (attestor, relayer): on testnet `<name>_TESTNET`, falling back to `<name>`. */
export function netSecret(name: string): string | undefined {
  return (IS_TESTNET ? read(`${name}_TESTNET`) : undefined) ?? read(name);
}
