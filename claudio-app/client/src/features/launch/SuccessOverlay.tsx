// Post-launch celebration: CA, token link, explorer links, "Post on X" intent.
import { Link } from "wouter";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, ExternalLink, Plus, X } from "lucide-react";
import { CHAINS, type ChainId } from "@shared/chains";
import type { LaunchpadId } from "@shared/launchpads";
import { BRAND } from "@shared/brand";
import { SOCIAL_PROVIDER_LABEL, type SocialProvider } from "@shared/social";
import { SocialIcon } from "@/features/social/ui";
import { CopyAddress, ClaudioMark, TokenAvatar } from "@/components/kit";
import { cn } from "@/lib/utils";
import { XLogo } from "./CoinFields";

export function tweetUrl(opts: { symbol: string; name: string; token?: string; chain: ChainId; link?: string }): string {
  const lines = [
    `$${opts.symbol} is live on ${CHAINS[opts.chain].name} 🚀`,
    opts.name ? `${opts.name}` : "",
    opts.token ? `CA: ${opts.token}` : "",
    opts.link ?? "",
    `Launched with ${BRAND.full}`,
  ].filter(Boolean);
  return `https://x.com/intent/tweet?text=${encodeURIComponent(lines.join("\n"))}`;
}

export function SuccessOverlay({
  open,
  chain,
  launchpad,
  name,
  symbol,
  image,
  token,
  hashes,
  status,
  error,
  postOnX,
  feeAccounts,
  onClose,
  onAnother,
}: {
  open: boolean;
  chain: ChainId;
  launchpad: LaunchpadId;
  name: string;
  symbol: string;
  image?: string;
  token?: string;
  hashes: string[];
  status: "confirmed" | "submitted" | "failed" | "prepared" | "unverified" | undefined;
  error?: string;
  postOnX: boolean;
  /** Social accounts receiving creator fees: shown with a "tell them to claim" link. */
  feeAccounts?: { provider: SocialProvider; handle?: string; identityKey: string }[];
  onClose: () => void;
  onAnother: () => void;
}) {
  const reduce = useReducedMotion();
  const c = CHAINS[chain];
  const tokenPath = token ? `/t/${chain}/${token}` : undefined;
  const link = tokenPath ? `${window.location.origin}${tokenPath}` : undefined;
  const confirmed = status === "confirmed";
  const unverified = status === "unverified";
  const headline = confirmed
    ? `$${symbol} is live`
    : status === "failed"
      ? "Launch reverted"
      : unverified
        ? "Launched — fee split unverified"
        : `$${symbol} submitted`;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto bg-bg/90 backdrop-blur-md sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Launch result"
        >
          <motion.div
            className="relative w-full max-w-md overflow-hidden rounded-t-[4px] border border-line-2 bg-bg-elev px-5 pb-[calc(20px+var(--safe-bottom))] pt-7 sm:rounded-[4px] sm:pb-6"
            initial={reduce ? { opacity: 0 } : { y: 60, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
          >
            <div
              className={cn("pointer-events-none absolute inset-x-0 top-0 h-[2px]", status === "failed" ? "bg-sell" : unverified ? "bg-warn" : "bg-brand")}
              aria-hidden
            />
            <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-[3px] text-text-3 hover:bg-panel-2 hover:text-text">
              <X className="h-4 w-4" />
            </button>

            <div className="relative flex flex-col items-center text-center">
              <div className="brackets relative mt-2 flex h-[120px] w-[120px] items-center justify-center border border-line">
                <motion.div
                  className="relative"
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  <TokenAvatar image={image} symbol={symbol} launchpad={launchpad} size={76} className="rounded-[22%] bg-panel" />
                </motion.div>
              </div>
              <div className="mt-4 flex items-center gap-1.5">
                {status === "failed" ? (
                  <span className="eyebrow text-sell">Missed the mark</span>
                ) : unverified ? (
                  <span className="eyebrow text-warn">Check needed</span>
                ) : (
                  <>
                    <span className="eyebrow text-brand">{confirmed ? "Launched" : "Submitted"}</span>
                  </>
                )}
              </div>
              <h2 className={cn("display mt-2 text-[34px]", status === "failed" ? "text-sell" : unverified ? "text-warn" : "text-text")}>{headline}</h2>
              <p className="mt-1 text-[13px] text-text-2">
                {name} · {c.name}
              </p>
              {!confirmed && !unverified && status !== "failed" && (
                <p className="mt-1 text-[12px] text-text-3">Waiting for confirmation — the dashboard updates when it lands.</p>
              )}
              {unverified && (
                <p className="mt-1 text-[12px] text-text-3">
                  The coin exists, but its on-chain fee split doesn't match what was planned, so it gets no Claudio badge and no automatic payouts.
                </p>
              )}
              {error && <p className="mt-2 rounded-[3px] border border-line border-l-2 border-l-warn px-3 py-2 text-[12px] text-warn">{error}</p>}
            </div>

            {token && (
              <div className="relative mt-5 flex items-center justify-between gap-2 rounded-[3px] border border-line bg-bg-elev px-3 py-2.5">
                <span className="eyebrow">CA</span>
                <CopyAddress address={token} head={10} tail={8} className="text-[13px] text-text" />
              </div>
            )}

            {feeAccounts && feeAccounts.length > 0 && status !== "failed" && (
              <div className="relative mt-4 grid gap-2.5 rounded-[3px] border border-line bg-bg-elev px-3.5 py-3 text-left">
                <div className="mono-label !text-text-2">
                  Creator fees now collect for
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {feeAccounts.map((a) => (
                    <span key={a.identityKey} className="chip">
                      <SocialIcon provider={a.provider} className="h-3 w-3" />
                      {a.handle ? `@${a.handle}` : SOCIAL_PROVIDER_LABEL[a.provider]}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] leading-relaxed text-text-3">
                  They claim by signing in with that account on the token page. The badge there flips to "claimed" as soon as they do.
                </p>
                {link && feeAccounts.some((a) => a.provider === "x" && a.handle) && (
                  <a
                    href={`https://x.com/intent/tweet?text=${encodeURIComponent(
                      `${feeAccounts.filter((a) => a.provider === "x" && a.handle).map((a) => "@" + a.handle).join(" ")} creator fees from $${symbol} are waiting for you. Claim: ${link}`,
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary h-10 gap-1.5 text-[11px]"
                  >
                    <XLogo className="h-3.5 w-3.5" /> Tell them on X
                  </a>
                )}
              </div>
            )}

            <div className="relative mt-4 grid gap-2">
              {postOnX && status !== "failed" && (
                <a
                  href={tweetUrl({ symbol, name, token, chain, link })}
                  target="_blank"
                  rel="noreferrer"
                  className="btn h-12 bg-text text-bg hover:bg-text/90"
                >
                  <XLogo className="h-4 w-4" /> Post on X
                </a>
              )}
              <div className="grid grid-cols-2 gap-2">
                {tokenPath ? (
                  <Link href={tokenPath} className="btn btn-primary h-11 gap-1.5 px-2">
                    View chart
                  </Link>
                ) : (
                  <span className="flex h-11 items-center justify-center rounded-[3px] border border-dashed border-line-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-3">Token address pending</span>
                )}
                <Link href="/creator" className="btn btn-secondary h-11 gap-1.5 px-2">
                  Dashboard
                </Link>
              </div>
              <button type="button" onClick={onAnother} className="btn btn-ghost h-11 gap-1.5">
                <Plus className="h-4 w-4" /> Launch another
              </button>
            </div>

            {status !== "failed" && !unverified && (
              <div className="relative mt-3 flex items-center justify-center gap-2 text-[10.5px] text-text-3">
                <ClaudioMark size={14} />
                <span>
                  Launched with {BRAND.full} · {BRAND.tagline}
                </span>
              </div>
            )}

            {hashes.length > 0 && (
              <div className="relative mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 border-t border-line pt-3">
                {hashes.map((h, i) => (
                  <a key={h} href={c.explorerTx(h)} target="_blank" rel="noreferrer" className="num inline-flex items-center gap-1 text-[11px] text-text-3 hover:text-text">
                    tx {i + 1} {h.slice(0, 6)}…{h.slice(-4)} <ExternalLink className="h-3 w-3" />
                  </a>
                ))}
                {token && (
                  <a href={c.explorerAddress(token)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-text-3 hover:text-text">
                    explorer <ArrowUpRight className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
