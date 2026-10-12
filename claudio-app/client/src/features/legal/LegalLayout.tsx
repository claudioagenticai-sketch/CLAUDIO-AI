// Shared frame for /privacy and /terms: same look as the docs (left column on desktop, one column on phones).
import { useEffect, type ReactNode } from "react";
import { Link } from "wouter";
import { BRAND } from "@shared/brand";
import { ClaudioMark } from "@/components/kit";
import { cn } from "@/lib/utils";

export const LEGAL_UPDATED = "8 October 2026";

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

const PAGES = [
  { href: "/privacy", label: "Privacy policy" },
  { href: "/terms", label: "Terms of use" },
] as const;

export function LegalLayout({ path, title, intro, sections }: { path: "/privacy" | "/terms"; title: string; intro: ReactNode; sections: LegalSection[] }) {
  useEffect(() => {
    document.title = `${title} · ${BRAND.full}`;
    document.getElementById("main")?.scrollTo({ top: 0 });
  }, [title]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-14 pt-4 md:px-8 md:pt-8">
      <div className="grid gap-8 md:grid-cols-[210px_minmax(0,1fr)] lg:grid-cols-[236px_minmax(0,1fr)] lg:gap-12">
        <aside className="doc-side sticky top-8 hidden h-max md:block">
          <Link href="/docs" className="mb-4 flex items-center gap-2.5">
            <ClaudioMark size={28} />
            <span className="font-display text-[26px] italic leading-none text-text">Legal</span>
          </Link>
          <ul className="grid border-t border-line pt-3">
            {PAGES.map((p) => {
              const on = p.href === path;
              return (
                <li key={p.href}>
                  <Link
                    href={p.href}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "doc-pill relative flex h-9 items-center px-3.5 font-mono text-[11.5px] uppercase tracking-[0.08em] transition-colors",
                      on ? "" : "text-text-3 hover:bg-panel-2 hover:text-text",
                    )}
                  >
                    {p.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-5 border-t border-line pt-4">
            <div className="eyebrow">On this page</div>
            <ul className="mt-2 grid gap-0.5">
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="block rounded-full px-3 py-1 text-[12.5px] leading-snug text-text-3 hover:bg-panel-2 hover:text-text">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <article className="min-w-0 max-w-3xl">
          {/* Phones: switch between the two pages */}
          <nav aria-label="Legal pages" className="mb-5 flex gap-1.5 md:hidden">
            {PAGES.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                aria-current={p.href === path ? "page" : undefined}
                className={cn(
                  "doc-pill inline-flex h-10 items-center px-4 font-mono text-[11px] font-medium uppercase tracking-[0.1em] ring-1 ring-inset transition-colors",
                  p.href === path ? "ring-brand" : "text-text-3 ring-line-2 hover:text-text-2",
                )}
              >
                {p.label}
              </Link>
            ))}
          </nav>

          <header className="doc-head">
            <div className="mono-label flex items-center gap-2">
              <span className="text-brand" aria-hidden>
                ✦
              </span>
              Legal
            </div>
            <h1 className="display-page mt-4 break-words text-text">{title}</h1>
            <p className="mono-label mt-3">Last updated {LEGAL_UPDATED}</p>
            <div className="lede mt-4 max-w-2xl">{intro}</div>
          </header>

          <div className="pt-2">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} className="mt-10 scroll-mt-6 border-t border-line pt-5 first:mt-4 first:border-t-0 first:pt-2">
                <h2 className="flex items-baseline gap-3">
                  <span className="section-num shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <span className="display-section text-text">{s.title}</span>
                </h2>
                <div className="text-[14.5px] leading-[1.7] text-text-2">{s.body}</div>
              </section>
            ))}
          </div>

          <footer className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-6 font-mono text-[11px] uppercase tracking-[0.1em] text-text-3">
            <span>Questions about this page?</span>
            <a href={BRAND.twitter} target="_blank" rel="noreferrer" className="text-text-2 hover:text-brand">
              X @ClaudioAgentAi
            </a>
            <a href={BRAND.github} target="_blank" rel="noreferrer" className="text-text-2 hover:text-brand">
              GitHub
            </a>
            <Link href={path === "/privacy" ? "/terms" : "/privacy"} className="text-text-2 hover:text-brand">
              {path === "/privacy" ? "Terms of use" : "Privacy policy"}
            </Link>
          </footer>
        </article>
      </div>
    </div>
  );
}
