// Launch state machine: form → (pin metadata, plan + simulate) → review → sign & send → confirm → success.
import { useCallback, useRef, useState } from "react";
import { CHAINS, type ChainId } from "@shared/chains";
import { LAUNCHPADS, type LaunchpadId } from "@shared/launchpads";
import type { LaunchRequest, PreparedTx } from "@shared/types";
import { useHistory } from "@/lib/history";
import { useSettings } from "@/lib/store";
import { SendError, requireUnlocked, signAndSend } from "@/lib/wallet";
import { launchApi, launchErrorMessage, type PlanResponse, type PublicLaunch } from "./api";
import { coinFieldErrors, socialUrl } from "./CoinFields";
import { shareTotals, useLaunchDraft } from "./draft";
import { addMintSignature, type VanityResult } from "./vanity";

export type FlowPhase = "idle" | "preparing" | "review" | "signing" | "confirming" | "success";

export interface FlowState {
  phase: FlowPhase;
  step?: string;
  plan?: PlanResponse;
  error?: string;
  hashes: string[];
  launch?: PublicLaunch;
}

export interface FlowInput {
  chain: ChainId;
  launchpad?: LaunchpadId;
  creator?: string;
  devBuy: number;
  vanity?: VanityResult;
}

/** Solana blockhashes expire after ~60–90 s; re-plan before signing if the review sat longer than this. */
const SOL_PLAN_TTL_MS = 45_000;

export function validateForm(input: FlowInput): string | null {
  const d = useLaunchDraft.getState();
  if (!input.launchpad) return "Pick a launchpad";
  if (!d.name.trim()) return "Give your coin a name";
  if (!d.symbol.trim()) return "Add a ticker";
  const fieldErr = coinFieldErrors(input.launchpad, d.name, d.symbol);
  if (fieldErr.name) return fieldErr.name;
  if (fieldErr.symbol) return fieldErr.symbol;
  if (!d.image) return "Add an image";
  if (!input.creator) return `Connect a ${CHAINS[input.chain].kind === "evm" ? "EVM" : "Solana"} wallet`;
  if (d.vanityEnabled && input.chain === "sol" && !input.vanity) return "Finish grinding your vanity address (or turn it off)";
  const svm = CHAINS[input.chain].kind === "svm";
  if (d.feeTo === "agent" && svm && !d.agentSlug) return "Pick one of your agents (or choose My wallet)";
  if (svm) return null; // social / split routing is EVM-only; Solana sends the creator share to you or your agent
  if (d.feeTo === "social" && !d.feeSocialHandle.trim()) return "Enter the account that should receive the creator fees";
  if (d.feeTo === "split") {
    if (!d.feeShares.length) return "Add at least one account to share the creator fees with";
    if (d.feeShares.some((s) => !s.handle.trim())) return "Enter a handle for every account you share fees with";
    if (d.feeShares.some((s) => !(s.pct >= 1 && s.pct <= 100))) return "Each share must be between 1% and 100%";
    if (shareTotals(d.feeShares).socialPct > 100) return "The shares add up to more than 100%";
  }
  return null;
}

export function useLaunchFlow(input: FlowInput) {
  const [state, setState] = useState<FlowState>({ phase: "idle", hashes: [] });
  const inputRef = useRef(input);
  inputRef.current = input;
  const recordLaunch = useHistory((s) => s.recordLaunch);
  const updateLaunch = useHistory((s) => s.updateLaunch);

  const buildRequest = useCallback(async (onStep: (s: string) => void): Promise<LaunchRequest> => {
    const inp = inputRef.current;
    const d = useLaunchDraft.getState();
    const lp = LAUNCHPADS[inp.launchpad as LaunchpadId];
    const settings = useSettings.getState();
    const svm = CHAINS[inp.chain].kind === "svm";
    const slippageBps = settings.presets[settings.activePreset]?.slippageBps ?? 1500;
    const socials = {
      twitter: socialUrl("twitter", d.twitter),
      telegram: socialUrl("telegram", d.telegram),
      website: socialUrl("website", d.website),
    };
    onStep("Pinning metadata…");
    const meta = await launchApi.uploadMetadata({
      name: d.name.normalize("NFKC").replace(/\s+/g, " ").trim(),
      symbol: d.symbol.normalize("NFKC").trim().replace(/^\$+/, "").toUpperCase(),
      description: d.description.trim(),
      image: d.image!.url,
      twitter: socials.twitter,
      telegram: socials.telegram,
      website: socials.website,
      showName: true,
    });
    const tax =
      lp.tax.supported && d.taxMode === "tax" && (d.buyTaxBps > 0 || d.sellTaxBps > 0)
        ? { buyBps: d.buyTaxBps, sellBps: lp.tax.asymmetric ? d.sellTaxBps : d.buyTaxBps, durationSec: d.taxDurationSec || undefined }
        : undefined;
    return {
      chain: inp.chain,
      launchpad: inp.launchpad as LaunchpadId,
      name: d.name.normalize("NFKC").replace(/\s+/g, " ").trim(),
      symbol: d.symbol.normalize("NFKC").trim().replace(/^\$+/, "").toUpperCase(),
      description: d.description.trim() || undefined,
      imageUri: d.image!.uri,
      // https URL for indexers that can't resolve ipfs:// (pump.fun reads `uri` over HTTP).
      metadataUri: meta.url,
      socials,
      creator: inp.creator as string,
      devBuyNative: inp.devBuy,
      slippageBps,
      tax,
      vanitySalt: d.vanityEnabled && inp.chain === "sol" && inp.vanity ? inp.vanity.publicKey : undefined,
      mayhemMode: inp.launchpad === "pump" ? d.mayhem : undefined,
      agentSlug: svm && d.feeTo === "agent" && d.agentSlug ? d.agentSlug : undefined,
      beneficiary: !svm && d.feeTo === "social" && d.feeSocialHandle.trim() ? { provider: d.feeSocialProvider, handle: d.feeSocialHandle.trim() } : undefined,
      feeShares:
        !svm && d.feeTo === "split" && d.feeShares.length
          ? d.feeShares.map((s) => ({ provider: s.provider, handle: s.handle.trim(), bps: Math.round(s.pct * 100) }))
          : undefined,
    };
  }, []);

  const prepare = useCallback(async (): Promise<PlanResponse | null> => {
    const problem = validateForm(inputRef.current);
    if (problem) {
      setState({ phase: "idle", hashes: [], error: problem });
      return null;
    }
    setState({ phase: "preparing", hashes: [], step: "Preparing…" });
    try {
      const req = await buildRequest((step) => setState((s) => ({ ...s, step })));
      setState((s) => ({ ...s, step: "Building & simulating transactions…" }));
      const plan = await launchApi.plan(req);
      setState({ phase: "review", plan, hashes: [] });
      return plan;
    } catch (e) {
      setState({ phase: "idle", hashes: [], error: launchErrorMessage(e) });
      return null;
    }
  }, [buildRequest]);

  const confirm = useCallback(async () => {
    let plan = state.plan;
    if (!plan) return;
    const inp = inputRef.current;
    const chain = plan.plan.request.chain;
    try {
      if (CHAINS[chain].kind === "svm" && Date.now() - plan.createdAt > SOL_PLAN_TTL_MS) {
        setState((s) => ({ ...s, phase: "preparing", step: "Refreshing blockhash…", error: undefined }));
        const fresh = await prepare();
        if (!fresh) return;
        plan = fresh;
      }
      setState((s) => ({ ...s, phase: "signing", step: "Waiting for your signature…", error: undefined, plan }));
      await requireUnlocked(`Launch $${plan.plan.request.symbol}`);
      let txs: PreparedTx[] = plan.plan.txs;
      if (plan.plan.request.vanitySalt && inp.vanity && inp.vanity.publicKey === plan.plan.request.vanitySalt) {
        txs = addMintSignature(txs, inp.vanity);
      }
      let hashes: string[] = [];
      let sendErr: string | undefined;
      try {
        hashes = (await signAndSend(chain, txs)).hashes;
      } catch (e) {
        if (e instanceof SendError && e.hashes.length) {
          hashes = e.hashes;
          sendErr = e.message;
        } else throw e;
      }
      const req = plan.plan.request;
      recordLaunch({
        id: plan.id,
        chain,
        launchpad: req.launchpad,
        name: req.name,
        symbol: req.symbol,
        creator: req.creator,
        token: plan.plan.predicted.token,
        splitter: plan.plan.predicted.splitter,
        hashes,
        ts: Date.now(),
      });
      if (sendErr) {
        setState((s) => ({ ...s, phase: "review", hashes, error: `${sendErr} — sent ${hashes.length}/${txs.length}` }));
        // Still tell the server what landed so the dashboard can track it.
        void launchApi.confirm(plan.id, hashes).catch(() => undefined);
        return;
      }
      setState((s) => ({ ...s, phase: "confirming", step: "Confirming on-chain…", hashes }));
      let launch: PublicLaunch | undefined;
      try {
        launch = (await launchApi.confirm(plan.id, hashes)).launch;
        if (launch.token) updateLaunch(plan.id, { token: launch.token, splitter: launch.splitter });
      } catch {
        /* the chain is the source of truth; success screen still shows the hashes */
      }
      setState((s) => ({ ...s, phase: "success", hashes, launch }));
    } catch (e) {
      setState((s) => ({ ...s, phase: "review", error: e instanceof Error ? e.message : "Launch failed" }));
    }
  }, [state.plan, prepare, recordLaunch, updateLaunch]);

  const back = useCallback(() => setState({ phase: "idle", hashes: [] }), []);
  const clearError = useCallback(() => setState((s) => ({ ...s, error: undefined })), []);

  return { state, prepare, confirm, back, clearError };
}
