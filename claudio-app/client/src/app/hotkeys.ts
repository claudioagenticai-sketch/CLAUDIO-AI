// Global keyboard shortcuts. Ignored while typing or while a modal is open (except ⌘K).
//  ⌘K / Ctrl+K  toggle palette      /  open palette
//  L            launch               1 / 2 / 3  execution preset
//  g h → Home (/home), g t → Trenches, g p → Portfolio, g a → Agents, g r → Tracker, g c → Creator, g f → Claim fees,
//  g w → Wallets, g s → Settings, g d → Docs, g l → Launch
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { haptic, useSettings, useUI, type ExecPreset } from "@/lib/store";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function modalOpen(): boolean {
  return document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') !== null;
}

const G_ROUTES: Record<string, string> = {
  h: "/home",
  t: "/trenches",
  p: "/portfolio",
  a: "/agents",
  f: "/claim",
  d: "/docs",
  w: "/wallets",
  s: "/settings",
  c: "/creator",
  r: "/tracker",
  l: "/launch",
};

export function useGlobalHotkeys(): void {
  const [, setLocation] = useLocation();
  const nav = useRef(setLocation);
  nav.current = setLocation;

  useEffect(() => {
    let gAt = 0;
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState();
      const key = e.key.toLowerCase();

      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && key === "k") {
        e.preventDefault();
        ui.setPalette(!ui.paletteOpen);
        return;
      }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTyping(e.target) || ui.paletteOpen || modalOpen()) return;

      if (gAt && Date.now() - gAt < 900) {
        gAt = 0;
        const to = G_ROUTES[key];
        if (to) {
          e.preventDefault();
          nav.current(to);
        }
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        ui.setPalette(true);
        return;
      }
      if (key === "g" && !e.shiftKey) {
        gAt = Date.now();
        return;
      }
      if (key === "l" && !e.shiftKey) {
        e.preventDefault();
        nav.current("/launch");
        return;
      }
      if (e.key === "1" || e.key === "2" || e.key === "3") {
        const p = `P${e.key}` as ExecPreset;
        if (useSettings.getState().activePreset !== p) {
          haptic();
          useSettings.getState().set({ activePreset: p });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
