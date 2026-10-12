// Home hero: $CLAUDIO, Claudio's own coin. His face, price with 1h / 24h moves, market cap, liquidity and 24h volume,
// a small live chart, copy CA, Buy (opens the coin's trade flow), Meet Claudio and his X / TikTok.
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { BRAND } from "@shared/brand";
import type { FeaturedToken, HomeFeed } from "@shared/agents";
import type { TokenSnapshot } from "@shared/types";
import { ClaudioMark, CopyAddress, Price } from "@/components/kit";
import { useClaudioToken } from "@/lib/platform";
import { fmtPct, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SocialMark } from "@/features/agents/ui";
import { useMediaQuery } from "@/features/token/useTokenData";
import { useTokenInsights } from "@/features/insights/api";
import { PriceChart } from "./PriceChart";

/** Live board stats for $CLAUDIO (fills whatever the home feed doesn't carry). */
function useBoardStats(key: string) {
  return useQuery<TokenSnapshot | null>({
    queryKey: ["claudio-board", key],
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: false,
    queryFn: async () => {
      const r = await fetch(`/api/token/${encodeURIComponent(key)}`, { credentials: "include" });
      if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return null;
      return (await r.json()) as TokenSnapshot;
    },
  });
}

const pos = (v?: number | null) => (v != null && Number.isFinite(v) && v > 0 ? v : null);

export function useFeatured(feed?: HomeFeed): FeaturedToken {
  const cfg = useClaudioToken();
  const base: FeaturedToken = feed?.featured ?? { key: `sol:${cfg.mint}`, mint: cfg.mint, symbol: cfg.symbol, name: cfg.name };
  const live = useBoardStats(base.key).data;
  return {
    ...base,
    // The token endpoint is polled more often than the home feed is rebuilt, so it wins when it has a value.
    priceUsd: pos(live?.priceUsd) ?? pos(base.priceUsd),
    mcapUsd: pos(live?.mcapUsd) ?? pos(base.mcapUsd),
    change1hPct: live && Number.isFinite(live.change1hPct) && live.priceUsd > 0 ? live.change1hPct : base.change1hPct ?? null,
    change24hPct: base.change24hPct ?? null,
    liquidityUsd: pos(live?.liquidityUsd) ?? pos(base.liquidityUsd),
    volume24hUsd: pos(live?.volume24hUsd) ?? pos(base.volume24hUsd),
  };
}

function Change({ v, className }: { v?: number | null; className?: string }) {
  if (v == null || !Number.isFinite(v)) return <span className={cn("text-text-3", className)}>—</span>;
  return <span className={cn(v >= 0 ? "text-buy" : "text-sell", className)}>{fmtPct(v, 1, true)}</span>;
}

function Metric({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="font-mono text-[10px] uppercase leading-tight tracking-[0.08em] text-text-3">{label}</dt>
      <dd className="num mt-1 truncate text-[15px] font-medium leading-tight text-text md:text-[16px]">{children}</dd>
    </div>
  );
}

const dash = <span className="text-text-3">—</span>;

export function Socials({ className, labels = true }: { className?: string; labels?: boolean }) {
  const links = [
    { platform: "x" as const, url: BRAND.twitter, label: "X" },
  ];
  return (
    <ul className={cn("flex items-center gap-1.5", className)} aria-label="Claudio's accounts">
      {links.map((l) => (
        <li key={l.platform}>
          <a
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Claudio on ${l.label} — opens in a new tab`}
            aria-label={`Claudio on ${l.label}`}
            className="inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-[3px] px-2 font-mono text-[11px] uppercase tracking-[0.1em] text-text-2 ring-1 ring-inset ring-line-2 transition-colors hover:bg-panel-2 hover:text-text md:h-9 md:min-w-9"
          >
            <SocialMark platform={l.platform} size={13} />
            {labels && <span className="hidden sm:inline">{l.label}</span>}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ClaudioHero({ feed, className }: { feed?: HomeFeed; className?: string }) {
  const f = useFeatured(feed);
  const wide = useMediaQuery("(min-width: 1024px)");
  // Richer stats (real holder count, 1h buys / sells) when the insights API has them.
  const ins = useTokenInsights(f.key).data;
  const holders = pos(ins?.stats.holders);
  const h1 = ins?.stats.windows?.["1h"];
  const href = `/t/sol/${f.mint}`;
  return (
    <section className={cn("panel overflow-hidden", className)} aria-label={`$${f.symbol}`}>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="min-w-0 p-4 md:p-5">
          <div className="mono-label mb-3.5 flex items-center gap-2">
            <span className="section-num">01</span>
            <span>The coin</span>
            <span aria-hidden>·</span>
            <span>Solana</span>
          </div>
          <div className="flex min-w-0 items-start gap-3 md:gap-4">
            <ClaudioMark variant="avatar" size={56} className="hidden md:block" />
            <ClaudioMark variant="avatar" size={46} className="md:hidden" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="display truncate text-[30px] md:text-[38px]">${f.symbol}</h1>
                <span className="chip chip-brand shrink-0 font-semibold">Official coin</span>
              </div>
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-text-3">
                <span>Claudio's own coin on Solana</span>
                <span className="text-line-2">·</span>
                <span className="inline-flex items-center gap-1">
                  CA <CopyAddress address={f.mint} head={4} tail={4} className="text-[11.5px] text-text-2" />
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-2 md:mt-5">
            <div className="num text-[30px] font-medium leading-none tracking-tight md:text-[36px]">{f.priceUsd ? <Price value={f.priceUsd} /> : dash}</div>
            <div className="flex items-center gap-4 pb-0.5 text-[13px]">
              <span className="num font-medium">
                <Change v={f.change1hPct} /> <span className="font-normal text-text-3">1h</span>
              </span>
              <span className="num font-medium">
                <Change v={f.change24hPct} /> <span className="font-normal text-text-3">24h</span>
              </span>
            </div>
          </div>

          <dl className={cn("mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3.5", (holders || h1) && "gap-y-3.5 md:grid-cols-5")}>
            <Metric label="Market cap">{f.mcapUsd ? fmtUsd(f.mcapUsd) : dash}</Metric>
            <Metric label="Liquidity">{f.liquidityUsd ? fmtUsd(f.liquidityUsd) : dash}</Metric>
            <Metric label="24h volume">{f.volume24hUsd ? fmtUsd(f.volume24hUsd) : dash}</Metric>
            {holders && <Metric label="Holders">{holders.toLocaleString()}</Metric>}
            {h1 && (
              <Metric label="1h buys / sells">
                <span className="text-buy">{h1.buys.toLocaleString()}</span>
                <span className="text-text-3"> / </span>
                <span className="text-sell">{h1.sells.toLocaleString()}</span>
              </Metric>
            )}
          </dl>

          {!wide && <PriceChart tokenKey={f.key} height={136} className="mt-4 border-t border-line pt-3" />}

          <div className="mt-4 grid grid-cols-2 gap-2 md:mt-5 md:flex md:flex-wrap">
            <Link
              href={`${href}?trade=buy`}
              className="btn btn-primary h-11 px-5 md:h-10"
            >
              Buy ${f.symbol}
            </Link>
            <Link
              href="/a/claudio"
              className="btn btn-secondary h-11 md:h-10"
            >
              Meet Claudio
            </Link>
            <Socials labels={false} className="ml-auto hidden self-center md:flex" />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 md:hidden">
            <span className="font-mono text-[11px] tracking-[0.04em] text-text-3">Follow @ClaudioAgentAi</span>
            <Socials />
          </div>
        </div>

        {wide && (
          <div className="flex min-w-0 flex-col border-l border-line p-4">
            <PriceChart tokenKey={f.key} className="flex-1" height={0} fullHref={href} />
          </div>
        )}
      </div>
    </section>
  );
}
