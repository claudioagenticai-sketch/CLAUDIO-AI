// Tag chips for traders/holders: dev, sniper, insider, bundler, fresh, kol, smart, whale, you, tracked.
import type { TraderTag } from "@shared/types";
import { cn } from "@/lib/utils";

const TAG_META: Record<TraderTag, { label: string; cls: string; title: string }> = {
  you: { label: "YOU", cls: "!bg-brand !text-brand-ink !shadow-none", title: "One of your wallets" },
  dev: { label: "DEV", cls: "chip-warn font-semibold", title: "Token creator" },
  sniper: { label: "Sniper", cls: "chip-sell", title: "Bought in the first blocks" },
  insider: { label: "Insider", cls: "chip-sell", title: "Funded by / linked to the dev" },
  bundler: { label: "Bundle", cls: "chip-warn", title: "Bought in the same bundle/block as others" },
  fresh: { label: "Fresh", cls: "chip-info", title: "New wallet with little history" },
  kol: { label: "KOL", cls: "bg-gold-bg text-gold font-semibold", title: "Known influencer wallet" },
  smart: { label: "Smart", cls: "chip-buy", title: "Profitable wallet (smart money)" },
  whale: { label: "Whale", cls: "chip-info", title: "Large holder / trade" },
  tracked: { label: "Tracked", cls: "chip-info", title: "In your wallet tracker" },
};

const ORDER: TraderTag[] = ["you", "dev", "kol", "smart", "whale", "sniper", "insider", "bundler", "fresh", "tracked"];

export function TraderTags({ tags, max = 3, className }: { tags: TraderTag[]; max?: number; className?: string }) {
  if (!tags.length) return null;
  const sorted = ORDER.filter((t) => tags.includes(t));
  const shown = sorted.slice(0, max);
  const rest = sorted.length - shown.length;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {shown.map((t) => (
        <span key={t} title={TAG_META[t].title} className={cn("chip shrink-0 px-1 py-[3px] text-[9px]", TAG_META[t].cls)}>
          {TAG_META[t].label}
        </span>
      ))}
      {rest > 0 && (
        <span className="chip shrink-0 px-1 py-[3px] text-[9px]" title={sorted.slice(max).map((t) => TAG_META[t].label).join(", ")}>
          +{rest}
        </span>
      )}
    </span>
  );
}

export function tagLabel(t: TraderTag): string {
  return TAG_META[t].label;
}
