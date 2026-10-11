// Building blocks of the public pages: split-flap wordmark, numbered sections, spec rows, machine-vision box,
// corner brackets, copy buttons, scroll-in reveal and link buttons. Styles: ./landing.css (lp-*).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "wouter";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

/** CLAUDIO in split-flap tiles that flip in one by one on load (CSS only; static with reduced motion). */
export function SplitFlap({ text = "CLAUDIO", size = "hero", className, as = "span" }: { text?: string; size?: "hero" | "page" | "compact"; className?: string; as?: "span" | "h1" }) {
  const Tag = as;
  return (
    <Tag className={cx("lp-flap", `lp-flap--${size}`, className)}>
      <span className="lp-sr">{text.charAt(0) + text.slice(1).toLowerCase()}</span>
      {text.split("").map((ch, i) => (
        <span key={i} className="lp-flap__tile" aria-hidden="true" style={{ "--i": i } as CSSProperties}>
          <span className="lp-flap__ch">{ch}</span>
        </span>
      ))}
    </Tag>
  );
}

/** Numbered editorial section: top hairline, mono number in accent, condensed title, optional right-aligned meta. */
export function Section({
  id,
  num,
  title,
  meta,
  children,
  className,
  wide,
}: {
  id?: string;
  num: string;
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Let children run to the page edges (media walls). */
  wide?: boolean;
}) {
  const titleId = id ? `${id}-title` : undefined;
  return (
    <section id={id} className={cx("lp-sec", className)} aria-labelledby={titleId}>
      <div className="lp-wrap">
        <Reveal className="lp-sec__head">
          <span className="lp-num">{num}</span>
          <h2 id={titleId} className="lp-h2">
            {title}
          </h2>
          {meta && <p className="lp-sec__meta">{meta}</p>}
        </Reveal>
      </div>
      {wide ? children : <div className="lp-wrap">{children}</div>}
    </section>
  );
}

export function Mono({ children, className, accent }: { children: ReactNode; className?: string; accent?: boolean }) {
  return <span className={cx("lp-mono", accent && "lp-mono--accent", className)}>{children}</span>;
}

/** Label column (mono, ink-3) + value column, hairline separators. */
export function SpecRows({ rows, numbered, className }: { rows: { label: string; value: ReactNode }[]; numbered?: boolean; className?: string }) {
  return (
    <dl className={cx("lp-spec", className)}>
      {rows.map((r, i) => (
        <div key={r.label} className="lp-spec__row">
          <dt className="lp-spec__label">
            {numbered && <span className="lp-mono--accent">{String(i + 1).padStart(2, "0")} </span>}
            {r.label}
          </dt>
          <dd className="lp-spec__value">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 8 px L-shaped corner brackets around featured media (the parent must be position: relative). */
export function Brackets({ inset = -7 }: { inset?: number }) {
  return (
    <span aria-hidden="true" className="lp-brackets" style={{ inset }}>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export interface FaceBox {
  l: number;
  t: number;
  w: number;
  h: number;
}

/** Thin hairline bounding box with mono tags, positioned in % of its (relative) parent. */
export function VisionBox({ box, top, bottom, drift, className }: { box: FaceBox; top: ReactNode; bottom?: ReactNode; drift?: boolean; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx("lp-vbox", drift && "lp-vbox--drift", className)}
      style={{ left: `${box.l}%`, top: `${box.t}%`, width: `${box.w}%`, height: `${box.h}%` }}
    >
      <span className="lp-vbox__tag lp-vbox__tag--top">{top}</span>
      {bottom && <span className="lp-vbox__tag lp-vbox__tag--bottom">{bottom}</span>}
      <i className="lp-vbox__c lp-vbox__c--tl" />
      <i className="lp-vbox__c lp-vbox__c--br" />
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const f = document.createElement("textarea");
    f.value = text;
    f.setAttribute("readonly", "");
    f.style.position = "fixed";
    f.style.opacity = "0";
    document.body.appendChild(f);
    f.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(f);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={cx("lp-copy", className)}
      data-state={state}
      onClick={async () => {
        setState((await copyText(text)) ? "ok" : "err");
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setState("idle"), 1800);
      }}
      aria-label={`${label}: ${text}`}
    >
      <span aria-live="polite">{state === "ok" ? "Copied" : state === "err" ? "Select it" : label}</span>
    </button>
  );
}

/** A terminal-style block with a title bar and one copy button per command line. */
export function CodeBlock({ title, lines }: { title: string; lines: { comment?: string; cmd?: string }[] }) {
  const all = lines.filter((l) => l.cmd).map((l) => l.cmd).join("\n");
  return (
    <div className="lp-code">
      <div className="lp-code__bar">
        <span className="lp-code__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="lp-mono">{title}</span>
        <CopyButton text={all} label="Copy all" className="lp-code__copyall" />
      </div>
      <div className="lp-code__body">
        {lines.map((l, i) =>
          l.comment ? (
            <p key={i} className="lp-code__comment">
              # {l.comment}
            </p>
          ) : (
            <div key={i} className="lp-code__line">
              <code>{l.cmd}</code>
              <CopyButton text={l.cmd ?? ""} className="lp-code__copy" />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/** Fade + 8 px rise the first time it scrolls into view. Visible immediately without IntersectionObserver. */
export function Reveal({ children, className, as = "div", delay = 0 }: { children: ReactNode; className?: string; as?: "div" | "li" | "article"; delay?: number }) {
  const ref = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const Tag = as;
  return (
    <Tag
      ref={ref as never}
      className={cx("lp-reveal", inView && "is-in", className)}
      style={delay ? ({ transitionDelay: `${delay}ms` } as CSSProperties) : undefined}
    >
      {children}
    </Tag>
  );
}

/** Square-ish button link. Internal paths use client-side navigation; hashes and external URLs are plain anchors. */
export function ButtonLink({
  href,
  children,
  variant = "secondary",
  className,
  external,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  external?: boolean;
}) {
  const cls = cx("lp-btn", `lp-btn--${variant}`, className);
  if (external || /^https?:/.test(href)) {
    return (
      <a href={href} className={cls} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  if (href.startsWith("#")) {
    return (
      <a href={href} className={cls} onClick={(e) => jumpTo(e, href.slice(1))}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/** Smooth in-page jump that respects reduced motion and keeps the hash in the URL. */
export function jumpTo(e: { preventDefault(): void } | null, id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  e?.preventDefault();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  history.replaceState(history.state, "", `#${id}`);
}

/** Inline arrow link in mono caps with an accent underline. */
/** An X handle as a link: "@name" → x.com/name. */
export function XHandle({ handle }: { handle: string }) {
  return (
    <a href={`https://x.com/${handle}`} className="lp-handle" target="_blank" rel="noopener noreferrer">
      @{handle}
    </a>
  );
}

/** Text with every "@handle" turned into an X link. */
export function WithHandles({ text }: { text: string }) {
  return (
    <>
      {text.split(/(@[A-Za-z0-9_]+)/).map((part, i) => (part.startsWith("@") ? <XHandle key={i} handle={part.slice(1)} /> : part))}
    </>
  );
}

export function ArrowLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const cls = cx("lp-arrow", className);
  const inner = (
    <>
      {children} <span aria-hidden="true">→</span>
    </>
  );
  if (/^https?:/.test(href)) {
    return (
      <a href={href} className={cls} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    );
  }
  if (href.startsWith("#")) {
    return (
      <a href={href} className={cls} onClick={(e) => jumpTo(e, href.slice(1))}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}

/** Still image in a fixed-aspect box (no layout shift), optional brackets and caption. */
export function Still({
  src,
  srcSet,
  sizes,
  alt,
  ratio,
  position,
  brackets,
  caption,
  className,
  eager,
}: {
  src: string;
  srcSet?: string;
  sizes?: string;
  alt: string;
  ratio: string;
  position?: string;
  brackets?: boolean;
  caption?: ReactNode;
  className?: string;
  eager?: boolean;
}) {
  return (
    <figure className={cx("lp-still", className)}>
      <div className="lp-still__frame" style={{ aspectRatio: ratio }}>
        <img
          src={src}
          srcSet={srcSet}
          sizes={sizes}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          style={position ? { objectPosition: position } : undefined}
        />
        {brackets && <Brackets />}
      </div>
      {caption && <figcaption className="lp-still__cap">{caption}</figcaption>}
    </figure>
  );
}
