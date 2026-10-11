// Token identity header: squircle avatar with bonding ring, symbol/name, badges, CA, age, socials, watch + share,
// and the live price with its 5m / 1h moves.
//  - default (desktop): identity on the left, price readout + actions on the right. No card chrome of its own;
//    the page puts it in a card together with the stats strip.
//  - compact (phones): identity row, a large price line, and a scrollable badge row.
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, Check, Clock3, ExternalLink, Globe, Link2, MessageCircle, Send, Share2, Star } from "lucide-react";
import { CHAINS } from "@shared/chains";
import { LAUNCHPADS } from "@shared/launchpads";
import type { TokenSnapshot } from "@shared/types";
import { Age, ChainLogo, CopyAddress, LaunchpadLogo, Price, TaxBadge, TokenAvatar } from "@/components/kit";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { haptic, useSettings } from "@/lib/store";
import { fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

export function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

const PHASE_CHIP: Record<TokenSnapshot["phase"], { label: string; cls: string }> = {
  new: { label: "New", cls: "chip-info" },
  almost: { label: "Almost bonded", cls: "chip-warn" },
  migrated: { label: "Migrated", cls: "chip-buy" },
};

function normalizeUrl(u: string, kind: "twitter" | "telegram" | "website" | "discord" | "farcaster"): string {
  const s = u.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (kind === "twitter") return `https://x.com/${s.replace(/^@/, "")}`;
  if (kind === "telegram") return `https://t.me/${s.replace(/^@/, "")}`;
  if (kind === "farcaster") return `https://warpcast.com/${s.replace(/^@/, "")}`;
  return `https://${s}`;
}

function SocialLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-[2px] text-text-3 transition-colors hover:bg-panel-3 hover:text-text"
    >
      {children}
    </a>
  );
}

export function Socials({ token, className }: { token: TokenSnapshot; className?: string }) {
  const s = token.socials ?? {};
  const explorer = CHAINS[token.chain].explorerAddress(token.address);
  return (
    <div className={cn("flex items-center", className)}>
      {s.twitter && (
        <SocialLink href={normalizeUrl(s.twitter, "twitter")} label="X / Twitter">
          <XLogo className="h-3.5 w-3.5" />
        </SocialLink>
      )}
      {s.telegram && (
        <SocialLink href={normalizeUrl(s.telegram, "telegram")} label="Telegram">
          <Send className="h-3.5 w-3.5" />
        </SocialLink>
      )}
      {s.website && (
        <SocialLink href={normalizeUrl(s.website, "website")} label="Website">
          <Globe className="h-3.5 w-3.5" />
        </SocialLink>
      )}
      {s.discord && (
        <SocialLink href={normalizeUrl(s.discord, "discord")} label="Discord">
          <MessageCircle className="h-3.5 w-3.5" />
        </SocialLink>
      )}
      {s.farcaster && (
        <SocialLink href={normalizeUrl(s.farcaster, "farcaster")} label="Farcaster">
          <span className="font-mono text-[10.5px]">FC</span>
        </SocialLink>
      )}
      {explorer && (
        <SocialLink href={explorer} label="Explorer">
          <ExternalLink className="h-3.5 w-3.5" />
        </SocialLink>
      )}
    </div>
  );
}

const ICON_BTN =
  "inline-flex shrink-0 items-center justify-center rounded-[3px] border border-line transition-colors hover:border-line-2 active:bg-panel-3";

function WatchButton({ tokenKey, className }: { tokenKey: string; className?: string }) {
  const watching = useSettings((s) => s.watchlist.includes(tokenKey));
  const toggle = useSettings((s) => s.toggleWatch);
  return (
    <button
      type="button"
      onClick={() => {
        toggle(tokenKey);
        haptic();
      }}
      aria-pressed={watching}
      title={watching ? "Remove from watchlist" : "Add to watchlist"}
      className={cn(ICON_BTN, watching ? "border-gold/40 bg-gold-bg text-gold" : "text-text-3 hover:text-text", className)}
    >
      <motion.span key={String(watching)} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
        <Star className="h-4 w-4" fill={watching ? "currentColor" : "none"} />
      </motion.span>
    </button>
  );
}

function ShareButton({ token, className }: { token: TokenSnapshot; className?: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? window.location.href : "";
  const text = `$${token.symbol} on ${CHAINS[token.chain].name}\n${token.address}`;
  const xIntent = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const copy = () => {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      haptic();
      window.setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" title="Share" className={cn(ICON_BTN, "text-text-3 hover:text-text", className)}>
          <Share2 className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 rounded-[4px] border-line-2 bg-bg-elev p-1.5">
        <button type="button" onClick={copy} className="flex h-10 w-full items-center gap-2 rounded-[2px] px-2 text-sm text-text-2 hover:bg-panel-3 hover:text-text">
          {copied ? <Check className="h-4 w-4 text-buy" /> : <Link2 className="h-4 w-4" />}
          {copied ? "Link copied" : "Copy link"}
        </button>
        <a
          href={xIntent}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-10 w-full items-center gap-2 rounded-[2px] px-2 text-sm text-text-2 hover:bg-panel-3 hover:text-text"
        >
          <XLogo className="h-4 w-4" /> Post on X
        </a>
      </PopoverContent>
    </Popover>
  );
}

/** Signed % move with its window label, tinted jade / raspberry. */
function Move({ label, v, className }: { label: string; v: number; className?: string }) {
  const up = v >= 0;
  return (
    <span
      title={`${label} change`}
      className={cn("num inline-flex items-center gap-1 rounded-[2px] px-1.5 py-[3px] text-[11px] font-medium leading-none ring-1 ring-inset", up ? "text-buy ring-buy/30" : "text-sell ring-sell/30", className)}
    >
      <span className="font-medium opacity-60">{label}</span>
      {fmtPct(v, 1, true)}
    </span>
  );
}

function Badges({ token, className }: { token: TokenSnapshot; className?: string }) {
  const lp = LAUNCHPADS[token.launchpad];
  const phase = PHASE_CHIP[token.phase];
  const chain = CHAINS[token.chain];
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <span className="chip shrink-0 whitespace-nowrap py-1 text-text-2" title={chain.name}>
        <ChainLogo chain={token.chain} size={12} />
        {chain.short}
      </span>
      {token.launchpadLabel ? (
        // On-demand lookups from platforms we don't list (e.g. Meteora DBC): show the real platform name, no stand-in logo.
        <span className="chip shrink-0 whitespace-nowrap py-1" title={token.launchpadLabel}>
          {token.launchpadLabel}
        </span>
      ) : (
      <span className="chip shrink-0 whitespace-nowrap py-1 text-text-2" title={lp.name}>
        <LaunchpadLogo id={token.launchpad} size={12} /> {lp.name}
      </span>
      )}
      <span className={cn("chip shrink-0 whitespace-nowrap py-1", phase.cls)}>{phase.label}</span>
      <TaxBadge buyBps={token.buyTaxBps} sellBps={token.sellTaxBps} className="shrink-0 whitespace-nowrap py-1" />
      {token.launchedHere && <span className="chip !bg-brand shrink-0 py-1 tracking-[0.12em] !text-brand-ink !shadow-none">CLAUDIO</span>}
      {token.dexPaid && <span className="chip chip-buy shrink-0 whitespace-nowrap py-1">DEX paid</span>}
      {token.stockPaired && <span className="chip chip-info shrink-0 whitespace-nowrap py-1">/{token.quoteSymbol}</span>}
    </div>
  );
}

function DangerStrip({ message, className }: { message: string; className?: string }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-[3px] border border-l-2 border-sell/40 border-l-sell bg-bg-elev px-3 py-2 text-xs font-medium text-sell", className)}>
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function TokenHeader({ token, compact = false, className }: { token: TokenSnapshot; compact?: boolean; className?: string }) {
  const danger = token.alerts?.find((a) => a.severity === "danger");
  const ring = token.phase === "migrated" ? undefined : token.bondingPct;

  if (compact) {
    return (
      <header className={cn("relative px-3 pt-2.5", className)}>
        <div className="flex items-center gap-2.5">
          <Link
            href="/trenches"
            aria-label="Back to the Trenches"
            className="-ml-1 inline-flex h-10 w-8 shrink-0 items-center justify-center rounded-[2px] text-text-3 hover:text-text"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <TokenAvatar image={token.image} symbol={token.symbol} launchpad={token.launchpad} bondingPct={ring} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <h1 className="display truncate text-[28px] text-text">{token.symbol}</h1>
              <span className="min-w-0 truncate text-[12px] text-text-3">{token.name}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-3">
              <CopyAddress address={token.address} head={4} tail={4} />
              <span className="inline-flex items-center gap-1">
                <Clock3 className="h-3 w-3" />
                <Age from={token.createdAt} />
              </span>
            </div>
          </div>
          <WatchButton tokenKey={token.key} className="h-10 w-10" />
          <ShareButton token={token} className="h-10 w-10" />
        </div>

        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <Price value={token.priceUsd} className="-ml-0.5 block text-[28px] font-medium leading-none tracking-tight text-text" />
            <div className="mt-2 flex items-center gap-1.5">
              <Move label="5m" v={token.change5mPct} />
              <Move label="1h" v={token.change1hPct} />
            </div>
          </div>
          <Socials token={token} className="-mr-1.5 shrink-0" />
        </div>

        <Badges token={token} className="no-scrollbar -mx-3 mt-3 overflow-x-auto px-3" />

        {danger && <DangerStrip message={danger.message} className="mt-2.5" />}
      </header>
    );
  }

  return (
    <header className={cn("relative px-5 py-3.5", className)}>
      <div className="flex items-center gap-4">
        <TokenAvatar image={token.image} symbol={token.symbol} launchpad={token.launchpad} bondingPct={ring} size={56} />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h1 className="display truncate text-[40px] text-text">{token.symbol}</h1>
            <span className="min-w-0 truncate text-[15px] font-medium text-text-3">{token.name}</span>
          </div>
          <Badges token={token} className="mt-1.5 flex-wrap" />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-text-3">
            <span className="inline-flex h-7 items-center rounded-[2px] border border-line px-2">
              <CopyAddress address={token.address} head={6} tail={6} className="text-[11.5px] text-text-2" />
            </span>
            <span className="inline-flex items-center gap-1.5" title="Token age">
              <Clock3 className="h-3.5 w-3.5" />
              <Age from={token.createdAt} />
            </span>
            <span className="h-4 w-px bg-line" aria-hidden />
            <Socials token={token} className="-ml-1.5" />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-5">
          <div className="text-right">
            <div className="eyebrow mb-1">Price</div>
            <Price value={token.priceUsd} className="block text-[28px] font-medium leading-none tracking-tight text-text" />
            <div className="mt-2 flex justify-end gap-1.5">
              <Move label="5m" v={token.change5mPct} />
              <Move label="1h" v={token.change1hPct} />
            </div>
          </div>
          <span className="h-14 w-px bg-line" aria-hidden />
          <div className="flex flex-col gap-2">
            <WatchButton tokenKey={token.key} className="h-9 w-9" />
            <ShareButton token={token} className="h-9 w-9" />
          </div>
        </div>
      </div>

      {danger && <DangerStrip message={danger.message} className="mt-3" />}
    </header>
  );
}
