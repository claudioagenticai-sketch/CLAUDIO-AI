// Small building blocks for the admin dashboard (theme tokens only — the brand workstream re-themes via CSS variables).
import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminApiError } from "./api";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full min-w-0 rounded-[3px] border bg-bg px-3 text-[13px] text-text outline-none transition-colors placeholder:text-text-3 focus:border-brand",
        invalid ? "border-sell/60" : "border-line-2",
        className,
      )}
      {...props}
    />
  );
});

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-[12.5px] text-text-3">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (error instanceof AdminApiError && error.unavailable) return <NotAvailable />;
  return (
    <div className="flex items-start gap-2 rounded-[3px] border border-line border-l-2 border-l-sell bg-bg-elev px-3 py-2.5 text-[12.5px] text-sell">
      <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
      <span className="break-words">{error instanceof Error ? error.message : String(error)}</span>
    </div>
  );
}

export function NotAvailable({ what = "This section" }: { what?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[4px] border border-dashed border-line-2 px-4 py-10 text-center">
      <div className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-text-2">Not available yet</div>
      <div className="max-w-sm text-[12px] leading-snug text-text-3">{what} isn't served by this build yet. It appears here automatically once its module ships.</div>
    </div>
  );
}

export function Warn({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-[3px] border border-line border-l-2 border-l-warn bg-bg-elev px-3 py-2.5 text-[12.5px] leading-snug text-text-2">
      <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-warn" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

export function KV({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 text-[12.5px] last:border-b-0">
      <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-3">{label}</span>
      <span className="min-w-0 truncate text-right text-text">{children}</span>
    </div>
  );
}

export function Metric({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "buy" | "sell" | "warn" }) {
  return (
    <div className="min-w-0 rounded-[3px] border border-line bg-bg-elev px-3 py-2.5">
      <div className="mono-label !text-[10px]">{label}</div>
      <div className={cn("num mt-1.5 truncate text-[18px] font-medium", tone === "buy" ? "text-buy" : tone === "sell" ? "text-sell" : tone === "warn" ? "text-warn" : "text-text")}>
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-text-3">{sub}</div>}
    </div>
  );
}

const STATE_TONE: Record<string, string> = {
  open: "chip-buy",
  view_only: "chip-info",
  coming_soon: "chip-warn",
  hidden: "",
};

export function StateChip({ state, className }: { state: string; className?: string }) {
  return <span className={cn("chip whitespace-nowrap", STATE_TONE[state] ?? "", className)}>{state.replace("_", " ")}</span>;
}

export function SeverityChip({ severity }: { severity: string }) {
  const cls = severity === "critical" || severity === "high" ? "chip-sell" : severity === "warn" ? "chip-warn" : "";
  return <span className={cn("chip", cls)}>{severity}</span>;
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtSol(lamportsOrSol: number, isLamports = false): string {
  const v = isLamports ? lamportsOrSol / 1e9 : lamportsOrSol;
  return `${v.toLocaleString(undefined, { maximumFractionDigits: v < 1 ? 6 : 3 })} SOL`;
}

export function short(a?: string | null, head = 4, tail = 4): string {
  if (!a) return "—";
  return a.length > head + tail + 1 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a;
}

/** Horizontally scrollable table wrapper (tables stay readable at 375px). */
export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[560px] border-collapse text-left text-[12px]">
        <thead>
          <tr className="border-b border-line font-mono text-[10px] uppercase tracking-[0.14em] text-text-3">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-2 py-2 font-normal first:pl-0 last:pr-0">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty && <div className="py-6 text-center text-[12px] text-text-3">Nothing yet.</div>}
    </div>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("px-2 py-2 align-top text-text-2 first:pl-0 last:pr-0", className)}>{children}</td>;
}
