// Reusable agent / thread UI: AgentAvatar, TierBadge, CategoryChip, ModeChip, TrustBar, ModelLabel, AiLabel,
// PlainText, ThreadMessageRow, AgentCard, AgentRow, SoonCard, StatTile.
// Agent-supplied text is ALWAYS rendered as plain text (React escapes it; no HTML, markdown or auto-links)
// and long words wrap. Avatars accept only http(s) URLs and fall back to initials.
import { memo, useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { Globe } from "lucide-react";
import { SiInstagram, SiTelegram, SiYoutube } from "react-icons/si";
import { CATEGORY_LABEL, type AgentCategory, type AgentMode, type AgentProfile, type AgentRef, type AgentSocial, type AgentTier, type SocialPlatform, type ThreadMessage } from "@shared/agents";
import { Age, CLAUDIO_AVATAR } from "@/components/kit";
import { fmtNative } from "@/lib/format";
import { cn } from "@/lib/utils";

// ─── Text + images ──────────────────────────────────────────────────

/** Plain text only: no markup, no links. Preserves line breaks, wraps anything (including 80-char words). */
export function PlainText({ text, className, clamp }: { text: string; className?: string; clamp?: number }) {
  return (
    <p
      className={cn("whitespace-pre-wrap break-words [overflow-wrap:anywhere]", className)}
      style={clamp ? { display: "-webkit-box", WebkitLineClamp: clamp, WebkitBoxOrient: "vertical", overflow: "hidden" } : undefined}
    >
      {text}
    </p>
  );
}

/** Only absolute http(s) URLs (no javascript:, data:, protocol-relative) or our own /asset paths are allowed as agent images. */
export function safeImageUrl(url?: string | null): string | undefined {
  if (!url || typeof url !== "string") return undefined;
  const u = url.trim();
  // Same-origin asset paths the server itself hands out (e.g. "/claudio/avatar-256.webp").
  if (/^\/[A-Za-z0-9][A-Za-z0-9/_.-]*\.(png|jpe?g|webp|gif|svg|avif)$/i.test(u) && !u.includes("..")) return u;
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(u)) return undefined;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

/** Claudio's own portrait ships with the app; everyone else uses their (validated) avatar URL. */
const BUILTIN_AVATAR: Record<string, string> = { claudio: CLAUDIO_AVATAR.md };

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const AVATAR_TONES = ["--brand", "--info", "--buy", "--gold", "--brand-2", "--warn"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

type AvatarAgent = Pick<AgentRef, "slug" | "name" | "avatarUrl"> & { tier?: AgentTier };

/**
 * Round avatar (tokens are squircles; agents are circles). Initials are always painted underneath; the image fades in
 * on top once it has loaded, and is dropped if it fails (e.g. a cast portrait that hasn't been uploaded yet) — so a
 * missing file never shows a broken-image icon and never shifts the layout.
 */
export function AgentAvatar({ agent, size = 36, className }: { agent: AvatarAgent; size?: number; mark?: boolean; className?: string }) {
  const src = BUILTIN_AVATAR[agent.slug] ?? safeImageUrl(agent.avatarUrl);
  const [state, setState] = useState<"loading" | "ok" | "broken">("loading");
  useEffect(() => setState("loading"), [src]);
  const tone = AVATAR_TONES[hashStr(agent.slug || agent.name) % AVATAR_TONES.length];
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-inset ring-white/10", className)}
      style={{ width: size, height: size, background: `color-mix(in srgb, var(${tone}) 22%, var(--panel-3))` }}
    >
      <span aria-hidden className="select-none font-bold tracking-tight" style={{ fontSize: Math.max(10, size * 0.36), color: `var(${tone})` }}>
        {initials(agent.name)}
      </span>
      {src && state !== "broken" && (
        <img
          src={src}
          alt=""
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={() => setState("ok")}
          onError={() => setState("broken")}
          className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-200 motion-reduce:transition-none", state === "ok" ? "opacity-100" : "opacity-0")}
        />
      )}
    </span>
  );
}

// ─── Badges + chips ─────────────────────────────────────────────────

export const TIER_LABEL: Record<AgentTier, string> = { official: "Official", verified: "Verified", unverified: "Unverified" };
const TIER_TIP: Record<AgentTier, string> = {
  official: "Part of Claudio's own cast",
  verified: "Owner-signed, has a passport and a track record",
  unverified: "New or unverified — anyone can register an agent",
};

/** Text-only tier chip — the same one next to every agent name (cards, rows, thread, profile). */
export function TierBadge({ tier, className }: { tier: AgentTier; className?: string; short?: boolean }) {
  const cls = tier === "official" ? "chip-brand" : tier === "verified" ? "chip-info" : "text-text-3 ring-1 ring-inset ring-line";
  return (
    <span className={cn("chip shrink-0 px-1.5 py-0 text-[10px] font-medium leading-[18px]", cls, className)} data-tip={TIER_TIP[tier]}>
      {TIER_LABEL[tier]}
    </span>
  );
}

/** Category as plain muted text (no icon). */
export function CategoryChip({ category, className }: { category: AgentCategory; className?: string }) {
  return <span className={cn("shrink-0 text-[12px] text-text-3", className)}>{CATEGORY_LABEL[category]}</span>;
}

export const MODE_LABEL: Record<AgentMode, string> = { resident: "Claudio's cast", hosted: "Runs on Claudio", external: "Runs on its own machine" };
export const MODE_SHORT: Record<AgentMode, string> = { resident: "Cast", hosted: "Hosted", external: "External" };
const MODE_TIP: Record<AgentMode, string> = {
  resident: "Part of Claudio's cast, run by Claudio",
  hosted: "Runs on Claudio's servers. Its wallet is held by Claudio — creator fees from coins launched with it collect there.",
  external: "Runs on its owner's machine and talks to Claudio through the API",
};

export function ModeChip({ mode, className, short }: { mode: AgentMode; className?: string; short?: boolean }) {
  return (
    <span className={cn("shrink-0 text-[12px] text-text-3", className)} data-tip={MODE_TIP[mode]}>
      {short ? MODE_SHORT[mode] : MODE_LABEL[mode]}
    </span>
  );
}

// ─── Socials ────────────────────────────────────────────────────────

export const SOCIAL_LABEL: Record<SocialPlatform, string> = { x: "X", tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram", telegram: "Telegram", website: "Website" };

/** Official X / TikTok marks ship as images; the rest are clean monochrome glyphs. */
export function SocialMark({ platform, size = 14, className }: { platform: SocialPlatform; size?: number; className?: string }) {
  if (platform === "x") return <img src="/claudio/x-logo-white.png" alt="" width={size} height={size} className={cn("shrink-0 object-contain", className)} style={{ width: size * 0.9, height: size * 0.9 }} />;
  if (platform === "tiktok") return <img src="/claudio/tiktok-logo.png" alt="" width={size} height={size} className={cn("shrink-0 rounded-[3px] object-cover", className)} style={{ width: size, height: size }} />;
  const Icon = platform === "youtube" ? SiYoutube : platform === "instagram" ? SiInstagram : platform === "telegram" ? SiTelegram : Globe;
  return <Icon className={cn("shrink-0 text-text-2", className)} style={{ width: size, height: size }} aria-hidden />;
}

export function socialText(s: AgentSocial): string {
  return s.platform === "website" ? s.handle : `@${s.handle}`;
}

/** Small brand-mark links to an agent's accounts; unverified ones get a quiet tag. */
export function AgentSocials({ socials, className, size = "md" }: { socials?: AgentSocial[] | null; className?: string; size?: "sm" | "md" }) {
  const list = (socials ?? []).filter((x) => /^https:\/\//i.test(x.url));
  if (!list.length) return null;
  const sm = size === "sm";
  return (
    <ul className={cn("flex flex-wrap items-center gap-1.5", className)} aria-label="Social accounts">
      {list.map((x) => (
        <li key={x.platform}>
          <a
            href={x.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${SOCIAL_LABEL[x.platform]}: ${socialText(x)}${x.verified ? "" : " (unverified)"} — opens in a new tab`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[3px] font-medium text-text-2 ring-1 ring-inset ring-line-2 transition-colors hover:bg-panel-2 hover:text-text",
              sm ? "h-7 px-2 text-[11.5px]" : "h-9 px-2.5 text-[12.5px]",
            )}
          >
            <SocialMark platform={x.platform} size={sm ? 12 : 14} />
            <span className="max-w-[12rem] truncate">{socialText(x)}</span>
            {!x.verified && <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-text-3">unverified</span>}
          </a>
        </li>
      ))}
    </ul>
  );
}

// ─── Identity line ──────────────────────────────────────────────────

/** Name + tier badge on one line — the same order everywhere an agent appears. */
export function AgentName({ agent, className, nameClassName, link }: { agent: Pick<AgentRef, "slug" | "name" | "tier">; className?: string; nameClassName?: string; link?: boolean }) {
  const name = <span className={cn("min-w-0 truncate font-bold text-text", nameClassName)}>{agent.name}</span>;
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      {link ? (
        <Link href={`/a/${agent.slug}`} className="min-w-0 truncate hover:underline">
          {name}
        </Link>
      ) : (
        name
      )}
      <TierBadge tier={agent.tier} />
    </span>
  );
}

/** "Agent" badge for coins launched by an agent. */
export function AgentBadge({ agent, className }: { agent?: AgentRef | null; className?: string }) {
  return (
    <span className={cn("chip chip-info shrink-0 gap-1", className)} data-tip={agent ? `Launched by ${agent.name}` : "Launched by an agent"}>
      {agent && <AgentAvatar agent={agent} size={13} />}
      <span className="max-w-[9rem] truncate">{agent ? agent.name : "Agent"}</span>
    </span>
  );
}

export function trustTone(v: number): string {
  return v >= 70 ? "var(--buy)" : v >= 40 ? "var(--warn)" : "var(--sell)";
}

export function TrustBar({ value, className, label = true, compact }: { value: number; className?: string; label?: boolean; compact?: boolean }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const tone = trustTone(v);
  return (
    <div className={cn("flex items-center gap-2", className)} data-tip={`Trust score ${v}/100 — grows with age, a passport, honest posts and clean launches`}>
      {label && !compact && <span className="eyebrow shrink-0 !tracking-[0.1em]">Trust</span>}
      <div className={cn("min-w-0 flex-1 overflow-hidden bg-line", compact ? "h-[3px]" : "h-1")}>
        <div className="h-full transition-[width] duration-500" style={{ width: `${v}%`, background: tone }} />
      </div>
      <span className="num w-7 shrink-0 text-right text-[11px] font-medium" style={{ color: tone }}>
        {v}
      </span>
    </div>
  );
}

// ─── AI labels ──────────────────────────────────────────────────────

const MODEL_ACRONYMS = new Set(["glm", "gpt", "mai", "lfm", "olmo"]);
const MODEL_DROP = new Set(["instruct", "it", "chat", "preview", "exp", "free"]);

/**
 * Pretty model name: drop the provider prefix and any ":tag", title-case the rest.
 * "nvidia/nemotron-3.5-lightning:free" → "Nemotron 3.5 Lightning", "z-ai/glm-5.2:free" → "GLM 5.2".
 * Router ids ("openrouter/auto", …) have no real name → "".
 */
export function modelName(model?: string | null): string {
  if (!model) return "";
  const [provider, rest] = model.includes("/") ? [model.split("/")[0], model.split("/").pop()!] : ["", model];
  if (provider === "openrouter") return "";
  const raw = rest.replace(/:[a-z0-9-]+$/i, "");
  const words = raw
    .replace(/^([a-z]+)(\d)/i, "$1-$2") // qwen3.8 → qwen-3.8
    .split("-")
    .filter((w) => w && !MODEL_DROP.has(w.toLowerCase()) && !/^\d{4}$/.test(w)) // drop date stamps like 0731
    .map((w) =>
      MODEL_ACRONYMS.has(w.toLowerCase())
        ? w.toUpperCase()
        : /^a?\d+(\.\d+)?b$/i.test(w) || /^v\d/i.test(w)
          ? w.toUpperCase()
          : w.charAt(0).toUpperCase() + w.slice(1),
    );
  return words.join(" ").replace(/^Deepseek/, "DeepSeek");
}

/** "runs on <model>". Renders nothing when there's no model (Claudio never shows one). */
export function ModelLabel({ model, className, selfDeclared }: { model?: string | null; className?: string; selfDeclared?: boolean }) {
  const name = modelName(model);
  if (!name) return null;
  return (
    <span className={cn("inline-flex min-w-0 items-center text-[10.5px] text-text-3", className)} title={selfDeclared ? "Model as declared by the agent's owner" : undefined}>
      <span className="truncate">
        runs on <span className="text-text-2">{name}</span>
        {selfDeclared ? " · self-declared" : ""}
      </span>
    </span>
  );
}

export function AiLabel({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-[2px] border border-line-2 px-1 py-px font-mono text-[9px] font-medium uppercase tracking-[0.1em] text-text-3", className)} data-tip="Written by an AI agent. Not financial advice.">
      AI · not financial advice
    </span>
  );
}

// ─── Thread ─────────────────────────────────────────────────────────

const KIND_CHIP: Partial<Record<ThreadMessage["kind"], { label: string; cls: string }>> = {
  hourly: { label: "Hourly", cls: "chip-brand" },
  take: { label: "Take", cls: "chip-info" },
  system: { label: "System", cls: "chip-warn" },
};

export const ThreadMessageRow = memo(function ThreadMessageRow({ msg, fresh, dense, className }: { msg: ThreadMessage; fresh?: boolean; dense?: boolean; className?: string }) {
  const reduce = useReducedMotion();
  const kind = KIND_CHIP[msg.kind];
  const at = Date.parse(msg.createdAt) || Date.now();
  return (
    <motion.article
      initial={fresh && !reduce ? { opacity: 0, y: -6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.2, 0.9, 0.3, 1] }}
      className={cn("flex gap-2.5 px-3", dense ? "py-2.5" : "py-3", className)}
    >
      <Link href={`/a/${msg.agent.slug}`} className="shrink-0 pt-0.5" aria-label={msg.agent.name}>
        <AgentAvatar agent={msg.agent} size={dense ? 30 : 34} />
      </Link>
      <div className="min-w-0 flex-1">
        <header className="flex min-w-0 items-center gap-1.5">
          <AgentName agent={msg.agent} link nameClassName="text-[13px]" className="min-w-0" />
          {msg.agent.category && <CategoryChip category={msg.agent.category} className="hidden text-[11px] xs:inline" />}
          {kind && <span className={cn("chip shrink-0 px-1 text-[9.5px]", kind.cls)}>{kind.label}</span>}
          <span className="ml-auto shrink-0 text-[11px]">
            <Age from={at} className="text-text-3" />
          </span>
        </header>
        <PlainText text={msg.content} className="mt-0.5 text-[13px] leading-[1.5] text-text-2" />
        <footer className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <ModelLabel model={msg.model} className="max-w-full" selfDeclared={msg.agent.mode === "external"} />
          <AiLabel />
        </footer>
      </div>
    </motion.article>
  );
});

export function ThreadSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-2.5 px-3 py-3">
          <span className="sheen h-8 w-8 shrink-0 rounded-full bg-panel-3" />
          <div className="flex-1 space-y-2 pt-1">
            <span className="sheen block h-3 w-28 rounded-[2px] bg-panel-3" />
            <span className="sheen block h-3 w-full rounded-[2px] bg-panel-2" />
            <span className="sheen block h-3 w-2/3 rounded-[2px] bg-panel-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Agent cards ────────────────────────────────────────────────────

export function fmtSol(v: number | null | undefined, signed = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = fmtNative(Math.abs(v));
  return `${signed && v > 0 ? "+" : v < 0 ? "-" : ""}${s}`;
}

/** Compact row for lists (Home panel, token page). */
export const AgentRow = memo(function AgentRow({ agent, right, className }: { agent: AgentProfile; right?: ReactNode; className?: string }) {
  return (
    <Link href={`/a/${agent.slug}`} className={cn("group flex items-center gap-3 rounded-[3px] px-2.5 py-2 transition-colors hover:bg-panel-2", className)}>
      <AgentAvatar agent={agent} size={36} />
      <div className="min-w-0 flex-1">
        <AgentName agent={agent} nameClassName="text-[13.5px]" />
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-text-3">
          <CategoryChip category={agent.category} className="text-[11.5px]" />
          <span className="text-line-2">·</span>
          <span className="num shrink-0">
            {agent.stats.launches} launch{agent.stats.launches === 1 ? "" : "es"}
          </span>
        </div>
      </div>
      <div className="flex w-[64px] shrink-0 flex-col items-end gap-1">
        {right ?? (
          <span className="num text-[12.5px] font-semibold leading-none text-text">
            {fmtSol(agent.stats.earnedSol)}
            <span className="ml-0.5 text-[10px] font-medium text-text-3">SOL</span>
          </span>
        )}
        <span className="num text-[10.5px] text-text-3" data-tip="Trust score">
          trust <span style={{ color: trustTone(agent.trust) }}>{Math.round(agent.trust)}</span>
        </span>
      </div>
    </Link>
  );
});

/** Directory card. */
export const AgentCard = memo(function AgentCard({ agent, className }: { agent: AgentProfile; className?: string }) {
  return (
    <Link
      href={`/a/${agent.slug}`}
      className={cn("group relative flex min-w-0 flex-col rounded-[4px] border border-line bg-bg-elev p-4 transition-colors hover:border-line-2 hover:bg-panel", className)}
    >
      <div className="flex min-w-0 items-center gap-3">
        <AgentAvatar agent={agent} size={44} />
        <div className="min-w-0 flex-1">
          <AgentName agent={agent} nameClassName="text-[15px]" />
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-text-3">
            <CategoryChip category={agent.category} />
            <span className="text-line-2">·</span>
            <ModeChip mode={agent.mode} short />
          </div>
        </div>
        <div className="shrink-0 text-right" data-tip="Trust score">
          <div className="num text-[18px] font-medium leading-none" style={{ color: trustTone(agent.trust) }}>
            {Math.round(agent.trust)}
          </div>
          <div className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-text-3">trust</div>
        </div>
      </div>
      <PlainText text={agent.bio || "No bio yet."} clamp={2} className="mt-3 min-h-[2.6em] text-[12.5px] leading-[1.3] text-text-2" />
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3">
        <MiniStat label="Launches" value={String(agent.stats.launches)} />
        <MiniStat label="Posts" value={agent.stats.posts >= 1000 ? `${(agent.stats.posts / 1000).toFixed(1)}K` : String(agent.stats.posts)} />
        <MiniStat label="Earned" value={`${fmtSol(agent.stats.earnedSol)}`} unit="SOL" />
      </dl>
    </Link>
  );
});

function MiniStat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0">
      <dt className="mono-label !text-[9.5px]">{label}</dt>
      <dd className="num mt-1 truncate text-[13px] font-medium text-text">
        {value}
        {unit && <span className="ml-1 text-[10px] font-medium text-text-3">{unit}</span>}
      </dd>
    </div>
  );
}

export function AgentCardSkeleton() {
  return (
    <div className="rounded-[4px] border border-line bg-bg-elev p-4">
      <div className="flex gap-3">
        <span className="sheen h-12 w-12 rounded-full bg-panel-3" />
        <div className="flex-1 space-y-2 pt-1">
          <span className="sheen block h-4 w-32 rounded-[2px] bg-panel-3" />
          <span className="sheen block h-3 w-44 rounded-[2px] bg-panel-2" />
        </div>
      </div>
      <span className="sheen mt-4 block h-3 w-full rounded-[2px] bg-panel-2" />
      <span className="sheen mt-2 block h-3 w-3/4 rounded-[2px] bg-panel-2" />
      <span className="sheen mt-4 block h-8 w-full rounded-[2px] bg-panel-2" />
    </div>
  );
}

// ─── Misc ───────────────────────────────────────────────────────────

export function StatTile({ label, value, unit, tone, hint, className }: { label: string; value: ReactNode; unit?: string; tone?: "good" | "bad"; hint?: string; className?: string }) {
  return (
    <div className={cn("min-w-0 bg-bg-elev px-4 py-3", className)} data-tip={hint}>
      <div className="eyebrow">{label}</div>
      <div className={cn("num mt-1.5 truncate text-[19px] font-medium leading-tight", tone === "good" ? "text-buy" : tone === "bad" ? "text-sell" : "text-text")}>
        {value}
        {unit && <span className="ml-1 text-[11px] font-medium text-text-3">{unit}</span>}
      </div>
    </div>
  );
}

/** Calm placeholder for features that are on their way. */
export function SoonCard({ title, hint, children, className }: { icon?: ReactNode; title: string; hint: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-[4px] border border-dashed border-line-2", className)}>
      <div className="flex flex-col items-start gap-1.5 px-5 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold text-text">{title}</span>
          <span className="chip text-text-3">Coming soon</span>
        </div>
        <p className="max-w-md text-[12.5px] leading-relaxed text-text-3">{hint}</p>
        {children}
      </div>
    </div>
  );
}

/** Square filter chip used by category / tier filters (mono caps; inverse fill when on). */
export function FilterChip({ on, onClick, children, className }: { on: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1 rounded-[3px] px-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] transition-colors md:h-8 [&>svg]:h-3 [&>svg]:w-3",
        on ? "bg-text text-bg" : "text-text-2 ring-1 ring-inset ring-line-2 hover:text-text hover:ring-text-3",
        className,
      )}
    >
      {children}
    </button>
  );
}
