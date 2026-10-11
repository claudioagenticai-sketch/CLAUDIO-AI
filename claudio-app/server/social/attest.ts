// Signs "identity -> wallet" claim attestations for SocialVaultFactory.
// The key lives only in the SOCIAL_ATTESTOR_KEY secret. It can bind UNCLAIMED vaults, so treat it like a hot wallet:
// rotate it on-chain (factory.setAttestor) if it ever leaks, and keep a bind delay + guardian in production.
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { CHAINS, type ChainId } from "@shared/chains";
import { evmClient } from "../trade/evm";
import { deployedAddress } from "../deployments";
import { netSecret } from "../network";

export const SOCIAL_FACTORY_ABI = [
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "vaultOf", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] },
  { type: "function", name: "attestor", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "bindDelay", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  {
    type: "function",
    name: "bind",
    stateMutability: "nonpayable",
    inputs: [
      { type: "bytes32", name: "identity" },
      { type: "address", name: "wallet" },
      { type: "uint256", name: "deadline" },
      { type: "bytes", name: "signature" },
      { type: "address[]", name: "sweepTokens" },
    ],
    outputs: [{ type: "address" }],
  },
] as const;

export const SOCIAL_VAULT_ABI = [
  { type: "function", name: "beneficiary", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "pendingBeneficiary", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "readyAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "finalize", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "sweepMany", stateMutability: "nonpayable", inputs: [{ type: "address[]" }], outputs: [] },
] as const;

const BIND_TYPES = {
  Bind: [
    { name: "identity", type: "bytes32" },
    { name: "wallet", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

let account: PrivateKeyAccount | null | undefined;
function attestorAccount(): PrivateKeyAccount | null {
  if (account !== undefined) return account;
  const raw = netSecret("SOCIAL_ATTESTOR_KEY");
  account = raw ? privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex) : null;
  return account;
}

export function attestorAddress(): Address | null {
  return attestorAccount()?.address ?? null;
}

/** SocialVaultFactory per EVM chain: SOCIAL_VAULT_FACTORY_HOOD, _BSC, _BASE, _ARC, else the deployment record. */
export function socialFactory(chain: ChainId): Address | null {
  return deployedAddress(chain, "SocialVaultFactory") ?? null;
}

export interface BindAttestation {
  chain: ChainId;
  chainId: number;
  factory: Address;
  identity: Hex;
  wallet: Address;
  nonce: string;
  deadline: string;
  signature: Hex;
}

/** Signs a bind for the CURRENT on-chain nonce. Only call after the caller proved control of the identity. */
export async function signBind(chain: ChainId, identity: Hex, wallet: Address, ttlSec = 15 * 60): Promise<BindAttestation> {
  const signer = attestorAccount();
  if (!signer) throw new Error("SOCIAL_ATTESTOR_KEY is not configured");
  const factory = socialFactory(chain);
  const chainId = CHAINS[chain].evmChainId;
  if (!factory || !chainId) throw new Error(`Social vaults are not deployed on ${CHAINS[chain].name}`);

  const client = evmClient(chain);
  const [nonce, onchainAttestor] = await Promise.all([
    client.readContract({ address: factory, abi: SOCIAL_FACTORY_ABI, functionName: "nonces", args: [identity] }),
    client.readContract({ address: factory, abi: SOCIAL_FACTORY_ABI, functionName: "attestor" }),
  ]);
  if (getAddress(onchainAttestor) !== signer.address) {
    throw new Error(`Attestor mismatch on ${CHAINS[chain].name}: factory expects ${onchainAttestor}`);
  }
  const deadline = BigInt(Math.floor(Date.now() / 1000) + ttlSec);
  const signature = await signer.signTypedData({
    // EIP-712 domain name: must match the one fixed in SocialVaultFactory.
    domain: { name: "Claudio SocialVault", version: "1", chainId, verifyingContract: factory },
    types: BIND_TYPES,
    primaryType: "Bind",
    message: { identity, wallet: getAddress(wallet), nonce, deadline },
  });
  return { chain, chainId, factory, identity, wallet: getAddress(wallet), nonce: nonce.toString(), deadline: deadline.toString(), signature };
}

/** Where `identity`'s fees go on `chain` (deployed or not). */
export async function vaultAddress(chain: ChainId, identity: Hex): Promise<Address | null> {
  const factory = socialFactory(chain);
  if (!factory) return null;
  return evmClient(chain).readContract({ address: factory, abi: SOCIAL_FACTORY_ABI, functionName: "vaultOf", args: [identity] });
}
