// Shared layout for product areas that are announced but not open yet (Cloud, Generate).
// Plain on purpose: a title, one line of pitch, what's coming, and Claudio's socials for updates.
import type { ReactNode } from "react";
import { Link } from "wouter";
import { BRAND } from "@shared/brand";
import { ClaudioMark } from "@/components/kit/brand";
import { Page } from "@/features/wallet/ui";

export interface SoonItem {
  title: string;
  body: string;
}

export function ComingSoonPage({
  name,
  headline,
  pitch,
  items,
  footnote,
  children,
}: {
  name: string;
  headline: ReactNode;
  pitch: string;
  items: SoonItem[];
  footnote?: string;
  /** Extra sections shown between "what's coming" and the footnote (e.g. the Cloud's live agents). */
  children?: ReactNode;
}) {
  return (
    <Page>
      <section className="mx-auto max-w-4xl pt-4 md:pt-10">
        <div className="mono-label flex flex-wrap items-center gap-2">
          <span className="text-brand" aria-hidden>
            /
          </span>
          <span className="text-text-2">{name}</span>
          <span className="chip chip-brand ml-1">Coming soon</span>
        </div>
        <h1 className="display mt-5 max-w-3xl text-balance text-[48px] text-text md:text-[88px]">{headline}</h1>
        <p className="lede mt-5 max-w-2xl md:text-[19px]">{pitch}</p>

        <div className="mt-12 grid border-t border-line md:grid-cols-3">
          {items.map((it, i) => (
            <div key={it.title} className="border-b border-line py-5 md:border-b-0 md:py-6 md:pr-6 [&:not(:first-child)]:md:border-l [&:not(:first-child)]:md:pl-6">
              <span className="section-num">{String(i + 1).padStart(2, "0")}</span>
              <h2 className="display-section mt-2 text-text">{it.title}</h2>
              <p className="mt-2.5 text-[14px] leading-relaxed text-text-2">{it.body}</p>
            </div>
          ))}
        </div>

        {children}

        {/* Phones: face + text on one row, buttons on their own row below. Wider: everything in one row. */}
        <div className="mt-10 flex flex-col gap-4 border-y border-line py-5 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <ClaudioMark size={44} />
            <p className="min-w-0 flex-1 text-[14px] leading-relaxed text-text-2">
              {footnote ?? "I'm getting this ready. Follow along and you'll hear it from me first."}
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
            <a href={BRAND.twitter} target="_blank" rel="noopener noreferrer" className="btn btn-secondary px-3">
              Follow on X
            </a>
            <Link href="/home" className="btn btn-primary px-3">
              Back home
            </Link>
          </div>
        </div>
      </section>
    </Page>
  );
}
