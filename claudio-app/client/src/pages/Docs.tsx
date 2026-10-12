// Public docs: /docs (Overview) and /docs/:section. Left nav on desktop, swipeable chips on phones.
// Content lives in features/docs/sections.tsx; the same facts are in docs/*.md for the repo.
import { useEffect } from "react";
import { Link, useParams } from "wouter";
import { BRAND } from "@shared/brand";
import { ClaudioMark } from "@/components/kit";
import { cn } from "@/lib/utils";
import { DOC_SECTIONS } from "@/features/docs/sections";
import NotFound from "@/pages/NotFound";

const href = (id: string) => (id === "overview" ? "/docs" : `/docs/${id}`);

export default function Docs() {
  const params = useParams<{ section?: string }>();
  const id = params.section ?? "overview";
  const index = DOC_SECTIONS.findIndex((s) => s.id === id);
  const section = DOC_SECTIONS[index];

  useEffect(() => {
    if (section) document.title = `${section.id === "overview" ? "Docs" : section.label} · ${BRAND.full} docs`;
  }, [section]);

  // Each section opens at the top, and the active chip scrolls into view on phones.
  useEffect(() => {
    document.getElementById("main")?.scrollTo({ top: 0 });
    document.querySelector(`[data-doc-chip="${id}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [id]);

  if (!section) return <NotFound />;
  const prev = DOC_SECTIONS[index - 1];
  const next = DOC_SECTIONS[index + 1];
  const Body = section.Body;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-14 pt-4 md:px-8 md:pt-8">
      {/* Phones: sticky section chips */}
      <nav aria-label="Docs sections" className="no-scrollbar sticky top-0 z-10 -mx-4 mb-5 flex gap-1.5 overflow-x-auto border-b border-line bg-bg/95 px-4 py-2.5 backdrop-blur md:hidden">
        {DOC_SECTIONS.map((s) => (
          <Link
            key={s.id}
            href={href(s.id)}
            data-doc-chip={s.id}
            aria-current={s.id === id ? "page" : undefined}
            className={cn(
              "inline-flex h-10 shrink-0 items-center rounded-[3px] px-3 font-mono text-[11px] font-medium uppercase tracking-[0.1em] ring-1 ring-inset transition-colors",
              s.id === id ? "bg-text text-bg ring-text" : "text-text-3 ring-line-2 hover:text-text-2",
            )}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      <div className="grid gap-8 md:grid-cols-[210px_minmax(0,1fr)] lg:grid-cols-[236px_minmax(0,1fr)] lg:gap-12">
        <aside className="sticky top-8 hidden h-max md:block">
          <Link href="/docs" className="mb-4 flex items-center gap-2.5">
            <ClaudioMark size={28} />
            <span className="font-display text-[22px] font-bold uppercase leading-none tracking-[0.02em] text-text">Docs</span>
          </Link>
          <div className="mono-label mb-2 border-t border-line pt-3">On this site</div>
          <ul className="grid">
            {DOC_SECTIONS.map((s, i) => {
              const on = s.id === id;
              return (
                <li key={s.id}>
                  <Link
                    href={href(s.id)}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "relative flex h-9 items-center gap-3 rounded-[2px] pl-3 pr-2 font-mono text-[11.5px] uppercase tracking-[0.08em] transition-colors",
                      on ? "bg-panel text-text" : "text-text-3 hover:bg-panel hover:text-text",
                    )}
                  >
                    {on && <span className="absolute inset-y-1.5 left-0 w-[2px] bg-brand" />}
                    <span className={cn("num w-5 shrink-0 text-[10.5px]", on ? "text-brand" : "text-text-3")}>{String(i + 1).padStart(2, "0")}</span>
                    <span className="truncate">{s.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-6 flex items-center gap-3 border-t border-line pt-4">
            <img src="/claudio/avatar-96.webp" alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-full object-cover" />
            <p className="text-[12px] leading-snug text-text-3">
              Questions? Ask me in the thread — I read everything. <span className="text-text-2">— Claudio</span>
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.12em]">
            <a href={BRAND.github} target="_blank" rel="noreferrer" className="text-text-2 hover:text-brand">GitHub</a>
            <a href={BRAND.twitter} target="_blank" rel="noreferrer" className="text-text-2 hover:text-brand">X</a>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
            <Link href="/privacy" className="hover:text-text-2">Privacy</Link>
            <Link href="/terms" className="hover:text-text-2">Terms</Link>
          </div>
        </aside>

        <article className="min-w-0 max-w-3xl">
          <header className="border-b border-line pb-6">
            <div className="mono-label flex flex-wrap items-center gap-2">
              <span className="section-num">{String(index + 1).padStart(2, "0")}</span>
              <Link href="/docs" className="hover:text-text-2">
                Docs
              </Link>
              {section.id !== "overview" && (
                <>
                  <span aria-hidden>/</span>
                  <span className="text-text-2">{section.label}</span>
                </>
              )}
            </div>
            <h1 className="display-page mt-4 break-words text-text">{section.id === "overview" ? "How Claudio works" : section.label}</h1>
            <p className="lede mt-3">{section.blurb}</p>
          </header>

          <div key={section.id} className="enter pt-6">
            <Body />
          </div>

          <nav aria-label="More docs" className="mt-14 grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
            {prev ? (
              <Link href={href(prev.id)} className="group rounded-[3px] border border-line p-4 transition-colors hover:border-line-2 hover:bg-bg-elev">
                <span className="mono-label">← Previous</span>
                <span className="mt-2 block font-display text-[24px] font-bold uppercase leading-none text-text group-hover:text-brand">{prev.label}</span>
              </Link>
            ) : (
              <span className="hidden sm:block" />
            )}
            {next && (
              <Link href={href(next.id)} className="group rounded-[3px] border border-line p-4 text-right transition-colors hover:border-line-2 hover:bg-bg-elev">
                <span className="mono-label">Next →</span>
                <span className="mt-2 block font-display text-[24px] font-bold uppercase leading-none text-text group-hover:text-brand">{next.label}</span>
              </Link>
            )}
          </nav>
        </article>
      </div>
    </div>
  );
}
