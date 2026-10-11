// Editable inputs for the Settings page: numeric field, number-chip editor, string list editor, pill picker.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/store";

function parseNum(s: string): number | null {
  const n = Number(s.replace(",", ".").trim());
  return s.trim() !== "" && Number.isFinite(n) ? n : null;
}

function trimNum(n: number): string {
  return String(Number(n.toPrecision(8)));
}

/** Decimal input that keeps a local string while typing and commits valid values on blur/Enter. */
export function NumberField({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  suffix,
  label,
  hint,
  className,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: ReactNode;
  label?: ReactNode;
  hint?: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(trimNum(value));
  const [bad, setBad] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(trimNum(value));
  }, [value]);
  const commit = () => {
    const n = parseNum(text);
    if (n === null || n < min || n > max) {
      setBad(true);
      setText(trimNum(value));
      window.setTimeout(() => setBad(false), 900);
      return;
    }
    if (n !== value) onChange(n);
    setText(trimNum(n));
  };
  return (
    <label className={cn("block", className)}>
      {label && <span className="mb-1.5 block font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-text-2">{label}</span>}
      <span
        className={cn(
          "flex h-11 items-center rounded-[3px] border bg-bg px-3 transition-colors focus-within:border-brand focus-within:ring-1 focus-within:ring-brand md:h-10",
          bad ? "border-sell" : "border-line-2",
          disabled && "opacity-50",
        )}
      >
        <input
          value={text}
          disabled={disabled}
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            commit();
          }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="num h-full min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm"
        />
        {suffix && <span className="ml-2 shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-text-3">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-[11px] leading-relaxed text-text-3">{hint}</span>}
    </label>
  );
}

/** Editable list of numeric chips (quick-buy amounts, sell %). Tap a chip to edit, × to remove. */
export function ChipEditor({
  values,
  onChange,
  min,
  max,
  maxCount = 6,
  suffix = "",
  highlight,
  onPick,
}: {
  values: number[];
  onChange: (v: number[]) => void;
  min: number;
  max: number;
  maxCount?: number;
  suffix?: string;
  highlight?: number;
  onPick?: (v: number) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null); // index, or -1 for new
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing !== null) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    const n = parseNum(text);
    if (n !== null && n >= min && n <= max) {
      const next = [...values];
      if (editing === -1) next.push(n);
      else if (editing !== null) next[editing] = n;
      const uniq = Array.from(new Set(next)).sort((a, b) => a - b);
      onChange(uniq);
      haptic();
    }
    setEditing(null);
    setText("");
  };

  const editor = (
    <input
      ref={inputRef}
      value={text}
      inputMode="decimal"
      enterKeyHint="done"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setEditing(null);
          setText("");
        }
      }}
      className="num h-10 w-20 rounded-[3px] border border-brand bg-bg px-2 text-center text-base outline-none ring-1 ring-brand md:h-9 md:text-sm"
    />
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <AnimatePresence initial={false}>
        {values.map((v, i) =>
          editing === i ? (
            <span key={`edit-${i}`}>{editor}</span>
          ) : (
            <motion.span
              key={`${v}`}
              layout
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              className={cn(
                "group inline-flex h-10 items-center overflow-hidden rounded-[3px] ring-1 md:h-9",
                highlight === v ? "bg-brand-bg text-brand ring-brand/50" : "ring-line-2 hover:ring-text-3",
              )}
            >
              <button
                type="button"
                className="num h-full px-3 text-sm font-medium"
                onClick={() => {
                  if (onPick) onPick(v);
                  else {
                    setEditing(i);
                    setText(String(v));
                  }
                }}
                onDoubleClick={() => {
                  setEditing(i);
                  setText(String(v));
                }}
                title={onPick ? "Tap to set default · double-tap to edit" : "Tap to edit"}
              >
                {v}
                {suffix}
              </button>
              {values.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange(values.filter((_, j) => j !== i))}
                  className="flex h-full w-8 items-center justify-center border-l border-line text-text-3 hover:text-sell"
                  aria-label={`Remove ${v}${suffix}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </motion.span>
          ),
        )}
      </AnimatePresence>
      {editing === -1
        ? editor
        : values.length < maxCount && (
            <button
              type="button"
              onClick={() => {
                setEditing(-1);
                setText("");
              }}
              className="inline-flex h-10 items-center gap-1 rounded-[3px] border border-dashed border-line-2 px-3 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-text-3 transition-colors hover:border-text-3 hover:text-text md:h-9"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          )}
    </div>
  );
}

/** Add/remove list of strings with validation. */
export function ListEditor({
  items,
  onChange,
  placeholder,
  validate,
  normalize = (s) => s.trim(),
  render,
  emptyText,
}: {
  items: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  validate?: (s: string) => string | null;
  normalize?: (s: string) => string;
  render?: (s: string) => ReactNode;
  emptyText?: string;
}) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const add = () => {
    const v = normalize(text);
    if (!v) return;
    const e = validate?.(v) ?? null;
    if (e) {
      setErr(e);
      return;
    }
    if (items.includes(v)) {
      setErr("Already in the list");
      return;
    }
    onChange([v, ...items]);
    setText("");
    setErr(null);
    haptic();
  };
  return (
    <div>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder={placeholder}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          className={cn(
            "h-11 min-w-0 flex-1 rounded-[3px] border bg-bg px-3 text-base outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand md:h-10 md:text-sm",
            err ? "border-sell" : "border-line-2",
          )}
        />
        <button
          type="button"
          onClick={add}
          disabled={!text.trim()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[3px] border border-line-2 text-text transition-colors hover:border-text-3 hover:bg-panel disabled:opacity-40 md:h-10 md:w-10"
          aria-label="Add"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {err && <p className="mt-1 text-xs text-sell">{err}</p>}
      <ul className="mt-2 flex flex-wrap gap-1.5">
        <AnimatePresence initial={false}>
          {items.map((s) => (
            <motion.li
              key={s}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="inline-flex h-9 max-w-full items-center gap-1 rounded-[3px] pl-2.5 text-xs ring-1 ring-inset ring-line-2"
            >
              <span className="truncate">{render ? render(s) : s}</span>
              <button
                type="button"
                onClick={() => onChange(items.filter((x) => x !== s))}
                className="flex h-9 w-8 shrink-0 items-center justify-center text-text-3 hover:text-sell"
                aria-label={`Remove ${s}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
        {items.length === 0 && emptyText && <li className="w-full rounded-[3px] border border-dashed border-line px-3 py-2.5 text-xs leading-relaxed text-text-3">{emptyText}</li>}
      </ul>
    </div>
  );
}

/** Row of equal pills for picking one value (auto-lock time, slippage quick picks). */
export function PillChoice<T extends string | number>({
  value,
  options,
  onChange,
  format = (v) => String(v),
  className,
  ariaLabel,
}: {
  value: T | undefined;
  options: readonly T[];
  onChange: (v: T) => void;
  format?: (v: T) => ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("grid gap-1 rounded-[3px] p-[3px] ring-1 ring-inset ring-line-2", className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <button
            key={String(o)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => {
              haptic();
              onChange(o);
            }}
            className={cn(
              "num h-9 rounded-[2px] text-xs font-medium transition-colors md:h-8",
              on ? "bg-brand-bg text-brand ring-1 ring-inset ring-brand/50" : "text-text-3 hover:bg-panel-2 hover:text-text",
            )}
          >
            {format(o)}
          </button>
        );
      })}
    </div>
  );
}
