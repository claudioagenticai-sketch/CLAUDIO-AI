// Message signing with the active Solana account (wallet sign-in). Local accounts sign in-browser with the
// unlocked keystore; browser wallets use their signMessage feature. Returns a base58 signature.
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";
import { getActiveAccount } from "./state";
import { requireUnlocked, withSolSigner } from "./keystore";
import { solProvider } from "./injected";

export async function signSolMessage(message: string): Promise<{ address: string; signature: string }> {
  const acct = getActiveAccount("svm");
  if (!acct) throw new Error("Set up or connect a Solana wallet first");
  const bytes = new TextEncoder().encode(message);
  if (acct.source === "local") {
    await requireUnlocked("Unlock your wallet to sign in");
    const sig = await withSolSigner(acct.id, async (kp) => ed25519.sign(bytes, kp.secretKey.slice(0, 32)));
    return { address: acct.address, signature: bs58.encode(sig) };
  }
  const p = solProvider();
  if (!p?.signMessage) throw new Error("This wallet can't sign messages — use a Claudio wallet or Phantom/Backpack/Solflare");
  const out = await p.signMessage(bytes, "utf8");
  const sig = out instanceof Uint8Array ? out : out.signature;
  return { address: acct.address, signature: bs58.encode(sig) };
}
