// One delegated tooltip for the whole app (desktop). Cards mark elements with `data-tip="…"`; this
// renders a single fixed-position bubble, so hundreds of stat chips cost zero extra React roots
// and tooltips never get clipped by scrolling columns.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface Tip {
  text: string;
  x: number;
  y: number;
  below: boolean;
}

export function TipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let current: Element | null = null;
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const target = e.target instanceof Element ? e.target.closest("[data-tip]") : null;
      if (target === current) return;
      current = target;
      if (!target) {
        setTip(null);
        return;
      }
      const text = target.getAttribute("data-tip");
      if (!text) {
        setTip(null);
        return;
      }
      const r = target.getBoundingClientRect();
      const below = r.top < 64;
      setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below });
    };
    const hide = () => {
      current = null;
      setTip(null);
    };
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("scroll", hide, { passive: true, capture: true });
    window.addEventListener("blur", hide);
    document.addEventListener("pointerdown", hide, { passive: true });
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("blur", hide);
      document.removeEventListener("pointerdown", hide);
    };
  }, []);

  if (!tip || typeof document === "undefined") return null;
  const left = Math.max(8, Math.min(window.innerWidth - 8, tip.x));
  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[90] max-w-[240px] whitespace-pre-line rounded-[3px] border border-line-2 bg-panel-2 px-2.5 py-1.5 text-[11px] font-medium leading-snug text-text shadow-[0_12px_32px_-12px_rgba(0,0,0,0.9)]"
      style={{
        left,
        top: tip.y,
        transform: `translate(-50%, ${tip.below ? "0" : "-100%"})`,
      }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
