// Desktop navigation rail: mark, Launch call-to-action, primary destinations, account destinations (+ Admin for admin wallets).
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { BRAND } from "@shared/brand";
import { ClaudioMark } from "@/components/kit";
import { useIsAdminWallet } from "@/lib/session";
import { cn } from "@/lib/utils";
import { ACCOUNT_NAV, ADMIN, NAV, isActive, type NavItem } from "./nav";

function RailItem({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      title={item.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex w-[64px] flex-col items-center gap-1.5 rounded-[3px] py-2 font-mono text-[9px] font-medium uppercase tracking-[0.08em] transition-colors",
        active ? "text-text" : "text-text-3 hover:bg-panel hover:text-text-2",
      )}
    >
      {active && (
        <motion.span
          layoutId="rail-indicator"
          className="absolute -left-1.5 top-1/2 h-7 w-[2px] -translate-y-1/2 bg-brand"
          transition={{ type: "spring", stiffness: 520, damping: 40 }}
        />
      )}
      <span className={cn("[&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg]:stroke-[1.6]", active && "text-brand")}>{item.icon}</span>
      <span className="leading-none">{item.label}</span>
    </Link>
  );
}

export function Rail() {
  const [location] = useLocation();
  const launchActive = location === "/launch" || location.startsWith("/launch/");
  const isAdmin = useIsAdminWallet();
  const account = isAdmin ? [...ACCOUNT_NAV, ADMIN] : ACCOUNT_NAV;
  return (
    <aside className="relative z-40 flex w-rail shrink-0 flex-col items-center border-r border-line bg-bg-elev" aria-label="Main">
      <Link href="/home" className="flex h-topbar w-full shrink-0 items-center justify-center border-b border-line" aria-label={`${BRAND.full} home`} title={`${BRAND.full} — ${BRAND.tagline}`}>
        <ClaudioMark size={36} />
      </Link>

      <div className="flex w-full flex-col items-center px-2 pb-2 pt-3">
        <Link
          href="/launch"
          title="Launch a coin (L)"
          aria-current={launchActive ? "page" : undefined}
          className="group flex w-[64px] flex-col items-center gap-1.5 font-mono text-[9px] font-medium uppercase tracking-[0.08em]"
        >
          <motion.span
            whileTap={{ scale: 0.92 }}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-[3px] bg-brand text-brand-ink transition-colors",
              launchActive ? "ring-1 ring-brand ring-offset-2 ring-offset-bg-elev" : "group-hover:bg-brand/90",
            )}
          >
            <Plus className="h-5 w-5" strokeWidth={2.25} />
          </motion.span>
          <span className={launchActive ? "text-text" : "text-text-2"}>Launch</span>
        </Link>
      </div>

      <div className="mx-auto my-1 h-px w-full bg-line" />

      <nav className="no-scrollbar flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto px-2 py-2">
        {NAV.map((item) => (
          <RailItem key={item.href} item={item} active={isActive(item, location)} />
        ))}
      </nav>

      <div className="flex w-full shrink-0 flex-col items-center gap-1 border-t border-line px-2 py-2">
        {account.map((item) => (
          <RailItem key={item.href} item={item} active={isActive(item, location)} />
        ))}
      </div>
    </aside>
  );
}
