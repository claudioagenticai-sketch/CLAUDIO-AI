// ⌘K palette: search tokens (local board + server), paste any CA to open it, jump anywhere,
// switch chain, toggle board behaviour. Custom filtering (cmdk's is disabled) so server
// results and address matches are never hidden by fuzzy scoring.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  ArrowRight,
  Bell,
  BellOff,
  BookOpen,
  Bot,
  Briefcase,
  Gift,
  Hand,
  Home,
  LayoutGrid,
  Loader2,
  Plus,
  Radar,
  SearchX,
  Settings as SettingsIcon,
  Sparkles,
  Star,
  Wallet,
} from "lucide-react";
import { CHAINS, ENABLED_CHAINS, type ChainId } from "@shared/chains";
import { DEFAULT_CHAIN } from "@shared/platform";
import { usePlatformConfig } from "@/lib/platform";
import type { TokenSnapshot } from "@shared/types";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { ChainBadge, Empty, ClaudioSpark, TokenAvatar } from "@/components/kit";
import { fmtAge, fmtUsd, shortAddr } from "@/lib/format";
import { haptic, useBoard, useSettings, useUI } from "@/lib/store";
import { cn } from "@/lib/utils";

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const B58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Chains an address could belong to, based on its format. */
function chainsForAddress(q: string): ChainId[] {
  if (EVM_RE.test(q)) return ENABLED_CHAINS.filter((c) => CHAINS[c].kind === "evm");
  if (B58_RE.test(q)) return ENABLED_CHAINS.filter((c) => CHAINS[c].kind === "svm");
  return [];
}

function scoreToken(t: TokenSnapshot, q: string): number {
  const sym = t.symbol.toLowerCase();
  const name = t.name.toLowerCase();
  const addr = t.address.toLowerCase();
  if (addr === q) return 100;
  if (sym === q) return 50;
  if (sym.startsWith(q)) return 30;
  if (q.length >= 4 && addr.startsWith(q)) return 25;
  if (name.startsWith(q)) return 20;
  if (sym.includes(q)) return 12;
  if (name.includes(q)) return 8;
  return 0;
}

function parseResults(json: unknown): TokenSnapshot[] {
  if (Array.isArray(json)) return json as TokenSnapshot[];
  if (json && typeof json === "object" && Array.isArray((json as { tokens?: unknown }).tokens)) {
    return (json as { tokens: TokenSnapshot[] }).tokens;
  }
  return [];
}

const ITEM = "group gap-3 rounded-[2px] px-2.5 py-2 text-[13px]";
const TOKEN_ITEM = "group gap-3 rounded-[2px] px-2.5 py-2";
const ICON_TILE =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-[2px] text-text-3 ring-1 ring-inset ring-line transition-colors group-data-[selected=true]:text-brand group-data-[selected=true]:ring-brand/40";

function FootKey({ k, label }: { k: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="num rounded-[2px] border border-line-2 px-1.5 py-0.5 text-[10px] text-text-2">{k}</kbd>
      {label}
    </span>
  );
}

interface Action {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords: string;
  shortcut?: string;
  run: () => void;
}

function TokenRow({ t }: { t: TokenSnapshot }) {
  return (
    <>
      <TokenAvatar image={t.image} symbol={t.symbol} launchpad={t.launchpad} size={30} className="-m-1" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-semibold text-text">{t.symbol}</span>
          <span className="truncate text-[12px] text-text-3">{t.name}</span>
        </span>
        <span className="num flex items-center gap-1.5 text-[11px] text-text-3">
          <ChainBadge chain={t.chain} label />
          <span>{shortAddr(t.address)}</span>
          <span>· {fmtAge(t.createdAt)}</span>
        </span>
      </div>
      <span className="num ml-2 shrink-0 text-right text-[12px]">
        <span className="block font-semibold text-text">{fmtUsd(t.mcapUsd)}</span>
        <span className={cn("block text-[11px]", t.change1hPct >= 0 ? "text-buy" : "text-sell")}>
          {t.change1hPct >= 0 ? "+" : ""}
          {t.change1hPct.toFixed(1)}%
        </span>
      </span>
    </>
  );
}

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPalette);
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<TokenSnapshot[]>([]);
  const [searching, setSearching] = useState(false);
  const tokens = useBoard((s) => s.tokens);
  const chain = useSettings((s) => s.chain);
  const pauseOnHover = useSettings((s) => s.pauseOnHover);
  const soundAlerts = useSettings((s) => s.soundAlerts);
  const watchlist = useSettings((s) => s.watchlist);
  const reqId = useRef(0);
  const { data: platform } = usePlatformConfig();

  const q = query.trim();
  const ql = q.toLowerCase();

  // Reset when closed.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setRemote([]);
      setSearching(false);
    }
  }, [open]);

  // Debounced server search.
  useEffect(() => {
    if (!open || q.length < 2) {
      setRemote([]);
      setSearching(false);
      return;
    }
    const id = ++reqId.current;
    const ac = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((j: unknown) => {
          if (id === reqId.current) setRemote(parseResults(j).slice(0, 20));
        })
        .catch(() => {
          if (id === reqId.current) setRemote([]);
        })
        .finally(() => {
          if (id === reqId.current) setSearching(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [q, open]);

  const close = () => setOpen(false);
  const go = (href: string) => {
    haptic();
    close();
    setLocation(href);
  };
  const openToken = (t: TokenSnapshot) => go(`/t/${t.chain}/${t.address}`);

  const addrChains = useMemo(() => chainsForAddress(q), [q]);

  const tokenResults = useMemo<TokenSnapshot[]>(() => {
    if (!ql) return [];
    const scored: { t: TokenSnapshot; s: number }[] = [];
    for (const k in tokens) {
      const t = tokens[k];
      const s = scoreToken(t, ql);
      if (s > 0) scored.push({ t, s: s + (t.chain === chain ? 2 : 0) });
    }
    scored.sort((a, b) => b.s - a.s || b.t.mcapUsd - a.t.mcapUsd);
    const out: TokenSnapshot[] = [];
    const seen = new Set<string>();
    for (const { t } of scored) {
      if (out.length >= 8) break;
      out.push(t);
      seen.add(t.key);
    }
    for (const t of remote) {
      if (out.length >= 16) break;
      if (!t || seen.has(t.key)) continue;
      out.push(t);
      seen.add(t.key);
    }
    return out;
  }, [ql, tokens, remote, chain]);

  const watched = useMemo<TokenSnapshot[]>(
    () => (ql ? [] : watchlist.map((k) => tokens[k]).filter((t): t is TokenSnapshot => Boolean(t)).slice(0, 6)),
    [ql, watchlist, tokens],
  );

  const actions: Action[] = [
    { id: "nav-home", label: "Home", hint: "Coins, agents and the thread", icon: <Home />, keywords: "start feed thread app", shortcut: "G H", run: () => go("/home") },
    { id: "nav-site", label: "Meet Claudio", hint: "The front page and his character", icon: <Sparkles />, keywords: "front landing about claudio character", run: () => go("/claudio") },
    { id: "nav-trenches", label: "Trenches", hint: "Live board of new coins", icon: <LayoutGrid />, keywords: "board new pairs", shortcut: "G T", run: () => go("/trenches") },
    { id: "nav-launch", label: "Launch token", hint: "Create a coin with a locked 70/30 split", icon: <Plus />, keywords: "create deploy new coin", shortcut: "L", run: () => go("/launch") },
    { id: "nav-portfolio", label: "Portfolio", icon: <Briefcase />, keywords: "pnl holdings positions", shortcut: "G P", run: () => go("/portfolio") },
    { id: "nav-agents", label: "Agents", hint: "AI agents that launch and trade", icon: <Bot />, keywords: "ai bots influencer trader", shortcut: "G A", run: () => go("/agents") },
    { id: "nav-tracker", label: "Wallet tracker", icon: <Radar />, keywords: "track follow wallets copy", shortcut: "G R", run: () => go("/tracker") },
    { id: "nav-creator", label: "Creator dashboard", icon: <Sparkles />, keywords: "fees harvest my launches", run: () => go("/creator") },
    { id: "nav-wallets", label: "Wallets", icon: <Wallet />, keywords: "keys import export balance", run: () => go("/wallets") },
    { id: "nav-settings", label: "Settings", icon: <SettingsIcon />, keywords: "preferences slippage presets", shortcut: "G S", run: () => go("/settings") },
    { id: "nav-claim", label: "Claim fees", icon: <Gift />, keywords: "creator rewards social vault", shortcut: "G F", run: () => go("/claim") },
    { id: "nav-docs", label: "Docs", hint: "How Claudio works: fees, agents, API", icon: <BookOpen />, keywords: "help faq fees api token", shortcut: "G D", run: () => go("/docs") },
  ];

  const toggles: Action[] = [
    {
      id: "toggle-pause",
      label: `Pause on hover: ${pauseOnHover ? "On" : "Off"}`,
      hint: "Freeze columns while your cursor is on them",
      icon: <Hand />,
      keywords: "pause hover freeze board",
      run: () => {
        haptic();
        useSettings.getState().set({ pauseOnHover: !pauseOnHover });
      },
    },
    {
      id: "toggle-sound",
      label: `Sound alerts: ${soundAlerts ? "On" : "Off"}`,
      hint: "Short blips for alerts and fills",
      icon: soundAlerts ? <Bell /> : <BellOff />,
      keywords: "sound audio mute alerts",
      run: () => {
        haptic();
        useSettings.getState().set({ soundAlerts: !soundAlerts });
      },
    },
  ];

  // Only chains that are open can be switched to; the rest are "coming soon".
  const chainActions: Action[] = ENABLED_CHAINS.filter(
    (c) => (platform?.chains.find((r) => r.chain === c)?.state ?? (c === DEFAULT_CHAIN ? "open" : "coming_soon")) !== "coming_soon",
  ).map((c) => ({
    id: `chain-${c}`,
    label: `Switch to ${CHAINS[c].name}`,
    icon: <span className="h-2.5 w-2.5 rounded-full" style={{ background: CHAINS[c].color }} />,
    keywords: `chain network ${CHAINS[c].short} ${CHAINS[c].nativeSymbol}`,
    hint: c === chain ? "Current" : undefined,
    run: () => {
      haptic();
      useSettings.getState().set({ chain: c });
      close();
    },
  }));

  const match = (a: Action) => !ql || `${a.label} ${a.keywords} ${a.hint ?? ""}`.toLowerCase().includes(ql);
  const navShown = actions.filter(match);
  const chainShown = chainActions.filter(match);
  const toggleShown = toggles.filter(match);
  const nothing = !addrChains.length && !tokenResults.length && !watched.length && !navShown.length && !chainShown.length && !toggleShown.length;

  const renderAction = (a: Action) => (
    <CommandItem key={a.id} value={a.id} onSelect={a.run} className={ITEM}>
      <span className={ICON_TILE}>{a.icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold text-text">{a.label}</span>
        {a.hint && <span className="truncate text-[11px] text-text-3">{a.hint}</span>}
      </span>
      {a.shortcut && (
        <CommandShortcut className="num flex gap-1 tracking-normal">
          {a.shortcut.split(" ").map((k, i) => (
            <kbd key={i} className="min-w-[20px] rounded-[3px] border border-line-2 bg-bg px-1.5 py-0.5 text-center text-[10px] font-semibold text-text-2">
              {k}
            </kbd>
          ))}
        </CommandShortcut>
      )}
    </CommandItem>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className={cn(
          "w-[calc(100%-24px)] max-w-[620px] gap-0 overflow-hidden rounded-[4px] border-line-2 bg-bg-elev p-0 sm:rounded-[4px]",
          "top-[calc(var(--safe-top)+12px)] translate-y-0 sm:top-[12vh]",
          "[&>button:last-child]:hidden",
        )}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Search tokens, paste a contract address, or jump to a page.</DialogDescription>
        <Command
          shouldFilter={false}
          loop
          className={cn(
            "rounded-none bg-bg-elev",
            "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-normal [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-text-3",
            "[&_[cmdk-input-wrapper]]:border-line [&_[cmdk-input-wrapper]]:px-4 [&_[cmdk-input-wrapper]_svg]:mr-3 [&_[cmdk-input-wrapper]_svg]:h-[18px] [&_[cmdk-input-wrapper]_svg]:w-[18px] [&_[cmdk-input-wrapper]_svg]:text-brand [&_[cmdk-input-wrapper]_svg]:opacity-100",
            "[&_[cmdk-item][data-selected=true]]:bg-panel-2 [&_[cmdk-item][data-selected=true]]:shadow-[inset_2px_0_0_var(--brand)]",
          )}
        >
          <div className="relative">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search token, paste a CA, or type a command…"
              className="h-14 pr-10 text-[15px] sm:pr-20 font-medium placeholder:font-normal placeholder:text-text-3"
              autoFocus
            />
            <span className="pointer-events-none absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-2">
              {searching && <Loader2 className="h-4 w-4 animate-spin text-brand" />}
              <kbd className="num hidden rounded-[3px] border border-line-2 bg-bg px-1.5 py-0.5 text-[10px] font-semibold text-text-3 sm:inline">ESC</kbd>
            </span>
          </div>
          <CommandList className="max-h-[min(60vh,480px)] overscroll-contain p-1.5">
            {nothing && (
              <CommandEmpty>
                <Empty
                  icon={searching ? <Loader2 className="animate-spin" /> : <SearchX />}
                  title={searching ? "Searching…" : `No results for “${q}”`}
                  hint={searching ? undefined : "Try a ticker, a name, or paste a full contract address."}
                />
              </CommandEmpty>
            )}

            {addrChains.length > 0 && (
              <CommandGroup heading="Contract address">
                {addrChains.map((c) => (
                  <CommandItem key={`addr-${c}`} value={`addr-${c}`} onSelect={() => go(`/t/${c}/${q}`)} className={ITEM}>
                    <span className={ICON_TILE}>
                      <ChainBadge chain={c} size={16} />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[13px] font-semibold text-text">Open token on {CHAINS[c].name}</span>
                      <span className="num truncate text-[11px] text-text-3">{shortAddr(q, 8, 8)}</span>
                    </span>
                    <ArrowRight className="ml-auto h-4 w-4 text-text-3 group-data-[selected=true]:text-brand" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {tokenResults.length > 0 && (
              <CommandGroup heading="Tokens">
                {tokenResults.map((t) => (
                  <CommandItem key={t.key} value={`tok-${t.key}`} onSelect={() => openToken(t)} className={TOKEN_ITEM}>
                    <TokenRow t={t} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {watched.length > 0 && (
              <CommandGroup heading="Watchlist">
                {watched.map((t) => (
                  <CommandItem key={`w-${t.key}`} value={`watch-${t.key}`} onSelect={() => openToken(t)} className={TOKEN_ITEM}>
                    <TokenRow t={t} />
                    <Star className="h-3.5 w-3.5 shrink-0 text-gold" fill="currentColor" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {navShown.length > 0 && (
              <>
                {(tokenResults.length > 0 || watched.length > 0 || addrChains.length > 0) && <CommandSeparator className="mx-1 my-1.5 bg-line" />}
                <CommandGroup heading="Go to">{navShown.map(renderAction)}</CommandGroup>
              </>
            )}
            {chainShown.length > 0 && <CommandGroup heading="Chain">{chainShown.map(renderAction)}</CommandGroup>}
            {toggleShown.length > 0 && <CommandGroup heading="Board">{toggleShown.map(renderAction)}</CommandGroup>}
          </CommandList>
          <div className="hidden items-center gap-4 border-t border-line bg-bg px-4 py-2.5 font-mono text-[10.5px] text-text-3 sm:flex">
            <FootKey k="↑↓" label="navigate" />
            <FootKey k="↵" label="open" />
            <FootKey k="⌘K" label="toggle" />
            <span className="ml-auto flex items-center gap-2">
              <ClaudioSpark className="opacity-80" />
              Paste any SOL, HOOD or BSC contract address
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export default CommandPalette;
