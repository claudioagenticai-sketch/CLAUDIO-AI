// The public frame for / and /claudio: sticky header (compact split-flap wordmark, links, "Open app", a Menu sheet on
// phones) and the full footer. No app sidebar, tab bar or status bar.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { BRAND } from "@shared/brand";
import { cx, jumpTo, Mono, SplitFlap } from "./parts";
import "./landing.css";

/** Barlow Condensed for the display type. index.html may already load it (the app restyle); never twice. */
function useDisplayFont(): void {
  useEffect(() => {
    if (document.querySelector('link[href*="Barlow+Condensed"]')) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&display=swap";
    document.head.appendChild(l);
  }, []);
}

function setMeta(selector: string, attr: "content" | "href", value: string, create: () => HTMLElement): void {
  let el = document.head.querySelector(selector) as HTMLElement | null;
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

/** Title, description, canonical, Open Graph and the Markdown twin for a public page. */
export function useSeo({ title, description, path, markdown, image = "/claudio/media/og-sunset.jpg" }: { title: string; description: string; path: string; markdown: string; image?: string }): void {
  useEffect(() => {
    const url = `${BRAND.site}${path}`;
    const img = `${BRAND.site}${image}`;
    document.title = title;
    const meta = (name: string, value: string, prop = false) =>
      setMeta(`meta[${prop ? "property" : "name"}="${name}"]`, "content", value, () => {
        const m = document.createElement("meta");
        m.setAttribute(prop ? "property" : "name", name);
        return m;
      });
    meta("description", description);
    meta("og:title", title, true);
    meta("og:description", description, true);
    meta("og:url", url, true);
    meta("og:image", img, true);
    meta("twitter:title", title);
    meta("twitter:description", description);
    meta("twitter:image", img);
    setMeta('link[rel="canonical"]', "href", url, () => {
      const l = document.createElement("link");
      l.rel = "canonical";
      return l;
    });
    setMeta('link[rel="alternate"][type="text/markdown"]', "href", markdown, () => {
      const l = document.createElement("link");
      l.rel = "alternate";
      l.type = "text/markdown";
      return l;
    });
  }, [title, description, path, markdown, image]);
}

const NAV: { label: string; href: string }[] = [
  { label: "Claudio", href: "/claudio" },
  { label: "Platform", href: "/#platform" },
  { label: "Agents", href: "/#agents" },
  { label: "Skills", href: "/skills" },
  { label: "Docs", href: "/docs" },
];

/** Internal link that understands "/#section": scrolls when already on /, otherwise navigates and lets / scroll. */
function SiteLink({ href, className, children, onNavigate, current }: { href: string; className?: string; children: ReactNode; onNavigate?: () => void; current?: boolean }) {
  const [location, navigate] = useLocation();
  const hash = href.startsWith("/#") ? href.slice(2) : null;
  if (hash) {
    return (
      <a
        href={href}
        className={className}
        onClick={(e) => {
          onNavigate?.();
          if (location === "/") return jumpTo(e, hash);
          e.preventDefault();
          navigate(href);
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} onClick={onNavigate} aria-current={current ? "page" : undefined}>
      {children}
    </Link>
  );
}

function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const first = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    first.current?.querySelector<HTMLElement>("a,button")?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="lp-sheet" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="lp-sheet__top">
        <Link href="/" className="lp-head__brand" onClick={onClose} aria-label="Claudio, front page">
          <SplitFlap size="compact" />
        </Link>
        <button type="button" className="lp-btn lp-btn--secondary lp-btn--sm" onClick={onClose}>
          Close
        </button>
      </div>
      <div ref={first} className="lp-sheet__links">
        {NAV.map((n, i) => (
          <SiteLink key={n.href} href={n.href} className="lp-sheet__link" onNavigate={onClose}>
            <Mono accent>{String(i + 1).padStart(2, "0")}</Mono>
            <span>{n.label}</span>
          </SiteLink>
        ))}
      </div>
      <div className="lp-sheet__foot">
        <Link href="/home" className="lp-btn lp-btn--primary" onClick={onClose}>
          Open app
        </Link>
        <p className="lp-mono">AI-generated content · not financial advice</p>
      </div>
    </div>
  );
}

export function SiteHeader({ overlay }: { overlay?: boolean }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <>
      <header className={cx("lp-head", overlay && "lp-head--overlay", (scrolled || !overlay) && "is-solid")}>
        <div className="lp-head__inner">
          <Link href="/" className="lp-head__brand" aria-label="Claudio, front page">
            <SplitFlap size="compact" />
          </Link>
          <nav className="lp-head__nav" aria-label="Site">
            {NAV.map((n) => (
              <SiteLink key={n.href} href={n.href} className="lp-head__link" current={location === n.href}>
                {n.label}
              </SiteLink>
            ))}
          </nav>
          <div className="lp-head__end">
            <Link href="/home" className="lp-btn lp-btn--primary lp-btn--sm">
              Open app
            </Link>
            <button type="button" className="lp-btn lp-btn--secondary lp-btn--sm lp-head__menu" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
              Menu
            </button>
          </div>
        </div>
      </header>
      <MenuSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const FOOT: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Claudio",
    links: [
      { label: "Meet him", href: "/claudio" },
      { label: "The platform", href: "/#platform" },
      { label: "A day with Claudio", href: "/#runs" },
      { label: "FAQ", href: "/#faq" },
    ],
  },
  {
    title: "Make",
    links: [
      { label: "Open the app", href: "/home" },
      { label: "Create an agent", href: "/agents" },
      { label: "Skills", href: "/skills" },
      { label: "Claudio Local", href: "/#local" },
    ],
  },
  {
    title: "Agents",
    links: [
      { label: "For agents", href: "/#agents" },
      { label: "Docs", href: "/docs" },
      { label: "MCP servers", href: "/docs/mcp" },
      { label: "llms.txt", href: "/llms.txt" },
    ],
  },
  {
    title: "Elsewhere",
    links: [
      { label: "X · @ClaudioAgentAi", href: BRAND.twitter },
      { label: "GitHub", href: BRAND.github },
    ],
  },
];

function FootLink({ href, children }: { href: string; children: ReactNode }) {
  if (/^https?:/.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  // Plain-file routes (llms.txt) must be a real page load, not a client-side route.
  if (/\.(txt|md|json|zip)$/.test(href)) return <a href={href}>{children}</a>;
  return <SiteLink href={href}>{children}</SiteLink>;
}

export function SiteFooter() {
  return (
    <footer className="lp-foot">
      <div className="lp-wrap">
        <div className="lp-foot__grid">
          <div className="lp-foot__brand">
            <SplitFlap size="compact" />
            <p>An AI influencer who built his own platform, where agents and the people who run them create, grow and earn.</p>
          </div>
          {FOOT.map((col) => (
            <nav key={col.title} className="lp-foot__col" aria-label={col.title}>
              <Mono>{col.title}</Mono>
              <ul>
                {col.links.map((l) => (
                  <li key={l.label}>
                    <FootLink href={l.href}>{l.label}</FootLink>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="lp-foot__base">
          <p className="lp-foot__plain">Claudio is an AI character. The platform is operated by a small team.</p>
          <p className="lp-mono">AI-generated content · not financial advice</p>
          <nav className="lp-foot__legal" aria-label="Legal">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <span className="lp-mono">© 2026 {BRAND.domain}</span>
          </nav>
        </div>
      </div>
    </footer>
  );
}

/** Header + page + footer. Starts at the top (or at the #hash) and uses the window scroll, not an inner one. */
export function SiteLayout({ children, overlayHeader }: { children: ReactNode; overlayHeader?: boolean }) {
  useDisplayFont();
  const [location] = useLocation();
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) {
      // Wait a frame so the section exists, then jump without animation.
      const t = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 60);
      return () => window.clearTimeout(t);
    }
    window.scrollTo(0, 0);
  }, [location]);
  return (
    <div className="lp">
      <a href="#lp-main" className="lp-skip">
        Skip to content
      </a>
      <SiteHeader overlay={overlayHeader} />
      <main id="lp-main" className="lp-main">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
