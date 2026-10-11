// Wallet tag icons: one tiny inline SVG per WalletTag (16-unit grid, drawn at 12–14 px), each with a tooltip (`data-tip`,
// desktop) and an aria-label. Colour carries meaning (green = fresh, red = sniper / insider / flagged, amber = bundles and
// farming, blue tick = KOL); everything else stays monochrome. Trading tools (Axiom, Photon…) are tiny text chips.
import type { ReactNode } from "react";
import type { WalletTag, WalletTool } from "@shared/insights";
import { cn } from "@/lib/utils";

/** Scalloped badge outline (12 lobes), computed once. */
const BADGE_PATH = (() => {
  const pts: string[] = [];
  const N = 96;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 6.55 + 0.85 * Math.cos(a * 12);
    pts.push(`${(8 + r * Math.sin(a)).toFixed(2)} ${(8 - r * Math.cos(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
})();

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const GLYPH: Record<Exclude<WalletTag, "top10">, ReactNode> = {
  kol: (
    <>
      <path d={BADGE_PATH} fill="var(--verified, #1d9bf0)" />
      <path d="M5.1 8.2 7.1 10.1 10.9 6.1" fill="none" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  smart: <path d="M8 1.2 9.7 6.3 14.8 8 9.7 9.7 8 14.8 6.3 9.7 1.2 8 6.3 6.3Z" fill="currentColor" />,
  whale: (
    <>
      <path d="M1.2 9.3c0-2.6 2.7-4.4 5.9-4.4 2.8 0 4.7 1.4 5.4 3.3l1.9-1.9.4 3.3-2.4.2c-.9 2-3.1 3.4-5.8 3.4H4.3C2.5 13.2 1.2 11.6 1.2 9.3Z" fill="currentColor" />
      <path d="M6.4 4V2.6M6.4 2.6c.5-.8 1.2-1 1.9-.9M6.4 2.6c-.5-.8-1.2-1-1.9-.9" {...S} strokeWidth={1.2} />
    </>
  ),
  sniper: (
    <>
      <circle cx="8" cy="8" r="5.2" {...S} />
      <path d="M8 .9v3.4M8 11.7v3.4M.9 8h3.4M11.7 8h3.4" {...S} />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" />
    </>
  ),
  bundler: (
    <>
      <path d="M6.2 1.6h6.6a1.2 1.2 0 0 1 1.2 1.2v6.9" {...S} strokeWidth={1.3} />
      <path d="M4.2 3.6h6.6A1.2 1.2 0 0 1 12 4.8v6.9" {...S} strokeWidth={1.3} />
      <rect x="2" y="5.6" width="8" height="8.8" rx="1.2" fill="currentColor" />
    </>
  ),
  insider: (
    <>
      <path d="M1 8s2.6-4.6 7-4.6S15 8 15 8s-2.6 4.6-7 4.6S1 8 1 8Z" {...S} strokeWidth={1.4} />
      <circle cx="8" cy="8" r="2.1" fill="currentColor" />
    </>
  ),
  fresh: (
    <path
      d="M14 1.8C7.3 1.8 2.6 4.8 2.6 10c0 1.2.3 2.3.9 3.2 1.1-3.5 3.6-5.8 6.9-7.1-2.6 1.7-4.5 4.1-5.4 7.6.8.5 1.8.8 2.9.8 4.7 0 6.1-5.2 6.1-12.7Z"
      fill="currentColor"
    />
  ),
  dev: (
    <>
      <path d="M2.4 11.6 1.4 4.6l3.7 3.1L8 2.6l2.9 5.1 3.7-3.1-1 7Z" fill="currentColor" />
      <rect x="2.4" y="12.6" width="11.2" height="1.6" rx=".6" fill="currentColor" />
    </>
  ),
  rat: (
    <>
      <circle cx="3.9" cy="4.6" r="2.7" fill="currentColor" />
      <circle cx="12.1" cy="4.6" r="2.7" fill="currentColor" />
      <path
        fillRule="evenodd"
        d="M8 4.6c2.9 0 4.9 1.6 4.9 3.9 0 2.4-2.6 5.4-4.9 6.4-2.3-1-4.9-4-4.9-6.4 0-2.3 2-3.9 4.9-3.9ZM5.9 8.1a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Zm4.2 0a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Z"
        fill="currentColor"
      />
    </>
  ),
  bot: (
    <>
      <rect x="2.3" y="5" width="11.4" height="8.6" rx="2.2" {...S} strokeWidth={1.4} />
      <path d="M8 5V2.8" {...S} strokeWidth={1.4} />
      <circle cx="8" cy="2.2" r="1.1" fill="currentColor" />
      <circle cx="5.8" cy="9.2" r="1.15" fill="currentColor" />
      <circle cx="10.2" cy="9.2" r="1.15" fill="currentColor" />
    </>
  ),
  wash: (
    <>
      <path d="M13.2 6.6A5.4 5.4 0 0 0 3.4 4.6" {...S} />
      <path d="M3.1 1.9v2.9H6" {...S} />
      <path d="M2.8 9.4a5.4 5.4 0 0 0 9.8 2" {...S} />
      <path d="M12.9 14.1v-2.9H10" {...S} />
    </>
  ),
  exchange: (
    <>
      <path d="M8 1.3 14.6 4.8H1.4Z" fill="currentColor" />
      <path d="M3.4 6.6v5M8 6.6v5M12.6 6.6v5" {...S} strokeWidth={1.7} strokeLinecap="butt" />
      <rect x="1.4" y="12.6" width="13.2" height="1.9" rx=".5" fill="currentColor" />
    </>
  ),
  pool: <path d="M8 1.4S3.1 6.9 3.1 10a4.9 4.9 0 0 0 9.8 0C12.9 6.9 8 1.4 8 1.4Z" fill="currentColor" />,
  suspicious: (
    <path fillRule="evenodd" d="M8 1.4 15.2 14.2H.8ZM7.2 5.8h1.6v4.3H7.2Zm0 5.4h1.6v1.6H7.2Z" fill="currentColor" />
  ),
};

export const TAG_META: Record<WalletTag, { label: string; tip: string; cls: string }> = {
  kol: { label: "KOL", tip: "KOL: a known trader with a following", cls: "" },
  smart: { label: "Smart money", tip: "Smart money: wallet with a strong profit record", cls: "text-gold" },
  whale: { label: "Whale", tip: "Whale: holds at least 1% of supply or $50K+", cls: "text-info" },
  sniper: { label: "Sniper", tip: "Sniper: bought in the first seconds", cls: "text-sell" },
  bundler: { label: "Bundler", tip: "Bundler: bought in the same bundle as other wallets", cls: "text-warn" },
  insider: { label: "Insider", tip: "Insider: likely linked to the dev", cls: "text-sell" },
  fresh: { label: "Fresh wallet", tip: "Fresh wallet: new, little history", cls: "text-buy" },
  dev: { label: "Dev", tip: "Dev: the creator or the dev team", cls: "text-copper" },
  rat: { label: "Rat trader", tip: "Rat trader: front-runs or farms buyers", cls: "text-warn" },
  bot: { label: "Bot", tip: "Bot: trades automatically", cls: "text-text-2" },
  wash: { label: "Wash trader", tip: "Wash trader: trades with itself to fake volume", cls: "text-warn" },
  exchange: { label: "Exchange", tip: "Exchange wallet (CEX)", cls: "text-text-2" },
  pool: { label: "Pool", tip: "Liquidity pool or bonding curve", cls: "text-info" },
  suspicious: { label: "Flagged", tip: "Flagged as suspicious", cls: "text-sell" },
  top10: { label: "Top 10", tip: "One of the 10 largest holders", cls: "text-text-2" },
};

/** Display order: identity first, then risk. */
export const TAG_ORDER: WalletTag[] = ["kol", "smart", "dev", "whale", "sniper", "insider", "bundler", "fresh", "rat", "bot", "wash", "suspicious", "exchange", "pool", "top10"];

export function WalletTagIcon({ tag, size = 13, className }: { tag: WalletTag; size?: number; className?: string }) {
  const meta = TAG_META[tag];
  if (tag === "top10") {
    return (
      <span
        role="img"
        aria-label={meta.label}
        data-tip={meta.tip}
        className={cn("num inline-flex shrink-0 items-center justify-center rounded-[2px] px-[2px] font-bold leading-none ring-1 ring-inset ring-current", meta.cls, className)}
        style={{ height: size - 1, fontSize: Math.max(7.5, size * 0.62), minWidth: size }}
      >
        10
      </span>
    );
  }
  return (
    <svg
      role="img"
      aria-label={meta.label}
      data-tip={meta.tip}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={cn("shrink-0", meta.cls, className)}
    >
      {GLYPH[tag]}
    </svg>
  );
}

/** Icons for a wallet's tags in display order, capped at `max` (+N chip). */
export function WalletTags({ tags, max = 4, size = 13, className }: { tags: WalletTag[]; max?: number; size?: number; className?: string }) {
  if (!tags?.length) return null;
  const sorted = TAG_ORDER.filter((t) => tags.includes(t));
  const shown = sorted.slice(0, max);
  const rest = sorted.slice(max);
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-[3px]", className)}>
      {shown.map((t) => (
        <WalletTagIcon key={t} tag={t} size={size} />
      ))}
      {rest.length > 0 && (
        <span className="num text-[9.5px] font-semibold leading-none text-text-3" data-tip={rest.map((t) => TAG_META[t].label).join(", ")} aria-label={`Also: ${rest.map((t) => TAG_META[t].label).join(", ")}`}>
          +{rest.length}
        </span>
      )}
    </span>
  );
}

const TOOL_LABEL: Record<WalletTool, string> = {
  axiom: "Axiom",
  gmgn: "GMGN",
  photon: "Photon",
  bullx: "BullX",
  trojan: "Trojan",
  padre: "Padre",
  maestro: "Maestro",
  bonkbot: "BonkBot",
  other: "Bot",
};

/** Trading terminals / bots the wallet uses, as tiny text chips. */
export function ToolChips({ tools, max = 2, className }: { tools?: WalletTool[]; max?: number; className?: string }) {
  if (!tools?.length) return null;
  const shown = tools.slice(0, max);
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-[3px]", className)}>
      {shown.map((t) => (
        <span
          key={t}
          data-tip={`Trades with ${TOOL_LABEL[t]}`}
          className="rounded-[2px] px-[3px] py-px font-mono text-[8.5px] uppercase leading-[11px] tracking-[0.04em] text-text-3 ring-1 ring-inset ring-line-2"
        >
          {TOOL_LABEL[t]}
        </span>
      ))}
      {tools.length > max && <span className="text-[9px] text-text-3">+{tools.length - max}</span>}
    </span>
  );
}

/** Small legend used in filter rows / sheets on phones (where hover tooltips don't exist). */
export function TagLegend({ tags, className }: { tags: WalletTag[]; className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-2.5 gap-y-1", className)}>
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 text-[11px] text-text-3">
          <WalletTagIcon tag={t} size={12} />
          {TAG_META[t].label}
        </span>
      ))}
    </span>
  );
}
