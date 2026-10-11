// Name / ticker / description / socials. Ticker auto-follows the name until edited.
import { useMemo } from "react";
import { AlertTriangle, Globe, Send, Wand2 } from "lucide-react";
import type { ChainId } from "@shared/chains";
import type { LaunchpadId } from "@shared/launchpads";
import { PUMP_LIMITS, normalizeCoinName, normalizeTicker } from "@shared/platform";
import { Switch } from "@/components/ui/switch";
import { useBoard } from "@/lib/store";
import { cn } from "@/lib/utils";
import { deriveTicker, useLaunchDraft } from "./draft";
import { Callout, FieldLabel, TextArea, TextInput } from "./ui";

export function nameLimits(launchpad?: LaunchpadId): { name: number; symbol: number; description: number } {
  if (launchpad === "pump") return { name: PUMP_LIMITS.nameMax, symbol: PUMP_LIMITS.symbolMax, description: 1000 };
  return { name: 64, symbol: 16, description: 2048 };
}

/**
 * Name / ticker problems for this launchpad (null = fine). pump.fun: the exact rules the server enforces (NFKC,
 * ticker A–Z0–9 ≤ 13, name ≤ 32 UTF-8 bytes, never truncated). Empty fields aren't reported here.
 */
export function coinFieldErrors(launchpad: LaunchpadId | undefined, name: string, symbol: string): { name: string | null; symbol: string | null } {
  const lim = nameLimits(launchpad);
  if (launchpad === "pump") {
    const n = name.trim() ? normalizeCoinName(name, lim.name) : null;
    const t = symbol.trim() ? normalizeTicker(symbol, lim.symbol) : null;
    return { name: n && !n.ok ? n.error : null, symbol: t && !t.ok ? t.error : null };
  }
  return {
    name: Array.from(name.trim()).length > lim.name ? `Names are limited to ${lim.name} characters` : null,
    symbol: !symbol.trim()
      ? null
      : !/^[A-Z0-9]+$/.test(symbol)
        ? "Tickers can only use letters A–Z and digits 0–9"
        : symbol.length > lim.symbol
          ? `Tickers are limited to ${lim.symbol} characters`
          : null,
  };
}

const utf8Len = (s: string) => new TextEncoder().encode(s.normalize("NFKC")).length;

export function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/** Same ticker launched on this chain in the last hour (from the live board). */
function useDuplicateTicker(chain: ChainId, symbol: string): number {
  const tokens = useBoard((s) => s.tokens);
  return useMemo(() => {
    const sym = symbol.trim().toUpperCase();
    if (sym.length < 2) return 0;
    const since = Date.now() - 3_600_000;
    return Object.values(tokens).filter((t) => t.chain === chain && t.createdAt >= since && t.symbol.toUpperCase() === sym).length;
  }, [tokens, chain, symbol]);
}

export function CoinIdentityFields({ chain, launchpad }: { chain: ChainId; launchpad?: LaunchpadId }) {
  const d = useLaunchDraft();
  const lim = nameLimits(launchpad);
  const dupes = useDuplicateTicker(chain, d.symbol);
  // pump.fun limits the name in bytes (emoji/accents count more), so count bytes there.
  const nameLen = launchpad === "pump" ? utf8Len(d.name.trim()) : Array.from(d.name).length;
  const errs = coinFieldErrors(launchpad, d.name, d.symbol);
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_minmax(0,180px)]">
      <div>
        <FieldLabel label="Coin name" htmlFor="coin-name" count={nameLen} max={lim.name} required />
        <TextInput
          id="coin-name"
          value={d.name}
          maxLength={160}
          invalid={!!errs.name}
          onChange={(e) => d.setName(e.target.value)}
          placeholder="e.g. Moon Frog"
          autoComplete="off"
          enterKeyHint="next"
        />
      </div>
      <div>
        <FieldLabel
          label="Ticker"
          htmlFor="coin-ticker"
          count={d.symbol.length}
          max={lim.symbol}
          required
          hint={
            d.symbolEdited && d.name ? (
              <button
                type="button"
                className="inline-flex items-center gap-0.5 text-brand hover:underline"
                onClick={() => d.patch({ symbol: deriveTicker(d.name), symbolEdited: false })}
              >
                <Wand2 className="h-3 w-3" /> auto
              </button>
            ) : undefined
          }
        />
        <TextInput
          id="coin-ticker"
          value={d.symbol}
          invalid={!!errs.symbol}
          onChange={(e) => d.setSymbol(e.target.value)}
          placeholder="FROG"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="num uppercase tracking-wider"
          leading={<span className="text-[13px] font-bold">$</span>}
        />
      </div>
      {(errs.name || errs.symbol) && (
        <div className="space-y-0.5 text-[11.5px] leading-snug text-sell sm:col-span-2" role="alert">
          {errs.name && <div>{errs.name}</div>}
          {errs.symbol && <div>{errs.symbol}</div>}
        </div>
      )}
      {dupes > 0 && (
        <Callout tone="warn" icon={<AlertTriangle />} className="sm:col-span-2">
          <b>${d.symbol}</b> was launched {dupes === 1 ? "once" : `${dupes} times`} on this chain in the last hour. Traders may confuse the two.
        </Callout>
      )}
    </div>
  );
}

export function CoinDetailsFields({ launchpad }: { launchpad?: LaunchpadId }) {
  const d = useLaunchDraft();
  const lim = nameLimits(launchpad);
  return (
    <div className="space-y-4">
      <div>
        <FieldLabel label="Description" htmlFor="coin-desc" count={d.description.length} max={lim.description} />
        <TextArea
          id="coin-desc"
          value={d.description}
          onChange={(e) => d.patch({ description: e.target.value.slice(0, lim.description) })}
          placeholder="What's the story? (optional)"
          rows={3}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <FieldLabel label="X / Twitter" htmlFor="coin-x" />
          <TextInput id="coin-x" value={d.twitter} onChange={(e) => d.patch({ twitter: e.target.value })} placeholder="x.com/…" inputMode="url" leading={<XLogo />} />
        </div>
        <div>
          <FieldLabel label="Telegram" htmlFor="coin-tg" />
          <TextInput id="coin-tg" value={d.telegram} onChange={(e) => d.patch({ telegram: e.target.value })} placeholder="t.me/…" inputMode="url" leading={<Send />} />
        </div>
        <div>
          <FieldLabel label="Website" htmlFor="coin-web" />
          <TextInput id="coin-web" value={d.website} onChange={(e) => d.patch({ website: e.target.value })} placeholder="https://…" inputMode="url" leading={<Globe />} />
        </div>
      </div>
      <label className={cn("flex min-h-[56px] cursor-pointer items-center gap-3 rounded-[3px] border border-line px-3 py-2.5 transition-colors hover:border-line-2")}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] ring-1 ring-inset ring-line-2 text-text">
          <XLogo className="h-3.5 w-3.5" />
        </span>
        <span className="flex-1">
          <span className="block text-[13px] font-semibold">Post on X after launch</span>
          <span className="block text-[11px] text-text-3">Opens a ready-to-send post with your contract address and chart link.</span>
        </span>
        <Switch checked={d.postOnX} onCheckedChange={(postOnX) => d.patch({ postOnX })} />
      </label>
    </div>
  );
}

/** Normalizes handle-style inputs into URLs for metadata. */
export function socialUrl(kind: "twitter" | "telegram" | "website", v: string): string | undefined {
  const s = v.trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  if (kind === "twitter") return `https://x.com/${s.replace(/^@/, "").replace(/^(x|twitter)\.com\//i, "")}`;
  if (kind === "telegram") return `https://t.me/${s.replace(/^@/, "").replace(/^t\.me\//i, "")}`;
  return `https://${s}`;
}
