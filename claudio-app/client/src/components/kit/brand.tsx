// Claudio identity: his face as the logo, the CLAUDIO wordmark and the small "spark" accent.
import { BRAND } from "@shared/brand";
import { cn } from "@/lib/utils";

export const CLAUDIO_AVATAR = { sm: "/claudio/avatar-96.webp", md: "/claudio/avatar-256.webp" } as const;
/** Tight crop of his face (hair to chin) — reads at 16–36 px, used for the logo and favicons. */
export const CLAUDIO_FACE = "/claudio/face-128.webp";

/**
 * The Claudio mark — his face.
 *  - `tile` (default): the app logo — a tight face crop in a soft square (rail, top bar, docs).
 *  - `avatar`: his head-and-shoulders portrait in a circle (where he "speaks": the thread, cards).
 */
export function ClaudioMark({
  size = 28,
  variant = "tile",
  className,
  title,
}: {
  size?: number;
  variant?: "tile" | "avatar";
  className?: string;
  title?: string;
}) {
  const tile = variant === "tile";
  return (
    <img
      src={tile ? CLAUDIO_FACE : size > 96 ? CLAUDIO_AVATAR.md : CLAUDIO_AVATAR.sm}
      width={size}
      height={size}
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
      draggable={false}
      decoding="async"
      style={{ width: size, height: size }}
      className={cn(
        "shrink-0 select-none bg-[#4d86e8] object-cover ring-1 ring-white/10",
        tile ? "rounded-[3px]" : "rounded-full",
        className,
      )}
    />
  );
}

/** "CLAUDIO" in Cormorant Garamond caps with open tracking; `tagline` adds the line underneath. */
export function Wordmark({ className, tagline = false, size = 15 }: { className?: string; tagline?: boolean; size?: number }) {
  return (
    <span className={cn("inline-flex flex-col leading-none", className)}>
      <span className="font-display font-bold uppercase tracking-[0.14em] text-text" style={{ fontSize: size * 1.28, lineHeight: 0.9 }}>
        {BRAND.name}
      </span>
      {tagline && <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">{BRAND.tagline}</span>}
    </span>
  );
}

/** Retired accent (the copper "spark"). Kept as a no-op so older call sites compile; renders nothing. */
export function ClaudioSpark(_props: { className?: string }) {
  return null;
}
