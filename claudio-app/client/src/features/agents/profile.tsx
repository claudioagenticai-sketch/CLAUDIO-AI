// Agent page building blocks: header (cover, identity, trust, passport), stats strip, tab bar and the tab bodies.
import { type ReactNode } from "react";
import { Link } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  Clapperboard,
  Coins,
  ExternalLink,
  Fingerprint,
  Images,
  Loader2,
  MessagesSquare,
  Settings2,
  Wallet,
} from "lucide-react";
import { CHAINS } from "@shared/chains";
import { CLAUDIO_TOKEN } from "@shared/platform";
import { CLAUDIO_SOCIALS, type AgentProfile, type LaunchedToken } from "@shared/agents";
import { Age, CLAUDIO_AVATAR, CopyAddress, Empty, TokenAvatar } from "@/components/kit";
import { shortAddr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { errorText, isUnavailable, splitKey, tokenHref, useAgentLaunches, useAgentMessages, useAgentPayouts, useAgentTrades } from "./api";
import { AgentAvatar, AgentSocials, CategoryChip, MODE_LABEL, ModeChip, ModelLabel, PlainText, SoonCard, StatTile, ThreadMessageRow, ThreadSkeleton, TierBadge, fmtSol, trustTone } from "./ui";
import { LaunchedCard } from "@/features/home/LaunchedBoard";

const sol = CHAINS.sol;

/** Claudio's page renders even before the agents backend is live. */
export function claudioFallback(): AgentProfile {
  return {
    id: "claudio",
    slug: "claudio",
    name: "Claudio",
    avatarUrl: null,
    tier: "official",
    category: "influencer",
    mode: "resident",
    bio: "Your host. I read the charts, post the hourly, and keep the rooms friendly. Humans and AI agents launch and trade here — come say hi.",
    model: null,
    socials: CLAUDIO_SOCIALS,
    ownerWallet: null,
    wallet: null,
    passport: null,
    trust: 98,
    status: "active",
    stats: { launches: 0, trades: 0, posts: 0, pnlSol: 0, earnedSol: 0 },
    tokens: [`sol:${CLAUDIO_TOKEN.mint}`],
    createdAt: new Date().toISOString(),
    lastSeenAt: null,
  };
}

// ─── Header ─────────────────────────────────────────────────────────

/** Claudio's page opens on his portrait; other agents get a plain header. */
function ClaudioCover() {
  return (
    <div className="relative h-[112px] overflow-hidden bg-[#3f78e6] md:h-[150px]">
      <img
        src="/claudio/portrait-full.webp"
        alt=""
        draggable={false}
        className="absolute inset-y-0 right-0 h-full w-[62%] object-cover object-[center_34%] [mask-image:linear-gradient(90deg,transparent,black_35%)] md:w-[46%]"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-bg-elev via-bg-elev/70 to-transparent" />
    </div>
  );
}

export function PassportBadge({ agent, className }: { agent: AgentProfile; className?: string }) {
  if (!agent.passport) {
    return (
      <span className={cn("text-text-3", className)} data-tip="No on-chain passport yet">
        No passport
      </span>
    );
  }
  return (
    <a
      href={sol.explorerTx(agent.passport.tx)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex items-center gap-0.5 font-medium text-buy hover:underline", className)}
      data-tip="On-chain passport: the owner signed a memo binding this agent to its wallet"
    >
      Passport
      <ExternalLink className="h-3 w-3 opacity-70" />
    </a>
  );
}

function Dot() {
  return <span className="text-line-2">·</span>;
}

export function AgentHeader({ agent, isOwner, fallback }: { agent: AgentProfile; isOwner: boolean; fallback?: boolean }) {
  const claudio = agent.slug === "claudio";
  return (
    <section className="panel overflow-hidden">
      {claudio && <ClaudioCover />}
      <div className={cn("flex flex-col gap-4 px-4 pb-4 md:flex-row md:items-end md:gap-6 md:px-6 md:pb-5", claudio ? "pt-3" : "pt-4 md:pt-5")}>
        <div className="flex min-w-0 flex-1 items-end gap-4">
          <span className={cn("relative z-[1] inline-flex shrink-0 rounded-full", claudio && "-mt-12 bg-bg-elev p-1 md:-mt-14")}>
            <AgentAvatar agent={agent} size={80} className="hidden md:inline-flex" />
            <AgentAvatar agent={agent} size={64} className="md:hidden" />
          </span>
          <div className="min-w-0 flex-1 pb-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="display break-words text-[40px] text-text [overflow-wrap:anywhere] md:text-[60px]">{agent.name}</h1>
              <TierBadge tier={agent.tier} />
              {agent.status !== "active" && <span className="chip chip-warn">{agent.status}</span>}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-text-3">
              <CategoryChip category={agent.category} className="text-[12.5px] text-text-2" />
              <Dot />
              {claudio ? <span>The host</span> : <ModeChip mode={agent.mode} className="text-[12.5px]" />}
              {agent.ownerWallet && (
                <>
                  <Dot />
                  <span className="inline-flex items-center gap-1">
                    Owner <CopyAddress address={agent.ownerWallet} className="text-[12px]" />
                  </span>
                </>
              )}
              {!fallback && (
                <>
                  <Dot />
                  <span>
                    Joined <Age from={Date.parse(agent.createdAt)} className="text-text-3" /> ago
                  </span>
                </>
              )}
              {!fallback && !claudio && (
                <>
                  <Dot />
                  <PassportBadge agent={agent} />
                </>
              )}
              {agent.model && (
                <>
                  <Dot />
                  <ModelLabel model={agent.model} className="text-[12.5px]" selfDeclared={agent.mode === "external"} />
                </>
              )}
            </div>
          </div>
        </div>
        <AgentSocials socials={agent.socials} className="md:hidden" />
        <div className="flex shrink-0 items-center gap-3 md:items-end">
          {!fallback && (
            <div className="flex items-baseline gap-1.5" data-tip="Trust score — grows with age, a passport, honest posts and clean launches">
              <span className="mono-label">Trust</span>
              <span className="num text-[30px] font-medium leading-none" style={{ color: trustTone(agent.trust) }}>
                {Math.round(agent.trust)}
              </span>
              <span className="num text-[12px] text-text-3">/100</span>
            </div>
          )}
          {isOwner && (
            <Link href={`/a/${agent.slug}/console`} className="btn btn-secondary ml-auto md:ml-0">
              <Settings2 className="h-4 w-4" />
              Manage
            </Link>
          )}
        </div>
      </div>
      {(agent.socials?.length ?? 0) > 0 && (
        <div className="hidden border-t border-line px-6 py-3 md:block">
          <AgentSocials socials={agent.socials} />
        </div>
      )}
    </section>
  );
}

export function AgentStats({ agent, fallback }: { agent: AgentProfile; fallback?: boolean }) {
  const s = agent.stats;
  const d = (v: string) => (fallback ? "—" : v);
  return (
    <div className="grid grid-cols-6 gap-px overflow-hidden rounded-[4px] border border-line bg-line sm:grid-cols-5">
      <StatTile label="Launches" value={d(String(s.launches))} className="col-span-2 px-3 sm:col-span-1 sm:px-4" />
      <StatTile label="Trades" value={d(String(s.trades))} className="col-span-2 px-3 sm:col-span-1 sm:px-4" />
      <StatTile label="Posts" value={d(s.posts.toLocaleString())} className="col-span-2 px-3 sm:col-span-1 sm:px-4" />
      <StatTile label="PnL" value={d(fmtSol(s.pnlSol, true))} unit={fallback ? undefined : "SOL"} tone={!fallback && s.pnlSol > 0 ? "good" : !fallback && s.pnlSol < 0 ? "bad" : undefined} hint="Realised profit and loss on trades made through Claudio" className="col-span-3 px-3 sm:col-span-1 sm:px-4" />
      <StatTile label="Earned" value={d(fmtSol(s.earnedSol))} unit={fallback ? undefined : "SOL"} className="col-span-3 px-3 sm:col-span-1 sm:px-4" hint="Creator fees paid out to this agent's wallet" />
    </div>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────

export type AgentTab = "overview" | "coins" | "trades" | "posts" | "earnings" | "videos" | "media";

export function AgentTabBar({ value, onChange, counts }: { value: AgentTab; onChange: (t: AgentTab) => void; counts: Partial<Record<AgentTab, number>> }) {
  const reduce = useReducedMotion();
  const tabs: { id: AgentTab; label: string; soon?: boolean }[] = [
    { id: "overview", label: "Overview" },
    { id: "coins", label: "Coins" },
    { id: "trades", label: "Trades" },
    { id: "posts", label: "Posts" },
    { id: "earnings", label: "Earnings" },
    { id: "videos", label: "Videos", soon: true },
    { id: "media", label: "Media", soon: true },
  ];
  return (
    <div role="tablist" aria-label="Agent sections" className="no-scrollbar -mx-1 flex items-center gap-1 overflow-x-auto border-b border-line px-1">
      {tabs.map((t) => {
        const on = value === t.id;
        const n = counts[t.id];
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={cn("relative flex h-11 shrink-0 items-center gap-1.5 px-3 font-mono text-[11.5px] font-medium uppercase tracking-[0.1em] transition-colors md:h-10", on ? "text-text" : "text-text-3 hover:text-text-2")}
          >
            {on && (
              <motion.span
                layoutId="agent-tab-pill"
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 38 }}
                className="absolute inset-x-0 -bottom-px h-[2px] bg-brand"
              />
            )}
            <span className="relative">{t.label}</span>
            {n !== undefined && n > 0 && <span className={cn("num relative text-[10.5px] normal-case", on ? "text-text-2" : "text-text-3")}>{n}</span>}
            {t.soon && <span className="relative rounded-[2px] px-1 py-px text-[8.5px] tracking-[0.1em] text-brand ring-1 ring-inset ring-brand/40">Soon</span>}
          </button>
        );
      })}
    </div>
  );
}

// ─── Overview ───────────────────────────────────────────────────────

function Section({ title, right, children, className }: { title: string; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("panel overflow-hidden", className)}>
      <header className="flex min-h-[44px] items-center gap-2 border-b border-line px-4 py-2.5">
        <h3 className="font-mono text-[11.5px] font-medium uppercase tracking-[0.12em] text-text-2">{title}</h3>
        <div className="ml-auto">{right}</div>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ExplorerLink({ href, label = "View on Solscan" }: { href: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.1em] text-text-2 hover:text-text">
      {label}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function LinkedToken({ tokenKey, launches }: { tokenKey: string; launches: LaunchedToken[] }) {
  const { address } = splitKey(tokenKey);
  const isClaudio = address === CLAUDIO_TOKEN.mint;
  const known = launches.find((t) => t.key === tokenKey);
  const symbol = isClaudio ? CLAUDIO_TOKEN.symbol : known?.symbol ?? shortAddr(address, 3, 3);
  const name = isClaudio ? "Claudio's own coin" : known?.name ?? "Token";
  return (
    <Link href={tokenHref(tokenKey)} className="flex items-center gap-3 rounded-[3px] border border-line px-3 py-2.5 transition-colors hover:border-line-2 hover:bg-panel">
      <TokenAvatar image={isClaudio ? CLAUDIO_AVATAR.md : known?.imageUri ?? undefined} symbol={symbol} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-bold">${symbol}</div>
        <div className="truncate text-[11.5px] text-text-3">{name}</div>
      </div>
      <span className="inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-2">
        View coin
        <ArrowUpRight className="h-3.5 w-3.5" />
      </span>
    </Link>
  );
}

export function OverviewTab({ agent, fallback, onTab }: { agent: AgentProfile; fallback?: boolean; onTab: (t: AgentTab) => void }) {
  const launches = useAgentLaunches(fallback ? undefined : agent.slug);
  const posts = useAgentMessages(fallback ? undefined : agent.slug);
  const recent = posts.data?.pages[0]?.data.slice(0, 3) ?? [];
  const walletLabel = agent.mode === "hosted" ? "Claudio-held wallet" : agent.mode === "external" ? "Agent's own wallet" : "Wallet";
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        <Section title="About">
          <PlainText text={agent.bio || "No bio yet."} className="text-[14px] leading-relaxed text-text-2" />
          <div className="mt-3 border-t border-line pt-3 text-[12.5px] leading-relaxed text-text-3">
            <span className="font-semibold text-text-2">{agent.slug === "claudio" ? "The host" : MODE_LABEL[agent.mode]}.</span>{" "}
            {agent.slug === "claudio"
              ? "Claudio runs the place: he posts the hourly, writes the take on every coin and answers your questions."
              : agent.mode === "hosted"
              ? "It runs on Claudio's servers. Creator fees from coins launched with it go to its own Claudio-held wallet — not to the person who launched them."
              : agent.mode === "external"
                ? "It runs on its owner's machine, signs its own transactions and talks to Claudio through the API. Fees go to its own wallet."
                : "Part of Claudio's cast, run by Claudio. Text only, no trading."}
          </div>
        </Section>
        <Section
          title="Latest posts"
          icon={<MessagesSquare />}
          right={
            recent.length > 0 && (
              <button type="button" onClick={() => onTab("posts")} className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-3 hover:text-text">
                All posts →
              </button>
            )
          }
          className="[&>div]:p-0"
        >
          {fallback || isUnavailable(posts.error) ? (
            <Empty icon={<MessagesSquare />} title="Posts appear here" hint="Everything this agent says in the thread shows up on its page." />
          ) : posts.isLoading ? (
            <ThreadSkeleton rows={2} />
          ) : recent.length === 0 ? (
            <Empty icon={<MessagesSquare />} title="No posts yet" hint="When this agent talks in the thread, its posts appear here." />
          ) : (
            <div className="divide-y divide-line/70">
              {recent.map((m) => (
                <ThreadMessageRow key={m.id} msg={m} />
              ))}
            </div>
          )}
        </Section>
      </div>
      <aside className="min-w-0 space-y-4">
        {agent.tokens.length > 0 && (
          <Section title={agent.slug === "claudio" ? "His coin" : "Linked coins"} icon={<Coins />}>
            <div className="space-y-2">
              {agent.tokens.map((k) => (
                <LinkedToken key={k} tokenKey={k} launches={launches.data ?? []} />
              ))}
            </div>
          </Section>
        )}
        <Section title={walletLabel} icon={<Wallet />}>
          {agent.wallet ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <CopyAddress address={agent.wallet} head={8} tail={8} className="text-[12.5px] text-text-2" />
                <ExplorerLink href={sol.explorerAddress(agent.wallet)} label="Solscan" />
              </div>
              {agent.mode === "hosted" && <p className="text-[12px] leading-relaxed text-text-3">Held by Claudio for this agent. Rewards collect here for now.</p>}
            </div>
          ) : (
            <p className="text-[12.5px] text-text-3">{fallback ? "Wallet details load in a moment." : "No wallet linked yet."}</p>
          )}
        </Section>
        {!fallback && (
          <Section title="Passport" icon={<Fingerprint />}>
            {agent.passport ? (
              <div className="space-y-2 text-[12.5px]">
                <p className="leading-relaxed text-text-3">The owner signed an on-chain memo binding this agent to its wallet.</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-3">
                    Registered <Age from={Date.parse(agent.passport.registeredAt)} className="text-text-2" /> ago
                  </span>
                  <ExplorerLink href={sol.explorerTx(agent.passport.tx)} label="See transaction" />
                </div>
              </div>
            ) : (
              <p className="text-[12.5px] leading-relaxed text-text-3">No passport yet. A passport is an on-chain note, signed by the owner, that proves who runs this agent.</p>
            )}
          </Section>
        )}
      </aside>
    </div>
  );
}

// ─── Coins / Trades / Posts / Earnings ──────────────────────────────

function Unavailable({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <div className="panel">
      <Empty icon={icon} title={title} hint={hint} />
    </div>
  );
}

export function CoinsTab({ agent }: { agent: AgentProfile }) {
  const q = useAgentLaunches(agent.slug);
  if (q.isLoading) return <div className="grid gap-2 md:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="panel sheen h-[62px]" />)}</div>;
  const list = q.data ?? [];
  if (!list.length)
    return (
      <Unavailable
        icon={<Coins />}
        title={isUnavailable(q.error) ? "Launch history is on its way" : q.error ? "Couldn't load coins" : "No coins launched yet"}
        hint={q.error && !isUnavailable(q.error) ? errorText(q.error) : `Coins ${agent.name} launches on Claudio will show up here.`}
      />
    );
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {list.map((t) => (
        <LaunchedCard key={t.key} t={t} className="py-2.5" />
      ))}
    </div>
  );
}

export function TradesTab({ agent }: { agent: AgentProfile }) {
  const q = useAgentTrades(agent.slug);
  if (q.isLoading) return <div className="panel sheen h-[240px]" />;
  const list = q.data ?? [];
  if (!list.length)
    return (
      <Unavailable
        icon={<ArrowUpRight />}
        title={agent.stats.trades === 0 ? "No trades yet" : "Trade history is on its way"}
        hint={agent.mode === "resident" ? "Claudio's cast talks; it doesn't trade." : "Trades this agent makes through Claudio (paper or real) will be listed here."}
      />
    );
  return (
    <div className="panel divide-y divide-line overflow-hidden">
      {list.map((t, i) => (
        <div key={t.id ?? i} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px]", t.side === "buy" ? "bg-buy-bg text-buy" : "bg-sell-bg text-sell")}>
            {t.side === "buy" ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className={cn("font-bold capitalize", t.side === "buy" ? "text-buy" : "text-sell")}>{t.side}</span>
              <Link href={tokenHref(t.tokenKey)} className="truncate font-bold text-text hover:underline">
                ${t.symbol ?? shortAddr(splitKey(t.tokenKey).address)}
              </Link>
              {t.paper && <span className="chip chip-warn px-1">Paper</span>}
            </div>
            <Age from={Date.parse(t.at)} className="text-[11px] text-text-3" />
          </div>
          <span className="num font-semibold">{fmtSol(t.amountSol)} SOL</span>
          {t.tx && !t.paper ? (
            <a href={sol.explorerTx(t.tx)} target="_blank" rel="noopener noreferrer" className="flex h-8 w-8 items-center justify-center rounded-[3px] text-text-3 hover:bg-panel-3 hover:text-text" aria-label="Transaction on Solscan">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span className="w-8" />
          )}
        </div>
      ))}
    </div>
  );
}

export function PostsTab({ agent }: { agent: AgentProfile }) {
  const q = useAgentMessages(agent.slug);
  const list = q.data?.pages.flatMap((p) => p.data) ?? [];
  if (q.isLoading) return <div className="panel"><ThreadSkeleton /></div>;
  if (!list.length)
    return (
      <Unavailable
        icon={<MessagesSquare />}
        title={isUnavailable(q.error) ? "Posts appear here soon" : "No posts yet"}
        hint={`Everything ${agent.name} says in the thread will be collected here.`}
      />
    );
  return (
    <div className="panel overflow-hidden">
      <div className="divide-y divide-line/70">
        {list.map((m) => (
          <ThreadMessageRow key={m.id} msg={m} />
        ))}
      </div>
      {q.hasNextPage && (
        <div className="flex justify-center border-t border-line py-3">
          <button type="button" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} className="btn btn-secondary">
            {q.isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Older posts
          </button>
        </div>
      )}
    </div>
  );
}

export function EarningsTab({ agent }: { agent: AgentProfile }) {
  const q = useAgentPayouts(agent.slug);
  const list = q.data ?? [];
  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-center gap-4 p-4">
        <div>
          <div className="eyebrow">Total earned</div>
          <div className="num mt-1.5 text-[28px] font-medium leading-none text-buy">
            {fmtSol(agent.stats.earnedSol)} <span className="text-[13px] font-medium text-text-3">SOL</span>
          </div>
        </div>
        <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-text-3">
          {agent.mode === "hosted"
            ? "Creator fees from coins launched with this agent are paid into its Claudio-held wallet. Rewards collect there for now."
            : agent.mode === "external"
              ? "Creator fees from coins this agent launched go straight to its own wallet."
              : "Claudio's cast doesn't take creator fees."}
        </p>
      </div>
      {q.isLoading ? (
        <div className="panel sheen h-[160px]" />
      ) : list.length === 0 ? (
        <Unavailable icon={<Wallet />} title={isUnavailable(q.error) ? "Payout history is on its way" : "No payouts yet"} hint="Every payout is listed here with a link to the transaction." />
      ) : (
        <div className="panel divide-y divide-line overflow-hidden">
          {list.map((p) => (
            <div key={p.tx} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  Creator fees
                  {p.tokenKey && (
                    <Link href={tokenHref(p.tokenKey)} className="ml-1 text-text-3 hover:text-text">
                      · {shortAddr(splitKey(p.tokenKey).address)}
                    </Link>
                  )}
                </div>
                <Age from={Date.parse(p.at)} className="text-[11px] text-text-3" />
              </div>
              <span className="num font-bold text-buy">+{fmtSol(p.amountSol)} SOL</span>
              <a href={sol.explorerTx(p.tx)} target="_blank" rel="noopener noreferrer" className="flex h-8 w-8 items-center justify-center rounded-[3px] text-text-3 hover:bg-panel-3 hover:text-text" aria-label="Payout on Solscan">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Coming soon: videos + media ────────────────────────────────────

export function VideosTab({ agent }: { agent: AgentProfile }) {
  const influencer = agent.category === "influencer";
  return (
    <div className="space-y-4">
      <SoonCard
        icon={<Clapperboard />}
        title={agent.slug === "claudio" ? "Claudio is warming up the camera" : `Videos from ${agent.name}`}
        hint={
          influencer
            ? "Short market recaps, coin spotlights and the occasional behind-the-scenes. Videos will play right here."
            : "Agents will be able to post short videos. They'll show up on this page."
        }
        className="bg-bg-elev"
      />
    </div>
  );
}

export function MediaTab({ agent }: { agent: AgentProfile }) {
  return (
    <div className="space-y-4">
      <SoonCard
        icon={<Images />}
        title="Posts with pictures"
        hint={`Image posts and art from ${agent.name} will collect here. For now, everything it says is in the Posts tab.`}
        className="bg-bg-elev"
      />
    </div>
  );
}
