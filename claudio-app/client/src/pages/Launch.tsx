// Launch a coin.
//  Desktop: hero · flight plan (sticky section stepper with scroll-spy) ‖ the form ‖ sticky live preview + simulator,
//           a sticky submit bar across the page and a review dialog.
//  Mobile (<768px): 4-step flow (Coin → Setup → Dev buy & preview → Review) with a floating CTA bar that clears the dock's raised
//           Launch button (the Shell's dock already pads the safe area).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Link } from "wouter";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Flame,
  Rocket,
} from "lucide-react";
import { CHAINS, type ChainId } from "@shared/chains";
import { LAUNCHPADS, launchpadsForChain, type LaunchpadId } from "@shared/launchpads";
import { DEFAULT_CHAIN } from "@shared/platform";
import { ResponsiveSheet, TokenAvatar } from "@/components/kit";
import { useIsMobile } from "@/hooks/use-mobile";
import { fmtNative } from "@/lib/format";
import { haptic, useBoard, useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useActiveAccount, useNativeBalance } from "@/lib/wallet";
import { useAdapters } from "@/features/launch/api";
import { CoinDetailsFields, CoinIdentityFields } from "@/features/launch/CoinFields";
import { DevBuyCard, gasReserve, minDevBuy } from "@/features/launch/DevBuyCard";
import { shareTotals, useLaunchDraft } from "@/features/launch/draft";
import { ImageField } from "@/features/launch/ImageField";
import { CoinPreview, RewardsCard, SimulatorCard } from "@/features/launch/Insights";
import { OptionsCard, hasOptions } from "@/features/launch/OptionsCard";
import { FeeRecipientCard } from "@/features/launch/FeeRecipientCard";
import { ChainSwitch, LAUNCH_CHAINS, PlatformChips, PlatformDetail, useChainNote, usePadAvailability } from "@/features/launch/PlatformPicker";
import { ConfirmButton, ReviewPanel, canSign } from "@/features/launch/ReviewPanel";
import { simulateDevBuy } from "@/features/launch/sim";
import { SuccessOverlay } from "@/features/launch/SuccessOverlay";
import { Callout, Section, StepMarker, SubBlock, type StepState } from "@/features/launch/ui";
import { useLaunchFlow, validateForm } from "@/features/launch/useLaunchFlow";
import { useVanity } from "@/features/launch/vanity";

type SectionKey = "coin" | "story" | "platform" | "devbuy" | "fees" | "review";
const SECTION_ID: Record<SectionKey, string> = {
  coin: "launch-coin",
  story: "launch-story",
  platform: "launch-platform",
  devbuy: "launch-devbuy",
  fees: "launch-fees",
  review: "launch-review",
};
const SECTION_ORDER: SectionKey[] = ["coin", "story", "platform", "devbuy", "fees", "review"];
const SECTION_LABEL: Record<SectionKey, string> = {
  coin: "Coin",
  story: "Story & socials",
  platform: "Platform & options",
  devbuy: "Dev buy",
  fees: "Fee recipient",
  review: "Review",
};

const MOBILE_STEPS = ["Coin", "Setup", "Dev buy", "Review"] as const;

/** Which section a validation message points at (so the page can bring it into view). */
function sectionForProblem(problem: string): SectionKey {
  if (/image|name|ticker/i.test(problem)) return "coin";
  if (/launchpad|vanity/i.test(problem)) return "platform";
  if (/wallet|dev buy/i.test(problem)) return "devbuy";
  if (/fee|share|account|handle/i.test(problem)) return "fees";
  return "review";
}

export default function Launch() {
  const mobile = useIsMobile();
  const reduce = useReducedMotion();
  const quickBuy = useSettings((s) => s.quickBuy);
  const draft = useLaunchDraft();
  // The launch page keeps its own chain (Solana by default) instead of following the board's chain.
  const chain: ChainId = draft.launchChain && LAUNCH_CHAINS.includes(draft.launchChain) ? draft.launchChain : LAUNCH_CHAINS.includes(DEFAULT_CHAIN) ? DEFAULT_CHAIN : LAUNCH_CHAINS[0];
  const setChain = (c: ChainId) => {
    haptic();
    draft.patch({ launchChain: c });
  };

  const adaptersQ = useAdapters();
  const adapters = adaptersQ.data?.adapters;
  const availability = usePadAvailability(chain, adapters);
  const chainNote = useChainNote(chain);

  // Selected launchpad: remembered per chain, falling back to the first open one (Solana: pump.fun).
  const openPads = launchpadsForChain(chain)
    .filter((l) => availability(l.id).open)
    .map((l) => l.id)
    .join(",");
  const launchpad: LaunchpadId | undefined = useMemo(() => {
    const open = openPads ? (openPads.split(",") as LaunchpadId[]) : [];
    const remembered = draft.launchpadByChain[chain];
    if (remembered && open.includes(remembered)) return remembered;
    return open[0];
  }, [draft.launchpadByChain, chain, openPads]);
  const lp = launchpad ? LAUNCHPADS[launchpad] : undefined;

  const devBuy = draft.devBuyByChain[chain] ?? Math.max(quickBuy[chain] ?? 0, minDevBuy(launchpad));
  const setDevBuy = (v: number) => draft.patch({ devBuyByChain: { ...draft.devBuyByChain, [chain]: v } });

  const kind = CHAINS[chain].kind;
  const acct = useActiveAccount(kind);
  const { balance } = useNativeBalance(chain, acct?.address);
  const nativeUsd = useBoard((s) => s.status[chain]?.nativeUsd) || undefined;

  const vanity = useVanity();
  const vanityResult = vanity.state.status === "found" ? vanity.state.result : undefined;
  const flow = useLaunchFlow({ chain, launchpad, creator: acct?.address, devBuy, vanity: vanityResult });
  const fs = flow.state;

  const taxActive = !!lp?.tax.supported && draft.taxMode === "tax";
  const taxBps = taxActive ? { buy: draft.buyTaxBps, sell: lp?.tax.asymmetric ? draft.sellTaxBps : draft.buyTaxBps } : { buy: 0, sell: 0 };
  const sim = useMemo(
    () => simulateDevBuy(launchpad ?? "pons", chain, devBuy, launchpad === "pons" ? taxBps.buy : 0),
    [launchpad, chain, devBuy, taxBps.buy],
  );

  const [ack, setAck] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => setAck(false), [fs.plan?.id]);
  useEffect(() => {
    // Changing chain invalidates any prepared plan.
    flow.back();
    setReviewOpen(false);
    setStep((s) => Math.min(s, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain]);
  useEffect(() => {
    if (hint) {
      const t = window.setTimeout(() => setHint(null), 3500);
      return () => window.clearTimeout(t);
    }
  }, [hint]);

  const input = { chain, launchpad, creator: acct?.address, devBuy, vanity: vanityResult };
  const minBuy = minDevBuy(launchpad);
  const native = CHAINS[chain].nativeSymbol;
  const spendEstimate = devBuy + (launchpad ? LAUNCHPADS[launchpad].deployments.find((d) => d.chain === chain)?.launchFeeNative ?? 0 : 0);

  // ── Progress (presentation only; the real gate is validateForm) ──────
  const shares = draft.feeShares;
  const svm = kind === "svm";
  const feesDone =
    draft.feeTo === "me" ||
    (svm && draft.feeTo !== "agent") ||
    (draft.feeTo === "agent" && !!draft.agentSlug) ||
    (draft.feeTo === "social" && !!draft.feeSocialHandle.trim()) ||
    (draft.feeTo === "split" && shares.length > 0 && shares.every((s) => s.handle.trim() && s.pct >= 1) && shareTotals(shares).socialPct <= 100);
  const coinDone = !!draft.name.trim() && !!draft.symbol.trim() && !!draft.image;
  const storyFilled = !!(draft.description.trim() || draft.twitter.trim() || draft.telegram.trim() || draft.website.trim());
  const vanityPending = draft.vanityEnabled && chain === "sol" && !vanityResult;
  const devDone = devBuy >= minBuy && !!acct;
  const checks: { label: string; ok: boolean; section: SectionKey }[] = [
    { label: "Coin image", ok: !!draft.image, section: "coin" },
    { label: "Name", ok: !!draft.name.trim(), section: "coin" },
    { label: "Ticker", ok: !!draft.symbol.trim(), section: "coin" },
    { label: "Launchpad", ok: !!lp, section: "platform" },
    ...(draft.vanityEnabled && chain === "sol" ? [{ label: "Vanity address ground", ok: !vanityPending, section: "platform" as SectionKey }] : []),
    { label: `${kind === "evm" ? "EVM" : "Solana"} wallet connected`, ok: !!acct, section: "devbuy" },
    { label: minBuy > 0 ? `Dev buy ≥ ${minBuy} ${native}` : "Dev buy amount", ok: devBuy >= minBuy, section: "devbuy" },
    { label: "Fee recipient", ok: feesDone, section: "fees" },
  ];
  const readyCount = checks.filter((c) => c.ok).length;
  const allReady = readyCount === checks.length;

  const sectionState: Record<SectionKey, StepState> = {
    coin: coinDone ? "done" : "todo",
    story: storyFilled ? "done" : "optional",
    platform: lp && !vanityPending ? "done" : vanityPending ? "warn" : "todo",
    devbuy: devDone ? "done" : !acct ? "warn" : "todo",
    fees: feesDone ? "done" : "todo",
    review: allReady ? "active" : "todo",
  };
  const linkCount = [draft.twitter, draft.telegram, draft.website].filter((x) => x.trim()).length;
  const sectionSummary: Record<SectionKey, string> = {
    coin: coinDone ? `$${draft.symbol} · ${draft.name}` : draft.symbol ? `$${draft.symbol} · ${draft.image ? "image ✓" : "needs an image"}` : "Image, name, ticker",
    story: storyFilled ? [draft.description.trim() && "Story", linkCount && `${linkCount} link${linkCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ") : "Optional",
    platform: lp ? `${lp.name} · ${CHAINS[chain].short}` : "Pick a launchpad",
    devbuy: !acct ? "Connect a wallet" : `${fmtNative(devBuy)} ${native}${sim.supplyPct > 0 ? ` · ${sim.supplyPct.toFixed(2)}%` : ""}`,
    fees:
      draft.feeTo === "me" || (svm && draft.feeTo !== "agent")
        ? "My wallet"
        : draft.feeTo === "agent"
          ? draft.agentSlug
            ? `Agent · ${draft.agentName || draft.agentSlug}`
            : "Pick an agent"
          : draft.feeTo === "social"
          ? draft.feeSocialHandle.trim()
            ? `@${draft.feeSocialHandle.trim().replace(/^@/, "")}`
            : "Pick an account"
          : `Split · ${shares.length} account${shares.length === 1 ? "" : "s"}`,
    review: `${readyCount}/${checks.length} checks`,
  };

  const scrollTo = (key: SectionKey) => {
    document.getElementById(SECTION_ID[key])?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  const openReview = async () => {
    const problem = validateForm(input) ?? (devBuy < minBuy ? `Dev buy must be at least ${minBuy} ${CHAINS[chain].nativeSymbol}` : null);
    if (problem) {
      setHint(problem);
      if (!mobile) scrollTo(sectionForProblem(problem));
      return;
    }
    haptic(12);
    setReviewOpen(true);
    await flow.prepare();
  };

  const onSuccessClose = () => {
    flow.back();
    setReviewOpen(false);
  };
  const onAnother = () => {
    flow.back();
    setReviewOpen(false);
    draft.resetCoin();
    vanity.reset();
    setStep(0);
  };

  // ── shared blocks ────────────────────────────────────────────────
  const sectionCls = "scroll-mt-[76px] xl:scroll-mt-6";
  const coinSection = (
    <Section
      id={SECTION_ID.coin}
      className={sectionCls}
      title="Coin"
      step={1}
      state={sectionState.coin}
      subtitle="The image, name and ticker traders will see on every board."
    >
      <div className="space-y-5">
        <ImageField
          image={draft.image}
          onChange={(image) => draft.patch({ image })}
          library={draft.library}
          onUploaded={draft.addToLibrary}
          asciiSeed={draft.symbol || draft.name}
        />
        <CoinIdentityFields chain={chain} launchpad={launchpad} />
      </div>
    </Section>
  );
  const detailsSection = (
    <Section
      id={SECTION_ID.story}
      className={sectionCls}
      title="Story & socials"
      step={2}
      state={sectionState.story}
      subtitle="A line of lore and where people can find you."
    >
      <CoinDetailsFields launchpad={launchpad} />
    </Section>
  );
  const platformSection = (
    <Section
      id={SECTION_ID.platform}
      className={sectionCls}
      title="Platform & options"
      step={3}
      state={sectionState.platform}
      subtitle="Where the coin launches and how it trades."
      right={!mobile ? <ChainSwitch chain={chain} onChange={setChain} /> : undefined}
    >
      {mobile && (
        <div className="mb-3">
          <ChainSwitch chain={chain} onChange={setChain} />
        </div>
      )}
      <PlatformChips
        chain={chain}
        value={launchpad}
        adapters={adapters}
        onChange={(id) => {
          haptic();
          draft.patch({ launchpadByChain: { ...draft.launchpadByChain, [chain]: id } });
        }}
      />
      {chainNote.state !== "open" && (
        <Callout tone="info" className="mt-3">
          {CHAINS[chain].name} launches are coming soon{chainNote.note ? ` — ${chainNote.note}` : "."}
        </Callout>
      )}
      {lp ? (
        <PlatformDetail lp={lp} chain={chain} nativeUsd={nativeUsd} />
      ) : (
        chainNote.state === "open" && (
          <Callout tone="info" className="mt-3">
            No launchpad on {CHAINS[chain].name} is open yet — they're listed above as coming soon.
          </Callout>
        )
      )}
      {adaptersQ.isError && (
        <Callout tone="warn" icon={<AlertTriangle />} className="mt-3">
          Couldn't reach the launch service — showing registry defaults.
        </Callout>
      )}
      {launchpad && hasOptions(chain, launchpad) && (
        <SubBlock label="Options" hint={`for ${lp?.name ?? "this launchpad"}`}>
          <OptionsCard chain={chain} launchpad={launchpad} vanity={vanity} />
        </SubBlock>
      )}
    </Section>
  );
  const devBuySection = (
    <Section
      id={SECTION_ID.devbuy}
      className={sectionCls}
      title="Dev buy & wallet"
      step={4}
      state={sectionState.devbuy}
      subtitle="Your first buy, made in the same transaction as the launch."
    >
      <DevBuyCard chain={chain} launchpad={launchpad} value={devBuy} onChange={setDevBuy} nativeUsd={nativeUsd} />
    </Section>
  );
  const feeSplit = (
    <RewardsCard
      className="mt-4 bg-panel-2"
      launchpad={launchpad}
      chain={chain}
      creator={acct?.address}
      mechanism={fs.plan?.plan.split.mechanism}
      warnings={fs.plan?.plan.split.warnings}
    />
  );
  const feeSection = (
    <Section
      id={SECTION_ID.fees}
      className={sectionCls}
      title="Your creator rewards"
      step={5}
      state={sectionState.fees}
      subtitle={
        <>
          Paid out automatically ·{" "}
          <Link href="/docs/fees" className="font-semibold text-text-2 underline underline-offset-2 hover:text-text">
            How fees work
          </Link>
        </>
      }
    >
      <FeeRecipientCard chain={chain} launchpad={launchpad} />
      {feeSplit}
    </Section>
  );
  const preview = (
    <CoinPreview
      name={draft.name}
      symbol={draft.symbol}
      image={draft.image?.url}
      launchpad={launchpad}
      chain={chain}
      sim={sim}
      nativeUsd={nativeUsd}
      socials={{ twitter: draft.twitter, telegram: draft.telegram, website: draft.website }}
      taxBps={taxBps}
    />
  );
  const simulator = <SimulatorCard sim={sim} chain={chain} amount={devBuy} symbol={draft.symbol} nativeUsd={nativeUsd} />;
  const successOverlay = (
    <SuccessOverlay
      open={fs.phase === "success"}
      chain={fs.plan?.plan.request.chain ?? chain}
      launchpad={fs.plan?.plan.request.launchpad ?? launchpad ?? "pons"}
      name={fs.plan?.plan.request.name ?? draft.name}
      symbol={fs.plan?.plan.request.symbol ?? draft.symbol}
      image={draft.image?.url}
      token={fs.launch?.token ?? fs.plan?.plan.predicted.token}
      hashes={fs.hashes}
      status={fs.launch?.status ?? "submitted"}
      error={fs.launch?.error}
      postOnX={draft.postOnX}
      feeAccounts={
        fs.plan?.plan.split.shares?.length
          ? fs.plan.plan.split.shares.flatMap((s) => (s.kind === "social" && s.provider && s.identityKey ? [{ provider: s.provider, handle: s.handle, identityKey: s.identityKey }] : []))
          : fs.plan?.beneficiary
            ? [fs.plan.beneficiary]
            : undefined
      }
      onClose={onSuccessClose}
      onAnother={onAnother}
    />
  );
  const reviewPanel = (showActions: boolean) => (
    <ReviewPanel
      flow={fs}
      imageUrl={draft.image?.url}
      nativeUsd={nativeUsd}
      balance={balance}
      onConfirm={() => void flow.confirm()}
      onBack={() => {
        flow.back();
        setReviewOpen(false);
        if (mobile) setStep(2);
      }}
      ack={ack}
      setAck={setAck}
      showActions={showActions}
    />
  );
  const hintToast = (
    <AnimatePresence>
      {hint && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="pointer-events-none absolute inset-x-3 bottom-full mb-1 flex items-center gap-2 rounded-[3px] border border-line-2 border-l-2 border-l-warn bg-bg-elev px-3 py-2.5 text-[12.5px] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.9)]"
          role="status"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-warn" /> <span className="text-text">{hint}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // ── Mobile: 4-step flow ──────────────────────────────────────────
  if (mobile) {
    const step0Ok = !!draft.name.trim() && !!draft.symbol.trim() && !!draft.image;
    const next = async () => {
      if (step === 0) {
        if (!step0Ok) return setHint(!draft.image ? "Add an image" : !draft.name.trim() ? "Give your coin a name" : "Add a ticker");
        haptic();
        setStep(1);
      } else if (step === 1) {
        if (!lp) return setHint("Pick a launchpad");
        haptic();
        setStep(2);
      } else if (step === 2) {
        const problem = validateForm(input) ?? (devBuy < minBuy ? `Dev buy must be at least ${minBuy} ${CHAINS[chain].nativeSymbol}` : null);
        if (problem) return setHint(problem);
        haptic(12);
        setStep(3);
        await flow.prepare();
      }
    };
    const back = () => {
      if (step === 3) flow.back();
      setStep((s) => Math.max(0, s - 1));
    };
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="relative shrink-0 overflow-hidden border-b border-line bg-bg-elev px-4 pb-3 pt-3">
          <div className="relative flex items-start gap-2">
            <div className="min-w-0">
              <h1 className="display text-[30px] text-text">Launch a coin</h1>
              <div className="mono-label mt-1.5">
                Step {step + 1} of {MOBILE_STEPS.length}
              </div>
            </div>
            <span className="chip ml-auto mt-0.5 shrink-0 text-text-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: CHAINS[chain].color }} />
              {CHAINS[chain].short}
              {lp && <span className="text-text-3">· {lp.name}</span>}
            </span>
          </div>
          <MobileStepper
            step={step}
            onJump={(i) => {
              if (i >= step) return;
              flow.back();
              setStep(i);
            }}
          />
        </div>

        <MobileScroller step={step}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: -24 }}
              transition={{ duration: 0.18, ease: [0.2, 0.9, 0.3, 1] }}
              className="space-y-3 pb-3"
            >
              {step === 0 && (
                <>
                  {coinSection}
                  {detailsSection}
                </>
              )}
              {step === 1 && (
                <>
                  {platformSection}
                  {feeSection}
                </>
              )}
              {step === 2 && (
                <>
                  {preview}
                  {devBuySection}
                  {simulator}
                </>
              )}
              {step === 3 && (
                <>
                  <div className="rounded-[4px] border border-line bg-bg-elev p-3.5">{reviewPanel(false)}</div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </MobileScroller>

        {/* Floating CTA bar; bottom padding leaves room for the dock's raised Launch button. */}
        <div className="relative shrink-0 border-t border-line bg-bg px-3 pb-3 pt-2.5">
          {hintToast}
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={back}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[3px] border border-line-2 text-text-2 active:bg-panel-2"
                aria-label="Back"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            {step < 3 ? (
              <button
                type="button"
                onClick={() => void next()}
                className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-[3px] bg-brand px-3 font-mono text-[12.5px] font-medium uppercase tracking-[0.1em] text-brand-ink active:bg-brand/90"
              >
                {step === 0 ? (
                  <>
                    Continue <ChevronRight className="h-4 w-4" />
                  </>
                ) : step === 1 ? (
                  <>
                    Continue to dev buy <ChevronRight className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    <Flame className="h-4 w-4" /> <span className="truncate">Review {lp ? `on ${lp.name}` : ""}</span>
                  </>
                )}
              </button>
            ) : (
              <ConfirmButton flow={fs} canSign={canSign(fs.plan, ack)} simOk={!!fs.plan?.plan.simulation?.ok} onConfirm={() => void flow.confirm()} className="flex-1" />
            )}
          </div>
        </div>
        {successOverlay}
      </div>
    );
  }

  // ── Desktop ──────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-[1480px] px-5 pt-6 lg:px-8">
      <Hero />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[208px_minmax(0,1fr)_360px]">
        {/* Flight plan — vertical on wide screens */}
        <nav aria-label="Launch steps" className="hidden xl:block">
          <div className="sticky top-6">
            <FlightPlan
              state={sectionState}
              summary={sectionSummary}
              onJump={scrollTo}
              onReview={() => void openReview()}
              readyCount={readyCount}
              total={checks.length}
            />
          </div>
        </nav>

        <div className="min-w-0 space-y-4">
          {/* Flight plan — horizontal strip below xl */}
          <div className="sticky top-0 z-20 -mx-1 bg-bg/90 px-1 py-2 backdrop-blur xl:hidden">
            <FlightStrip state={sectionState} onJump={scrollTo} />
          </div>
          {coinSection}
          {detailsSection}
          {platformSection}
          {devBuySection}
          {feeSection}
          <Preflight id={SECTION_ID.review} className={sectionCls} checks={checks} readyCount={readyCount} onJump={scrollTo} state={sectionState.review} />
        </div>

        <aside className="min-w-0 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-var(--topbar-h)-var(--statusbar-h)-128px)] lg:self-start lg:overflow-y-auto lg:pb-2 no-scrollbar">
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 px-0.5">
              <span className="eyebrow">Live preview</span>
              <span className="ml-auto font-mono text-[10.5px] text-text-3">updates as you type</span>
            </div>
            {preview}
            {simulator}
          </div>
        </aside>
      </div>

      {/* Sticky submit bar */}
      <div className="sticky bottom-0 z-30 -mx-5 mt-4 bg-bg/95 px-5 pb-4 pt-3 backdrop-blur lg:-mx-8 lg:px-8">
        <div className="relative flex items-center gap-4 rounded-[4px] border border-line-2 bg-bg-elev p-2.5 pl-3">
          <TokenAvatar image={draft.image?.url} symbol={draft.symbol || "??"} launchpad={launchpad} size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-bold">
              {draft.symbol ? `$${draft.symbol}` : "Your coin"}{" "}
              <span className="font-medium text-text-3">
                on {lp?.name ?? "—"} · {CHAINS[chain].name}
              </span>
            </div>
            <div className="num truncate text-[11.5px] text-text-3">
              ~{fmtNative(spendEstimate + gasReserve(chain) * 0.3)} {CHAINS[chain].nativeSymbol} incl. dev buy{sim.supplyPct > 0 ? ` · dev ${sim.supplyPct.toFixed(2)}%` : ""}
            </div>
          </div>

          <div className="hidden shrink-0 items-center gap-2.5 lg:flex">
            <AnimatePresence mode="wait" initial={false}>
              {hint ? (
                <motion.span
                  key="hint"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex max-w-[300px] items-center gap-1.5 text-right text-[12px] font-medium text-warn"
                  role="status"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {hint}
                </motion.span>
              ) : (
                <motion.span key="ready" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                  <ReadyTicks done={readyCount} total={checks.length} />
                  <span className={cn("num text-[11.5px]", allReady ? "text-buy" : "text-text-3")}>
                    {allReady ? "ready" : `${readyCount}/${checks.length}`}
                  </span>
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          {/* Smaller screens: the hint floats above the bar */}
          <div className="lg:hidden">{hintToast}</div>

          <button
            type="button"
            onClick={() => void openReview()}
            disabled={!lp}
            className="group relative flex h-12 shrink-0 items-center gap-2 overflow-hidden rounded-[3px] bg-brand px-6 font-mono text-[12.5px] font-medium uppercase tracking-[0.1em] text-brand-ink transition-colors hover:bg-brand/90 disabled:opacity-40"
          >
            <Rocket className="h-4 w-4" />
            Cooking on {lp?.name ?? "…"}
          </button>
        </div>
      </div>

      <ResponsiveSheet
        open={reviewOpen && fs.phase !== "success"}
        onOpenChange={(o) => {
          if (!o && (fs.phase === "signing" || fs.phase === "confirming")) return; // don't lose a signing flow
          setReviewOpen(o);
          if (!o) flow.back();
        }}
        title="Review launch"
        description="Exact amounts, the transactions you'll sign, and the simulation result."
        className="sm:max-w-xl"
      >
        {reviewPanel(true)}
      </ResponsiveSheet>
      {successOverlay}
    </div>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────

function Hero() {
  return (
    <header className="border-b border-line pb-5">
      <div className="mono-label flex items-center gap-2">
        <span className="text-brand" aria-hidden>
          /
        </span>
        <span>Claudio</span>
        <span aria-hidden>/</span>
        <span className="text-text-2">Launch</span>
      </div>
      <h1 className="display-page mt-3 text-text">Launch a coin</h1>
      <p className="lede mt-3 max-w-[760px]">
        Launch on pump.fun yourself or with your agent. The coin, your creator rewards and the dev buy go out in one transaction, with exact amounts
        and a live simulation before you sign.
      </p>
    </header>
  );
}

/** Scroll-spy over the launch sections inside the app's scroll container. */
function useActiveSection(): SectionKey {
  const [active, setActive] = useState<SectionKey>("coin");
  useEffect(() => {
    const root = document.getElementById("main");
    const els = SECTION_ORDER.map((k) => document.getElementById(SECTION_ID[k])).filter((e): e is HTMLElement => !!e);
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        const first = SECTION_ORDER.find((k) => visible.has(SECTION_ID[k]));
        if (first) setActive(first);
      },
      { root, rootMargin: "-15% 0px -55% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return active;
}

function FlightPlan({
  state,
  summary,
  onJump,
  onReview,
  readyCount,
  total,
}: {
  state: Record<SectionKey, StepState>;
  summary: Record<SectionKey, string>;
  onJump: (k: SectionKey) => void;
  onReview: () => void;
  readyCount: number;
  total: number;
}) {
  const active = useActiveSection();
  return (
    <div>
      <div className="eyebrow mb-3 px-1">Steps</div>
      <ol className="relative">
        {/* the shaft */}
        <span className="absolute bottom-5 left-[19px] top-5 w-px bg-line-2" aria-hidden />
        {SECTION_ORDER.map((k, i) => {
          const on = active === k;
          return (
            <li key={k} className="relative">
              <button
                type="button"
                onClick={() => onJump(k)}
                aria-current={on ? "step" : undefined}
                className={cn(
                  "relative flex w-full items-start gap-3 rounded-[3px] px-1.5 py-2 text-left transition-colors",
                  on ? "bg-panel" : "hover:bg-panel/60",
                )}
              >
                <StepMarker step={i + 1} state={on && state[k] !== "done" ? "active" : state[k] === "optional" ? "todo" : state[k]} />
                <span className="min-w-0 flex-1 pt-0.5">
                  <span className={cn("block font-mono text-[11px] font-medium uppercase tracking-[0.1em]", on ? "text-text" : "text-text-2")}>{SECTION_LABEL[k]}</span>
                  <span className={cn("block truncate text-[11px]", state[k] === "warn" ? "text-warn" : "text-text-3")}>{summary[k]}</span>
                </span>
                {on && (
                  <motion.span
                    layoutId="flight-plan-active"
                    className="absolute -left-2 top-2.5 h-[22px] w-[2px] bg-brand"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 rounded-[3px] border border-line p-3">
        <div className="flex items-center justify-between text-[11.5px]">
          <span className="mono-label !text-[10.5px]">Ready to launch</span>
          <span className={cn("num font-semibold", readyCount === total ? "text-buy" : "text-text-3")}>
            {readyCount}/{total}
          </span>
        </div>
        <ReadyTicks done={readyCount} total={total} className="mt-2" stretch />
        <button
          type="button"
          onClick={onReview}
          className="btn btn-secondary mt-3 h-9 w-full gap-1.5 text-[11px]"
        >
          Open review <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function FlightStrip({ state, onJump }: { state: Record<SectionKey, StepState>; onJump: (k: SectionKey) => void }) {
  const active = useActiveSection();
  return (
    <ol className="flex gap-1 overflow-x-auto rounded-[3px] border border-line bg-bg p-1 no-scrollbar">
      {SECTION_ORDER.map((k, i) => {
        const on = active === k;
        return (
          <li key={k} className="shrink-0">
            <button
              type="button"
              onClick={() => onJump(k)}
              aria-current={on ? "step" : undefined}
              className={cn(
                "flex h-9 items-center gap-2 rounded-[2px] px-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] transition-colors",
                on ? "bg-panel-3 text-text" : "text-text-3 hover:text-text-2",
              )}
            >
              <StepMarker size="sm" step={i + 1} state={on && state[k] !== "done" ? "active" : state[k] === "optional" ? "todo" : state[k]} />
              {SECTION_LABEL[k]}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Row of small ticks, one per pre-flight check. */
function ReadyTicks({ done, total, className, stretch }: { done: number; total: number; className?: string; stretch?: boolean }) {
  return (
    <span className={cn("flex gap-1", className)} aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn("h-1 transition-colors duration-300", stretch ? "flex-1" : "w-3", i < done ? "bg-brand" : "bg-line-2")}
        />
      ))}
    </span>
  );
}

function Preflight({
  id,
  className,
  checks,
  readyCount,
  onJump,
  state,
}: {
  id: string;
  className?: string;
  checks: { label: string; ok: boolean; section: SectionKey }[];
  readyCount: number;
  onJump: (k: SectionKey) => void;
  state: StepState;
}) {
  const all = readyCount === checks.length;
  return (
    <Section
      id={id}
      className={cn(className, all && "border-brand/40")}
      title="Review & sign"
      step={6}
      state={state}
      subtitle={all ? "Everything's set. Cook it to see exact amounts and a live simulation." : "Finish the open items, then cook it."}
      right={
        <span className={cn("num chip", all ? "chip-buy" : "")}>
          {readyCount}/{checks.length}
        </span>
      }
    >
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {checks.map((c) => (
          <li key={c.label}>
            <button
              type="button"
              onClick={() => onJump(c.section)}
              className={cn(
                "flex h-10 w-full items-center gap-2.5 rounded-[3px] border px-3 text-left text-[12.5px] transition-colors",
                c.ok ? "border-line bg-bg-elev text-text-2" : "border-dashed border-line-2 text-text-3 hover:border-text-3 hover:text-text-2",
              )}
            >
              {c.ok ? (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] bg-buy text-buy-ink">
                  <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                </span>
              ) : (
                <CircleDashed className="h-4 w-4 shrink-0" />
              )}
              <span className="truncate">{c.label}</span>
              {!c.ok && <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0" />}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-start gap-2 text-[11.5px] leading-snug text-text-3">
        Cooking pins your metadata, builds the transactions and simulates them against the chain. Nothing is signed until you confirm in the
        review.
      </p>
    </Section>
  );
}

function MobileStepper({ step, onJump }: { step: number; onJump: (i: number) => void }) {
  return (
    <div className="relative mt-3 flex items-center gap-1.5">
      {MOBILE_STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <button
            key={label}
            type="button"
            onClick={() => onJump(i)}
            className="flex min-h-[32px] flex-1 flex-col items-stretch gap-1.5 text-left"
            aria-current={active ? "step" : undefined}
          >
            <span className="h-[2px] overflow-hidden bg-line-2">
              <motion.span
                className={cn("block h-full", done ? "bg-brand/60" : "bg-brand")}
                initial={false}
                animate={{ width: done || active ? "100%" : "0%" }}
                transition={{ duration: 0.3 }}
              />
            </span>
            <span className={cn("flex items-center gap-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]", active ? "text-text" : done ? "text-text-2" : "text-text-3")}>
              {done && <Check className="h-3 w-3 text-brand" strokeWidth={3} />}
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Scroll container for the mobile steps; returns to the top when the step changes. */
function MobileScroller({ step, children }: { step: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [step]);
  return (
    <div ref={ref} data-launch-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3">
      {children}
    </div>
  );
}
