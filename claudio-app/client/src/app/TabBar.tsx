// Mobile floating dock with a raised Launch button and a "More" sheet.
import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Bell, ChevronRight, Hand, MoreHorizontal, Plus, Smartphone } from "lucide-react";
import { BRAND } from "@shared/brand";
import { CHAINS, ENABLED_CHAINS, type ChainId } from "@shared/chains";
import { ClaudioMark, LiveDot, ResponsiveSheet } from "@/components/kit";
import { Switch } from "@/components/ui/switch";
import { haptic, useBoard, useSettings } from "@/lib/store";
import { useChainState } from "@/lib/platform";
import { useIsAdminWallet } from "@/lib/session";
import { cn } from "@/lib/utils";
import { ADMIN, DOCK, MORE, isActive, type NavItem } from "./nav";

const TABS: NavItem[] = DOCK;

function Tab({ item, active, onClick }: { item: NavItem; active: boolean; onClick?: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={() => {
        haptic();
        onClick?.();
      }}
      className={cn(
        "relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] transition-colors",
        active ? "text-text" : "text-text-3 active:text-text-2",
      )}
      aria-current={active ? "page" : undefined}
    >
      {active && <TabIndicator />}
      <span className={cn("relative z-10 [&>svg]:h-5 [&>svg]:w-5 [&>svg]:stroke-[1.6]", active && "text-brand")}>{item.icon}</span>
      <span className="relative z-10">{item.label}</span>
    </Link>
  );
}

function TabIndicator() {
  return (
    <motion.span
      layoutId="tab-indicator"
      className="absolute inset-x-3 top-0 h-[2px] bg-brand"
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
    />
  );
}

function SheetRow({
  icon,
  label,
  hint,
  onClick,
  href,
  toggle,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick?: () => void;
  href?: string;
  toggle?: { checked: boolean; onChange: (v: boolean) => void };
}) {
  const body = (
    <>
      <span className="flex h-9 w-6 shrink-0 items-center justify-center text-text-3 [&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg]:stroke-[1.6]">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="text-[15px] font-medium text-text">{label}</span>
        {hint && <span className="text-[12px] text-text-3">{hint}</span>}
      </span>
      {toggle ? (
        <Switch
          checked={toggle.checked}
          onCheckedChange={(v) => {
            haptic();
            toggle.onChange(v === true);
          }}
        />
      ) : (
        <ChevronRight className="h-4 w-4 text-text-3" />
      )}
    </>
  );
  const cls = "flex min-h-[52px] w-full items-center gap-3 border-b border-line px-1 last:border-b-0 active:bg-panel-2";
  if (toggle) {
    // A <label> forwards taps on the whole row to the switch without nesting buttons.
    return <label className={cn(cls, "cursor-pointer")}>{body}</label>;
  }
  if (href) {
    return (
      <Link href={href} onClick={onClick} className={cls}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

function FeedCell({ chain }: { chain: ChainId }) {
  const st = useBoard((s) => s.status[chain]);
  const state = useChainState(chain);
  const src = st?.source;
  if (state === "coming_soon") {
    return (
      <div className="num flex flex-col gap-0.5 rounded-[3px] border border-line px-2 py-1.5 text-[11px] opacity-70">
        <span className="flex items-center gap-1.5 font-semibold text-text-2">
          <span className="h-1.5 w-1.5 rounded-full bg-line-2" />
          {CHAINS[chain].short}
        </span>
        <span className="text-text-3">Soon</span>
      </div>
    );
  }
  return (
    <div className="num flex flex-col gap-0.5 rounded-[3px] border border-line px-2 py-1.5 text-[11px]">
      <span className="flex items-center gap-1.5 font-semibold text-text">
        <LiveDot state={src ?? "connecting"} />
        {CHAINS[chain].short}
      </span>
      <span className={cn(src === "live" ? "text-buy" : src === "simulated" ? "text-warn" : src === "offline" ? "text-sell" : "text-text-3")}>
        {src === "live" ? "LIVE" : src === "simulated" ? "SIMULATED" : src === "offline" ? "OFFLINE" : "…"}
      </span>
      {st && st.latencyMs > 0 && <span className="text-text-3">{Math.round(st.latencyMs)}ms</span>}
    </div>
  );
}

function MoreSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const pauseOnHover = useSettings((s) => s.pauseOnHover);
  const soundAlerts = useSettings((s) => s.soundAlerts);
  const haptics = useSettings((s) => s.haptics);
  const set = useSettings((s) => s.set);
  const isAdmin = useIsAdminWallet();
  const items = isAdmin ? [...MORE, ADMIN] : MORE;
  const close = () => {
    haptic();
    onOpenChange(false);
  };
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="More">
      <div className="space-y-4">
        <div>
          {items.map((m) => (
            <SheetRow key={m.href} href={m.href} icon={m.icon} label={m.label} onClick={close} />
          ))}
        </div>

        <div className="rounded-[3px] border border-line px-2">
          <SheetRow
            icon={<Hand />}
            label="Pause while touching"
            hint="Freeze the board under your thumb"
            toggle={{ checked: pauseOnHover, onChange: (v) => set({ pauseOnHover: v }) }}
          />
          <SheetRow
            icon={<Bell />}
            label="Sound alerts"
            toggle={{ checked: soundAlerts, onChange: (v) => set({ soundAlerts: v }) }}
          />
          <SheetRow
            icon={<Smartphone />}
            label="Haptics"
            toggle={{ checked: haptics, onChange: (v) => set({ haptics: v }) }}
          />
        </div>

        <div>
          <div className="eyebrow mb-2">Feeds</div>
          <div className="grid grid-cols-3 gap-2">
            {ENABLED_CHAINS.map((c) => (
              <FeedCell key={c} chain={c} />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 pb-1 text-[11px] text-text-3">
          <ClaudioMark size={18} />
          <span className="font-display text-[15px] font-bold uppercase tracking-[0.14em] text-text-2">{BRAND.name}</span>
          <span className="num">v{BRAND.version}</span>
        </div>
      </div>
    </ResponsiveSheet>
  );
}

export function TabBar() {
  const [location] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = [...MORE, ADMIN].some((m) => isActive(m, location));
  const launchActive = location === "/launch" || location.startsWith("/launch/");

  return (
    <>
      <nav aria-label="Tabs" className="safe-bottom relative z-30 shrink-0 border-t border-line bg-chrome backdrop-blur">
        <div className="flex h-tabbar items-stretch px-1">
          <Tab item={TABS[0]} active={!moreOpen && isActive(TABS[0], location)} />
          <Tab item={TABS[1]} active={!moreOpen && isActive(TABS[1], location)} />

          <div className="flex flex-1 items-stretch justify-center">
            <Link
              href="/launch"
              onClick={() => haptic(14)}
              aria-label="Launch a coin"
              className="relative flex h-full flex-col items-center justify-center gap-1"
            >
              <motion.span
                whileTap={{ scale: 0.94 }}
                className={cn(
                  "flex h-9 w-12 items-center justify-center rounded-[3px] bg-brand text-brand-ink",
                  launchActive && "outline outline-1 outline-offset-2 outline-brand",
                )}
              >
                <Plus className="h-5 w-5" strokeWidth={2.4} />
              </motion.span>
              <span className={cn("font-mono text-[9.5px] font-medium uppercase tracking-[0.08em]", launchActive ? "text-text" : "text-text-2")}>Launch</span>
            </Link>
          </div>

          <Tab item={TABS[2]} active={!moreOpen && isActive(TABS[2], location)} />
          <button
            type="button"
            onClick={() => {
              haptic();
              setMoreOpen(true);
            }}
            className={cn(
              "relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] transition-colors",
              moreActive || moreOpen ? "text-text" : "text-text-3",
            )}
            aria-haspopup="dialog"
          >
            {(moreActive || moreOpen) && <TabIndicator />}
            <MoreHorizontal className={cn("relative z-10 h-5 w-5 stroke-[1.6]", (moreActive || moreOpen) && "text-brand")} />
            <span className="relative z-10">More</span>
          </button>
        </div>
      </nav>
      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </>
  );
}
