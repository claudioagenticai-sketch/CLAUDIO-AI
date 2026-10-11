// Navigation model shared by the desktop rail, the mobile dock and the More sheet.
// The Admin destination is never listed here: it's added by the rail / More sheet only when useIsAdminWallet() is true.
import type { ReactNode } from "react";
import { BookOpen, Bot, Briefcase, Cloud, Flame, Gift, Home, Library, Radar, Settings, ShieldCheck, Sparkles, Wallet, Wand2 } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Extra path prefixes that should highlight this item. */
  match?: string[];
}

export const HOME: NavItem = { href: "/home", label: "Home", icon: <Home /> };
export const TRENCHES: NavItem = { href: "/trenches", label: "Trenches", icon: <Flame />, match: ["/t/", "/board"] };
export const PORTFOLIO: NavItem = { href: "/portfolio", label: "Portfolio", icon: <Briefcase /> };
export const AGENTS: NavItem = { href: "/agents", label: "Agents", icon: <Bot />, match: ["/a/"] };
export const CLOUD: NavItem = { href: "/cloud", label: "Cloud", icon: <Cloud /> };
export const GENERATE: NavItem = { href: "/generate", label: "Generate", icon: <Wand2 /> };
export const TRACKER: NavItem = { href: "/tracker", label: "Tracker", icon: <Radar /> };
export const CREATOR: NavItem = { href: "/creator", label: "Creator", icon: <Sparkles /> };
export const CLAIM: NavItem = { href: "/claim", label: "Claim", icon: <Gift /> };
export const WALLETS: NavItem = { href: "/wallets", label: "Wallets", icon: <Wallet /> };
export const SETTINGS: NavItem = { href: "/settings", label: "Settings", icon: <Settings /> };
export const DOCS: NavItem = { href: "/docs", label: "Docs", icon: <BookOpen /> };
export const SKILLS: NavItem = { href: "/skills", label: "Skills", icon: <Library /> };
/** Only rendered for admin wallets (useIsAdminWallet). */
export const ADMIN: NavItem = { href: "/admin", label: "Admin", icon: <ShieldCheck /> };

/** Primary destinations (desktop rail, top group). Launch has its own call-to-action above these. */
export const NAV: NavItem[] = [HOME, TRENCHES, PORTFOLIO, AGENTS, CLOUD, GENERATE, SKILLS, TRACKER, CREATOR, CLAIM];

/** Account destinations (desktop rail, bottom group). Admin is appended for admin wallets. */
export const ACCOUNT_NAV: NavItem[] = [WALLETS, SETTINGS];

/** Phone dock: Home · Trenches · (Launch) · Portfolio · More. */
export const DOCK: NavItem[] = [HOME, TRENCHES, PORTFOLIO];

/** Phone "More" sheet. Admin is appended for admin wallets. */
export const MORE: NavItem[] = [AGENTS, CLOUD, GENERATE, SKILLS, TRACKER, CREATOR, { ...CLAIM, label: "Claim fees" }, WALLETS, SETTINGS, DOCS];

export function isActive(item: NavItem, location: string): boolean {
  return location === item.href || location.startsWith(`${item.href}/`) || (item.match ?? []).some((m) => location.startsWith(m));
}

const TITLES: [string, string][] = [
  ["/trenches", "Trenches"],
  ["/t/", "Token"],
  ["/launch", "Launch"],
  ["/portfolio", "Portfolio"],
  ["/agents", "Agents"],
  ["/a/", "Agent"],
  ["/cloud", "Cloud"],
  ["/generate", "Generate"],
  ["/skills", "Skills"],
  ["/tracker", "Tracker"],
  ["/creator", "Creator"],
  ["/claim", "Claim fees"],
  ["/wallets", "Wallets"],
  ["/settings", "Settings"],
  ["/docs", "Docs"],
  ["/admin", "Admin"],
];

/** Section name for the desktop top bar (and the document title). */
export function pageTitle(location: string): string {
  if (location === "/home") return "Home";
  if (/^\/a\/[^/]+\/console/.test(location)) return "Agent console";
  return TITLES.find(([p]) => location === p || location.startsWith(p.endsWith("/") ? p : `${p}/`))?.[1] ?? "Claudio";
}
