// Small building blocks for the public docs page (pages/Docs.tsx). Plain, readable, phone-first.
import { useState, type ReactNode } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="display-section mt-10 scroll-mt-24 border-t border-line pt-5 text-text first:mt-0 first:border-t-0 first:pt-0">
      {children}
    </h2>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-7 font-mono text-[12px] font-medium uppercase tracking-[0.12em] text-text">{children}</h3>;
}

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mt-3 text-[14.5px] leading-[1.7] text-text-2", className)}>{children}</p>;
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-3 max-w-2xl text-[17px] leading-[1.6] text-text-2 md:text-[19px]">{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="mt-3 grid gap-2 text-[14.5px] leading-[1.6] text-text-2 [&>li]:relative [&>li]:pl-5">{children}</ul>;
}

/** List item with a short rose dash. */
export function LI({ children }: { children: ReactNode }) {
  return (
    <li>
      <span aria-hidden className="absolute left-0 top-[0.7em] h-[2px] w-2.5 bg-brand" />
      {children}
    </li>
  );
}

export function B({ children }: { children: ReactNode }) {
  return <b className="font-semibold text-text">{children}</b>;
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="num rounded-[2px] bg-panel-2 px-1.5 py-0.5 text-[0.86em] text-text">{children}</code>;
}

export function Pre({ children }: { children: string }) {
  return (
    <pre className="num mt-4 overflow-x-auto rounded-[3px] border border-line bg-bg-elev p-4 text-[12.5px] leading-[1.65] text-text-2">
      <code>{children}</code>
    </pre>
  );
}

const CALLOUT = {
  info: "border-l-info",
  warn: "border-l-warn",
  brand: "border-l-brand",
  danger: "border-l-sell",
} as const;

export function Callout({ tone = "info", title, children }: { tone?: keyof typeof CALLOUT; title?: ReactNode; children: ReactNode }) {
  return (
    <div className={cn("mt-5 rounded-[3px] border border-l-2 border-line bg-bg-elev px-4 py-3.5", CALLOUT[tone])}>
      <div className="min-w-0 text-[14px] leading-[1.6] text-text-2">
        {title && <div className="mb-1.5 font-mono text-[11.5px] font-medium uppercase tracking-[0.12em] text-text">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1400);
          },
          () => undefined,
        );
      }}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[3px] border border-line-2 px-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-text-2 transition-colors hover:border-text-3 hover:text-text",
        done && "border-buy/40 text-buy hover:text-buy",
        className,
      )}
      aria-label={`${label} ${value}`}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copied" : label}
    </button>
  );
}

/** A labelled on-chain address: full value (wraps cleanly), copy, and an explorer link. */
export function AddressCard({ label, address, href, hint, accent }: { label: ReactNode; address: string; href?: string; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className={cn("mt-4 rounded-[3px] border bg-bg-elev p-4", accent ? "border-line-2 border-l-2 border-l-brand" : "border-line")}>
      <div className="eyebrow">{label}</div>
      {/* Phones: two even halves instead of one stray chunk on the second line. */}
      <div className="num mt-2 break-all text-[14px] leading-[1.55] text-text md:text-[15px]" translate="no">
        <span className="block sm:inline">{address.slice(0, Math.ceil(address.length / 2))}</span>
        <span className="block sm:inline">{address.slice(Math.ceil(address.length / 2))}</span>
      </div>
      {hint && <div className="mt-1.5 text-[12.5px] text-text-3">{hint}</div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <CopyButton value={address} label="Copy address" />
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-[3px] border border-line-2 px-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-text-2 transition-colors hover:border-text-3 hover:text-text"
          >
            <ExternalLink className="h-3.5 w-3.5" /> View on Solscan
          </a>
        )}
      </div>
    </div>
  );
}

/** Responsive two-column table: stacks into cards on phones. */
export function Table({ head, rows, mono = [] }: { head: string[]; rows: ReactNode[][]; mono?: number[] }) {
  return (
    <div className="mt-4 overflow-hidden border-y border-line">
      <table className="hidden w-full text-left text-[13px] md:table">
        <thead className="text-text-3">
          <tr className="border-b border-line">
            {head.map((h) => (
              <th key={h} className="px-3 py-2.5 font-mono text-[10.5px] font-normal uppercase tracking-[0.14em] first:pl-0">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((c, j) => (
                <td key={j} className={cn("px-3 py-2.5 text-text-2 first:pl-0", j === 0 && "text-text", mono.includes(j) && "num whitespace-nowrap text-[12.5px] text-text")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-line md:hidden">
        {rows.map((r, i) => (
          <li key={i} className="grid gap-1 py-3 text-[13px]">
            {r.map((c, j) => (
              <div key={j} className={cn(j === 0 ? "font-semibold text-text" : "text-text-2", mono.includes(j) && "num break-all text-[12.5px]")}>
                {j > 0 && <span className="mr-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-3">{head[j]}</span>}
                {c}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Numbered steps. */
export function Steps({ items }: { items: { title: ReactNode; body?: ReactNode }[] }) {
  return (
    <ol className="mt-4 grid border-t border-line">
      {items.map((s, i) => (
        <li key={i} className="flex gap-4 border-b border-line py-4">
          <span className="section-num w-6 shrink-0 pt-[3px]">
            {String(i + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0">
            <div className="text-[14.5px] font-semibold text-text">{s.title}</div>
            {s.body && <div className="mt-1 text-[13.5px] leading-[1.6] text-text-2">{s.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Small grid of labelled cards (e.g. agent tiers). */
export function Grid({ items, cols = 3 }: { items: { title: ReactNode; body: ReactNode; tag?: ReactNode }[]; cols?: 2 | 3 }) {
  return (
    <div className={cn("mt-4 grid gap-3", cols === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2")}>
      {items.map((it, i) => (
        <div key={i} className="rounded-[3px] border border-line bg-bg-elev p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[14.5px] font-semibold text-text">{it.title}</div>
            {it.tag}
          </div>
          <div className="mt-1.5 text-[13.5px] leading-[1.6] text-text-2">{it.body}</div>
        </div>
      ))}
    </div>
  );
}
