// Passport: an SPL Memo transaction signed by the owner wallet — `claudio:passport:<agentId>:<agentWallet>` —
// that binds the agent to its wallet on-chain. Built and signed in the browser with the active Solana wallet;
// a paste-the-signature fallback covers wallets that can't (or owners who'd rather send it themselves).
import { useState } from "react";
import { Buffer } from "buffer";
import { ExternalLink, Fingerprint, PenLine } from "lucide-react";
import { CHAINS } from "@shared/chains";
import type { AgentProfile } from "@shared/agents";
import { Age } from "@/components/kit";
import { signAndSend, useActiveAccount } from "@/lib/wallet";
import { bytesToB64 } from "@/lib/wallet/codec";
import { solConnection } from "@/lib/wallet/rpc";
import { shortAddr } from "@/lib/format";
import { ActionButton, Card } from "@/features/wallet/ui";
import { cn } from "@/lib/utils";
import { agentsApi, errorText, isUnavailable, useInvalidateAgent, useOwnerQuery } from "../api";
import { CopyField } from "./ExternalKeys";
import { inputCls } from "./CreateAgent";

const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnVQ6KkpYqTkzo2HmQhsZVjRr";

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function passportMemo(agentId: string, wallet: string | null | undefined): string | null {
  return wallet && SOL_ADDR.test(wallet) ? `claudio:passport:${agentId}:${wallet}` : null;
}

async function sendMemo(owner: string, memo: string): Promise<string> {
  const { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } = await import("@solana/web3.js");
  const payer = new PublicKey(owner);
  const ix = new TransactionInstruction({
    programId: new PublicKey(MEMO_PROGRAM),
    keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
    data: Buffer.from(memo, "utf8"),
  });
  const { blockhash } = await solConnection().getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  const { hashes } = await signAndSend("sol", [{ kind: "svm", base64: bytesToB64(tx.serialize()), signers: [owner], description: "Register agent passport (memo, no transfer)", partiallySigned: false }]);
  if (!hashes[0]) throw new Error("The transaction didn't land");
  return hashes[0];
}

export function PassportCard({ agent }: { agent: AgentProfile }) {
  const invalidate = useInvalidateAgent();
  const acct = useActiveAccount("svm");
  // External agents without a wallet yet declare it here; it's bound by the passport.
  const [declared, setDeclared] = useState("");
  const needsWallet = !agent.wallet && agent.mode === "external";
  const agentWallet = agent.wallet ?? (declared.trim() || null);
  const owner = agent.ownerWallet ?? "";
  // Prefer the server's exact memo; fall back to the documented format.
  const info = useOwnerQuery("passport", agent.slug, (slug) => agentsApi.passportInfo(slug), { enabled: !agent.passport });
  const memo = (!needsWallet && info.data?.memo) || passportMemo(agent.id, agentWallet);
  const [manual, setManual] = useState(false);
  const [sig, setSig] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const rightWallet = !!acct && acct.address === owner;

  const register = async (tx: string) => {
    await agentsApi.passport(agent.slug, tx.trim(), needsWallet ? agentWallet ?? undefined : undefined);
    setDone(tx.trim());
    invalidate(agent.slug);
  };

  const signHere = async () => {
    if (!memo) return;
    setBusy(true);
    setError(null);
    try {
      const tx = await sendMemo(owner, memo);
      await register(tx);
    } catch (e) {
      setError(isUnavailable(e) ? "Passport registration isn't live yet — your memo is on-chain; paste its signature here later." : errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const submitManual = async () => {
    setBusy(true);
    setError(null);
    try {
      await register(sig);
    } catch (e) {
      setError(isUnavailable(e) ? "Passport registration is coming soon." : errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const passport = agent.passport;
  return (
    <Card title="Passport" icon={<Fingerprint />} right={passport || done ? <span className="chip chip-buy font-semibold">Registered</span> : <span className="chip">Not yet</span>}>
      {passport || done ? (
        <div className="space-y-2 text-[12.5px]">
          <p className="leading-relaxed text-text-3">Your wallet signed an on-chain note that ties this agent to its wallet. It's one of the steps to get verified.</p>
          <a
            href={CHAINS.sol.explorerTx(passport?.tx ?? done!)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-text-2 hover:text-text"
          >
            See the transaction <ExternalLink className="h-3 w-3" />
          </a>
          {passport && (
            <div className="text-text-3">
              Registered <Age from={Date.parse(passport.registeredAt)} className="text-text-3" /> ago
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[12.5px] leading-relaxed text-text-3">
            A passport proves who runs this agent. Your owner wallet signs a tiny memo transaction (no SOL moves except the ~0.000005 network fee). It's one of the
            steps to get the <b className="text-text-2">Verified</b> badge.
          </p>
          {needsWallet && (
            <label className="block">
              <span className="text-[12.5px] font-semibold text-text">Your agent's wallet</span>
              <input
                value={declared}
                onChange={(e) => setDeclared(e.target.value)}
                placeholder="Solana address the agent signs with"
                spellCheck={false}
                className={cn(inputCls, "num mt-1 h-11 text-[12px]", declared && !memo && "border-sell")}
              />
              <span className="mt-1 block text-[11px] text-text-3">The passport binds this agent to that wallet. Creator fees from its coins go there.</span>
            </label>
          )}
          {!memo ? (
            !needsWallet && <p className="rounded-[3px] bg-panel-2 px-3 py-2 text-[12px] text-text-3">The agent's wallet isn't ready yet. Come back once it has one.</p>
          ) : (
            <>
              <div>
                <div className="eyebrow mb-1.5">Memo</div>
                <CopyField id="memo" value={memo} />
              </div>
              {!manual ? (
                <>
                  <ActionButton className="w-full" busy={busy} disabled={!rightWallet} onClick={signHere}>
                    {!busy && <PenLine />}
                    Register passport
                  </ActionButton>
                  {!rightWallet && (
                    <p className="text-[11.5px] text-warn">
                      Switch to your owner wallet {shortAddr(owner)} to sign{acct ? ` (active: ${shortAddr(acct.address)})` : ""}.
                    </p>
                  )}
                  <button type="button" onClick={() => setManual(true)} className="text-[12px] font-semibold text-text-3 hover:text-text">
                    I'll send the memo myself →
                  </button>
                </>
              ) : (
                <>
                  <ol className="list-decimal space-y-1 pl-4 text-[12px] leading-relaxed text-text-3">
                    <li>From {shortAddr(owner)}, send a transaction with the SPL Memo above.</li>
                    <li>Paste its signature here.</li>
                  </ol>
                  <input value={sig} onChange={(e) => setSig(e.target.value)} placeholder="Transaction signature" spellCheck={false} className={cn(inputCls, "num h-11 text-[12px]")} />
                  <div className="flex gap-2">
                    <ActionButton tone="ghost" onClick={() => setManual(false)}>
                      Back
                    </ActionButton>
                    <ActionButton className="flex-1" busy={busy} disabled={sig.trim().length < 64} onClick={submitManual}>
                      Submit signature
                    </ActionButton>
                  </div>
                </>
              )}
            </>
          )}
          {error && <p role="alert" className="text-[12px] text-sell">{error}</p>}
        </div>
      )}
    </Card>
  );
}
